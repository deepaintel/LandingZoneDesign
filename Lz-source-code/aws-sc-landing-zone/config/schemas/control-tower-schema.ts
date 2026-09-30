import { z } from 'zod';

/**
 * AWS Control Tower Landing Zone 4.0 configuration schema.
 *
 * Governed by `.apm/instructions/control-tower-initialization.instructions.md` and
 * `.apm/skills/initialize-control-tower/SKILL.md`. This file owns the ENVIRONMENT-INVARIANT shape
 * of the Landing Zone 4.0 manifest and the constants the initialiser, manifest builder and
 * validators must agree on.
 *
 *  - `version` and the single governed Region are literals - the manifest builder and the
 *    initializer's `--landing-zone-version 4.0` argument stay in lock-step;
 *  - every service integration carries an EXPLICIT `enabled` boolean; there are no implicit
 *    defaults (instruction §8);
 *  - both `centralizedLogging.configurations` and `config.configurations` share ONE Zod schema
 *    (`controlTowerConfigurationsSchema`) so their shape - `loggingBucket.retentionDays`,
 *    `accessLoggingBucket.retentionDays`, and the optional `kmsKeyArn` - can never drift;
 *  - `kmsKeyArn` on both integration `configurations` blocks is OPTIONAL, matching the LZ 4.0
 *    manifest schema. AWS Control Tower applies its standard/default encryption configuration
 *    when omitted; a customer-managed key is only required when governance explicitly asks;
 *  - `backup.enabled` is locked to `false` per instruction §13; enabling AWS Backup requires an
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
 * Control Tower initialization is disallowed - see instruction §14 and shared-account
 * provisioning §7.
 */

const ESC_REGION = 'eusc-de-east-1';

/**
 * Approved AWS Control Tower Landing Zone version for this repository. Governed by
 * `.apm/instructions/control-tower-initialization.instructions.md` §4. Any change to this literal
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
    backup: controlTowerBackupSchema
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
export const controlTowerLandingZoneVersion = CONTROL_TOWER_LANDING_ZONE_VERSION;
export const controlTowerGovernedRegion = ESC_REGION;
export const escKmsKeyArnPattern = ESC_KMS_KEY_ARN_PATTERN;
export const awsAccountIdPattern = AWS_ACCOUNT_ID_PATTERN;
