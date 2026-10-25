/**
 * Common Account Security Baseline v1.0 - AWS access ports.
 *
 * `MemberAccountPort` is bound to ONE enforced member account (credentials of the established
 * cross-account role, `OrganizationAccountAccessRole`) and the home Region. Read methods return the
 * documented response members; "not configured" responses (`NoSuchPublicAccessBlockConfiguration`,
 * `NoSuchBucketPolicy`, `OwnershipControlsNotFoundError`, ...) come back as `undefined`. Every other
 * failure is thrown as `AwsCallError`.
 *
 * The write methods are the only mutations in the baseline and accept only the literal targets of
 * `BaselineWrite`. `dryRun` asks EC2 whether a write would be authorized (`DryRun`), without making
 * it; S3 Control has no dry-run, so S3 writes report `not-supported`.
 */

import type { BaselineWrite, S3PublicAccessBlockConfiguration } from './types.js';

export interface BucketSummary {
  readonly name: string;
  /** `BucketRegion` from `ListBuckets`, when the CLI returns it. */
  readonly region?: string;
}

export interface AclGrant {
  readonly granteeType?: string;
  readonly granteeUri?: string;
  readonly permission?: string;
}

export interface AccessPointDetails {
  readonly name: string;
  readonly publicAccessBlock?: S3PublicAccessBlockConfiguration;
}

export interface KmsKeyDetails {
  readonly arn: string;
  readonly keyManager: string;
  readonly keyState: string;
  readonly keySpec?: string;
  readonly aliases: readonly string[];
}

/** `GetInstanceMetadataDefaults` `AccountLevel`. Absent members mean "no preference". */
export interface InstanceMetadataDefaults {
  readonly HttpTokens?: string;
  readonly HttpPutResponseHopLimit?: number;
  readonly HttpEndpoint?: string;
  readonly InstanceMetadataTags?: string;
  readonly HttpTokensEnforced?: string;
  readonly ManagedBy?: string;
  readonly ManagedExceptionMessage?: string;
}

export interface BlockPublicAccessState {
  readonly state: string;
  readonly managedBy?: string;
}

export type DryRunResult = 'authorized' | 'not-supported';

export interface MemberAccountPort {
  readonly accountId: string;

  /** `sts get-caller-identity` with the member credentials. */
  callerIdentity(): { readonly Account?: string; readonly Arn?: string };

  // S3 account-level Block Public Access and public-exposure inventory.
  getAccountPublicAccessBlock(): S3PublicAccessBlockConfiguration | undefined;
  listBuckets(): readonly BucketSummary[];
  /** `PolicyStatus.IsPublic`; `undefined` when the bucket has no policy. */
  getBucketPolicyStatus(bucket: string): boolean | undefined;
  getBucketAcl(bucket: string): readonly AclGrant[];
  /** Object ownership rule; `undefined` when no ownership controls exist (ACLs enabled). */
  getBucketObjectOwnership(bucket: string): string | undefined;
  getBucketPublicAccessBlock(bucket: string): S3PublicAccessBlockConfiguration | undefined;
  listAccessPoints(): readonly string[];
  getAccessPoint(name: string): AccessPointDetails;
  /** `PolicyStatus.IsPublic`; `undefined` when the access point has no policy. */
  getAccessPointPolicyStatus(name: string): boolean | undefined;

  // EBS encryption by default.
  getEbsEncryptionByDefault(): boolean;
  getEbsDefaultKmsKeyId(): string;
  describeKmsKey(keyId: string): KmsKeyDetails;

  // EC2 instance metadata defaults.
  getInstanceMetadataDefaults(): InstanceMetadataDefaults;

  // EBS snapshot and AMI Block Public Access.
  getSnapshotBlockPublicAccessState(): BlockPublicAccessState;
  /** IDs of snapshots owned by the account that are restorable by everyone. */
  listPublicSnapshotIds(): readonly string[];
  getImageBlockPublicAccessState(): BlockPublicAccessState;
  /** IDs of AMIs owned by the account that are public. */
  listPublicImageIds(): readonly string[];

  /** Read-only authorization probe for an EC2 write. Throws `AwsCallError` when not authorized. */
  dryRun(write: BaselineWrite): DryRunResult;
  /** MUTATING. Performs exactly one allow-listed write. */
  write(write: BaselineWrite): void;
}

/** One configured Landing Zone account as resolved live. */
export interface InventoryAccount {
  readonly key: string;
  readonly name: string;
  readonly accountId: string;
  readonly ouPath: string;
  readonly ouId: string;
  /** Control Tower child enabled baseline SUCCEEDED for this account. */
  readonly enrolled: boolean;
}

export interface InventorySnapshot {
  readonly managementAccountId: string;
  readonly organizationId: string;
  readonly partition: string;
  readonly region: string;
  readonly auditAccountId: string;
  readonly logArchiveAccountId: string;
  /** Configured Landing Zone accounts, resolved live (ACTIVE, configured name, email and OU). */
  readonly accounts: readonly InventoryAccount[];
  /** Accounts found live in the Suspended OU. */
  readonly suspendedAccounts: readonly { readonly accountId: string; readonly name: string }[];
  /** Anything that blocks the baseline: identity, organization, Landing Zone, enrollment, handoffs. */
  readonly problems: readonly string[];
}

export interface InventoryPort {
  /** READ-ONLY. Full live inventory and Control Tower health. */
  snapshot(): Promise<InventorySnapshot>;
  /** READ-ONLY. Re-checks one account right before a write: ACTIVE and still in `ouId`. */
  accountStillEligible(accountId: string, ouId: string): Promise<string[]>;
  /** Opens a member session for an enforced account (assumes the established cross-account role). */
  openSession(accountId: string): MemberAccountPort;
}

export interface BaselineClock {
  now(): number;
  sleep(seconds: number): Promise<void>;
}
