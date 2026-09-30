/**
 * AWS Control Tower Landing Zone 4.0 manifest builder.
 *
 * Governed by `.apm/instructions/control-tower-initialization.instructions.md` §8 and
 * `.apm/skills/initialize-control-tower/SKILL.md` (Manifest Workflow). Pure function - no CDK, no
 * AWS SDK, no filesystem, no environment variables. The resulting object is what the initializer
 * writes to `RUNNER_TEMP` and passes to
 * `aws controltower create-landing-zone --landing-zone-version 4.0 --manifest file://...`.
 *
 * Design properties:
 *  - `organizationStructure` is DELIBERATELY absent (Landing Zone 4.0 forbids it, §4);
 *  - the Landing Zone version travels as a separate `--landing-zone-version 4.0` CLI argument;
 *  - every service integration carries an EXPLICIT `enabled` flag (§8, no implicit defaults);
 *  - shared-account IDs are RUNTIME inputs resolved from `lz-shared-accounts` outputs (Path A);
 *  - `config.enabled === false` requires `securityRoles`, `accessManagement`, `backup` to also be
 *    `false` (Landing Zone 4.0 dependency rule, enforced by the Zod schema and re-verified here);
 *  - a fully-disabled manifest (no integrations enabled) is REJECTED - initialising a Landing Zone
 *    with zero integrations is almost certainly a misconfiguration, and the initializer's
 *    pre-init checks depend on this guard rather than repeating it.
 */

import type { ControlTowerConfig } from '../../config/schemas/control-tower-schema.js';
import { awsAccountIdPattern } from '../../config/schemas/control-tower-schema.js';
import type { LandingZoneIntegrationConfigurations, LandingZoneManifest, SharedAccountIds } from './types.js';

/**
 * Builds the Landing Zone 4.0 manifest from validated configuration and runtime-resolved shared
 * account IDs. Throws with a specific message on any misuse.
 */
export function buildLandingZoneManifest(
  controlTower: ControlTowerConfig,
  sharedAccountIds: SharedAccountIds
): LandingZoneManifest {
  assertAccountId('auditAccountId', sharedAccountIds.auditAccountId);
  assertAccountId('logArchiveAccountId', sharedAccountIds.logArchiveAccountId);

  // Re-verify the Landing Zone 4.0 dependency rule the schema already enforces. Two guards keep
  // the invariant intact if the manifest builder is ever called with a hand-constructed config
  // that bypassed the schema (tests, ad-hoc scripts).
  if (!controlTower.config.enabled) {
    if (controlTower.securityRoles.enabled) {
      throw new Error(
        'controlTower.securityRoles.enabled requires controlTower.config.enabled === true ' +
          '(Landing Zone 4.0 dependency).'
      );
    }
    if (controlTower.accessManagement.enabled) {
      throw new Error(
        'controlTower.accessManagement.enabled requires controlTower.config.enabled === true ' +
          '(Landing Zone 4.0 dependency).'
      );
    }
    if (controlTower.backup.enabled) {
      throw new Error(
        'controlTower.backup.enabled requires controlTower.config.enabled === true ' + '(Landing Zone 4.0 dependency).'
      );
    }
  }

  const anyIntegrationEnabled =
    controlTower.centralizedLogging.enabled ||
    controlTower.config.enabled ||
    controlTower.securityRoles.enabled ||
    controlTower.accessManagement.enabled ||
    controlTower.backup.enabled;

  if (!anyIntegrationEnabled) {
    throw new Error(
      'Refusing to build a Landing Zone 4.0 manifest with every service integration disabled. ' +
        'Enable at least one of centralizedLogging / config / securityRoles / accessManagement, ' +
        'or do not initialise Control Tower.'
    );
  }

  const manifest: {
    -readonly [K in keyof LandingZoneManifest]: LandingZoneManifest[K];
  } = {
    governedRegions: [...controlTower.governedRegions]
  };

  // centralizedLogging - always emitted with an accountId; the `configurations` sub-block is only
  // populated when the integration is enabled AND the customer supplied at least one value.
  // When omitted, AWS Control Tower applies its standard/default configuration.
  const centralized: {
    -readonly [K in keyof NonNullable<LandingZoneManifest['centralizedLogging']>]: NonNullable<
      LandingZoneManifest['centralizedLogging']
    >[K];
  } = {
    accountId: sharedAccountIds.logArchiveAccountId,
    enabled: controlTower.centralizedLogging.enabled
  };
  if (controlTower.centralizedLogging.enabled) {
    const centralizedConfigurations = buildConfigurationsBlock(controlTower.centralizedLogging.configurations);
    if (centralizedConfigurations !== undefined) {
      centralized.configurations = centralizedConfigurations;
    }
  }
  manifest.centralizedLogging = centralized;

  // config - identical `configurations` shape per LZ 4.0. Populated when the integration is
  // enabled AND the customer supplied at least one value; otherwise omitted so AWS Control Tower
  // applies its standard/default configuration.
  const configBlock: {
    -readonly [K in keyof NonNullable<LandingZoneManifest['config']>]: NonNullable<LandingZoneManifest['config']>[K];
  } = {
    accountId: sharedAccountIds.auditAccountId,
    enabled: controlTower.config.enabled
  };
  if (controlTower.config.enabled) {
    const configConfigurations = buildConfigurationsBlock(controlTower.config.configurations);
    if (configConfigurations !== undefined) {
      configBlock.configurations = configConfigurations;
    }
  }
  manifest.config = configBlock;

  manifest.securityRoles = {
    accountId: sharedAccountIds.auditAccountId,
    enabled: controlTower.securityRoles.enabled
  };
  manifest.accessManagement = { enabled: controlTower.accessManagement.enabled };
  manifest.backup = { enabled: controlTower.backup.enabled };

  return manifest;
}

/**
 * Maps an integration's `configurations` source (from validated ControlTowerConfig) to the LZ 4.0
 * manifest `configurations` shape. Returns `undefined` when no values are supplied so callers can
 * omit the block entirely - the LZ 4.0 API interprets omission as "apply Control Tower
 * standard/default configuration".
 */
function buildConfigurationsBlock(
  source:
    | {
        readonly loggingBucket?: { readonly retentionDays: number };
        readonly accessLoggingBucket?: { readonly retentionDays: number };
        readonly kmsKeyArn?: string;
      }
    | undefined
): LandingZoneIntegrationConfigurations | undefined {
  if (source === undefined) return undefined;
  const configurations: {
    -readonly [K in keyof LandingZoneIntegrationConfigurations]: LandingZoneIntegrationConfigurations[K];
  } = {};
  if (source.loggingBucket !== undefined) {
    configurations.loggingBucket = { retentionDays: source.loggingBucket.retentionDays };
  }
  if (source.accessLoggingBucket !== undefined) {
    configurations.accessLoggingBucket = { retentionDays: source.accessLoggingBucket.retentionDays };
  }
  if (source.kmsKeyArn !== undefined) {
    configurations.kmsKeyArn = source.kmsKeyArn;
  }
  return Object.keys(configurations).length > 0 ? configurations : undefined;
}

function assertAccountId(label: string, value: unknown): void {
  if (typeof value !== 'string' || !awsAccountIdPattern.test(value)) {
    throw new Error(
      `${label} must be a 12-digit AWS account ID resolved at runtime from the lz-shared-accounts ` +
        `stack outputs (got ${JSON.stringify(value)}).`
    );
  }
}
