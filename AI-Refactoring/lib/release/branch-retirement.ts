/**
 * Released-branch cleanup for `.github/actions/retire-release-branch`.
 *
 * After a release is published, its `release/lz-vX.Y.Z` branch is deleted so it cannot receive
 * further commits. The repository's rules restrict branch deletion, and `GITHUB_TOKEN` cannot be
 * granted a ruleset bypass, so the deletion uses a short-lived installation token of a GitHub App
 * that the repository administrators put on the bypass list.
 *
 * Every precondition is checked first with the read-only workflow token. Only when all of them
 * pass is an App token minted, narrowed to this repository and `contents: write`, used for the one
 * DELETE, and revoked. Any failed check, error or ambiguity ends in `skipped` or `failed` and the
 * branch is kept: a failure can never authorize a deletion. Cleanup is housekeeping, so the outcome
 * is reported, not thrown; the release itself has already succeeded.
 *
 * Governed by `.apm/skills/manage-landing-zone-release-workflows/SKILL.md`.
 */

import { createSign } from 'node:crypto';

/** The only branches this cleanup may delete: the release branches of this repository. */
export const ELIGIBLE_RELEASE_BRANCH = /^release\/lz-v((0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*))$/;

const SHA = /^[0-9a-f]{40}$/;
const APP_IDENTIFIER = /^(\d+|Iv[0-9A-Za-z.]+)$/;
const ACTIVE_DEPLOYMENT_STATES = new Set(['queued', 'in_progress', 'pending']);

export type CleanupOutcome = 'deleted' | 'already-deleted' | 'skipped' | 'failed';

export interface CleanupCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface CleanupResult {
  readonly outcome: CleanupOutcome;
  readonly reason: string;
  readonly branch: string;
  readonly checks: readonly CleanupCheck[];
}

export interface GitHubAppCredentials {
  /** App ID (numeric) or Client ID (`Iv...`); either is accepted as the JWT issuer. */
  readonly appId: string;
  readonly privateKey: string;
}

export interface CleanupInput {
  /** `owner/repo` */
  readonly repository: string;
  readonly runId: string;
  readonly releaseBranch: string;
  readonly releasedSha: string;
  readonly releaseTag: string;
  /** `needs.<job>.result` of the Production deployment and the GitHub Release publication. */
  readonly productionResult: string;
  readonly publishResult: string;
  /** Read-only workflow token for every check. */
  readonly readToken: string;
  /** Undefined until the administrators have configured the App. */
  readonly app: GitHubAppCredentials | undefined;
  /**
   * Environment of the cleanup job itself. Its own deployment is in progress while it runs, so it is
   * not counted as active work on the branch.
   */
  readonly ownEnvironment?: string;
  readonly nowSeconds?: () => number;
}

export interface HttpResponse {
  readonly status: number;
  readonly data: unknown;
}

/** Calls the GitHub REST API; `path` is relative to the API root, for example `/repos/o/r`. */
export type HttpClient = (
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: { readonly token: string; readonly body?: unknown }
) => Promise<HttpResponse>;

/** Thrown inside the cleanup to stop it with a reportable outcome. */
class Stop extends Error {
  constructor(
    readonly outcome: CleanupOutcome,
    message: string
  ) {
    super(message);
  }
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/** RS256 JWT that authenticates as the GitHub App, valid for at most ten minutes as GitHub requires. */
export function createAppJwt(credentials: GitHubAppCredentials, nowSeconds: number): string {
  if (!APP_IDENTIFIER.test(credentials.appId)) {
    throw new Stop('failed', 'The GitHub App ID is not a numeric App ID or an Iv... Client ID.');
  }
  // A key stored with escaped newlines is still a valid key; accept both forms.
  const key = credentials.privateKey.includes('\\n')
    ? credentials.privateKey.replace(/\\n/g, '\n')
    : credentials.privateKey;
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  // Backdated by a minute against clock drift; expires after nine minutes.
  const payload = base64Url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: credentials.appId }));
  try {
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${payload}`);
    return `${header}.${payload}.${signer.sign(key).toString('base64url')}`;
  } catch (error) {
    throw new Stop('failed', `The GitHub App private key cannot sign a token (${(error as Error).message}).`);
  }
}

function message(data: unknown): string {
  const text = (data as { message?: unknown } | undefined)?.message;
  return typeof text === 'string' ? text : 'no message';
}

function encodeBranch(branch: string): string {
  return branch.split('/').map(encodeURIComponent).join('/');
}

export async function retireReleaseBranch(input: CleanupInput, http: HttpClient): Promise<CleanupResult> {
  const checks: CleanupCheck[] = [];
  const pass = (name: string, detail: string): void => {
    checks.push({ name, passed: true, detail });
  };
  const fail = (outcome: CleanupOutcome, name: string, detail: string): never => {
    checks.push({ name, passed: false, detail });
    throw new Stop(outcome, detail);
  };
  const result = (outcome: CleanupOutcome, reason: string): CleanupResult => ({
    outcome,
    reason,
    branch: input.releaseBranch,
    checks
  });
  const repo = `/repos/${input.repository}`;
  const read = async (path: string, what: string): Promise<HttpResponse> => {
    const response = await http('GET', path, { token: input.readToken });
    if (response.status >= 400 && response.status !== 404) {
      throw new Stop(
        'failed',
        `Cannot read ${what} (HTTP ${response.status}: ${message(response.data)}); not deleting.`
      );
    }
    return response;
  };

  let installationToken: string | undefined;
  try {
    // 1. Only this repository's release branches, and only the one this release was cut from.
    const name = ELIGIBLE_RELEASE_BRANCH.exec(input.releaseBranch);
    if (!name) {
      fail('skipped', 'branch name', `${input.releaseBranch} is not an eligible release branch (release/lz-vX.Y.Z).`);
    }
    const expectedTag = `release-v${name?.[1] ?? ''}`;
    if (input.releaseTag !== expectedTag) {
      fail(
        'skipped',
        'release tag name',
        `Release tag '${input.releaseTag}' does not match ${input.releaseBranch} (expected ${expectedTag}).`
      );
    }
    if (!SHA.test(input.releasedSha)) {
      fail('skipped', 'released commit', `Released commit '${input.releasedSha}' is not a full commit SHA.`);
    }
    pass('branch name', `${input.releaseBranch} is an eligible release branch for ${expectedTag}.`);

    // 2. The release itself must have succeeded.
    if (input.productionResult !== 'success' || input.publishResult !== 'success') {
      fail(
        'skipped',
        'release completed',
        `Production deployment is '${input.productionResult}' and GitHub Release publication is '${input.publishResult}'; both must be 'success'.`
      );
    }
    pass('release completed', 'Production deployment and GitHub Release publication succeeded.');

    // 3. Never the default branch, whatever its name.
    const repository = await read(repo, 'the repository');
    const defaultBranch = (repository.data as { default_branch?: unknown } | undefined)?.default_branch;
    if (typeof defaultBranch !== 'string' || defaultBranch === input.releaseBranch) {
      fail(
        'skipped',
        'not the default branch',
        `${input.releaseBranch} is the default branch or the default branch is unknown.`
      );
    }
    pass('not the default branch', `The default branch is ${String(defaultBranch)}.`);

    // 4. Already gone is success; a branch that moved holds unreleased commits and is kept.
    const branchRef = await read(`${repo}/git/ref/heads/${encodeBranch(input.releaseBranch)}`, 'the release branch');
    if (branchRef.status === 404) {
      pass('branch exists', `${input.releaseBranch} is already deleted.`);
      return result('already-deleted', `${input.releaseBranch} was already deleted.`);
    }
    const head = (branchRef.data as { object?: { sha?: unknown } } | undefined)?.object?.sha;
    if (head !== input.releasedSha) {
      fail(
        'skipped',
        'branch at released commit',
        `${input.releaseBranch} points to ${String(head)}, not the released ${input.releasedSha}; it holds unreleased commits. ` +
          'Move them to a new release branch from main, then delete this branch manually.'
      );
    }
    pass('branch at released commit', `${input.releaseBranch} still points to ${input.releasedSha}.`);

    // 5. The release tag exists and points at the deployed commit.
    const tagRef = await read(`${repo}/git/ref/tags/${encodeURIComponent(input.releaseTag)}`, 'the release tag');
    if (tagRef.status === 404) {
      fail('skipped', 'release tag', `Release tag ${input.releaseTag} does not exist.`);
    }
    const tagObject = (tagRef.data as { object?: { sha?: unknown; type?: unknown } } | undefined)?.object;
    let tagCommit = tagObject?.sha;
    if (tagObject?.type === 'tag') {
      const annotated = await read(`${repo}/git/tags/${String(tagObject.sha)}`, 'the annotated release tag');
      tagCommit = (annotated.data as { object?: { sha?: unknown } } | undefined)?.object?.sha;
    }
    if (tagCommit !== input.releasedSha) {
      fail(
        'skipped',
        'release tag',
        `Release tag ${input.releaseTag} points to ${String(tagCommit)}, not ${input.releasedSha}.`
      );
    }
    pass('release tag', `${input.releaseTag} points to ${input.releasedSha}.`);

    // 6. The GitHub Release is published for that tag.
    const release = await read(`${repo}/releases/tags/${encodeURIComponent(input.releaseTag)}`, 'the GitHub Release');
    const releaseData = release.data as { draft?: unknown; tag_name?: unknown } | undefined;
    if (release.status === 404 || releaseData?.draft !== false || releaseData.tag_name !== input.releaseTag) {
      fail('skipped', 'GitHub Release', `No published GitHub Release exists for ${input.releaseTag}.`);
    }
    pass('GitHub Release', `The GitHub Release for ${input.releaseTag} is published.`);

    // 7. No open PR into or out of the branch.
    const owner = input.repository.split('/')[0] ?? '';
    const branchQuery = encodeURIComponent(input.releaseBranch);
    const openInto = await read(`${repo}/pulls?state=open&base=${branchQuery}&per_page=100`, 'open pull requests');
    const openFrom = await read(
      `${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.releaseBranch}`)}&per_page=100`,
      'open pull requests'
    );
    const open = [
      ...(Array.isArray(openInto.data) ? openInto.data : []),
      ...(Array.isArray(openFrom.data) ? openFrom.data : [])
    ]
      .map((pull: unknown) => (pull as { number?: unknown }).number)
      .filter((number): number is number => typeof number === 'number');
    if (open.length > 0) {
      fail(
        'skipped',
        'no open pull request',
        `Open pull request(s) ${open.map((number) => `#${number}`).join(', ')} use ${input.releaseBranch}.`
      );
    }
    pass('no open pull request', `No open pull request targets or comes from ${input.releaseBranch}.`);

    // 8. No pending backport: a backport/<release> branch whose PR has not been merged or closed.
    const suffix = input.releaseBranch.slice('release/'.length);
    const backportRefs = await read(
      `${repo}/git/matching-refs/heads/backport/${encodeURIComponent(suffix)}`,
      'backport branches'
    );
    const backports = (Array.isArray(backportRefs.data) ? backportRefs.data : [])
      .map((ref: unknown) => String((ref as { ref?: unknown }).ref ?? '').replace(/^refs\/heads\//, ''))
      .filter(
        (ref) =>
          ref === `backport/${suffix}` || ref.startsWith(`backport/${suffix}-`) || ref.startsWith(`backport/${suffix}/`)
      );
    for (const backport of backports) {
      const pulls = await read(
        `${repo}/pulls?state=all&head=${encodeURIComponent(`${owner}:${backport}`)}&per_page=100`,
        `pull requests of ${backport}`
      );
      const resolved = (Array.isArray(pulls.data) ? pulls.data : []).some(
        (pull: unknown) => (pull as { state?: unknown }).state === 'closed'
      );
      if (!resolved) {
        fail('skipped', 'no pending backport', `Backport branch ${backport} has no merged or closed pull request yet.`);
      }
    }
    pass(
      'no pending backport',
      backports.length === 0
        ? 'No backport branch exists for this release.'
        : `Backports ${backports.join(', ')} are resolved.`
    );

    // 9. No other workflow run and no deployment is still working on the branch.
    const runs = await read(`${repo}/actions/runs?branch=${branchQuery}&per_page=100`, 'workflow runs');
    const activeRuns = (
      ((runs.data as { workflow_runs?: unknown } | undefined)?.workflow_runs as unknown[] | undefined) ?? []
    )
      .map((run) => run as { id?: unknown; status?: unknown; name?: unknown })
      .filter((run) => String(run.id) !== input.runId && run.status !== 'completed');
    if (activeRuns.length > 0) {
      fail(
        'skipped',
        'no active workflow run',
        `Workflow run(s) ${activeRuns.map((run) => `${String(run.name)} #${String(run.id)}`).join(', ')} are still active on ${input.releaseBranch}.`
      );
    }
    pass('no active workflow run', `No other workflow run is active on ${input.releaseBranch}.`);

    const deployments = new Map<number, unknown>();
    for (const query of [`ref=${branchQuery}`, `sha=${input.releasedSha}`]) {
      const listed = await read(`${repo}/deployments?${query}&per_page=30`, 'deployments');
      for (const deployment of Array.isArray(listed.data) ? listed.data : []) {
        const id = (deployment as { id?: unknown }).id;
        if (typeof id === 'number') {
          deployments.set(id, deployment);
        }
      }
    }
    for (const [id, deployment] of deployments) {
      if (input.ownEnvironment && (deployment as { environment?: unknown }).environment === input.ownEnvironment) {
        continue;
      }
      const statuses = await read(`${repo}/deployments/${id}/statuses?per_page=1`, `the status of deployment ${id}`);
      const latest = (Array.isArray(statuses.data) ? statuses.data[0] : undefined) as { state?: unknown } | undefined;
      // A deployment without any status has not finished either.
      if (!latest || ACTIVE_DEPLOYMENT_STATES.has(String(latest.state))) {
        const environment = String((deployment as { environment?: unknown }).environment ?? 'unknown');
        fail(
          'skipped',
          'no active deployment',
          `Deployment ${id} to ${environment} is ${latest ? String(latest.state) : 'not started'}.`
        );
      }
    }
    pass('no active deployment', `None of the ${deployments.size} deployment(s) of this release is still active.`);

    // 10. Delete with the App's installation token, minted only now.
    if (!input.app) {
      fail(
        'skipped',
        'GitHub App configured',
        'The release-cleanup GitHub App is not configured (RELEASE_CLEANUP_APP_ID / RELEASE_CLEANUP_APP_PRIVATE_KEY).'
      );
    }
    const app = input.app as GitHubAppCredentials;
    const jwt = createAppJwt(app, (input.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))());
    const installation = await http('GET', `${repo}/installation`, { token: jwt });
    const installationId = (installation.data as { id?: unknown } | undefined)?.id;
    if (installation.status !== 200 || typeof installationId !== 'number') {
      fail(
        'failed',
        'GitHub App authentication',
        `The GitHub App is not installed on ${input.repository} or cannot authenticate (HTTP ${installation.status}: ${message(installation.data)}).`
      );
    }
    const repositoryName = input.repository.split('/')[1] ?? '';
    const issued = await http('POST', `/app/installations/${String(installationId)}/access_tokens`, {
      token: jwt,
      body: { repositories: [repositoryName], permissions: { contents: 'write' } }
    });
    const token = (issued.data as { token?: unknown } | undefined)?.token;
    if (issued.status !== 201 || typeof token !== 'string') {
      fail(
        'failed',
        'GitHub App authentication',
        `No installation token with contents: write for ${repositoryName} (HTTP ${issued.status}: ${message(issued.data)}).`
      );
    }
    installationToken = token as string;
    pass(
      'GitHub App authentication',
      'Short-lived installation token issued for this repository with contents: write only.'
    );

    const deletion = await http('DELETE', `${repo}/git/refs/heads/${encodeBranch(input.releaseBranch)}`, {
      token: installationToken
    });
    if (deletion.status === 422 && /does not exist/i.test(message(deletion.data))) {
      pass('deletion', `${input.releaseBranch} was deleted concurrently.`);
      return result('already-deleted', `${input.releaseBranch} was already deleted.`);
    }
    if (deletion.status !== 204) {
      fail(
        'failed',
        'deletion',
        `GitHub refused to delete ${input.releaseBranch} (HTTP ${deletion.status}: ${message(deletion.data)}). ` +
          'Check that the GitHub App is on the bypass list of every rule that restricts deletion of release/**.'
      );
    }
    const after = await read(`${repo}/git/ref/heads/${encodeBranch(input.releaseBranch)}`, 'the release branch');
    if (after.status !== 404) {
      fail('failed', 'deletion', `${input.releaseBranch} still exists after it was deleted.`);
    }
    pass('deletion', `${input.releaseBranch} is deleted; ${input.releaseTag} keeps the released commit reachable.`);
    return result('deleted', `${input.releaseBranch} was deleted.`);
  } catch (error) {
    if (error instanceof Stop) {
      return result(error.outcome, error.message);
    }
    return result(
      'failed',
      `Branch cleanup failed unexpectedly (${error instanceof Error ? error.message : String(error)}); not deleting.`
    );
  } finally {
    if (installationToken) {
      // Best effort: the token expires within an hour regardless.
      await http('DELETE', '/installation/token', { token: installationToken }).catch(() => undefined);
    }
  }
}

export function renderCleanupMarkdown(cleanup: CleanupResult): string {
  const lines = [
    `### Released branch cleanup: \`${cleanup.outcome}\``,
    '',
    cleanup.reason,
    '',
    '| Check | Result | Detail |',
    '| --- | --- | --- |'
  ];
  for (const check of cleanup.checks) {
    lines.push(`| ${check.name} | ${check.passed ? 'passed' : 'not passed'} | ${check.detail.replace(/\|/g, '\\|')} |`);
  }
  return lines.join('\n');
}
