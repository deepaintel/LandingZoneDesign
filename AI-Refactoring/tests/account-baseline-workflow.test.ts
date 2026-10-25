import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { parseCliOptions } from '../scripts/reconcile-account-baseline.js';

/**
 * Workflow wiring of the Common Account Security Baseline v1.0: one composite action, run last in
 * the existing protected deployment job for Staging and Production, after account provisioning, OU
 * enrollment and auto-enrollment. Staging must succeed (including the acceptance gate) before the
 * protected Production job of the same run, for the same commit, can start.
 */

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
  readonly 'continue-on-error'?: unknown;
}

const ACTION = './.github/actions/reconcile-account-baseline';
const CREDENTIALS = 'ccoe-aws/reusable-workflows/.github/actions/aws-credentials@main';
const APPROVED = "${{ inputs.aws-environment == 'staging' || inputs.aws-environment == 'production' }}";
const VERIFY_GUARD = "${{ !cancelled() && steps.inputs.outcome == 'success' }}";

const wrapper = parse(readFileSync('.github/workflows/validate-and-deploy.yml', 'utf8')) as {
  on: { workflow_call: { outputs: Record<string, { value: string }> } };
  jobs: Record<
    string,
    {
      environment: string;
      'timeout-minutes': number;
      outputs: Record<string, string>;
      steps: Step[];
      strategy?: unknown;
    }
  >;
};
const deploy = parse(readFileSync('.github/workflows/deploy.yml', 'utf8')) as {
  on: Record<string, unknown>;
  concurrency: { 'cancel-in-progress': boolean };
  jobs: Record<
    string,
    {
      needs?: string | string[];
      if?: string;
      uses?: string;
      with?: Record<string, unknown>;
      steps?: Step[];
      environment?: string;
    }
  >;
};
const action = parse(readFileSync('.github/actions/reconcile-account-baseline/action.yml', 'utf8')) as {
  inputs: Record<string, unknown>;
  outputs: Record<string, { value: string }>;
  runs: { using: string; steps: Step[] };
};

const job = wrapper.jobs['validate-and-deploy'];
if (job === undefined) throw new Error('validate-and-deploy job missing');
const steps = job.steps;
const indexOf = (uses: string) => steps.findIndex((step) => step.uses === uses);
const baselineIndex = indexOf(ACTION);
const baselineStep = steps[baselineIndex];
const actionSteps = action.runs.steps;

function runBash(script: string | undefined, env: Record<string, string>): number {
  try {
    execFileSync('bash', ['-c', script ?? 'exit 99'], { env: { ...process.env, ...env }, stdio: 'pipe' });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

describe('account baseline step in validate-and-deploy.yml', () => {
  it('runs once, last, for staging and production only, after provisioning, enrollment and auto-enrollment', () => {
    expect(steps.filter((step) => step.uses === ACTION)).toHaveLength(1);
    expect(baselineIndex).toBe(steps.length - 1);
    expect(baselineIndex).toBeGreaterThan(indexOf('./.github/actions/configure-control-tower-auto-enrollment'));
    expect(indexOf('./.github/actions/configure-control-tower-auto-enrollment')).toBeGreaterThan(
      indexOf('./.github/actions/enroll-control-tower-accounts')
    );
    expect(indexOf('./.github/actions/enroll-control-tower-accounts')).toBeGreaterThan(
      indexOf('./.github/actions/deploy-landing-zone-accounts')
    );
    expect(baselineStep?.if).toBe(APPROVED);
    expect(baselineStep?.id).toBe('account_baseline');
  });

  it('processes every eligible account in one execution: no matrix, no account filter input', () => {
    expect(job.strategy).toBeUndefined();
    expect(Object.keys(baselineStep?.with ?? {}).sort()).toEqual(
      [
        'account-ids',
        'audit-account-id',
        'aws-partition',
        'aws-region',
        'deployment-role-name',
        'environment',
        'job-started-at',
        'job-timeout-minutes',
        'landing-zone-arn',
        'log-archive-account-id',
        'management-account-id',
        'organization-id',
        'ou-ids'
      ].sort()
    );
    expect(Object.keys(action.inputs)).not.toContain('accounts');
  });

  it('hands over the runtime handoffs and the job budget', () => {
    const inputs = baselineStep?.with ?? {};
    expect(inputs['environment']).toBe('${{ inputs.aws-environment }}');
    expect(inputs['landing-zone-arn']).toBe('${{ steps.control_tower.outputs.landing-zone-arn }}');
    expect(inputs['audit-account-id']).toBe('${{ steps.shared_accounts.outputs.audit-account-id }}');
    expect(inputs['log-archive-account-id']).toBe('${{ steps.shared_accounts.outputs.log-archive-account-id }}');
    expect(inputs['account-ids']).toBe('${{ steps.landing_zone_accounts.outputs.account-ids }}');
    expect(inputs['ou-ids']).toBe('${{ steps.landing_zone_accounts.outputs.ou-ids }}');
    expect(inputs['job-started-at']).toBe('${{ env.LZ_JOB_STARTED_AT }}');
    expect(String(inputs['job-timeout-minutes'])).toBe(String(job['timeout-minutes']));
  });

  it('cannot be bypassed: no continue-on-error anywhere in the deployment job or the action', () => {
    expect(steps.some((step) => 'continue-on-error' in step)).toBe(false);
    expect('continue-on-error' in job).toBe(false);
    expect(actionSteps.some((step) => 'continue-on-error' in step)).toBe(false);
    const text = readFileSync('.github/actions/reconcile-account-baseline/action.yml', 'utf8');
    expect(text).not.toMatch(/\|\|\s*true/);
    expect(text).not.toContain('continue-on-error');
  });

  it('exposes the acceptance evidence to the combined deployment summary', () => {
    expect(job.outputs['account-baseline-acceptance']).toBe('${{ steps.account_baseline.outputs.acceptance }}');
    expect(job.outputs['account-baseline-results']).toBe('${{ steps.account_baseline.outputs.results }}');
    expect(wrapper.on.workflow_call.outputs['account-baseline-acceptance']?.value).toContain(
      'jobs.validate-and-deploy.outputs.account-baseline-acceptance'
    );
    const summary = deploy.jobs['deployment-summary']?.steps?.[0] as unknown as { env?: Record<string, string> };
    expect(summary.env?.['STAGING_ACCOUNT_BASELINE_ACCEPTANCE']).toContain("outputs['account-baseline-acceptance']");
    expect(summary.env?.['PRODUCTION_ACCOUNT_BASELINE_ACCEPTANCE']).toContain("outputs['account-baseline-acceptance']");
  });
});

describe('Staging -> validation -> IF approval -> Production sequencing (deploy.yml)', () => {
  const staging = deploy.jobs['deploy-to-staging'];
  const production = deploy.jobs['deploy-to-production'];

  it('Production needs the successful Staging job; there is no always() or failure() override', () => {
    expect(production?.needs).toBe('deploy-to-staging');
    expect(production?.if).toBeUndefined();
    expect(staging?.needs).toBe('verify-release-branch');
  });

  it('both environments run the same reusable workflow behind their protected GitHub Environments', () => {
    expect(staging?.uses).toBe('./.github/workflows/validate-and-deploy.yml');
    expect(production?.uses).toBe('./.github/workflows/validate-and-deploy.yml');
    expect(staging?.with?.['github-environment']).toBe('staging');
    expect(production?.with?.['github-environment']).toBe('production');
    expect(job.environment).toBe('${{ inputs.github-environment }}');
  });

  it('Production deploys the same release commit SHA that passed Staging', () => {
    expect(Object.keys(deploy.on)).toEqual(['push']);
    const checkout = steps.find((step) => step.name === 'Checkout');
    expect(checkout?.uses).toBe('ccoe-aws/reusable-workflows/.github/actions/checkout@main');
    expect(checkout?.with?.['ref']).toBeUndefined();
    expect(deploy.concurrency['cancel-in-progress']).toBe(false);
  });
});

describe('reconcile-account-baseline composite action', () => {
  it('refuses every environment other than staging and production before anything else', () => {
    const guard = actionSteps[0];
    expect(guard?.name).toMatch(/^Refuse unsupported environments/);
    expect(runBash(guard?.run, { ENVIRONMENT_NAME: 'staging' })).toBe(0);
    expect(runBash(guard?.run, { ENVIRONMENT_NAME: 'production' })).toBe(0);
    expect(runBash(guard?.run, { ENVIRONMENT_NAME: 'dev' })).not.toBe(0);
    expect(runBash(guard?.run, { ENVIRONMENT_NAME: '' })).not.toBe(0);
  });

  it('acquires every credential through the reusable aws-credentials action, right before each phase', () => {
    const uses = actionSteps.map((step) => step.uses).filter((value) => value !== undefined);
    expect(new Set(uses)).toEqual(new Set([CREDENTIALS, 'actions/upload-artifact@v4']));
    for (const [position, step] of actionSteps.entries()) {
      if (step.run?.includes('reconcile:account-baseline') === true) {
        expect(actionSteps[position - 1]?.uses, step.name).toBe(CREDENTIALS);
      }
    }
    const text = readFileSync('.github/actions/reconcile-account-baseline/action.yml', 'utf8');
    expect(text).not.toContain('configure-aws-credentials');
    expect(text).not.toContain('assume-role-with-web-identity');
  });

  it('runs the read-only preflight, three guarded apply rounds, the budget check, then the verification', () => {
    const scripts = actionSteps.map((step) => step.run ?? '');
    const plan = scripts.findIndex((run) => run.includes('--phase plan'));
    const applies = scripts.flatMap((run, position) => (run.includes('--phase apply') ? [position] : []));
    const verify = scripts.findIndex((run) => run.includes('--phase verify'));
    const rounds = actionSteps.findIndex((step) => step.id === 'rounds');
    expect(plan).toBeGreaterThan(1);
    expect(applies).toHaveLength(3);
    expect(applies[0]).toBeGreaterThan(plan);
    expect(rounds).toBeGreaterThan(applies[2] ?? Number.POSITIVE_INFINITY);
    expect(verify).toBeGreaterThan(rounds);
    expect(actionSteps[plan]?.if).toBeUndefined();
    expect(actionSteps[applies[0] ?? -1]?.if).toBeUndefined();
    expect(actionSteps.find((step) => step.id === 'round_2')?.if).toBe(
      "${{ steps.round_1.outputs.status == 'continue' }}"
    );
    expect(actionSteps.find((step) => step.id === 'round_3')?.if).toBe(
      "${{ steps.round_2.outputs.status == 'continue' }}"
    );
    for (const run of scripts.filter((value) => value.includes('reconcile:account-baseline'))) {
      expect(run).toMatch(/^set -euo pipefail/);
    }
  });

  it('always verifies and uploads evidence unless cancelled, and never lets the verification be skipped by an earlier outcome', () => {
    const verify = actionSteps.find((step) => step.id === 'verify');
    expect(verify?.if).toBe(VERIFY_GUARD);
    expect(actionSteps[actionSteps.indexOf(verify ?? {}) - 1]?.if).toBe(VERIFY_GUARD);
    const upload = actionSteps.find((step) => step.uses === 'actions/upload-artifact@v4');
    expect(upload?.if).toBe(VERIFY_GUARD);
    expect(upload?.with?.['if-no-files-found']).toBe('error');
    expect(action.outputs['acceptance']?.value).toBe('${{ steps.verify.outputs.acceptance }}');
  });

  it('fails the step unless the last apply round completed', () => {
    const check = actionSteps.find((step) => step.id === 'rounds');
    for (const [statuses, ok] of [
      ['complete', true],
      ['continue complete', true],
      ['continue continue continue', false],
      ['job-budget-exhausted', false],
      ['failed', false],
      ['', false]
    ] as const) {
      expect(
        runBash(check?.run, { STATUSES: statuses, GITHUB_OUTPUT: join(tmpdir(), 'baseline-test-output') }) === 0
      ).toBe(ok);
    }
  });

  it('validates identifiers and refuses shared-account overlap before any AWS call', () => {
    const validate = actionSteps.find((step) => step.id === 'inputs');
    const base = {
      MANAGEMENT_ACCOUNT_ID: '111111111111',
      ORGANIZATION_ID: 'o-abcdefghij',
      LANDING_ZONE_ARN: 'arn:aws-eusc:controltower:eusc-de-east-1:111111111111:landingzone/ABC',
      AUDIT_ACCOUNT_ID: '333333333333',
      LOG_ARCHIVE_ACCOUNT_ID: '444444444444',
      ACCOUNT_IDS: 'sharedServices=200000000100',
      OU_IDS: 'Infrastructure=ou-ab12-abcdefgh',
      JOB_STARTED_AT: '1700000000',
      JOB_TIMEOUT_MINUTES: '360',
      SESSION_BUDGET_SECONDS: '3000',
      RUNNER_TEMP: tmpdir(),
      GITHUB_OUTPUT: join(tmpdir(), 'baseline-test-output')
    };
    expect(runBash(validate?.run, base)).toBe(0);
    expect(runBash(validate?.run, { ...base, AUDIT_ACCOUNT_ID: '111111111111' })).not.toBe(0);
    expect(
      runBash(validate?.run, { ...base, LANDING_ZONE_ARN: 'arn:aws:controltower:x:111111111111:landingzone/A' })
    ).not.toBe(0);
    expect(runBash(validate?.run, { ...base, SESSION_BUDGET_SECONDS: '3600' })).not.toBe(0);
  });
});

describe('reconcile-account-baseline.ts options', () => {
  const required = [
    '--environment',
    'staging',
    '--management-account-id',
    '111111111111',
    '--organization-id',
    'o-abcdefghij',
    '--landing-zone-arn',
    'arn',
    '--audit-account-id',
    '333333333333',
    '--log-archive-account-id',
    '444444444444',
    '--account-ids-file',
    'a',
    '--ou-ids-file',
    'o',
    '--state-file',
    's'
  ];

  it('accepts the three phases and requires a job deadline for apply and a report file for verify', () => {
    expect(parseCliOptions(['--phase', 'plan', ...required]).phase).toBe('plan');
    expect(() => parseCliOptions(['--phase', 'apply', ...required])).toThrow(/--job-deadline-epoch is required/);
    expect(parseCliOptions(['--phase', 'apply', ...required, '--job-deadline-epoch', '1700000000']).phase).toBe(
      'apply'
    );
    expect(() => parseCliOptions(['--phase', 'verify', ...required])).toThrow(/--report-file is required/);
    expect(() => parseCliOptions(['--phase', 'skip', ...required])).toThrow(/--phase must be/);
  });

  it('refuses other environments and over-long credential budgets', () => {
    const otherEnvironment = required.map((value) => (value === 'staging' ? 'dev' : value));
    expect(() => parseCliOptions(['--phase', 'plan', ...otherEnvironment])).toThrow(/refusing environment 'dev'/);
    expect(() => parseCliOptions(['--phase', 'plan', ...required, '--session-budget-seconds', '3600'])).toThrow(
      /below one hour/
    );
  });
});
