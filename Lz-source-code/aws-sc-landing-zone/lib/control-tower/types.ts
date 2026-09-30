/**
 * AWS Control Tower Landing Zone 4.0 manifest and operation types.
 *
 * Governed by `.apm/instructions/control-tower-initialization.instructions.md` §4, §8, §9 and
 * §10. The manifest shape mirrors the Landing Zone 4.0 API contract - `governedRegions` plus five
 * optional service integration blocks (`centralizedLogging`, `config`, `securityRoles`,
 * `accessManagement`, `backup`); every integration carries an EXPLICIT `enabled` flag.
 * `organizationStructure` is DELIBERATELY absent because Landing Zone 4.0 forbids it (§4). The
 * Landing Zone version is passed to `CreateLandingZone` as a separate `--landing-zone-version 4.0`
 * argument, never inside the manifest JSON.
 *
 * Both `centralizedLogging.configurations` and `config.configurations` share one interface
 * (`LandingZoneIntegrationConfigurations`) because the LZ 4.0 API uses an identical shape for
 * both integrations: `loggingBucket.retentionDays`, `accessLoggingBucket.retentionDays`, and the
 * optional `kmsKeyArn`. `kmsKeyArn` is OPTIONAL - when omitted, AWS Control Tower applies its
 * standard/default encryption configuration.
 */

/**
 * Terminal and progress states returned by
 * `aws controltower get-landing-zone-operation --operation-identifier`. Any other string returned
 * by AWS is treated as a terminal failure by the initializer, on the assumption that an unknown
 * value is not success.
 */
export type ControlTowerOperationStatus = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

export interface LandingZoneRetentionConfiguration {
  readonly retentionDays: number;
}

/**
 * Landing Zone 4.0 integration `configurations` sub-block. Structurally identical on both
 * `centralizedLogging.configurations` and `config.configurations` per the LZ 4.0 API - both
 * integrations expose the same S3 retention and KMS controls, so a single interface prevents the
 * two blocks from drifting. Retention values are optional; AWS Control Tower applies its
 * standard/default lifecycle when omitted. `kmsKeyArn` is optional; AWS Control Tower applies
 * its standard/default encryption configuration when omitted.
 */
export interface LandingZoneIntegrationConfigurations {
  readonly loggingBucket?: LandingZoneRetentionConfiguration;
  readonly accessLoggingBucket?: LandingZoneRetentionConfiguration;
  /**
   * AWS ESC KMS key ARN, `arn:aws-eusc:kms:eusc-de-east-1:<12>:key/<id>`. Optional per LZ 4.0.
   */
  readonly kmsKeyArn?: string;
}

export interface LandingZoneCentralizedLoggingIntegration {
  /** Pre-created Log Archive account, resolved from `lz-shared-accounts` at deploy time (Path A). */
  readonly accountId: string;
  readonly configurations?: LandingZoneIntegrationConfigurations;
  readonly enabled: boolean;
}

/**
 * AWS Config integration in the LZ 4.0 manifest. Locked to the Audit account when enabled. The
 * `configurations` block mirrors `centralizedLogging.configurations`: independent
 * `loggingBucket.retentionDays`, `accessLoggingBucket.retentionDays`, and optional `kmsKeyArn`
 * per LZ 4.0. When Config is disabled, the LZ 4.0 dependency rule (Zod `superRefine`) requires
 * `securityRoles`, `accessManagement` and `backup` to also be disabled.
 */
export interface LandingZoneConfigIntegration {
  readonly accountId: string;
  readonly enabled: boolean;
  readonly configurations?: LandingZoneIntegrationConfigurations;
}

export interface LandingZoneSecurityRolesIntegration {
  /** Pre-created Audit account, resolved from `lz-shared-accounts` at deploy time (Path A). */
  readonly accountId: string;
  readonly enabled: boolean;
}

export interface LandingZoneAccessManagementIntegration {
  readonly enabled: boolean;
}

export interface LandingZoneBackupIntegration {
  readonly enabled: boolean;
}

/**
 * AWS Control Tower Landing Zone 4.0 manifest body. Passed to `CreateLandingZone` as the
 * `--manifest file://...` payload. The `--landing-zone-version 4.0` argument travels separately.
 * `organizationStructure` is deliberately absent (LZ 4.0 forbids it).
 */
export interface LandingZoneManifest {
  readonly governedRegions: readonly string[];
  readonly centralizedLogging?: LandingZoneCentralizedLoggingIntegration;
  readonly config?: LandingZoneConfigIntegration;
  readonly securityRoles?: LandingZoneSecurityRolesIntegration;
  readonly accessManagement?: LandingZoneAccessManagementIntegration;
  readonly backup?: LandingZoneBackupIntegration;
}

/**
 * Runtime inputs to the manifest builder. Both IDs are resolved from `describe-stacks` on the
 * `lz-shared-accounts` stack. Never sourced from configuration YAML and never accepted as literal
 * defaults - the manifest builder rejects placeholder or empty values.
 */
export interface SharedAccountIds {
  readonly auditAccountId: string;
  readonly logArchiveAccountId: string;
}
