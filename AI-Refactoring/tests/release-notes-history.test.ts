import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createSnapshotHistory, type HistorySnapshot } from '../lib/release/history-snapshot.js';
import {
  ReleaseNotesError,
  buildReleaseNotes,
  extractPullNumbers,
  pullNumbersInNotes,
  synthesizeGeneratedNotes
} from '../lib/release/release-notes.js';

/**
 * Replays the real release histories of this repository, recorded with
 * `scripts/release-notes.ts preview --export-history`, so the v0.0.1 / v0.0.2 divergence is checked
 * without needing the tags in the clone. GitHub's generated notes are simulated from the range with
 * the same PR numbers GitHub would list; the real text is not part of the fixture.
 */

const load = (file: string): HistorySnapshot =>
  JSON.parse(readFileSync(`tests/fixtures/${file}`, 'utf8')) as HistorySnapshot;

const URL_BASE = 'https://example.invalid/org/repo';

async function replay(snapshot: HistorySnapshot) {
  const history = createSnapshotHistory(snapshot);
  const generated = synthesizeGeneratedNotes(snapshot.range, URL_BASE, snapshot.previousTag, snapshot.releaseTag);
  const result = await buildReleaseNotes({
    releaseTag: snapshot.releaseTag,
    commitSha: snapshot.commitSha,
    tags: snapshot.tags,
    history,
    generateNotes: async () => generated
  });
  return { generated, ...result };
}

// PRs that v0.0.2 genuinely adds over v0.0.1. #86 is the backport PR of #85.
const NEW_IN_V0_0_2 = [86, 84, 83, 79, 82, 78, 69, 68, 39, 36, 33, 38];

describe('release-v0.0.2 against release-v0.0.1 (diverged histories)', () => {
  const snapshot = load('release-history-v0.0.2.json');

  it('records the divergence this fix exists for', () => {
    expect(snapshot.previousTag).toBe('release-v0.0.1');
    expect(snapshot.range).toHaveLength(45);
    // v0.0.1 holds commits that v0.0.2 does not: its history is not an ancestor of v0.0.2.
    expect(snapshot.released.length).toBeGreaterThan(30);
  });

  it('lists every PR GitHub would list before filtering', async () => {
    const { generated } = await replay(snapshot);
    expect(pullNumbersInNotes(generated).length).toBe(43);
  });

  it('keeps exactly the legitimately new changes and excludes everything v0.0.1 shipped', async () => {
    const { body, report } = await replay(snapshot);
    expect(new Set(pullNumbersInNotes(body))).toEqual(new Set(NEW_IN_V0_0_2));
    expect(
      report.pulls
        .filter((pull) => pull.decision === 'keep')
        .map((pull) => pull.number)
        .sort((a, b) => a - b)
    ).toEqual([...NEW_IN_V0_0_2].sort((a, b) => a - b));
    expect(report.pulls.filter((pull) => pull.decision === 'exclude')).toHaveLength(31);
    expect(report.ambiguities).toEqual([]);
  });

  it('classifies all 33 duplicate commits and the 12 new ones', async () => {
    const { report } = await replay(snapshot);
    const count = (status: string) => report.commits.filter((commit) => commit.status === status).length;
    expect(count('duplicate')).toBe(33);
    expect(count('new')).toBe(12);
    expect(count('ambiguous')).toBe(0);
  });

  it('uses the patch ID for 28 commits and PR number plus title for the five whose patch differs', async () => {
    const { report } = await replay(snapshot);
    const bySignal = (signal: string) => report.commits.filter((commit) => commit.signal === signal);
    expect(bySignal('patch-id')).toHaveLength(28);
    expect(
      bySignal('pull-request-and-title')
        .map((commit) => extractPullNumbers(commit.subject)[0])
        .sort((a, b) => (a ?? 0) - (b ?? 0))
    ).toEqual([42, 56, 70, 71, 80]);
  });

  it('keeps original and backport traceability for excluded changes', async () => {
    const { report } = await replay(snapshot);
    const scpCompatibility = report.commits.find((commit) => commit.pullNumbers.includes(31));
    expect(scpCompatibility?.status).toBe('duplicate');
    expect(scpCompatibility?.matches[0]).toMatchObject({ pullNumbers: [31, 32], releaseTags: ['release-v0.0.1'] });
    const combined = report.commits.find((commit) => commit.pullNumbers.includes(80));
    expect(combined?.matches[0]).toMatchObject({ pullNumbers: [80, 81], signal: 'pull-request-and-title' });
  });

  it('keeps a backport PR whose original is not yet released: #85 ships as #86', async () => {
    const { body } = await replay(snapshot);
    expect(pullNumbersInNotes(body)).toContain(86);
    expect(pullNumbersInNotes(body)).not.toContain(85);
  });

  it('preserves the heading and the Full Changelog link', async () => {
    const { body } = await replay(snapshot);
    expect(body.startsWith("## What's Changed")).toBe(true);
    expect(body).toContain(`**Full Changelog**: ${URL_BASE}/compare/release-v0.0.1...release-v0.0.2`);
  });

  it('fails closed instead of publishing when the generated notes name an unexplained PR', async () => {
    const history = createSnapshotHistory(snapshot);
    const generated = `${synthesizeGeneratedNotes(snapshot.range, URL_BASE, snapshot.previousTag, snapshot.releaseTag)}\n* Surprise by @x in ${URL_BASE}/pull/9999`;
    await expect(
      buildReleaseNotes({
        releaseTag: snapshot.releaseTag,
        commitSha: snapshot.commitSha,
        tags: snapshot.tags,
        history,
        generateNotes: async () => generated
      })
    ).rejects.toThrow(ReleaseNotesError);
  });
});

describe('release-v0.0.3 previewed on main after v0.0.2', () => {
  const snapshot = load('release-history-v0.0.3-preview.json');

  it('checks both earlier releases and picks release-v0.0.2 as the previous one', () => {
    expect(snapshot.previousTag).toBe('release-v0.0.2');
    expect(snapshot.tags.map((tag) => tag.name).sort()).toEqual(['release-v0.0.1', 'release-v0.0.2']);
  });

  it('excludes #85 (shipped in v0.0.2 as backport #86) and keeps #87', async () => {
    const { body, report } = await replay(snapshot);
    expect(pullNumbersInNotes(body)).toEqual([87]);
    expect(report.pulls.find((pull) => pull.number === 85)).toMatchObject({ decision: 'exclude' });
    expect(report.commits.find((commit) => commit.pullNumbers.includes(85))?.matches[0]).toMatchObject({
      pullNumbers: [85, 86],
      releaseTags: ['release-v0.0.2']
    });
  });
});
