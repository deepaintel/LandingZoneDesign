/**
 * Serializable snapshot of the git history that release-note verification reads. A snapshot lets
 * the real v0.0.1 and v0.0.2 histories be replayed offline (tests, CI) without the tags being
 * present in the clone. Captured with `scripts/release-notes.ts preview --export-history`.
 */

import {
  selectPreviousRelease,
  type HistoryCommit,
  type HistorySource,
  type ReleasedCommit,
  type ReleaseTagRecord
} from './release-notes.js';

export interface HistorySnapshot {
  readonly schemaVersion: 1;
  readonly releaseTag: string;
  readonly commitSha: string;
  readonly tags: readonly ReleaseTagRecord[];
  readonly previousTag: string | undefined;
  readonly range: readonly HistoryCommit[];
  /** For each earlier release tag, the SHAs reachable from the release commit and not from the tag. */
  readonly unreachable: Readonly<Record<string, readonly string[]>>;
  readonly released: readonly ReleasedCommit[];
}

export function captureSnapshot(
  history: HistorySource,
  tags: readonly ReleaseTagRecord[],
  releaseTag: string,
  commitSha: string
): HistorySnapshot {
  const { previous, prior } = selectPreviousRelease(tags, releaseTag);
  const priorTags = prior.map((tag) => tag.name);
  return {
    schemaVersion: 1,
    releaseTag,
    commitSha,
    tags,
    previousTag: previous?.name,
    range: previous ? history.rangeCommits(commitSha, previous.name) : [],
    unreachable: Object.fromEntries(priorTags.map((tag) => [tag, [...history.unreachableShas(commitSha, tag)]])),
    released: history.releasedCommits(commitSha, priorTags)
  };
}

export function createSnapshotHistory(snapshot: HistorySnapshot): HistorySource {
  return {
    rangeCommits: (commit, previousTag) => {
      if (commit !== snapshot.commitSha || previousTag !== snapshot.previousTag) {
        throw new Error(`Snapshot does not hold the range ${previousTag}..${commit}`);
      }
      return [...snapshot.range];
    },
    unreachableShas: (commit, tag) => {
      const shas = snapshot.unreachable[tag];
      if (commit !== snapshot.commitSha || !shas) {
        throw new Error(`Snapshot does not hold the history of ${tag}`);
      }
      return new Set(shas);
    },
    releasedCommits: (commit) => {
      if (commit !== snapshot.commitSha) {
        throw new Error(`Snapshot does not hold the released commits for ${commit}`);
      }
      return [...snapshot.released];
    }
  };
}
