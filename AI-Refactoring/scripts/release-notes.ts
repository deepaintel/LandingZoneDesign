#!/usr/bin/env tsx
/**
 * Builds the GitHub Release notes for a release tag and removes the PRs that an earlier release
 * already shipped. GitHub's generated notes are kept as they are; only the bullets of PRs whose
 * changes are already released are dropped, using commit equivalence (patch ID, cherry-pick
 * trailer, or PR number together with title) over the repository's real release-tag history.
 *
 * Governed by `.apm/skills/manage-landing-zone-release-workflows/SKILL.md`. Nothing here
 * creates, edits or deletes a tag, a release or a branch.
 *
 * Usage:
 *   release-notes.ts publish --release-tag <tag> --commit-sha <sha> --output-file <path>
 *       [--report-file <path>] [--fetch-history]
 *     Used by the `publish-github-release` action. Needs GH_TOKEN, GITHUB_REPOSITORY and
 *     GITHUB_API_URL. Asks GitHub to generate the notes, verifies them, and writes the final body.
 *     Exits non-zero, without writing a body, when the notes cannot be verified.
 *
 *   release-notes.ts preview --release-tag <tag> [--commit-sha <sha> | --target-ref <ref>]
 *       [--output-file <path>] [--report-file <path>] [--generated-notes-file <path>]
 *       [--github] [--fetch-history] [--pull-url-base <url>] [--export-history <path>]
 *     Non-publishing. Works for a tag that does not exist yet (for example the next release,
 *     previewed against `main`). Without --generated-notes-file it builds a GitHub-style list from
 *     the range instead of calling GitHub's generator. --github adds PR associations and the list
 *     of published releases from the GitHub API (read-only).
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { createGitHistory, createGitRunner, type GitHistory } from '../lib/release/git-history.js';
import { createGitHubApi, type GitHubApi } from '../lib/release/github-api.js';
import { captureSnapshot } from '../lib/release/history-snapshot.js';
import {
  ReleaseNotesError,
  buildReleaseNotes,
  renderReportMarkdown,
  synthesizeGeneratedNotes,
  type ReleaseNotesReport,
  type ReleaseTagRecord
} from '../lib/release/release-notes.js';

const MODES = ['publish', 'preview'] as const;
type Mode = (typeof MODES)[number];

export interface CliOptions {
  readonly mode: Mode;
  readonly releaseTag: string;
  readonly commitSha: string | undefined;
  readonly targetRef: string | undefined;
  readonly outputFile: string | undefined;
  readonly reportFile: string | undefined;
  readonly generatedNotesFile: string | undefined;
  readonly exportHistory: string | undefined;
  readonly pullUrlBase: string | undefined;
  readonly fetchHistory: boolean;
  readonly github: boolean;
}

const VALUE_FLAGS = new Set([
  '--release-tag',
  '--commit-sha',
  '--target-ref',
  '--output-file',
  '--report-file',
  '--generated-notes-file',
  '--export-history',
  '--pull-url-base'
]);
const BOOLEAN_FLAGS = new Set(['--fetch-history', '--github']);

export function parseCliOptions(argv: readonly string[]): CliOptions {
  const [mode, ...rest] = argv;
  if (!MODES.includes(mode as Mode)) {
    throw new Error(`Usage: release-notes.ts <${MODES.join('|')}> --release-tag <tag> ...`);
  }
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index] ?? '';
    if (BOOLEAN_FLAGS.has(flag)) {
      flags.add(flag);
    } else if (VALUE_FLAGS.has(flag)) {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${flag} needs a value`);
      }
      values.set(flag, value);
      index += 1;
    } else {
      throw new Error(`Unknown argument '${flag}'`);
    }
  }
  const releaseTag = values.get('--release-tag');
  if (!releaseTag) {
    throw new Error('--release-tag is required');
  }
  const options: CliOptions = {
    mode: mode as Mode,
    releaseTag,
    commitSha: values.get('--commit-sha'),
    targetRef: values.get('--target-ref'),
    outputFile: values.get('--output-file'),
    reportFile: values.get('--report-file'),
    generatedNotesFile: values.get('--generated-notes-file'),
    exportHistory: values.get('--export-history'),
    pullUrlBase: values.get('--pull-url-base'),
    fetchHistory: flags.has('--fetch-history'),
    github: flags.has('--github')
  };
  if (options.mode === 'publish') {
    if (!options.commitSha || !options.outputFile) {
      throw new Error('publish needs --commit-sha and --output-file');
    }
    if (options.targetRef || options.generatedNotesFile || options.exportHistory) {
      throw new Error('publish does not accept --target-ref, --generated-notes-file or --export-history');
    }
  }
  if (options.commitSha && options.targetRef) {
    throw new Error('Use either --commit-sha or --target-ref, not both');
  }
  return options;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function createApi(): GitHubApi {
  return createGitHubApi({
    apiUrl: requireEnv('GITHUB_API_URL'),
    repository: requireEnv('GITHUB_REPOSITORY'),
    token: requireEnv('GH_TOKEN')
  });
}

function resolveTarget(
  history: GitHistory,
  options: CliOptions,
  git: ReturnType<typeof createGitRunner>,
  tags: readonly ReleaseTagRecord[]
): string {
  if (options.commitSha) {
    return history.resolveCommit(options.commitSha);
  }
  // An existing release tag previews its own commit; a tag that does not exist yet previews HEAD.
  const existing = tags.find((tag) => tag.name === options.releaseTag);
  const ref = options.targetRef ?? existing?.commit ?? 'HEAD';
  if (options.fetchHistory && /^[\w./-]+$/.test(ref) && !/^[0-9a-f]{40}$/.test(ref)) {
    try {
      git(['fetch', '--force', 'origin', `+refs/heads/${ref}:refs/remotes/origin/${ref}`]);
    } catch {
      // The ref may be a tag, a commit or already local; the lookups below decide.
    }
  }
  for (const candidate of [`refs/remotes/origin/${ref}`, ref]) {
    try {
      return history.resolveCommit(candidate);
    } catch {
      // try the next form
    }
  }
  throw new Error(`Cannot resolve '${ref}' to a commit`);
}

function derivePullUrlBase(git: ReturnType<typeof createGitRunner>, override: string | undefined): string {
  if (override) {
    return override.replace(/\/+$/, '');
  }
  try {
    const remote = git(['remote', 'get-url', 'origin']).trim();
    const match = /^(?:https?:\/\/(?:[^@/]+@)?|git@)([^/:]+)[/:](.+?)(?:\.git)?$/.exec(remote);
    if (match) {
      return `https://${match[1]}/${match[2]}`;
    }
  } catch {
    // no origin remote
  }
  return 'https://example.invalid/local/repository';
}

function writeSummary(markdown: string): void {
  const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryFile) {
    appendFileSync(summaryFile, `${markdown}\n`);
  }
}

function writeReport(options: CliOptions, report: ReleaseNotesReport): void {
  if (options.reportFile) {
    writeFileSync(options.reportFile, `${JSON.stringify(report, null, 2)}\n`);
  }
  writeSummary(renderReportMarkdown(report));
}

/**
 * The published releases are the only independent check that git holds every earlier release tag.
 * When publishing, being unable to read them therefore stops the run; a preview only warns, since it
 * can run offline and creates nothing.
 */
export async function loadPublishedReleaseTags(
  api: Pick<GitHubApi, 'listPublishedReleaseTags'> | undefined,
  mode: Mode
): Promise<string[] | undefined> {
  if (!api) {
    return undefined;
  }
  try {
    return await api.listPublishedReleaseTags();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (mode === 'publish') {
      throw new Error(
        `Cannot verify the release history against the published releases (${detail}). No release was published.`,
        { cause: error }
      );
    }
    console.warn(`::warning::Could not list published releases: ${detail}`);
    return undefined;
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(argv);
  const git = createGitRunner();
  const history = createGitHistory(git);
  if (options.fetchHistory) {
    history.ensureFullHistory();
  }
  const tags = history.listReleaseTags();
  const commitSha = resolveTarget(history, options, git, tags);
  const useApi = options.mode === 'publish' || options.github;
  const api = useApi ? createApi() : undefined;

  if (options.exportHistory) {
    const snapshot = captureSnapshot(history, tags, options.releaseTag, commitSha);
    writeFileSync(options.exportHistory, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Wrote the history snapshot to ${options.exportHistory}`);
  }

  const pullUrlBase = derivePullUrlBase(git, options.pullUrlBase);
  const generateNotes = async (previousTag: string | undefined): Promise<string> => {
    if (options.generatedNotesFile) {
      return readFileSync(options.generatedNotesFile, 'utf8');
    }
    if (options.mode === 'publish' && api) {
      return api.generateNotes({ tagName: options.releaseTag, previousTagName: previousTag });
    }
    const range = previousTag ? history.rangeCommits(commitSha, previousTag) : [];
    return synthesizeGeneratedNotes(range, pullUrlBase, previousTag, options.releaseTag);
  };

  const publishedReleaseTags = await loadPublishedReleaseTags(api, options.mode);

  try {
    const result = await buildReleaseNotes({
      releaseTag: options.releaseTag,
      commitSha,
      tags,
      history,
      generateNotes,
      pullNumbersForCommit: api ? (sha) => api.pullNumbersForCommit(sha) : undefined,
      publishedReleaseTags,
      requireCurrentTag: options.mode === 'publish'
    });
    writeReport(options, result.report);
    for (const warning of result.report.warnings) {
      console.warn(`::warning::${warning}`);
    }
    if (options.outputFile) {
      writeFileSync(options.outputFile, `${result.body}\n`);
    } else {
      console.log(result.body);
    }
    const excluded = result.report.pulls.filter((pull) => pull.decision === 'exclude').length;
    const kept = result.report.pulls.filter((pull) => pull.decision === 'keep').length;
    console.error(
      result.report.firstRelease
        ? `release-notes: first release, notes unchanged (${options.mode})`
        : `release-notes: ${options.mode} for ${options.releaseTag} against ${result.report.previousTag}: ` +
            `${kept} PR(s) kept, ${excluded} already released and excluded`
    );
  } catch (error) {
    if (error instanceof ReleaseNotesError && error.report) {
      writeReport(options, error.report);
      for (const ambiguity of error.report.ambiguities) {
        console.error(`::error::${ambiguity}`);
      }
    }
    throw error;
  }
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`::error::release-notes: ${message}`);
    process.exit(1);
  });
}
