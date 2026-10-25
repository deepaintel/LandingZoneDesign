import { z } from 'zod';

/**
 * AWS Control Tower Landing Zone 4.0 configuration schema.
 *
 * Governed by `.apm/skills/initialize-control-tower/SKILL.md`. This file owns the ENVIRONMENT-INVARIANT shape
 * of the Landing Zone 4.0 manifest and the constants the initialiser, manifest builder and
 * validators must agree on.
 *
 *  - `version` and the single governed Region are literals - the manifest builder and the
 *    initializer's `--landing-zone-version 4.0` argument stay in lock-step;
 *  - every service integration carries an EXPLICIT `enabled` boolean; there are no implicit
 *    defaults;
 *  - both `centralizedLogging.configurations` and `config.configurations` share ONE Zod schema
 *    (`controlTowerConfigurationsSchema`) so their shape - `loggingBucket.retentionDays`,
 *    `accessLoggingBucket.retentionDays`, and the optional `kmsKeyArn` - can never drift;
 *  - `kmsKeyArn` on both integration `configurations` blocks is OPTIONAL, matching the LZ 4.0
 *    manifest schema. AWS Control Tower applies its standard/default encryption configuration
 *    when omitted; a customer-managed key is only required when governance explicitly asks;
 *  - `backup.enabled` is locked to `false`; enabling AWS Backup requires an
 *    approved schema change;
 *  - Landing Zone 4.0 DEPENDENCY RULE: if `config.enabled` is false, none of `securityRoles`,
 *    `accessManagement` or `backup` may be enabled (AWS Config is a prerequisite for those
 *    integrations; enabling them without Config would be rejected server-side at
 *    `CreateLandingZone` time). Enforced by the `superRefine` below.
 *
 * Shared-account IDs are DELIBERATELY absent from this schema. Audit and Log Archive account IDs
 * are resolved at deployment time from the `AccountIdAudit` / `AccountIdLogArchive` outputs of the
 * deployed `lz-shared-accounts` CloudFormation stack (Path A), then passed explicitly to the
 * initializer as CLI inputs. Persisting the generated IDs into environment YAML solely for
 * Control Tower initialization is disallowed; see the Path A contract in the initialization and
 * account-provisioning skills.
 */

const ESC_REGION = 'eusc-de-east-1';

/**
 * Approved AWS Control Tower Landing Zone version for this repository. Governed by
 * `.apm/skills/initialize-control-tower/SKILL.md`. Any change to this literal
 * is a deliberate schema-level decision that must be reviewed together with the manifest builder
 * and the initializer's `--landing-zone-version` argument.
 */
const CONTROL_TOWER_LANDING_ZONE_VERSION = '4.0';

/**
 * AWS ESC KMS key ARN. The ESC partition (`aws-eusc`) and Region (`eusc-de-east-1`) are locked;
 * the account segment is left as a 12-digit match rather than a wildcard so a commercial-partition
 * ARN cannot slip through by accident.
 */
const ESC_KMS_KEY_ARN_PATTERN = /^arn:aws-eusc:kms:eusc-de-east-1:[0-9]{12}:key\/[A-Za-z0-9-]+$/;

/** 12-digit AWS account ID guard. Shared by the manifest builder and the initializer CLI. */
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;

/**
 * Landing Zone 4.0 integration `configurations` sub-block. Structurally identical on both
 * `centralizedLogging.configurations` and `config.configurations` per the LZ 4.0 API. Extracted
 * as a single schema so the two integration blocks cannot drift out of sync.
 *
 * `loggingBucket.retentionDays` and `accessLoggingBucket.retentionDays` control the S3 lifecycle
 * of the integration-owned buckets in the Log Archive account.
 *
 * `kmsKeyArn` is OPTIONAL. AWS Control Tower applies its standard/default encryption
 * configuration when `kmsKeyArn` is omitted; a customer-managed key is only required when
 * project governance explicitly asks for one. The pattern locks the ESC partition and Region.
 */
const controlTowerConfigurationsSchema = z
  .object({
    loggingBucket: z.object({ retentionDays: z.number().int().positive() }).strict().optional(),
    accessLoggingBucket: z.object({ retentionDays: z.number().int().positive() }).strict().optional(),
    kmsKeyArn: z.string().regex(ESC_KMS_KEY_ARN_PATTERN, 'must be an aws-eusc:kms:eusc-de-east-1 key ARN').optional()
  })
  .strict();

const controlTowerCentralizedLoggingSchema = z
  .object({
    enabled: z.boolean(),
    configurations: controlTowerConfigurationsSchema.optional()
  })
  .strict();

const controlTowerConfigSchema = z
  .object({
    enabled: z.boolean(),
    configurations: controlTowerConfigurationsSchema.optional()
  })
  .strict();

/**
 * OU path roots that must never be enrollment targets. `Security` holds the Landing Zone 4.0
 * service-integration accounts (Audit, Log Archive), where `AWSControlTowerBaseline` is not
 * applicable. `Suspended` is the quarantine for suspended and decommissioned accounts: SCP-ESC-SUS-001
 * denies every action, and suspended accounts cannot be enrolled. Any path at or below these roots is
 * rejected.
 */
export const ENROLLMENT_PROHIBITED_OU_ROOTS = ['Security', 'Suspended'] as const;

/** Environments approved for AWS Control Tower OU enrollment. Any other environment fails closed. */
export const ENROLLMENT_ENVIRONMENTS = ['staging', 'production'] as const;
export type EnrollmentEnvironment = (typeof ENROLLMENT_ENVIRONMENTS)[number];

const ENROLLMENT_OU_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 +=,.@_-]*(?:\/[A-Za-z0-9][A-Za-z0-9 +=,.@_-]*)*$/;

/** Ancestor OU paths of `ouPath`, closest-to-root first. `Workloads/Corp/Prod` -> `Workloads`, `Workloads/Corp`. */
export function enrollmentAncestorPaths(ouPath: string): string[] {
  const segments = ouPath.split('/');
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

/**
 * Pure rollout-order rules that need no other configuration block: no duplicates, no prohibited
 * root, and every ancestor of an entry appears earlier in the list (AWS Control Tower can only
 * register a nested OU after its parent is registered). Returns one message per problem.
 */
export function rolloutOrderProblems(rolloutOrder: readonly string[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  rolloutOrder.forEach((ouPath, index) => {
    if (seen.has(ouPath)) {
      problems.push(`rolloutOrder[${index}] '${ouPath}' is listed more than once`);
    }
    const root = ouPath.split('/')[0] ?? '';
    if ((ENROLLMENT_PROHIBITED_OU_ROOTS as readonly string[]).includes(root)) {
      problems.push(`rolloutOrder[${index}] '${ouPath}' is under the '${root}' OU, which must not be enrolled`);
    }
    for (const ancestor of enrollmentAncestorPaths(ouPath)) {
      if (!seen.has(ancestor)) {
        problems.push(`rolloutOrder[${index}] '${ouPath}' must come after its parent OU '${ancestor}'`);
      }
    }
    seen.add(ouPath);
  });
  return problems;
}

/**
 * AWS Control Tower OU enrollment settings, shared by Staging and Production
 * (`config/default.yaml`) and governed by
 * `.apm/skills/control-tower-account-enrollment/SKILL.md`. `rolloutOrder` lists OU
 * PATHS (never account names) in the order `AWSControlTowerBaseline` is enabled; empty OUs are
 * valid targets. Coverage of every account-bearing OU and existence of every listed OU are checked
 * against the organization and account blocks by `LandingZoneSchema`.
 */
const controlTowerEnrollmentSchema = z
  .object({
    rolloutOrder: z
      .array(z.string().regex(ENROLLMENT_OU_PATH_PATTERN, 'must be a slash-delimited OU path'))
      .min(1)
      .max(32)
  })
  .strict()
  .superRefine((enrollment, context) => {
    for (const message of rolloutOrderProblems(enrollment.rolloutOrder)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['rolloutOrder'], message });
    }
  });

/**
 * Desired AWS Control Tower account auto-enrollment setting (Landing Zone `remediationTypes`
 * `INHERITANCE_DRIFT`), governed by
 * `.apm/skills/control-tower-auto-enrollment/SKILL.md`. REQUIRED with no default:
 * each environment file declares it explicitly, so an environment can never be enabled by an
 * implicit value. The `configure-control-tower-auto-enrollment` action only enables the setting;
 * `false` while AWS reports it enabled fails closed and is never turned into a disable call.
 */
const controlTowerAutoEnrollmentSchema = z.object({ enabled: z.boolean() }).strict();

const controlTowerSecurityRolesSchema = z.object({ enabled: z.boolean() }).strict();
const controlTowerAccessManagementSchema = z.object({ enabled: z.boolean() }).strict();
/** Backup is locked to `false` per instruction §13. Change is a deliberate schema update. */
const controlTowerBackupSchema = z.object({ enabled: z.literal(false) }).strict();

export const controlTowerSchema = z
  .object({
    version: z.literal(CONTROL_TOWER_LANDING_ZONE_VERSION),
    governedRegions: z.array(z.literal(ESC_REGION)).length(1),
    centralizedLogging: controlTowerCentralizedLoggingSchema,
    config: controlTowerConfigSchema,
    securityRoles: controlTowerSecurityRolesSchema,
    accessManagement: controlTowerAccessManagementSchema,
    backup: controlTowerBackupSchema,
    enrollment: controlTowerEnrollmentSchema.optional(),
    autoEnrollment: controlTowerAutoEnrollmentSchema
  })
  .strict()
  .superRefine((controlTower, context) => {
    // Landing Zone 4.0 dependency rule: Config is a prerequisite for securityRoles, accessManagement
    // and backup. Detected here so the failure surfaces at configuration validation time rather than
    // as a server-side CreateLandingZone rejection.
    if (!controlTower.config.enabled) {
      if (controlTower.securityRoles.enabled) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['securityRoles', 'enabled'],
          message: 'requires controlTower.config.enabled === true (Landing Zone 4.0 dependency)'
        });
      }
      if (controlTower.accessManagement.enabled) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accessManagement', 'enabled'],
          message: 'requires controlTower.config.enabled === true (Landing Zone 4.0 dependency)'
        });
      }
      if (controlTower.backup.enabled) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['backup', 'enabled'],
          message: 'requires controlTower.config.enabled === true (Landing Zone 4.0 dependency)'
        });
      }
    }
  });

export type ControlTowerConfig = z.infer<typeof controlTowerSchema>;
export type ControlTowerEnrollmentConfig = z.infer<typeof controlTowerEnrollmentSchema>;
export type ControlTowerAutoEnrollmentConfig = z.infer<typeof controlTowerAutoEnrollmentSchema>;
export const controlTowerLandingZoneVersion = CONTROL_TOWER_LANDING_ZONE_VERSION;
export const controlTowerGovernedRegion = ESC_REGION;
export const escKmsKeyArnPattern = ESC_KMS_KEY_ARN_PATTERN;
export const awsAccountIdPattern = AWS_ACCOUNT_ID_PATTERN;
