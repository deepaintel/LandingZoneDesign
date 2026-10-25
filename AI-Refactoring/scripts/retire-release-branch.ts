#!/usr/bin/env tsx
/**
 * Deletes the released `release/lz-vX.Y.Z` branch after a successful release, with a GitHub App
 * installation token, once every precondition in `lib/release/branch-retirement.ts` has passed.
 * Invoked by `.github/actions/retire-release-branch`.
 *
 * Usage: retire-release-branch.ts --result-file <path>
 *
 * Inputs (environment): RELEASE_BRANCH, RELEASED_SHA, RELEASE_TAG, PRODUCTION_RESULT,
 * PUBLISH_RESULT, GH_TOKEN (read-only workflow token), APP_ID and APP_PRIVATE_KEY (optional until
 * the App is configured), CLEANUP_ENVIRONMENT (the job's own environment), and the runner's
 * GITHUB_REPOSITORY, GITHUB_API_URL and GITHUB_RUN_ID.
 *
 * Cleanup never fails the release: every outcome, including an unexpected error, is written to the
 * result file and reported as a notice or a warning, and the process exits 0. The branch is only
 * ever deleted after all checks passed.
 *
 * Governed by `.apm/skills/manage-landing-zone-release-workflows/SKILL.md`.
 */

import { appendFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  renderCleanupMarkdown,
  retireReleaseBranch,
  type CleanupResult,
  type HttpClient
} from '../lib/release/branch-retirement.js';

const ATTEMPTS = 3;

/** REST client with retries for server errors and network failures; every other status is returned. */
export function createHttpClient(apiUrl: string, fetchImpl: typeof fetch = fetch, retryDelayMs = 1000): HttpClient {
  const base = apiUrl.replace(/\/+$/, '');
  return async (method, path, { token, body }) => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchImpl(`${base}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (response.status < 500) {
          const text = await response.text();
          let data: unknown;
          try {
            data = text === '' ? undefined : JSON.parse(text);
          } catch {
            data = { message: text.slice(0, 200) };
          }
          return { status: response.status, data };
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      if (attempt < ATTEMPTS && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
    throw new Error(`${method} ${path} failed after ${ATTEMPTS} attempts`, { cause: lastError });
  };
}

function report(cleanup: CleanupResult, env: NodeJS.ProcessEnv): void {
  const done = cleanup.outcome === 'deleted' || cleanup.outcome === 'already-deleted';
  // Warnings stay visible in the run's annotations without failing the completed release.
  console.log(`${done ? '::notice::' : '::warning::'}Released branch cleanup ${cleanup.outcome}: ${cleanup.reason}`);
  // Reads the `env` main() was given, not the live process environment, so a test that injects its
  // own env (with no GITHUB_STEP_SUMMARY, or a throwaway path) can never write into this process's
  // real job summary.
  const summary = env['GITHUB_STEP_SUMMARY'];
  if (summary) {
    appendFileSync(summary, `${renderCleanupMarkdown(cleanup)}\n`);
  }
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  http?: HttpClient
): Promise<CleanupResult> {
  const resultFile = argv[0] === '--result-file' ? argv[1] : undefined;
  const branch = env['RELEASE_BRANCH'] ?? '';
  let cleanup: CleanupResult;
  try {
    const appId = env['APP_ID'] ?? '';
    const privateKey = env['APP_PRIVATE_KEY'] ?? '';
    cleanup = await retireReleaseBranch(
      {
        repository: env['GITHUB_REPOSITORY'] ?? '',
        runId: env['GITHUB_RUN_ID'] ?? '',
        releaseBranch: branch,
        releasedSha: env['RELEASED_SHA'] ?? '',
        releaseTag: env['RELEASE_TAG'] ?? '',
        productionResult: env['PRODUCTION_RESULT'] ?? '',
        publishResult: env['PUBLISH_RESULT'] ?? '',
        readToken: env['GH_TOKEN'] ?? '',
        app: appId !== '' && privateKey !== '' ? { appId, privateKey } : undefined,
        ownEnvironment: env['CLEANUP_ENVIRONMENT'] || undefined
      },
      http ?? createHttpClient(env['GITHUB_API_URL'] ?? 'https://api.github.com')
    );
  } catch (error) {
    cleanup = {
      outcome: 'failed',
      reason: `Branch cleanup failed unexpectedly (${error instanceof Error ? error.message : String(error)}); not deleting.`,
      branch,
      checks: []
    };
  }
  if (resultFile) {
    writeFileSync(resultFile, `${JSON.stringify(cleanup, null, 2)}\n`);
  }
  report(cleanup, env);
  return cleanup;
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  main()
    .catch((error: unknown) => {
      console.log(
        `::warning::Released branch cleanup could not run: ${error instanceof Error ? error.message : String(error)}`
      );
    })
    .finally(() => process.exit(0));
}
