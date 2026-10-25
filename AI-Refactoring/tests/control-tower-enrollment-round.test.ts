import { describe, expect, it } from 'vitest';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema, type LandingZoneConfig } from '../config/schemas/organization-schema.js';
import {
  accountArn,
  classifyTarget,
  deriveEnrollmentTargets,
  plannedAction,
  type BaselineOperation,
  type EnabledBaselineSummary,
  type ExecutionRoleModel,
  type PlannedAction
} from '../lib/control-tower/baseline-enrollment.js';
import { toDesiredLandingZoneAccounts } from '../lib/organization/landing-zone-account-reconciler.js';
import type { EnrollmentPlan, PlannedTarget } from '../scripts/control-tower-enrollment-runtime.js';
import {
  CONVERGENCE_TIMEOUT_MINUTES,
  runEnrollmentRound,
  type EnrollmentClock,
  type EnrollmentOperations,
  type LedgerStore,
  type RunLedger
} from '../scripts/enroll-control-tower-accounts.js';

/**
 * Round-level behaviour of the enrollment state machine against an in-memory AWS Control Tower.
 * The plan is re-derived from live fake state with the real `classifyTarget`, so every
 * EnableBaseline / ResetEnabledBaseline call can be counted.
 */

const PARTITION = 'aws-eusc';
const REGION = 'eusc-de-east-1';
const MANAGEMENT = '111111111111';
const ORG = 'o-abcdefghij';
const CT_BASELINE = `arn:${PARTITION}:controltower:${REGION}::baseline/17BSJV3IGJ2QSGA2`;
const OPERATION = '58f12232-26be-4735-a3e9-dd30d90f021f';

function load(environment: 'staging' | 'production'): LandingZoneConfig {
  return new ConfigReader(environment, { configDirName: 'config', schema: LandingZoneSchema }).getConfig();
}

interface FakeOptions {
  readonly environment: 'staging' | 'production';
  readonly autoEnrollment?: boolean;
  readonly problems?: readonly string[];
  /** Child baselines appear this many convergence reads after the run starts (auto-enrollment). */
  readonly autoEnrollAfterReads?: number;
  readonly resetOutcome?: 'SUCCEEDED' | 'FAILED';
  /** When set, every GetBaselineOperation returns this `baselineOperation` value as is. */
  readonly operationResponse?: { readonly value: unknown };
}

class FakeControlTower implements EnrollmentOperations {
  public readonly enableCalls: string[] = [];
  public readonly resetCalls: string[] = [];
  public readonly config: LandingZoneConfig;
  private readonly records = new Map<string, EnabledBaselineSummary>();
  private readonly children = new Map<string, EnabledBaselineSummary[]>();
  private readonly operations = new Map<string, BaselineOperation>();
  private childReads = 0;
  private readonly accountsByOu = new Map<string, string[]>();
  private operationCount = 0;

  public constructor(private readonly options: FakeOptions) {
    this.config = load(options.environment);
    const accounts = toDesiredLandingZoneAccounts(this.config.landingZoneAccounts);
    accounts.forEach((account, index) => {
      const id = String(200000000000 + index);
      const list = this.accountsByOu.get(account.ouPath) ?? [];
      list.push(accountArn(PARTITION, MANAGEMENT, ORG, id));
      this.accountsByOu.set(account.ouPath, list);
    });
  }

  private readonly ouIds = new Map<string, string>();

  /** A unique, stable synthetic OU ARN per OU path. */
  public ouArn(ouPath: string): string {
    let id = this.ouIds.get(ouPath);
    if (id === undefined) {
      id = `ou-ab12-${String(this.ouIds.size + 1).padStart(8, '0')}`;
      this.ouIds.set(ouPath, id);
    }
    return `arn:${PARTITION}:organizations::${MANAGEMENT}:ou/${ORG}/${id}`;
  }

  /** Marks an OU as governed, optionally without child baselines for some accounts. */
  public govern(ouPath: string, overrides: Partial<EnabledBaselineSummary> = {}, enrolledAccounts?: string[]): void {
    const record: EnabledBaselineSummary = {
      arn: `arn:${PARTITION}:controltower:${REGION}:${MANAGEMENT}:enabledbaseline/X${ouPath.replace(/\W/g, '').toUpperCase()}`,
      baselineIdentifier: CT_BASELINE,
      baselineVersion: '5.0',
      targetIdentifier: this.ouArn(ouPath),
      statusSummary: { status: 'SUCCEEDED', lastOperationIdentifier: OPERATION },
      ...overrides
    };
    this.records.set(record.targetIdentifier, record);
    const accounts = enrolledAccounts ?? this.accountsByOu.get(ouPath) ?? [];
    this.children.set(
      record.arn,
      accounts.map((arn) => this.child(record.arn, arn))
    );
  }

  /** Overrides fields of the child baseline of the `index`-th account of a governed OU. */
  public setChild(ouPath: string, index: number, overrides: Partial<EnabledBaselineSummary>): void {
    const record = this.records.get(this.ouArn(ouPath));
    if (record === undefined) throw new Error(`${ouPath} is not governed`);
    const target = this.accountsIn(ouPath)[index];
    const children = (this.children.get(record.arn) ?? []).map((entry) =>
      entry.targetIdentifier === target ? { ...entry, ...overrides } : entry
    );
    this.children.set(record.arn, children);
  }

  public accountsIn(ouPath: string): string[] {
    return this.accountsByOu.get(ouPath) ?? [];
  }

  private child(parent: string, target: string): EnabledBaselineSummary {
    return {
      arn: `${parent}C${target.split('/').at(-1) ?? ''}`,
      baselineIdentifier: CT_BASELINE,
      baselineVersion: '5.0',
      targetIdentifier: target,
      parentIdentifier: parent,
      statusSummary: { status: 'SUCCEEDED' }
    };
  }

  public async plan(): Promise<EnrollmentPlan> {
    const order = this.config.controlTower.enrollment?.rolloutOrder ?? [];
    const desired = toDesiredLandingZoneAccounts(this.config.landingZoneAccounts);
    const actions = new Map<string, PlannedAction>();
    const targets: PlannedTarget[] = deriveEnrollmentTargets(order, desired).map((target) => {
      const ouArn = this.ouArn(target.ouPath);
      const accounts = this.accountsIn(target.ouPath);
      const records = this.listEnabledBaselines({ targetIdentifiers: [ouArn] });
      const record = records[0];
      const childRecords = record === undefined ? [] : (this.children.get(record.arn) ?? []);
      const parent = target.parentPath === undefined ? undefined : actions.get(target.parentPath);
      const state = classifyTarget({
        ouPath: target.ouPath,
        ouArn,
        scope: { partition: PARTITION, region: REGION, managementAccountId: MANAGEMENT, organizationId: ORG },
        targetRecords: records,
        childRecords,
        expectedAccountArns: accounts,
        controlTowerBaselineArn: CT_BASELINE,
        configBaselineArn: undefined,
        expectedVersion: '5.0',
        parentState:
          target.parentPath === undefined
            ? 'top-level'
            : parent === 'none' || parent === 'converge'
              ? 'governed'
              : parent === 'stop'
                ? 'not-governed'
                : 'planned'
      });
      const action = plannedAction(state, false, this.options.autoEnrollment ?? false);
      actions.set(target.ouPath, action);
      return {
        target,
        ouId: ouArn.split('/').at(-1) ?? '',
        ouArn,
        accounts: accounts.map((arn, index) => ({
          key: `${target.ouPath}-${index}`,
          name: `account-${index}`,
          email: `account-${index}@example.com`,
          ouPath: target.ouPath,
          accountId: arn.split('/').at(-1) ?? '',
          accountArn: arn,
          enrolled: childRecords.some((childRecord) => childRecord.targetIdentifier === arn)
        })),
        state,
        action,
        headroom: {
          ouPath: target.ouPath,
          directlyAttached: 2,
          fullAwsAccessAttached: true,
          controlTowerManagedAttached: 0,
          expectedControlTowerAdditions: 1,
          projected: 3,
          quota: 10,
          ok: true
        },
        iamEscalationGuarded: target.ouPath.startsWith('Workloads')
      };
    });
    return {
      config: this.config,
      partition: PARTITION,
      region: REGION,
      managementAccountId: MANAGEMENT,
      organizationId: ORG,
      landingZone: { version: '4.0', status: 'ACTIVE', driftStatus: 'IN_SYNC' },
      autoEnrollment: {
        enabled: this.options.autoEnrollment ?? false,
        remediationTypes: this.options.autoEnrollment === true ? ['INHERITANCE_DRIFT'] : []
      },
      controlTowerBaseline: { arn: CT_BASELINE, name: 'AWSControlTowerBaseline' },
      configBaseline: undefined,
      version: { version: '5.0', source: 'compatibility-table' },
      targets,
      security: { ouId: 'ou-ab12-security1', ouArn: this.ouArn('Security'), integrationBaselines: [] },
      problems: this.options.problems ?? []
    };
  }

  public configPrecheck(): string[] {
    return [];
  }

  public executionRoleModel(): ExecutionRoleModel {
    return { controlTowerExecutionRolePresent: true, stackSetsExecutionRoles: ['stacksets-exec-0123'], problems: [] };
  }

  public listEnabledBaselines(filter: Readonly<Record<string, readonly string[]>>): EnabledBaselineSummary[] {
    const target = filter['targetIdentifiers']?.[0];
    if (target !== undefined) {
      const record = this.records.get(target);
      return record === undefined ? [] : [record];
    }
    const parent = filter['parentIdentifiers']?.[0];
    if (parent !== undefined) {
      this.childReads += 1;
      const after = this.options.autoEnrollAfterReads;
      if (after !== undefined && this.childReads >= after) {
        // AWS Control Tower auto-enrollment has finished: every account in the OU is enrolled.
        const record = [...this.records.values()].find((entry) => entry.arn === parent);
        const ouPath = [...this.accountsByOu.keys()].find((path) => this.ouArn(path) === record?.targetIdentifier);
        if (ouPath !== undefined)
          this.children.set(
            parent,
            this.accountsIn(ouPath).map((arn) => this.child(parent, arn))
          );
      }
      return this.children.get(parent) ?? [];
    }
    return [...this.records.values()];
  }

  public getBaselineOperation(operationIdentifier: string): BaselineOperation | undefined {
    if (this.options.operationResponse !== undefined) {
      return this.options.operationResponse.value as BaselineOperation | undefined;
    }
    return this.operations.get(operationIdentifier) ?? { operationIdentifier, status: 'SUCCEEDED' };
  }

  private nextOperation(status: 'SUCCEEDED' | 'FAILED'): string {
    this.operationCount += 1;
    const id = `00000000-0000-4000-8000-${String(this.operationCount).padStart(12, '0')}`;
    this.operations.set(id, { operationIdentifier: id, status, startTime: new Date(0).toISOString() });
    return id;
  }

  public enableBaseline(_baselineArn: string, _version: string, ouArn: string): { operationIdentifier?: string } {
    const ouPath = (this.config.controlTower.enrollment?.rolloutOrder ?? []).find((path) => this.ouArn(path) === ouArn);
    if (ouPath === undefined) throw new Error(`unknown OU ${ouArn}`);
    this.enableCalls.push(ouPath);
    this.govern(ouPath);
    return { operationIdentifier: this.nextOperation('SUCCEEDED') };
  }

  public resetEnabledBaseline(enabledBaselineArn: string): { operationIdentifier?: string } {
    const record = [...this.records.values()].find((entry) => entry.arn === enabledBaselineArn);
    const ouPath = [...this.accountsByOu.keys(), 'Sandbox', 'Workloads'].find(
      (path) => this.ouArn(path) === record?.targetIdentifier
    );
    this.resetCalls.push(ouPath ?? enabledBaselineArn);
    if (this.options.resetOutcome === 'FAILED') {
      return { operationIdentifier: this.nextOperation('FAILED') };
    }
    if (ouPath !== undefined) this.govern(ouPath);
    return { operationIdentifier: this.nextOperation('SUCCEEDED') };
  }

  public diagnose(): string[] {
    return ['diagnostics'];
  }
}

function fakeClock(): EnrollmentClock & { slept: number } {
  let now = 1_000_000;
  const clock = {
    slept: 0,
    now: () => now,
    sleep: async (seconds: number) => {
      clock.slept += 1;
      now += seconds * 1000;
    }
  };
  return clock;
}

function memoryLedger(initial?: Partial<RunLedger>): LedgerStore {
  let ledger: RunLedger = { resets: {}, executionRoleModelConfirmed: false, convergenceStartedAt: {}, ...initial };
  return {
    read: () => JSON.parse(JSON.stringify(ledger)) as RunLedger,
    write: (next) => {
      ledger = JSON.parse(JSON.stringify(next)) as RunLedger;
    }
  };
}

const ROUND = { sessionBudgetSeconds: 10_000_000, jobDeadlineEpoch: undefined, log: () => undefined };

const ROLLOUT_ORDER = [
  'Infrastructure',
  'Sandbox',
  'Workloads',
  'Workloads/Corp',
  'Workloads/Corp/Non-Prod',
  'Workloads/Hybrid',
  'Workloads/Online',
  'Workloads/Hybrid/Non-Prod',
  'Workloads/Online/Non-Prod',
  'Workloads/Corp/Prod',
  'Workloads/Hybrid/Prod',
  'Workloads/Online/Prod'
];

describe.each(['staging', 'production'] as const)('enrollment round (%s)', (environment) => {
  it('a failed plan stops the round before any EnableBaseline call', async () => {
    const fake = new FakeControlTower({ environment, problems: ['Landing Zone status PROCESSING is not ACTIVE'] });
    await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).rejects.toThrow(/prechecks failed/);
    expect(fake.enableCalls).toEqual([]);
    expect(fake.resetCalls).toEqual([]);
  });

  it('enables all 12 OUs in parent-before-child order, empty OUs included', async () => {
    const fake = new FakeControlTower({ environment });
    await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).resolves.toBe('complete');
    expect(fake.enableCalls).toEqual(ROLLOUT_ORDER);
  });

  it('skips OUs that are already governed at the expected version', async () => {
    const fake = new FakeControlTower({ environment });
    for (const ouPath of ROLLOUT_ORDER) fake.govern(ouPath);
    await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).resolves.toBe('complete');
    expect(fake.enableCalls).toEqual([]);
    expect(fake.resetCalls).toEqual([]);
  });

  it('fails closed on an incompatible baseline version without any mutation', async () => {
    const fake = new FakeControlTower({ environment });
    fake.govern('Infrastructure', { baselineVersion: '4.0' });
    await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).rejects.toThrow(/version '4.0'/);
    expect(fake.enableCalls).toEqual([]);
  });

  it('polls an UNDER_CHANGE OU instead of submitting a duplicate EnableBaseline', async () => {
    const fake = new FakeControlTower({ environment });
    fake.govern('Infrastructure', { statusSummary: { status: 'UNDER_CHANGE', lastOperationIdentifier: OPERATION } });
    const ledger = memoryLedger();
    // The fake reports the existing operation as SUCCEEDED but leaves the record UNDER_CHANGE, so
    // post-operation validation fails: what matters is that no new operation was submitted.
    await expect(runEnrollmentRound(fake, fakeClock(), ledger, ROUND)).rejects.toThrow(/expected governed/);
    expect(fake.enableCalls).toEqual([]);
    expect(fake.resetCalls).toEqual([]);
  });

  it('recovers a previously FAILED OU with exactly one reset and stops when it fails again', async () => {
    const fake = new FakeControlTower({ environment, resetOutcome: 'FAILED' });
    fake.govern('Infrastructure', { statusSummary: { status: 'FAILED' } });
    const ledger = memoryLedger();
    await expect(runEnrollmentRound(fake, fakeClock(), ledger, ROUND)).rejects.toThrow(
      /Enrollment of Infrastructure failed/
    );
    expect(fake.resetCalls).toEqual(['Infrastructure']);
    // A later round of the same run may not reset again.
    await expect(runEnrollmentRound(fake, fakeClock(), ledger, ROUND)).rejects.toThrow(/single reset for this run/);
    expect(fake.resetCalls).toEqual(['Infrastructure']);
    expect(fake.enableCalls).toEqual([]);
  });

  describe('GetBaselineOperation responses', () => {
    const MALFORMED: ReadonlyArray<readonly [string, unknown]> = [
      ['a missing status', { operationIdentifier: OPERATION }],
      ['an empty status', { operationIdentifier: OPERATION, status: '' }],
      ['an unknown status', { operationIdentifier: OPERATION, status: 'CANCELLED' }],
      ['a missing baselineOperation', undefined],
      ['a malformed baselineOperation', 'FAILED']
    ];

    function underChange(value: unknown): FakeControlTower {
      const fake = new FakeControlTower({ environment, operationResponse: { value } });
      fake.govern('Infrastructure', { statusSummary: { status: 'UNDER_CHANGE', lastOperationIdentifier: OPERATION } });
      return fake;
    }

    it('a documented FAILED operation takes the FAILED-operation path', async () => {
      const fake = underChange({ operationIdentifier: OPERATION, status: 'FAILED' });
      await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).rejects.toThrow(
        /Enrollment of Infrastructure failed/
      );
      expect(fake.enableCalls).toEqual([]);
      expect(fake.resetCalls).toEqual([]);
    });

    it('a documented IN_PROGRESS operation is polled, never resubmitted', async () => {
      const fake = underChange({
        operationIdentifier: OPERATION,
        status: 'IN_PROGRESS',
        startTime: new Date(0).toISOString()
      });
      await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).rejects.toThrow(
        /IN_PROGRESS for more than/
      );
      expect(fake.enableCalls).toEqual([]);
      expect(fake.resetCalls).toEqual([]);
    });

    it.each(MALFORMED)(
      '%s while polling an existing operation fails closed with no mutation',
      async (_label, value) => {
        const fake = underChange(value);
        const ledger = memoryLedger();
        const run = runEnrollmentRound(fake, fakeClock(), ledger, ROUND);
        await expect(run).rejects.toThrow(/malformed response/);
        await expect(run).rejects.not.toThrow(/Enrollment of Infrastructure failed/);
        expect(fake.enableCalls).toEqual([]);
        expect(fake.resetCalls).toEqual([]);
        expect(ledger.read().resets).toEqual({});
      }
    );

    it.each(MALFORMED)('%s after EnableBaseline fails closed with no further mutation', async (_label, value) => {
      const fake = new FakeControlTower({ environment, operationResponse: { value } });
      await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).rejects.toThrow(/malformed response/);
      expect(fake.enableCalls).toEqual(['Infrastructure']);
      expect(fake.resetCalls).toEqual([]);
    });

    it.each(MALFORMED)('%s after the single reset fails closed with no further mutation', async (_label, value) => {
      const fake = new FakeControlTower({ environment, operationResponse: { value } });
      fake.govern('Infrastructure', { statusSummary: { status: 'FAILED' } });
      await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).rejects.toThrow(/malformed response/);
      expect(fake.resetCalls).toEqual(['Infrastructure']);
      expect(fake.enableCalls).toEqual([]);
    });
  });

  it('a Security OU baseline violation in the plan prevents every mutation', async () => {
    const fake = new FakeControlTower({
      environment,
      problems: [
        'Security OU has ConfigBaseline enabled (arn:aws-eusc:controltower:eusc-de-east-1:111111111111:enabledbaseline/XSEC)'
      ]
    });
    await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).rejects.toThrow(
      /ConfigBaseline enabled/
    );
    expect(fake.enableCalls).toEqual([]);
    expect(fake.resetCalls).toEqual([]);
  });

  describe('malformed or drifted child baseline state in governed Infrastructure', () => {
    function governedWithChild(overrides: Partial<EnabledBaselineSummary>, autoEnrollment = false): FakeControlTower {
      const fake = new FakeControlTower({ environment, autoEnrollment });
      for (const ouPath of ROLLOUT_ORDER) fake.govern(ouPath);
      fake.setChild('Infrastructure', 0, overrides);
      return fake;
    }

    it.each([
      ['UNDER_CHANGE without an operation identifier', { statusSummary: { status: 'UNDER_CHANGE' } }],
      [
        'UNDER_CHANGE with a malformed operation identifier',
        { statusSummary: { status: 'UNDER_CHANGE', lastOperationIdentifier: 'x' } }
      ],
      ['an unknown status', { statusSummary: { status: 'MYSTERY' } }],
      ['a missing version', { baselineVersion: undefined }],
      ['an incompatible version', { baselineVersion: '4.0' }],
      ['malformed drift metadata', { driftStatusSummary: { types: { inheritance: { status: 'MAYBE' } } } }],
      ['a malformed target', { targetIdentifier: 'arn:aws-eusc:organizations::111111111111:account/o-abcdefghij/12' }]
    ] as const)('%s fails closed with no EnableBaseline or ResetEnabledBaseline', async (_label, overrides) => {
      for (const autoEnrollment of [false, true]) {
        const fake = governedWithChild(overrides as Partial<EnabledBaselineSummary>, autoEnrollment);
        await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).rejects.toThrow(/cannot continue/);
        expect(fake.enableCalls).toEqual([]);
        expect(fake.resetCalls).toEqual([]);
      }
    });

    it('a DRIFTED child takes one bounded reset when auto-enrollment is disabled', async () => {
      const fake = governedWithChild({ driftStatusSummary: { types: { inheritance: { status: 'DRIFTED' } } } });
      await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).resolves.toBe('complete');
      expect(fake.resetCalls).toEqual(['Infrastructure']);
      expect(fake.enableCalls).toEqual([]);
    });

    it('a DRIFTED child is awaited, never reset, when auto-enrollment is enabled', async () => {
      const fake = governedWithChild({ driftStatusSummary: { types: { inheritance: { status: 'DRIFTED' } } } }, true);
      await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).rejects.toThrow(/did not converge/);
      expect(fake.resetCalls).toEqual([]);
      expect(fake.enableCalls).toEqual([]);
    });
  });

  describe('a moved account that is not yet enrolled in governed Infrastructure', () => {
    function movedAccount(options: Omit<FakeOptions, 'environment'>): FakeControlTower {
      const fake = new FakeControlTower({ environment, ...options });
      for (const ouPath of ROLLOUT_ORDER) fake.govern(ouPath);
      // The second Infrastructure account has just been moved in and has no child baseline yet.
      fake.govern('Infrastructure', {}, fake.accountsIn('Infrastructure').slice(0, 1));
      return fake;
    }

    it('auto-enrollment disabled: one bounded ResetEnabledBaseline, then validated', async () => {
      const fake = movedAccount({ autoEnrollment: false });
      await expect(runEnrollmentRound(fake, fakeClock(), memoryLedger(), ROUND)).resolves.toBe('complete');
      expect(fake.resetCalls).toEqual(['Infrastructure']);
      expect(fake.enableCalls).toEqual([]);
    });

    it('auto-enrollment enabled: bounded polling until AWS converges, with no competing reset', async () => {
      const fake = movedAccount({ autoEnrollment: true, autoEnrollAfterReads: 4 });
      const clock = fakeClock();
      await expect(runEnrollmentRound(fake, clock, memoryLedger(), ROUND)).resolves.toBe('complete');
      expect(fake.resetCalls).toEqual([]);
      expect(fake.enableCalls).toEqual([]);
      expect(clock.slept).toBeGreaterThan(0);
    });

    it('auto-enrollment enabled: fails closed after the convergence bound, still without a reset', async () => {
      const fake = movedAccount({ autoEnrollment: true });
      const clock = fakeClock();
      await expect(runEnrollmentRound(fake, clock, memoryLedger(), ROUND)).rejects.toThrow(
        new RegExp(`did not converge within ${CONVERGENCE_TIMEOUT_MINUTES} minutes`)
      );
      expect(fake.resetCalls).toEqual([]);
      expect(clock.now() - 1_000_000).toBeGreaterThanOrEqual(CONVERGENCE_TIMEOUT_MINUTES * 60 * 1000);
    });

    it('auto-enrollment enabled: the convergence bound spans credential rounds and never resets', async () => {
      const fake = movedAccount({ autoEnrollment: true });
      const clock = fakeClock();
      const ledger = memoryLedger();
      const options = { sessionBudgetSeconds: 1200, jobDeadlineEpoch: undefined, log: () => undefined };
      const statuses: string[] = [];
      let failure: unknown;
      for (let attempt = 0; attempt < 10 && failure === undefined; attempt += 1) {
        try {
          statuses.push(await runEnrollmentRound(fake, clock, ledger, options));
        } catch (error) {
          failure = error;
        }
      }
      expect(statuses.length).toBeGreaterThan(1);
      expect(new Set(statuses)).toEqual(new Set(['continue']));
      expect(String(failure)).toMatch(new RegExp(`did not converge within ${CONVERGENCE_TIMEOUT_MINUTES} minutes`));
      // Measured from the first observation in the run, not restarted by every credential round.
      expect(clock.now() - 1_000_000).toBeLessThan((CONVERGENCE_TIMEOUT_MINUTES + 5) * 60 * 1000);
      expect(fake.resetCalls).toEqual([]);
      expect(fake.enableCalls).toEqual([]);
    });

    it('auto-enrollment enabled: a near job deadline stops the wait cleanly without a reset', async () => {
      const fake = movedAccount({ autoEnrollment: true });
      const clock = fakeClock();
      const options = {
        sessionBudgetSeconds: 10_000_000,
        jobDeadlineEpoch: Math.floor(clock.now() / 1000) + 900,
        log: () => undefined
      };
      await expect(runEnrollmentRound(fake, clock, memoryLedger(), options)).resolves.toBe('job-budget-exhausted');
      expect(fake.resetCalls).toEqual([]);
      expect(fake.enableCalls).toEqual([]);
    });

    it('auto-enrollment enabled: a re-run after the bound waits again and still never resets', async () => {
      const fake = movedAccount({ autoEnrollment: true });
      const clock = fakeClock();
      await expect(runEnrollmentRound(fake, clock, memoryLedger(), ROUND)).rejects.toThrow(/did not converge/);
      const rerunStartedAt = clock.now();
      await expect(runEnrollmentRound(fake, clock, memoryLedger(), ROUND)).rejects.toThrow(/did not converge/);
      expect(clock.now() - rerunStartedAt).toBeGreaterThanOrEqual(CONVERGENCE_TIMEOUT_MINUTES * 60 * 1000);
      expect(fake.resetCalls).toEqual([]);
      expect(fake.enableCalls).toEqual([]);
    });
  });
});
