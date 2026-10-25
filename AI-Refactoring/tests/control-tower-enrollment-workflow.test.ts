import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { assertEnrollmentEnvironment } from '../scripts/control-tower-enrollment-runtime.js';

/**
 * Workflow wiring of AWS Control Tower OU enrollment: one reusable composite action, run in the
 * protected deployment job for Staging and Production after account provisioning, refusing any
 * other environment. Production reaches it only through the existing `production` environment job.
 */

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

const wrapper = parse(readFileSync('.github/workflows/validate-and-deploy.yml', 'utf8')) as {
  jobs: { 'validate-and-deploy': { environment: string; 'timeout-minutes': number; steps: Step[] } };
};
const deploy = parse(readFileSync('.github/workflows/deploy.yml', 'utf8')) as {
  jobs: Record<string, { needs?: string | string[]; uses?: string; with?: Record<string, unknown> }>;
};
const action = parse(readFileSync('.github/actions/enroll-control-tower-accounts/action.yml', 'utf8')) as {
  runs: { steps: Step[] };
};

const job = wrapper.jobs['validate-and-deploy'];
const steps = job.steps;
const enrollIndex = steps.findIndex((step) => step.uses === './.github/actions/enroll-control-tower-accounts');
const accountsIndex = steps.findIndex((step) => step.uses === './.github/actions/deploy-landing-zone-accounts');

describe('enrollment step in validate-and-deploy.yml', () => {
  it('runs once, for staging and production only, after account provisioning', () => {
    expect(steps.filter((step) => step.uses === './.github/actions/enroll-control-tower-accounts')).toHaveLength(1);
    expect(enrollIndex).toBeGreaterThan(accountsIndex);
    expect(accountsIndex).toBeGreaterThan(
      steps.findIndex((step) => step.uses === './.github/actions/initialize-control-tower')
    );
    expect(steps[enrollIndex]?.if).toBe(
      "${{ inputs.aws-environment == 'staging' || inputs.aws-environment == 'production' }}"
    );
  });

  it('hands over the runtime account-ids and ou-ids and the job budget', () => {
    const inputs = steps[enrollIndex]?.with ?? {};
    expect(inputs['environment']).toBe('${{ inputs.aws-environment }}');
    expect(inputs['account-ids']).toBe('${{ steps.landing_zone_accounts.outputs.account-ids }}');
    expect(inputs['ou-ids']).toBe('${{ steps.landing_zone_accounts.outputs.ou-ids }}');
    expect(String(inputs['job-timeout-minutes'])).toBe(String(job['timeout-minutes']));
  });

  it('runs inside the protected environment job that both environments use', () => {
    expect(job.environment).toBe('${{ inputs.github-environment }}');
    const staging = deploy.jobs['deploy-to-staging'];
    const production = deploy.jobs['deploy-to-production'];
    expect(staging?.uses).toBe('./.github/workflows/validate-and-deploy.yml');
    expect(production?.uses).toBe('./.github/workflows/validate-and-deploy.yml');
    expect(staging?.with?.['github-environment']).toBe('staging');
    expect(production?.with?.['github-environment']).toBe('production');
    expect(production?.needs).toBe('deploy-to-staging');
  });
});

describe('enroll-control-tower-accounts composite action', () => {
  const guard = action.runs.steps[0];

  function runGuard(environment: string): number {
    try {
      execFileSync('bash', ['-c', guard?.run ?? 'exit 99'], {
        env: { ...process.env, ENVIRONMENT_NAME: environment },
        stdio: 'pipe'
      });
      return 0;
    } catch (error) {
      return (error as { status?: number }).status ?? 1;
    }
  }

  it('accepts staging and production and rejects any other environment as its first step', () => {
    expect(guard?.name).toMatch(/^Refuse unsupported environments/);
    expect(runGuard('staging')).toBe(0);
    expect(runGuard('production')).toBe(0);
    expect(runGuard('dev')).not.toBe(0);
    expect(runGuard('')).not.toBe(0);
  });

  it('acquires every credential through the reusable aws-credentials action', () => {
    const uses = action.runs.steps.map((step) => step.uses).filter((value) => value !== undefined);
    expect(uses).toHaveLength(8);
    expect(new Set(uses)).toEqual(new Set(['ccoe-aws/reusable-workflows/.github/actions/aws-credentials@main']));
  });

  it('runs the read-only plan before the first enrollment round', () => {
    const scripts = action.runs.steps.map((step) => step.run ?? '');
    const plan = scripts.findIndex((run) => run.includes('--mode plan'));
    const enroll = scripts.findIndex((run) => run.includes('--mode enroll'));
    expect(plan).toBeGreaterThan(-1);
    expect(enroll).toBeGreaterThan(plan);
  });
});

describe('runtime environment guard', () => {
  it('accepts staging and production and fails closed for anything else', () => {
    expect(assertEnrollmentEnvironment('staging')).toBe('staging');
    expect(assertEnrollmentEnvironment('production')).toBe('production');
    expect(() => assertEnrollmentEnvironment('dev')).toThrow(/supports only staging and production/);
  });
});
