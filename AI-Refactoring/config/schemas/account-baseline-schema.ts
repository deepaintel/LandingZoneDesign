import { z } from 'zod';

/**
 * Common Account Security Baseline v1.0 configuration schema.
 *
 * Governed by `.apm/skills/common-account-baseline/SKILL.md`. This file owns the configuration contract of the
 * five enable-only account-level controls the `reconcile-account-baseline` action applies to the
 * eligible Landing Zone accounts of each environment:
 *
 *  - every control target is a LITERAL. v1.0 has exactly one approved target per control, so a
 *    weaker value (for example `block-new-sharing` for snapshots or `optional` for IMDS tokens) is a
 *    schema error, never a configuration choice. Disabling a control is a deliberate schema change;
 *  - the approved default EBS KMS key is the AWS managed `alias/aws/ebs` key only. No customer
 *    managed key is approved (`control-tower-initialization.instructions.md` §14.3), so none can be
 *    listed;
 *  - the excluded account roles (Management, Audit, Log Archive) and OU roots (Security, Suspended)
 *    are fixed sets: removing an exclusion fails validation;
 *  - `expectedEnforcedAccountCount` is REQUIRED per environment with no default. It must equal the
 *    number of configured eligible accounts, so a change of scope needs a deliberate, reviewed edit of
 *    both the inventory and the expectation;
 *  - `exceptions` must stay empty. No exception-management policy is approved for v1.0: a
 *    REQUIRES_APPROVAL result always blocks the release. The entry shape below is the PROPOSED
 *    schema for a future approved policy; accepting entries requires an approved schema change.
 */

/** The five v1.0 controls, in the order they are planned, applied and reported. */
export const ACCOUNT_BASELINE_CONTROL_IDS = [
  's3-account-public-access-block',
  'ebs-encryption-by-default',
  'ec2-imds-defaults',
  'ebs-snapshot-block-public-access',
  'ec2-image-block-public-access'
] as const;
export type AccountBaselineControlId = (typeof ACCOUNT_BASELINE_CONTROL_IDS)[number];

/** Account roles never enforced by v1.0. `management` is `aws.accountId`; the others are the shared accounts. */
export const ACCOUNT_BASELINE_EXCLUDED_ACCOUNT_ROLES = ['management', 'audit', 'logArchive'] as const;
export type AccountBaselineExcludedRole = (typeof ACCOUNT_BASELINE_EXCLUDED_ACCOUNT_ROLES)[number];

/** OU path roots whose accounts are never enforced by v1.0. */
export const ACCOUNT_BASELINE_EXCLUDED_OU_ROOTS = ['Security', 'Suspended'] as const;

/** Environments approved for the account baseline. Any other environment fails closed. */
export const ACCOUNT_BASELINE_ENVIRONMENTS = ['staging', 'production'] as const;
export type AccountBaselineEnvironment = (typeof ACCOUNT_BASELINE_ENVIRONMENTS)[number];

/** Alias of the AWS managed EBS key. The only approved default EBS KMS key in v1.0. */
export const AWS_MANAGED_EBS_KEY_ALIAS = 'alias/aws/ebs';

function exactSet<T extends string>(values: readonly T[], label: string) {
  return z.array(z.enum(values as unknown as [T, ...T[]])).superRefine((entries, context) => {
    const seen = new Set(entries);
    if (seen.size !== entries.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must not repeat an entry` });
    }
    for (const value of values) {
      if (!seen.has(value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} must include '${value}'; v1.0 exclusions cannot be removed`
        });
      }
    }
  });
}

const s3AccountPublicAccessBlockSchema = z
  .object({
    enabled: z.literal(true),
    blockPublicAcls: z.literal(true),
    ignorePublicAcls: z.literal(true),
    blockPublicPolicy: z.literal(true),
    restrictPublicBuckets: z.literal(true)
  })
  .strict();

const ebsEncryptionByDefaultSchema = z
  .object({
    enabled: z.literal(true),
    approvedDefaultKmsKeys: z
      .array(z.literal(AWS_MANAGED_EBS_KEY_ALIAS))
      .length(1, `only '${AWS_MANAGED_EBS_KEY_ALIAS}' is approved as the default EBS KMS key in v1.0`)
  })
  .strict();

const ec2ImdsDefaultsSchema = z
  .object({
    enabled: z.literal(true),
    httpTokens: z.literal('required'),
    httpPutResponseHopLimit: z.literal(2)
  })
  .strict();

const ebsSnapshotBlockPublicAccessSchema = z
  .object({ enabled: z.literal(true), state: z.literal('block-all-sharing') })
  .strict();

const ec2ImageBlockPublicAccessSchema = z
  .object({ enabled: z.literal(true), state: z.literal('block-new-sharing') })
  .strict();

/**
 * PROPOSED exception entry, pending an approved exception-management policy. Validated for shape so
 * the proposal is concrete, but `exceptions` itself accepts no entries in v1.0.
 */
export const accountBaselineExceptionSchema = z
  .object({
    id: z.string().regex(/^ABX-[0-9]{4}$/, 'must look like ABX-0001'),
    environment: z.enum(ACCOUNT_BASELINE_ENVIRONMENTS),
    accountKey: z.string().min(1),
    control: z.enum(ACCOUNT_BASELINE_CONTROL_IDS),
    approver: z.string().min(3),
    reason: z.string().min(10),
    expiresOn: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, 'must be an ISO date (YYYY-MM-DD)')
  })
  .strict();

export const accountBaselineSchema = z
  .object({
    controls: z
      .object({
        s3AccountPublicAccessBlock: s3AccountPublicAccessBlockSchema,
        ebsEncryptionByDefault: ebsEncryptionByDefaultSchema,
        ec2ImdsDefaults: ec2ImdsDefaultsSchema,
        ebsSnapshotBlockPublicAccess: ebsSnapshotBlockPublicAccessSchema,
        ec2ImageBlockPublicAccess: ec2ImageBlockPublicAccessSchema
      })
      .strict(),
    excludedAccountRoles: exactSet(ACCOUNT_BASELINE_EXCLUDED_ACCOUNT_ROLES, 'accountBaseline.excludedAccountRoles'),
    excludedOuRoots: exactSet(ACCOUNT_BASELINE_EXCLUDED_OU_ROOTS, 'accountBaseline.excludedOuRoots'),
    expectedEnforcedAccountCount: z.number().int().positive(),
    exceptions: z
      .array(accountBaselineExceptionSchema)
      .max(
        0,
        'exception management is not approved for Common Account Security Baseline v1.0; ' +
          'REQUIRES_APPROVAL results remain release-blocking'
      )
  })
  .strict();

export type AccountBaselineConfig = z.infer<typeof accountBaselineSchema>;
export type AccountBaselineException = z.infer<typeof accountBaselineExceptionSchema>;

/** Accepts exactly the approved environments; anything else fails closed. */
export function assertAccountBaselineEnvironment(environment: string): AccountBaselineEnvironment {
  if (!(ACCOUNT_BASELINE_ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new Error(
      `The account baseline supports only ${ACCOUNT_BASELINE_ENVIRONMENTS.join(' and ')}; refusing environment '${environment}'.`
    );
  }
  return environment as AccountBaselineEnvironment;
}

/** True when `ouPath` is at or below an excluded OU root. */
export function isExcludedOuPath(ouPath: string): boolean {
  const root = ouPath.split('/')[0] ?? '';
  return (ACCOUNT_BASELINE_EXCLUDED_OU_ROOTS as readonly string[]).includes(root);
}
