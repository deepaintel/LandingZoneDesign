import { describe, expect, it } from 'vitest';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema, type LandingZoneConfig } from '../config/schemas/organization-schema.js';
import {
  classifyLandingZoneOperation,
  cliSkeletonProblems,
  collectLandingZoneOperations,
  decideAutoEnrollment,
  findInProgressOperation,
  landingZoneArnProblems,
  OPERATION_TIMEOUT_MINUTES,
  parseRemediationTypes,
  readLandingZone,
  runtimeRegionProblems,
  submissionStopReason,
  UPDATE_REQUIRED_JOB_SECONDS,
  verificationProblems,
  type AutoEnrollmentDecisionInput,
  type LandingZoneOperationsPage
} from '../lib/control-tower/landing-zone-auto-enrollment.js';
import { buildLandingZoneManifest } from '../lib/control-tower/landing-zone-manifest.js';
import type { LandingZoneManifest } from '../lib/control-tower/types.js';
import type { AwsCli } from '../scripts/control-tower-enrollment-runtime.js';
import {
  assertAutoEnrollmentEnvironment,
  buildAutoEnrollmentPlan,
  buildContext,
  CliAutoEnrollmentOperations,
  emptyLedger,
  runApplyRound,
  runVerification,
  type AutoEnrollmentClock,
  type AutoEnrollmentContext,
  type AutoEnrollmentLedger,
  type AutoEnrollmentLedgerStore,
  type AutoEnrollmentOperations,
  type UpdateLandingZoneRequest
} from '../scripts/configure-control-tower-auto-enrollment.js';

/**
 * Offline behaviour of AWS Control Tower account auto-enrollment (enable only) against an
 * in-memory Landing Zone. Every UpdateLandingZone call is counted; no AWS API is called.
 */

const MANAGEMENT = '111111111111';
const AUDIT = '333333333333';
const LOG_ARCHIVE = '444444444444';
const ARN = `arn:aws-eusc:controltower:eusc-de-east-1:${MANAGEMENT}:landingzone/1A2B3C4D5E6F7G8H`;
const OWN_OPERATION = '11111111-2222-4333-8444-555555555555';
const FOREIGN_OPERATION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CLOCK_START_MS = Date.parse('2026-10-16T10:00:00.000Z');
const START_TIME = new Date(CLOCK_START_MS).toISOString();
const ENABLED = ['INHERITANCE_DRIFT'];

function load(environment: 'staging' | 'production'): LandingZoneConfig {
  return new ConfigReader(environment, { configDirName: 'config', schema: LandingZoneSchema }).getConfig();
}

const MANIFEST: LandingZoneManifest = buildLandingZoneManifest(load('staging').controlTower, {
  auditAccountId: AUDIT,
  logArchiveAccountId: LOG_ARCHIVE
});

function context(desiredEnabled: boolean, overrides: Partial<AutoEnrollmentContext> = {}): AutoEnrollmentContext {
  return {
    environment: 'staging',
    landingZoneArn: ARN,
    managementAccountId: MANAGEMENT,
    partition: 'aws-eusc',
    region: 'eusc-de-east-1',
    runtimeRegion: undefined,
    desiredEnabled,
    expectedVersion: '4.0',
    expectedManifest: MANIFEST,
    ...overrides
  };
}

interface PendingOperation {
  polls: number;
  readonly terminal: 'SUCCEEDED' | 'FAILED';
  readonly type: string;
  readonly onSuccess?: () => void;
}

class FakeLandingZone implements AutoEnrollmentOperations {
  public readonly updateCalls: UpdateLandingZoneRequest[] = [];
  public readonly listCalls: (string | undefined)[] = [];
  public readonly operationReads: string[] = [];
  public landingZone: Record<string, unknown>;
  public operations: Record<string, unknown>[] = [];
  public readonly pending = new Map<string, PendingOperation>();
  public updateBehaviour: 'accept' | 'conflict' | 'lost' | 'no-id' = 'accept';
  public updatePolls = 2;
  public updateTerminal: 'SUCCEEDED' | 'FAILED' = 'SUCCEEDED';
  /** Whether a successful update really turns auto-enrollment on. */
  public updateEnables = true;
  /** When set, every GetLandingZoneOperation returns this value as is. */
  public operationResponse: { readonly value: unknown } | undefined;
  public identity: { Account?: string; Arn?: string } = {
    Account: MANAGEMENT,
    Arn: `arn:aws-eusc:sts::${MANAGEMENT}:assumed-role/github-actions-role/session`
  };
  public skeletons: Record<string, unknown> = {
    'update-landing-zone': { landingZoneIdentifier: '', version: '', manifest: {}, remediationTypes: ENABLED },
    'get-landing-zone-operation': { operationIdentifier: '' },
    'list-landing-zone-operations': { filter: {}, nextToken: '', maxResults: 0 }
  };

  public constructor(remediationTypes?: unknown, overrides: Record<string, unknown> = {}) {
    this.landingZone = {
      arn: ARN,
      version: '4.0',
      status: 'ACTIVE',
      driftStatus: { status: 'IN_SYNC' },
      manifest: JSON.parse(JSON.stringify(MANIFEST)) as unknown,
      latestAvailableVersion: '4.0',
      ...(remediationTypes === undefined ? {} : { remediationTypes }),
      ...overrides
    };
  }

  public callerIdentity(): { Account?: string; Arn?: string } {
    return this.identity;
  }

  public getLandingZone(): unknown {
    return { landingZone: this.landingZone };
  }

  public listLandingZoneOperationsPage(startingToken: string | undefined): LandingZoneOperationsPage {
    this.listCalls.push(startingToken);
    return { landingZoneOperations: this.operations };
  }

  /** Starts an operation that stays IN_PROGRESS for `polls` reads, then reaches `terminal`. */
  public startOperation(
    operationIdentifier: string,
    type: string,
    polls: number,
    terminal: 'SUCCEEDED' | 'FAILED',
    onSuccess?: () => void
  ): void {
    this.operations = [...this.operations, { operationIdentifier, operationType: type, status: 'IN_PROGRESS' }];
    this.landingZone = { ...this.landingZone, status: 'PROCESSING' };
    this.pending.set(operationIdentifier, { polls, terminal, type, ...(onSuccess === undefined ? {} : { onSuccess }) });
  }

  public getLandingZoneOperation(operationIdentifier: string): unknown {
    this.operationReads.push(operationIdentifier);
    if (this.operationResponse !== undefined) return this.operationResponse.value;
    const entry = this.pending.get(operationIdentifier);
    if (entry === undefined) {
      return { operationIdentifier, operationType: 'UPDATE', status: 'SUCCEEDED', startTime: START_TIME };
    }
    if (entry.polls > 0) {
      entry.polls -= 1;
      return { operationIdentifier, operationType: entry.type, status: 'IN_PROGRESS', startTime: START_TIME };
    }
    this.operations = this.operations.map((operation) =>
      operation['operationIdentifier'] === operationIdentifier ? { ...operation, status: entry.terminal } : operation
    );
    this.landingZone = { ...this.landingZone, status: entry.terminal === 'SUCCEEDED' ? 'ACTIVE' : 'FAILED' };
    if (entry.terminal === 'SUCCEEDED') entry.onSuccess?.();
    return {
      operationIdentifier,
      operationType: entry.type,
      status: entry.terminal,
      startTime: START_TIME,
      ...(entry.terminal === 'FAILED' ? { statusMessage: 'AccessDeniedException in member account' } : {})
    };
  }

  public updateLandingZone(request: UpdateLandingZoneRequest): unknown {
    this.updateCalls.push(request);
    if (this.updateBehaviour === 'conflict') {
      // Another operation holds the Landing Zone.
      this.startOperation(FOREIGN_OPERATION, 'UPDATE', 1, 'SUCCEEDED');
      throw new Error(
        'aws controltower update-landing-zone failed: An error occurred (ConflictException) when calling the ' +
          'UpdateLandingZone operation'
      );
    }
    if (this.updateBehaviour === 'lost') {
      throw new Error('aws controltower update-landing-zone failed: Read timeout on endpoint URL');
    }
    if (this.updateBehaviour === 'no-id') return {};
    this.startOperation(OWN_OPERATION, 'UPDATE', this.updatePolls, this.updateTerminal, () => {
      if (this.updateEnables) this.landingZone = { ...this.landingZone, remediationTypes: ENABLED };
    });
    return { operationIdentifier: OWN_OPERATION };
  }

  public cliSkeleton(command: string): unknown {
    return this.skeletons[command];
  }

  public diagnose(): string[] {
    return ['CloudTrail 2026-10-16T10:05:00Z controltower.amazonaws.com UpdateLandingZone AccessDenied principal'];
  }
}

function fakeClock(): AutoEnrollmentClock & { slept: number } {
  let now = CLOCK_START_MS;
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

function memoryLedger(initial?: Partial<AutoEnrollmentLedger>): AutoEnrollmentLedgerStore & {
  current(): AutoEnrollmentLedger;
} {
  let ledger: AutoEnrollmentLedger = { ...emptyLedger(), ...initial };
  return {
    read: () => JSON.parse(JSON.stringify(ledger)) as AutoEnrollmentLedger,
    write: (next) => {
      ledger = JSON.parse(JSON.stringify(next)) as AutoEnrollmentLedger;
    },
    current: () => ledger
  };
}

/** Generous budgets: a whole day of credentials and job time. */
function round(clock: AutoEnrollmentClock, overrides: { sessionBudgetSeconds?: number; jobSecondsLeft?: number } = {}) {
  return {
    sessionBudgetSeconds: overrides.sessionBudgetSeconds ?? 86_400,
    jobDeadlineEpoch: Math.floor(clock.now() / 1000) + (overrides.jobSecondsLeft ?? 86_400),
    log: () => undefined
  };
}

// ---------------------------------------------------------------------------------------------
// Pure decisions.
// ---------------------------------------------------------------------------------------------

describe('parseRemediationTypes', () => {
  it('reads absent as disabled and exactly ["INHERITANCE_DRIFT"] as enabled', () => {
    expect(parseRemediationTypes(undefined)).toEqual({ kind: 'disabled' });
    expect(parseRemediationTypes(['INHERITANCE_DRIFT'])).toEqual({ kind: 'enabled' });
  });

  it.each([
    ['an empty list', []],
    ['an unknown value', ['DRIFT']],
    ['a duplicate value', ['INHERITANCE_DRIFT', 'INHERITANCE_DRIFT']],
    ['an extra value', ['INHERITANCE_DRIFT', 'OTHER']],
    ['a string', 'INHERITANCE_DRIFT'],
    ['null', null]
  ])('fails closed on %s', (_label, value) => {
    expect(parseRemediationTypes(value).kind).toBe('malformed');
  });
});

describe('readLandingZone', () => {
  it('returns a trusted snapshot for a well-formed response', () => {
    const { snapshot, problems } = readLandingZone(new FakeLandingZone(ENABLED).getLandingZone(), ARN);
    expect(problems).toEqual([]);
    expect(snapshot?.version).toBe('4.0');
    expect(snapshot?.driftStatus).toBe('IN_SYNC');
    expect(snapshot?.autoEnrollment).toEqual({ kind: 'enabled' });
  });

  it.each([
    ['no landingZone object', {}],
    ['another ARN', { landingZone: { ...new FakeLandingZone().landingZone, arn: `${ARN}X` } }],
    ['no version', { landingZone: { ...new FakeLandingZone().landingZone, version: undefined } }],
    ['an unknown status', { landingZone: { ...new FakeLandingZone().landingZone, status: 'DELETING' } }],
    ['malformed drift', { landingZone: { ...new FakeLandingZone().landingZone, driftStatus: 'IN_SYNC' } }],
    ['no manifest', { landingZone: { ...new FakeLandingZone().landingZone, manifest: undefined } }]
  ])('reports %s as a problem without a snapshot', (_label, response) => {
    const result = readLandingZone(response, ARN);
    expect(result.snapshot).toBeUndefined();
    expect(result.problems.length).toBeGreaterThan(0);
  });
});

describe('identity, Region, ARN and AWS CLI checks', () => {
  const scope = { partition: 'aws-eusc', region: 'eusc-de-east-1', managementAccountId: MANAGEMENT };

  it('accepts only an aws-eusc home-Region Landing Zone of the management account', () => {
    expect(landingZoneArnProblems(ARN, scope)).toEqual([]);
    expect(landingZoneArnProblems(ARN.replace('aws-eusc', 'aws'), scope)).toHaveLength(1);
    expect(landingZoneArnProblems(ARN.replace('eusc-de-east-1', 'eu-central-1'), scope)).toHaveLength(1);
    expect(landingZoneArnProblems(ARN.replace(MANAGEMENT, '999999999999'), scope)).toHaveLength(1);
  });

  it('rejects a runtime Region other than the configured home Region', () => {
    expect(runtimeRegionProblems(undefined, 'eusc-de-east-1')).toEqual([]);
    expect(runtimeRegionProblems('eusc-de-east-1', 'eusc-de-east-1')).toEqual([]);
    expect(runtimeRegionProblems('us-east-1', 'eusc-de-east-1')).toHaveLength(1);
  });

  it('requires remediationTypes support in the installed AWS CLI update-landing-zone command', () => {
    const members = ['landingZoneIdentifier', 'version', 'manifest', 'remediationTypes'];
    const older = { landingZoneIdentifier: '', version: '', manifest: {} };
    expect(cliSkeletonProblems('update-landing-zone', { ...older, remediationTypes: [] }, members)).toEqual([]);
    expect(cliSkeletonProblems('update-landing-zone', older, members)).toEqual([
      expect.stringMatching(/does not support remediationTypes/)
    ]);
    expect(cliSkeletonProblems('update-landing-zone', undefined, members)).toEqual([
      expect.stringMatching(/no usable 'controltower update-landing-zone' command/)
    ]);
  });

  it('refuses every environment other than staging and production', () => {
    expect(assertAutoEnrollmentEnvironment('staging')).toBe('staging');
    expect(assertAutoEnrollmentEnvironment('production')).toBe('production');
    expect(() => assertAutoEnrollmentEnvironment('dev')).toThrow(/supports only staging and production/);
    expect(() => assertAutoEnrollmentEnvironment('')).toThrow(/supports only staging and production/);
  });
});

describe('collectLandingZoneOperations', () => {
  it('follows CLI pagination tokens and collects every page', () => {
    const pages: Record<string, LandingZoneOperationsPage> = {
      first: { landingZoneOperations: [{ status: 'SUCCEEDED' }], NextToken: 't1' },
      t1: { landingZoneOperations: [{ status: 'FAILED' }], NextToken: 't2' },
      t2: { landingZoneOperations: [{ status: 'IN_PROGRESS' }] }
    };
    const tokens: (string | undefined)[] = [];
    const operations = collectLandingZoneOperations((token) => {
      tokens.push(token);
      return pages[token ?? 'first'] ?? {};
    });
    expect(tokens).toEqual([undefined, 't1', 't2']);
    expect(operations).toHaveLength(3);
  });

  it('fails closed on a missing list, a malformed or repeated token, or too many pages', () => {
    expect(() => collectLandingZoneOperations(() => ({}))).toThrow(/no 'landingZoneOperations' list/);
    expect(() => collectLandingZoneOperations(() => ({ landingZoneOperations: [], NextToken: 7 }))).toThrow(
      /malformed pagination token/
    );
    expect(() => collectLandingZoneOperations(() => ({ landingZoneOperations: [], NextToken: 'same' }))).toThrow(
      /same pagination token twice/
    );
    let page = 0;
    expect(() =>
      collectLandingZoneOperations(() => {
        page += 1;
        return { landingZoneOperations: [], NextToken: `t${page}` };
      }, 3)
    ).toThrow(/more than 3 pages/);
  });
});

describe('findInProgressOperation', () => {
  it('ignores finished operations and identifies a single in-progress one', () => {
    expect(
      findInProgressOperation([
        { operationIdentifier: FOREIGN_OPERATION, operationType: 'CREATE', status: 'SUCCEEDED' },
        { operationIdentifier: 'not-a-uuid', status: 'FAILED' }
      ])
    ).toEqual({ kind: 'none' });
    expect(
      findInProgressOperation([{ operationIdentifier: OWN_OPERATION, operationType: 'UPDATE', status: 'IN_PROGRESS' }])
    ).toEqual({ kind: 'one', operationIdentifier: OWN_OPERATION, operationType: 'UPDATE' });
  });

  const own = { operationIdentifier: OWN_OPERATION, operationType: 'UPDATE', status: 'IN_PROGRESS' };

  it.each([
    ['two in-progress operations', [own, { ...own, operationIdentifier: FOREIGN_OPERATION, operationType: 'RESET' }]],
    ['an unknown status', [{ ...own, status: 'QUEUED' }]],
    ['a missing status', [{ operationIdentifier: OWN_OPERATION, operationType: 'UPDATE' }]],
    ['an in-progress operation without an identifier', [{ operationType: 'UPDATE', status: 'IN_PROGRESS' }]],
    ['an in-progress operation of unknown type', [{ ...own, operationType: 'PATCH' }]],
    ['a non-object entry', ['IN_PROGRESS']]
  ])('treats %s as ambiguous', (_label, operations) => {
    expect(findInProgressOperation(operations).kind).toBe('ambiguous');
  });
});

describe('classifyLandingZoneOperation', () => {
  const expected = { operationIdentifier: OWN_OPERATION, operationType: 'UPDATE' as const };
  const valid = { operationIdentifier: OWN_OPERATION, operationType: 'UPDATE', startTime: START_TIME };

  it('recognises the documented statuses', () => {
    expect(classifyLandingZoneOperation({ ...valid, status: 'IN_PROGRESS' }, expected).outcome).toBe('IN_PROGRESS');
    expect(classifyLandingZoneOperation({ ...valid, status: 'SUCCEEDED' }, expected)).toEqual({
      outcome: 'SUCCEEDED',
      startedAtMs: CLOCK_START_MS
    });
    expect(classifyLandingZoneOperation({ ...valid, status: 'FAILED', statusMessage: 'boom' }, expected)).toMatchObject(
      { outcome: 'FAILED', statusMessage: 'boom' }
    );
  });

  it.each([
    ['no operationDetails', undefined],
    ['a non-object', 'SUCCEEDED'],
    ['a missing status', { ...valid }],
    ['an unknown status', { ...valid, status: 'CANCELLED' }],
    ['a mismatched identifier', { ...valid, status: 'SUCCEEDED', operationIdentifier: FOREIGN_OPERATION }],
    ['a missing operation type', { operationIdentifier: OWN_OPERATION, status: 'SUCCEEDED' }],
    ['the wrong operation type', { ...valid, status: 'SUCCEEDED', operationType: 'RESET' }],
    ['an invalid start time', { ...valid, status: 'IN_PROGRESS', startTime: 'yesterday' }],
    ['an invalid end time', { ...valid, status: 'SUCCEEDED', endTime: 42 }]
  ])('treats %s as MALFORMED', (_label, details) => {
    expect(classifyLandingZoneOperation(details, expected).outcome).toBe('MALFORMED');
  });
});

describe('decideAutoEnrollment (enable only)', () => {
  const healthy: AutoEnrollmentDecisionInput = {
    desiredEnabled: true,
    live: { kind: 'disabled' },
    inProgress: { kind: 'none' },
    blockingProblems: [],
    healthProblems: [],
    landingZoneStatus: 'ACTIVE'
  };

  it('applies the enable-only table', () => {
    expect(decideAutoEnrollment({ ...healthy, live: { kind: 'enabled' } }).action).toBe('none');
    expect(decideAutoEnrollment(healthy).action).toBe('enable');
    expect(decideAutoEnrollment({ ...healthy, desiredEnabled: false }).action).toBe('none');
    const mismatch = decideAutoEnrollment({ ...healthy, desiredEnabled: false, live: { kind: 'enabled' } });
    expect(mismatch.action).toBe('stop');
    expect(mismatch.reasons.join(' ')).toMatch(/never disables it/);
  });

  it('awaits an identified in-progress operation before anything else, and stops on an ambiguous one', () => {
    expect(
      decideAutoEnrollment({
        ...healthy,
        landingZoneStatus: 'PROCESSING',
        healthProblems: ["Landing Zone status 'PROCESSING' is not ACTIVE"],
        inProgress: { kind: 'one', operationIdentifier: FOREIGN_OPERATION, operationType: 'UPDATE' }
      }).action
    ).toBe('await');
    expect(decideAutoEnrollment({ ...healthy, inProgress: { kind: 'ambiguous', reasons: ['x'] } }).action).toBe('stop');
  });

  it('stops on blocking problems, malformed remediationTypes, PROCESSING without an operation, or poor health', () => {
    expect(decideAutoEnrollment({ ...healthy, blockingProblems: ['wrong account'] }).action).toBe('stop');
    expect(decideAutoEnrollment({ ...healthy, live: { kind: 'malformed', reason: 'x' } }).action).toBe('stop');
    expect(decideAutoEnrollment({ ...healthy, landingZoneStatus: 'PROCESSING' }).action).toBe('stop');
    expect(decideAutoEnrollment({ ...healthy, healthProblems: ['drift'] }).action).toBe('stop');
  });
});

describe('budgets', () => {
  it('refuses to submit an update without the full operation ceiling plus verification left in the job', () => {
    const now = CLOCK_START_MS;
    const session = now + 3_000_000;
    const enough = Math.floor(now / 1000) + UPDATE_REQUIRED_JOB_SECONDS;
    expect(submissionStopReason({ nowMs: now, sessionDeadlineMs: session, jobDeadlineEpoch: enough })).toBeUndefined();
    expect(submissionStopReason({ nowMs: now, sessionDeadlineMs: session, jobDeadlineEpoch: enough - 1 })).toBe(
      'job-budget-exhausted'
    );
    expect(submissionStopReason({ nowMs: now, sessionDeadlineMs: now + 60_000, jobDeadlineEpoch: undefined })).toBe(
      'continue'
    );
  });
});

describe('verificationProblems', () => {
  it('requires exactly ["INHERITANCE_DRIFT"], version 4.0, ACTIVE, IN_SYNC and an unchanged manifest', () => {
    const expected = { version: '4.0', manifest: MANIFEST, desiredEnabled: true };
    const read = (fake: FakeLandingZone) => readLandingZone(fake.getLandingZone(), ARN).snapshot;
    const enabled = read(new FakeLandingZone(ENABLED));
    const disabled = read(new FakeLandingZone());
    expect(enabled && verificationProblems(enabled, expected)).toEqual([]);
    expect(disabled && verificationProblems(disabled, expected)).toEqual([
      expect.stringMatching(/does not report remediationTypes/)
    ]);
    const drifted = read(new FakeLandingZone(ENABLED, { driftStatus: { status: 'DRIFTED' } }));
    expect(drifted && verificationProblems(drifted, expected)).toEqual([expect.stringMatching(/not IN_SYNC/)]);
    const otherManifest = read(new FakeLandingZone(ENABLED, { manifest: { ...MANIFEST, governedRegions: ['x'] } }));
    expect(otherManifest && verificationProblems(otherManifest, expected)).toEqual([
      expect.stringMatching(/^manifest: /)
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Plan and apply rounds.
// ---------------------------------------------------------------------------------------------

describe('read-only plan', () => {
  it('never writes and never sends a ListLandingZoneOperations status filter', () => {
    const fake = new FakeLandingZone();
    const plan = buildAutoEnrollmentPlan(fake, context(true), { checkCli: true });
    expect(plan.decision.action).toBe('enable');
    expect(fake.updateCalls).toEqual([]);
    expect(fake.listCalls).toEqual([undefined]);
  });

  it('stops for a wrong caller account or partition', () => {
    const fake = new FakeLandingZone();
    fake.identity = { Account: '999999999999', Arn: 'arn:aws:sts::999999999999:assumed-role/x/y' };
    const plan = buildAutoEnrollmentPlan(fake, context(true), { checkCli: true });
    expect(plan.decision.action).toBe('stop');
    expect(plan.decision.reasons.join(' ')).toMatch(/not the management account/);
  });

  it('stops when the installed AWS CLI does not support remediationTypes', () => {
    const fake = new FakeLandingZone();
    fake.skeletons['update-landing-zone'] = { landingZoneIdentifier: '', version: '', manifest: {} };
    const plan = buildAutoEnrollmentPlan(fake, context(true), { checkCli: true });
    expect(plan.decision.action).toBe('stop');
    expect(plan.decision.reasons.join(' ')).toMatch(/does not support remediationTypes/);
  });

  it('stops when the runtime Region is not the home Region', () => {
    const plan = buildAutoEnrollmentPlan(new FakeLandingZone(), context(true, { runtimeRegion: 'eu-west-1' }), {
      checkCli: true
    });
    expect(plan.decision.action).toBe('stop');
  });
});

describe('apply round', () => {
  it('already enabled: a successful no-op with zero UpdateLandingZone calls', async () => {
    const fake = new FakeLandingZone(ENABLED);
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).resolves.toBe('complete');
    expect(fake.updateCalls).toEqual([]);
  });

  it('configured disabled and live disabled (Production in Release A): a no-op', async () => {
    const fake = new FakeLandingZone();
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(false), round(clock))).resolves.toBe('complete');
    expect(fake.updateCalls).toEqual([]);
  });

  it('configured disabled but live enabled: fails closed without any write', async () => {
    const fake = new FakeLandingZone(ENABLED);
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(false), round(clock))).rejects.toThrow(
      /never disables it/
    );
    expect(fake.updateCalls).toEqual([]);
  });

  it('disabled -> enabled: exactly one UpdateLandingZone with the live ARN, deployed version, manifest and INHERITANCE_DRIFT', async () => {
    const fake = new FakeLandingZone();
    const clock = fakeClock();
    const ledger = memoryLedger();
    await expect(runApplyRound(fake, clock, ledger, context(true), round(clock))).resolves.toBe('complete');
    expect(fake.updateCalls).toEqual([
      { landingZoneArn: ARN, version: '4.0', manifest: MANIFEST, remediationTypes: ['INHERITANCE_DRIFT'] }
    ]);
    expect(ledger.current()).toMatchObject({
      updateAttempted: true,
      updateOperationIdentifier: OWN_OPERATION,
      lastOperationIdentifier: OWN_OPERATION
    });
    expect(fake.landingZone['remediationTypes']).toEqual(ENABLED);
    expect(clock.slept).toBeGreaterThan(0);
  });

  it('a rerun after success is idempotent: zero further UpdateLandingZone calls', async () => {
    const fake = new FakeLandingZone();
    const clock = fakeClock();
    await runApplyRound(fake, clock, memoryLedger(), context(true), round(clock));
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).resolves.toBe('complete');
    expect(fake.updateCalls).toHaveLength(1);
  });

  it.each([
    ['an unexpected version', { version: '3.3' }],
    ['a FAILED Landing Zone', { status: 'FAILED' }],
    ['inheritance drift on the Landing Zone', { driftStatus: { status: 'DRIFTED' } }],
    ['a changed manifest', { manifest: { ...MANIFEST, governedRegions: ['eusc-de-east-1', 'eu-central-1'] } }],
    ['malformed remediationTypes', { remediationTypes: ['INHERITANCE_DRIFT', 'OTHER'] }],
    ['an empty remediationTypes list', { remediationTypes: [] }],
    ['PROCESSING without any in-progress operation', { status: 'PROCESSING' }]
  ])('%s: fails closed without any write', async (_label, overrides) => {
    const fake = new FakeLandingZone(undefined, overrides);
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).rejects.toThrow(
      /prechecks failed/
    );
    expect(fake.updateCalls).toEqual([]);
  });

  it('an operation already in progress is awaited and the Landing Zone re-read; no duplicate update', async () => {
    const fake = new FakeLandingZone();
    fake.startOperation(FOREIGN_OPERATION, 'UPDATE', 2, 'SUCCEEDED', () => {
      fake.landingZone = { ...fake.landingZone, remediationTypes: ENABLED };
    });
    const clock = fakeClock();
    const ledger = memoryLedger();
    await expect(runApplyRound(fake, clock, ledger, context(true), round(clock))).resolves.toBe('complete');
    expect(fake.updateCalls).toEqual([]);
    expect(fake.operationReads.every((id) => id === FOREIGN_OPERATION)).toBe(true);
    expect(ledger.current().lastOperationIdentifier).toBe(FOREIGN_OPERATION);
  });

  it('an unrelated in-progress operation is awaited first, then auto-enrollment is enabled once', async () => {
    const fake = new FakeLandingZone();
    fake.startOperation(FOREIGN_OPERATION, 'UPDATE', 1, 'SUCCEEDED');
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).resolves.toBe('complete');
    expect(fake.updateCalls).toHaveLength(1);
  });

  it('a failed in-progress operation stops the run without submitting an update', async () => {
    const fake = new FakeLandingZone();
    fake.startOperation(FOREIGN_OPERATION, 'RESET', 1, 'FAILED');
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).rejects.toThrow(
      /already in progress when the run started; no update was submitted/
    );
    expect(fake.updateCalls).toEqual([]);
  });

  it('two in-progress operations are ambiguous: no write', async () => {
    const fake = new FakeLandingZone();
    fake.startOperation(FOREIGN_OPERATION, 'UPDATE', 5, 'SUCCEEDED');
    fake.startOperation(OWN_OPERATION, 'UPDATE', 5, 'SUCCEEDED');
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).rejects.toThrow(
      /cannot be identified/
    );
    expect(fake.updateCalls).toEqual([]);
  });

  it('a ConflictException is never resubmitted: the holding operation is awaited, then the run stops', async () => {
    const fake = new FakeLandingZone();
    fake.updateBehaviour = 'conflict';
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).rejects.toThrow(
      /already attempted in this workflow run/
    );
    expect(fake.updateCalls).toHaveLength(1);
    expect(fake.operationReads).toContain(FOREIGN_OPERATION);
  });

  it('an ambiguous UpdateLandingZone failure is not resubmitted; a rerun polls the accepted operation', async () => {
    const fake = new FakeLandingZone();
    fake.updateBehaviour = 'lost';
    const clock = fakeClock();
    const ledger = memoryLedger();
    await expect(runApplyRound(fake, clock, ledger, context(true), round(clock))).rejects.toThrow(
      /may or may not have been accepted, so it is NOT resubmitted/
    );
    expect(fake.updateCalls).toHaveLength(1);
    expect(ledger.current().updateAttempted).toBe(true);

    // The request had in fact been accepted. A re-run (new job, new ledger) finds the operation.
    fake.startOperation(OWN_OPERATION, 'UPDATE', 1, 'SUCCEEDED', () => {
      fake.landingZone = { ...fake.landingZone, remediationTypes: ENABLED };
    });
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).resolves.toBe('complete');
    expect(fake.updateCalls).toHaveLength(1);
  });

  it('a response without an operation identifier is not resubmitted', async () => {
    const fake = new FakeLandingZone();
    fake.updateBehaviour = 'no-id';
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).rejects.toThrow(
      /no valid operationIdentifier/
    );
    expect(fake.updateCalls).toHaveLength(1);
  });

  it('a FAILED update reports the operation, its message and CloudTrail denials, and is not retried', async () => {
    const fake = new FakeLandingZone();
    fake.updateTerminal = 'FAILED';
    const clock = fakeClock();
    const error = await runApplyRound(fake, clock, memoryLedger(), context(true), round(clock)).catch(
      (caught: unknown) => caught as Error
    );
    expect(String(error)).toMatch(new RegExp(`${OWN_OPERATION} \\(UPDATE\\) FAILED: AccessDeniedException`));
    expect(String(error)).toMatch(/CloudTrail .* AccessDenied/);
    expect(String(error)).toMatch(/no ResetLandingZone, ResetEnabledBaseline, EnableBaseline or CreateLandingZone/);
    expect(fake.updateCalls).toHaveLength(1);
  });

  it(`an update IN_PROGRESS for more than ${OPERATION_TIMEOUT_MINUTES} minutes fails with a safe rerun instruction`, async () => {
    const fake = new FakeLandingZone();
    fake.updatePolls = 10_000;
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).rejects.toThrow(
      /IN_PROGRESS for more than 90 minutes\. No duplicate update was submitted/
    );
    expect(fake.updateCalls).toHaveLength(1);
    expect(clock.now() - CLOCK_START_MS).toBeGreaterThan(OPERATION_TIMEOUT_MINUTES * 60 * 1000);
  });

  const update = { operationIdentifier: OWN_OPERATION, operationType: 'UPDATE' };

  it.each([
    ['no operationDetails', undefined],
    ['an unknown status', { ...update, status: 'PAUSED' }],
    ['a mismatched identifier', { ...update, status: 'SUCCEEDED', operationIdentifier: FOREIGN_OPERATION }],
    ['the wrong operation type', { ...update, status: 'SUCCEEDED', operationType: 'RESET' }],
    ['an invalid start time', { ...update, status: 'IN_PROGRESS', startTime: 'x' }]
  ])('a malformed operation response (%s) stops without resubmission', async (_label, value) => {
    const fake = new FakeLandingZone();
    fake.operationResponse = { value };
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).rejects.toThrow(
      /returned a malformed response/
    );
    expect(fake.updateCalls).toHaveLength(1);
  });

  it('a successful update that does not enable the setting stops; no second update', async () => {
    const fake = new FakeLandingZone();
    fake.updateEnables = false;
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).rejects.toThrow(
      /already attempted in this workflow run \(operation 11111111-2222-4333-8444-555555555555\)/
    );
    expect(fake.updateCalls).toHaveLength(1);
  });

  it('a Landing Zone that stays PROCESSING after success stops after the settle bound', async () => {
    const fake = new FakeLandingZone();
    fake.startOperation(FOREIGN_OPERATION, 'UPDATE', 0, 'SUCCEEDED', () => {
      fake.landingZone = { ...fake.landingZone, status: 'PROCESSING' };
    });
    const clock = fakeClock();
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), round(clock))).rejects.toThrow(
      /still PROCESSING/
    );
    expect(fake.updateCalls).toEqual([]);
  });

  it('insufficient job budget: no UpdateLandingZone call, the round reports job-budget-exhausted', async () => {
    const fake = new FakeLandingZone();
    const clock = fakeClock();
    const options = round(clock, { jobSecondsLeft: UPDATE_REQUIRED_JOB_SECONDS - 60 });
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), options)).resolves.toBe(
      'job-budget-exhausted'
    );
    expect(fake.updateCalls).toEqual([]);
  });

  it('insufficient credential time defers the write to the next round', async () => {
    const fake = new FakeLandingZone();
    const clock = fakeClock();
    const options = round(clock, { sessionBudgetSeconds: 300 });
    await expect(runApplyRound(fake, clock, memoryLedger(), context(true), options)).resolves.toBe('continue');
    expect(fake.updateCalls).toEqual([]);
  });

  it('polling resumes in the next credential round without resubmitting', async () => {
    const fake = new FakeLandingZone();
    fake.updatePolls = 30;
    const clock = fakeClock();
    const ledger = memoryLedger();
    const nextRound = () =>
      runApplyRound(fake, clock, ledger, context(true), round(clock, { sessionBudgetSeconds: 900 }));
    await expect(nextRound()).resolves.toBe('continue');
    expect(fake.updateCalls).toHaveLength(1);
    let status = 'continue';
    for (let next = 0; next < 5 && status === 'continue'; next += 1) {
      status = await nextRound();
    }
    expect(status).toBe('complete');
    expect(fake.updateCalls).toHaveLength(1);
    expect(fake.landingZone['remediationTypes']).toEqual(ENABLED);
  });
});

describe('runVerification', () => {
  it('passes for the configured setting and fails, without any write, on an inconsistency', () => {
    expect(runVerification(new FakeLandingZone(ENABLED), context(true))).toBe('enabled');
    expect(runVerification(new FakeLandingZone(), context(false))).toBe('disabled');
    const fake = new FakeLandingZone(ENABLED, { manifest: { ...MANIFEST, backup: { enabled: true } } });
    expect(() => runVerification(fake, context(true))).toThrow(/verification failed[\s\S]*manifest:/);
    expect(() => runVerification(new FakeLandingZone(), context(true))).toThrow(/does not report remediationTypes/);
    expect(fake.updateCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// Context and AWS CLI adapter.
// ---------------------------------------------------------------------------------------------

describe('buildContext', () => {
  const staging = load('staging');
  const production = load('production');
  const inputs = (environment: string, managementAccountId: string) => ({
    environment,
    managementAccountId,
    landingZoneArn: ARN,
    auditAccountId: AUDIT,
    logArchiveAccountId: LOG_ARCHIVE
  });

  it('Release A: Staging is configured enabled and Production disabled', () => {
    expect(buildContext(inputs('staging', staging.aws.accountId)).desiredEnabled).toBe(true);
    expect(buildContext(inputs('production', production.aws.accountId)).desiredEnabled).toBe(false);
  });

  it('builds the expected manifest from configuration and the shared-account inputs', () => {
    const built = buildContext(inputs('staging', staging.aws.accountId));
    expect(built.expectedManifest).toEqual(MANIFEST);
    expect(built.expectedVersion).toBe('4.0');
    expect(built.partition).toBe('aws-eusc');
    expect(built.region).toBe('eusc-de-east-1');
  });

  it('refuses another environment and a management account that is not configured', () => {
    expect(() => buildContext(inputs('dev', staging.aws.accountId))).toThrow(/supports only staging and production/);
    expect(() => buildContext(inputs('staging', '999999999999'))).toThrow(/does not match configuration/);
  });
});

describe('CliAutoEnrollmentOperations', () => {
  function recordingCli(): { cli: AwsCli; calls: string[][] } {
    const calls: string[][] = [];
    const cli = {
      json: (args: readonly string[]) => {
        calls.push([...args]);
        return args[1] === 'update-landing-zone' ? { operationIdentifier: OWN_OPERATION } : {};
      }
    } as unknown as AwsCli;
    return { cli, calls };
  }

  it('lists operations without any status filter and paginates with CLI tokens', () => {
    const { cli, calls } = recordingCli();
    const ops = new CliAutoEnrollmentOperations(cli);
    ops.listLandingZoneOperationsPage(undefined);
    ops.listLandingZoneOperationsPage('token-1');
    expect(calls[0]).toEqual(['controltower', 'list-landing-zone-operations', '--max-items', '50']);
    expect(calls[1]).toEqual([
      'controltower',
      'list-landing-zone-operations',
      '--max-items',
      '50',
      '--starting-token',
      'token-1'
    ]);
    expect(calls.flat()).not.toContain('--filter');
    expect(calls.flat().join(' ')).not.toMatch(/IN_PROGRESS/);
  });

  it('sends exactly the ARN, version, manifest file and INHERITANCE_DRIFT to update-landing-zone', () => {
    const { cli, calls } = recordingCli();
    new CliAutoEnrollmentOperations(cli).updateLandingZone({
      landingZoneArn: ARN,
      version: '4.0',
      manifest: MANIFEST,
      remediationTypes: ['INHERITANCE_DRIFT']
    });
    const [args] = calls;
    expect(args?.slice(0, 6)).toEqual([
      'controltower',
      'update-landing-zone',
      '--landing-zone-identifier',
      ARN,
      '--landing-zone-version',
      '4.0'
    ]);
    expect(args?.[6]).toBe('--manifest');
    expect(args?.[7]).toMatch(/^file:\/\/.*control-tower-auto-enrollment-manifest-\d+\.json$/);
    expect(args?.slice(8)).toEqual(['--remediation-types', 'INHERITANCE_DRIFT']);
  });

  it('checks CLI support with a local skeleton, never an AWS call', () => {
    const { cli, calls } = recordingCli();
    new CliAutoEnrollmentOperations(cli).cliSkeleton('update-landing-zone');
    expect(calls[0]).toEqual(['controltower', 'update-landing-zone', '--generate-cli-skeleton', 'input']);
  });
});
