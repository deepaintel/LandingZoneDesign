import { describe, expect, it } from 'vitest';

import {
  ApplyFailedError,
  PreflightBlockedError,
  runApplyRound,
  type ApplyRoundResult
} from '../lib/account-baseline/apply.js';
import { buildBaselinePlan, memberIdentityProblems } from '../lib/account-baseline/plan.js';
import { buildReport, renderReportMarkdown } from '../lib/account-baseline/report.js';
import type { AccountBaselineControlId } from '../lib/account-baseline/types.js';
import { AwsCallError } from '../lib/account-baseline/types.js';
import {
  compliantState,
  CUSTOMER_KEY_ARN,
  fakeEnvironment,
  totalWrites,
  type FakeEnvironment
} from './account-baseline-fakes.js';

/**
 * End-to-end behaviour of the environment-wide preflight gate, the apply round and the
 * post-deployment validation against in-memory accounts. Every write is counted; no AWS API is
 * called.
 */

const NO_CAPABILITY_PROBLEMS = new Map<AccountBaselineControlId, string[]>();
const TODAY = '2026-10-20';

function deps(env: FakeEnvironment, capabilityProblems = NO_CAPABILITY_PROBLEMS) {
  return {
    environment: env.environment,
    config: env.config,
    inventory: env.inventory,
    capabilityProblems,
    ledgers: env.ledgers,
    clock: env.clock,
    today: TODAY
  };
}

function budget(env: FakeEnvironment, roundSeconds = 3000, jobSeconds = 6 * 3600) {
  return { roundDeadlineMs: env.clock.now() + roundSeconds * 1000, jobDeadlineMs: env.clock.now() + jobSeconds * 1000 };
}

async function verify(env: FakeEnvironment) {
  return buildBaselinePlan({
    environment: env.environment,
    phase: 'post-apply',
    config: env.config,
    inventory: await env.inventory.snapshot(),
    openSession: (accountId) => env.inventory.openSession(accountId),
    capabilityProblems: NO_CAPABILITY_PROBLEMS,
    ledger: env.ledgers.read(),
    today: TODAY
  });
}

async function applyExpectingFailure(env: FakeEnvironment): Promise<Error> {
  try {
    await runApplyRound(deps(env), budget(env));
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the apply round to fail');
}

describe('one coordinated Staging deployment across all eight eligible accounts', () => {
  it('preflight passes, every account is applied in one round, and validation accepts 40/40 results', async () => {
    const env = fakeEnvironment('staging');
    const result: ApplyRoundResult = await runApplyRound(deps(env), budget(env));
    expect(result.status).toBe('complete');
    expect(env.accounts.size).toBe(8);
    // 1 S3 + 1 EBS + 2 IMDS (one per field) + 1 snapshot + 1 AMI per account.
    expect(result.writesPerformed).toBe(48);
    for (const account of env.accounts.values()) expect(account.writes).toHaveLength(6);

    const final = await verify(env);
    expect(final.acceptance.outcome).toBe('PASS');
    expect(final.acceptance.counts.COMPLIANT).toBe(40);
    expect(final.acceptance.counts.EXCLUDED).toBe(20); // Management, Audit, Log Archive, 1 Suspended x 5
    expect(
      final.rows.filter((row) => row.enforcement === 'enforced').every((row) => row.performedWrites.length > 0)
    ).toBe(true);

    const report = buildReport({ plan: final, ledger: env.ledgers.read(), generatedAt: 'now', commitSha: 'abc123' });
    expect(report.deploymentReadiness).toBe('PASS');
    expect(report.expected.enforcedAccounts).toBe(8);
    expect(report.actual.results).toBe(report.expected.results);
    expect(report.actual.writesPerformed).toBe(48);
    const markdown = renderReportMarkdown(report).join('\n');
    expect(markdown).toContain('Deployment readiness: **PASS**');
    expect(markdown).toContain('| staging | SharedServices |');
  });

  it('Production: the same implementation covers exactly the two eligible accounts (10 results)', async () => {
    const env = fakeEnvironment('production');
    await runApplyRound(deps(env), budget(env));
    const final = await verify(env);
    expect(env.accounts.size).toBe(2);
    expect(final.acceptance.outcome).toBe('PASS');
    expect(final.acceptance.counts.COMPLIANT).toBe(10);
  });

  it('never opens a session to, or writes in, an excluded account', async () => {
    const env = fakeEnvironment('staging');
    await runApplyRound(deps(env), budget(env));
    const excluded = [env.config.aws.accountId, '333333333333', '444444444444', '555555555555'];
    expect(env.inventory.opened.some((accountId) => excluded.includes(accountId))).toBe(false);
  });

  it('a rerun recognizes already compliant controls and writes nothing', async () => {
    const env = fakeEnvironment('staging');
    await runApplyRound(deps(env), budget(env));
    const before = totalWrites(env);
    env.ledger.current = { environment: 'staging', cells: {} }; // a new workflow run starts with an empty ledger
    const again = await runApplyRound(deps(env), budget(env));
    expect(again.writesPerformed).toBe(0);
    expect(totalWrites(env)).toBe(before);
    expect((await verify(env)).acceptance.outcome).toBe('PASS');
  });
});

describe('the pre-apply completeness gate: any blocker means zero AWS writes', () => {
  const blockers: [string, (env: FakeEnvironment) => void][] = [
    [
      'an unresolved REQUIRES_APPROVAL in one of 40 cells',
      (env) => {
        const account = [...env.accounts.values()][3];
        if (account) account.state.publicSnapshots = ['snap-0123456789abcdef0'];
      }
    ],
    [
      'an UNSUPPORTED API in one account',
      (env) => {
        [...env.accounts.values()][7]?.failures.set(
          'getInstanceMetadataDefaults',
          new AwsCallError('ec2 get-instance-metadata-defaults', 'UnsupportedOperation', 'unsupported', 'not available')
        );
      }
    ],
    [
      'an AccessDenied read',
      (env) => {
        [...env.accounts.values()][0]?.failures.set(
          'getEbsEncryptionByDefault',
          new AwsCallError('ec2 get-ebs-encryption-by-default', 'AccessDenied', 'access-denied', 'denied')
        );
      }
    ],
    [
      'a failed role assumption into one member account',
      (env) => {
        const accountId = [...env.accounts.keys()][5];
        if (accountId) env.inventory.sessionFailures.add(accountId);
      }
    ],
    [
      'a member session that is not the target account role',
      (env) => {
        const account = [...env.accounts.values()][2];
        if (account) account.identityArn = `arn:aws-eusc:sts::${account.accountId}:assumed-role/SomeOtherRole/x`;
      }
    ],
    [
      'a DryRun authorization failure',
      (env) => {
        [...env.accounts.values()][1]?.failures.set(
          'dryRun',
          new AwsCallError(
            'ec2 enable-ebs-encryption-by-default',
            'UnauthorizedOperation',
            'access-denied',
            'denied by SCP'
          )
        );
      }
    ],
    [
      'an unhealthy Landing Zone or enrollment',
      (env) => {
        env.inventory.problems.push('Landing Zone drift DRIFTED is not IN_SYNC');
      }
    ],
    [
      'a missing account in the live inventory',
      (env) => {
        env.inventory.live.pop();
      }
    ],
    [
      'an account that is not enrolled',
      (env) => {
        const first = env.inventory.live[0];
        if (first) env.inventory.live[0] = { ...first, enrolled: false };
      }
    ],
    [
      'an excluded (Audit) account resolved as a target',
      (env) => {
        const first = env.inventory.live[0];
        if (first) env.inventory.live[0] = { ...first, accountId: '333333333333' };
      }
    ],
    [
      'a duplicated target account',
      (env) => {
        const [first, second] = env.inventory.live;
        if (first && second) env.inventory.live[1] = { ...second, accountId: first.accountId };
      }
    ],
    [
      'an unexpected account in the live inventory',
      (env) => {
        env.inventory.live.push({
          key: 'stranger',
          name: 'Stranger',
          accountId: '200000000199',
          ouPath: 'Infrastructure',
          ouId: 'ou-ab12-99999999',
          enrolled: true
        });
      }
    ],
    [
      'an account found in an unexpected OU',
      (env) => {
        const first = env.inventory.live[0];
        if (first) env.inventory.live[0] = { ...first, ouPath: 'Sandbox' };
      }
    ]
  ];

  it.each(blockers)('%s', async (_label, inject) => {
    const env = fakeEnvironment('staging');
    inject(env);
    const error = await applyExpectingFailure(env);
    expect(error).toBeInstanceOf(PreflightBlockedError);
    expect(totalWrites(env)).toBe(0);
    expect((error as PreflightBlockedError).plan.acceptance.outcome).toBe('FAIL');
  });

  it('a local CLI capability gap makes the control UNSUPPORTED everywhere and blocks every write', async () => {
    const env = fakeEnvironment('staging');
    const error = await runApplyRound(
      deps(
        env,
        new Map([
          ['ec2-imds-defaults', ["AWS CLI on the runner does not support 'ec2 get-instance-metadata-defaults'"]]
        ])
      ),
      budget(env)
    ).catch((caught: unknown) => caught as PreflightBlockedError);
    expect(error).toBeInstanceOf(PreflightBlockedError);
    expect((error as PreflightBlockedError).plan.acceptance.counts.UNSUPPORTED).toBe(8);
    expect(totalWrites(env)).toBe(0);
  });

  it('inventory blockers stop before any member account is accessed (NOT_ASSESSED)', async () => {
    const env = fakeEnvironment('staging');
    env.inventory.problems.push('Caller identity check failed');
    const error = (await applyExpectingFailure(env)) as PreflightBlockedError;
    expect(env.inventory.opened).toEqual([]);
    expect(error.plan.acceptance.counts.NOT_ASSESSED).toBe(40);
  });
});

describe('apply failures stop further changes and report the partial state', () => {
  it('a write failure stops the run, keeps later accounts untouched and is reported by validation', async () => {
    const env = fakeEnvironment('staging');
    const third = [...env.accounts.values()][2];
    third?.writeFailures.set(
      'EnableSnapshotBlockPublicAccess',
      new AwsCallError('ec2 enable-snapshot-block-public-access', 'InternalError', 'other', 'service error')
    );
    const error = await applyExpectingFailure(env);
    expect(error).toBeInstanceOf(ApplyFailedError);
    const accounts = [...env.accounts.values()];
    expect(accounts[0]?.writes).toHaveLength(6);
    expect(accounts[1]?.writes).toHaveLength(6);
    expect(accounts[2]?.writes).toHaveLength(4); // S3, EBS, IMDS x2 before the snapshot failure
    for (const later of accounts.slice(3)) expect(later.writes).toEqual([]);
    expect(env.ledgers.read().failure).toMatch(/EnableSnapshotBlockPublicAccess/);

    const final = await verify(env);
    expect(final.acceptance.outcome).toBe('FAIL');
    const report = buildReport({ plan: final, ledger: env.ledgers.read(), generatedAt: 'now', commitSha: 'abc' });
    expect(report.deploymentReadiness).toBe('FAIL');
    expect(report.partialState.join(' ')).toMatch(/EnableSnapshotBlockPublicAccess.*failed/);
    expect(report.unresolvedIssues.join(' ')).toMatch(/apply stopped on a failure/);
  });

  it('a later round of the same run refuses to continue after a failure', async () => {
    const env = fakeEnvironment('staging');
    [...env.accounts.values()][0]?.writeFailures.set(
      'PutAccountPublicAccessBlock',
      new AwsCallError('s3control put-public-access-block', 'AccessDenied', 'access-denied', 'denied')
    );
    await applyExpectingFailure(env);
    [...env.accounts.values()][0]?.writeFailures.clear();
    const again = await applyExpectingFailure(env);
    expect(again.message).toMatch(/an earlier apply round of this run failed/);
    expect(totalWrites(env)).toBe(0);
  });

  it('a precondition that changed between the plan and the write stops the run without writing', async () => {
    const env = fakeEnvironment('staging');
    const first = [...env.accounts.values()][0];
    if (first === undefined) throw new Error('no account');
    const original = first.getSnapshotBlockPublicAccessState.bind(first);
    let reads = 0;
    first.getSnapshotBlockPublicAccessState = () => {
      reads += 1;
      if (reads === 2) first.state.publicSnapshots = ['snap-0new0public0000000'];
      return original();
    };
    const error = await applyExpectingFailure(env);
    expect(error.message).toMatch(/precondition changed/);
    expect(first.writes.some((write) => write.kind === 'EnableSnapshotBlockPublicAccess')).toBe(false);
  });

  it('an account that stopped being eligible right before the write stops the run', async () => {
    const env = fakeEnvironment('staging');
    const accountId = [...env.accounts.keys()][0] as string;
    env.inventory.ineligible.set(accountId, ['account state is SUSPENDED, not ACTIVE']);
    const error = await applyExpectingFailure(env);
    expect(error.message).toMatch(/no longer eligible/);
    expect(totalWrites(env)).toBe(0);
  });

  it('waits with bounded polling for an eventually consistent AMI setting', async () => {
    const env = fakeEnvironment('production');
    for (const account of env.accounts.values()) account.imageLag = 5;
    const result = await runApplyRound(deps(env), budget(env));
    expect(result.status).toBe('complete');
    expect((await verify(env)).acceptance.outcome).toBe('PASS');
  });

  it('fails when a setting does not read back within its settle budget', async () => {
    const env = fakeEnvironment('production');
    const first = [...env.accounts.values()][0];
    if (first) first.imageLag = 1000;
    const error = await applyExpectingFailure(env);
    expect(error.message).toMatch(/did not read back COMPLIANT within 720s/);
  });

  it('fails when the default EBS KMS key changes during the write', async () => {
    const env = fakeEnvironment('production');
    const first = [...env.accounts.values()][0];
    if (first === undefined) throw new Error('no account');
    const write = first.write.bind(first);
    first.write = (request) => {
      write(request);
      if (request.kind === 'EnableEbsEncryptionByDefault') first.state.ebsKeyId = CUSTOMER_KEY_ARN;
    };
    first.state.keys[CUSTOMER_KEY_ARN] = {
      arn: CUSTOMER_KEY_ARN,
      keyManager: 'CUSTOMER',
      keyState: 'Enabled',
      aliases: []
    };
    const error = await applyExpectingFailure(env);
    expect(error.message).toMatch(/default EBS KMS key changed/);
  });

  it('validation flags a default KMS key that differs from the first observation of the run', async () => {
    const env = fakeEnvironment('production');
    await runApplyRound(deps(env), budget(env));
    const first = [...env.accounts.values()][0];
    if (first === undefined) throw new Error('no account');
    first.state.ebsKeyId = CUSTOMER_KEY_ARN;
    first.state.keys[CUSTOMER_KEY_ARN] = {
      arn: CUSTOMER_KEY_ARN,
      keyManager: 'CUSTOMER',
      keyState: 'Enabled',
      aliases: []
    };
    const final = await verify(env);
    expect(final.acceptance.outcome).toBe('FAIL');
    expect(
      final.rows.find((row) => row.accountId === first.accountId && row.control === 'ebs-encryption-by-default')?.status
    ).not.toBe('COMPLIANT');
  });
});

describe('budgets', () => {
  it('stops before a write that cannot finish inside the credential window and resumes in the next round', async () => {
    const env = fakeEnvironment('staging');
    const first = await runApplyRound(deps(env), budget(env, 1200));
    expect(first.status).toBe('continue');
    const partial = totalWrites(env);
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(48);
    let status = first.status;
    for (let round = 0; round < 10 && status === 'continue'; round += 1) {
      status = (await runApplyRound(deps(env), budget(env, 3000))).status;
    }
    expect(status).toBe('complete');
    expect(totalWrites(env)).toBe(48);
    expect((await verify(env)).acceptance.outcome).toBe('PASS');
  });

  it('reports job-budget-exhausted instead of starting a write near the job timeout', async () => {
    const env = fakeEnvironment('staging');
    const result = await runApplyRound(deps(env), budget(env, 3000, 60));
    expect(result.status).toBe('job-budget-exhausted');
    expect(totalWrites(env)).toBe(0);
  });
});

describe('validation without apply', () => {
  it('NON_COMPLIANT after (no) apply fails the acceptance gate', async () => {
    const env = fakeEnvironment('staging');
    const final = await verify(env);
    expect(final.acceptance.outcome).toBe('FAIL');
    expect(final.acceptance.counts.NON_COMPLIANT).toBe(40);
  });

  it('an already compliant environment passes without any write', async () => {
    const env = fakeEnvironment('staging', compliantState);
    const result = await runApplyRound(deps(env), budget(env));
    expect(result.writesPerformed).toBe(0);
    expect((await verify(env)).acceptance.outcome).toBe('PASS');
  });
});

describe('member session identity', () => {
  it('accepts only the target account through OrganizationAccountAccessRole in aws-eusc', () => {
    const expected = { accountId: '200000000100', partition: 'aws-eusc' };
    expect(
      memberIdentityProblems(
        { Account: '200000000100', Arn: 'arn:aws-eusc:sts::200000000100:assumed-role/OrganizationAccountAccessRole/s' },
        expected
      )
    ).toEqual([]);
    expect(memberIdentityProblems({ Account: '200000000101', Arn: 'x' }, expected)).toHaveLength(2);
  });
});
