/**
 * AWS Control Tower OU enrollment - runtime discovery shared by
 * `scripts/enroll-control-tower-accounts.ts` and `scripts/validate-control-tower-enrollment.ts`.
 *
 * Governed by `.apm/skills/control-tower-account-enrollment/SKILL.md`. Runs ONLY in
 * the protected Staging and Production deployment jobs after OIDC credentials for
 * `github-actions-role` are configured; never from CI. Every function here is READ-ONLY except `enableBaseline` and
 * `resetEnabledBaseline`, which only the enroll script calls in `--enroll` mode. Every decision is
 * delegated to the pure functions in `lib/control-tower/baseline-enrollment.ts`.
 *
 * Account and OU readiness reuse the idempotent account-provisioning reconciler
 * (`lib/organization/landing-zone-account-reconciler.ts`) over the AWS Organizations adapter: a
 * fresh read-only `buildAccountPlan` must report every configured account reconciled, OU paths are
 * resolved live from the Organization Root with `resolveOuPath`, and the transient `account-ids` /
 * `ou-ids` outputs of the account step are cross-checked against that live result.
 *
 * Member-account reads (AWS Config precheck, IAM role checks, CloudTrail diagnostics) assume the
 * `OrganizationAccountAccessRole` that AWS Organizations created with each account. Nothing is
 * created in member accounts; `AWSControlTowerExecution` is never pre-created.
 */

import { execFileSync } from 'node:child_process';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import {
  controlTowerLandingZoneVersion,
  ENROLLMENT_ENVIRONMENTS,
  type EnrollmentEnvironment
} from '../config/schemas/control-tower-schema.js';
import { assertLandingZoneAccountScope } from '../config/schemas/landing-zone-accounts-schema.js';
import { keyForPath, LandingZoneSchema, type LandingZoneConfig } from '../config/schemas/organization-schema.js';
import {
  accountArn,
  autoEnrollmentEnabled,
  childBaselineHealth,
  callerIdentityProblems,
  classifyTarget,
  configPrecheckProblems,
  CONFIG_BASELINE_NAME,
  CONTROL_TOWER_BASELINE_NAME,
  CONTROL_TOWER_EXECUTION_ROLE_NAME,
  deriveEnrollmentTargets,
  evaluateExecutionRoleModel,
  evaluateScpHeadroom,
  findBaseline,
  getBaselineProblems,
  IDENTITY_CENTER_BASELINE_NAME,
  identityCenterBaselineProblems,
  landingZoneProblems,
  ouArnProblems,
  plannedAction,
  requireBaseline,
  resolveBaselineVersion,
  securityOuBaselineProblems,
  serviceIntegrationProblems,
  runtimeHandoffProblems,
  STACKSETS_EXECUTION_ROLE_PREFIX,
  type AttachedPolicy,
  type BaselineOperation,
  type BaselineSummary,
  type EnabledBaselineSummary,
  type EnrollmentTarget,
  type ExecutionRoleModel,
  type IamRole,
  type PlannedAction,
  type ResolvedBaselineVersion,
  type ScpHeadroom,
  type TargetState
} from '../lib/control-tower/baseline-enrollment.js';
import {
  assertAccountPlanReconciled,
  buildAccountPlan,
  resolveOuPath,
  toDesiredLandingZoneAccounts
} from '../lib/organization/landing-zone-account-reconciler.js';
import {
  createOrganizationsAccountPort,
  createOrganizationsClient
} from '../lib/organization/organizations-account-adapter.js';
import { MAX_SERVICE_CONTROL_POLICIES_PER_NODE } from '../lib/organization/organization-policy-stack.js';
import { scpEscIam001 } from '../lib/organization/policies/identity-policies.js';

export const MEMBER_ACCESS_ROLE_NAME = 'OrganizationAccountAccessRole';
const SECURITY_OU_PATH = 'Security';

// ---------------------------------------------------------------------------------------------
// AWS CLI access.
// ---------------------------------------------------------------------------------------------

export type CredentialEnv = NodeJS.ProcessEnv;

/**
 * A list member the API model marks as required. A missing or non-list value is an error, never an
 * empty result, so malformed responses cannot read as "nothing enabled" or "nothing attached".
 */
export function requiredList<T>(value: readonly T[] | undefined, operation: string, member: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${operation} returned no '${member}' list.`);
  return [...value];
}

export class AwsCli {
  public constructor(private readonly region: string) {}

  /** Runs an AWS CLI command and parses its JSON output. `env` carries assumed member credentials. */
  public json<T>(args: readonly string[], env?: CredentialEnv): T {
    const command = [...args, '--region', this.region, '--output', 'json', '--no-cli-pager'];
    let stdout: string;
    try {
      stdout = execFileSync('aws', command, { encoding: 'utf8', env: env ?? process.env, maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim();
      throw new Error(`aws ${args.slice(0, 2).join(' ')} failed: ${stderr || (error as Error).message}`, {
        cause: error
      });
    }
    return (stdout.trim() === '' ? {} : JSON.parse(stdout)) as T;
  }

  /** Credentials for `OrganizationAccountAccessRole` in a member account (read-only use). */
  public memberEnv(partition: string, accountId: string, purpose: string): CredentialEnv {
    const response = this.json<{
      Credentials?: { AccessKeyId?: string; SecretAccessKey?: string; SessionToken?: string };
    }>([
      'sts',
      'assume-role',
      '--role-arn',
      `arn:${partition}:iam::${accountId}:role/${MEMBER_ACCESS_ROLE_NAME}`,
      '--role-session-name',
      `lz-ct-enroll-${purpose}-${accountId}`.slice(0, 64),
      '--duration-seconds',
      '900'
    ]);
    const credentials = response.Credentials;
    if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
      throw new Error(`assume-role into ${MEMBER_ACCESS_ROLE_NAME} in ${accountId} returned no credentials.`);
    }
    const env: CredentialEnv = { ...process.env };
    delete env['AWS_PROFILE'];
    env['AWS_ACCESS_KEY_ID'] = credentials.AccessKeyId;
    env['AWS_SECRET_ACCESS_KEY'] = credentials.SecretAccessKey;
    env['AWS_SESSION_TOKEN'] = credentials.SessionToken;
    return env;
  }

  public listEnabledBaselines(
    filter: Readonly<Record<string, readonly string[]>>,
    includeChildren = false
  ): EnabledBaselineSummary[] {
    const args = ['controltower', 'list-enabled-baselines'];
    if (Object.keys(filter).length > 0) args.push('--filter', JSON.stringify(filter));
    if (includeChildren) args.push('--include-children');
    const response = this.json<{ enabledBaselines?: EnabledBaselineSummary[] }>(args);
    return requiredList(response.enabledBaselines, 'ListEnabledBaselines', 'enabledBaselines');
  }

  public getBaselineOperation(operationIdentifier: string): BaselineOperation | undefined {
    return this.json<{ baselineOperation?: BaselineOperation }>([
      'controltower',
      'get-baseline-operation',
      '--operation-identifier',
      operationIdentifier
    ]).baselineOperation;
  }

  /** MUTATING. The request carries only baselineIdentifier, baselineVersion and targetIdentifier. */
  public enableBaseline(
    baselineArn: string,
    version: string,
    ouArn: string
  ): { arn?: string; operationIdentifier?: string } {
    return this.json([
      'controltower',
      'enable-baseline',
      '--baseline-identifier',
      baselineArn,
      '--baseline-version',
      version,
      '--target-identifier',
      ouArn
    ]);
  }

  /** MUTATING. Re-registers an OU through its existing enabled baseline. */
  public resetEnabledBaseline(enabledBaselineArn: string): { operationIdentifier?: string } {
    return this.json(['controltower', 'reset-enabled-baseline', '--enabled-baseline-identifier', enabledBaselineArn]);
  }
}

// ---------------------------------------------------------------------------------------------
// Inputs and plan.
// ---------------------------------------------------------------------------------------------

export interface RuntimeInputs {
  readonly environment: string;
  readonly managementAccountId: string;
  readonly organizationId: string;
  readonly landingZoneArn: string;
  /** `account-ids` output of the account step: `<key>=<account id>` lines. */
  readonly accountIdLines: string;
  /** `ou-ids` output of the account step: `<ou path>=<ou id>` lines. */
  readonly ouIdLines: string;
  readonly auditAccountId: string;
  readonly logArchiveAccountId: string;
}

export interface PlannedAccount {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  readonly ouPath: string;
  readonly accountId: string;
  readonly accountArn: string;
  readonly enrolled: boolean;
}

export interface PlannedTarget {
  readonly target: EnrollmentTarget;
  readonly ouId: string;
  readonly ouArn: string;
  readonly accounts: readonly PlannedAccount[];
  readonly state: TargetState;
  readonly action: PlannedAction;
  readonly headroom: ScpHeadroom;
  /** True when SCP-ESC-IAM-001 applies to this OU (it is at or below an IAM-001 target). */
  readonly iamEscalationGuarded: boolean;
}

export interface SecurityOuReport {
  readonly ouId: string;
  readonly ouArn: string;
  readonly integrationBaselines: readonly { account: string; baseline: string; status: string }[];
}

export interface EnrollmentPlan {
  readonly config: LandingZoneConfig;
  readonly partition: string;
  readonly region: string;
  readonly managementAccountId: string;
  readonly organizationId: string;
  readonly landingZone: { version: string; status: string; driftStatus: string };
  /** Live Landing Zone auto-enrollment (`remediationTypes`). Read only; never changed here. */
  readonly autoEnrollment: { readonly enabled: boolean; readonly remediationTypes: readonly string[] };
  readonly controlTowerBaseline: BaselineSummary;
  readonly configBaseline: BaselineSummary | undefined;
  readonly version: ResolvedBaselineVersion;
  readonly targets: readonly PlannedTarget[];
  readonly security: SecurityOuReport;
  readonly problems: readonly string[];
}

/** Accepts exactly the approved enrollment environments; anything else fails closed. */
export function assertEnrollmentEnvironment(environment: string): EnrollmentEnvironment {
  if (!(ENROLLMENT_ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new Error(
      `Control Tower OU enrollment supports only ${ENROLLMENT_ENVIRONMENTS.join(' and ')}; refusing environment '${environment}'.`
    );
  }
  return environment as EnrollmentEnvironment;
}

export function loadConfig(environment: string): LandingZoneConfig {
  return new ConfigReader(assertEnrollmentEnvironment(environment), {
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();
}

/** True when SCP-ESC-IAM-001 is attached at or above `ouPath`. */
export function isIamEscalationGuarded(ouPath: string): boolean {
  const segments = ouPath.split('/');
  const keys = segments.map((_, index) => keyForPath(segments.slice(0, index + 1)));
  return keys.some((key) => scpEscIam001.targetKeys.includes(key));
}

function readMemberConfig(cli: AwsCli, env: CredentialEnv) {
  return {
    recorders:
      cli.json<{ ConfigurationRecorders?: [] }>(['configservice', 'describe-configuration-recorders'], env)
        .ConfigurationRecorders ?? [],
    deliveryChannels:
      cli.json<{ DeliveryChannels?: [] }>(['configservice', 'describe-delivery-channels'], env).DeliveryChannels ?? [],
    recorderStatuses:
      cli.json<{ ConfigurationRecordersStatus?: [] }>(['configservice', 'describe-configuration-recorder-status'], env)
        .ConfigurationRecordersStatus ?? []
  };
}

/**
 * Read-only AWS Config precheck for the accounts of a target about to be enabled or reset. A
 * not-yet-enrolled account of a never-governed OU must have no Config resources. Control
 * Tower-managed resources are accepted only for an account that is already enrolled, or whose OU
 * already carries an AWSControlTowerBaseline record being reset (an interrupted earlier attempt may
 * have created them). Returns one message per conflict.
 */
export function configPrecheck(cli: AwsCli, partition: string, target: PlannedTarget): string[] {
  const problems: string[] = [];
  const resetting = target.state.kind === 'previously-failed' || target.state.kind === 'governed-account-not-enrolled';
  for (const account of target.accounts) {
    try {
      const env = cli.memberEnv(partition, account.accountId, 'config');
      for (const message of configPrecheckProblems(readMemberConfig(cli, env), account.enrolled || resetting)) {
        problems.push(`AWS Config precheck ${account.key} (${account.accountId}): ${message}`);
      }
    } catch (error) {
      problems.push(
        `AWS Config precheck ${account.key} (${account.accountId}) could not run: ${(error as Error).message}`
      );
    }
  }
  return problems;
}

/** Read-only IAM role model for an enrolled account (AWSControlTowerExecution, stacksets-exec-*). */
export function executionRoleModel(cli: AwsCli, partition: string, accountId: string): ExecutionRoleModel {
  const env = cli.memberEnv(partition, accountId, 'iam');
  const roles = cli.json<{ Roles?: IamRole[] }>(['iam', 'list-roles', '--path-prefix', '/'], env).Roles ?? [];
  return evaluateExecutionRoleModel(
    roles.filter(
      (role) =>
        role.RoleName === CONTROL_TOWER_EXECUTION_ROLE_NAME ||
        (role.RoleName ?? '').startsWith(STACKSETS_EXECUTION_ROLE_PREFIX)
    )
  );
}

/**
 * Builds the complete read-only plan: identity, Landing Zone health, baseline discovery and
 * version, live account readiness and the runtime handoff, live OU resolution and OU ARNs,
 * enabled-baseline classification, SCP headroom, AWS Config precheck and Security OU health.
 * `problems` lists everything that blocks mutation; the caller decides whether to stop.
 */
export async function buildEnrollmentPlan(
  cli: AwsCli,
  inputs: RuntimeInputs,
  options: { readonly configPrecheck: boolean }
): Promise<EnrollmentPlan> {
  const config = loadConfig(inputs.environment);
  const partition = config.aws.partition;
  const region = config.aws.region;
  const problems: string[] = [];

  if (inputs.managementAccountId !== config.aws.accountId) {
    throw new Error(
      `management account '${inputs.managementAccountId}' does not match configuration '${config.aws.accountId}'.`
    );
  }
  const identity = cli.json<{ Account?: string; Arn?: string }>(['sts', 'get-caller-identity']);
  const identityProblems = callerIdentityProblems(identity, { accountId: config.aws.accountId, partition });
  if (identityProblems.length > 0) throw new Error(`Caller identity check failed: ${identityProblems.join('; ')}.`);

  const lz = cli.json<{
    landingZone?: {
      version?: string;
      status?: string;
      driftStatus?: { status?: string };
      remediationTypes?: string[];
    };
  }>(['controltower', 'get-landing-zone', '--landing-zone-identifier', inputs.landingZoneArn]).landingZone;
  const landingZone = {
    version: lz?.version ?? '',
    status: lz?.status ?? '',
    driftStatus: lz?.driftStatus?.status ?? ''
  };
  problems.push(...landingZoneProblems(landingZone, controlTowerLandingZoneVersion));
  const remediationTypes = lz?.remediationTypes ?? [];
  const autoEnrollment = { enabled: autoEnrollmentEnabled(remediationTypes), remediationTypes };

  const baselines = requiredList(
    cli.json<{ baselines?: BaselineSummary[] }>(['controltower', 'list-baselines']).baselines,
    'ListBaselines',
    'baselines'
  );
  const scope = { partition, region };
  const controlTowerBaseline = requireBaseline(baselines, CONTROL_TOWER_BASELINE_NAME, scope);
  const configBaseline = findBaseline(baselines, CONFIG_BASELINE_NAME, scope);
  const identityCenterBaseline = findBaseline(baselines, IDENTITY_CENTER_BASELINE_NAME, scope);
  problems.push(
    ...getBaselineProblems(
      cli.json<unknown>(['controltower', 'get-baseline', '--baseline-identifier', controlTowerBaseline.arn]),
      { arn: controlTowerBaseline.arn, name: CONTROL_TOWER_BASELINE_NAME }
    )
  );

  const allEnabled = cli.listEnabledBaselines({});
  problems.push(...identityCenterBaselineProblems(identityCenterBaseline?.arn, allEnabled));
  const version = resolveBaselineVersion(
    landingZone.version,
    allEnabled.filter((record) => record.baselineIdentifier === controlTowerBaseline.arn)
  );

  // Account readiness: the same live reconciliation the account step validates with. Every
  // configured account must be an EXISTING_MATCH (ACTIVE, exact name and email, configured parent
  // OU, P1 tags in place) with nothing pending; enrollment never creates, moves or tags accounts.
  const port = createOrganizationsAccountPort(createOrganizationsClient(region));
  const organizationManagementAccount = await port.getManagementAccountId();
  if (organizationManagementAccount !== config.aws.accountId) {
    throw new Error(
      `Credentials belong to the Organization managed by ${organizationManagementAccount}, not the configured ${config.aws.accountId}.`
    );
  }
  assertLandingZoneAccountScope(inputs.environment, config.landingZoneAccounts);
  const accountPlan = await buildAccountPlan(port, toDesiredLandingZoneAccounts(config.landingZoneAccounts));
  try {
    assertAccountPlanReconciled(accountPlan);
  } catch (error) {
    problems.push((error as Error).message);
  }
  const reconciled = accountPlan.entries.map((entry) => ({
    key: entry.key,
    ouPath: entry.ouPath,
    accountId: entry.accountId ?? '',
    targetOuId: entry.targetOuId
  }));
  problems.push(...runtimeHandoffProblems(reconciled, inputs.accountIdLines, inputs.ouIdLines));

  const rolloutOrder = config.controlTower.enrollment?.rolloutOrder;
  if (rolloutOrder === undefined) throw new Error('config has no controlTower.enrollment.rolloutOrder.');
  const targets = deriveEnrollmentTargets(rolloutOrder, accountPlan.entries);
  // OU IDs come from the live Organization, walking from the Root. Account-bearing OUs resolve to
  // the same IDs the account plan (and `ou-ids`) carry; parent OUs and Security resolve the same way.
  const ouCache = new Map<string, string>();
  const ouIdOf = (ouPath: string): Promise<string> => resolveOuPath(port, accountPlan.rootId, ouPath, ouCache);

  const enrollmentScope = {
    partition,
    region,
    managementAccountId: config.aws.accountId,
    organizationId: inputs.organizationId
  };
  const planned: PlannedTarget[] = [];
  const stateByPath = new Map<string, PlannedAction>();
  for (const target of targets) {
    const ouId = await ouIdOf(target.ouPath);
    const ouArn =
      cli.json<{ OrganizationalUnit?: { Arn?: string } }>([
        'organizations',
        'describe-organizational-unit',
        '--organizational-unit-id',
        ouId
      ]).OrganizationalUnit?.Arn ?? '';
    problems.push(
      ...ouArnProblems(ouArn, {
        partition,
        managementAccountId: config.aws.accountId,
        organizationId: inputs.organizationId,
        ouId
      }).map((message) => `${target.ouPath}: ${message}`)
    );

    const targetRecords = cli.listEnabledBaselines({ targetIdentifiers: [ouArn] });
    const ctRecord = targetRecords.find((record) => record.baselineIdentifier === controlTowerBaseline.arn);
    const childRecords =
      ctRecord === undefined ? [] : cli.listEnabledBaselines({ parentIdentifiers: [ctRecord.arn] }, true);

    const accountArns = target.accountKeys.map((key) =>
      accountArn(
        partition,
        config.aws.accountId,
        inputs.organizationId,
        accountPlan.entries.find((entry) => entry.key === key)?.accountId ?? ''
      )
    );
    const childHealth =
      ctRecord === undefined
        ? undefined
        : childBaselineHealth({
            parent: ctRecord,
            children: childRecords,
            expectedAccountArns: accountArns,
            controlTowerBaselineArn: controlTowerBaseline.arn,
            expectedVersion: version.version,
            scope: enrollmentScope
          });
    const accounts: PlannedAccount[] = target.accountKeys.map((key) => {
      const entry = accountPlan.entries.find((account) => account.key === key);
      if (entry === undefined) throw new Error(`account '${key}' is missing from the account plan.`);
      const accountId = entry.accountId ?? '';
      const arn = accountArn(partition, config.aws.accountId, inputs.organizationId, accountId);
      return {
        key,
        name: entry.name,
        email: entry.email,
        ouPath: entry.ouPath,
        accountId,
        accountArn: arn,
        enrolled: childHealth?.byAccount.get(arn)?.kind === 'healthy'
      };
    });

    const parentAction = target.parentPath === undefined ? undefined : stateByPath.get(target.parentPath);
    const state = classifyTarget({
      ouPath: target.ouPath,
      ouArn,
      scope: enrollmentScope,
      targetRecords,
      childRecords,
      expectedAccountArns: accounts.map((account) => account.accountArn),
      controlTowerBaselineArn: controlTowerBaseline.arn,
      configBaselineArn: configBaseline?.arn,
      expectedVersion: version.version,
      parentState:
        target.parentPath === undefined
          ? 'top-level'
          : parentAction === 'none' || parentAction === 'converge'
            ? 'governed'
            : parentAction === 'enable' || parentAction === 'reset' || parentAction === 'poll'
              ? 'planned'
              : 'not-governed'
    });
    const action = plannedAction(state, false, autoEnrollment.enabled);
    if (state.kind === 'incompatible') problems.push(...state.reasons.map((reason) => `${target.ouPath}: ${reason}`));
    stateByPath.set(target.ouPath, action);

    const attached = requiredList(
      cli.json<{ Policies?: AttachedPolicy[] }>([
        'organizations',
        'list-policies-for-target',
        '--target-id',
        ouId,
        '--filter',
        'SERVICE_CONTROL_POLICY'
      ]).Policies,
      'ListPoliciesForTarget',
      'Policies'
    );
    const headroom = evaluateScpHeadroom(target.ouPath, attached, MAX_SERVICE_CONTROL_POLICIES_PER_NODE);
    if (!headroom.ok) {
      problems.push(
        `${target.ouPath}: SCP headroom exhausted - ${headroom.directlyAttached} attached + ` +
          `${headroom.expectedControlTowerAdditions} Control Tower mandatory SCP = ${headroom.projected} > ${headroom.quota}`
      );
    }

    planned.push({
      target,
      ouId,
      ouArn,
      accounts,
      state,
      action,
      headroom,
      iamEscalationGuarded: isIamEscalationGuarded(target.ouPath)
    });
  }

  if (options.configPrecheck) {
    for (const target of planned) {
      if (target.action === 'enable' || target.action === 'reset')
        problems.push(...configPrecheck(cli, partition, target));
    }
  }

  const security = securityOuReport(cli, {
    partition,
    managementAccountId: config.aws.accountId,
    organizationId: inputs.organizationId,
    securityOuId: await ouIdOf(SECURITY_OU_PATH),
    auditAccountId: inputs.auditAccountId,
    logArchiveAccountId: inputs.logArchiveAccountId,
    controlTowerBaselineArn: controlTowerBaseline.arn,
    configBaselineArn: configBaseline?.arn,
    baselines,
    problems
  });

  return {
    config,
    partition,
    region,
    managementAccountId: config.aws.accountId,
    organizationId: inputs.organizationId,
    landingZone,
    autoEnrollment,
    controlTowerBaseline,
    configBaseline,
    version,
    targets: planned,
    security,
    problems
  };
}

function securityOuReport(
  cli: AwsCli,
  input: {
    partition: string;
    managementAccountId: string;
    organizationId: string;
    securityOuId: string;
    auditAccountId: string;
    logArchiveAccountId: string;
    controlTowerBaselineArn: string;
    configBaselineArn: string | undefined;
    baselines: readonly BaselineSummary[];
    problems: string[];
  }
): SecurityOuReport {
  const ouArn =
    cli.json<{ OrganizationalUnit?: { Arn?: string } }>([
      'organizations',
      'describe-organizational-unit',
      '--organizational-unit-id',
      input.securityOuId
    ]).OrganizationalUnit?.Arn ?? '';
  input.problems.push(
    ...ouArnProblems(ouArn, {
      partition: input.partition,
      managementAccountId: input.managementAccountId,
      organizationId: input.organizationId,
      ouId: input.securityOuId
    }).map((message) => `Security: ${message}`)
  );
  input.problems.push(
    ...securityOuBaselineProblems(cli.listEnabledBaselines({ targetIdentifiers: [ouArn] }), {
      controlTowerBaselineArn: input.controlTowerBaselineArn,
      configBaselineArn: input.configBaselineArn
    })
  );
  const nameOf = (baselineIdentifier: string): string =>
    input.baselines.find((baseline) => baseline.arn === baselineIdentifier)?.name ?? baselineIdentifier;

  const integrationBaselines: { account: string; baseline: string; status: string }[] = [];
  for (const [label, accountId] of [
    ['Audit', input.auditAccountId],
    ['Log Archive', input.logArchiveAccountId]
  ] as const) {
    const parents =
      cli.json<{ Parents?: { Id?: string }[] }>(['organizations', 'list-parents', '--child-id', accountId]).Parents ??
      [];
    if (parents.length !== 1 || parents[0]?.Id !== input.securityOuId) {
      input.problems.push(`${label} (${accountId}) is not in the Security OU (${input.securityOuId}).`);
    }
    const arn = accountArn(input.partition, input.managementAccountId, input.organizationId, accountId);
    const records = cli.listEnabledBaselines({ targetIdentifiers: [arn] });
    input.problems.push(...serviceIntegrationProblems(label, accountId, records, nameOf));
    for (const record of records) {
      integrationBaselines.push({
        account: label,
        baseline: nameOf(record.baselineIdentifier),
        status: record.statusSummary?.status ?? '<none>'
      });
    }
  }
  return { ouId: input.securityOuId, ouArn, integrationBaselines };
}

/** Human-readable plan for the job log and the step summary. */
export function renderPlan(plan: EnrollmentPlan): string[] {
  const lines = [
    `Landing Zone ${plan.landingZone.version} ${plan.landingZone.status} / ${plan.landingZone.driftStatus}`,
    `Account auto-enrollment: ${plan.autoEnrollment.enabled ? 'ENABLED' : 'DISABLED'} ` +
      `(remediationTypes: ${plan.autoEnrollment.remediationTypes.join(', ') || 'none'}; read only, not changed)`,
    `AWSControlTowerBaseline ${plan.controlTowerBaseline.arn} version ${plan.version.version} (${plan.version.source})`,
    '',
    '| # | OU | State | Action | Accounts | SCPs now / projected / quota |',
    '|---|---|---|---|---|---|'
  ];
  plan.targets.forEach((target, index) => {
    const accounts =
      target.accounts.map((account) => `${account.name}${account.enrolled ? ' (enrolled)' : ''}`).join(', ') || '-';
    const h = target.headroom;
    lines.push(
      `| ${index + 1} | ${target.target.ouPath} | ${target.state.kind} | ${target.action} | ${accounts} | ` +
        `${h.directlyAttached}${h.fullAwsAccessAttached ? ' incl. FullAWSAccess' : ''} / ${h.projected} / ${h.quota} |`
    );
  });
  lines.push('', `Security OU ${plan.security.ouId}: not an enrollment target`);
  for (const entry of plan.security.integrationBaselines) {
    lines.push(`  ${entry.account}: ${entry.baseline} ${entry.status}`);
  }
  return lines;
}
