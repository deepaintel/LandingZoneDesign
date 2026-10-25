/**
 * Common Account Security Baseline v1.0 - AWS CLI runtime adapter.
 *
 * Governed by `.apm/skills/common-account-baseline/SKILL.md`. Runs ONLY inside the
 * protected Staging and Production deployment jobs, after OIDC credentials for `github-actions-role`
 * are configured; never from CI. Implements the ports of `lib/account-baseline/ports.ts`:
 *
 *  - `CliInventory` (management account, READ-ONLY): reuses the Control Tower enrollment plan
 *    (`buildEnrollmentPlan`) for caller identity, organization, Landing Zone health, live account
 *    reconciliation, runtime handoffs and per-account enrollment, and lists the Suspended OU;
 *  - `CliMemberAccount`: one member account through the established cross-account role
 *    `OrganizationAccountAccessRole` (the same pattern as the enrollment runtime). The repository
 *    never creates or changes that role. Every call targets the home Region; the only mutating
 *    methods are `write` (the six allow-listed `BaselineWrite`s) and nothing else.
 *
 * Errors carry the AWS error code (`An error occurred (Code) ...`) and are classified by
 * `classifyAwsFailure`. Expected "not configured" codes return `undefined`. Calls time out after
 * `CALL_TIMEOUT_MS`; the CLI's standard retry mode handles throttling within a bounded attempt count.
 */

import { execFileSync } from 'node:child_process';

import {
  ACCOUNT_BASELINE_CONTROL_IDS,
  type AccountBaselineControlId
} from '../config/schemas/account-baseline-schema.js';
import type { LandingZoneConfig } from '../config/schemas/organization-schema.js';
import { CLI_REQUIREMENTS, cliCapabilityProblems } from '../lib/account-baseline/capabilities.js';
import { MEMBER_ACCESS_ROLE_NAME } from '../lib/account-baseline/plan.js';
import type {
  AccessPointDetails,
  AclGrant,
  BlockPublicAccessState,
  BucketSummary,
  DryRunResult,
  InstanceMetadataDefaults,
  InventoryAccount,
  InventoryPort,
  InventorySnapshot,
  KmsKeyDetails,
  MemberAccountPort
} from '../lib/account-baseline/ports.js';
import {
  AwsCallError,
  awsErrorCode,
  classifyAwsFailure,
  type BaselineWrite,
  type S3PublicAccessBlockConfiguration
} from '../lib/account-baseline/types.js';
import { resolveOuPath } from '../lib/organization/landing-zone-account-reconciler.js';
import {
  createOrganizationsAccountPort,
  createOrganizationsClient
} from '../lib/organization/organizations-account-adapter.js';
import {
  AwsCli,
  buildEnrollmentPlan,
  type CredentialEnv,
  type RuntimeInputs
} from './control-tower-enrollment-runtime.js';

export const CALL_TIMEOUT_MS = 120_000;
export const MEMBER_SESSION_SECONDS = 900;
const SUSPENDED_OU_PATH = 'Suspended';

/** AWS error codes that mean "not configured" for the given operation. */
const NOT_CONFIGURED_CODES: Readonly<Record<string, readonly string[]>> = {
  's3control get-public-access-block': ['NoSuchPublicAccessBlockConfiguration'],
  's3api get-public-access-block': ['NoSuchPublicAccessBlockConfiguration'],
  's3api get-bucket-policy-status': ['NoSuchBucketPolicy'],
  's3api get-bucket-ownership-controls': ['OwnershipControlsNotFoundError'],
  's3control get-access-point-policy-status': ['NoSuchAccessPointPolicy']
};

function boolean(value: unknown, operation: string, member: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AwsCallError(operation, undefined, 'other', `malformed response: '${member}' is not a boolean`);
  }
  return value;
}

function text(value: unknown, operation: string, member: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new AwsCallError(operation, undefined, 'other', `malformed response: '${member}' is missing`);
  }
  return value;
}

function stringList(value: unknown, operation: string, member: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new AwsCallError(operation, undefined, 'other', `malformed response: '${member}' is not a string list`);
  }
  return value as string[];
}

function blockConfiguration(value: unknown, operation: string): S3PublicAccessBlockConfiguration {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    BlockPublicAcls: boolean(source['BlockPublicAcls'], operation, 'BlockPublicAcls'),
    IgnorePublicAcls: boolean(source['IgnorePublicAcls'], operation, 'IgnorePublicAcls'),
    BlockPublicPolicy: boolean(source['BlockPublicPolicy'], operation, 'BlockPublicPolicy'),
    RestrictPublicBuckets: boolean(source['RestrictPublicBuckets'], operation, 'RestrictPublicBuckets')
  };
}

/** Runs one AWS CLI command in the home Region; returns parsed JSON or `undefined` for "not configured". */
export class AwsCliRunner {
  public constructor(
    private readonly region: string,
    private readonly env: CredentialEnv = process.env
  ) {}

  public call<T>(service: string, command: string, args: readonly string[] = []): T | undefined {
    const operation = `${service} ${command}`;
    const argv = [service, command, ...args, '--region', this.region, '--output', 'json', '--no-cli-pager'];
    let stdout: string;
    try {
      stdout = execFileSync('aws', argv, {
        encoding: 'utf8',
        env: { ...this.env, AWS_RETRY_MODE: 'standard', AWS_MAX_ATTEMPTS: '8' },
        maxBuffer: 64 * 1024 * 1024,
        timeout: CALL_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      const failure = error as { stderr?: Buffer | string; code?: string; signal?: string; message?: string };
      const stderr = failure.stderr?.toString().trim() ?? '';
      const message = stderr || failure.message || 'unknown failure';
      const code = awsErrorCode(message);
      if (code !== undefined && (NOT_CONFIGURED_CODES[operation] ?? []).includes(code)) return undefined;
      if (code === 'DryRunOperation') throw new DryRunAuthorized(operation);
      const timedOut = failure.code === 'ETIMEDOUT' || failure.signal === 'SIGTERM';
      throw new AwsCallError(operation, code, timedOut ? 'timeout' : classifyAwsFailure(code, message), message);
    }
    return (stdout.trim() === '' ? {} : JSON.parse(stdout)) as T;
  }

  /** Local request skeleton; makes no AWS call. */
  public skeleton(service: string, command: string): unknown {
    try {
      return JSON.parse(
        execFileSync('aws', [service, command, '--generate-cli-skeleton', 'input'], {
          encoding: 'utf8',
          timeout: CALL_TIMEOUT_MS,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      );
    } catch (error) {
      const stderr = (error as { stderr?: Buffer | string }).stderr?.toString().trim();
      return new Error(stderr || (error as Error).message);
    }
  }
}

/** Thrown internally when EC2 answers a DryRun request with `DryRunOperation` (authorized). */
class DryRunAuthorized extends Error {
  public constructor(operation: string) {
    super(`${operation}: DryRunOperation`);
  }
}

/** Local CLI capability problems for every control. No AWS call. */
export function localCapabilityProblems(runner: AwsCliRunner): Map<AccountBaselineControlId, string[]> {
  const skeletons = new Map<string, unknown>();
  for (const control of ACCOUNT_BASELINE_CONTROL_IDS) {
    for (const requirement of CLI_REQUIREMENTS[control]) {
      const name = `${requirement.service} ${requirement.command}`;
      if (!skeletons.has(name)) skeletons.set(name, runner.skeleton(requirement.service, requirement.command));
    }
  }
  return cliCapabilityProblems(skeletons);
}

function ec2WriteArgs(write: Exclude<BaselineWrite, { kind: 'PutAccountPublicAccessBlock' }>): [string, string[]] {
  switch (write.kind) {
    case 'EnableEbsEncryptionByDefault':
      return ['enable-ebs-encryption-by-default', []];
    case 'ModifyInstanceMetadataDefaults':
      return write.field === 'HttpTokens'
        ? ['modify-instance-metadata-defaults', ['--http-tokens', 'required']]
        : ['modify-instance-metadata-defaults', ['--http-put-response-hop-limit', '2']];
    case 'EnableSnapshotBlockPublicAccess':
      return ['enable-snapshot-block-public-access', ['--state', 'block-all-sharing']];
    case 'EnableImageBlockPublicAccess':
      return ['enable-image-block-public-access', ['--image-block-public-access-state', 'block-new-sharing']];
  }
}

export class CliMemberAccount implements MemberAccountPort {
  private readonly runner: AwsCliRunner;

  public constructor(
    public readonly accountId: string,
    region: string,
    env: CredentialEnv
  ) {
    this.runner = new AwsCliRunner(region, env);
  }

  public callerIdentity(): { Account?: string; Arn?: string } {
    return this.runner.call('sts', 'get-caller-identity') ?? {};
  }

  public getAccountPublicAccessBlock(): S3PublicAccessBlockConfiguration | undefined {
    const response = this.runner.call<{ PublicAccessBlockConfiguration?: unknown }>(
      's3control',
      'get-public-access-block',
      ['--account-id', this.accountId]
    );
    return response === undefined
      ? undefined
      : blockConfiguration(response.PublicAccessBlockConfiguration, 's3control get-public-access-block');
  }

  public listBuckets(): BucketSummary[] {
    const response = this.runner.call<{ Buckets?: { Name?: string; BucketRegion?: string }[] }>(
      's3api',
      'list-buckets'
    );
    if (!Array.isArray(response?.Buckets)) {
      throw new AwsCallError('s3api list-buckets', undefined, 'other', "malformed response: no 'Buckets' list");
    }
    return response.Buckets.map((bucket) => ({
      name: text(bucket.Name, 's3api list-buckets', 'Name'),
      ...(bucket.BucketRegion === undefined ? {} : { region: bucket.BucketRegion })
    }));
  }

  public getBucketPolicyStatus(bucket: string): boolean | undefined {
    const response = this.runner.call<{ PolicyStatus?: { IsPublic?: unknown } }>('s3api', 'get-bucket-policy-status', [
      '--bucket',
      bucket
    ]);
    return response === undefined
      ? undefined
      : boolean(response.PolicyStatus?.IsPublic, 's3api get-bucket-policy-status', 'IsPublic');
  }

  public getBucketAcl(bucket: string): AclGrant[] {
    const response = this.runner.call<{
      Grants?: { Grantee?: { Type?: string; URI?: string }; Permission?: string }[];
    }>('s3api', 'get-bucket-acl', ['--bucket', bucket]);
    return (response?.Grants ?? []).map((grant) => ({
      ...(grant.Grantee?.Type === undefined ? {} : { granteeType: grant.Grantee.Type }),
      ...(grant.Grantee?.URI === undefined ? {} : { granteeUri: grant.Grantee.URI }),
      ...(grant.Permission === undefined ? {} : { permission: grant.Permission })
    }));
  }

  public getBucketObjectOwnership(bucket: string): string | undefined {
    const response = this.runner.call<{ OwnershipControls?: { Rules?: { ObjectOwnership?: string }[] } }>(
      's3api',
      'get-bucket-ownership-controls',
      ['--bucket', bucket]
    );
    return response?.OwnershipControls?.Rules?.[0]?.ObjectOwnership;
  }

  public getBucketPublicAccessBlock(bucket: string): S3PublicAccessBlockConfiguration | undefined {
    const response = this.runner.call<{ PublicAccessBlockConfiguration?: unknown }>(
      's3api',
      'get-public-access-block',
      ['--bucket', bucket]
    );
    return response === undefined
      ? undefined
      : blockConfiguration(response.PublicAccessBlockConfiguration, 's3api get-public-access-block');
  }

  public listAccessPoints(): string[] {
    const response = this.runner.call<{ AccessPointList?: { Name?: string }[] }>('s3control', 'list-access-points', [
      '--account-id',
      this.accountId
    ]);
    return (response?.AccessPointList ?? []).map((point) => text(point.Name, 's3control list-access-points', 'Name'));
  }

  public getAccessPoint(name: string): AccessPointDetails {
    const response = this.runner.call<{ PublicAccessBlockConfiguration?: unknown }>('s3control', 'get-access-point', [
      '--account-id',
      this.accountId,
      '--name',
      name
    ]);
    return response?.PublicAccessBlockConfiguration === undefined
      ? { name }
      : {
          name,
          publicAccessBlock: blockConfiguration(response.PublicAccessBlockConfiguration, 's3control get-access-point')
        };
  }

  public getAccessPointPolicyStatus(name: string): boolean | undefined {
    const response = this.runner.call<{ PolicyStatus?: { IsPublic?: unknown } }>(
      's3control',
      'get-access-point-policy-status',
      ['--account-id', this.accountId, '--name', name]
    );
    return response === undefined
      ? undefined
      : boolean(response.PolicyStatus?.IsPublic, 's3control get-access-point-policy-status', 'IsPublic');
  }

  public getEbsEncryptionByDefault(): boolean {
    const response = this.runner.call<{ EbsEncryptionByDefault?: unknown }>('ec2', 'get-ebs-encryption-by-default');
    return boolean(response?.EbsEncryptionByDefault, 'ec2 get-ebs-encryption-by-default', 'EbsEncryptionByDefault');
  }

  public getEbsDefaultKmsKeyId(): string {
    const response = this.runner.call<{ KmsKeyId?: unknown }>('ec2', 'get-ebs-default-kms-key-id');
    return text(response?.KmsKeyId, 'ec2 get-ebs-default-kms-key-id', 'KmsKeyId');
  }

  public describeKmsKey(keyId: string): KmsKeyDetails {
    const response = this.runner.call<{
      KeyMetadata?: { Arn?: string; KeyId?: string; KeyManager?: string; KeyState?: string; KeySpec?: string };
    }>('kms', 'describe-key', ['--key-id', keyId]);
    const metadata = response?.KeyMetadata;
    const keyManager = text(metadata?.KeyManager, 'kms describe-key', 'KeyManager');
    const aliases =
      keyManager === 'AWS'
        ? (
            this.runner.call<{ Aliases?: { AliasName?: string }[] }>('kms', 'list-aliases', [
              '--key-id',
              text(metadata?.KeyId, 'kms describe-key', 'KeyId')
            ])?.Aliases ?? []
          ).flatMap((alias) => (alias.AliasName === undefined ? [] : [alias.AliasName]))
        : [];
    return {
      arn: text(metadata?.Arn, 'kms describe-key', 'Arn'),
      keyManager,
      keyState: text(metadata?.KeyState, 'kms describe-key', 'KeyState'),
      ...(metadata?.KeySpec === undefined ? {} : { keySpec: metadata.KeySpec }),
      aliases
    };
  }

  public getInstanceMetadataDefaults(): InstanceMetadataDefaults {
    const response = this.runner.call<{ AccountLevel?: Record<string, unknown> }>(
      'ec2',
      'get-instance-metadata-defaults'
    );
    const level = response?.AccountLevel ?? {};
    const optionalText = (member: string): string | undefined => {
      const value = level[member];
      if (value === undefined || value === null) return undefined;
      if (typeof value !== 'string') {
        throw new AwsCallError('ec2 get-instance-metadata-defaults', undefined, 'other', `malformed '${member}'`);
      }
      return value;
    };
    const hop = level['HttpPutResponseHopLimit'];
    if (hop !== undefined && hop !== null && typeof hop !== 'number') {
      throw new AwsCallError(
        'ec2 get-instance-metadata-defaults',
        undefined,
        'other',
        "malformed 'HttpPutResponseHopLimit'"
      );
    }
    const result: Record<string, string | number> = {};
    for (const member of [
      'HttpTokens',
      'HttpEndpoint',
      'InstanceMetadataTags',
      'HttpTokensEnforced',
      'ManagedBy',
      'ManagedExceptionMessage'
    ]) {
      const value = optionalText(member);
      if (value !== undefined) result[member] = value;
    }
    if (typeof hop === 'number') result['HttpPutResponseHopLimit'] = hop;
    return result as InstanceMetadataDefaults;
  }

  public getSnapshotBlockPublicAccessState(): BlockPublicAccessState {
    const response = this.runner.call<{ State?: unknown; ManagedBy?: string }>(
      'ec2',
      'get-snapshot-block-public-access-state'
    );
    return {
      state: text(response?.State, 'ec2 get-snapshot-block-public-access-state', 'State'),
      ...(response?.ManagedBy === undefined ? {} : { managedBy: response.ManagedBy })
    };
  }

  public listPublicSnapshotIds(): string[] {
    const response = this.runner.call<unknown>('ec2', 'describe-snapshots', [
      '--owner-ids',
      'self',
      '--restorable-by-user-ids',
      'all',
      '--query',
      'Snapshots[].SnapshotId'
    ]);
    return stringList(response, 'ec2 describe-snapshots', 'Snapshots[].SnapshotId');
  }

  public getImageBlockPublicAccessState(): BlockPublicAccessState {
    const response = this.runner.call<{ ImageBlockPublicAccessState?: unknown; ManagedBy?: string }>(
      'ec2',
      'get-image-block-public-access-state'
    );
    return {
      state: text(
        response?.ImageBlockPublicAccessState,
        'ec2 get-image-block-public-access-state',
        'ImageBlockPublicAccessState'
      ),
      ...(response?.ManagedBy === undefined ? {} : { managedBy: response.ManagedBy })
    };
  }

  public listPublicImageIds(): string[] {
    const response = this.runner.call<unknown>('ec2', 'describe-images', [
      '--owners',
      'self',
      '--filters',
      'Name=is-public,Values=true',
      '--query',
      'Images[].ImageId'
    ]);
    return stringList(response, 'ec2 describe-images', 'Images[].ImageId');
  }

  public dryRun(write: BaselineWrite): DryRunResult {
    if (write.kind === 'PutAccountPublicAccessBlock') return 'not-supported';
    const [command, args] = ec2WriteArgs(write);
    try {
      this.runner.call('ec2', command, [...args, '--dry-run']);
    } catch (error) {
      if (error instanceof DryRunAuthorized) return 'authorized';
      throw error;
    }
    // A DryRun request that "succeeds" without DryRunOperation is unexpected: fail closed.
    throw new AwsCallError(`ec2 ${command}`, undefined, 'other', 'DryRun request did not return DryRunOperation');
  }

  public write(write: BaselineWrite): void {
    if (write.kind === 'PutAccountPublicAccessBlock') {
      this.runner.call('s3control', 'put-public-access-block', [
        '--account-id',
        this.accountId,
        '--public-access-block-configuration',
        'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
      ]);
      return;
    }
    const [command, args] = ec2WriteArgs(write);
    this.runner.call('ec2', command, args);
  }
}

/** Runtime inventory over the existing Control Tower enrollment plan (management account, read-only). */
export class CliInventory implements InventoryPort {
  private readonly cli: AwsCli;

  public constructor(
    private readonly config: LandingZoneConfig,
    private readonly inputs: RuntimeInputs
  ) {
    this.cli = new AwsCli(config.aws.region);
  }

  public async snapshot(): Promise<InventorySnapshot> {
    const base = {
      managementAccountId: this.inputs.managementAccountId,
      organizationId: this.inputs.organizationId,
      partition: this.config.aws.partition,
      region: this.config.aws.region,
      auditAccountId: this.inputs.auditAccountId,
      logArchiveAccountId: this.inputs.logArchiveAccountId
    };
    const problems: string[] = [];
    const accounts: InventoryAccount[] = [];
    try {
      const plan = await buildEnrollmentPlan(this.cli, this.inputs, { configPrecheck: false });
      problems.push(...plan.problems);
      for (const target of plan.targets) {
        if (target.state.kind !== 'governed') {
          problems.push(`${target.target.ouPath}: Control Tower state is '${target.state.kind}', expected governed`);
        }
        for (const account of target.accounts) {
          accounts.push({
            key: account.key,
            name: account.name,
            accountId: account.accountId,
            ouPath: account.ouPath,
            ouId: target.ouId,
            enrolled: account.enrolled
          });
        }
      }
    } catch (error) {
      problems.push(`Control Tower and account inventory could not be read: ${(error as Error).message}`);
    }

    const suspendedAccounts: { accountId: string; name: string }[] = [];
    try {
      const port = createOrganizationsAccountPort(createOrganizationsClient(this.config.aws.region));
      const suspendedOuId = await resolveOuPath(port, await port.getRootId(), SUSPENDED_OU_PATH);
      const listed = this.cli.json<{ Accounts?: { Id?: string; Name?: string }[] }>([
        'organizations',
        'list-accounts-for-parent',
        '--parent-id',
        suspendedOuId
      ]).Accounts;
      if (!Array.isArray(listed)) throw new Error("ListAccountsForParent returned no 'Accounts' list");
      for (const account of listed) suspendedAccounts.push({ accountId: account.Id ?? '', name: account.Name ?? '' });
    } catch (error) {
      problems.push(`Suspended OU accounts could not be listed: ${(error as Error).message}`);
    }
    return { ...base, accounts, suspendedAccounts, problems };
  }

  public async accountStillEligible(accountId: string, ouId: string): Promise<string[]> {
    const problems: string[] = [];
    const account = this.cli.json<{ Account?: { State?: string; Status?: string } }>([
      'organizations',
      'describe-account',
      '--account-id',
      accountId
    ]).Account;
    const state = account?.State ?? account?.Status;
    if (state !== 'ACTIVE') problems.push(`account state is '${state ?? '<none>'}', not ACTIVE`);
    const parents = this.cli.json<{ Parents?: { Id?: string }[] }>([
      'organizations',
      'list-parents',
      '--child-id',
      accountId
    ]).Parents;
    if (parents?.length !== 1 || parents[0]?.Id !== ouId) {
      problems.push(`account parent is '${parents?.map((parent) => parent.Id).join(', ') ?? '<none>'}', not ${ouId}`);
    }
    return problems;
  }

  public openSession(accountId: string): MemberAccountPort {
    const response = this.cli.json<{
      Credentials?: { AccessKeyId?: string; SecretAccessKey?: string; SessionToken?: string };
    }>([
      'sts',
      'assume-role',
      '--role-arn',
      `arn:${this.config.aws.partition}:iam::${accountId}:role/${MEMBER_ACCESS_ROLE_NAME}`,
      '--role-session-name',
      `lz-account-baseline-${accountId}`.slice(0, 64),
      '--duration-seconds',
      String(MEMBER_SESSION_SECONDS)
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
    return new CliMemberAccount(accountId, this.config.aws.region, env);
  }
}
