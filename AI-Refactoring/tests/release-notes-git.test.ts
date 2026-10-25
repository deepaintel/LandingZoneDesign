import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createGitHistory, createGitRunner, type GitHistory } from '../lib/release/git-history.js';
import {
  ReleaseNotesError,
  buildReleaseNotes,
  pullNumbersInNotes,
  synthesizeGeneratedNotes
} from '../lib/release/release-notes.js';

/**
 * Release-note verification against real git repositories: the same squash-merge, backport and
 * cherry-pick shapes that make this repository's release tags diverge. Each repository lives in a
 * temporary directory and is removed afterwards; nothing touches this working tree.
 */

const URL_BASE = 'https://example.invalid/org/repo';
const directories: string[] = [];
let clock = 1_700_000_000;

interface Repo {
  readonly dir: string;
  readonly history: GitHistory;
  git(...args: string[]): string;
  commit(file: string, content: string, message: string): string;
  tag(name: string, ref: string, createdAt: number): void;
}

function createRepo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  directories.push(dir);
  writeFileSync(join(dir, '.gitconfig-empty'), '');
  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: join(dir, '.gitconfig-empty'),
    GIT_AUTHOR_NAME: 'Test Author',
    GIT_AUTHOR_EMAIL: 'author@example.invalid',
    GIT_COMMITTER_NAME: 'Test Committer',
    GIT_COMMITTER_EMAIL: 'committer@example.invalid'
  };
  const stamp = (): NodeJS.ProcessEnv => {
    clock += 60;
    const date = `${clock} +0000`;
    return { ...baseEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  };
  const run = (env: NodeJS.ProcessEnv, args: readonly string[]): string => createGitRunner(dir, env)(args);
  run(baseEnv, ['init', '-q', '-b', 'main']);
  run(baseEnv, ['config', 'commit.gpgsign', 'false']);
  run(baseEnv, ['config', 'tag.gpgsign', 'false']);

  return {
    dir,
    history: createGitHistory(createGitRunner(dir, baseEnv)),
    git: (...args) => run(stamp(), args).trim(),
    commit: (file, content, message) => {
      writeFileSync(join(dir, file), content);
      run(baseEnv, ['add', '-A']);
      run(stamp(), ['commit', '-q', '-m', message]);
      return run(baseEnv, ['rev-parse', 'HEAD']).trim();
    },
    tag: (name, ref, createdAt) => {
      const date = `${createdAt} +0000`;
      run({ ...baseEnv, GIT_COMMITTER_DATE: date }, ['tag', '-a', name, '-m', 'Successful production deployment', ref]);
    }
  };
}

afterAll(() => {
  for (const dir of directories) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function notesFor(repo: Repo, releaseTag: string, commit: string) {
  const tags = repo.history.listReleaseTags();
  return buildReleaseNotes({
    releaseTag,
    commitSha: commit,
    tags,
    history: repo.history,
    generateNotes: async (previousTag) =>
      synthesizeGeneratedNotes(
        previousTag ? repo.history.rangeCommits(commit, previousTag) : [],
        URL_BASE,
        previousTag,
        releaseTag
      )
  });
}

/** main: A(#1) B(#2) C(#3); release 1 carries only a backport of A, release 2 is cut from main. */
function divergedRepo(backport: (repo: Repo, original: string) => void): { repo: Repo; head: string } {
  const repo = createRepo();
  repo.commit('base.txt', 'base\n', 'Initial commit');
  const base = repo.git('rev-parse', 'HEAD');
  const featureA = repo.commit('a.txt', 'A\n', 'Feature A (#1)');
  repo.commit('b.txt', 'B\n', 'Feature B (#2)');
  const head = repo.commit('c.txt', 'C\n', 'Feature C (#3)');

  repo.git('switch', '-q', '-c', 'release-one', base);
  backport(repo, featureA);
  repo.tag('release-v0.0.1', 'HEAD', 1_800_000_000);

  repo.git('switch', '-q', 'main');
  repo.tag('release-v0.0.2', head, 1_800_100_000);
  return { repo, head };
}

describe('release notes over real git history', () => {
  it('recognises a squash-merged backport of the same patch as already released', async () => {
    const { repo, head } = divergedRepo((r, original) => {
      r.git('cherry-pick', original);
      r.git('commit', '-q', '--amend', '-m', 'Feature A (#1) (#10)');
    });
    expect(
      repo.history
        .listReleaseTags()
        .map((tag) => tag.name)
        .sort()
    ).toEqual(['release-v0.0.1', 'release-v0.0.2']);

    const { body, report } = await notesFor(repo, 'release-v0.0.2', head);

    expect(report.previousTag).toBe('release-v0.0.1');
    expect(report.rangeCommitCount).toBe(3);
    expect(pullNumbersInNotes(body)).toEqual([3, 2]);
    const excluded = report.commits.find((commit) => commit.pullNumbers.includes(1));
    expect(excluded).toMatchObject({ status: 'duplicate', signal: 'patch-id' });
    expect(excluded?.matches[0]).toMatchObject({ pullNumbers: [1, 10], releaseTags: ['release-v0.0.1'] });
  }, 60_000);

  it('recognises a backport whose patch and title changed through its cherry-pick trailer', async () => {
    const { repo, head } = divergedRepo((r, original) => {
      r.git('cherry-pick', '-x', original);
      writeFileSync(join(r.dir, 'a.txt'), 'A, adapted to the release branch\n');
      r.git('add', '-A');
      r.git('commit', '-q', '--amend', '-m', `Hotfix for the release (#11)\n\n(cherry picked from commit ${original})`);
    });

    const { body, report } = await notesFor(repo, 'release-v0.0.2', head);

    expect(pullNumbersInNotes(body)).toEqual([3, 2]);
    expect(report.commits.find((commit) => commit.pullNumbers.includes(1))).toMatchObject({
      status: 'duplicate',
      signal: 'cherry-pick-trailer'
    });
  }, 60_000);

  it('recognises a backport through the shared PR number and title when the patch differs', async () => {
    const { repo, head } = divergedRepo((r) => {
      r.commit('a.txt', 'A, with a conflict resolution\n', 'Feature A (#1) (#10)');
    });

    const { body, report } = await notesFor(repo, 'release-v0.0.2', head);

    expect(pullNumbersInNotes(body)).toEqual([3, 2]);
    expect(report.commits.find((commit) => commit.pullNumbers.includes(1))?.signal).toBe('pull-request-and-title');
  }, 60_000);

  it('keeps a change that only shares a PR number with a different title, and refuses to publish', async () => {
    const { repo, head } = divergedRepo((r) => {
      r.commit('a.txt', 'A, reworked\n', 'Completely reworked A (#1) (#10)');
    });

    const outcome = await notesFor(repo, 'release-v0.0.2', head).catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(ReleaseNotesError);
    expect(
      (outcome as ReleaseNotesError).report?.commits.find((commit) => commit.pullNumbers.includes(1))
    ).toMatchObject({
      status: 'ambiguous',
      signal: 'pull-request-title-mismatch'
    });
  }, 60_000);

  it('includes every change when the previous release is an ancestor (linear history)', async () => {
    const repo = createRepo();
    repo.commit('base.txt', 'base\n', 'Initial commit');
    repo.commit('a.txt', 'A\n', 'Feature A (#1)');
    repo.tag('release-v0.0.1', 'HEAD', 1_800_000_000);
    repo.commit('b.txt', 'B\n', 'Feature B (#2)');
    const head = repo.commit('c.txt', 'C\n', 'Feature C (#3)');
    repo.tag('release-v0.0.2', head, 1_800_100_000);

    const { body, report } = await notesFor(repo, 'release-v0.0.2', head);

    expect(pullNumbersInNotes(body)).toEqual([3, 2]);
    expect(report.commits.every((commit) => commit.status === 'new')).toBe(true);
  }, 60_000);

  it('uses GitHub notes unchanged for the first release', async () => {
    const repo = createRepo();
    repo.commit('base.txt', 'base\n', 'Initial commit');
    const head = repo.commit('a.txt', 'A\n', 'Feature A (#1)');
    repo.tag('release-v0.0.1', head, 1_800_000_000);

    const { body, report } = await notesFor(repo, 'release-v0.0.1', head);

    expect(report.firstRelease).toBe(true);
    expect(body).toBe(synthesizeGeneratedNotes([], URL_BASE, undefined, 'release-v0.0.1'));
  }, 60_000);

  it('reports no new changes when the release commit equals the previous release', async () => {
    const repo = createRepo();
    repo.commit('base.txt', 'base\n', 'Initial commit');
    const head = repo.commit('a.txt', 'A\n', 'Feature A (#1)');
    repo.tag('release-v0.0.1', head, 1_800_000_000);

    const { body } = await notesFor(repo, 'release-v0.0.2', head);

    expect(body).toContain('No new changes since `release-v0.0.1`.');
  }, 60_000);

  it('does not silently drop a re-landed change: the same patch under a new, unrelated PR', async () => {
    const repo = createRepo();
    repo.commit('base.txt', 'base\n', 'Initial commit');
    const base = repo.git('rev-parse', 'HEAD');
    repo.commit('x.txt', 'X\n', 'Add X (#1)');
    repo.git('revert', '--no-edit', 'HEAD');
    repo.git('commit', '-q', '--amend', '-m', 'Revert X (#2)');
    const head = repo.commit('x.txt', 'X\n', 'Reland X (#3)');
    // Release 1 shipped X only as a backport, so the original on main is not its ancestor.
    repo.git('switch', '-q', '-c', 'release-one', base);
    repo.commit('x.txt', 'X\n', 'Add X (#1) (#9)');
    repo.tag('release-v0.0.1', 'HEAD', 1_800_000_000);
    repo.git('switch', '-q', 'main');
    repo.tag('release-v0.0.2', head, 1_800_100_000);

    const outcome = await notesFor(repo, 'release-v0.0.2', head).catch((error: unknown) => error);

    expect(outcome).toBeInstanceOf(ReleaseNotesError);
    const report = (outcome as ReleaseNotesError).report;
    expect(report?.commits.find((commit) => commit.pullNumbers.includes(3))).toMatchObject({
      status: 'ambiguous',
      signal: 'patch-id-other-pull-request'
    });
    // The original and the revert are classified normally: the backport covers #1, the revert is new.
    expect(report?.commits.find((commit) => commit.pullNumbers.includes(1))?.status).toBe('duplicate');
    expect(report?.commits.find((commit) => commit.pullNumbers.includes(2))?.status).toBe('new');
  }, 60_000);

  it('lists only release tags, peeled to their commits, and ignores other tags', () => {
    const repo = createRepo();
    repo.commit('base.txt', 'base\n', 'Initial commit');
    const head = repo.commit('a.txt', 'A\n', 'Feature A (#1)');
    repo.tag('release-v0.0.1', head, 1_800_000_000);
    repo.git('tag', 'v1.0.0', head);
    repo.git('tag', 'release-latest', head);

    expect(repo.history.listReleaseTags()).toEqual([
      { name: 'release-v0.0.1', commit: head, createdAt: 1_800_000_000 }
    ]);
    expect(repo.history.resolveCommit('release-v0.0.1')).toBe(head);
    expect(() => repo.history.resolveCommit('does-not-exist')).toThrow();
  }, 60_000);
});
