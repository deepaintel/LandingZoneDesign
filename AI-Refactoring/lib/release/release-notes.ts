/**
 * Release-note verification for the GitHub Release published after a successful Production
 * deployment (`.github/actions/publish-github-release`).
 *
 * GitHub generates release notes from the commits between the previous tag and the new tag. This
 * repository's release branches are not linear: a hotfix reaches `release/*` as a squash-merged
 * backport, so the released commit has a different SHA than the original commit on `main`. The next
 * release is cut from `main`, so every original commit looks new again and GitHub lists its PR a
 * second time. This module keeps GitHub's generated notes and removes only the PRs whose changes an
 * earlier release already shipped, using commit equivalence rather than PR numbers alone.
 *
 * Everything here is pure: git, the GitHub API and the generated notes are supplied through ports.
 * Any ambiguity throws a `ReleaseNotesError` carrying the full report, so the caller can fail
 * before a misleading release is published.
 *
 * Governed by `.apm/skills/manage-landing-zone-release-workflows/SKILL.md`.
 */

export const RELEASE_TAG_PATTERN = /^release-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** A release tag. The tag only exists after Production succeeded, so it marks a successful release. */
export interface ReleaseTagRecord {
  readonly name: string;
  readonly commit: string;
  /** Tag creation time in epoch seconds (the tagger date of an annotated tag). */
  readonly createdAt: number;
}

export interface HistoryCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly subject: string;
  /** `git patch-id --stable`; absent for merge commits and commits without a diff. */
  readonly patchId: string | undefined;
  /** SHAs named by `(cherry picked from commit <sha>)` trailers in the commit message. */
  readonly cherryPickedFrom: readonly string[];
}

/** A commit that an earlier release shipped but that is not an ancestor of the release being cut. */
export interface ReleasedCommit extends HistoryCommit {
  /** Earlier release tags whose history contains the commit. */
  readonly releaseTags: readonly string[];
}

export interface HistorySource {
  /** Commits reachable from `commit` and not from `previousTag`: the range GitHub reports. */
  rangeCommits(commit: string, previousTag: string): HistoryCommit[];
  /** SHAs reachable from `commit` and not from `tag`. */
  unreachableShas(commit: string, tag: string): ReadonlySet<string>;
  /** Commits reachable from any of `tags` and not from `commit`. */
  releasedCommits(commit: string, tags: readonly string[]): ReleasedCommit[];
}

export type EquivalenceSignal =
  | 'reachable-from-earlier-release'
  | 'patch-id'
  | 'patch-id-other-pull-request'
  | 'cherry-pick-trailer'
  | 'pull-request-and-title'
  | 'pull-request-title-mismatch'
  | 'title-only';

export type CommitStatus = 'new' | 'duplicate' | 'ambiguous';

export interface EquivalenceMatch {
  readonly sha: string;
  readonly subject: string;
  readonly pullNumbers: readonly number[];
  readonly releaseTags: readonly string[];
  readonly signal: EquivalenceSignal;
}

export interface ClassifiedCommit {
  readonly sha: string;
  readonly subject: string;
  readonly pullNumbers: readonly number[];
  readonly status: CommitStatus;
  readonly signal: EquivalenceSignal | undefined;
  readonly reason: string;
  readonly matches: readonly EquivalenceMatch[];
}

export type PullDecisionKind = 'keep' | 'exclude' | 'ambiguous';

export interface PullDecision {
  readonly number: number;
  readonly decision: PullDecisionKind;
  readonly reason: string;
  readonly commits: readonly string[];
}

export interface ReleaseNotesReport {
  readonly releaseTag: string;
  readonly commitSha: string;
  readonly previousTag: string | undefined;
  readonly priorTags: readonly string[];
  readonly firstRelease: boolean;
  readonly rangeCommitCount: number;
  readonly commits: readonly ClassifiedCommit[];
  readonly pulls: readonly PullDecision[];
  readonly excludedLines: readonly string[];
  readonly warnings: readonly string[];
  readonly ambiguities: readonly string[];
}

export class ReleaseNotesError extends Error {
  readonly report: ReleaseNotesReport | undefined;

  constructor(message: string, report?: ReleaseNotesReport) {
    super(message);
    this.name = 'ReleaseNotesError';
    this.report = report;
  }
}

// --------------------------------------------------------------------------------------------
// Release history
// --------------------------------------------------------------------------------------------

export interface PreviousReleaseSelection {
  readonly previous: ReleaseTagRecord | undefined;
  /** Every earlier release: the changes they shipped must not be repeated. */
  readonly prior: readonly ReleaseTagRecord[];
}

type Version = readonly [number, number, number];

function parseVersion(tag: string): Version | undefined {
  const match = RELEASE_TAG_PATTERN.exec(tag);
  if (!match) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(a: Version, b: Version): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/**
 * Chooses the previous successful Production release from the repository's actual release history:
 * the release tag created most recently before the current one. Version order is only a consistency
 * check. When the two orders disagree, or two tags share a creation time, the history is ambiguous
 * and the selection fails rather than guessing.
 */
export function selectPreviousRelease(tags: readonly ReleaseTagRecord[], currentTag: string): PreviousReleaseSelection {
  const currentVersion = parseVersion(currentTag);
  if (!currentVersion) {
    throw new ReleaseNotesError(`Release tag '${currentTag}' is not of the form release-vMAJOR.MINOR.PATCH.`);
  }

  const releaseTags = tags.filter((tag) => parseVersion(tag.name) !== undefined);
  const current = releaseTags.find((tag) => tag.name === currentTag);
  const others = releaseTags.filter((tag) => tag.name !== currentTag);

  if (current && others.some((tag) => tag.createdAt === current.createdAt)) {
    throw new ReleaseNotesError(
      `Release tags were created at the same time as ${currentTag}; the previous release is ambiguous.`
    );
  }
  const prior = current ? others.filter((tag) => tag.createdAt < current.createdAt) : others;
  const byDate = [...prior].sort((a, b) => b.createdAt - a.createdAt);
  const [latest, runnerUp] = byDate;
  if (!latest) {
    return { previous: undefined, prior: [] };
  }
  if (runnerUp && runnerUp.createdAt === latest.createdAt) {
    throw new ReleaseNotesError(
      `Release tags ${latest.name} and ${runnerUp.name} were created at the same time; the previous release is ambiguous.`
    );
  }

  const byVersion = [...prior].sort((a, b) =>
    compareVersions(parseVersion(b.name) ?? [0, 0, 0], parseVersion(a.name) ?? [0, 0, 0])
  );
  const highest = byVersion[0];
  const latestVersion = parseVersion(latest.name) ?? [0, 0, 0];
  if (highest?.name !== latest.name || compareVersions(latestVersion, currentVersion) >= 0) {
    throw new ReleaseNotesError(
      `Release order is inconsistent: ${latest.name} is the most recent earlier release by tag date, ` +
        `but the version order against ${currentTag} disagrees. Resolve the tags before publishing release notes.`
    );
  }
  return { previous: latest, prior: byDate };
}

// --------------------------------------------------------------------------------------------
// Subject parsing
// --------------------------------------------------------------------------------------------

const TRAILING_PULL_REFERENCES = /((?:\s*\(#\d+\))+)\s*$/;
const MERGE_SUBJECT = /^Merge pull request #(\d+)\b/;
const BACKPORT_PREFIX = /^\s*\[?backport\]?\s*[-:–—]?\s*/i;

/**
 * PR numbers that a commit subject claims: the trailing `(#N)` references GitHub appends on squash
 * merge (a backport squash carries the original and the backport number) and the number of a
 * `Merge pull request #N` commit. A `#N` elsewhere in the subject is a mention, not a claim.
 */
export function extractPullNumbers(subject: string): number[] {
  const merge = MERGE_SUBJECT.exec(subject);
  if (merge) {
    return [Number(merge[1])];
  }
  const trailing = TRAILING_PULL_REFERENCES.exec(subject);
  if (!trailing || !trailing[1]) {
    return [];
  }
  return [...trailing[1].matchAll(/\(#(\d+)\)/g)].map((match) => Number(match[1]));
}

/** Subject without PR references and a leading `Backport` marker, for case-insensitive comparison. */
export function normalizeTitle(subject: string): string {
  const withoutReferences = subject.replace(TRAILING_PULL_REFERENCES, '');
  const withoutPrefix = withoutReferences.replace(BACKPORT_PREFIX, '');
  const title = (withoutPrefix.trim() === '' ? withoutReferences : withoutPrefix).replace(/\s+/g, ' ').trim();
  return title.toLowerCase();
}

function shaMatches(a: string, b: string): boolean {
  return a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));
}

// --------------------------------------------------------------------------------------------
// Commit equivalence
// --------------------------------------------------------------------------------------------

export interface RangeCommit extends HistoryCommit {
  readonly pullNumbers: readonly number[];
}

function toMatch(released: ReleasedCommit, signal: EquivalenceSignal): EquivalenceMatch {
  return {
    sha: released.sha,
    subject: released.subject,
    pullNumbers: extractPullNumbers(released.subject),
    releaseTags: released.releaseTags,
    signal
  };
}

/**
 * Decides whether a commit in the release range repeats a change an earlier release shipped.
 *
 * Strong evidence (the same patch, a `cherry-pick -x` trailer, or a shared PR number together with
 * the same normalized title) marks the commit as a duplicate. A shared PR number with a different
 * title, or an equal title with no way to tell the PRs apart, is ambiguous. Anything else is new.
 * A PR number alone never excludes a commit.
 */
export function classifyCommit(
  commit: RangeCommit,
  released: readonly ReleasedCommit[],
  reachableFrom: readonly string[]
): ClassifiedCommit {
  const base = { sha: commit.sha, subject: commit.subject, pullNumbers: commit.pullNumbers };

  if (reachableFrom.length > 0) {
    return {
      ...base,
      status: 'duplicate',
      signal: 'reachable-from-earlier-release',
      reason: `Already part of ${reachableFrom.join(', ')}.`,
      matches: [
        {
          sha: commit.sha,
          subject: commit.subject,
          pullNumbers: commit.pullNumbers,
          releaseTags: reachableFrom,
          signal: 'reachable-from-earlier-release'
        }
      ]
    };
  }

  const strong = new Map<string, EquivalenceMatch>();
  const samePatchOtherPullRequest: EquivalenceMatch[] = [];
  for (const candidate of released) {
    if (
      candidate.cherryPickedFrom.some((sha) => shaMatches(sha, commit.sha)) ||
      commit.cherryPickedFrom.some((sha) => shaMatches(sha, candidate.sha))
    ) {
      strong.set(candidate.sha, toMatch(candidate, 'cherry-pick-trailer'));
    } else if (commit.patchId !== undefined && candidate.patchId === commit.patchId) {
      // The same patch under two different PRs is a backport only if the PRs are related. A
      // re-landed change (revert, then the same patch again) looks identical, so when both
      // commits name PRs and share none, the match is not trusted.
      const candidateNumbers = extractPullNumbers(candidate.subject);
      const unrelated =
        candidateNumbers.length > 0 &&
        commit.pullNumbers.length > 0 &&
        !candidateNumbers.some((number) => commit.pullNumbers.includes(number));
      if (unrelated) {
        samePatchOtherPullRequest.push(toMatch(candidate, 'patch-id-other-pull-request'));
      } else {
        strong.set(candidate.sha, toMatch(candidate, 'patch-id'));
      }
    }
  }

  const title = normalizeTitle(commit.subject);
  const sameNumberAndTitle: EquivalenceMatch[] = [];
  const sameNumberOtherTitle: EquivalenceMatch[] = [];
  const sameTitleUnknownNumber: EquivalenceMatch[] = [];
  for (const candidate of released) {
    if (strong.has(candidate.sha)) {
      continue;
    }
    const candidateNumbers = extractPullNumbers(candidate.subject);
    const shared = candidateNumbers.some((number) => commit.pullNumbers.includes(number));
    const sameTitle = title !== '' && normalizeTitle(candidate.subject) === title;
    if (shared && sameTitle) {
      sameNumberAndTitle.push(toMatch(candidate, 'pull-request-and-title'));
    } else if (shared) {
      sameNumberOtherTitle.push(toMatch(candidate, 'pull-request-title-mismatch'));
    } else if (sameTitle && (candidateNumbers.length === 0 || commit.pullNumbers.length === 0)) {
      sameTitleUnknownNumber.push(toMatch(candidate, 'title-only'));
    }
  }

  const duplicates = [...strong.values(), ...sameNumberAndTitle];
  const [firstDuplicate] = duplicates;
  if (firstDuplicate) {
    return {
      ...base,
      status: 'duplicate',
      signal: firstDuplicate.signal,
      reason: `Equivalent to ${duplicates.map((match) => match.sha.slice(0, 7)).join(', ')} (${firstDuplicate.signal}) in ${[
        ...new Set(duplicates.flatMap((match) => match.releaseTags))
      ].join(', ')}.`,
      matches: duplicates
    };
  }

  const ambiguous = [...samePatchOtherPullRequest, ...sameNumberOtherTitle, ...sameTitleUnknownNumber];
  const [firstAmbiguous] = ambiguous;
  if (firstAmbiguous) {
    const short = firstAmbiguous.sha.slice(0, 7);
    const reasons: Record<string, string> = {
      'patch-id-other-pull-request': `Has the same patch as released commit ${short} but a different, unrelated PR; it may be a re-landed change that must be listed, or a backport under a new number.`,
      'pull-request-title-mismatch': `Shares PR number(s) with released commit ${short} but not its title; cannot tell whether it repeats that change.`,
      'title-only': `Has the same title as released commit ${short} but no PR number or patch to confirm it is the same change.`
    };
    return {
      ...base,
      status: 'ambiguous',
      signal: firstAmbiguous.signal,
      reason: reasons[firstAmbiguous.signal] ?? 'Cannot tell whether this repeats an earlier change.',
      matches: ambiguous
    };
  }

  return {
    ...base,
    status: 'new',
    signal: undefined,
    reason: 'No equivalent change in an earlier release.',
    matches: []
  };
}

// --------------------------------------------------------------------------------------------
// Generated notes
// --------------------------------------------------------------------------------------------

const BULLET = /^\s*[*-]\s/;
const HEADING = /^#{1,6}\s/;
const FOOTER = /^\*\*Full Changelog\*\*/;

/** PR number of a generated-notes bullet, taken from its trailing `/pull/N` link or `#N` reference. */
export function pullNumberOfLine(line: string): number | undefined {
  if (!BULLET.test(line)) {
    return undefined;
  }
  const match = /\/pull\/(\d+)\b[^\d]*$/.exec(line) ?? /(?:^|\s)#(\d+)\s*$/.exec(line);
  return match ? Number(match[1]) : undefined;
}

/**
 * Bullets of the generated notes that name no PR. GitHub's generated entries always do, so such a
 * line means the format is not the one this parser understands and filtering cannot be trusted.
 */
export function unrecognizedNoteEntries(notes: string): string[] {
  return normalizeNewlines(notes)
    .split('\n')
    .filter((line) => BULLET.test(line) && pullNumberOfLine(line) === undefined)
    .map((line) => line.trim());
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

export function pullNumbersInNotes(notes: string): number[] {
  const numbers = normalizeNewlines(notes)
    .split('\n')
    .map(pullNumberOfLine)
    .filter((number): number is number => number !== undefined);
  return [...new Set(numbers)];
}

interface Section {
  heading: string | undefined;
  lines: string[];
}

export interface FilteredNotes {
  readonly body: string;
  readonly removedLines: readonly string[];
}

/**
 * Removes the bullets of excluded PRs from GitHub's generated notes and nothing else. A section
 * that loses all its bullets is dropped (`What's Changed` gets a one-line statement instead), and
 * the `Full Changelog` footer is kept. With nothing to remove the notes are returned unchanged.
 */
export function filterGeneratedNotes(notes: string, excluded: ReadonlySet<number>, previousTag: string): FilteredNotes {
  const text = normalizeNewlines(notes);
  const lines = text.split('\n');
  const footerStart = lines.findIndex((line) => FOOTER.test(line.trim()));
  const bodyLines = footerStart < 0 ? lines : lines.slice(0, footerStart);
  const footer = footerStart < 0 ? [] : lines.slice(footerStart);

  const sections: Section[] = [{ heading: undefined, lines: [] }];
  for (const line of bodyLines) {
    if (HEADING.test(line)) {
      sections.push({ heading: line, lines: [] });
    } else {
      sections[sections.length - 1]?.lines.push(line);
    }
  }

  const removedLines: string[] = [];
  let remainingBullets = 0;
  const kept: Section[] = [];
  for (const section of sections) {
    const bullets = section.lines.filter((line) => BULLET.test(line)).length;
    const lines = section.lines.filter((line) => {
      const number = pullNumberOfLine(line);
      if (number !== undefined && excluded.has(number)) {
        removedLines.push(line.trim());
        return false;
      }
      return true;
    });
    const left = lines.filter((line) => BULLET.test(line)).length;
    remainingBullets += left;
    if (bullets > 0 && left === 0) {
      if (section.heading && /what.?s changed/i.test(section.heading)) {
        kept.push({ heading: section.heading, lines: ['', `No new changes since \`${previousTag}\`.`, ''] });
      }
      continue;
    }
    kept.push({ heading: section.heading, lines });
  }

  if (removedLines.length === 0 && remainingBullets > 0) {
    return { body: text, removedLines };
  }
  if (remainingBullets === 0) {
    const statement = ['', `No new changes since \`${previousTag}\`.`, ''];
    const changed = kept.find((section) => section.heading && /what.?s changed/i.test(section.heading));
    if (!changed) {
      kept.unshift({ heading: "## What's Changed", lines: statement });
    } else if (!changed.lines.some((line) => line.trim() !== '')) {
      changed.lines = statement;
    }
  }

  const rendered = kept.flatMap((section) =>
    section.heading === undefined ? section.lines : [section.heading, ...section.lines]
  );
  const body = [...rendered, '', ...footer]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { body, removedLines };
}

/**
 * A GitHub-style `What's Changed` list built from the range itself, for previews that cannot call
 * GitHub's generator. The last `(#N)` of a squash subject is the PR that merged it.
 */
export function synthesizeGeneratedNotes(
  range: readonly HistoryCommit[],
  pullUrlBase: string,
  previousTag: string | undefined,
  releaseTag: string
): string {
  const bullets: string[] = [];
  for (const commit of range) {
    const numbers = extractPullNumbers(commit.subject);
    const number = numbers[numbers.length - 1];
    if (number !== undefined) {
      const title = commit.subject.replace(TRAILING_PULL_REFERENCES, '').trim();
      bullets.push(`* ${title} by @preview in ${pullUrlBase}/pull/${number}`);
    }
  }
  const lines = ["## What's Changed", ...bullets, ''];
  if (previousTag) {
    lines.push(`**Full Changelog**: ${pullUrlBase}/compare/${previousTag}...${releaseTag}`);
  }
  return lines.join('\n');
}

// --------------------------------------------------------------------------------------------
// Pull request decisions
// --------------------------------------------------------------------------------------------

/**
 * Decides, for every PR in the generated notes, whether to keep or exclude it. A PR is excluded
 * only when every commit that carries it is a duplicate, and kept only when every one is new.
 * A PR without a commit in the range, or with mixed or ambiguous commits, is ambiguous.
 */
export function decidePulls(notePulls: readonly number[], commits: readonly ClassifiedCommit[]): PullDecision[] {
  return notePulls.map((number) => {
    const carriers = commits.filter((commit) => commit.pullNumbers.includes(number));
    const shas = carriers.map((commit) => commit.sha);
    if (carriers.length === 0) {
      return {
        number,
        decision: 'ambiguous',
        reason: `PR #${number} is in the generated notes but no commit in the release range references it.`,
        commits: shas
      };
    }
    if (carriers.every((commit) => commit.status === 'duplicate')) {
      return {
        number,
        decision: 'exclude',
        reason: `Already released: ${carriers.map((commit) => commit.reason).join(' ')}`,
        commits: shas
      };
    }
    if (carriers.every((commit) => commit.status === 'new')) {
      return { number, decision: 'keep', reason: 'New in this release.', commits: shas };
    }
    return {
      number,
      decision: 'ambiguous',
      reason: `PR #${number} has commits that are ${[...new Set(carriers.map((commit) => commit.status))].join(' and ')}.`,
      commits: shas
    };
  });
}

// --------------------------------------------------------------------------------------------
// Orchestration
// --------------------------------------------------------------------------------------------

export interface BuildReleaseNotesInput {
  readonly releaseTag: string;
  readonly commitSha: string;
  readonly tags: readonly ReleaseTagRecord[];
  readonly history: HistorySource;
  /** GitHub's generated notes for `releaseTag`, optionally relative to a previous tag. */
  readonly generateNotes: (previousTag: string | undefined) => Promise<string>;
  /** PR numbers GitHub associates with a commit, to complement the numbers in commit subjects. */
  readonly pullNumbersForCommit?: (sha: string) => Promise<readonly number[]>;
  /**
   * Tags that have a published GitHub Release. Every one must exist in the git history that was
   * read (otherwise tags are missing and the history is incomplete), and a previous release
   * without a Release produces a warning.
   */
  readonly publishedReleaseTags?: readonly string[];
  /** The release tag must exist in git and point at `commitSha`; set when publishing a real release. */
  readonly requireCurrentTag?: boolean;
}

export interface BuildReleaseNotesResult {
  readonly body: string;
  readonly report: ReleaseNotesReport;
}

const PULL_LOOKUP_CONCURRENCY = 5;

async function mapInBatches<T, R>(items: readonly T[], size: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(map))));
  }
  return results;
}

export async function buildReleaseNotes(input: BuildReleaseNotesInput): Promise<BuildReleaseNotesResult> {
  const { releaseTag, commitSha } = input;
  const selection = selectPreviousRelease(input.tags, releaseTag);
  const previous = selection.previous;
  const warnings: string[] = [];

  // A release history that is missing tags would silently look like an earlier release (or a first
  // release) and let already-released PRs through, so incompleteness is an error, never a default.
  const current = input.tags.find((tag) => tag.name === releaseTag);
  if (input.requireCurrentTag && (!current || current.commit !== commitSha)) {
    throw new ReleaseNotesError(
      current
        ? `Release tag ${releaseTag} points to ${current.commit}, not the released commit ${commitSha}.`
        : `Release tag ${releaseTag} is not in the fetched git history, so the release history is incomplete. ` +
            'No release was published.'
    );
  }
  const unseen = (input.publishedReleaseTags ?? []).filter(
    (name) => RELEASE_TAG_PATTERN.test(name) && name !== releaseTag && !input.tags.some((tag) => tag.name === name)
  );
  if (unseen.length > 0) {
    throw new ReleaseNotesError(
      `Published release(s) ${unseen.join(', ')} have no tag in the fetched git history, so the release history is ` +
        'incomplete. No release was published.'
    );
  }

  if (!previous) {
    const body = normalizeNewlines(await input.generateNotes(undefined));
    return {
      body,
      report: {
        releaseTag,
        commitSha,
        previousTag: undefined,
        priorTags: [],
        firstRelease: true,
        rangeCommitCount: 0,
        commits: [],
        pulls: [],
        excludedLines: [],
        warnings: ['First release: no earlier release tag exists, so GitHub’s generated notes are used unchanged.'],
        ambiguities: []
      }
    };
  }

  const priorTags = selection.prior.map((tag) => tag.name);
  if (input.publishedReleaseTags && !input.publishedReleaseTags.includes(previous.name)) {
    warnings.push(
      `${previous.name} has a tag but no published GitHub Release; its changes were deployed but never listed in release notes.`
    );
  }

  const range = input.history.rangeCommits(commitSha, previous.name);
  const unreachable = new Map(priorTags.map((tag) => [tag, input.history.unreachableShas(commitSha, tag)]));
  const released = input.history.releasedCommits(commitSha, priorTags);

  const lookups = input.pullNumbersForCommit
    ? await mapInBatches(
        range,
        PULL_LOOKUP_CONCURRENCY,
        async (commit) => input.pullNumbersForCommit?.(commit.sha) ?? []
      )
    : range.map(() => [] as readonly number[]);

  const classified = range.map((commit, index) => {
    const pullNumbers = [...new Set([...extractPullNumbers(commit.subject), ...(lookups[index] ?? [])])];
    const reachableFrom = priorTags.filter((tag) => unreachable.get(tag)?.has(commit.sha) === false);
    return classifyCommit({ ...commit, pullNumbers }, released, reachableFrom);
  });

  const notes = await input.generateNotes(previous.name);
  const notePulls = pullNumbersInNotes(notes);
  const decisions = decidePulls(notePulls, classified);
  // Filtering is only trustworthy if the notes were understood: every entry names a PR, and a
  // range with numbered new changes cannot yield notes that list none.
  const unparsed = unrecognizedNoteEntries(notes).map(
    (line) => `The generated notes contain an entry without a recognizable PR reference: ${line}`
  );
  const expectedNew = classified.filter((commit) => commit.status === 'new' && commit.pullNumbers.length > 0);
  if (notePulls.length === 0 && unparsed.length === 0 && expectedNew.length > 0) {
    unparsed.push(
      `The generated notes list no PR although ${expectedNew.length} new commit(s) in the range reference one; the notes format was not understood.`
    );
  }
  const ambiguities = [
    ...unparsed,
    ...classified
      .filter((commit) => commit.status === 'ambiguous')
      .map((commit) => `${commit.sha.slice(0, 7)} ${commit.subject}: ${commit.reason}`),
    ...decisions.filter((decision) => decision.decision === 'ambiguous').map((decision) => decision.reason)
  ];

  const excluded = new Set(
    decisions.filter((decision) => decision.decision === 'exclude').map((decision) => decision.number)
  );
  const filtered = filterGeneratedNotes(notes, excluded, previous.name);
  const report: ReleaseNotesReport = {
    releaseTag,
    commitSha,
    previousTag: previous.name,
    priorTags,
    firstRelease: false,
    rangeCommitCount: range.length,
    commits: classified,
    pulls: decisions,
    excludedLines: filtered.removedLines,
    warnings,
    ambiguities
  };

  if (ambiguities.length > 0) {
    throw new ReleaseNotesError(
      `Release notes for ${releaseTag} cannot be verified: ${ambiguities.length} ambiguous ${ambiguities.length === 1 ? 'entry' : 'entries'}. ` +
        'No release was published.',
      report
    );
  }
  return { body: filtered.body, report };
}

// --------------------------------------------------------------------------------------------
// Reporting
// --------------------------------------------------------------------------------------------

export function renderReportMarkdown(report: ReleaseNotesReport): string {
  const lines = [`### Release notes verification: \`${report.releaseTag}\``, ''];
  if (report.firstRelease) {
    lines.push('First release: GitHub’s generated notes are used unchanged.');
  } else {
    const excluded = report.pulls.filter((pull) => pull.decision === 'exclude');
    const kept = report.pulls.filter((pull) => pull.decision === 'keep');
    lines.push(
      `- Previous release: \`${report.previousTag ?? 'none'}\` (earlier releases checked: ${report.priorTags.map((tag) => `\`${tag}\``).join(', ')})`,
      `- Commits in GitHub's range: ${report.rangeCommitCount}`,
      `- PRs kept: ${kept.length}, excluded as already released: ${excluded.length}, ambiguous: ${report.pulls.length - kept.length - excluded.length}`
    );
    if (excluded.length > 0) {
      lines.push('', '| Excluded PR | Reason |', '| --- | --- |');
      for (const pull of excluded) {
        lines.push(`| #${pull.number} | ${pull.reason.replace(/\|/g, '\\|')} |`);
      }
    }
  }
  for (const warning of report.warnings) {
    lines.push('', `> Warning: ${warning}`);
  }
  if (report.ambiguities.length > 0) {
    lines.push('', '**Ambiguous entries (publication stopped):**', ...report.ambiguities.map((entry) => `- ${entry}`));
  }
  return lines.join('\n');
}
