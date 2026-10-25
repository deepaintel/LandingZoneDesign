/**
 * Git-backed `HistorySource` for release-note verification. Reads commit history, patch IDs and
 * release tags from a local clone; it never writes to the repository. The only mutation is the
 * opt-in `ensureFullHistory`, which fetches tags and history into the runner's clone.
 */

import { execFileSync } from 'node:child_process';

import {
  RELEASE_TAG_PATTERN,
  type HistoryCommit,
  type HistorySource,
  type ReleasedCommit,
  type ReleaseTagRecord
} from './release-notes.js';

export type GitRunner = (args: readonly string[], options?: { input?: string }) => string;

const MAX_BUFFER_BYTES = 512 * 1024 * 1024;
const FIELD_SEPARATOR = '\u001f';
const RECORD_SEPARATOR = '\u001e';

export function createGitRunner(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): GitRunner {
  return (args, options) => {
    try {
      return execFileSync('git', [...args], {
        cwd,
        env,
        encoding: 'utf8',
        input: options?.input,
        maxBuffer: MAX_BUFFER_BYTES,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim();
      throw new Error(`git ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`, { cause: error });
    }
  };
}

function parseCommits(output: string): Omit<HistoryCommit, 'patchId'>[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n+/, ''))
    .filter((record) => record !== '')
    .map((record) => {
      const [sha = '', parents = '', subject = '', body = ''] = record.split(FIELD_SEPARATOR);
      return {
        sha,
        parents: parents === '' ? [] : parents.split(' '),
        subject,
        cherryPickedFrom: [...body.matchAll(/\(cherry picked from commit ([0-9a-f]{7,40})\)/g)].flatMap((match) =>
          match[1] ? [match[1]] : []
        )
      };
    });
}

export interface GitHistory extends HistorySource {
  listReleaseTags(): ReleaseTagRecord[];
  /** Resolves a ref or SHA to a commit SHA. */
  resolveCommit(ref: string): string;
  /** Fetches tags and any missing history into the clone; required on a shallow runner checkout. */
  ensureFullHistory(): void;
}

export function createGitHistory(git: GitRunner): GitHistory {
  const logFormat = `--format=%H${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`;

  const loadCommits = (revisions: readonly string[]): HistoryCommit[] => {
    const commits = parseCommits(git(['log', logFormat, ...revisions, '--']));
    if (commits.length === 0) {
      return [];
    }
    // One streamed `git patch-id` for the whole range. `--no-renames` keeps the diff, and so the
    // patch ID, identical regardless of the clone's rename-detection configuration.
    const patch = git([
      'log',
      '--no-merges',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '-p',
      ...revisions,
      '--'
    ]);
    const patchIds = new Map<string, string>();
    for (const line of git(['patch-id', '--stable'], { input: patch }).split('\n')) {
      const [patchId, sha] = line.trim().split(' ');
      if (patchId && sha) {
        patchIds.set(sha, patchId);
      }
    }
    return commits.map((commit) => ({ ...commit, patchId: patchIds.get(commit.sha) }));
  };

  const listShas = (revisions: readonly string[]): string[] =>
    git(['rev-list', ...revisions, '--'])
      .split('\n')
      .filter((sha) => sha !== '');

  return {
    rangeCommits: (commit, previousTag) => loadCommits([commit, '--not', previousTag]),

    unreachableShas: (commit, tag) => new Set(listShas([commit, '--not', tag])),

    releasedCommits: (commit, tags): ReleasedCommit[] => {
      if (tags.length === 0) {
        return [];
      }
      const releaseTagsBySha = new Map<string, string[]>();
      for (const tag of tags) {
        for (const sha of listShas([tag, '--not', commit])) {
          releaseTagsBySha.set(sha, [...(releaseTagsBySha.get(sha) ?? []), tag]);
        }
      }
      return loadCommits([...tags, '--not', commit]).map((released) => ({
        ...released,
        releaseTags: releaseTagsBySha.get(released.sha) ?? []
      }));
    },

    listReleaseTags: () => {
      const format = ['%(refname:short)', '%(creatordate:unix)', '%(*objectname)', '%(objectname)'].join('\t');
      return git(['for-each-ref', `--format=${format}`, 'refs/tags'])
        .split('\n')
        .filter((line) => line !== '')
        .flatMap((line) => {
          const [name = '', createdAt = '', peeled = '', object = ''] = line.split('\t');
          return RELEASE_TAG_PATTERN.test(name)
            ? [{ name, createdAt: Number(createdAt), commit: peeled === '' ? object : peeled }]
            : [];
        });
    },

    resolveCommit: (ref) => git(['rev-parse', '--verify', `${ref}^{commit}`]).trim(),

    ensureFullHistory: () => {
      const shallow = git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
      git(['fetch', '--force', '--tags', ...(shallow ? ['--unshallow'] : []), 'origin']);
    }
  };
}
