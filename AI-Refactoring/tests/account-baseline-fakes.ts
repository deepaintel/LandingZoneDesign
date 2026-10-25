/**
 * In-memory AWS fakes for the Common Account Security Baseline tests. No AWS API is ever called:
 * every member account is a mutable object whose writes are counted, and failures are injected per
 * operation.
 */

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema, type LandingZoneConfig } from '../config/schemas/organization-schema.js';
import { emptyLedger, type BaselineLedger, type LedgerStore } from '../lib/account-baseline/ledger.js';
import type {
  AccessPointDetails,
  AclGrant,
  BaselineClock,
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
  type AccountBaselineEnvironment,
  type BaselineWrite,
  type S3PublicAccessBlockConfiguration
} from '../lib/account-baseline/types.js';

export const AUDIT = '333333333333';
export const LOG_ARCHIVE = '444444444444';
export const ORGANIZATION_ID = 'o-abcdefghij';
export const AWS_EBS_KEY_ARN = 'arn:aws-eusc:kms:eusc-de-east-1:200000000001:key/11111111-2222-3333-4444-555555555555';
export const CUSTOMER_KEY_ARN = 'arn:aws-eusc:kms:eusc-de-east-1:200000000001:key/99999999-8888-7777-6666-555555555555';

export function loadConfig(environment: AccountBaselineEnvironment): LandingZoneConfig {
  return new ConfigReader(environment, { configDirName: 'config', schema: LandingZoneSchema }).getConfig();
}

export interface FakeBucket {
  name: string;
  region?: string;
  policyIsPublic?: boolean;
  grants?: AclGrant[];
  objectOwnership?: string;
  block?: S3PublicAccessBlockConfiguration;
}

export interface FakeAccountState {
  s3?: S3PublicAccessBlockConfiguration;
  buckets: FakeBucket[];
  accessPoints: { name: string; policyIsPublic?: boolean; block?: S3PublicAccessBlockConfiguration }[];
  ebsEnabled: boolean;
  ebsKeyId: string;
  keys: Record<string, KmsKeyDetails>;
  imds: InstanceMetadataDefaults;
  snapshot: BlockPublicAccessState;
  publicSnapshots: string[];
  image: BlockPublicAccessState;
  publicImages: string[];
}

export function defaultState(): FakeAccountState {
  return {
    buckets: [{ name: 'cdk-assets', objectOwnership: 'BucketOwnerEnforced', grants: [] }],
    accessPoints: [],
    ebsEnabled: false,
    ebsKeyId: 'alias/aws/ebs',
    keys: {},
    imds: { ManagedBy: 'account' },
    snapshot: { state: 'unblocked', managedBy: 'account' },
    publicSnapshots: [],
    image: { state: 'unblocked', managedBy: 'account' },
    publicImages: []
  };
}

export function compliantState(): FakeAccountState {
  return {
    ...defaultState(),
    s3: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true },
    ebsEnabled: true,
    imds: { HttpTokens: 'required', HttpPutResponseHopLimit: 2, ManagedBy: 'account' },
    snapshot: { state: 'block-all-sharing', managedBy: 'account' },
    image: { state: 'block-new-sharing', managedBy: 'account' }
  };
}

type Operation = keyof MemberAccountPort;

export class FakeMemberAccount implements MemberAccountPort {
  public readonly writes: BaselineWrite[] = [];
  public readonly dryRuns: BaselineWrite[] = [];
  /** Failures injected per operation; thrown on every call while present. */
  public readonly failures = new Map<Operation, AwsCallError>();
  /** Failures injected for one write kind. */
  public readonly writeFailures = new Map<BaselineWrite['kind'], AwsCallError>();
  /** Number of reads of the AMI state that still report the old value after a write. */
  public imageLag = 0;
  public identityArn: string | undefined;

  public constructor(
    public readonly accountId: string,
    public state: FakeAccountState = defaultState()
  ) {}

  private guard(operation: Operation): void {
    const failure = this.failures.get(operation);
    if (failure !== undefined) throw failure;
  }

  public callerIdentity(): { Account?: string; Arn?: string } {
    this.guard('callerIdentity');
    return {
      Account: this.accountId,
      Arn:
        this.identityArn ??
        `arn:aws-eusc:sts::${this.accountId}:assumed-role/OrganizationAccountAccessRole/lz-account-baseline`
    };
  }

  public getAccountPublicAccessBlock(): S3PublicAccessBlockConfiguration | undefined {
    this.guard('getAccountPublicAccessBlock');
    return this.state.s3 === undefined ? undefined : { ...this.state.s3 };
  }

  public listBuckets(): BucketSummary[] {
    this.guard('listBuckets');
    return this.state.buckets.map((bucket) => ({
      name: bucket.name,
      ...(bucket.region === undefined ? {} : { region: bucket.region })
    }));
  }

  private bucket(name: string): FakeBucket {
    const bucket = this.state.buckets.find((candidate) => candidate.name === name);
    if (bucket === undefined) throw new AwsCallError('s3api', 'NoSuchBucket', 'not-found', name);
    return bucket;
  }

  public getBucketPolicyStatus(bucket: string): boolean | undefined {
    this.guard('getBucketPolicyStatus');
    return this.bucket(bucket).policyIsPublic;
  }

  public getBucketAcl(bucket: string): AclGrant[] {
    this.guard('getBucketAcl');
    return this.bucket(bucket).grants ?? [];
  }

  public getBucketObjectOwnership(bucket: string): string | undefined {
    this.guard('getBucketObjectOwnership');
    return this.bucket(bucket).objectOwnership;
  }

  public getBucketPublicAccessBlock(bucket: string): S3PublicAccessBlockConfiguration | undefined {
    this.guard('getBucketPublicAccessBlock');
    return this.bucket(bucket).block;
  }

  public listAccessPoints(): string[] {
    this.guard('listAccessPoints');
    return this.state.accessPoints.map((point) => point.name);
  }

  public getAccessPoint(name: string): AccessPointDetails {
    this.guard('getAccessPoint');
    const point = this.state.accessPoints.find((candidate) => candidate.name === name);
    return point?.block === undefined ? { name } : { name, publicAccessBlock: point.block };
  }

  public getAccessPointPolicyStatus(name: string): boolean | undefined {
    this.guard('getAccessPointPolicyStatus');
    return this.state.accessPoints.find((candidate) => candidate.name === name)?.policyIsPublic;
  }

  public getEbsEncryptionByDefault(): boolean {
    this.guard('getEbsEncryptionByDefault');
    return this.state.ebsEnabled;
  }

  public getEbsDefaultKmsKeyId(): string {
    this.guard('getEbsDefaultKmsKeyId');
    return this.state.ebsKeyId;
  }

  public describeKmsKey(keyId: string): KmsKeyDetails {
    this.guard('describeKmsKey');
    const key = this.state.keys[keyId];
    if (key === undefined)
      throw new AwsCallError('kms describe-key', 'NotFoundException', 'not-found', `${keyId} not found`);
    return key;
  }

  public getInstanceMetadataDefaults(): InstanceMetadataDefaults {
    this.guard('getInstanceMetadataDefaults');
    return { ...this.state.imds };
  }

  public getSnapshotBlockPublicAccessState(): BlockPublicAccessState {
    this.guard('getSnapshotBlockPublicAccessState');
    return { ...this.state.snapshot };
  }

  public listPublicSnapshotIds(): string[] {
    this.guard('listPublicSnapshotIds');
    return [...this.state.publicSnapshots];
  }

  public getImageBlockPublicAccessState(): BlockPublicAccessState {
    this.guard('getImageBlockPublicAccessState');
    if (this.imageLag > 0 && this.pendingImageState !== undefined) {
      this.imageLag -= 1;
      return { ...this.state.image };
    }
    if (this.pendingImageState !== undefined) {
      this.state.image = { ...this.state.image, state: this.pendingImageState };
      this.pendingImageState = undefined;
    }
    return { ...this.state.image };
  }

  private pendingImageState: string | undefined;

  public listPublicImageIds(): string[] {
    this.guard('listPublicImageIds');
    return [...this.state.publicImages];
  }

  public dryRun(write: BaselineWrite): DryRunResult {
    this.guard('dryRun');
    this.dryRuns.push(write);
    return write.kind === 'PutAccountPublicAccessBlock' ? 'not-supported' : 'authorized';
  }

  public write(write: BaselineWrite): void {
    this.guard('write');
    const failure = this.writeFailures.get(write.kind);
    if (failure !== undefined) throw failure;
    this.writes.push(write);
    switch (write.kind) {
      case 'PutAccountPublicAccessBlock':
        this.state.s3 = { ...write.configuration };
        return;
      case 'EnableEbsEncryptionByDefault':
        this.state.ebsEnabled = true;
        return;
      case 'ModifyInstanceMetadataDefaults':
        this.state.imds =
          write.field === 'HttpTokens'
            ? { ...this.state.imds, HttpTokens: write.value }
            : { ...this.state.imds, HttpPutResponseHopLimit: write.value };
        return;
      case 'EnableSnapshotBlockPublicAccess':
        this.state.snapshot = { ...this.state.snapshot, state: write.state };
        return;
      case 'EnableImageBlockPublicAccess':
        this.pendingImageState = write.state;
        return;
    }
  }
}

export interface FakeEnvironment {
  readonly environment: AccountBaselineEnvironment;
  readonly config: LandingZoneConfig;
  readonly accounts: Map<string, FakeMemberAccount>;
  readonly inventory: FakeInventory;
  readonly ledger: { current: BaselineLedger };
  readonly ledgers: LedgerStore;
  readonly clock: FakeClock;
}

export class FakeClock implements BaselineClock {
  public constructor(public nowMs = Date.parse('2026-10-20T08:00:00.000Z')) {}
  public now(): number {
    return this.nowMs;
  }
  public async sleep(seconds: number): Promise<void> {
    this.nowMs += seconds * 1000;
  }
}

export class FakeInventory implements InventoryPort {
  public problems: string[] = [];
  public snapshotOverride: ((snapshot: InventorySnapshot) => InventorySnapshot) | undefined;
  public ineligible = new Map<string, string[]>();
  public sessionFailures = new Set<string>();
  public readonly opened: string[] = [];
  public suspended: { accountId: string; name: string }[] = [{ accountId: '555555555555', name: 'Retired-01' }];

  public constructor(
    private readonly config: LandingZoneConfig,
    public readonly accounts: Map<string, FakeMemberAccount>,
    public readonly live: InventoryAccount[]
  ) {}

  public async snapshot(): Promise<InventorySnapshot> {
    const snapshot: InventorySnapshot = {
      managementAccountId: this.config.aws.accountId,
      organizationId: ORGANIZATION_ID,
      partition: this.config.aws.partition,
      region: this.config.aws.region,
      auditAccountId: AUDIT,
      logArchiveAccountId: LOG_ARCHIVE,
      accounts: this.live.map((account) => ({ ...account })),
      suspendedAccounts: [...this.suspended],
      problems: [...this.problems]
    };
    return this.snapshotOverride === undefined ? snapshot : this.snapshotOverride(snapshot);
  }

  public async accountStillEligible(accountId: string): Promise<string[]> {
    return this.ineligible.get(accountId) ?? [];
  }

  public openSession(accountId: string): MemberAccountPort {
    this.opened.push(accountId);
    if (this.sessionFailures.has(accountId)) {
      throw new AwsCallError(
        'sts assume-role',
        'AccessDenied',
        'access-denied',
        `not authorized to assume role in ${accountId}`
      );
    }
    const account = this.accounts.get(accountId);
    if (account === undefined) throw new Error(`no fake account ${accountId}`);
    return account;
  }
}

/** A fake environment whose live inventory exactly matches the configured `landingZoneAccounts`. */
export function fakeEnvironment(
  environment: AccountBaselineEnvironment,
  state: () => FakeAccountState = defaultState
): FakeEnvironment {
  const config = loadConfig(environment);
  const accounts = new Map<string, FakeMemberAccount>();
  const live: InventoryAccount[] = Object.entries(config.landingZoneAccounts).map(([key, account], index) => {
    const accountId = `2000000001${String(index).padStart(2, '0')}`;
    accounts.set(accountId, new FakeMemberAccount(accountId, state()));
    return {
      key,
      name: account.name,
      accountId,
      ouPath: account.ouPath,
      ouId: `ou-ab12-${String(index).padStart(8, '0')}`,
      enrolled: true
    };
  });
  const ledger = { current: emptyLedger(environment) };
  return {
    environment,
    config,
    accounts,
    inventory: new FakeInventory(config, accounts, live),
    ledger,
    ledgers: {
      read: () => JSON.parse(JSON.stringify(ledger.current)) as BaselineLedger,
      write: (next) => {
        ledger.current = JSON.parse(JSON.stringify(next)) as BaselineLedger;
      }
    },
    clock: new FakeClock()
  };
}

export function totalWrites(env: FakeEnvironment): number {
  return [...env.accounts.values()].reduce((total, account) => total + account.writes.length, 0);
}
