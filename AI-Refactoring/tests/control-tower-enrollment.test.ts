import { describe, expect, it } from 'vitest';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import {
  accountArn,
  autoEnrollmentEnabled,
  callerIdentityProblems,
  classifyBaselineOperation,
  childBaselineHealth,
  classifyTarget,
  configPrecheckProblems,
  driftState,
  enabledBaselineArnProblems,
  convergenceDecision,
  CONTROL_TOWER_CONFIG_DELIVERY_CHANNEL_NAME,
  CONTROL_TOWER_CONFIG_RECORDER_NAME,
  deriveEnrollmentTargets,
  evaluateExecutionRoleModel,
  evaluateScpHeadroom,
  findBaseline,
  getBaselineProblems,
  identityCenterBaselineProblems,
  isConflictError,
  landingZoneProblems,
  ouArnProblems,
  securityOuBaselineProblems,
  serviceIntegrationProblems,
  plannedAction,
  requireBaseline,
  resolveBaselineVersion,
  runtimeHandoffProblems,
  type ClassifyTargetInput,
  type EnabledBaselineSummary
} from '../lib/control-tower/baseline-enrollment.js';
import {
  assertAccountPlanReconciled,
  buildAccountPlan,
  toDesiredLandingZoneAccounts,
  type AccountTag,
  type CreateAccountRequestStatus,
  type OrganizationAccount,
  type OrganizationalUnitSummary,
  type OrganizationParent,
  type OrganizationsAccountPort
} from '../lib/organization/landing-zone-account-reconciler.js';
import { isIamEscalationGuarded, requiredList } from '../scripts/control-tower-enrollment-runtime.js';

const PARTITION = 'aws-eusc';
const REGION = 'eusc-de-east-1';
const SCOPE = { partition: PARTITION, region: REGION };
const MANAGEMENT = '111111111111';
const ORG = 'o-abcdefghij';
const CT_BASELINE = `arn:${PARTITION}:controltower:${REGION}::baseline/17BSJV3IGJ2QSGA2`;
const CONFIG_BASELINE = `arn:${PARTITION}:controltower:${REGION}::baseline/CONFIGBASELINE01`;
const IDC_BASELINE = `arn:${PARTITION}:controltower:${REGION}::baseline/LN25R72TTG6IGPTQ`;
const OU_ARN = `arn:${PARTITION}:organizations::${MANAGEMENT}:ou/${ORG}/ou-ab12-cdef3456`;
const ENABLED_ARN = `arn:${PARTITION}:controltower:${REGION}:${MANAGEMENT}:enabledbaseline/XAHCR4CJTSI4W07MZ`;
const OPERATION = '58f12232-26be-4735-a3e9-dd30d90f021f';
const ACCOUNT_A = accountArn(PARTITION, MANAGEMENT, ORG, '222222222222');
const ACCOUNT_B = accountArn(PARTITION, MANAGEMENT, ORG, '333333333333');

const stagingConfig = new ConfigReader('staging', { configDirName: 'config', schema: LandingZoneSchema }).getConfig();
const stagingAccounts = toDesiredLandingZoneAccounts(stagingConfig.landingZoneAccounts);
const productionConfig = new ConfigReader('production', {
  configDirName: 'config',
  schema: LandingZoneSchema
}).getConfig();
const productionAccounts = toDesiredLandingZoneAccounts(productionConfig.landingZoneAccounts);

/** The approved structural enrollment scope, identical in Staging and Production. */
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
const WORKLOADS_OUS = ROLLOUT_ORDER.filter((ouPath) => ouPath.startsWith('Workloads'));

function ctRecord(overrides: Partial<EnabledBaselineSummary> = {}): EnabledBaselineSummary {
  return {
    arn: ENABLED_ARN,
    baselineIdentifier: CT_BASELINE,
    baselineVersion: '5.0',
    targetIdentifier: OU_ARN,
    statusSummary: { status: 'SUCCEEDED', lastOperationIdentifier: OPERATION },
    ...overrides
  };
}

const ENROLLMENT_SCOPE = { partition: PARTITION, region: REGION, managementAccountId: MANAGEMENT, organizationId: ORG };

/** A child enabled baseline as `ListEnabledBaselines --include-children` returns it. */
function child(
  target: string,
  status = 'SUCCEEDED',
  overrides: Partial<EnabledBaselineSummary> = {}
): EnabledBaselineSummary {
  return {
    arn: `arn:${PARTITION}:controltower:${REGION}:${MANAGEMENT}:enabledbaseline/XCHILD${target.split('/').at(-1) ?? ''}`,
    baselineIdentifier: CT_BASELINE,
    baselineVersion: '5.0',
    targetIdentifier: target,
    parentIdentifier: ENABLED_ARN,
    statusSummary: { status, lastOperationIdentifier: OPERATION },
    driftStatusSummary: { types: { inheritance: { status: 'IN_SYNC' } } },
    ...overrides
  };
}

function input(overrides: Partial<ClassifyTargetInput> = {}): ClassifyTargetInput {
  return {
    ouPath: 'Infrastructure',
    ouArn: OU_ARN,
    scope: ENROLLMENT_SCOPE,
    targetRecords: [],
    childRecords: [],
    expectedAccountArns: [ACCOUNT_A, ACCOUNT_B],
    controlTowerBaselineArn: CT_BASELINE,
    configBaselineArn: CONFIG_BASELINE,
    expectedVersion: '5.0',
    parentState: 'top-level',
    ...overrides
  };
}

describe('baseline discovery', () => {
  const ct = { arn: CT_BASELINE, name: 'AWSControlTowerBaseline' };

  it('selects exactly one AWSControlTowerBaseline in the aws-eusc partition and home Region', () => {
    expect(
      requireBaseline([ct, { arn: IDC_BASELINE, name: 'IdentityCenterBaseline' }], 'AWSControlTowerBaseline', SCOPE)
    ).toEqual(ct);
  });

  it('fails when no AWSControlTowerBaseline is returned', () => {
    expect(() => requireBaseline([], 'AWSControlTowerBaseline', SCOPE)).toThrow(/no baseline named/);
  });

  it('fails when AWSControlTowerBaseline is returned more than once', () => {
    expect(() => requireBaseline([ct, { ...ct }], 'AWSControlTowerBaseline', SCOPE)).toThrow(/2 baselines named/);
  });

  it('fails on a commercial-partition ARN', () => {
    const commercial = { ...ct, arn: CT_BASELINE.replace(`arn:${PARTITION}:`, ['arn', 'aws', ''].join(':')) };
    expect(() => requireBaseline([commercial], 'AWSControlTowerBaseline', SCOPE)).toThrow(/not an 'aws-eusc'/);
  });

  it('fails on an ARN in another Region', () => {
    const otherRegion = { ...ct, arn: CT_BASELINE.replace(REGION, 'eusc-de-west-9') };
    expect(() => requireBaseline([otherRegion], 'AWSControlTowerBaseline', SCOPE)).toThrow(/in 'eusc-de-east-1'/);
  });

  it('treats ConfigBaseline / IdentityCenterBaseline as optional', () => {
    expect(findBaseline([ct], 'ConfigBaseline', SCOPE)).toBeUndefined();
  });

  it('flags any enabled IdentityCenterBaseline', () => {
    const record = { ...ctRecord(), baselineIdentifier: IDC_BASELINE, targetIdentifier: ACCOUNT_A };
    expect(identityCenterBaselineProblems(IDC_BASELINE, [record])).toEqual([
      expect.stringContaining('IdentityCenterBaseline is enabled')
    ]);
    expect(identityCenterBaselineProblems(IDC_BASELINE, [ctRecord()])).toEqual([]);
    expect(identityCenterBaselineProblems(undefined, [record])).toEqual([]);
  });
});

describe('runtime identity and Landing Zone gates', () => {
  it('accepts the management account in aws-eusc', () => {
    expect(
      callerIdentityProblems(
        { Account: MANAGEMENT, Arn: `arn:${PARTITION}:sts::${MANAGEMENT}:assumed-role/github-actions-role/s` },
        { accountId: MANAGEMENT, partition: PARTITION }
      )
    ).toEqual([]);
  });

  it('rejects another account', () => {
    expect(
      callerIdentityProblems(
        { Account: '999999999999', Arn: `arn:${PARTITION}:sts::999999999999:assumed-role/x/s` },
        { accountId: MANAGEMENT, partition: PARTITION }
      )
    ).toHaveLength(1);
  });

  it('requires Landing Zone 4.0, ACTIVE and IN_SYNC', () => {
    expect(landingZoneProblems({ version: '4.0', status: 'ACTIVE', driftStatus: 'IN_SYNC' }, '4.0')).toEqual([]);
    expect(landingZoneProblems({ version: '3.3', status: 'PROCESSING', driftStatus: 'DRIFTED' }, '4.0')).toHaveLength(
      3
    );
  });
});

describe('baseline version resolution', () => {
  it('maps Landing Zone 4.0 to AWSControlTowerBaseline 5.0 when nothing is enabled yet', () => {
    expect(resolveBaselineVersion('4.0', [])).toEqual({ version: '5.0', source: 'compatibility-table' });
  });

  it('fails closed for an unsupported Landing Zone version', () => {
    expect(() => resolveBaselineVersion('3.3', [])).toThrow(/no reviewed AWSControlTowerBaseline compatibility entry/);
  });

  it('uses an agreeing existing successful version', () => {
    expect(resolveBaselineVersion('4.0', [ctRecord()])).toEqual({
      version: '5.0',
      source: 'existing-enabled-baselines'
    });
  });

  it('fails when an existing successful version disagrees with the table', () => {
    expect(() => resolveBaselineVersion('4.0', [ctRecord({ baselineVersion: '4.0' })])).toThrow(
      /conflicts with version '5.0'/
    );
  });

  it('fails when existing successful versions are inconsistent', () => {
    expect(() =>
      resolveBaselineVersion('4.0', [ctRecord(), ctRecord({ arn: `${ENABLED_ARN}2`, baselineVersion: '4.0' })])
    ).toThrow(/inconsistent versions/);
  });

  it('ignores child and unsuccessful records', () => {
    expect(
      resolveBaselineVersion('4.0', [
        child(ACCOUNT_A),
        ctRecord({ baselineVersion: '4.0', statusSummary: { status: 'FAILED' } })
      ])
    ).toEqual({ version: '5.0', source: 'compatibility-table' });
  });
});

describe('enabled-baseline classification', () => {
  it('SUCCEEDED with every account enrolled is governed (no-op)', () => {
    const state = classifyTarget(
      input({ targetRecords: [ctRecord()], childRecords: [child(ACCOUNT_A), child(ACCOUNT_B)] })
    );
    expect(state.kind).toBe('governed');
    expect(plannedAction(state, false, false)).toBe('none');
  });

  it('a missing account child baseline is governed-account-not-enrolled (reset once)', () => {
    const state = classifyTarget(input({ targetRecords: [ctRecord()], childRecords: [child(ACCOUNT_A)] }));
    expect(state).toMatchObject({ kind: 'governed-account-not-enrolled', accountIds: ['333333333333'] });
    expect(plannedAction(state, false, false)).toBe('reset');
    expect(plannedAction(state, true, false)).toBe('stop');
  });

  it('no record is not-governed (enable)', () => {
    const state = classifyTarget(input());
    expect(state.kind).toBe('not-governed');
    expect(plannedAction(state, false, false)).toBe('enable');
  });

  it('a nested OU with a parent planned earlier in the rollout may be enabled', () => {
    expect(classifyTarget(input({ ouPath: 'Workloads/Corp', parentState: 'planned' })).kind).toBe('not-governed');
  });

  it('a nested OU whose parent is not governed is incompatible', () => {
    const state = classifyTarget(input({ ouPath: 'Workloads/Corp', parentState: 'not-governed' }));
    expect(state).toMatchObject({ kind: 'incompatible', reasons: [expect.stringContaining('parent OU')] });
  });

  it('UNDER_CHANGE polls the existing operation and never submits a duplicate', () => {
    const state = classifyTarget(
      input({
        targetRecords: [ctRecord({ statusSummary: { status: 'UNDER_CHANGE', lastOperationIdentifier: OPERATION } })]
      })
    );
    expect(state).toEqual(expect.objectContaining({ kind: 'in-progress', operationIdentifier: OPERATION }));
    expect(plannedAction(state, false, false)).toBe('poll');
    expect(plannedAction(state, true, false)).toBe('poll');
  });

  it('a child operation in progress is polled too', () => {
    const state = classifyTarget(
      input({ targetRecords: [ctRecord()], childRecords: [child(ACCOUNT_A, 'UNDER_CHANGE'), child(ACCOUNT_B)] })
    );
    expect(state.kind).toBe('in-progress');
  });

  it('a conflicting ConfigBaseline is incompatible', () => {
    const config = { ...ctRecord(), arn: `${ENABLED_ARN}C`, baselineIdentifier: CONFIG_BASELINE };
    const state = classifyTarget(input({ targetRecords: [config] }));
    expect(state).toMatchObject({ kind: 'incompatible', reasons: [expect.stringContaining('ConfigBaseline')] });
    expect(plannedAction(state, false, false)).toBe('stop');
  });

  it('a wrong AWSControlTowerBaseline version is incompatible', () => {
    const state = classifyTarget(input({ targetRecords: [ctRecord({ baselineVersion: '4.0' })] }));
    expect(state).toMatchObject({ kind: 'incompatible', reasons: [expect.stringContaining("version '4.0'")] });
  });

  it('FAILED is previously-failed: one reset, then stop', () => {
    const state = classifyTarget(input({ targetRecords: [ctRecord({ statusSummary: { status: 'FAILED' } })] }));
    expect(state.kind).toBe('previously-failed');
    expect(plannedAction(state, false, false)).toBe('reset');
    expect(plannedAction(state, true, false)).toBe('stop');
  });

  it('an unknown status is incompatible', () => {
    const state = classifyTarget(input({ targetRecords: [ctRecord({ statusSummary: { status: 'MYSTERY' } })] }));
    expect(state).toMatchObject({ kind: 'incompatible', reasons: [expect.stringContaining("'MYSTERY'")] });
  });

  it('OU inheritance drift with every configured account enrolled and in sync is unexplained and fails closed', () => {
    const state = classifyTarget(
      input({
        targetRecords: [ctRecord({ driftStatusSummary: { types: { inheritance: { status: 'DRIFTED' } } } })],
        childRecords: [child(ACCOUNT_A), child(ACCOUNT_B)]
      })
    );
    expect(state).toMatchObject({ kind: 'incompatible', reasons: [expect.stringContaining('inheritance drift')] });
  });

  it('OU inheritance drift caused by an unenrolled configured account takes the approved account-not-enrolled path', () => {
    const state = classifyTarget(
      input({
        targetRecords: [ctRecord({ driftStatusSummary: { types: { inheritance: { status: 'DRIFTED' } } } })],
        childRecords: [child(ACCOUNT_A)]
      })
    );
    expect(state).toMatchObject({ kind: 'governed-account-not-enrolled', accountIds: ['333333333333'] });
  });

  it('a malformed OU drift summary fails closed', () => {
    const state = classifyTarget(
      input({
        targetRecords: [ctRecord({ driftStatusSummary: { types: { inheritance: { status: 'SOMEWHAT' } } } })],
        childRecords: [child(ACCOUNT_A), child(ACCOUNT_B)]
      })
    );
    expect(state.kind).toBe('incompatible');
  });

  it('a malformed enabled-baseline ARN or a record for another target fails closed', () => {
    expect(classifyTarget(input({ targetRecords: [ctRecord({ arn: 'arn:aws-eusc:controltower:x' })] })).kind).toBe(
      'incompatible'
    );
    expect(
      classifyTarget(input({ targetRecords: [ctRecord({ targetIdentifier: OU_ARN.replace('cdef3456', 'zzzz9999') })] }))
        .kind
    ).toBe('incompatible');
  });

  it('Sandbox is a normal target and is enabled while empty', () => {
    const state = classifyTarget(input({ ouPath: 'Sandbox', expectedAccountArns: [] }));
    expect(state.kind).toBe('not-governed');
    expect(plannedAction(state, false, false)).toBe('enable');
  });

  it('an empty OU with AWSControlTowerBaseline SUCCEEDED is governed', () => {
    expect(
      classifyTarget(input({ ouPath: 'Workloads', targetRecords: [ctRecord()], expectedAccountArns: [] })).kind
    ).toBe('governed');
  });

  it.each(['Security', 'Suspended'])('the %s OU is never a target', (ouPath) => {
    expect(classifyTarget(input({ ouPath })).kind).toBe('incompatible');
  });
});

describe('operation-state classification', () => {
  const ID = '00000000-0000-4000-8000-000000000001';

  it.each(['SUCCEEDED', 'IN_PROGRESS', 'FAILED'] as const)('the documented status %s is itself', (status) => {
    expect(classifyBaselineOperation({ operationIdentifier: ID, status }, ID)).toEqual({ outcome: status });
    expect(classifyBaselineOperation({ status, startTime: '2026-10-13T10:00:00.000Z' }, ID)).toEqual({
      outcome: status
    });
  });

  it.each([
    ['a missing status', { operationIdentifier: ID }, /status is missing/],
    ['an empty status', { status: '' }, /status "" is not one of/],
    ['an unknown status', { status: 'CANCELLED' }, /status "CANCELLED" is not one of/],
    ['a lowercase status', { status: 'failed' }, /status "failed" is not one of/],
    ['a non-string status', { status: 1 }, /status 1 is not one of/],
    [
      'another operation identifier',
      { operationIdentifier: '00000000-0000-4000-8000-000000000002', status: 'FAILED' },
      /not the one requested/
    ],
    ['an unparsable startTime', { status: 'IN_PROGRESS', startTime: 'yesterday' }, /startTime "yesterday"/],
    ['a missing baselineOperation', undefined, /no baselineOperation object/],
    ['a null baselineOperation', null, /no baselineOperation object/],
    ['a list baselineOperation', [{ status: 'FAILED' }], /no baselineOperation object/],
    ['a string baselineOperation', 'FAILED', /no baselineOperation object/]
  ])('%s is MALFORMED, never FAILED', (_label, operation, reason) => {
    const result = classifyBaselineOperation(operation, ID);
    expect(result.outcome).toBe('MALFORMED');
    expect(result.reason).toMatch(reason);
  });
});

describe('rollout targets', () => {
  it('Staging and Production share one 12-OU rollout order from config/default.yaml', () => {
    expect(stagingConfig.controlTower.enrollment?.rolloutOrder).toEqual(ROLLOUT_ORDER);
    expect(productionConfig.controlTower.enrollment?.rolloutOrder).toEqual(ROLLOUT_ORDER);
  });

  it('Staging: 12 targets, 8 configured accounts; Sandbox and the four Workloads parents are empty', () => {
    const targets = deriveEnrollmentTargets(ROLLOUT_ORDER, stagingAccounts);
    expect(targets.map((target) => target.ouPath)).toEqual(ROLLOUT_ORDER);
    const accountsByOu = Object.fromEntries(targets.map((target) => [target.ouPath, target.accountKeys]));
    expect(accountsByOu).toEqual({
      Infrastructure: ['network', 'sharedServices'],
      Sandbox: [],
      Workloads: [],
      'Workloads/Corp': [],
      'Workloads/Corp/Non-Prod': ['ccoeCorpVerificationNonProd01'],
      'Workloads/Hybrid': [],
      'Workloads/Online': [],
      'Workloads/Hybrid/Non-Prod': ['ccoeHybridVerificationNonProd01'],
      'Workloads/Online/Non-Prod': ['ccoeOnlineVerificationNonProd01'],
      'Workloads/Corp/Prod': ['ccoeCorpVerificationProd01'],
      'Workloads/Hybrid/Prod': ['ccoeHybridVerificationProd01'],
      'Workloads/Online/Prod': ['ccoeOnlineVerificationProd01']
    });
    expect(targets.reduce((count, target) => count + target.accountKeys.length, 0)).toBe(8);
  });

  it('Production: 12 targets, 2 configured accounts in Infrastructure; Sandbox and all 10 Workloads OUs are empty', () => {
    const targets = deriveEnrollmentTargets(ROLLOUT_ORDER, productionAccounts);
    expect(targets.map((target) => target.ouPath)).toEqual(ROLLOUT_ORDER);
    expect(targets[0]).toMatchObject({ ouPath: 'Infrastructure', accountKeys: ['network', 'sharedServices'] });
    expect(productionAccounts.map((account) => account.name).sort()).toEqual(['Network', 'SharedServices']);
    expect(targets.find((target) => target.ouPath === 'Sandbox')?.accountKeys).toEqual([]);
    const workloads = targets.filter((target) => target.ouPath.startsWith('Workloads'));
    expect(workloads.map((target) => target.ouPath)).toEqual(WORKLOADS_OUS);
    expect(workloads).toHaveLength(10);
    expect(workloads.every((target) => target.accountKeys.length === 0)).toBe(true);
  });

  it('orders every parent before its children', () => {
    const targets = deriveEnrollmentTargets(ROLLOUT_ORDER, stagingAccounts);
    targets.forEach((target, index) => {
      if (target.parentPath !== undefined) {
        expect(ROLLOUT_ORDER.indexOf(target.parentPath), target.ouPath).toBeLessThan(index);
      }
    });
    expect(targets.filter((target) => target.parentPath === undefined).map((target) => target.ouPath)).toEqual([
      'Infrastructure',
      'Sandbox',
      'Workloads'
    ]);
  });

  it('rejects child-before-parent', () => {
    expect(() => deriveEnrollmentTargets(['Workloads/Corp', 'Workloads'], [])).toThrow(
      /after its parent OU 'Workloads'/
    );
  });

  it.each(['Security', 'Suspended'])('rejects %s', (ouPath) => {
    expect(() => deriveEnrollmentTargets([ouPath], [])).toThrow(/must not be enrolled/);
  });

  it('accepts Sandbox as a top-level target', () => {
    expect(deriveEnrollmentTargets(['Sandbox'], [])).toEqual([
      { ouPath: 'Sandbox', parentPath: undefined, accountKeys: [] }
    ]);
  });

  it('rejects an account OU missing from the order', () => {
    expect(() => deriveEnrollmentTargets(['Infrastructure'], stagingAccounts)).toThrow(/not in the rollout order/);
  });

  it('marks only OUs under Workloads as SCP-ESC-IAM-001 guarded', () => {
    expect(isIamEscalationGuarded('Infrastructure')).toBe(false);
    expect(isIamEscalationGuarded('Sandbox')).toBe(false);
    expect(isIamEscalationGuarded('Workloads')).toBe(true);
    expect(isIamEscalationGuarded('Workloads/Corp/Non-Prod')).toBe(true);
  });
});

/**
 * Minimal read-only AWS Organizations fake for the account-readiness gate. Enrollment reuses the
 * account-provisioning reconciler (`buildAccountPlan` + `assertAccountPlanReconciled`); these tests
 * prove that a live account in the wrong state blocks enrollment through that same gate.
 */
class ReadOnlyOrganization implements OrganizationsAccountPort {
  public constructor(
    private readonly ous: Readonly<Record<string, readonly OrganizationalUnitSummary[]>>,
    private readonly accounts: readonly OrganizationAccount[],
    private readonly parents: Readonly<Record<string, string>>,
    private readonly tags: Readonly<Record<string, readonly AccountTag[]>>
  ) {}

  public async listAccounts(): Promise<readonly OrganizationAccount[]> {
    return this.accounts;
  }
  public async getRootId(): Promise<string> {
    return 'r-a1b2';
  }
  public async listOrganizationalUnitsForParent(parentId: string): Promise<readonly OrganizationalUnitSummary[]> {
    return this.ous[parentId] ?? [];
  }
  public async getParent(accountId: string): Promise<OrganizationParent> {
    const id = this.parents[accountId] ?? 'r-a1b2';
    return { id, type: id.startsWith('r-') ? 'ROOT' : 'ORGANIZATIONAL_UNIT' };
  }
  public async listTags(accountId: string): Promise<readonly AccountTag[]> {
    return this.tags[accountId] ?? [];
  }
  public async listInProgressCreateAccountRequests(): Promise<readonly CreateAccountRequestStatus[]> {
    return [];
  }
  public async createAccount(): Promise<string> {
    throw new Error('enrollment readiness must never create an account');
  }
  public async describeCreateAccountStatus(): Promise<CreateAccountRequestStatus> {
    throw new Error('not used');
  }
  public async describeAccount(): Promise<OrganizationAccount> {
    throw new Error('not used');
  }
  public async moveAccount(): Promise<void> {
    throw new Error('enrollment readiness must never move an account');
  }
  public async tagAccount(): Promise<void> {
    throw new Error('enrollment readiness must never tag an account');
  }
}

describe('account readiness and runtime handoff', () => {
  const INFRA_OU = 'ou-a1b2-infra0001';
  const infrastructureAccounts = stagingAccounts.filter((account) => account.ouPath === 'Infrastructure');
  const ids: Record<string, string> = { network: '222222222222', sharedServices: '333333333333' };

  function organization(overrides: Partial<Record<string, Partial<OrganizationAccount>>> = {}, parent = INFRA_OU) {
    const accounts = infrastructureAccounts.map((desired) => ({
      id: ids[desired.key] ?? '',
      name: desired.name,
      email: desired.email,
      state: 'ACTIVE',
      ...overrides[desired.key]
    }));
    return new ReadOnlyOrganization(
      { 'r-a1b2': [{ id: INFRA_OU, name: 'Infrastructure' }] },
      accounts,
      Object.fromEntries(accounts.map((account) => [account.id, parent])),
      Object.fromEntries(infrastructureAccounts.map((desired) => [ids[desired.key] ?? '', desired.tags]))
    );
  }

  async function readiness(port: OrganizationsAccountPort): Promise<string | undefined> {
    const plan = await buildAccountPlan(port, infrastructureAccounts);
    try {
      assertAccountPlanReconciled(plan);
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  }

  it('passes when every account is ACTIVE with the configured name, email and parent OU', async () => {
    expect(await readiness(organization())).toBeUndefined();
  });

  it('blocks a non-ACTIVE account', async () => {
    expect(await readiness(organization({ network: { state: 'SUSPENDED' } }))).toMatch(/not ACTIVE/);
  });

  it('blocks a name mismatch', async () => {
    expect(await readiness(organization({ network: { name: 'Network-Old' } }))).toMatch(/named 'Network-Old'/);
  });

  it('blocks an email mismatch', async () => {
    expect(await readiness(organization({ network: { email: 'someone-else@example.com' } }))).toMatch(
      /CONFLICT|MISSING/
    );
  });

  it('blocks an account under another OU', async () => {
    expect(await readiness(organization({}, 'ou-a1b2-elsewhere1'))).toMatch(/not the configured 'Infrastructure' OU/);
  });

  const reconciled = [
    { key: 'network', ouPath: 'Infrastructure', accountId: '222222222222', targetOuId: INFRA_OU },
    { key: 'sharedServices', ouPath: 'Infrastructure', accountId: '333333333333', targetOuId: INFRA_OU }
  ];
  const accountIds = 'network=222222222222\nsharedServices=333333333333\n';
  const ouIds = `Infrastructure=${INFRA_OU}\n`;

  it('accepts account-ids and ou-ids that match the live Organization', () => {
    expect(runtimeHandoffProblems(reconciled, accountIds, ouIds)).toEqual([]);
  });

  it('rejects a missing, extra, malformed or different account ID', () => {
    expect(runtimeHandoffProblems(reconciled, 'network=222222222222\n', ouIds)).toEqual([
      expect.stringContaining("'sharedServices' is missing")
    ]);
    expect(runtimeHandoffProblems(reconciled, `${accountIds}extra=444444444444\n`, ouIds)).toEqual([
      expect.stringContaining("'extra' is not a configured account")
    ]);
    expect(runtimeHandoffProblems(reconciled, 'network=22\nsharedServices=333333333333\n', ouIds)).toEqual(
      expect.arrayContaining([expect.stringContaining('invalid account ID')])
    );
    expect(runtimeHandoffProblems(reconciled, 'network=999999999999\nsharedServices=333333333333\n', ouIds)).toEqual([
      expect.stringContaining('live Organization reports 222222222222')
    ]);
  });

  it('rejects an ou-ids handoff that is missing, extra or different from the live OU', () => {
    expect(runtimeHandoffProblems(reconciled, accountIds, '')).toEqual([
      expect.stringContaining("OU 'Infrastructure' of a configured account is missing")
    ]);
    expect(runtimeHandoffProblems(reconciled, accountIds, `${ouIds}Workloads=ou-a1b2-wkld00001\n`)).toEqual([
      expect.stringContaining("'Workloads' holds no configured account")
    ]);
    expect(runtimeHandoffProblems(reconciled, accountIds, 'Infrastructure=ou-a1b2-other0001\n')).toEqual([
      expect.stringContaining(`live Organization resolves ${INFRA_OU}`)
    ]);
  });

  it('validates OU ARNs returned by DescribeOrganizationalUnit against partition, management account and organization', () => {
    const want = {
      partition: PARTITION,
      managementAccountId: MANAGEMENT,
      organizationId: ORG,
      ouId: 'ou-ab12-cdef3456'
    };
    expect(ouArnProblems(OU_ARN, want)).toEqual([]);
    expect(ouArnProblems(OU_ARN.replace(PARTITION, 'aws'), want)).toHaveLength(1);
    expect(ouArnProblems(OU_ARN, { ...want, organizationId: 'o-zzzzzzzzzz' })).toHaveLength(1);
    expect(ouArnProblems(OU_ARN, { ...want, ouId: 'ou-ab12-zzzz9999' })).toHaveLength(1);
  });
});

describe('AWS Config precheck', () => {
  const empty = { recorders: [], deliveryChannels: [], recorderStatuses: [] };
  const controlTowerManaged = {
    recorders: [{ name: CONTROL_TOWER_CONFIG_RECORDER_NAME }],
    deliveryChannels: [{ name: CONTROL_TOWER_CONFIG_DELIVERY_CHANNEL_NAME }],
    recorderStatuses: [{ name: CONTROL_TOWER_CONFIG_RECORDER_NAME, recording: true }]
  };

  it('passes an empty account before enrollment', () => {
    expect(configPrecheckProblems(empty, false)).toEqual([]);
  });

  it('passes Control Tower-managed resources on an idempotent rerun', () => {
    expect(configPrecheckProblems(controlTowerManaged, true)).toEqual([]);
  });

  it('rejects Control Tower-named resources on an account that is not enrolled', () => {
    expect(configPrecheckProblems(controlTowerManaged, false)).toHaveLength(2);
  });

  it('fails a foreign configuration recorder with diagnostics', () => {
    const problems = configPrecheckProblems(
      {
        ...empty,
        recorders: [{ name: 'default', roleARN: 'role' }],
        recorderStatuses: [{ name: 'default', recording: true, lastStatus: 'SUCCESS' }]
      },
      true
    );
    expect(problems).toEqual([
      expect.stringMatching(/recorder 'default' \(role role, recording=true, lastStatus=SUCCESS\)/)
    ]);
  });

  it('fails a foreign delivery channel with its bucket', () => {
    expect(
      configPrecheckProblems(
        { ...empty, deliveryChannels: [{ name: 'default', s3BucketName: 'legacy-bucket' }] },
        false
      )
    ).toEqual([expect.stringContaining("delivery channel 'default' (bucket legacy-bucket)")]);
  });
});

describe('SCP headroom', () => {
  const policies = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ Name: index === 0 ? 'FullAWSAccess' : `SCP-ESC-${index}` }));

  it('projects one Control Tower mandatory SCP on a top-level OU', () => {
    expect(evaluateScpHeadroom('Workloads', policies(8), 10)).toMatchObject({
      directlyAttached: 8,
      fullAwsAccessAttached: true,
      expectedControlTowerAdditions: 1,
      projected: 9,
      ok: true
    });
  });

  it('fails before mutation when registration would exceed the quota', () => {
    expect(evaluateScpHeadroom('Workloads', policies(10), 10)).toMatchObject({ projected: 11, ok: false });
  });

  it('needs no new slot on a nested OU or when a Control Tower SCP is already attached', () => {
    expect(evaluateScpHeadroom('Workloads/Corp', policies(10), 10).ok).toBe(true);
    expect(
      evaluateScpHeadroom('Infrastructure', [...policies(2), { Name: 'aws-guardrails-AbCdEf' }], 10)
        .expectedControlTowerAdditions
    ).toBe(0);
  });
});

describe('execution-role model', () => {
  it('accepts AWSControlTowerExecution deployed by a stacksets-exec role on path /', () => {
    expect(
      evaluateExecutionRoleModel([
        { RoleName: 'AWSControlTowerExecution', Path: '/' },
        { RoleName: 'stacksets-exec-0123456789abcdef0123456789abcdef', Path: '/' }
      ]).problems
    ).toEqual([]);
  });

  it('rejects a missing execution role or StackSets role, or a StackSets role off path /', () => {
    expect(evaluateExecutionRoleModel([]).problems).toHaveLength(2);
    expect(
      evaluateExecutionRoleModel([
        { RoleName: 'AWSControlTowerExecution', Path: '/' },
        { RoleName: 'stacksets-exec-abc', Path: '/service-role/' }
      ]).problems
    ).toEqual([expect.stringContaining("path '/service-role/'")]);
  });
});

describe('GetBaseline response (GetBaselineOutput: arn, name, description at the top level)', () => {
  const expected = { arn: CT_BASELINE, name: 'AWSControlTowerBaseline' };
  const real = {
    arn: CT_BASELINE,
    name: 'AWSControlTowerBaseline',
    description: 'Sets up resources and mandatory controls for member accounts within the target OU.'
  };

  it('accepts the real response shape and reads the top-level name', () => {
    expect(getBaselineProblems(real, expected)).toEqual([]);
  });

  it('fails closed on a missing response, missing or empty name, wrong name or wrong ARN', () => {
    expect(getBaselineProblems(undefined, expected)).toEqual(['GetBaseline returned no response object']);
    expect(getBaselineProblems({ arn: CT_BASELINE }, expected)).toEqual(['GetBaseline returned no baseline name']);
    expect(getBaselineProblems({ ...real, name: '' }, expected)).toEqual(['GetBaseline returned no baseline name']);
    expect(getBaselineProblems({ ...real, name: 'BackupBaseline' }, expected)).toEqual([
      expect.stringContaining("returned name 'BackupBaseline'")
    ]);
    expect(getBaselineProblems({ ...real, arn: IDC_BASELINE }, expected)).toEqual([
      expect.stringContaining('returned ARN')
    ]);
  });

  it('never treats a nested baseline object as authoritative', () => {
    expect(getBaselineProblems({ arn: CT_BASELINE, baseline: { name: 'AWSControlTowerBaseline' } }, expected)).toEqual([
      'GetBaseline returned no baseline name'
    ]);
  });
});

describe('drift state (EnabledBaselineDriftStatusSummary)', () => {
  it('recognises IN_SYNC and DRIFTED, reports absent optional metadata as NOT_REPORTED and rejects malformed data', () => {
    expect(driftState({ types: { inheritance: { status: 'IN_SYNC' } } })).toBe('IN_SYNC');
    expect(driftState({ types: { inheritance: { status: 'DRIFTED' } } })).toBe('DRIFTED');
    expect(driftState(undefined)).toBe('NOT_REPORTED');
    expect(driftState({})).toBe('NOT_REPORTED');
    expect(driftState({ types: {} })).toBe('NOT_REPORTED');
    expect(driftState({ types: { inheritance: {} } })).toBe('NOT_REPORTED');
    expect(driftState({ types: { inheritance: { status: 'UNKNOWN_VALUE' } } })).toBe('MALFORMED');
    expect(driftState({ types: { inheritance: 'DRIFTED' } })).toBe('MALFORMED');
    expect(driftState('DRIFTED')).toBe('MALFORMED');
    expect(driftState({ types: [] })).toBe('MALFORMED');
  });
});

describe('child baseline state machine (fail closed)', () => {
  const governed = (children: EnabledBaselineSummary[]) =>
    classifyTarget(input({ targetRecords: [ctRecord()], childRecords: children }));
  const actions = (state: ReturnType<typeof governed>) => [
    plannedAction(state, false, false),
    plannedAction(state, false, true)
  ];

  it('UNDER_CHANGE child with a valid operation identifier polls the existing operation', () => {
    const state = governed([child(ACCOUNT_A, 'UNDER_CHANGE'), child(ACCOUNT_B)]);
    expect(state).toEqual(expect.objectContaining({ kind: 'in-progress', operationIdentifier: OPERATION }));
    expect(actions(state)).toEqual(['poll', 'poll']);
  });

  it.each([
    ['missing', undefined],
    ['malformed', 'not-an-operation-id']
  ])('UNDER_CHANGE child with a %s operation identifier fails closed, never reset or enabled', (_label, operation) => {
    const state = governed([
      child(ACCOUNT_A, 'UNDER_CHANGE', {
        statusSummary: { status: 'UNDER_CHANGE', lastOperationIdentifier: operation }
      }),
      child(ACCOUNT_B)
    ]);
    expect(state).toMatchObject({ kind: 'incompatible', reasons: [expect.stringContaining('operation identifier')] });
    expect(actions(state)).toEqual(['stop', 'stop']);
  });

  it('SUCCEEDED + expected version + IN_SYNC is healthy', () => {
    expect(governed([child(ACCOUNT_A), child(ACCOUNT_B)]).kind).toBe('governed');
  });

  it('SUCCEEDED with no drift summary is healthy: the API model makes the drift summary optional', () => {
    const state = governed([
      child(ACCOUNT_A, 'SUCCEEDED', { driftStatusSummary: undefined }),
      child(ACCOUNT_B, 'SUCCEEDED', { driftStatusSummary: {} })
    ]);
    expect(state.kind).toBe('governed');
  });

  it('SUCCEEDED + DRIFTED is not healthy: it takes only the approved bounded account path', () => {
    const state = governed([
      child(ACCOUNT_A, 'SUCCEEDED', { driftStatusSummary: { types: { inheritance: { status: 'DRIFTED' } } } }),
      child(ACCOUNT_B)
    ]);
    expect(state).toMatchObject({ kind: 'governed-account-not-enrolled', accountIds: ['222222222222'] });
    expect(actions(state)).toEqual(['reset', 'converge']);
  });

  it('SUCCEEDED + malformed drift metadata fails closed', () => {
    const state = governed([
      child(ACCOUNT_A, 'SUCCEEDED', { driftStatusSummary: { types: { inheritance: { status: 'SOMETIMES' } } } }),
      child(ACCOUNT_B)
    ]);
    expect(state.kind).toBe('incompatible');
    expect(actions(state)).toEqual(['stop', 'stop']);
  });

  it.each([
    ['incompatible', '4.0'],
    ['missing', undefined]
  ])('SUCCEEDED with an %s child version fails closed', (_label, version) => {
    const state = governed([child(ACCOUNT_A, 'SUCCEEDED', { baselineVersion: version }), child(ACCOUNT_B)]);
    expect(state).toMatchObject({ kind: 'incompatible', reasons: [expect.stringContaining('child version')] });
    expect(actions(state)).toEqual(['stop', 'stop']);
  });

  it.each(['MYSTERY', undefined])('unknown child status %s fails closed', (status) => {
    const state = governed([child(ACCOUNT_A, 'SUCCEEDED', { statusSummary: { status } }), child(ACCOUNT_B)]);
    expect(state).toMatchObject({ kind: 'incompatible', reasons: [expect.stringContaining('unknown child status')] });
    expect(actions(state)).toEqual(['stop', 'stop']);
  });

  it('a child that targets something other than an account of this Organization fails closed', () => {
    const state = governed([
      child(ACCOUNT_A),
      child(ACCOUNT_B),
      child('arn:aws-eusc:organizations::999999999999:account/o-zzzzzzzzzz/444444444444')
    ]);
    expect(state).toMatchObject({
      kind: 'incompatible',
      reasons: [expect.stringContaining('not an account of this Organization')]
    });
  });

  it('a child with a malformed ARN, a foreign parent or another baseline fails closed', () => {
    expect(governed([child(ACCOUNT_A, 'SUCCEEDED', { arn: 'bad' }), child(ACCOUNT_B)]).kind).toBe('incompatible');
    expect(
      governed([child(ACCOUNT_A, 'SUCCEEDED', { parentIdentifier: `${ENABLED_ARN}X` }), child(ACCOUNT_B)]).kind
    ).toBe('incompatible');
    expect(
      governed([child(ACCOUNT_A, 'SUCCEEDED', { baselineIdentifier: CONFIG_BASELINE }), child(ACCOUNT_B)]).kind
    ).toBe('incompatible');
  });

  it('a FAILED child takes only the approved bounded account path', () => {
    const state = governed([child(ACCOUNT_A, 'FAILED'), child(ACCOUNT_B)]);
    expect(state.kind).toBe('governed-account-not-enrolled');
    expect(actions(state)).toEqual(['reset', 'converge']);
  });

  it('reports per-account health, and malformed state never reads as not-enrolled', () => {
    const health = childBaselineHealth({
      parent: ctRecord(),
      children: [child(ACCOUNT_A, 'UNDER_CHANGE', { statusSummary: { status: 'UNDER_CHANGE' } })],
      expectedAccountArns: [ACCOUNT_A, ACCOUNT_B],
      controlTowerBaselineArn: CT_BASELINE,
      expectedVersion: '5.0',
      scope: ENROLLMENT_SCOPE
    });
    expect(health.byAccount.get(ACCOUNT_A)?.kind).toBe('malformed');
    expect(health.byAccount.get(ACCOUNT_B)?.kind).toBe('not-enrolled');
    expect(health.malformed).toHaveLength(1);
  });

  it('validates enabled-baseline ARNs against partition, Region and management account', () => {
    expect(enabledBaselineArnProblems(ENABLED_ARN, ENROLLMENT_SCOPE)).toEqual([]);
    expect(enabledBaselineArnProblems(ENABLED_ARN.replace(MANAGEMENT, '999999999999'), ENROLLMENT_SCOPE)).toHaveLength(
      1
    );
    expect(enabledBaselineArnProblems(ENABLED_ARN.replace(PARTITION, 'aws'), ENROLLMENT_SCOPE)).toHaveLength(1);
    expect(enabledBaselineArnProblems(undefined, ENROLLMENT_SCOPE)).toHaveLength(1);
  });
});

describe('Security OU baselines', () => {
  const baselines = { controlTowerBaselineArn: CT_BASELINE, configBaselineArn: CONFIG_BASELINE };
  const SECURITY_ARN = OU_ARN.replace('cdef3456', 'secu0001');
  const onSecurity = (baselineIdentifier: string, suffix: string): EnabledBaselineSummary => ({
    ...ctRecord({ arn: `${ENABLED_ARN}${suffix}`, targetIdentifier: SECURITY_ARN }),
    baselineIdentifier
  });

  it('rejects AWSControlTowerBaseline on the Security OU', () => {
    expect(securityOuBaselineProblems([onSecurity(CT_BASELINE, 'A')], baselines)).toEqual([
      expect.stringContaining(`AWSControlTowerBaseline enabled (${ENABLED_ARN}A)`)
    ]);
  });

  it('rejects ConfigBaseline on the Security OU', () => {
    expect(securityOuBaselineProblems([onSecurity(CONFIG_BASELINE, 'B')], baselines)).toEqual([
      expect.stringContaining(`ConfigBaseline enabled (${ENABLED_ARN}B)`)
    ]);
  });

  it('rejects both when both are enabled', () => {
    expect(
      securityOuBaselineProblems([onSecurity(CT_BASELINE, 'A'), onSecurity(CONFIG_BASELINE, 'B')], baselines)
    ).toHaveLength(2);
  });

  it('passes with neither OU baseline and healthy Audit / Log Archive service-integration baselines', () => {
    expect(securityOuBaselineProblems([], baselines)).toEqual([]);
    const integration = { ...ctRecord({ targetIdentifier: ACCOUNT_A }), baselineIdentifier: IDC_BASELINE };
    expect(serviceIntegrationProblems('Audit', '222222222222', [integration], () => 'CentralConfigBaseline')).toEqual(
      []
    );
  });

  it('rejects a missing or unhealthy service-integration baseline', () => {
    expect(serviceIntegrationProblems('Log Archive', '333333333333', [], () => 'x')).toEqual([
      expect.stringContaining('has no Landing Zone service-integration baseline')
    ]);
    const failed = { ...ctRecord({ statusSummary: { status: 'FAILED' } }), baselineIdentifier: IDC_BASELINE };
    expect(serviceIntegrationProblems('Audit', '222222222222', [failed], () => 'CentralConfigBaseline')).toEqual([
      expect.stringContaining('CentralConfigBaseline is FAILED')
    ]);
  });

  it('does not affect AWSControlTowerBaseline on Infrastructure, Sandbox or Workloads', () => {
    for (const ouPath of ['Infrastructure', 'Sandbox', 'Workloads']) {
      expect(classifyTarget(input({ ouPath, targetRecords: [ctRecord()], expectedAccountArns: [] })).kind).toBe(
        'governed'
      );
    }
  });
});

describe('account auto-enrollment', () => {
  it('reports auto-enrollment disabled when remediationTypes lacks INHERITANCE_DRIFT', () => {
    expect(autoEnrollmentEnabled(undefined)).toBe(false);
    expect(autoEnrollmentEnabled([])).toBe(false);
    expect(autoEnrollmentEnabled(['SOMETHING_ELSE'])).toBe(false);
  });

  it('reports auto-enrollment enabled when remediationTypes contains INHERITANCE_DRIFT', () => {
    expect(autoEnrollmentEnabled(['INHERITANCE_DRIFT'])).toBe(true);
  });

  const notEnrolled = () => classifyTarget(input({ targetRecords: [ctRecord()], childRecords: [child(ACCOUNT_A)] }));

  it('disabled: an unenrolled account in a governed OU takes the single bounded reset', () => {
    expect(plannedAction(notEnrolled(), false, false)).toBe('reset');
    expect(plannedAction(notEnrolled(), true, false)).toBe('stop');
  });

  it('enabled: an unenrolled account in a governed OU is awaited, never reset', () => {
    expect(plannedAction(notEnrolled(), false, true)).toBe('converge');
    expect(plannedAction(notEnrolled(), true, true)).toBe('converge');
  });

  it('enabled: a previously FAILED OU still gets only the single bounded reset', () => {
    const failed = classifyTarget(input({ targetRecords: [ctRecord({ statusSummary: { status: 'FAILED' } })] }));
    expect(plannedAction(failed, false, true)).toBe('reset');
    expect(plannedAction(failed, true, true)).toBe('stop');
  });

  it('convergence waits within the bound, succeeds on governed, times out, and rejects unexpected states', () => {
    const base = { startedAtMs: 0, timeoutMs: 60_000 };
    expect(convergenceDecision({ ...base, state: 'governed-account-not-enrolled', nowMs: 1_000 })).toBe('wait');
    expect(convergenceDecision({ ...base, state: 'in-progress', nowMs: 1_000 })).toBe('wait');
    expect(convergenceDecision({ ...base, state: 'governed', nowMs: 1_000 })).toBe('converged');
    expect(convergenceDecision({ ...base, state: 'governed-account-not-enrolled', nowMs: 60_000 })).toBe('timeout');
    expect(convergenceDecision({ ...base, state: 'incompatible', nowMs: 1_000 })).toBe('unexpected');
    expect(convergenceDecision({ ...base, state: 'previously-failed', nowMs: 1_000 })).toBe('unexpected');
  });

  it('recognises ConflictException as an operation already holding the OU', () => {
    expect(isConflictError(new Error('aws controltower failed: An error occurred (ConflictException)'))).toBe(true);
    expect(isConflictError(new Error('AccessDeniedException'))).toBe(false);
  });
});

describe('required list members of AWS responses', () => {
  it('returns a present list and fails closed when the list is missing, so it can never read as "not found"', () => {
    expect(requiredList([1, 2], 'ListEnabledBaselines', 'enabledBaselines')).toEqual([1, 2]);
    expect(requiredList([], 'ListEnabledBaselines', 'enabledBaselines')).toEqual([]);
    expect(() => requiredList(undefined, 'ListEnabledBaselines', 'enabledBaselines')).toThrow(
      "ListEnabledBaselines returned no 'enabledBaselines' list."
    );
  });
});
