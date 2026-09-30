#!/usr/bin/env tsx
/**
 * AWS Control Tower Landing Zone 4.0 pre-initialization checks.
 *
 * Runs inside a deploy workflow (`staging-deploy.yml` today, `production-deploy.yml` when the
 * Production shared-accounts prerequisite is wired) immediately BEFORE `CreateLandingZone`, and
 * only when the workflow's `controltower:ListLandingZones` idempotency gate has confirmed no
 * Landing Zone currently exists in the target management account/region. All checks are read-only
 * against AWS - no mutation. Environment authorisation is enforced by the calling workflow's
 * gates (release/** branch + protected `staging` GitHub Environment for Staging; workflow_dispatch
 * + PRODUCTION_DEPLOYMENT_ENABLED + protected `production` GitHub Environment for Production).
 *
 * Governed by `.apm/instructions/control-tower-initialization.instructions.md` §17 and
 * `.apm/skills/initialize-control-tower/SKILL.md` (Pre-Initialization Checks).
 *
 * Shared-account IDs are supplied at the command line (Path A) - they are resolved by the
 * workflow from the `AccountIdAudit` / `AccountIdLogArchive` outputs of the deployed
 * `lz-shared-accounts` stack via `aws cloudformation describe-stacks`. Never sourced from
 * configuration YAML.
 *
 * `AWSControlTowerExecution` is NOT assumed to exist in the pre-created Audit / Log Archive
 * accounts - the role is created by Control Tower during initialization, not before. Config /
 * CloudTrail conflict checks either assume an APPROVED existing cross-account inspection role
 * (supplied via `--inspection-role-name`) or fall back to a manual-evidence gate.
 *
 * Exit codes: 0 = all checks passed; 1 = at least one check failed. On failure, the initializer
 * (scripts/initialize-control-tower.ts) refuses to invoke `CreateLandingZone`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema, type LandingZoneConfig } from '../config/schemas/organization-schema.js';
import {
  awsAccountIdPattern,
  controlTowerGovernedRegion,
  controlTowerLandingZoneVersion
} from '../config/schemas/control-tower-schema.js';
import { buildLandingZoneManifest } from '../lib/control-tower/landing-zone-manifest.js';

const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const ORGANIZATION_ID_PATTERN = /^o-[0-9a-z]{10,32}$/;

/**
 * Control Tower SCP compatibility marker principals. The pre-init check confirms every listed
 * SCP's synthesized statement carries at least one of these exemption principals - a fingerprint
 * that the compatibility deployment has landed. Sourced from
 * `.apm/instructions/control-tower-scp-compatibility.instructions.md` and the exemption block in
 * `config/default.yaml` `governance.policyExemptions.controlTower*`.
 */
const SCP_COMPATIBILITY_MARKERS: readonly {
  policyId: string;
  requiredExemptionPrincipalFragment: string;
}[] = [
  { policyId: 'SCP-ESC-SEC-001', requiredExemptionPrincipalFragment: 'AWSServiceRoleForAWSControlTower' },
  { policyId: 'SCP-ESC-SEC-002', requiredExemptionPrincipalFragment: 'AWSControlTowerExecution' },
  { policyId: 'SCP-ESC-SEC-003', requiredExemptionPrincipalFragment: 'AWSControlTowerExecution' },
  { policyId: 'SCP-ESC-ENC-001', requiredExemptionPrincipalFragment: 'AWSControlTowerExecution' },
  { policyId: 'SCP-ESC-ROOT-003', requiredExemptionPrincipalFragment: 'AWSServiceRoleForAWSControlTower' }
];

interface CliOptions {
  readonly environment: EnvironmentName;
  readonly auditAccountId: string;
  readonly logArchiveAccountId: string;
  readonly inspectionRoleName: string | undefined;
  readonly conflictCheckEvidencePath: string | undefined;
  /** When true, skip the AWS-backed checks - useful in local dry runs. */
  readonly offline: boolean;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let environment: EnvironmentName | undefined;
  let auditAccountId: string | undefined;
  let logArchiveAccountId: string | undefined;
  let inspectionRoleName: string | undefined;
  let conflictCheckEvidencePath: string | undefined;
  let offline = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--environment' || argument === '-e') {
      if (value === undefined) throw new Error('--environment requires a value (staging or production).');
      const normalized = value.trim().toLowerCase();
      if (!(ENVIRONMENT_NAMES as readonly string[]).includes(normalized)) {
        throw new Error(`Unsupported environment '${value}'. Use one of: ${ENVIRONMENT_NAMES.join(', ')}.`);
      }
      environment = normalized as EnvironmentName;
      index += 1;
    } else if (argument === '--audit-account-id') {
      if (value === undefined) throw new Error('--audit-account-id requires a value.');
      auditAccountId = value;
      index += 1;
    } else if (argument === '--log-archive-account-id') {
      if (value === undefined) throw new Error('--log-archive-account-id requires a value.');
      logArchiveAccountId = value;
      index += 1;
    } else if (argument === '--inspection-role-name') {
      if (value === undefined) throw new Error('--inspection-role-name requires a value.');
      inspectionRoleName = value;
      index += 1;
    } else if (argument === '--conflict-check-evidence') {
      if (value === undefined) throw new Error('--conflict-check-evidence requires a path.');
      conflictCheckEvidencePath = value;
      index += 1;
    } else if (argument === '--offline') {
      offline = true;
    }
  }

  if (environment === undefined) throw new Error('--environment is required.');
  if (auditAccountId === undefined) throw new Error('--audit-account-id is required (Path A runtime input).');
  if (logArchiveAccountId === undefined) {
    throw new Error('--log-archive-account-id is required (Path A runtime input).');
  }

  return {
    environment,
    auditAccountId,
    logArchiveAccountId,
    inspectionRoleName,
    conflictCheckEvidencePath,
    offline
  };
}

interface CheckResult {
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'manual';
  readonly detail: string;
}

function cli(command: readonly string[]): unknown {
  try {
    return JSON.parse(execFileSync('aws', [...command, '--output', 'json', '--no-cli-pager'], { encoding: 'utf8' }));
  } catch (error) {
    throw new Error(`aws ${command.join(' ')} failed: ${(error as Error).message}`, { cause: error });
  }
}

function cliText(command: readonly string[]): string {
  try {
    return execFileSync('aws', [...command, '--output', 'text', '--no-cli-pager'], { encoding: 'utf8' }).trim();
  } catch (error) {
    throw new Error(`aws ${command.join(' ')} failed: ${(error as Error).message}`, { cause: error });
  }
}

/** Pure: validates a shared-account ID string (12 digits). Exported for unit tests. */
export function validateSharedAccountId(label: string, value: string): void {
  if (!awsAccountIdPattern.test(value)) {
    throw new Error(`${label} '${value}' is not a 12-digit AWS account ID.`);
  }
}

/**
 * Pure: given the synthesized organization-policy CloudFormation template (parsed JSON), asserts
 * that every SCP compatibility marker principal fragment appears somewhere in the corresponding
 * policy's document. Exported for tests.
 */
export function assertScpCompatibilityMarkers(
  template: unknown,
  markers: readonly { policyId: string; requiredExemptionPrincipalFragment: string }[]
): void {
  const resources = (template as { Resources?: Record<string, unknown> } | undefined)?.Resources ?? {};
  const policiesById = new Map<string, string>();
  for (const [logicalId, resource] of Object.entries(resources)) {
    const record = resource as { Type?: string; Properties?: { Name?: string; Content?: unknown } };
    if (record.Type !== 'AWS::Organizations::Policy') continue;
    const name = record.Properties?.Name;
    if (typeof name !== 'string') continue;
    // Serialize the whole Content (may contain Fn::Join / Fn::Sub tokens with the principal name).
    policiesById.set(name, `${logicalId}::${JSON.stringify(record.Properties?.Content)}`);
  }
  for (const marker of markers) {
    const entry = policiesById.get(marker.policyId);
    if (entry === undefined) {
      throw new Error(`Compatibility marker check: policy '${marker.policyId}' not found in the deployed template.`);
    }
    if (!entry.includes(marker.requiredExemptionPrincipalFragment)) {
      throw new Error(
        `Compatibility marker check: policy '${marker.policyId}' does not contain the required exemption ` +
          `principal fragment '${marker.requiredExemptionPrincipalFragment}'.`
      );
    }
  }
}

function checkIdentity(expectedAccountId: string): CheckResult {
  const identity = cli(['sts', 'get-caller-identity']) as { Account?: string };
  if (identity.Account !== expectedAccountId) {
    return {
      name: 'AWS identity',
      status: 'failed',
      detail: `sts:GetCallerIdentity account ${identity.Account} does not match expected ${expectedAccountId}.`
    };
  }
  return { name: 'AWS identity', status: 'passed', detail: `caller account ${identity.Account}` };
}

function checkRegionPartition(): CheckResult {
  // AWS CLI reads region from environment; the deploying workflow pins AWS_REGION to eusc-de-east-1.
  const region = process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'];
  if (region !== controlTowerGovernedRegion) {
    return {
      name: 'Region / partition',
      status: 'failed',
      detail: `AWS_REGION is '${region ?? '<unset>'}' but must be '${controlTowerGovernedRegion}'.`
    };
  }
  return { name: 'Region / partition', status: 'passed', detail: `${controlTowerGovernedRegion} (aws-eusc)` };
}

function checkNoExistingLandingZone(): CheckResult {
  // A single list call against the target management account / region is authoritative: any active
  // Landing Zone in this org appears here. Replaces the earlier per-account check.
  const response = cli(['controltower', 'list-landing-zones']) as {
    landingZones?: readonly { arn?: string }[];
  };
  const active = response.landingZones ?? [];
  if (active.length > 0) {
    const arns = active.map((entry) => entry.arn ?? '<no-arn>').join(', ');
    return {
      name: 'No existing Landing Zone',
      status: 'failed',
      detail:
        `Target management account / region already governs Landing Zone(s): ${arns}. ` +
        'Never issue a second CreateLandingZone.'
    };
  }
  return {
    name: 'No existing Landing Zone',
    status: 'passed',
    detail: `controltower:ListLandingZones in ${controlTowerGovernedRegion} returned zero entries.`
  };
}

function checkSharedAccount(
  label: string,
  accountId: string,
  expectedOrganizationId: string,
  expectedSecurityOuId: string
): CheckResult {
  const account = cli(['organizations', 'describe-account', '--account-id', accountId]) as {
    Account?: { Status?: string; Id?: string };
  };
  if (account.Account?.Status !== 'ACTIVE') {
    return {
      name: `${label} account status`,
      status: 'failed',
      detail: `describe-account for ${accountId} returned Status='${account.Account?.Status ?? '<unset>'}'.`
    };
  }
  const parents = cli(['organizations', 'list-parents', '--child-id', accountId]) as {
    Parents?: readonly { Id?: string; Type?: string }[];
  };
  const parentIds = (parents.Parents ?? [])
    .map((parent) => parent.Id)
    .filter((id): id is string => typeof id === 'string');
  if (!parentIds.includes(expectedSecurityOuId)) {
    return {
      name: `${label} placement`,
      status: 'failed',
      detail:
        `${label} (${accountId}) is under [${parentIds.join(', ') || '<none>'}] but must be under the Security OU ` +
        `${expectedSecurityOuId}.`
    };
  }
  const org = cli(['organizations', 'describe-organization']) as { Organization?: { Id?: string } };
  if (org.Organization?.Id !== expectedOrganizationId) {
    return {
      name: `${label} organization membership`,
      status: 'failed',
      detail: `describe-organization returned '${org.Organization?.Id ?? '<unset>'}', expected '${expectedOrganizationId}'.`
    };
  }
  return {
    name: `${label} account`,
    status: 'passed',
    detail: `${accountId} ACTIVE in org ${expectedOrganizationId} under Security OU ${expectedSecurityOuId}`
  };
}

function resolveSecurityOuId(): string {
  // The OU stack emits OuIdSecurity; the OU ID is authoritatively resolved from that output.
  const value = cliText([
    'cloudformation',
    'describe-stacks',
    '--stack-name',
    'lz-ou-structure',
    '--query',
    "Stacks[0].Outputs[?OutputKey=='OuIdSecurity'].OutputValue | [0]"
  ]);
  if (!OU_ID_PATTERN.test(value)) {
    throw new Error(`lz-ou-structure OuIdSecurity output '${value}' is not a valid AWS Organizations OU ID.`);
  }
  return value;
}

function resolveOrganizationId(): string {
  const org = cli(['organizations', 'describe-organization']) as { Organization?: { Id?: string } };
  const id = org.Organization?.Id;
  if (id === undefined || !ORGANIZATION_ID_PATTERN.test(id)) {
    throw new Error(`describe-organization returned an unrecognisable organization id '${id ?? '<unset>'}'.`);
  }
  return id;
}

function checkScpCompatibility(): CheckResult {
  const template = cli([
    'cloudformation',
    'get-template',
    '--stack-name',
    'lz-organization-policies',
    '--template-stage',
    'Processed'
  ]) as { TemplateBody?: unknown };
  const body = template.TemplateBody;
  if (typeof body !== 'object' || body === null) {
    return {
      name: 'SCP compatibility markers',
      status: 'failed',
      detail: 'lz-organization-policies TemplateBody is empty or not an object.'
    };
  }
  try {
    assertScpCompatibilityMarkers(body, SCP_COMPATIBILITY_MARKERS);
  } catch (error) {
    return { name: 'SCP compatibility markers', status: 'failed', detail: (error as Error).message };
  }
  return {
    name: 'SCP compatibility markers',
    status: 'passed',
    detail: `${SCP_COMPATIBILITY_MARKERS.map((m) => m.policyId).join(', ')} carry Control Tower principal exemptions`
  };
}

function checkConfigCloudTrailConflict(
  auditAccountId: string,
  logArchiveAccountId: string,
  inspectionRoleName: string | undefined,
  evidencePath: string | undefined
): CheckResult {
  if (inspectionRoleName !== undefined) {
    // Assume an EXISTING approved cross-account inspection role. Do NOT assume AWSControlTowerExecution.
    for (const accountId of [auditAccountId, logArchiveAccountId]) {
      const recorders = cliText([
        'sts',
        'assume-role',
        '--role-arn',
        `arn:aws-eusc:iam::${accountId}:role/${inspectionRoleName}`,
        '--role-session-name',
        `lz-preinit-${accountId}`,
        '--query',
        'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]'
      ]);
      const [accessKeyId, secretAccessKey, sessionToken] = recorders.split(/\s+/);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        AWS_ACCESS_KEY_ID: accessKeyId,
        AWS_SECRET_ACCESS_KEY: secretAccessKey,
        AWS_SESSION_TOKEN: sessionToken
      };
      const runConfig = execFileSync(
        'aws',
        ['configservice', 'describe-configuration-recorders', '--output', 'json', '--no-cli-pager'],
        { encoding: 'utf8', env }
      );
      const runTrails = execFileSync('aws', ['cloudtrail', 'describe-trails', '--output', 'json', '--no-cli-pager'], {
        encoding: 'utf8',
        env
      });
      const recorderList =
        (JSON.parse(runConfig) as { ConfigurationRecorders?: readonly unknown[] }).ConfigurationRecorders ?? [];
      const trailList = (JSON.parse(runTrails) as { trailList?: readonly unknown[] }).trailList ?? [];
      if (recorderList.length > 0 || trailList.length > 0) {
        return {
          name: 'Config/CloudTrail conflict check',
          status: 'failed',
          detail:
            `Account ${accountId} already carries ${recorderList.length} Config recorder(s) and ` +
            `${trailList.length} trail(s). Control Tower initialisation would conflict; investigate before proceeding.`
        };
      }
    }
    return {
      name: 'Config/CloudTrail conflict check',
      status: 'passed',
      detail: `no Config recorders or trails present in Audit or Log Archive (inspected via ${inspectionRoleName})`
    };
  }

  if (evidencePath !== undefined) {
    const path = isAbsolute(evidencePath) ? evidencePath : resolve(process.cwd(), evidencePath);
    if (!existsSync(path)) {
      return {
        name: 'Config/CloudTrail conflict check (manual evidence)',
        status: 'failed',
        detail: `--conflict-check-evidence '${path}' does not exist.`
      };
    }
    const body = readFileSync(path, 'utf8');
    if (!body.includes(auditAccountId) || !body.includes(logArchiveAccountId)) {
      return {
        name: 'Config/CloudTrail conflict check (manual evidence)',
        status: 'failed',
        detail: `Evidence file must reference both ${auditAccountId} and ${logArchiveAccountId}.`
      };
    }
    return {
      name: 'Config/CloudTrail conflict check (manual evidence)',
      status: 'manual',
      detail: `accepted manual-evidence file ${path}`
    };
  }

  return {
    name: 'Config/CloudTrail conflict check',
    status: 'failed',
    detail:
      'No inspection role and no --conflict-check-evidence supplied. Provide --inspection-role-name for an ' +
      'existing approved cross-account read role in the Audit and Log Archive accounts, or supply a signed ' +
      'manual-evidence file. AWSControlTowerExecution does NOT exist in those accounts before initialisation ' +
      'and cannot be assumed.'
  };
}

function checkManifestBuildable(
  config: LandingZoneConfig,
  auditAccountId: string,
  logArchiveAccountId: string
): CheckResult {
  if (config.controlTower.version !== controlTowerLandingZoneVersion) {
    return {
      name: 'Landing Zone manifest',
      status: 'failed',
      detail: `configuration version '${config.controlTower.version}' differs from approved '${controlTowerLandingZoneVersion}'.`
    };
  }
  try {
    buildLandingZoneManifest(config.controlTower, { auditAccountId, logArchiveAccountId });
  } catch (error) {
    return { name: 'Landing Zone manifest', status: 'failed', detail: (error as Error).message };
  }
  return {
    name: 'Landing Zone manifest',
    status: 'passed',
    detail: `manifest builds with LZ ${controlTowerLandingZoneVersion} against runtime shared-account IDs`
  };
}

function checkDeploymentPermissions(): CheckResult {
  const identity = cli(['sts', 'get-caller-identity']) as { Arn?: string };
  const principalArn = identity.Arn;
  if (typeof principalArn !== 'string') {
    return { name: 'Deployment permissions', status: 'failed', detail: 'sts:GetCallerIdentity returned no Arn.' };
  }

  // AWS ESC partition (aws-eusc) limitation: iam:simulate-principal-policy does not support
  // assumed-role ARN format. Extract the underlying role name and account ID from the
  // assumed-role ARN, then construct a direct role ARN for use with simulate-principal-policy.
  // Expected input format: arn:aws-eusc:sts::ACCOUNT:assumed-role/ROLE_NAME/SESSION_NAME
  const assumedRoleMatch = principalArn.match(/^arn:aws-eusc:sts::(\d{12}):assumed-role\/([^/]+)\/[^/]+$/);
  if (!assumedRoleMatch || !assumedRoleMatch[1] || !assumedRoleMatch[2]) {
    return {
      name: 'Deployment permissions',
      status: 'failed',
      detail: `Unable to parse assumed-role ARN for aws-eusc partition. Expected format: arn:aws-eusc:sts::ACCOUNT:assumed-role/ROLE_NAME/SESSION. Got: ${principalArn}`
    };
  }

  const accountId = assumedRoleMatch[1];
  const roleName = assumedRoleMatch[2];

  // Construct direct role ARN (works with simulate-principal-policy in aws-eusc partition)
  const directRoleArn = `arn:aws-eusc:iam::${accountId}:role/${roleName}`;

  const actions = [
    'controltower:CreateLandingZone',
    'controltower:GetLandingZone',
    'controltower:GetLandingZoneOperation',
    'controltower:ListLandingZones',
    'iam:CreateServiceLinkedRole'
  ];
  const response = cli([
    'iam',
    'simulate-principal-policy',
    '--policy-source-arn',
    directRoleArn,
    '--action-names',
    ...actions
  ]) as { EvaluationResults?: readonly { EvalActionName?: string; EvalDecision?: string }[] };
  const denied = (response.EvaluationResults ?? []).filter((r) => r.EvalDecision !== 'allowed');
  if (denied.length > 0) {
    return {
      name: 'Deployment permissions',
      status: 'failed',
      detail: `Denied actions: ${denied.map((d) => `${d.EvalActionName}=${d.EvalDecision}`).join(', ')}.`
    };
  }
  return {
    name: 'Deployment permissions',
    status: 'passed',
    detail: `all required actions allowed for ${directRoleArn}`
  };
}

/**
 * AWS Organizations trusted-access service principals required by the AWS Control Tower
 * `CreateLandingZone` API path. See `.apm/instructions/control-tower-initialization.instructions.md`
 * §6.1. Enabling each is a one-time-per-organization action performed by
 * `.github/scripts/enable-org-trusted-access.sh` before pre-init checks run.
 */
const REQUIRED_TRUSTED_ACCESS_PRINCIPALS: readonly string[] = [
  'controltower.amazonaws.com',
  'member.org.stacksets.cloudformation.amazonaws.com',
  'config.amazonaws.com',
  'config-multiaccountsetup.amazonaws.com'
];

/**
 * Verifies AWS Organizations trusted access is enabled for every service principal the API-path
 * Landing Zone initialization requires. Fails fast with the concrete missing entries so the
 * calling workflow's operator can rerun the trusted-access enablement step.
 */
function checkOrganizationsTrustedAccess(): CheckResult {
  const response = cli(['organizations', 'list-aws-service-access-for-organization']) as {
    EnabledServicePrincipals?: readonly { ServicePrincipal?: string }[];
  };
  const enabled = new Set(
    (response.EnabledServicePrincipals ?? [])
      .map((entry) => entry.ServicePrincipal)
      .filter((principal): principal is string => typeof principal === 'string')
  );
  const missing = REQUIRED_TRUSTED_ACCESS_PRINCIPALS.filter((principal) => !enabled.has(principal));
  if (missing.length > 0) {
    return {
      name: 'AWS Organizations trusted access',
      status: 'failed',
      detail:
        `Missing trusted access for: ${missing.join(', ')}. ` +
        'Run `.github/scripts/enable-org-trusted-access.sh` (or the initialize-control-tower ' +
        'composite action which invokes it) before rerunning pre-init.'
    };
  }
  return {
    name: 'AWS Organizations trusted access',
    status: 'passed',
    detail: `all ${REQUIRED_TRUSTED_ACCESS_PRINCIPALS.length} required service principals enabled`
  };
}

/**
 * Management-account IAM roles that must exist before `CreateLandingZone` per AWS documented API
 * setup. The three customer-managed roles are provisioned by `ControlTowerRolesStack`
 * (lz-control-tower-roles); the service-linked role is auto-created when trusted access for
 * `controltower.amazonaws.com` is enabled. See instructions §11.1 and §6.1.
 */
const REQUIRED_CONTROL_TOWER_ROLES: readonly {
  readonly name: string;
  readonly kind: 'customer-managed' | 'service-linked';
  readonly provisionedBy: string;
}[] = [
  {
    name: 'AWSControlTowerAdmin',
    kind: 'customer-managed',
    provisionedBy: 'lz-control-tower-roles stack'
  },
  {
    name: 'AWSControlTowerCloudTrailRole',
    kind: 'customer-managed',
    provisionedBy: 'lz-control-tower-roles stack'
  },
  {
    name: 'AWSControlTowerStackSetRole',
    kind: 'customer-managed',
    provisionedBy: 'lz-control-tower-roles stack'
  },
  {
    name: 'AWSServiceRoleForAWSControlTower',
    kind: 'service-linked',
    provisionedBy: 'Organizations trusted access for controltower.amazonaws.com'
  }
];

/**
 * Verifies each management-account role required by CreateLandingZone exists. Uses
 * `iam:GetRole` per role so a missing role returns a clearly-named entry and non-existence
 * errors do not mask a legitimate permission problem.
 */
function checkControlTowerManagementRoles(): CheckResult {
  const missing: string[] = [];
  for (const role of REQUIRED_CONTROL_TOWER_ROLES) {
    try {
      cli(['iam', 'get-role', '--role-name', role.name]);
    } catch (error) {
      const message = (error as Error).message;
      if (/NoSuchEntity/.test(message)) {
        missing.push(`${role.name} (${role.kind}; provisioned by ${role.provisionedBy})`);
        continue;
      }
      return {
        name: 'Control Tower management-account roles',
        status: 'failed',
        detail: `iam:GetRole for ${role.name} failed unexpectedly: ${message}`
      };
    }
  }
  if (missing.length > 0) {
    return {
      name: 'Control Tower management-account roles',
      status: 'failed',
      detail:
        `Missing: ${missing.join('; ')}. Deploy the lz-control-tower-roles stack and rerun ` +
        '`.github/scripts/enable-org-trusted-access.sh` before pre-init.'
    };
  }
  return {
    name: 'Control Tower management-account roles',
    status: 'passed',
    detail: `all ${REQUIRED_CONTROL_TOWER_ROLES.length} required roles present`
  };
}

export function runPreinitChecks(options: CliOptions): readonly CheckResult[] {
  const config = new ConfigReader(options.environment, {
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();

  validateSharedAccountId('auditAccountId', options.auditAccountId);
  validateSharedAccountId('logArchiveAccountId', options.logArchiveAccountId);
  if (options.auditAccountId === options.logArchiveAccountId) {
    throw new Error('audit and log archive account IDs must differ.');
  }

  const results: CheckResult[] = [];

  if (options.offline) {
    results.push({
      name: 'Offline mode',
      status: 'manual',
      detail: 'Skipping AWS-backed checks; only environment guard and shared-account ID format were validated.'
    });
    results.push(checkManifestBuildable(config, options.auditAccountId, options.logArchiveAccountId));
    return results;
  }

  results.push(checkIdentity(config.aws.accountId));
  results.push(checkRegionPartition());
  results.push(checkNoExistingLandingZone());

  let organizationId: string;
  let securityOuId: string;
  try {
    organizationId = resolveOrganizationId();
    securityOuId = resolveSecurityOuId();
  } catch (error) {
    results.push({ name: 'Org/OU resolution', status: 'failed', detail: (error as Error).message });
    return results;
  }
  results.push({
    name: 'Org/OU resolution',
    status: 'passed',
    detail: `organization ${organizationId}, Security OU ${securityOuId}`
  });

  results.push(checkSharedAccount('Audit', options.auditAccountId, organizationId, securityOuId));
  results.push(checkSharedAccount('Log Archive', options.logArchiveAccountId, organizationId, securityOuId));
  results.push(checkScpCompatibility());
  results.push(checkOrganizationsTrustedAccess());
  results.push(checkControlTowerManagementRoles());
  results.push(
    checkConfigCloudTrailConflict(
      options.auditAccountId,
      options.logArchiveAccountId,
      options.inspectionRoleName,
      options.conflictCheckEvidencePath
    )
  );
  results.push(checkManifestBuildable(config, options.auditAccountId, options.logArchiveAccountId));
  results.push(checkDeploymentPermissions());

  return results;
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2));

  console.log(`AWS Control Tower Landing Zone 4.0 pre-initialisation checks (${options.environment})`);
  console.log(`  Audit account ID:      ${options.auditAccountId}`);
  console.log(`  Log Archive account ID: ${options.logArchiveAccountId}`);
  console.log('');

  const results = runPreinitChecks(options);

  let failedCount = 0;
  for (const result of results) {
    const marker = result.status === 'passed' ? 'PASS' : result.status === 'manual' ? 'MANUAL' : 'FAIL';
    console.log(`  [${marker}] ${result.name} - ${result.detail}`);
    if (result.status === 'failed') failedCount += 1;
  }

  if (failedCount > 0) {
    console.error(`\n${failedCount} pre-initialisation check(s) failed. Refusing to invoke CreateLandingZone.`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll pre-initialisation checks passed.');
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(`\nPre-initialisation failed.\n${(error as Error).message}`);
    process.exitCode = 1;
  }
}
