import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Workflow wiring of AWS Control Tower account auto-enrollment: one reusable composite action, run
 * in the protected deployment job for Staging and Production after OU enrollment and its
 * validation, refusing any other environment. Production reaches it only through the existing
 * `production` environment job, which runs after Staging. The action is the only code path that
 * calls `UpdateLandingZone`.
 */

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

const ACTION = './.github/actions/configure-control-tower-auto-enrollment';
const CREDENTIALS = 'ccoe-aws/reusable-workflows/.github/actions/aws-credentials@main';

const wrapper = parse(readFileSync('.github/workflows/validate-and-deploy.yml', 'utf8')) as {
  on: { workflow_call: { outputs: Record<string, { value: string }> } };
  jobs: {
    'validate-and-deploy': {
      environment: string;
      'timeout-minutes': number;
      outputs: Record<string, string>;
      steps: Step[];
    };
  };
};
const deploy = parse(readFileSync('.github/workflows/deploy.yml', 'utf8')) as {
  concurrency: { 'cancel-in-progress': boolean };
  jobs: Record<string, { needs?: string | string[]; uses?: string; with?: Record<string, unknown>; steps?: Step[] }>;
};
const action = parse(readFileSync('.github/actions/configure-control-tower-auto-enrollment/action.yml', 'utf8')) as {
  outputs: Record<string, { value: string }>;
  runs: { using: string; steps: Step[] };
};

const job = wrapper.jobs['validate-and-deploy'];
const steps = job.steps;
const index = (uses: string) => steps.findIndex((step) => step.uses === uses);
const autoIndex = index(ACTION);
const autoStep = steps[autoIndex];

describe('auto-enrollment step in validate-and-deploy.yml', () => {
  it('runs once, for staging and production only, after OU enrollment and its validation', () => {
    expect(steps.filter((step) => step.uses === ACTION)).toHaveLength(1);
    expect(autoIndex).toBeGreaterThan(index('./.github/actions/enroll-control-tower-accounts'));
    expect(index('./.github/actions/enroll-control-tower-accounts')).toBeGreaterThan(
      index('./.github/actions/deploy-landing-zone-accounts')
    );
    // Only the Common Account Security Baseline, which depends on completed auto-enrollment, follows it.
    expect(autoIndex).toBe(steps.length - 2);
    expect(steps[autoIndex + 1]?.uses).toBe('./.github/actions/reconcile-account-baseline');
    expect(autoStep?.if).toBe("${{ inputs.aws-environment == 'staging' || inputs.aws-environment == 'production' }}");
  });

  it('hands over the runtime Landing Zone, shared accounts, account and OU handoffs and the job budget', () => {
    const inputs = autoStep?.with ?? {};
    expect(inputs['environment']).toBe('${{ inputs.aws-environment }}');
    expect(inputs['landing-zone-arn']).toBe('${{ steps.control_tower.outputs.landing-zone-arn }}');
    expect(inputs['audit-account-id']).toBe('${{ steps.shared_accounts.outputs.audit-account-id }}');
    expect(inputs['log-archive-account-id']).toBe('${{ steps.shared_accounts.outputs.log-archive-account-id }}');
    expect(inputs['account-ids']).toBe('${{ steps.landing_zone_accounts.outputs.account-ids }}');
    expect(inputs['ou-ids']).toBe('${{ steps.landing_zone_accounts.outputs.ou-ids }}');
    expect(inputs['job-started-at']).toBe('${{ env.LZ_JOB_STARTED_AT }}');
    expect(String(inputs['job-timeout-minutes'])).toBe(String(job['timeout-minutes']));
    expect(job['timeout-minutes']).toBe(360);
  });

  it('exposes the verified setting and operation to the combined deployment summary', () => {
    expect(job.outputs['auto-enrollment']).toBe('${{ steps.auto_enrollment.outputs.auto-enrollment }}');
    expect(job.outputs['auto-enrollment-operation-identifier']).toBe(
      '${{ steps.auto_enrollment.outputs.operation-identifier }}'
    );
    expect(wrapper.on.workflow_call.outputs['auto-enrollment']?.value).toContain(
      'jobs.validate-and-deploy.outputs.auto-enrollment'
    );
    const summary = deploy.jobs['deployment-summary']?.steps?.[0] as unknown as
      { env?: Record<string, string> } | undefined;
    expect(summary?.env?.['STAGING_AUTO_ENROLLMENT']).toContain("outputs['auto-enrollment']");
    expect(summary?.env?.['PRODUCTION_AUTO_ENROLLMENT']).toContain("outputs['auto-enrollment']");
  });

  it('keeps Staging before the protected Production job, one release SHA and serialized runs', () => {
    expect(job.environment).toBe('${{ inputs.github-environment }}');
    const staging = deploy.jobs['deploy-to-staging'];
    const production = deploy.jobs['deploy-to-production'];
    expect(staging?.uses).toBe('./.github/workflows/validate-and-deploy.yml');
    expect(production?.uses).toBe('./.github/workflows/validate-and-deploy.yml');
    expect(staging?.with?.['github-environment']).toBe('staging');
    expect(production?.with?.['github-environment']).toBe('production');
    expect(production?.needs).toBe('deploy-to-staging');
    expect(deploy.concurrency['cancel-in-progress']).toBe(false);
  });
});

describe('configure-control-tower-auto-enrollment composite action', () => {
  const actionSteps = action.runs.steps;
  const guard = actionSteps[0];

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

  it('is a composite action that accepts staging and production and rejects anything else first', () => {
    expect(action.runs.using).toBe('composite');
    expect(guard?.name).toMatch(/^Refuse unsupported environments/);
    expect(runGuard('staging')).toBe(0);
    expect(runGuard('production')).toBe(0);
    expect(runGuard('dev')).not.toBe(0);
    expect(runGuard('')).not.toBe(0);
  });

  it('acquires every credential through the reusable aws-credentials action, before each phase', () => {
    const uses = actionSteps.map((step) => step.uses).filter((value) => value !== undefined);
    expect(uses).toHaveLength(5);
    expect(new Set(uses)).toEqual(new Set([CREDENTIALS]));
    const text = readFileSync('.github/actions/configure-control-tower-auto-enrollment/action.yml', 'utf8');
    expect(text).not.toContain('configure-aws-credentials');
    expect(text).not.toContain('assume-role-with-web-identity');
    expect(text).not.toContain('id-token');
    for (const [position, step] of actionSteps.entries()) {
      if (step.run?.includes('configure:control-tower-auto-enrollment') === true) {
        expect(actionSteps[position - 1]?.uses).toBe(CREDENTIALS);
      }
    }
  });

  it('runs plan, then up to three apply rounds, then verification, in that order', () => {
    const scripts = actionSteps.map((step) => step.run ?? '');
    const plan = scripts.findIndex((run) => run.includes('--mode plan'));
    const applies = scripts.flatMap((run, position) => (run.includes('--mode apply') ? [position] : []));
    const verify = scripts.findIndex((run) => run.includes('--mode verify'));
    expect(plan).toBeGreaterThan(0);
    expect(applies).toHaveLength(3);
    expect(applies[0]).toBeGreaterThan(plan);
    expect(verify).toBeGreaterThan(applies[2] ?? Number.POSITIVE_INFINITY);
    const guardOf = (id: string) => actionSteps.find((step) => step.id === id)?.if;
    expect(guardOf('round_2')).toBe("${{ steps.round_1.outputs.status == 'continue' }}");
    expect(guardOf('round_3')).toBe("${{ steps.round_2.outputs.status == 'continue' }}");
  });

  it('re-runs the existing read-only enrollment validator only after a Landing Zone operation', () => {
    const validator = actionSteps.find((step) => step.run?.includes('validate:control-tower-enrollment') === true);
    expect(validator?.if).toBe("${{ steps.rounds.outputs.operation-identifier != '' }}");
    expect(actionSteps.indexOf(validator ?? {})).toBeGreaterThan(actionSteps.findIndex((step) => step.id === 'verify'));
  });

  it('fails the step with a re-run instruction unless the last round completed', () => {
    const check = actionSteps.find((step) => step.id === 'rounds');
    for (const [statuses, ok] of [
      ['complete', true],
      ['continue complete', true],
      ['continue continue continue', false],
      ['job-budget-exhausted', false],
      ['', false]
    ] as const) {
      let status = 0;
      try {
        execFileSync('bash', ['-c', check?.run ?? 'exit 99'], {
          env: {
            ...process.env,
            STATUSES: statuses,
            STATE_FILE: join(tmpdir(), 'ct-auto-enrollment-missing-ledger.json'),
            GITHUB_OUTPUT: join(tmpdir(), 'ct-auto-enrollment-test-github-output')
          },
          stdio: 'pipe'
        });
      } catch (error) {
        status = (error as { status?: number }).status ?? 1;
      }
      expect(status === 0).toBe(ok);
    }
  });

  it('exposes the verified setting, the operation and whether an update was submitted', () => {
    expect(action.outputs['auto-enrollment']?.value).toBe('${{ steps.verify.outputs.auto-enrollment }}');
    expect(action.outputs['operation-identifier']?.value).toBe('${{ steps.rounds.outputs.operation-identifier }}');
    expect(action.outputs['update-submitted']?.value).toBe('${{ steps.rounds.outputs.update-submitted }}');
  });
});

describe('the only UpdateLandingZone code path', () => {
  function files(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) return entry === 'node_modules' ? [] : files(path);
      return /\.(ts|ya?ml|sh|mjs|js)$/.test(entry) ? [path] : [];
    });
  }
  const code = ['bin', 'lib', 'scripts', 'src', join('.github', 'actions'), join('.github', 'workflows')].flatMap(
    (directory) => files(directory)
  );
  const normalise = (path: string) => path.split('\\').join('/');

  it('calls update-landing-zone only from the auto-enrollment script', () => {
    const callers = code.filter((path) => readFileSync(path, 'utf8').includes('update-landing-zone'));
    expect(callers.map(normalise)).toEqual(['scripts/configure-control-tower-auto-enrollment.ts']);
  });

  it('never calls reset-landing-zone anywhere', () => {
    expect(code.filter((path) => readFileSync(path, 'utf8').includes('reset-landing-zone'))).toEqual([]);
  });

  it('keeps baseline and Landing Zone creation calls out of the auto-enrollment component', () => {
    for (const path of [
      'scripts/configure-control-tower-auto-enrollment.ts',
      'lib/control-tower/landing-zone-auto-enrollment.ts',
      '.github/actions/configure-control-tower-auto-enrollment/action.yml'
    ]) {
      const text = readFileSync(path, 'utf8');
      for (const forbidden of ['enable-baseline', 'reset-enabled-baseline', 'create-landing-zone', 'move-account']) {
        expect(text, `${path} must not call ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('keeps every AWS-backed auto-enrollment entry point and Landing Zone write API out of CI', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).not.toContain('configure:control-tower-auto-enrollment');
    expect(ci).not.toContain('update-landing-zone');
    expect(ci).not.toContain('reset-landing-zone');
    expect(ci).not.toMatch(/configure-control-tower-auto-enrollment.*--mode/);
  });
});
