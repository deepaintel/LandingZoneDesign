/**
 * AWS Control Tower OU enrollment - pure decision logic.
 *
 * Governed by `.apm/skills/control-tower-account-enrollment/SKILL.md`. Everything here is side-effect free:
 * no AWS SDK/CLI, no filesystem, no environment variables. The runtime scripts
 * (`scripts/enroll-control-tower-accounts.ts`, `scripts/validate-control-tower-enrollment.ts`)
 * gather live state and delegate every decision to these functions so each rule is unit-tested
 * offline.
 *
 * Design facts encoded here:
 *  - `EnableBaseline` targets OUs only; the baseline is `AWSControlTowerBaseline`;
 *  - the baseline version comes from existing successful enablements, cross-checked against the
 *    reviewed Landing Zone -> baseline compatibility table; unknown Landing Zone versions fail;
 *  - a nested OU is registered only after its parent is governed;
 *  - `AWSControlTowerBaseline` and `ConfigBaseline` are mutually exclusive on an OU;
 *  - `IdentityCenterBaseline` must not be enabled (`accessManagement` is disabled), so the
 *    `EnableBaseline` request never carries `parameters`;
 *  - Security and Suspended are never targets;
 *  - the live Landing Zone auto-enrollment setting (`remediationTypes` contains
 *    `INHERITANCE_DRIFT`) decides whether a configured account that is not yet enrolled in a
 *    governed OU is reset once (auto-enrollment disabled) or awaited with bounded polling while
 *    AWS Control Tower enrolls it (auto-enrollment enabled). The setting is read, never changed.
 */

import { ENROLLMENT_PROHIBITED_OU_ROOTS, rolloutOrderProblems } from '../../config/schemas/control-tower-schema.js';

export const CONTROL_TOWER_BASELINE_NAME = 'AWSControlTowerBaseline';
export const CONFIG_BASELINE_NAME = 'ConfigBaseline';
export const IDENTITY_CENTER_BASELINE_NAME = 'IdentityCenterBaseline';

/**
 * Reviewed AWS Control Tower compatibility table: Landing Zone version -> the `AWSControlTowerBaseline`
 * version that must be used when enabling the baseline on an unmanaged OU (AWS Control Tower User
 * Guide, "Compatibility of OU baselines and landing zone versions"). Extending it is a reviewed code
 * change made together with a Landing Zone upgrade.
 */
export const LANDING_ZONE_BASELINE_COMPATIBILITY: Readonly<Record<string, string>> = { '4.0': '5.0' };

/** Names AWS Control Tower uses for the AWS Config resources it creates in an enrolled account. */
export const CONTROL_TOWER_CONFIG_RECORDER_NAME = 'aws-controltower-BaselineConfigRecorder';
export const CONTROL_TOWER_CONFIG_DELIVERY_CHANNEL_NAME = 'aws-controltower-BaselineConfigDeliveryChannel';

/** Prefix of the SCPs AWS Control Tower attaches for mandatory and preventive controls. */
export const CONTROL_TOWER_MANAGED_SCP_PREFIX = 'aws-guardrails-';
export const FULL_AWS_ACCESS_POLICY_NAME = 'FullAWSAccess';

export const CONTROL_TOWER_EXECUTION_ROLE_NAME = 'AWSControlTowerExecution';
export const STACKSETS_EXECUTION_ROLE_PREFIX = 'stacksets-exec-';

const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const ORGANIZATION_ID_PATTERN = /^o-[0-9a-z]{10,32}$/;
const OPERATION_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// ---------------------------------------------------------------------------------------------
// Shapes returned by the AWS Control Tower / Organizations APIs (only the fields used here).
// ---------------------------------------------------------------------------------------------

export interface BaselineSummary {
  readonly arn: string;
  readonly name: string;
  readonly description?: string;
}

export interface EnabledBaselineSummary {
  readonly arn: string;
  readonly baselineIdentifier: string;
  readonly baselineVersion?: string;
  readonly targetIdentifier: string;
  readonly parentIdentifier?: string;
  readonly statusSummary?: { readonly status?: string; readonly lastOperationIdentifier?: string };
  readonly driftStatusSummary?: unknown;
}

export interface BaselineOperation {
  readonly operationIdentifier?: string;
  readonly operationType?: string;
  readonly status?: string;
  readonly statusMessage?: string;
  readonly startTime?: string;
  readonly endTime?: string;
}

export interface AttachedPolicy {
  readonly Id?: string;
  readonly Name?: string;
  readonly AwsManaged?: boolean;
}

export interface ConfigRecorder {
  readonly name?: string;
  readonly roleARN?: string;
}

export interface ConfigDeliveryChannel {
  readonly name?: string;
  readonly s3BucketName?: string;
}

export interface ConfigRecorderStatus {
  readonly name?: string;
  readonly recording?: boolean;
  readonly lastStatus?: string;
}

export interface IamRole {
  readonly RoleName?: string;
  readonly Path?: string;
}

// ---------------------------------------------------------------------------------------------
// Runtime identity, Landing Zone and baseline discovery.
// ---------------------------------------------------------------------------------------------

/** `remediationTypes` value that turns on AWS Control Tower account auto-enrollment. */
export const AUTO_ENROLLMENT_REMEDIATION_TYPE = 'INHERITANCE_DRIFT';

/**
 * Pure: interprets `GetLandingZone.landingZone.remediationTypes`. Auto-enrollment is enabled only
 * when the list contains `INHERITANCE_DRIFT`; an absent or empty list means disabled.
 */
export function autoEnrollmentEnabled(remediationTypes: readonly string[] | undefined): boolean {
  return (remediationTypes ?? []).includes(AUTO_ENROLLMENT_REMEDIATION_TYPE);
}

/** Partition segment of an ARN (`arn:<partition>:...`). Throws on a malformed ARN. */
export function partitionOfArn(arn: string): string {
  const match = /^arn:([a-z-]+):/.exec(arn);
  if (match?.[1] === undefined) {
    throw new Error(`'${arn}' is not an ARN.`);
  }
  return match[1];
}

/** Validates `sts get-caller-identity` against the configured management account and partition. */
export function callerIdentityProblems(
  identity: { readonly Account?: string; readonly Arn?: string },
  expected: { readonly accountId: string; readonly partition: string }
): string[] {
  const problems: string[] = [];
  if (identity.Account !== expected.accountId) {
    problems.push(
      `caller account '${identity.Account ?? '<none>'}' is not the management account '${expected.accountId}'`
    );
  }
  if (typeof identity.Arn !== 'string' || partitionOfArn(identity.Arn) !== expected.partition) {
    problems.push(`caller ARN '${identity.Arn ?? '<none>'}' is not in the '${expected.partition}' partition`);
  }
  return problems;
}

/** Landing Zone health gate: expected version, ACTIVE, IN_SYNC. */
export function landingZoneProblems(
  landingZone: { readonly version?: string; readonly status?: string; readonly driftStatus?: string },
  expectedVersion: string
): string[] {
  const problems: string[] = [];
  if (landingZone.version !== expectedVersion) {
    problems.push(
      `Landing Zone version '${landingZone.version ?? '<none>'}' is not the configured '${expectedVersion}'`
    );
  }
  if (landingZone.status !== 'ACTIVE') {
    problems.push(`Landing Zone status '${landingZone.status ?? '<none>'}' is not ACTIVE`);
  }
  if (landingZone.driftStatus !== 'IN_SYNC') {
    problems.push(`Landing Zone drift '${landingZone.driftStatus ?? '<none>'}' is not IN_SYNC`);
  }
  return problems;
}

function baselineArnPattern(partition: string, region: string): RegExp {
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^arn:${escape(partition)}:controltower:${escape(region)}::baseline/[A-Z0-9]{16}$`);
}

/**
 * Finds the baseline called `name` in a `ListBaselines` result. Returns `undefined` when absent and
 * throws when the name is duplicated or the ARN is not in the expected partition and Region.
 */
export function findBaseline(
  baselines: readonly BaselineSummary[],
  name: string,
  scope: { readonly partition: string; readonly region: string }
): BaselineSummary | undefined {
  const matches = baselines.filter((baseline) => baseline.name === name);
  if (matches.length > 1) {
    throw new Error(`ListBaselines returned ${matches.length} baselines named '${name}'; expected exactly one.`);
  }
  const [match] = matches;
  if (match !== undefined && !baselineArnPattern(scope.partition, scope.region).test(match.arn)) {
    throw new Error(
      `Baseline '${name}' ARN '${match.arn}' is not an '${scope.partition}' Control Tower baseline ARN in '${scope.region}'.`
    );
  }
  return match;
}

/** Like {@link findBaseline} but the baseline must exist. */
export function requireBaseline(
  baselines: readonly BaselineSummary[],
  name: string,
  scope: { readonly partition: string; readonly region: string }
): BaselineSummary {
  const match = findBaseline(baselines, name, scope);
  if (match === undefined) {
    throw new Error(`ListBaselines returned no baseline named '${name}'.`);
  }
  return match;
}

export interface ResolvedBaselineVersion {
  readonly version: string;
  readonly source: 'existing-enabled-baselines' | 'compatibility-table';
}

/**
 * Resolves the `AWSControlTowerBaseline` version to enable.
 *
 * `existing` holds the OU-level `AWSControlTowerBaseline` enabled-baseline records already in the
 * organization. Every SUCCEEDED record must carry the same version, and that version must equal the
 * compatibility-table entry for the runtime Landing Zone version. With no successful record yet,
 * the compatibility table is the source.
 */
export function resolveBaselineVersion(
  landingZoneVersion: string,
  existing: readonly EnabledBaselineSummary[]
): ResolvedBaselineVersion {
  const compatible = LANDING_ZONE_BASELINE_COMPATIBILITY[landingZoneVersion];
  if (compatible === undefined) {
    throw new Error(
      `Landing Zone version '${landingZoneVersion}' has no reviewed AWSControlTowerBaseline compatibility entry ` +
        `(known: ${Object.keys(LANDING_ZONE_BASELINE_COMPATIBILITY).join(', ')}).`
    );
  }
  const versions = [
    ...new Set(
      existing
        .filter((record) => record.parentIdentifier === undefined && record.statusSummary?.status === 'SUCCEEDED')
        .map((record) => record.baselineVersion ?? '<none>')
    )
  ];
  if (versions.length > 1) {
    throw new Error(`Existing AWSControlTowerBaseline enablements use inconsistent versions: ${versions.join(', ')}.`);
  }
  const [existingVersion] = versions;
  if (existingVersion === undefined) {
    return { version: compatible, source: 'compatibility-table' };
  }
  if (existingVersion !== compatible) {
    throw new Error(
      `Existing AWSControlTowerBaseline version '${existingVersion}' conflicts with version '${compatible}' required ` +
        `for Landing Zone ${landingZoneVersion}.`
    );
  }
  return { version: existingVersion, source: 'existing-enabled-baselines' };
}

/** IdentityCenterBaseline must not be enabled anywhere while `accessManagement` is disabled. */
export function identityCenterBaselineProblems(
  identityCenterBaselineArn: string | undefined,
  allEnabled: readonly EnabledBaselineSummary[]
): string[] {
  if (identityCenterBaselineArn === undefined) return [];
  return allEnabled
    .filter((record) => record.baselineIdentifier === identityCenterBaselineArn)
    .map(
      (record) =>
        `IdentityCenterBaseline is enabled on '${record.targetIdentifier}' (${record.arn}); accessManagement is ` +
        'disabled, so no IdentityCenterEnabledBaselineArn parameter is approved for EnableBaseline.'
    );
}

/**
 * Pure: validates a `GetBaseline` response (`GetBaselineOutput`: `arn`, `name` and optional
 * `description` at the top level, per the AWS Control Tower API model and SDK v3 types). The
 * returned ARN must be the baseline discovered by `ListBaselines` and the name must be exactly
 * `expectedName`.
 */
export function getBaselineProblems(
  response: unknown,
  expected: { readonly arn: string; readonly name: string }
): string[] {
  if (!isObject(response)) return ['GetBaseline returned no response object'];
  const problems: string[] = [];
  if (response['arn'] !== expected.arn) {
    problems.push(`GetBaseline returned ARN '${String(response['arn'])}', expected ${expected.arn}`);
  }
  if (typeof response['name'] !== 'string' || response['name'] === '') {
    problems.push('GetBaseline returned no baseline name');
  } else if (response['name'] !== expected.name) {
    problems.push(`GetBaseline returned name '${response['name']}', expected '${expected.name}'`);
  }
  return problems;
}

/**
 * Pure: the Security OU holds the Landing Zone 4.0 service-integration accounts and must carry
 * neither OU baseline. Returns one message per `AWSControlTowerBaseline` or `ConfigBaseline` record
 * on the Security OU, naming the baseline and the enabled-baseline ARN.
 */
export function securityOuBaselineProblems(
  records: readonly EnabledBaselineSummary[],
  baselines: { readonly controlTowerBaselineArn: string; readonly configBaselineArn: string | undefined }
): string[] {
  const problems: string[] = [];
  for (const record of records) {
    if (record.baselineIdentifier === baselines.controlTowerBaselineArn) {
      problems.push(
        `Security OU has ${CONTROL_TOWER_BASELINE_NAME} enabled (${record.arn}); the Security OU must carry no OU baseline.`
      );
    } else if (baselines.configBaselineArn !== undefined && record.baselineIdentifier === baselines.configBaselineArn) {
      problems.push(
        `Security OU has ${CONFIG_BASELINE_NAME} enabled (${record.arn}); the Security OU must carry no OU baseline.`
      );
    }
  }
  return problems;
}

/**
 * Pure: Audit and Log Archive are governed by the Landing Zone service-integration baselines. Each
 * must carry at least one enabled baseline and every one of them must be `SUCCEEDED`.
 */
export function serviceIntegrationProblems(
  label: string,
  accountId: string,
  records: readonly EnabledBaselineSummary[],
  nameOf: (baselineIdentifier: string) => string
): string[] {
  if (records.length === 0) return [`${label} (${accountId}) has no Landing Zone service-integration baseline.`];
  return records
    .filter((record) => record.statusSummary?.status !== 'SUCCEEDED')
    .map(
      (record) =>
        `${label} (${accountId}) service-integration baseline ${nameOf(record.baselineIdentifier)} is ${record.statusSummary?.status ?? '<none>'}.`
    );
}

// ---------------------------------------------------------------------------------------------
// Targets, OU ARNs and accounts.
// ---------------------------------------------------------------------------------------------

export interface ManifestAccount {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  readonly ouPath: string;
}

export interface EnrollmentTarget {
  readonly ouPath: string;
  /** Parent OU path, `undefined` for a top-level OU. */
  readonly parentPath: string | undefined;
  /** Configuration keys of the accounts placed directly in this OU. */
  readonly accountKeys: readonly string[];
}

/** Orders the enrollment targets and attaches each OU's configured accounts. */
export function deriveEnrollmentTargets(
  rolloutOrder: readonly string[],
  accounts: readonly ManifestAccount[]
): EnrollmentTarget[] {
  const problems = rolloutOrderProblems(rolloutOrder);
  const listed = new Set(rolloutOrder);
  for (const account of accounts) {
    if (!listed.has(account.ouPath)) {
      problems.push(`account '${account.key}' is in OU '${account.ouPath}', which is not in the rollout order`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Invalid enrollment rollout order: ${problems.join('; ')}.`);
  }
  return rolloutOrder.map((ouPath) => {
    const separator = ouPath.lastIndexOf('/');
    return {
      ouPath,
      parentPath: separator === -1 ? undefined : ouPath.slice(0, separator),
      accountKeys: accounts.filter((account) => account.ouPath === ouPath).map((account) => account.key)
    };
  });
}

/** True when the OU path is at or below Security or Suspended. */
export function isProhibitedTarget(ouPath: string): boolean {
  return (ENROLLMENT_PROHIBITED_OU_ROOTS as readonly string[]).includes(ouPath.split('/')[0] ?? '');
}

/** Validates the OU ARN returned by `DescribeOrganizationalUnit` against runtime identity. */
export function ouArnProblems(
  arn: string | undefined,
  expected: {
    readonly partition: string;
    readonly managementAccountId: string;
    readonly organizationId: string;
    readonly ouId: string;
  }
): string[] {
  if (!OU_ID_PATTERN.test(expected.ouId)) return [`'${expected.ouId}' is not an AWS Organizations OU ID`];
  if (!ORGANIZATION_ID_PATTERN.test(expected.organizationId)) {
    return [`'${expected.organizationId}' is not an AWS Organizations organization ID`];
  }
  const want = `arn:${expected.partition}:organizations::${expected.managementAccountId}:ou/${expected.organizationId}/${expected.ouId}`;
  return arn === want ? [] : [`OU ARN '${arn ?? '<none>'}' does not match the expected '${want}'`];
}

/** Builds the account target ARN Control Tower reports for a child enabled baseline. */
export function accountArn(
  partition: string,
  managementAccountId: string,
  organizationId: string,
  accountId: string
): string {
  return `arn:${partition}:organizations::${managementAccountId}:account/${organizationId}/${accountId}`;
}

/** One configured account as reconciled live by the account-provisioning plan. */
export interface ReconciledAccount {
  readonly key: string;
  readonly ouPath: string;
  readonly accountId: string;
  readonly targetOuId: string;
}

function parseHandoffLines(text: string, label: string, problems: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const separator = line.indexOf('=');
    const key = separator === -1 ? line : line.slice(0, separator);
    const value = separator === -1 ? '' : line.slice(separator + 1);
    if (values.has(key)) problems.push(`${label} '${key}' appears more than once`);
    values.set(key, value);
  }
  return values;
}

/**
 * Cross-checks the transient runtime outputs of the account-provisioning step against the live,
 * reconciled account plan built by this run:
 *  - `account-ids` (`<key>=<account id>`) must name exactly the configured accounts, each with the
 *    account ID the live plan reports;
 *  - `ou-ids` (`<ou path>=<ou id>`) must name exactly the OUs that hold a configured account, each
 *    with the OU ID the live plan resolved.
 * Returns one message per mismatch; any mismatch blocks enrollment.
 */
export function runtimeHandoffProblems(
  reconciled: readonly ReconciledAccount[],
  accountIdLines: string,
  ouIdLines: string
): string[] {
  const problems: string[] = [];
  const accountIds = parseHandoffLines(accountIdLines, 'account-ids key', problems);
  const ouIds = parseHandoffLines(ouIdLines, 'ou-ids path', problems);

  for (const [key, id] of accountIds) {
    if (!AWS_ACCOUNT_ID_PATTERN.test(id)) problems.push(`account-ids: '${key}' has invalid account ID '${id}'`);
  }
  for (const [path, id] of ouIds) {
    if (!OU_ID_PATTERN.test(id)) problems.push(`ou-ids: '${path}' has invalid OU ID '${id}'`);
  }

  const liveAccounts = new Map(reconciled.map((account) => [account.key, account.accountId]));
  for (const [key, liveId] of liveAccounts) {
    const handedOff = accountIds.get(key);
    if (handedOff === undefined) problems.push(`account-ids: configured account '${key}' is missing`);
    else if (handedOff !== liveId) {
      problems.push(`account-ids: '${key}' is ${handedOff}, but the live Organization reports ${liveId}`);
    }
  }
  for (const key of accountIds.keys()) {
    if (!liveAccounts.has(key)) problems.push(`account-ids: '${key}' is not a configured account`);
  }

  const liveOus = new Map(reconciled.map((account) => [account.ouPath, account.targetOuId]));
  for (const [path, liveId] of liveOus) {
    const handedOff = ouIds.get(path);
    if (handedOff === undefined) problems.push(`ou-ids: OU '${path}' of a configured account is missing`);
    else if (handedOff !== liveId) {
      problems.push(`ou-ids: '${path}' is ${handedOff}, but the live Organization resolves ${liveId}`);
    }
  }
  for (const path of ouIds.keys()) {
    if (!liveOus.has(path)) problems.push(`ou-ids: '${path}' holds no configured account`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// AWS Config precheck.
// ---------------------------------------------------------------------------------------------

export interface ConfigPrecheckInput {
  readonly recorders: readonly ConfigRecorder[];
  readonly deliveryChannels: readonly ConfigDeliveryChannel[];
  readonly recorderStatuses: readonly ConfigRecorderStatus[];
}

/**
 * Evaluates the AWS Config state of one member account. A not-yet-enrolled account must have no
 * recorder and no delivery channel. An already-enrolled account may only carry the resources AWS
 * Control Tower creates. Returns one message per conflicting resource, with enough detail for
 * diagnostics; never suggests deleting anything.
 */
export function configPrecheckProblems(input: ConfigPrecheckInput, enrolled: boolean): string[] {
  const problems: string[] = [];
  const allowedRecorders = enrolled ? [CONTROL_TOWER_CONFIG_RECORDER_NAME] : [];
  const allowedChannels = enrolled ? [CONTROL_TOWER_CONFIG_DELIVERY_CHANNEL_NAME] : [];
  for (const recorder of input.recorders) {
    if (!allowedRecorders.includes(recorder.name ?? '')) {
      const status = input.recorderStatuses.find((entry) => entry.name === recorder.name);
      problems.push(
        `configuration recorder '${recorder.name ?? '<unnamed>'}' (role ${recorder.roleARN ?? '<none>'}, recording=` +
          `${String(status?.recording ?? 'unknown')}, lastStatus=${status?.lastStatus ?? 'unknown'}) is not Control Tower-managed`
      );
    }
  }
  for (const channel of input.deliveryChannels) {
    if (!allowedChannels.includes(channel.name ?? '')) {
      problems.push(
        `delivery channel '${channel.name ?? '<unnamed>'}' (bucket ${channel.s3BucketName ?? '<none>'}) is not Control Tower-managed`
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// SCP headroom.
// ---------------------------------------------------------------------------------------------

export interface ScpHeadroom {
  readonly ouPath: string;
  readonly directlyAttached: number;
  readonly fullAwsAccessAttached: boolean;
  readonly controlTowerManagedAttached: number;
  /** SCPs Control Tower is expected to add when registering this OU. */
  readonly expectedControlTowerAdditions: number;
  readonly projected: number;
  readonly quota: number;
  readonly ok: boolean;
}

/**
 * Projects the directly attached SCP count after registration. Control Tower attaches its
 * mandatory controls as one `aws-guardrails-*` SCP on TOP-LEVEL OUs only; nested OUs inherit them.
 * An OU that already carries a Control Tower-managed SCP needs no new slot.
 */
export function evaluateScpHeadroom(ouPath: string, attached: readonly AttachedPolicy[], quota: number): ScpHeadroom {
  const controlTowerManagedAttached = attached.filter((policy) =>
    (policy.Name ?? '').startsWith(CONTROL_TOWER_MANAGED_SCP_PREFIX)
  ).length;
  const topLevel = !ouPath.includes('/');
  const expectedControlTowerAdditions = topLevel && controlTowerManagedAttached === 0 ? 1 : 0;
  const projected = attached.length + expectedControlTowerAdditions;
  return {
    ouPath,
    directlyAttached: attached.length,
    fullAwsAccessAttached: attached.some((policy) => policy.Name === FULL_AWS_ACCESS_POLICY_NAME),
    controlTowerManagedAttached,
    expectedControlTowerAdditions,
    projected,
    quota,
    ok: projected <= quota
  };
}

// ---------------------------------------------------------------------------------------------
// Enabled-baseline classification and operations.
// ---------------------------------------------------------------------------------------------

export type TargetState =
  | { readonly kind: 'governed'; readonly record: EnabledBaselineSummary }
  | {
      readonly kind: 'governed-account-not-enrolled';
      readonly record: EnabledBaselineSummary;
      readonly accountIds: readonly string[];
    }
  | { readonly kind: 'not-governed' }
  | { readonly kind: 'in-progress'; readonly record: EnabledBaselineSummary; readonly operationIdentifier: string }
  | { readonly kind: 'previously-failed'; readonly record: EnabledBaselineSummary }
  | { readonly kind: 'incompatible'; readonly reasons: readonly string[] };

/** Runtime identity every enabled-baseline ARN and account target must belong to. */
export interface EnrollmentScope {
  readonly partition: string;
  readonly region: string;
  readonly managementAccountId: string;
  readonly organizationId: string;
}

export interface ClassifyTargetInput {
  readonly ouPath: string;
  /** OU ARN returned by `DescribeOrganizationalUnit` for this target. */
  readonly ouArn: string;
  readonly scope: EnrollmentScope;
  /** Every enabled baseline whose target is this OU (`ListEnabledBaselines` filtered by target). */
  readonly targetRecords: readonly EnabledBaselineSummary[];
  /** Child enabled baselines of this OU's AWSControlTowerBaseline record (`--include-children`). */
  readonly childRecords: readonly EnabledBaselineSummary[];
  /** Account ARNs of the configured accounts placed directly in this OU. */
  readonly expectedAccountArns: readonly string[];
  readonly controlTowerBaselineArn: string;
  readonly configBaselineArn: string | undefined;
  readonly expectedVersion: string;
  /** Governance of the parent OU: governed now, or enabled earlier in this rollout. */
  readonly parentState: 'top-level' | 'governed' | 'planned' | 'not-governed';
}

/** `EnablementStatus` values of the AWS Control Tower API model. */
const ENABLEMENT_STATUSES = ['SUCCEEDED', 'FAILED', 'UNDER_CHANGE'] as const;
/** `EnabledBaselineDriftStatus` values of the AWS Control Tower API model. */
const DRIFT_STATUSES = ['IN_SYNC', 'DRIFTED'] as const;

/**
 * Drift of one enabled baseline, from `driftStatusSummary.types.<type>.status`. The API model makes
 * the summary, its `types` and each status optional, so an absent value is `NOT_REPORTED`.
 * `DRIFTED` in any drift type wins; any value outside the model enum, or a summary that is not the
 * modelled object shape, is `MALFORMED` and fails closed.
 */
export type DriftState = 'IN_SYNC' | 'DRIFTED' | 'NOT_REPORTED' | 'MALFORMED';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function driftState(summary: unknown): DriftState {
  if (summary === undefined) return 'NOT_REPORTED';
  if (!isObject(summary)) return 'MALFORMED';
  const types = summary['types'];
  if (types === undefined) return 'NOT_REPORTED';
  if (!isObject(types)) return 'MALFORMED';
  const statuses: string[] = [];
  for (const entry of Object.values(types)) {
    if (!isObject(entry)) return 'MALFORMED';
    const status = entry['status'];
    if (status === undefined) continue;
    if (typeof status !== 'string' || !(DRIFT_STATUSES as readonly string[]).includes(status)) return 'MALFORMED';
    statuses.push(status);
  }
  if (statuses.includes('DRIFTED')) return 'DRIFTED';
  return statuses.length > 0 ? 'IN_SYNC' : 'NOT_REPORTED';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** An enabled-baseline ARN must belong to the management account in the home Region. */
export function enabledBaselineArnProblems(arn: unknown, scope: EnrollmentScope): string[] {
  const pattern = new RegExp(
    `^arn:${escapeRegExp(scope.partition)}:controltower:${escapeRegExp(scope.region)}:${scope.managementAccountId}:enabledbaseline/[A-Z0-9]+$`
  );
  return typeof arn === 'string' && pattern.test(arn)
    ? []
    : [`enabled baseline ARN '${String(arn)}' is not an enabled baseline of this management account and Region`];
}

/** Account target ARN pattern for a child enabled baseline in this Organization. */
function accountTargetPattern(scope: EnrollmentScope): RegExp {
  return new RegExp(
    `^arn:${escapeRegExp(scope.partition)}:organizations::${scope.managementAccountId}:account/${escapeRegExp(scope.organizationId)}/[0-9]{12}$`
  );
}

/** Explicit health of one configured account's child baseline. */
export type ChildHealth =
  | { readonly kind: 'healthy' }
  | { readonly kind: 'in-progress'; readonly operationIdentifier: string }
  | { readonly kind: 'not-enrolled'; readonly reason: string }
  | { readonly kind: 'malformed'; readonly reason: string };

/**
 * Pure: validates every child enabled baseline of a parent record and returns the health of each.
 * Malformed metadata (identity, status, operation identifier, version, drift) is reported as
 * `malformed` and never as `not-enrolled`, so it cannot reach a reset.
 */
export function childBaselineHealth(input: {
  readonly parent: EnabledBaselineSummary;
  readonly children: readonly EnabledBaselineSummary[];
  readonly expectedAccountArns: readonly string[];
  readonly controlTowerBaselineArn: string;
  readonly expectedVersion: string;
  readonly scope: EnrollmentScope;
}): { readonly byAccount: ReadonlyMap<string, ChildHealth>; readonly malformed: readonly string[] } {
  const malformed: string[] = [];
  const targetPattern = accountTargetPattern(input.scope);
  const byTarget = new Map<string, EnabledBaselineSummary>();
  for (const child of input.children) {
    const label = `child baseline ${String(child.arn)}`;
    if (enabledBaselineArnProblems(child.arn, input.scope).length > 0) malformed.push(`${label}: malformed ARN`);
    if (child.parentIdentifier !== input.parent.arn) {
      malformed.push(`${label}: parent '${String(child.parentIdentifier)}' is not ${input.parent.arn}`);
    }
    if (child.baselineIdentifier !== input.controlTowerBaselineArn) {
      malformed.push(`${label}: baseline '${String(child.baselineIdentifier)}' is not AWSControlTowerBaseline`);
    }
    if (typeof child.targetIdentifier !== 'string' || !targetPattern.test(child.targetIdentifier)) {
      malformed.push(`${label}: target '${String(child.targetIdentifier)}' is not an account of this Organization`);
      continue;
    }
    if (byTarget.has(child.targetIdentifier)) {
      malformed.push(`${label}: more than one child baseline targets ${child.targetIdentifier}`);
    }
    byTarget.set(child.targetIdentifier, child);
  }

  const byAccount = new Map<string, ChildHealth>();
  for (const accountArnValue of input.expectedAccountArns) {
    const child = byTarget.get(accountArnValue);
    if (child === undefined) {
      byAccount.set(accountArnValue, { kind: 'not-enrolled', reason: 'no child baseline' });
      continue;
    }
    const status = child.statusSummary?.status;
    if (status === undefined || !(ENABLEMENT_STATUSES as readonly string[]).includes(status)) {
      byAccount.set(accountArnValue, { kind: 'malformed', reason: `unknown child status '${String(status)}'` });
      continue;
    }
    if (status === 'UNDER_CHANGE') {
      const operationIdentifier = child.statusSummary?.lastOperationIdentifier;
      byAccount.set(
        accountArnValue,
        isOperationIdentifier(operationIdentifier)
          ? { kind: 'in-progress', operationIdentifier }
          : {
              kind: 'malformed',
              reason: `child UNDER_CHANGE with missing or malformed operation identifier '${String(operationIdentifier)}'`
            }
      );
      continue;
    }
    if (status === 'FAILED') {
      byAccount.set(accountArnValue, { kind: 'not-enrolled', reason: 'child enablement FAILED' });
      continue;
    }
    if (child.baselineVersion !== input.expectedVersion) {
      byAccount.set(accountArnValue, {
        kind: 'malformed',
        reason: `child version '${String(child.baselineVersion)}' is not the expected '${input.expectedVersion}'`
      });
      continue;
    }
    const drift = driftState(child.driftStatusSummary);
    if (drift === 'MALFORMED') {
      byAccount.set(accountArnValue, { kind: 'malformed', reason: 'child drift summary is malformed' });
    } else if (drift === 'DRIFTED') {
      byAccount.set(accountArnValue, { kind: 'not-enrolled', reason: 'child baseline is DRIFTED' });
    } else {
      byAccount.set(accountArnValue, { kind: 'healthy' });
    }
  }
  for (const [accountArnValue, health] of byAccount) {
    if (health.kind === 'malformed') malformed.push(`${accountArnValue}: ${health.reason}`);
  }
  return { byAccount, malformed };
}

/**
 * Classifies a target OU before any mutation. Every outcome is explicit:
 *  - `governed`                       HEALTHY / SKIP
 *  - `in-progress`                    POLL EXISTING OPERATION
 *  - `governed-account-not-enrolled`  APPROVED BOUNDED RESET (auto-enrollment off) or bounded
 *                                     convergence (auto-enrollment on)
 *  - `previously-failed`              APPROVED BOUNDED RESET
 *  - `not-governed`                   ENABLE MISSING BASELINE
 *  - `incompatible`                   FAIL CLOSED
 * Malformed or unknown metadata on the OU record or any child is always `incompatible`.
 */
export function classifyTarget(input: ClassifyTargetInput): TargetState {
  if (isProhibitedTarget(input.ouPath)) {
    return { kind: 'incompatible', reasons: [`'${input.ouPath}' must never be an enrollment target`] };
  }
  const reasons: string[] = [];
  const controlTower = input.targetRecords.filter(
    (record) => record.baselineIdentifier === input.controlTowerBaselineArn
  );
  const others = input.targetRecords.filter((record) => record.baselineIdentifier !== input.controlTowerBaselineArn);
  for (const record of others) {
    reasons.push(
      record.baselineIdentifier === input.configBaselineArn
        ? `ConfigBaseline is enabled on the OU (${record.arn}); it cannot coexist with AWSControlTowerBaseline`
        : `unexpected baseline '${record.baselineIdentifier}' is enabled on the OU (${record.arn})`
    );
  }
  if (controlTower.length > 1) {
    reasons.push(`${controlTower.length} AWSControlTowerBaseline records target the OU`);
  }
  if (reasons.length > 0) return { kind: 'incompatible', reasons };

  const [record] = controlTower;
  if (record === undefined) {
    if (input.parentState === 'not-governed') {
      return {
        kind: 'incompatible',
        reasons: [`parent OU of '${input.ouPath}' is not governed by AWSControlTowerBaseline`]
      };
    }
    return { kind: 'not-governed' };
  }

  const identityProblems = [
    ...enabledBaselineArnProblems(record.arn, input.scope),
    ...(record.targetIdentifier === input.ouArn
      ? []
      : [`AWSControlTowerBaseline targets '${record.targetIdentifier}', not ${input.ouArn}`])
  ];
  if (identityProblems.length > 0) return { kind: 'incompatible', reasons: identityProblems };

  const status = record.statusSummary?.status;
  if (status === 'UNDER_CHANGE') {
    const operationIdentifier = record.statusSummary?.lastOperationIdentifier;
    return isOperationIdentifier(operationIdentifier)
      ? { kind: 'in-progress', record, operationIdentifier }
      : {
          kind: 'incompatible',
          reasons: ['AWSControlTowerBaseline is UNDER_CHANGE without a valid operation identifier']
        };
  }
  if (record.baselineVersion !== input.expectedVersion) {
    return {
      kind: 'incompatible',
      reasons: [
        `AWSControlTowerBaseline version '${record.baselineVersion ?? '<none>'}' is not the expected '${input.expectedVersion}'`
      ]
    };
  }
  if (status === 'FAILED') return { kind: 'previously-failed', record };
  if (status !== 'SUCCEEDED') {
    return {
      kind: 'incompatible',
      reasons: [`AWSControlTowerBaseline status '${status ?? '<none>'}' is not recognised`]
    };
  }
  const ouDrift = driftState(record.driftStatusSummary);
  if (ouDrift === 'MALFORMED') {
    return { kind: 'incompatible', reasons: ['AWSControlTowerBaseline drift summary on the OU is malformed'] };
  }

  const health = childBaselineHealth({
    parent: record,
    children: input.childRecords,
    expectedAccountArns: input.expectedAccountArns,
    controlTowerBaselineArn: input.controlTowerBaselineArn,
    expectedVersion: input.expectedVersion,
    scope: input.scope
  });
  if (health.malformed.length > 0) return { kind: 'incompatible', reasons: [...health.malformed] };

  const healthValues = [...health.byAccount.entries()];
  const inProgress = healthValues.find(([, value]) => value.kind === 'in-progress');
  if (inProgress !== undefined && inProgress[1].kind === 'in-progress') {
    return { kind: 'in-progress', record, operationIdentifier: inProgress[1].operationIdentifier };
  }
  const notEnrolled = healthValues.filter(([, value]) => value.kind === 'not-enrolled').map(([arn]) => arn);
  if (notEnrolled.length > 0) {
    // OU inheritance drift is expected here: a configured account that is missing, failed or
    // drifted is exactly what puts the parent baseline in inheritance drift.
    return {
      kind: 'governed-account-not-enrolled',
      record,
      accountIds: notEnrolled.map((arn) => arn.split('/').at(-1) ?? arn)
    };
  }
  if (ouDrift === 'DRIFTED') {
    return {
      kind: 'incompatible',
      reasons: [
        'AWSControlTowerBaseline reports inheritance drift on the OU although every configured account is enrolled and in sync'
      ]
    };
  }
  return { kind: 'governed', record };
}

export type PlannedAction = 'none' | 'enable' | 'reset' | 'poll' | 'converge' | 'stop';

/**
 * Maps a classified state to the single action the enrollment run may take.
 *
 * A configured account that is not yet enrolled in a governed OU is handled by the live
 * auto-enrollment setting: with auto-enrollment enabled, AWS Control Tower enrolls a moved account
 * asynchronously, so the run awaits convergence (`converge`) and never races it with a reset; with
 * it disabled, the run resets the OU's enabled baseline once. A reset is allowed at most once per
 * target per run: `resetAlreadyUsed` comes from the run ledger.
 */
export function plannedAction(state: TargetState, resetAlreadyUsed: boolean, autoEnrollment: boolean): PlannedAction {
  switch (state.kind) {
    case 'governed':
      return 'none';
    case 'not-governed':
      return 'enable';
    case 'in-progress':
      return 'poll';
    case 'governed-account-not-enrolled':
      if (autoEnrollment) return 'converge';
      return resetAlreadyUsed ? 'stop' : 'reset';
    case 'previously-failed':
      return resetAlreadyUsed ? 'stop' : 'reset';
    case 'incompatible':
      return 'stop';
  }
}

export type ConvergenceDecision = 'converged' | 'wait' | 'timeout' | 'unexpected';

/**
 * Pure: one step of bounded convergence polling. Used while AWS Control Tower is enrolling an
 * account on its own (auto-enrollment) or another operation holds the OU (`ConflictException`).
 * `governed` ends the wait; account-not-enrolled, in-progress and not-yet-governed keep waiting
 * until `timeoutMs` has passed since `startedAtMs`; any other state is unexpected and stops the
 * run. The wait never triggers a reset.
 */
export function convergenceDecision(input: {
  readonly state: TargetState['kind'];
  readonly startedAtMs: number;
  readonly nowMs: number;
  readonly timeoutMs: number;
}): ConvergenceDecision {
  if (input.state === 'governed') return 'converged';
  if (
    input.state !== 'governed-account-not-enrolled' &&
    input.state !== 'in-progress' &&
    input.state !== 'not-governed'
  ) {
    return 'unexpected';
  }
  return input.nowMs - input.startedAtMs >= input.timeoutMs ? 'timeout' : 'wait';
}

/** True for the AWS Control Tower error returned while another operation holds the target. */
export function isConflictError(error: unknown): boolean {
  return error instanceof Error && /ConflictException/.test(error.message);
}

/** `BaselineOperationStatus` values of the AWS Control Tower API model. */
const BASELINE_OPERATION_STATUSES = ['SUCCEEDED', 'FAILED', 'IN_PROGRESS'] as const;

export type OperationOutcome = (typeof BASELINE_OPERATION_STATUSES)[number] | 'MALFORMED';

export interface OperationClassification {
  readonly outcome: OperationOutcome;
  /** Why the response is `MALFORMED`. */
  readonly reason?: string;
}

/**
 * `GetBaselineOperation` classification. Only the documented `FAILED` status is `FAILED`. A missing
 * or non-object `baselineOperation`, a missing or unknown `status`, an `operationIdentifier` other
 * than the one requested, or a `startTime` that is not a timestamp (the operation timeout could not
 * be enforced) is `MALFORMED`: it fails closed and never enters FAILED handling.
 */
export function classifyBaselineOperation(operation: unknown, operationIdentifier: string): OperationClassification {
  if (!isObject(operation)) {
    return { outcome: 'MALFORMED', reason: 'the response has no baselineOperation object' };
  }
  const { status, operationIdentifier: returned, startTime } = operation;
  if (returned !== undefined && returned !== operationIdentifier) {
    return { outcome: 'MALFORMED', reason: `operationIdentifier ${JSON.stringify(returned)} is not the one requested` };
  }
  if (startTime !== undefined && (typeof startTime !== 'string' || Number.isNaN(Date.parse(startTime)))) {
    return { outcome: 'MALFORMED', reason: `startTime ${JSON.stringify(startTime)} is not a timestamp` };
  }
  if (status === undefined) return { outcome: 'MALFORMED', reason: 'status is missing' };
  if (typeof status !== 'string' || !(BASELINE_OPERATION_STATUSES as readonly string[]).includes(status)) {
    return {
      outcome: 'MALFORMED',
      reason: `status ${JSON.stringify(status)} is not one of ${BASELINE_OPERATION_STATUSES.join(', ')}`
    };
  }
  return { outcome: status as (typeof BASELINE_OPERATION_STATUSES)[number] };
}

/** Validates an `EnableBaseline` / `ResetEnabledBaseline` operation identifier. */
export function isOperationIdentifier(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value);
}

// ---------------------------------------------------------------------------------------------
// Execution-role model.
// ---------------------------------------------------------------------------------------------

export interface ExecutionRoleModel {
  readonly controlTowerExecutionRolePresent: boolean;
  readonly stackSetsExecutionRoles: readonly string[];
  readonly problems: readonly string[];
}

/**
 * Checks the IAM roles of an account Control Tower has just enrolled. `AWSControlTowerExecution`
 * must exist. The CloudFormation StackSets service-managed role that deployed it must exist as
 * `stacksets-exec-*` on path `/`, which is exactly the principal the SCP-ESC-IAM-001 exemption
 * `arn:<partition>:iam::*:role/stacksets-exec-*` matches. Workloads OUs (where SCP-ESC-IAM-001
 * applies) are registered only after this model is confirmed.
 */
export function evaluateExecutionRoleModel(roles: readonly IamRole[]): ExecutionRoleModel {
  const problems: string[] = [];
  const controlTowerExecutionRolePresent = roles.some((role) => role.RoleName === CONTROL_TOWER_EXECUTION_ROLE_NAME);
  const stackSets = roles.filter((role) => (role.RoleName ?? '').startsWith(STACKSETS_EXECUTION_ROLE_PREFIX));
  if (!controlTowerExecutionRolePresent) {
    problems.push(`${CONTROL_TOWER_EXECUTION_ROLE_NAME} is missing`);
  }
  if (stackSets.length === 0) {
    problems.push(
      `no ${STACKSETS_EXECUTION_ROLE_PREFIX}* role exists, so the principal that deployed ` +
        `${CONTROL_TOWER_EXECUTION_ROLE_NAME} is not the one SCP-ESC-IAM-001 exempts`
    );
  }
  for (const role of stackSets) {
    if (role.Path !== '/') {
      problems.push(
        `${role.RoleName ?? '<unnamed>'} is on path '${role.Path ?? '<none>'}', but the exemption matches path '/' only`
      );
    }
  }
  return {
    controlTowerExecutionRolePresent,
    stackSetsExecutionRoles: stackSets.map((role) => role.RoleName ?? ''),
    problems
  };
}
