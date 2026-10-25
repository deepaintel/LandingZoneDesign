import { describe, expect, it, vi } from 'vitest';

import {
  RELEASE_TAG_PATTERN,
  ReleaseNotesError,
  buildReleaseNotes,
  classifyCommit,
  decidePulls,
  extractPullNumbers,
  filterGeneratedNotes,
  normalizeTitle,
  pullNumbersInNotes,
  renderReportMarkdown,
  selectPreviousRelease,
  synthesizeGeneratedNotes,
  type HistoryCommit,
  type HistorySource,
  type RangeCommit,
  type ReleasedCommit,
  type ReleaseTagRecord
} from '../lib/release/release-notes.js';

const URL_BASE = 'https://example.invalid/org/repo';

function commit(sha: string, subject: string, extra: Partial<HistoryCommit> = {}): HistoryCommit {
  return { sha, parents: [], subject, patchId: undefined, cherryPickedFrom: [], ...extra };
}

function released(sha: string, subject: string, extra: Partial<ReleasedCommit> = {}): ReleasedCommit {
  return { ...commit(sha, subject), releaseTags: ['release-v0.0.1'], ...extra };
}

function range(sha: string, subject: string, extra: Partial<RangeCommit> = {}): RangeCommit {
  return { ...commit(sha, subject), pullNumbers: extractPullNumbers(subject), ...extra };
}

const tag = (name: string, createdAt: number): ReleaseTagRecord => ({ name, createdAt, commit: `c-${name}` });

describe('extractPullNumbers', () => {
  it('reads the trailing references of a squash and a backport squash', () => {
    expect(extractPullNumbers('Add thing (#12)')).toEqual([12]);
    expect(extractPullNumbers('Add thing (#31) (#32)')).toEqual([31, 32]);
    expect(extractPullNumbers('Add thing (#31)   ')).toEqual([31]);
  });

  it('reads a merge-commit subject', () => {
    expect(extractPullNumbers('Merge pull request #10 from org/backport/x')).toEqual([10]);
  });

  it('ignores mentions that are not trailing references', () => {
    expect(extractPullNumbers('Follow-up to (#12) in the docs')).toEqual([]);
    expect(extractPullNumbers('Revert "Add thing (#31)" (#40)')).toEqual([40]);
    expect(extractPullNumbers('No reference')).toEqual([]);
  });
});

describe('normalizeTitle', () => {
  it('drops PR references, a Backport marker, case and spacing', () => {
    expect(normalizeTitle('Backport - Scim  Sync (#41)')).toBe('scim sync');
    expect(normalizeTitle('[Backport] Fix It (#5) (#6)')).toBe('fix it');
    expect(normalizeTitle('Fix it')).toBe('fix it');
  });

  it('keeps the title when removing the prefix would leave nothing', () => {
    expect(normalizeTitle('Backport (#9)')).toBe('backport');
  });
});

describe('selectPreviousRelease', () => {
  it('returns no previous release for the first release', () => {
    expect(selectPreviousRelease([], 'release-v0.0.1')).toEqual({ previous: undefined, prior: [] });
    expect(selectPreviousRelease([tag('release-v0.0.1', 100)], 'release-v0.0.1').previous).toBeUndefined();
  });

  it('picks the release created most recently before the current tag', () => {
    const tags = [tag('release-v0.0.1', 100), tag('release-v0.0.2', 200), tag('release-v0.0.3', 300)];
    const selection = selectPreviousRelease(tags, 'release-v0.0.3');
    expect(selection.previous?.name).toBe('release-v0.0.2');
    expect(selection.prior.map((entry) => entry.name)).toEqual(['release-v0.0.2', 'release-v0.0.1']);
  });

  it('ignores tags created after the current one and tags that are not release tags', () => {
    const tags = [
      tag('release-v0.0.1', 100),
      tag('release-v0.0.2', 200),
      tag('release-v0.0.3', 300),
      tag('v9.9.9', 400)
    ];
    expect(selectPreviousRelease(tags, 'release-v0.0.2').previous?.name).toBe('release-v0.0.1');
  });

  it('selects the latest earlier release when the current tag does not exist yet', () => {
    const tags = [tag('release-v0.0.1', 100), tag('release-v0.0.2', 200)];
    expect(selectPreviousRelease(tags, 'release-v0.0.3').previous?.name).toBe('release-v0.0.2');
  });

  it('does not rely on version order alone', () => {
    // 0.1.0 was released after 0.0.9 was cut; by date the previous release of 0.2.0 is 0.1.0.
    const tags = [tag('release-v0.0.9', 100), tag('release-v0.1.0', 200), tag('release-v0.2.0', 300)];
    expect(selectPreviousRelease(tags, 'release-v0.2.0').previous?.name).toBe('release-v0.1.0');
  });

  it('fails closed when tag date order and version order disagree', () => {
    const tags = [tag('release-v0.1.0', 100), tag('release-v0.0.9', 200), tag('release-v0.2.0', 300)];
    expect(() => selectPreviousRelease(tags, 'release-v0.2.0')).toThrow(/inconsistent/);
  });

  it('fails closed when the latest earlier release is not older than the current version', () => {
    const tags = [tag('release-v0.0.5', 100), tag('release-v0.0.3', 200)];
    expect(() => selectPreviousRelease(tags, 'release-v0.0.3')).toThrow(ReleaseNotesError);
  });

  it('fails closed on tags created at the same time', () => {
    const tied = [tag('release-v0.0.1', 100), tag('release-v0.0.2', 100)];
    expect(() => selectPreviousRelease(tied, 'release-v0.0.3')).toThrow(/same time/);
    const withCurrent = [tag('release-v0.0.1', 200), tag('release-v0.0.2', 200)];
    expect(() => selectPreviousRelease(withCurrent, 'release-v0.0.2')).toThrow(/same time/);
  });

  it('rejects a current tag that is not a release tag', () => {
    expect(() => selectPreviousRelease([], 'v1.0.0')).toThrow(/release-vMAJOR/);
    expect(RELEASE_TAG_PATTERN.test('release-v1.2.3')).toBe(true);
    expect(RELEASE_TAG_PATTERN.test('release-v01.2.3')).toBe(false);
  });
});

describe('classifyCommit', () => {
  it('treats a commit already reachable from an earlier release as a duplicate', () => {
    const result = classifyCommit(range('a1', 'Thing (#1)'), [], ['release-v0.0.1']);
    expect(result).toMatchObject({ status: 'duplicate', signal: 'reachable-from-earlier-release' });
  });

  it('matches a backport squash by patch ID even when the subject differs, if the PRs are related', () => {
    const result = classifyCommit(
      range('a1', 'Original title (#1)', { patchId: 'p1' }),
      [released('b1', 'Completely different title (#1) (#9)', { patchId: 'p1' })],
      []
    );
    expect(result).toMatchObject({ status: 'duplicate', signal: 'patch-id' });
    expect(result.matches[0]).toMatchObject({ sha: 'b1', pullNumbers: [1, 9], releaseTags: ['release-v0.0.1'] });
  });

  it('matches a cherry-pick -x trailer in either direction', () => {
    const forward = classifyCommit(
      range('abcdef1234', 'Fix (#1)'),
      [released('ffff000', 'Backport fix (#9)', { cherryPickedFrom: ['abcdef1'] })],
      []
    );
    expect(forward).toMatchObject({ status: 'duplicate', signal: 'cherry-pick-trailer' });
    const reverse = classifyCommit(
      range('a123456789', 'Fix (#2)', { cherryPickedFrom: ['ffff000'] }),
      [released('ffff0001234', 'Hotfix (#9)')],
      []
    );
    expect(reverse).toMatchObject({ status: 'duplicate', signal: 'cherry-pick-trailer' });
  });

  it('matches a shared PR number together with the same normalized title', () => {
    const result = classifyCommit(
      range('a1', 'Combined deployment workflow (#80)'),
      [released('b1', 'Combined deployment workflow (#80) (#81)', { patchId: 'other' })],
      []
    );
    expect(result).toMatchObject({ status: 'duplicate', signal: 'pull-request-and-title' });
  });

  it('does not exclude on a PR number alone: a shared number with another title is ambiguous', () => {
    const result = classifyCommit(
      range('a1', 'Reworked deployment (#80)'),
      [released('b1', 'Combined deployment workflow (#80) (#81)')],
      []
    );
    expect(result).toMatchObject({ status: 'ambiguous', signal: 'pull-request-title-mismatch' });
  });

  it('flags an equal title as ambiguous when a PR number is missing on either side', () => {
    expect(
      classifyCommit(range('a1', 'Update dependencies'), [released('b1', 'Update dependencies (#7)')], [])
    ).toMatchObject({
      status: 'ambiguous',
      signal: 'title-only'
    });
    expect(
      classifyCommit(range('a1', 'Update dependencies (#8)'), [released('b1', 'Update dependencies')], [])
    ).toMatchObject({
      status: 'ambiguous',
      signal: 'title-only'
    });
  });

  it('keeps two different PRs with the same title as new', () => {
    const result = classifyCommit(
      range('a1', 'Update dependencies (#8)', { patchId: 'p8' }),
      [released('b1', 'Update dependencies (#7)', { patchId: 'p7' })],
      []
    );
    expect(result.status).toBe('new');
  });

  it('keeps an unrelated commit as new', () => {
    const result = classifyCommit(
      range('a1', 'Brand new work (#20)', { patchId: 'p20' }),
      [released('b1', 'Old work (#2)', { patchId: 'p2' })],
      []
    );
    expect(result).toMatchObject({ status: 'new', matches: [] });
  });

  it('never matches a commit without a patch ID on a missing patch ID', () => {
    const result = classifyCommit(range('a1', 'Merge branch main'), [released('b1', 'Other merge')], []);
    expect(result.status).toBe('new');
  });
});

describe('decidePulls', () => {
  const commits = [
    {
      ...classifyCommit(
        range('a1', 'Old (#1)', { patchId: 'p' }),
        [released('b1', 'Old (#1) (#9)', { patchId: 'p' })],
        []
      )
    },
    { ...classifyCommit(range('a2', 'New (#2)'), [], []) }
  ];

  it('excludes a PR whose commits are all duplicates and keeps one whose commits are all new', () => {
    const decisions = decidePulls([1, 2], commits);
    expect(decisions.map((entry) => [entry.number, entry.decision])).toEqual([
      [1, 'exclude'],
      [2, 'keep']
    ]);
  });

  it('marks a PR without a carrying commit as ambiguous', () => {
    expect(decidePulls([99], commits)[0]).toMatchObject({ decision: 'ambiguous' });
  });

  it('marks a PR with duplicate and new commits as ambiguous', () => {
    const mixed = [
      classifyCommit(
        range('a1', 'Part one (#5)', { patchId: 'p' }),
        [released('b1', 'Part one (#5)', { patchId: 'p' })],
        []
      ),
      classifyCommit(range('a2', 'Part two (#5)'), [], [])
    ];
    expect(decidePulls([5], mixed)[0]).toMatchObject({ decision: 'ambiguous' });
  });
});

const GENERATED = [
  "## What's Changed",
  '* Old feature by @alice in https://example.invalid/org/repo/pull/1',
  '* New feature by @bob in https://example.invalid/org/repo/pull/2',
  '* Other new by @bob in https://example.invalid/org/repo/pull/3',
  '',
  '## New Contributors',
  '* @alice made their first contribution in https://example.invalid/org/repo/pull/1',
  '',
  '**Full Changelog**: https://example.invalid/org/repo/compare/release-v0.0.1...release-v0.0.2'
].join('\n');

describe('filterGeneratedNotes', () => {
  it('removes only the excluded bullets, drops a section that became empty and keeps the footer', () => {
    const { body, removedLines } = filterGeneratedNotes(GENERATED, new Set([1]), 'release-v0.0.1');
    expect(removedLines).toHaveLength(2);
    expect(body).toBe(
      [
        "## What's Changed",
        '* New feature by @bob in https://example.invalid/org/repo/pull/2',
        '* Other new by @bob in https://example.invalid/org/repo/pull/3',
        '',
        '**Full Changelog**: https://example.invalid/org/repo/compare/release-v0.0.1...release-v0.0.2'
      ].join('\n')
    );
  });

  it('returns the notes unchanged when nothing is excluded', () => {
    expect(filterGeneratedNotes(GENERATED, new Set(), 'release-v0.0.1').body).toBe(GENERATED);
  });

  it('normalizes CRLF line endings', () => {
    expect(filterGeneratedNotes(GENERATED.replace(/\n/g, '\r\n'), new Set(), 'release-v0.0.1').body).toBe(GENERATED);
  });

  it('states that nothing is new when every PR is excluded', () => {
    const { body } = filterGeneratedNotes(GENERATED, new Set([1, 2, 3]), 'release-v0.0.1');
    expect(body).toContain("## What's Changed");
    expect(body).toContain('No new changes since `release-v0.0.1`.');
    expect(body).not.toContain('New Contributors');
    expect(body).toContain('**Full Changelog**');
  });

  it('adds the statement when GitHub generated no list at all', () => {
    const { body } = filterGeneratedNotes(
      '**Full Changelog**: https://example.invalid/compare/a...b',
      new Set(),
      'release-v0.0.1'
    );
    expect(body).toBe(
      "## What's Changed\n\nNo new changes since `release-v0.0.1`.\n\n**Full Changelog**: https://example.invalid/compare/a...b"
    );
  });

  it('adds the statement under an empty What’s Changed heading', () => {
    const notes = "## What's Changed\n\n**Full Changelog**: https://example.invalid/compare/a...b";
    expect(filterGeneratedNotes(notes, new Set(), 'release-v0.0.1').body).toBe(
      "## What's Changed\n\nNo new changes since `release-v0.0.1`.\n\n**Full Changelog**: https://example.invalid/compare/a...b"
    );
  });

  it('keeps bullets that are not PR links', () => {
    const notes = "## What's Changed\n* A manual note\n* Old by @a in https://example.invalid/org/repo/pull/1";
    expect(filterGeneratedNotes(notes, new Set([1]), 'release-v0.0.1').body).toBe("## What's Changed\n* A manual note");
  });

  it('lists the PRs of the notes once', () => {
    expect(pullNumbersInNotes(GENERATED)).toEqual([1, 2, 3]);
  });
});

describe('synthesizeGeneratedNotes', () => {
  it('lists the last PR number of each squash subject and skips commits without one', () => {
    const notes = synthesizeGeneratedNotes(
      [commit('a', 'Thing (#85) (#86)'), commit('b', 'Direct commit'), commit('c', 'Other (#4)')],
      URL_BASE,
      'release-v0.0.1',
      'release-v0.0.2'
    );
    expect(pullNumbersInNotes(notes)).toEqual([86, 4]);
    expect(notes).toContain(`${URL_BASE}/compare/release-v0.0.1...release-v0.0.2`);
  });
});

function fakeHistory(options: {
  range: HistoryCommit[];
  released: ReleasedCommit[];
  unreachable?: Record<string, string[]>;
}): HistorySource {
  return {
    rangeCommits: () => options.range,
    unreachableShas: (_commit, tagName) =>
      new Set(options.unreachable?.[tagName] ?? options.range.map((entry) => entry.sha)),
    releasedCommits: () => options.released
  };
}

const TAGS = [tag('release-v0.0.1', 100), tag('release-v0.0.2', 200)];

describe('buildReleaseNotes', () => {
  const history = fakeHistory({
    range: [
      commit('a1', 'Old feature (#1)', { patchId: 'p1' }),
      commit('a2', 'New feature (#2)', { patchId: 'p2' }),
      commit('a3', 'Other new (#3)', { patchId: 'p3' })
    ],
    released: [released('b1', 'Old feature (#1) (#9)', { patchId: 'p1' })]
  });

  it('excludes a PR released earlier, keeps new ones and reports the traceability', async () => {
    const generateNotes = vi.fn(async () => GENERATED);
    const result = await buildReleaseNotes({
      releaseTag: 'release-v0.0.2',
      commitSha: 'x',
      tags: TAGS,
      history,
      generateNotes
    });
    expect(generateNotes).toHaveBeenCalledWith('release-v0.0.1');
    expect(result.body).not.toContain('/pull/1');
    expect(result.body).toContain('/pull/2');
    expect(result.body).toContain('/pull/3');
    expect(result.report.previousTag).toBe('release-v0.0.1');
    expect(result.report.pulls.find((pull) => pull.number === 1)).toMatchObject({ decision: 'exclude' });
    expect(result.report.commits[0]?.matches[0]).toMatchObject({ sha: 'b1', pullNumbers: [1, 9], signal: 'patch-id' });
    expect(renderReportMarkdown(result.report)).toContain('| #1 |');
  });

  it('uses GitHub as given for the first release without reading history', async () => {
    const generateNotes = vi.fn(async () => 'Notes\r\nbody');
    const guarded: HistorySource = {
      rangeCommits: () => {
        throw new Error('history must not be read');
      },
      unreachableShas: () => {
        throw new Error('history must not be read');
      },
      releasedCommits: () => {
        throw new Error('history must not be read');
      }
    };
    const result = await buildReleaseNotes({
      releaseTag: 'release-v0.0.1',
      commitSha: 'x',
      tags: [],
      history: guarded,
      generateNotes
    });
    expect(generateNotes).toHaveBeenCalledWith(undefined);
    expect(result.body).toBe('Notes\nbody');
    expect(result.report.firstRelease).toBe(true);
  });

  it('reports no new changes when the range is empty', async () => {
    const empty = fakeHistory({ range: [], released: [] });
    const result = await buildReleaseNotes({
      releaseTag: 'release-v0.0.2',
      commitSha: 'x',
      tags: TAGS,
      history: empty,
      generateNotes: async () => '**Full Changelog**: https://example.invalid/compare/a...b'
    });
    expect(result.body).toContain('No new changes since `release-v0.0.1`.');
  });

  it('treats a commit already reachable from an older release as released', async () => {
    const tags = [tag('release-v0.0.1', 100), tag('release-v0.0.2', 200), tag('release-v0.0.3', 300)];
    const layered = fakeHistory({
      range: [commit('a1', 'In v1 only (#1)'), commit('a2', 'Fresh (#2)')],
      released: [],
      // a1 is not in the set of commits unreachable from release-v0.0.1: v0.0.1 already contains it.
      unreachable: { 'release-v0.0.1': ['a2'], 'release-v0.0.2': ['a1', 'a2'] }
    });
    const result = await buildReleaseNotes({
      releaseTag: 'release-v0.0.3',
      commitSha: 'x',
      tags,
      history: layered,
      generateNotes: async () =>
        [
          "## What's Changed",
          '* In v1 only by @a in https://example.invalid/org/repo/pull/1',
          '* Fresh by @a in https://example.invalid/org/repo/pull/2'
        ].join('\n')
    });
    expect(result.report.commits.find((entry) => entry.sha === 'a1')).toMatchObject({
      status: 'duplicate',
      signal: 'reachable-from-earlier-release'
    });
    expect(result.body).not.toContain('/pull/1');
  });

  it('maps a commit to its PR through the GitHub association when the subject has no number', async () => {
    const squashless = fakeHistory({
      range: [commit('a2', 'Edited title with no reference', { patchId: 'p2' })],
      released: []
    });
    const result = await buildReleaseNotes({
      releaseTag: 'release-v0.0.2',
      commitSha: 'x',
      tags: TAGS,
      history: squashless,
      generateNotes: async () => "## What's Changed\n* Edited title by @a in https://example.invalid/org/repo/pull/2",
      pullNumbersForCommit: async () => [2]
    });
    expect(result.report.pulls[0]).toMatchObject({ number: 2, decision: 'keep' });
  });

  it('warns when the previous release has a tag but no published Release', async () => {
    const result = await buildReleaseNotes({
      releaseTag: 'release-v0.0.2',
      commitSha: 'x',
      tags: TAGS,
      history,
      generateNotes: async () => GENERATED,
      publishedReleaseTags: []
    });
    expect(result.report.warnings.join(' ')).toMatch(/no published GitHub Release/);
  });

  it('fails without a body when a commit is ambiguous', async () => {
    const ambiguous = fakeHistory({
      range: [commit('a1', 'Reworked (#1)', { patchId: 'new' })],
      released: [released('b1', 'Original (#1) (#9)', { patchId: 'old' })]
    });
    const error = await buildReleaseNotes({
      releaseTag: 'release-v0.0.2',
      commitSha: 'x',
      tags: TAGS,
      history: ambiguous,
      generateNotes: async () => GENERATED
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReleaseNotesError);
    expect((error as ReleaseNotesError).report?.ambiguities.length).toBeGreaterThan(0);
    expect((error as ReleaseNotesError).message).toMatch(/No release was published/);
  });

  it('fails when the generated notes list a PR that no commit in the range explains', async () => {
    await expect(
      buildReleaseNotes({
        releaseTag: 'release-v0.0.2',
        commitSha: 'x',
        tags: TAGS,
        history,
        generateNotes: async () => `${GENERATED}\n* Mystery by @x in https://example.invalid/org/repo/pull/77`
      })
    ).rejects.toThrow(ReleaseNotesError);
  });

  it('propagates a failure of the notes generator', async () => {
    await expect(
      buildReleaseNotes({
        releaseTag: 'release-v0.0.2',
        commitSha: 'x',
        tags: TAGS,
        history,
        generateNotes: async () => {
          throw new Error('generator unavailable');
        }
      })
    ).rejects.toThrow('generator unavailable');
  });
});
