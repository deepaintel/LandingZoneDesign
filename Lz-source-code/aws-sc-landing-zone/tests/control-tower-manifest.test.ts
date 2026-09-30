import { describe, expect, it } from 'vitest';

import {
  controlTowerGovernedRegion,
  controlTowerLandingZoneVersion,
  type ControlTowerConfig
} from '../config/schemas/control-tower-schema.js';
import { buildLandingZoneManifest } from '../lib/control-tower/landing-zone-manifest.js';
import type { LandingZoneManifest } from '../lib/control-tower/types.js';

const AUDIT_ID = '111111111111';
const LOG_ARCHIVE_ID = '222222222222';

function base(): ControlTowerConfig {
  return {
    version: controlTowerLandingZoneVersion,
    governedRegions: [controlTowerGovernedRegion],
    centralizedLogging: { enabled: true },
    config: { enabled: true },
    securityRoles: { enabled: true },
    accessManagement: { enabled: true },
    backup: { enabled: false }
  } as unknown as ControlTowerConfig;
}

describe('buildLandingZoneManifest', () => {
  it('emits governedRegions and explicit enabled flags for every integration', () => {
    const manifest = buildLandingZoneManifest(base(), {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    expect(manifest.governedRegions).toEqual([controlTowerGovernedRegion]);
    expect(manifest.centralizedLogging?.enabled).toBe(true);
    expect(manifest.centralizedLogging?.accountId).toBe(LOG_ARCHIVE_ID);
    expect(manifest.config?.enabled).toBe(true);
    expect(manifest.config?.accountId).toBe(AUDIT_ID);
    expect(manifest.securityRoles?.enabled).toBe(true);
    expect(manifest.securityRoles?.accountId).toBe(AUDIT_ID);
    expect(manifest.accessManagement?.enabled).toBe(true);
    expect(manifest.backup?.enabled).toBe(false);
  });

  it('never emits organizationStructure', () => {
    const manifest = buildLandingZoneManifest(base(), {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    expect(Object.prototype.hasOwnProperty.call(manifest, 'organizationStructure')).toBe(false);
  });

  it('re-enforces the Landing Zone 4.0 dependency rule at build time', () => {
    const bad: ControlTowerConfig = {
      ...base(),
      config: { enabled: false },
      securityRoles: { enabled: true }
    } as unknown as ControlTowerConfig;
    expect(() =>
      buildLandingZoneManifest(bad, { auditAccountId: AUDIT_ID, logArchiveAccountId: LOG_ARCHIVE_ID })
    ).toThrow(/requires controlTower\.config\.enabled === true/);
  });

  it('refuses to build a fully-disabled manifest', () => {
    const allOff: ControlTowerConfig = {
      ...base(),
      centralizedLogging: { enabled: false },
      config: { enabled: false },
      securityRoles: { enabled: false },
      accessManagement: { enabled: false },
      backup: { enabled: false }
    } as unknown as ControlTowerConfig;
    expect(() =>
      buildLandingZoneManifest(allOff, { auditAccountId: AUDIT_ID, logArchiveAccountId: LOG_ARCHIVE_ID })
    ).toThrow(/every service integration disabled/);
  });

  it('rejects a non-12-digit audit account ID', () => {
    expect(() =>
      buildLandingZoneManifest(base(), { auditAccountId: 'not-an-id', logArchiveAccountId: LOG_ARCHIVE_ID })
    ).toThrow(/12-digit AWS account ID/);
  });

  it('rejects a non-12-digit log archive account ID', () => {
    expect(() => buildLandingZoneManifest(base(), { auditAccountId: AUDIT_ID, logArchiveAccountId: '' })).toThrow(
      /12-digit AWS account ID/
    );
  });

  it('omits the centralizedLogging configurations block when the customer supplied no values', () => {
    const manifest = buildLandingZoneManifest(base(), {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    // Optional per LZ 4.0 - absent block signals AWS Control Tower standard/default configuration.
    expect(manifest.centralizedLogging?.configurations).toBeUndefined();
  });

  it('omits the config configurations block when the customer supplied no values', () => {
    const manifest = buildLandingZoneManifest(base(), {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    // Optional per LZ 4.0 - absent block signals AWS Control Tower standard/default configuration.
    expect(manifest.config?.configurations).toBeUndefined();
  });

  it('emits centralizedLogging.configurations.loggingBucket.retentionDays and accessLoggingBucket.retentionDays when supplied', () => {
    const cfg: ControlTowerConfig = {
      ...base(),
      centralizedLogging: {
        enabled: true,
        configurations: {
          loggingBucket: { retentionDays: 180 },
          accessLoggingBucket: { retentionDays: 180 }
        }
      }
    } as unknown as ControlTowerConfig;
    const manifest = buildLandingZoneManifest(cfg, {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    expect(manifest.centralizedLogging?.configurations?.loggingBucket?.retentionDays).toBe(180);
    expect(manifest.centralizedLogging?.configurations?.accessLoggingBucket?.retentionDays).toBe(180);
  });

  it('emits config.configurations.loggingBucket.retentionDays and accessLoggingBucket.retentionDays when supplied', () => {
    const cfg: ControlTowerConfig = {
      ...base(),
      config: {
        enabled: true,
        configurations: {
          loggingBucket: { retentionDays: 1825 },
          accessLoggingBucket: { retentionDays: 1825 }
        }
      }
    } as unknown as ControlTowerConfig;
    const manifest = buildLandingZoneManifest(cfg, {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    expect(manifest.config?.configurations?.loggingBucket?.retentionDays).toBe(1825);
    expect(manifest.config?.configurations?.accessLoggingBucket?.retentionDays).toBe(1825);
  });

  it('emits both centralizedLogging AND config configurations with the same retention (symmetric case)', () => {
    const cfg: ControlTowerConfig = {
      ...base(),
      centralizedLogging: {
        enabled: true,
        configurations: {
          loggingBucket: { retentionDays: 180 },
          accessLoggingBucket: { retentionDays: 180 }
        }
      },
      config: {
        enabled: true,
        configurations: {
          loggingBucket: { retentionDays: 180 },
          accessLoggingBucket: { retentionDays: 180 }
        }
      }
    } as unknown as ControlTowerConfig;
    const manifest = buildLandingZoneManifest(cfg, {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    expect(manifest.centralizedLogging?.configurations?.loggingBucket?.retentionDays).toBe(180);
    expect(manifest.centralizedLogging?.configurations?.accessLoggingBucket?.retentionDays).toBe(180);
    expect(manifest.config?.configurations?.loggingBucket?.retentionDays).toBe(180);
    expect(manifest.config?.configurations?.accessLoggingBucket?.retentionDays).toBe(180);
  });

  it('preserves the optional customer-managed KMS ARN on config.configurations.kmsKeyArn when provided', () => {
    const arn = 'arn:aws-eusc:kms:eusc-de-east-1:333333333333:key/abcd';
    const cfg: ControlTowerConfig = {
      ...base(),
      config: {
        enabled: true,
        configurations: { kmsKeyArn: arn }
      }
    } as unknown as ControlTowerConfig;
    const manifest = buildLandingZoneManifest(cfg, {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    expect(manifest.config?.configurations?.kmsKeyArn).toBe(arn);
  });

  it('does not emit kmsKeyArn on either integration when the customer supplied no ARN', () => {
    const cfg: ControlTowerConfig = {
      ...base(),
      centralizedLogging: {
        enabled: true,
        configurations: { loggingBucket: { retentionDays: 180 } }
      },
      config: {
        enabled: true,
        configurations: { loggingBucket: { retentionDays: 180 } }
      }
    } as unknown as ControlTowerConfig;
    const manifest = buildLandingZoneManifest(cfg, {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    expect(manifest.centralizedLogging?.configurations?.kmsKeyArn).toBeUndefined();
    expect(manifest.config?.configurations?.kmsKeyArn).toBeUndefined();
    // Belt-and-braces: no `kmsKeyArn` substring anywhere in the serialized manifest.
    expect(JSON.stringify(manifest)).not.toContain('kmsKeyArn');
  });

  it('never encodes a commercial ARN prefix, non-ESC region, or STS endpoint', () => {
    const manifest = buildLandingZoneManifest(base(), {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain('arn:aws:');
    expect(serialized).not.toContain('sts.amazonaws.com');
    expect(serialized).not.toMatch(/\b(?:us|eu|ap|sa|ca|me|af|il|cn)-(?:gov-)?[a-z]+-\d\b/);
  });

  it('produces a manifest whose only 12-digit numeric strings are the two shared-account IDs, even with all four retention fields set', () => {
    const cfg: ControlTowerConfig = {
      ...base(),
      centralizedLogging: {
        enabled: true,
        configurations: {
          loggingBucket: { retentionDays: 1825 },
          accessLoggingBucket: { retentionDays: 1825 }
        }
      },
      config: {
        enabled: true,
        configurations: {
          loggingBucket: { retentionDays: 1825 },
          accessLoggingBucket: { retentionDays: 1825 }
        }
      }
    } as unknown as ControlTowerConfig;
    const manifest: LandingZoneManifest = buildLandingZoneManifest(cfg, {
      auditAccountId: AUDIT_ID,
      logArchiveAccountId: LOG_ARCHIVE_ID
    });
    const observed = new Set([...JSON.stringify(manifest).matchAll(/\b\d{12}\b/g)].map((m) => m[0]));
    expect(observed).toEqual(new Set([AUDIT_ID, LOG_ARCHIVE_ID]));
  });
});
