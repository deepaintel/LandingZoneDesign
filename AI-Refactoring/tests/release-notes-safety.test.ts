import { describe, expect, it } from 'vitest';

import {
  ReleaseNotesError,
  buildReleaseNotes,
  classifyCommit,
  extractPullNumbers,
  pullNumberOfLine,
  pullNumbersInNotes,
  unrecognizedNoteEntries,
  type HistoryCommit,
  type HistorySource,
  type RangeCommit,
  type ReleasedCommit
} from '../lib/release/release-notes.js';

/**
 * Safety properties of the release-note filter: it must never drop a legitimate change without
 * strong evidence, and it must refuse to publish when it cannot be sure it understood GitHub's notes.
 */

function range(sha: string, subject: string, extra: Partial<RangeCommit> = {}): RangeCommit {
  return {
    sha,
    parents: [],
    subject,
    patchId: undefined,
    cherryPickedFrom: [],
    pullNumbers: extractPullNumbers(subject),
    ...extra
  };
}

function released(sha: string, subject: string, extra: Partial<ReleasedCommit> = {}): ReleasedCommit {
  return {
    sha,
    parents: [],
    subject,
    patchId: undefined,
    cherryPickedFrom: [],
    releaseTags: ['release-v0.0.1'],
    ...extra
  };
}

describe('patch ID matches are trusted only between related pull requests', () => {
  it('keeps a re-landed change out of the duplicates: same patch, a new unrelated PR number', () => {
    const result = classifyCommit(
      range('c3', 'Reland X (#3)', { patchId: 'PX' }),
      [released('r1', 'Add X (#1) (#9)', { patchId: 'PX' })],
      []
    );
    expect(result).toMatchObject({ status: 'ambiguous', signal: 'patch-id-other-pull-request' });
  });

  it('still treats a backport as a duplicate when the PR numbers are related', () => {
    const result = classifyCommit(
      range('a1', 'Add X (#1)', { patchId: 'PX' }),
      [released('r1', 'Add X (#1) (#9)', { patchId: 'PX' })],
      []
    );
    expect(result).toMatchObject({ status: 'duplicate', signal: 'patch-id' });
  });

  it('still treats a patch match as a duplicate when either side names no PR', () => {
    expect(
      classifyCommit(
        range('a1', 'Shim for ESM', { patchId: 'P' }),
        [released('r1', 'Shim for ESM (#44)', { patchId: 'P' })],
        []
      ).status
    ).toBe('duplicate');
    expect(
      classifyCommit(range('a1', 'Shim (#5)', { patchId: 'P' }), [released('r1', 'Shim for ESM', { patchId: 'P' })], [])
        .status
    ).toBe('duplicate');
  });

  it('lets an explicit cherry-pick trailer decide even when the PR numbers differ', () => {
    const result = classifyCommit(
      range('abcdef1234', 'Fix (#3)', { patchId: 'P' }),
      [released('ffff000', 'Hotfix (#9)', { patchId: 'P', cherryPickedFrom: ['abcdef1'] })],
      []
    );
    expect(result).toMatchObject({ status: 'duplicate', signal: 'cherry-pick-trailer' });
  });
});

describe('an unrecognized generated-notes format never silently disables filtering', () => {
  const tags = [
    { name: 'release-v0.0.1', commit: 'c1', createdAt: 1 },
    { name: 'release-v0.0.2', commit: 'c2', createdAt: 2 }
  ];
  const history = (commits: HistoryCommit[], pool: ReleasedCommit[]): HistorySource => ({
    rangeCommits: () => commits,
    unreachableShas: () => new Set(commits.map((commit) => commit.sha)),
    releasedCommits: () => pool
  });
  const oldCommit: HistoryCommit = { sha: 'a1', parents: [], subject: 'Old (#1)', patchId: 'p1', cherryPickedFrom: [] };
  const newCommit: HistoryCommit = { sha: 'a2', parents: [], subject: 'New (#2)', patchId: 'p2', cherryPickedFrom: [] };
  const pool = [released('b1', 'Old (#1) (#9)', { patchId: 'p1' })];
  const build = (notes: string) =>
    buildReleaseNotes({
      releaseTag: 'release-v0.0.2',
      commitSha: 'x',
      tags,
      history: history([oldCommit, newCommit], pool),
      generateNotes: async () => notes
    });

  it('reads bare #N references as well as links', () => {
    expect(pullNumberOfLine('* Old by @a in #1')).toBe(1);
    expect(pullNumberOfLine('* Old by @a in https://example.invalid/org/repo/pull/1')).toBe(1);
    expect(pullNumbersInNotes('* A in #4\n* B in https://example.invalid/pull/5')).toEqual([4, 5]);
  });

  it('filters correctly when GitHub uses the #N form', async () => {
    const result = await build("## What's Changed\n* Old by @a in #1\n* New by @a in #2");
    expect(result.body).not.toContain('Old');
    expect(result.body).toContain('New');
  });

  it('fails instead of publishing an entry it cannot attribute to a PR', async () => {
    const error = await build("## What's Changed\n* Old (no reference at all)\n* New by @a in #2").catch(
      (caught: unknown) => caught
    );
    expect(error).toBeInstanceOf(ReleaseNotesError);
    expect((error as ReleaseNotesError).report?.ambiguities.join(' ')).toMatch(/without a recognizable PR reference/);
  });

  it('fails when the notes list no PR although the range holds numbered new changes', async () => {
    await expect(build('Some release text in a format nobody expected')).rejects.toThrow(ReleaseNotesError);
  });

  it('finds no unrecognized entry in well-formed notes', () => {
    expect(unrecognizedNoteEntries("## What's Changed\n* A by @a in #1\n\n**Full Changelog**: x")).toEqual([]);
    expect(unrecognizedNoteEntries('* A bullet with nothing')).toEqual(['* A bullet with nothing']);
  });
});

describe('an incomplete release history is an error, never a default', () => {
  const never = (): never => {
    throw new Error('history must not be read');
  };
  const history: HistorySource = { rangeCommits: never, unreachableShas: never, releasedCommits: never };
  const tag = (name: string, createdAt: number, commit = `c-${name}`) => ({ name, commit, createdAt });
  const build = (input: Partial<Parameters<typeof buildReleaseNotes>[0]>) =>
    buildReleaseNotes({
      releaseTag: 'release-v0.0.3',
      commitSha: 'c-release-v0.0.3',
      tags: [],
      history,
      generateNotes: async () => '## raw notes',
      ...input
    });

  it('refuses to publish when the release tag is missing from the fetched history', async () => {
    await expect(build({ requireCurrentTag: true })).rejects.toThrow(/not in the fetched git history/);
  });

  it('refuses to publish when the release tag points at another commit', async () => {
    await expect(
      build({ requireCurrentTag: true, tags: [tag('release-v0.0.3', 3, 'someone-elses-commit')] })
    ).rejects.toThrow(/not the released commit/);
  });

  it('refuses to proceed when a published release has no tag in the fetched history', async () => {
    const error = await build({
      tags: [tag('release-v0.0.2', 2), tag('release-v0.0.3', 3)],
      publishedReleaseTags: ['release-v0.0.1', 'release-v0.0.2']
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReleaseNotesError);
    expect((error as Error).message).toMatch(/release-v0\.0\.1.*incomplete/);
  });

  it('accepts a published list that git fully covers, ignoring the current tag and non-release tags', async () => {
    const result = await build({
      requireCurrentTag: true,
      tags: [tag('release-v0.0.3', 3)],
      publishedReleaseTags: ['release-v0.0.3', 'not-a-release-tag']
    });
    expect(result.report.firstRelease).toBe(true);
  });

  it('still allows a preview without a current tag or a published list', async () => {
    const result = await build({});
    expect(result.report.firstRelease).toBe(true);
  });
});
