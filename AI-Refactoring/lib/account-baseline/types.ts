/**
 * Common Account Security Baseline v1.0 - shared types.
 *
 * Governed by `.apm/skills/common-account-baseline/SKILL.md`. Everything in
 * `lib/account-baseline/` is pure: AWS access goes through the `MemberAccountPort` /
 * `InventoryPort` interfaces, implemented over the AWS CLI by `scripts/account-baseline-runtime.ts`
 * and by in-memory fakes in the tests.
 *
 * `BaselineWrite` is the COMPLETE allow-list of AWS write operations this baseline may perform. Each
 * member carries a literal target value, so a disabling, downgrading or key-changing request cannot
 * be expressed. `DisableEbsEncryptionByDefault`, `ModifyEbsDefaultKmsKeyId`,
 * `ResetEbsDefaultKmsKeyId`, `DeletePublicAccessBlock`, `DisableSnapshotBlockPublicAccess` and
 * `DisableImageBlockPublicAccess` have no representation here and no adapter method.
 */

import type {
  AccountBaselineControlId,
  AccountBaselineEnvironment
} from '../../config/schemas/account-baseline-schema.js';

export type { AccountBaselineControlId, AccountBaselineEnvironment };

/** Every status a result row can carry. */
export const RESULT_STATUSES = [
  'COMPLIANT',
  'NON_COMPLIANT',
  'REQUIRES_APPROVAL',
  'EXCLUDED',
  'UNSUPPORTED',
  'ERROR',
  'NOT_ASSESSED'
] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

/** Statuses a control assessment of an enforced account can produce. */
export type AssessedStatus = 'COMPLIANT' | 'NON_COMPLIANT' | 'REQUIRES_APPROVAL' | 'UNSUPPORTED' | 'ERROR';

/** Account-level S3 Block Public Access configuration (`s3control` member names). */
export interface S3PublicAccessBlockConfiguration {
  readonly BlockPublicAcls: boolean;
  readonly IgnorePublicAcls: boolean;
  readonly BlockPublicPolicy: boolean;
  readonly RestrictPublicBuckets: boolean;
}

/** The only configuration the baseline ever writes: every setting `true`, as literal types. */
export interface AllS3PublicAccessBlocks extends S3PublicAccessBlockConfiguration {
  readonly BlockPublicAcls: true;
  readonly IgnorePublicAcls: true;
  readonly BlockPublicPolicy: true;
  readonly RestrictPublicBuckets: true;
}

export const ALL_S3_PUBLIC_ACCESS_BLOCKS: AllS3PublicAccessBlocks = {
  BlockPublicAcls: true,
  IgnorePublicAcls: true,
  BlockPublicPolicy: true,
  RestrictPublicBuckets: true
};

/** The complete allow-list of baseline writes. Literal values only. */
export type BaselineWrite =
  | { readonly kind: 'PutAccountPublicAccessBlock'; readonly configuration: AllS3PublicAccessBlocks }
  | { readonly kind: 'EnableEbsEncryptionByDefault' }
  | { readonly kind: 'ModifyInstanceMetadataDefaults'; readonly field: 'HttpTokens'; readonly value: 'required' }
  | { readonly kind: 'ModifyInstanceMetadataDefaults'; readonly field: 'HttpPutResponseHopLimit'; readonly value: 2 }
  | { readonly kind: 'EnableSnapshotBlockPublicAccess'; readonly state: 'block-all-sharing' }
  | { readonly kind: 'EnableImageBlockPublicAccess'; readonly state: 'block-new-sharing' };

export function describeWrite(write: BaselineWrite): string {
  switch (write.kind) {
    case 'PutAccountPublicAccessBlock':
      return 'PutPublicAccessBlock (account) all four settings true';
    case 'EnableEbsEncryptionByDefault':
      return 'EnableEbsEncryptionByDefault (default KMS key unchanged)';
    case 'ModifyInstanceMetadataDefaults':
      return `ModifyInstanceMetadataDefaults ${write.field}=${String(write.value)}`;
    case 'EnableSnapshotBlockPublicAccess':
      return `EnableSnapshotBlockPublicAccess ${write.state}`;
    case 'EnableImageBlockPublicAccess':
      return `EnableImageBlockPublicAccess ${write.state}`;
  }
}

/** The result of assessing one control in one enforced account. */
export interface ControlAssessment {
  readonly control: AccountBaselineControlId;
  readonly status: AssessedStatus;
  /** Human-readable current configuration. */
  readonly observed: string;
  /** Human-readable required configuration. */
  readonly required: string;
  /** The safe enable-only writes that reach `required`. Non-empty exactly when `NON_COMPLIANT`. */
  readonly writes: readonly BaselineWrite[];
  readonly reasons: readonly string[];
  /** Canonical JSON of the observation; equal fingerprints mean an unchanged precondition. */
  readonly fingerprint: string;
}

/** One configured or excluded account in the expected enforcement matrix. */
export interface MatrixAccount {
  readonly key: string;
  readonly name: string;
  readonly accountId: string;
  readonly ouPath: string;
}

export interface ExcludedAccount extends MatrixAccount {
  readonly reason: string;
}

/** The expected account x control matrix of one environment, derived from configuration and live inventory. */
export interface ExpectedMatrix {
  readonly environment: AccountBaselineEnvironment;
  readonly controls: readonly AccountBaselineControlId[];
  readonly enforcedAccounts: readonly MatrixAccount[];
  readonly excludedAccounts: readonly ExcludedAccount[];
  /** Configured `accountBaseline.expectedEnforcedAccountCount`. */
  readonly expectedEnforcedAccountCount: number;
}

/** One row of the compliance report: exactly one per expected account and control. */
export interface BaselineResultRow {
  readonly environment: AccountBaselineEnvironment;
  readonly accountKey: string;
  readonly accountName: string;
  readonly accountId: string;
  readonly ouPath: string;
  readonly control: AccountBaselineControlId;
  readonly enforcement: 'enforced' | 'excluded';
  readonly status: ResultStatus;
  /** Configuration before this run (first observation recorded by the run). */
  readonly previous: string;
  readonly required: string;
  /** Configuration observed by this phase. */
  readonly observed: string;
  readonly plannedWrites: readonly BaselineWrite[];
  readonly performedWrites: readonly BaselineWrite[];
  readonly reason: string;
}

/** Error categories the controls map to result statuses. */
export type AwsFailureKind = 'unsupported' | 'access-denied' | 'timeout' | 'throttled' | 'not-found' | 'other';

/**
 * A failed AWS call. `code` is the AWS error code when the CLI reported one. Expected "not
 * configured" responses (for example `NoSuchPublicAccessBlockConfiguration`) never surface as
 * errors: the adapter returns `undefined` for them.
 */
export class AwsCallError extends Error {
  public constructor(
    public readonly operation: string,
    public readonly code: string | undefined,
    public readonly kind: AwsFailureKind,
    message: string
  ) {
    super(message);
    this.name = 'AwsCallError';
  }
}

/** Codes meaning the operation or parameter is not available (for example in the EUSC Region). */
export const UNSUPPORTED_ERROR_CODES = [
  'UnsupportedOperation',
  'UnsupportedOperationException',
  'InvalidAction',
  'UnknownOperationException',
  'NotImplemented',
  'OperationNotSupportedException'
] as const;

/** Codes meaning the caller is not authorized or not authenticated. */
export const ACCESS_DENIED_ERROR_CODES = [
  'AccessDenied',
  'AccessDeniedException',
  'UnauthorizedOperation',
  'AuthFailure',
  'InvalidClientTokenId',
  'UnrecognizedClientException',
  'ExpiredToken',
  'ExpiredTokenException'
] as const;

export const THROTTLING_ERROR_CODES = [
  'Throttling',
  'ThrottlingException',
  'RequestLimitExceeded',
  'TooManyRequestsException',
  'SlowDown'
] as const;

/** Classifies an AWS error code (and, for local CLI failures, the message text). */
export function classifyAwsFailure(code: string | undefined, text: string): AwsFailureKind {
  if (code !== undefined) {
    if ((UNSUPPORTED_ERROR_CODES as readonly string[]).includes(code)) return 'unsupported';
    if ((ACCESS_DENIED_ERROR_CODES as readonly string[]).includes(code)) return 'access-denied';
    if ((THROTTLING_ERROR_CODES as readonly string[]).includes(code)) return 'throttled';
    if (/NotFound|NoSuch/.test(code)) return 'not-found';
    return 'other';
  }
  // The local AWS CLI rejects commands or parameters its service model does not know.
  if (/Invalid choice|Unknown options|Unknown parameter/i.test(text)) return 'unsupported';
  if (/ETIMEDOUT|timed out|Connect timeout|Read timeout/i.test(text)) return 'timeout';
  return 'other';
}

/** Extracts the AWS error code from AWS CLI stderr: `An error occurred (Code) when calling ...`. */
export function awsErrorCode(text: string): string | undefined {
  return /An error occurred \(([A-Za-z0-9.]+)\)/.exec(text)?.[1];
}
