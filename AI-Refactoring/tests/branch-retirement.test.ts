import { createVerify, generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ELIGIBLE_RELEASE_BRANCH,
  createAppJwt,
  renderCleanupMarkdown,
  retireReleaseBranch,
  type CleanupInput,
  type HttpClient,
  type HttpResponse
} from '../lib/release/branch-retirement.js';

/**
 * Released-branch cleanup against an in-memory GitHub. Every call is recorded, so each scenario can
 * prove which token was used, that no deletion happened when a check failed, and that the App token
 * was minted only after every check passed and revoked afterwards.
 */

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const TAG_OBJECT = 'c'.repeat(40);
const READ_TOKEN = 'workflow-read-token';
const INSTALLATION_TOKEN = 'ghs_installation_token';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

interface Call {
  readonly method: string;
  readonly path: string;
  readonly token: string;
  readonly body?: unknown;
}

interface FakeGitHub {
  defaultBranch: string;
  branches: Map<string, string>;
  tags: Map<string, { annotated: boolean; commit: string }>;
  releases: Map<string, { draft: boolean }>;
  pulls: { number: number; state: 'open' | 'closed'; base: string; head: string }[];
  backportBranches: string[];
  runs: { id: number; status: string; name: string }[];
  deployments: { id: number; environment: string; state: string | undefined }[];
  installed: boolean;
  tokenStatus: number;
  deleteResponse: HttpResponse | undefined;
  failRead: string | undefined;
  calls: Call[];
}

function fakeGitHub(overrides: Partial<FakeGitHub> = {}): FakeGitHub {
  return {
    defaultBranch: 'main',
    branches: new Map([['release/lz-v0.0.3', SHA]]),
    tags: new Map([['release-v0.0.3', { annotated: true, commit: SHA }]]),
    releases: new Map([['release-v0.0.3', { draft: false }]]),
    pulls: [],
    backportBranches: [],
    runs: [{ id: 1001, status: 'in_progress', name: 'deploy' }],
    deployments: [
      { id: 1, environment: 'staging', state: 'success' },
      { id: 2, environment: 'production', state: 'success' }
    ],
    installed: true,
    tokenStatus: 201,
    deleteResponse: undefined,
    failRead: undefined,
    calls: [],
    ...overrides
  };
}

function client(github: FakeGitHub): HttpClient {
  return async (method, fullPath, { token, body }) => {
    github.calls.push({ method, path: fullPath, token, body });
    const [path = '', queryString = ''] = fullPath.split('?');
    const query = new URLSearchParams(queryString);
    const ok = (data: unknown, status = 200): HttpResponse => ({ status, data });
    const missing: HttpResponse = { status: 404, data: { message: 'Not Found' } };
    const decode = (rest: string) => rest.split('/').map(decodeURIComponent).join('/');
    if (method === 'GET' && github.failRead && path.includes(github.failRead)) {
      return { status: 403, data: { message: 'Resource not accessible by integration' } };
    }
    if (method === 'GET' && path === '/repos/org/repo') {
      return ok({ default_branch: github.defaultBranch });
    }
    if (path.startsWith('/repos/org/repo/git/ref/heads/')) {
      const sha = github.branches.get(decode(path.slice('/repos/org/repo/git/ref/heads/'.length)));
      return sha ? ok({ object: { sha, type: 'commit' } }) : missing;
    }
    if (path.startsWith('/repos/org/repo/git/ref/tags/')) {
      const tag = github.tags.get(decode(path.slice('/repos/org/repo/git/ref/tags/'.length)));
      if (!tag) {
        return missing;
      }
      return ok({ object: tag.annotated ? { sha: TAG_OBJECT, type: 'tag' } : { sha: tag.commit, type: 'commit' } });
    }
    if (path === `/repos/org/repo/git/tags/${TAG_OBJECT}`) {
      return ok({ object: { sha: [...github.tags.values()][0]?.commit, type: 'commit' } });
    }
    if (path.startsWith('/repos/org/repo/releases/tags/')) {
      const name = decode(path.slice('/repos/org/repo/releases/tags/'.length));
      const release = github.releases.get(name);
      return release ? ok({ tag_name: name, draft: release.draft }) : missing;
    }
    if (path === '/repos/org/repo/pulls') {
      const head = query.get('head')?.replace(/^org:/, '');
      const base = query.get('base');
      const state = query.get('state');
      return ok(
        github.pulls.filter(
          (pull) =>
            (state === 'all' || pull.state === state) &&
            (base === null || pull.base === base) &&
            (head === undefined || pull.head === head)
        )
      );
    }
    if (path.startsWith('/repos/org/repo/git/matching-refs/heads/backport/')) {
      const prefix = `backport/${decode(path.slice('/repos/org/repo/git/matching-refs/heads/backport/'.length))}`;
      return ok(
        github.backportBranches.filter((name) => name.startsWith(prefix)).map((name) => ({ ref: `refs/heads/${name}` }))
      );
    }
    if (path === '/repos/org/repo/actions/runs') {
      return ok({ workflow_runs: github.runs });
    }
    if (path === '/repos/org/repo/deployments') {
      return ok(github.deployments.map(({ id, environment }) => ({ id, environment })));
    }
    const statuses = /^\/repos\/org\/repo\/deployments\/(\d+)\/statuses$/.exec(path);
    if (statuses) {
      const state = github.deployments.find((deployment) => deployment.id === Number(statuses[1]))?.state;
      return ok(state ? [{ state }] : []);
    }
    if (method === 'GET' && path === '/repos/org/repo/installation') {
      return github.installed ? ok({ id: 42 }) : missing;
    }
    if (method === 'POST' && path === '/app/installations/42/access_tokens') {
      return github.tokenStatus === 201
        ? ok({ token: INSTALLATION_TOKEN }, 201)
        : { status: github.tokenStatus, data: { message: 'Resource not accessible by integration' } };
    }
    if (method === 'DELETE' && path.startsWith('/repos/org/repo/git/refs/heads/')) {
      if (github.deleteResponse) {
        return github.deleteResponse;
      }
      const branch = decode(path.slice('/repos/org/repo/git/refs/heads/'.length));
      if (!github.branches.delete(branch)) {
        return { status: 422, data: { message: 'Reference does not exist' } };
      }
      return { status: 204, data: undefined };
    }
    if (method === 'DELETE' && path === '/installation/token') {
      return { status: 204, data: undefined };
    }
    throw new Error(`Unexpected ${method} ${fullPath}`);
  };
}

const INPUT: CleanupInput = {
  repository: 'org/repo',
  runId: '1001',
  releaseBranch: 'release/lz-v0.0.3',
  releasedSha: SHA,
  releaseTag: 'release-v0.0.3',
  productionResult: 'success',
  publishResult: 'success',
  readToken: READ_TOKEN,
  app: { appId: '123456', privateKey: PRIVATE_KEY },
  nowSeconds: () => 1_800_000_000
};

async function run(github: FakeGitHub, input: Partial<CleanupInput> = {}) {
  return retireReleaseBranch({ ...INPUT, ...input }, client(github));
}

const deletions = (github: FakeGitHub) =>
  github.calls.filter((call) => call.method === 'DELETE' && call.path.includes('/git/refs/'));
const minted = (github: FakeGitHub) => github.calls.some((call) => call.path.endsWith('/access_tokens'));

describe('successful authorized deletion', () => {
  it('deletes the branch with the installation token after every check passed', async () => {
    const github = fakeGitHub();
    const result = await run(github);

    expect(result.outcome).toBe('deleted');
    expect(github.branches.has('release/lz-v0.0.3')).toBe(false);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    expect(deletions(github)).toEqual([
      expect.objectContaining({ token: INSTALLATION_TOKEN, path: '/repos/org/repo/git/refs/heads/release/lz-v0.0.3' })
    ]);
  });

  it('reads only with the workflow token and uses the App token for nothing but the deletion', async () => {
    const github = fakeGitHub();
    await run(github);
    const appCalls = github.calls.filter((call) => call.token === INSTALLATION_TOKEN);
    expect(appCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'DELETE /repos/org/repo/git/refs/heads/release/lz-v0.0.3',
      'DELETE /installation/token'
    ]);
    const checkCalls = github.calls.filter((call) => call.method === 'GET' && !call.path.endsWith('/installation'));
    expect(checkCalls.every((call) => call.token === READ_TOKEN)).toBe(true);
  });

  it('narrows the installation token to this repository and contents: write, and revokes it', async () => {
    const github = fakeGitHub();
    await run(github);
    const request = github.calls.find((call) => call.path.endsWith('/access_tokens'));
    expect(request?.body).toEqual({ repositories: ['repo'], permissions: { contents: 'write' } });
    expect(github.calls.at(-1)).toMatchObject({
      method: 'DELETE',
      path: '/installation/token',
      token: INSTALLATION_TOKEN
    });
  });

  it('mints the token only after the last check', async () => {
    const github = fakeGitHub();
    await run(github);
    const mintIndex = github.calls.findIndex((call) => call.path.endsWith('/access_tokens'));
    const lastCheck = github.calls.findIndex(
      (call) => call.path.endsWith('/statuses?per_page=1') && call.path.includes('/2/')
    );
    expect(mintIndex).toBeGreaterThan(lastCheck);
  });

  it('does not count its own release-cleanup deployment as active work', async () => {
    const github = fakeGitHub({
      deployments: [
        { id: 1, environment: 'production', state: 'success' },
        { id: 3, environment: 'release-cleanup', state: 'in_progress' }
      ]
    });
    expect((await run(github, { ownEnvironment: 'release-cleanup' })).outcome).toBe('deleted');
    expect(
      (await run(fakeGitHub({ deployments: [{ id: 3, environment: 'release-cleanup', state: 'in_progress' }] })))
        .outcome
    ).toBe('skipped');
  });

  it('accepts a resolved backport and the run itself, and deployments that finished', async () => {
    const github = fakeGitHub({
      backportBranches: ['backport/lz-v0.0.3-fix', 'backport/lz-v0.0.30-other'],
      pulls: [{ number: 7, state: 'closed', base: 'release/lz-v0.0.3', head: 'backport/lz-v0.0.3-fix' }],
      deployments: [{ id: 1, environment: 'production', state: 'inactive' }]
    });
    expect((await run(github)).outcome).toBe('deleted');
  });
});

describe('already deleted and reruns', () => {
  it('reports an already deleted branch as success without minting a token', async () => {
    const github = fakeGitHub({ branches: new Map() });
    const result = await run(github);
    expect(result.outcome).toBe('already-deleted');
    expect(minted(github)).toBe(false);
  });

  it('is safe to run again: the second run finds the branch gone', async () => {
    const github = fakeGitHub();
    expect((await run(github)).outcome).toBe('deleted');
    github.calls = [];
    expect((await run(github)).outcome).toBe('already-deleted');
    expect(deletions(github)).toHaveLength(0);
  });

  it('treats a branch deleted between the check and the deletion as already deleted', async () => {
    const github = fakeGitHub({ deleteResponse: { status: 422, data: { message: 'Reference does not exist' } } });
    expect((await run(github)).outcome).toBe('already-deleted');
  });
});

describe('GitHub App authentication and permission failures keep the branch', () => {
  it('fails when the App is not installed on the repository', async () => {
    const github = fakeGitHub({ installed: false });
    const result = await run(github);
    expect(result).toMatchObject({ outcome: 'failed', reason: expect.stringMatching(/not installed/) });
    expect(deletions(github)).toHaveLength(0);
  });

  it('fails when the App cannot get a contents: write token', async () => {
    const github = fakeGitHub({ tokenStatus: 403 });
    const result = await run(github);
    expect(result).toMatchObject({ outcome: 'failed', reason: expect.stringMatching(/contents: write/) });
    expect(deletions(github)).toHaveLength(0);
  });

  it('fails on a private key that cannot sign or an invalid App ID, before any request', async () => {
    const badKey = fakeGitHub();
    expect((await run(badKey, { app: { appId: '123', privateKey: 'not a key' } })).outcome).toBe('failed');
    expect(badKey.calls.some((call) => call.path.endsWith('/installation'))).toBe(false);
    expect((await run(fakeGitHub(), { app: { appId: 'abc', privateKey: PRIVATE_KEY } })).outcome).toBe('failed');
  });

  it('reports a ruleset refusal as a failure, keeps the branch and still revokes the token', async () => {
    const github = fakeGitHub({
      deleteResponse: {
        status: 422,
        data: { message: 'Repository rule violations found\n\nCannot delete this branch' }
      }
    });
    const result = await run(github);
    expect(result).toMatchObject({ outcome: 'failed', reason: expect.stringMatching(/bypass list/) });
    expect(github.branches.has('release/lz-v0.0.3')).toBe(true);
    expect(github.calls.at(-1)).toMatchObject({ path: '/installation/token' });
  });

  it('reports a permission denial as a failure', async () => {
    const github = fakeGitHub({
      deleteResponse: { status: 403, data: { message: 'Resource not accessible by integration' } }
    });
    expect((await run(github)).outcome).toBe('failed');
  });

  it('skips, after running every check, when the App is not configured yet', async () => {
    const github = fakeGitHub();
    const result = await run(github, { app: undefined });
    expect(result).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/not configured/) });
    expect(result.checks.filter((check) => check.passed).length).toBeGreaterThan(8);
    expect(minted(github)).toBe(false);
  });
});

describe('release integrity: a failed check never authorizes deletion', () => {
  it.each([
    'main',
    'release/v0.0.3',
    'release/lz-v0.0.3-rc1',
    'release/lz-v01.0.0',
    'feature/release/lz-v0.0.3',
    'backport/lz-v0.0.3'
  ])('refuses the ineligible branch %s without any API call', async (releaseBranch) => {
    const github = fakeGitHub();
    const result = await run(github, { releaseBranch });
    expect(result.outcome).toBe('skipped');
    expect(github.calls).toHaveLength(0);
  });

  it('refuses a release tag that does not belong to the branch', async () => {
    const github = fakeGitHub();
    expect((await run(github, { releaseTag: 'release-v0.0.2' })).outcome).toBe('skipped');
    expect(github.calls).toHaveLength(0);
  });

  it('refuses when Production or the GitHub Release did not succeed', async () => {
    expect((await run(fakeGitHub(), { productionResult: 'failure' })).outcome).toBe('skipped');
    expect((await run(fakeGitHub(), { publishResult: 'skipped' })).outcome).toBe('skipped');
  });

  it('refuses when the release tag is missing', async () => {
    const github = fakeGitHub({ tags: new Map() });
    expect(await run(github)).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/does not exist/) });
    expect(minted(github)).toBe(false);
  });

  it('refuses when the tag points at another commit, annotated or lightweight', async () => {
    for (const annotated of [true, false]) {
      const github = fakeGitHub({ tags: new Map([['release-v0.0.3', { annotated, commit: OTHER_SHA }]]) });
      expect(await run(github)).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/points to b{40}/) });
      expect(deletions(github)).toHaveLength(0);
    }
  });

  it('refuses when the GitHub Release is missing or still a draft', async () => {
    expect((await run(fakeGitHub({ releases: new Map() }))).outcome).toBe('skipped');
    expect((await run(fakeGitHub({ releases: new Map([['release-v0.0.3', { draft: true }]]) }))).outcome).toBe(
      'skipped'
    );
  });

  it('keeps a branch that moved past the released commit', async () => {
    const github = fakeGitHub({ branches: new Map([['release/lz-v0.0.3', OTHER_SHA]]) });
    expect(await run(github)).toMatchObject({
      outcome: 'skipped',
      reason: expect.stringMatching(/unreleased commits/)
    });
  });

  it('refuses when the branch is the default branch', async () => {
    expect((await run(fakeGitHub({ defaultBranch: 'release/lz-v0.0.3' }))).outcome).toBe('skipped');
  });

  it('fails without deleting when a check cannot be read', async () => {
    const github = fakeGitHub({ failRead: '/pulls' });
    expect(await run(github)).toMatchObject({
      outcome: 'failed',
      reason: expect.stringMatching(/Cannot read open pull requests/)
    });
    expect(minted(github)).toBe(false);
  });
});

describe('open pull requests, pending backports and active work keep the branch', () => {
  it('refuses while a pull request targets or comes from the branch', async () => {
    const into = fakeGitHub({ pulls: [{ number: 9, state: 'open', base: 'release/lz-v0.0.3', head: 'backport/x' }] });
    expect(await run(into)).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/#9/) });
    const from = fakeGitHub({ pulls: [{ number: 10, state: 'open', base: 'main', head: 'release/lz-v0.0.3' }] });
    expect(await run(from)).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/#10/) });
  });

  it('refuses while a backport branch for this release has no resolved pull request', async () => {
    const github = fakeGitHub({ backportBranches: ['backport/lz-v0.0.3-hotfix'] });
    expect(await run(github)).toMatchObject({
      outcome: 'skipped',
      reason: expect.stringMatching(/backport\/lz-v0\.0\.3-hotfix/)
    });
  });

  it('refuses while another workflow run is active on the branch', async () => {
    const github = fakeGitHub({
      runs: [
        { id: 1001, status: 'in_progress', name: 'deploy' },
        { id: 1002, status: 'queued', name: 'deploy' }
      ]
    });
    expect(await run(github)).toMatchObject({ outcome: 'skipped', reason: expect.stringMatching(/#1002/) });
  });

  it('refuses while a deployment is in progress or has not started', async () => {
    for (const state of ['in_progress', 'queued', 'pending', undefined]) {
      const github = fakeGitHub({ deployments: [{ id: 5, environment: 'production', state }] });
      expect((await run(github)).outcome).toBe('skipped');
      expect(minted(github)).toBe(false);
    }
  });
});

describe('outcome reporting', () => {
  it('turns an unexpected exception into a failed outcome instead of throwing', async () => {
    const throwing: HttpClient = async () => {
      throw new Error('network unreachable');
    };
    const result = await retireReleaseBranch(INPUT, throwing);
    expect(result).toMatchObject({
      outcome: 'failed',
      reason: expect.stringMatching(/network unreachable.*not deleting/)
    });
  });

  it('renders every check for the job summary', async () => {
    const result = await run(fakeGitHub());
    const markdown = renderCleanupMarkdown(result);
    expect(markdown).toContain('### Released branch cleanup: `deleted`');
    expect(markdown).toContain('| release tag | passed |');
  });
});

describe('GitHub App JWT', () => {
  it('is RS256-signed by the App key, issued by the App and valid for under ten minutes', () => {
    const jwt = createAppJwt({ appId: '123456', privateKey: PRIVATE_KEY }, 1_800_000_000);
    const [header = '', payload = '', signature = ''] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      iat: number;
      exp: number;
      iss: string;
    };
    expect(claims).toEqual({ iat: 1_799_999_940, exp: 1_800_000_540, iss: '123456' });
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('accepts a key stored with escaped newlines and a Client ID issuer', () => {
    const escaped = PRIVATE_KEY.replace(/\n/g, '\\n');
    expect(createAppJwt({ appId: 'Iv23liExample', privateKey: escaped }, 1_800_000_000).split('.')).toHaveLength(3);
  });

  it('matches only release/lz-vX.Y.Z branches', () => {
    expect(ELIGIBLE_RELEASE_BRANCH.test('release/lz-v0.0.3')).toBe(true);
    expect(ELIGIBLE_RELEASE_BRANCH.test('release/lz-v10.20.30')).toBe(true);
    expect(ELIGIBLE_RELEASE_BRANCH.test('release/lz-v0.0.3/x')).toBe(false);
  });
});
