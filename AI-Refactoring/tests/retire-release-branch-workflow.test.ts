import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { main } from '../scripts/retire-release-branch.js';

/**
 * Released-branch cleanup must never fail a completed release. These tests pin the workflow wiring
 * and execute the action's shell and the job's report step, so a crashing script, a broken
 * toolchain or a failed checkout is shown to end as a reported outcome with exit code 0.
 */

interface Step {
  readonly id?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
  readonly env?: Record<string, string>;
  readonly 'continue-on-error'?: boolean;
}

interface Job {
  readonly needs?: string | string[];
  readonly if?: string;
  readonly permissions?: Record<string, string>;
  readonly outputs?: Record<string, string>;
  readonly steps?: Step[];
  readonly 'continue-on-error'?: unknown;
}

const deploy = parse(readFileSync('.github/workflows/deploy.yml', 'utf8')) as { jobs: Record<string, Job> };
const action = parse(readFileSync('.github/actions/retire-release-branch/action.yml', 'utf8')) as {
  inputs: Record<string, { required?: boolean }>;
  runs: { steps: Step[] };
};
const job = deploy.jobs['retire-release-branch'] ?? {};
const steps = job.steps ?? [];
const actionScript = action.runs.steps.map((step) => step.run ?? '').join('\n');
const reportScript = steps.find((step) => step.id === 'report')?.run ?? '';

describe('released-branch cleanup job in deploy.yml', () => {
  it('runs only after Production, tagging and the GitHub Release, with a read-only workflow token', () => {
    expect([job.needs].flat()).toEqual(['deploy-to-production', 'tag-release', 'publish-release']);
    expect(Object.values(job.permissions ?? {})).not.toContain('write');
    expect(job.permissions?.['id-token']).toBeUndefined();
    expect(steps.some((step) => String(step.uses).includes('aws-credentials'))).toBe(false);
  });

  it('takes the App credentials from IF-managed configuration and the release facts from the run', () => {
    const retire = steps.find((step) => step.id === 'retire');
    expect(retire?.uses).toBe('./.github/actions/retire-release-branch');
    expect(retire?.with).toEqual({
      'github-token': '${{ github.token }}',
      'app-id': '${{ vars.RELEASE_CLEANUP_APP_ID }}',
      'app-private-key': '${{ secrets.RELEASE_CLEANUP_APP_PRIVATE_KEY }}',
      'release-branch': '${{ github.ref_name }}',
      'released-sha': '${{ github.sha }}',
      'release-tag': "${{ needs['tag-release'].outputs.release_tag }}",
      'production-result': "${{ needs['deploy-to-production'].result }}",
      'publish-result': "${{ needs['publish-release'].result }}",
      'cleanup-environment': 'release-cleanup'
    });
    // The key lives in an environment that the administrators restrict to release/** branches.
    expect((job as { environment?: unknown }).environment).toBe('release-cleanup');
  });

  it('continues past exactly the cleanup steps and reports their outcome last, with no job-level suppression', () => {
    expect(job['continue-on-error']).toBeUndefined();
    expect(steps.filter((step) => step['continue-on-error'] === true).map((step) => step.id)).toEqual([
      'checkout',
      'workspace',
      'retire'
    ]);
    expect(steps.at(-1)).toMatchObject({ id: 'report', if: '${{ always() }}' });
    expect(job.outputs).toEqual({
      outcome: '${{ steps.report.outputs.outcome }}',
      reason: '${{ steps.report.outputs.reason }}'
    });
  });

  it('is needed by nothing but the summary, so a cleanup problem cannot block another job', () => {
    const dependants = Object.entries(deploy.jobs)
      .filter(([, other]) => [other.needs].flat().includes('retire-release-branch'))
      .map(([name]) => name);
    expect(dependants).toEqual(['deployment-summary']);
    expect(deploy.jobs['deployment-summary']?.if).toBe('${{ always() }}');
  });

  it('keeps the release mechanics it depends on unchanged', () => {
    expect(deploy.jobs['tag-release']?.needs).toEqual(['verify-release-branch', 'deploy-to-production']);
    expect(deploy.jobs['publish-release']?.needs).toBe('tag-release');
  });
});

const hasShell = spawnSync('bash', ['-c', 'command -v jq && command -v od'], { encoding: 'utf8' }).status === 0;
const directories: string[] = [];

afterAll(() => {
  for (const dir of directories) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function parseOutputs(file: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const multi = /^([\w-]+)<<(.+)$/.exec(line);
    if (multi) {
      const values: string[] = [];
      for (index += 1; index < lines.length && lines[index] !== multi[2]; index += 1) {
        values.push(lines[index] ?? '');
      }
      outputs[multi[1] ?? ''] = values.join('\n');
    } else if (line.includes('=')) {
      const at = line.indexOf('=');
      outputs[line.slice(0, at)] = line.slice(at + 1);
    }
  }
  return outputs;
}

function runShell(script: string, env: Record<string, string>, stubMode?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'retire-'));
  directories.push(dir);
  const stubs = join(dir, 'bin');
  execFileSync('bash', ['-c', `mkdir -p "$1"`, 'bash', stubs.split('\\').join('/')]);
  if (stubMode) {
    // A stand-in for `pnpm exec tsx scripts/retire-release-branch.ts --result-file <file>`.
    const pnpm = join(stubs, 'pnpm');
    writeFileSync(
      pnpm,
      [
        '#!/usr/bin/env bash',
        'case "$STUB_MODE" in',
        `  ok) printf '{"outcome":"deleted","reason":"done"}' > "$5"; exit 0 ;;`,
        '  crash) echo "TypeError: boom" >&2; exit 1 ;;',
        `  bogus) printf '{"outcome":"maybe"}' > "$5"; exit 0 ;;`,
        '  silent) exit 0 ;;',
        'esac',
        ''
      ].join('\n')
    );
    chmodSync(pnpm, 0o755);
  }
  const output = join(dir, 'output');
  const summary = join(dir, 'summary');
  writeFileSync(output, '');
  writeFileSync(summary, '');
  const posix = (path: string) => path.split('\\').join('/');
  // On Windows a `C:/...` PATH entry splits at the drive colon; cygpath gives the POSIX form.
  const prelude = [
    `stub_dir="${posix(stubs)}"`,
    'if command -v cygpath > /dev/null 2>&1; then stub_dir=$(cygpath -u "$stub_dir"); fi',
    `export PATH="$stub_dir:$PATH" RUNNER_TEMP="${posix(dir)}" GITHUB_OUTPUT="${posix(output)}" GITHUB_STEP_SUMMARY="${posix(summary)}"`
  ].join('\n');
  const result = spawnSync('bash', ['-c', `${prelude}\n${script}`], {
    encoding: 'utf8',
    env: { ...process.env, STUB_MODE: stubMode ?? '', ...env }
  });
  return {
    status: result.status,
    stdout: result.stdout,
    outputs: parseOutputs(output),
    summary: readFileSync(summary, 'utf8')
  };
}

describe.skipIf(!hasShell)(
  'cleanup action shell: every failure becomes an outcome, never a failed step',
  { timeout: 30_000 },
  () => {
    it('passes the script outcome through when the cleanup completes', () => {
      const run = runShell(actionScript, {}, 'ok');
      expect(run.status).toBe(0);
      expect(run.outputs).toMatchObject({ outcome: 'deleted', reason: 'done' });
    });

    it('reports a crashing script as failed and still exits 0', () => {
      const run = runShell(actionScript, {}, 'crash');
      expect(run.status).toBe(0);
      expect(run.outputs['outcome']).toBe('failed');
      expect(run.outputs['reason']).toMatch(/did not complete/);
      expect(run.stdout).toContain('::warning::Released branch cleanup failed');
      expect(run.summary).toContain('Released branch cleanup: `failed`');
    });

    it('reports a script that wrote nothing, or an unknown outcome, as failed', () => {
      expect(runShell(actionScript, {}, 'silent').outputs).toMatchObject({
        outcome: 'failed',
        reason: expect.stringMatching(/did not complete/)
      });
      expect(runShell(actionScript, {}, 'bogus').outputs).toMatchObject({
        outcome: 'failed',
        reason: expect.stringMatching(/no recognizable outcome/)
      });
    });
  }
);

describe.skipIf(!hasShell)(
  'cleanup report step: the release outcome is never changed by cleanup',
  { timeout: 30_000 },
  () => {
    const report = (env: Record<string, string>) =>
      runShell(reportScript, {
        CHECKOUT_OUTCOME: 'success',
        WORKSPACE_OUTCOME: 'success',
        RETIRE_STEP_OUTCOME: 'success',
        CLEANUP_OUTCOME: 'deleted',
        CLEANUP_REASON: 'release/lz-v0.0.3 was deleted.',
        ...env
      });

    it('reports a deletion as a notice', () => {
      const run = report({});
      expect(run.status).toBe(0);
      expect(run.outputs['outcome']).toBe('deleted');
      expect(run.stdout).toContain('::notice::');
    });

    it.each([
      [
        {
          CHECKOUT_OUTCOME: 'failure',
          WORKSPACE_OUTCOME: 'skipped',
          RETIRE_STEP_OUTCOME: 'skipped',
          CLEANUP_OUTCOME: ''
        },
        /checked out/
      ],
      [{ WORKSPACE_OUTCOME: 'failure', RETIRE_STEP_OUTCOME: 'skipped', CLEANUP_OUTCOME: '' }, /workspace/],
      [{ RETIRE_STEP_OUTCOME: 'failure', CLEANUP_OUTCOME: '' }, /without an outcome/]
    ])('turns a failed prerequisite into a failed outcome with exit 0 (%o)', (env, reason) => {
      const run = report(env);
      expect(run.status).toBe(0);
      expect(run.outputs['outcome']).toBe('failed');
      expect(run.outputs['reason']).toMatch(reason);
      expect(run.stdout).toMatch(/::warning::.*The release itself succeeded/);
    });

    it('reports a skipped cleanup as a warning with its reason, with exit 0', () => {
      const run = report({
        CLEANUP_OUTCOME: 'skipped',
        CLEANUP_REASON: 'Open pull request(s) #9 use release/lz-v0.0.3.'
      });
      expect(run.status).toBe(0);
      expect(run.outputs).toMatchObject({
        outcome: 'skipped',
        reason: 'Open pull request(s) #9 use release/lz-v0.0.3.'
      });
      expect(run.summary).toContain('#9');
    });
  }
);

describe('retire-release-branch script', () => {
  it('never throws: an unreachable API ends as a failed outcome in the result file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retire-main-'));
    directories.push(dir);
    const resultFile = join(dir, 'result.json');
    const result = await main(
      ['--result-file', resultFile],
      {
        RELEASE_BRANCH: 'release/lz-v0.0.3',
        RELEASED_SHA: 'a'.repeat(40),
        RELEASE_TAG: 'release-v0.0.3',
        PRODUCTION_RESULT: 'success',
        PUBLISH_RESULT: 'success',
        GITHUB_REPOSITORY: 'org/repo',
        GH_TOKEN: 'read-token'
      },
      async () => {
        throw new Error('network unreachable');
      }
    );
    expect(result.outcome).toBe('failed');
    expect(JSON.parse(readFileSync(resultFile, 'utf8'))).toMatchObject({ outcome: 'failed' });
  });

  it('treats missing App configuration as not configured, not as an error', async () => {
    const result = await main([], { RELEASE_BRANCH: 'main' }, async () => ({ status: 200, data: {} }));
    expect(result.outcome).toBe('skipped');
  });

  it('never writes into this test process’s own real job summary, even though it has one', async () => {
    // Reproduces the real bug: when this suite runs inside an actual GitHub Actions job (as it does
    // in ci.yml and in the Staging/Production "Validate release candidate" step), process.env holds
    // a GITHUB_STEP_SUMMARY that points at that job's real summary file. Every main() call above
    // passes its own env object (without that key) on purpose, so no test run here must ever reach
    // through to process.env and append fake cleanup results into the real summary.
    const dir = mkdtempSync(join(tmpdir(), 'retire-summary-'));
    directories.push(dir);
    const realSummary = join(dir, 'real-job-summary.md');
    writeFileSync(realSummary, '# unrelated real job summary\n');
    const original = process.env['GITHUB_STEP_SUMMARY'];
    process.env['GITHUB_STEP_SUMMARY'] = realSummary;
    try {
      await main([], { RELEASE_BRANCH: 'main' }, async () => ({ status: 200, data: {} }));
      await main([], { RELEASE_BRANCH: 'release/lz-v0.0.3' }, async () => {
        throw new Error('network unreachable');
      });
    } finally {
      if (original === undefined) {
        delete process.env['GITHUB_STEP_SUMMARY'];
      } else {
        process.env['GITHUB_STEP_SUMMARY'] = original;
      }
    }
    expect(readFileSync(realSummary, 'utf8')).toBe('# unrelated real job summary\n');
  });
});
