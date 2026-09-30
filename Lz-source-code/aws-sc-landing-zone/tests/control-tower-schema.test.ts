import { describe, expect, it } from 'vitest';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import {
  controlTowerGovernedRegion,
  controlTowerLandingZoneVersion,
  controlTowerSchema
} from '../config/schemas/control-tower-schema.js';

const validControlTower = {
  version: controlTowerLandingZoneVersion,
  governedRegions: [controlTowerGovernedRegion],
  centralizedLogging: { enabled: false },
  config: { enabled: false },
  securityRoles: { enabled: false },
  accessManagement: { enabled: false },
  backup: { enabled: false }
} as const;

const ESC_KMS_ARN = 'arn:aws-eusc:kms:eusc-de-east-1:123456789012:key/abcd1234';

describe('controlTowerSchema', () => {
  it('accepts the repository-ready fully-disabled baseline', () => {
    expect(() => controlTowerSchema.parse(validControlTower)).not.toThrow();
  });

  it('requires the exact Landing Zone 4.0 version literal', () => {
    expect(() => controlTowerSchema.parse({ ...validControlTower, version: '3.3' })).toThrow(/Invalid literal/);
  });

  it('locks governedRegions to the ESC region and exactly one entry', () => {
    expect(() => controlTowerSchema.parse({ ...validControlTower, governedRegions: [] })).toThrow();
    expect(() => controlTowerSchema.parse({ ...validControlTower, governedRegions: ['eu-west-1'] })).toThrow();
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        governedRegions: [controlTowerGovernedRegion, controlTowerGovernedRegion]
      })
    ).toThrow();
  });

  it('enforces the Landing Zone 4.0 dependency rule: config.enabled=false blocks other integrations', () => {
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        securityRoles: { enabled: true }
      })
    ).toThrow(/requires controlTower\.config\.enabled === true/);
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        accessManagement: { enabled: true }
      })
    ).toThrow(/requires controlTower\.config\.enabled === true/);
  });

  it('permits securityRoles/accessManagement when config.enabled is true', () => {
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: { enabled: true },
        securityRoles: { enabled: true },
        accessManagement: { enabled: true }
      })
    ).not.toThrow();
  });

  it('locks backup.enabled to false', () => {
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: { enabled: true },
        backup: { enabled: true }
      })
    ).toThrow(/Invalid literal/);
  });

  it('accepts optional kmsKeyArn inside centralizedLogging.configurations and config.configurations when it is an ESC KMS ARN', () => {
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        centralizedLogging: {
          enabled: false,
          configurations: { kmsKeyArn: ESC_KMS_ARN }
        }
      })
    ).not.toThrow();
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: {
          enabled: false,
          configurations: { kmsKeyArn: ESC_KMS_ARN }
        }
      })
    ).not.toThrow();
  });

  it('rejects a commercial-partition KMS ARN under config.configurations', () => {
    const commercialArn = 'arn:aws:kms:eu-west-1:123456789012:key/abcd1234';
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: {
          enabled: false,
          configurations: { kmsKeyArn: commercialArn }
        }
      })
    ).toThrow(/aws-eusc:kms:eusc-de-east-1/);
  });

  it('rejects the pre-LZ4.0 top-level config.kmsKeyArn (kmsKeyArn moved into configurations)', () => {
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: { enabled: false, kmsKeyArn: ESC_KMS_ARN }
      })
    ).toThrow(/Unrecognized key/);
  });

  it('accepts config.configurations.loggingBucket.retentionDays and accessLoggingBucket.retentionDays', () => {
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: {
          enabled: true,
          configurations: {
            loggingBucket: { retentionDays: 180 },
            accessLoggingBucket: { retentionDays: 180 }
          }
        }
      })
    ).not.toThrow();
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: {
          enabled: true,
          configurations: {
            loggingBucket: { retentionDays: 1825 },
            accessLoggingBucket: { retentionDays: 1825 }
          }
        }
      })
    ).not.toThrow();
  });

  it('rejects a non-positive retentionDays under config.configurations', () => {
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: {
          enabled: true,
          configurations: { loggingBucket: { retentionDays: 0 } }
        }
      })
    ).toThrow();
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: {
          enabled: true,
          configurations: { loggingBucket: { retentionDays: -1 } }
        }
      })
    ).toThrow();
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: {
          enabled: true,
          configurations: { accessLoggingBucket: { retentionDays: 1.5 } }
        }
      })
    ).toThrow();
  });

  it('rejects unknown fields inside config.configurations (strict)', () => {
    expect(() =>
      controlTowerSchema.parse({
        ...validControlTower,
        config: {
          enabled: true,
          configurations: { unexpectedKey: 'nope' }
        }
      })
    ).toThrow(/Unrecognized key/);
  });

  it('rejects unknown fields at the top level of controlTower', () => {
    expect(() => controlTowerSchema.parse({ ...validControlTower, unexpected: true })).toThrow(/Unrecognized key/);
  });
});

describe('LandingZoneSchema (integration with merged config)', () => {
  it('parses the merged staging configuration with 180-day retention on both integrations', () => {
    const configuration = new ConfigReader('staging', {
      configDirName: 'config',
      schema: LandingZoneSchema
    }).getConfig();
    expect(configuration.controlTower.version).toBe(controlTowerLandingZoneVersion);
    expect(configuration.controlTower.governedRegions).toEqual([controlTowerGovernedRegion]);
    expect(configuration.controlTower.centralizedLogging.enabled).toBe(true);
    expect(configuration.controlTower.config.enabled).toBe(true);
    expect(configuration.controlTower.securityRoles.enabled).toBe(true);
    expect(configuration.controlTower.accessManagement.enabled).toBe(false);
    expect(configuration.controlTower.backup.enabled).toBe(false);
    expect(configuration.controlTower.centralizedLogging.configurations?.loggingBucket?.retentionDays).toBe(180);
    expect(configuration.controlTower.centralizedLogging.configurations?.accessLoggingBucket?.retentionDays).toBe(180);
    expect(configuration.controlTower.config.configurations?.loggingBucket?.retentionDays).toBe(180);
    expect(configuration.controlTower.config.configurations?.accessLoggingBucket?.retentionDays).toBe(180);
    expect(configuration.controlTower.centralizedLogging.configurations?.kmsKeyArn).toBeUndefined();
    expect(configuration.controlTower.config.configurations?.kmsKeyArn).toBeUndefined();
  });

  it('parses the merged production configuration with 1825-day retention on both integrations', () => {
    const configuration = new ConfigReader('production', {
      configDirName: 'config',
      schema: LandingZoneSchema
    }).getConfig();
    expect(configuration.controlTower.version).toBe(controlTowerLandingZoneVersion);
    expect(configuration.controlTower.governedRegions).toEqual([controlTowerGovernedRegion]);
    expect(configuration.controlTower.centralizedLogging.enabled).toBe(true);
    expect(configuration.controlTower.config.enabled).toBe(true);
    expect(configuration.controlTower.securityRoles.enabled).toBe(true);
    expect(configuration.controlTower.accessManagement.enabled).toBe(false);
    expect(configuration.controlTower.backup.enabled).toBe(false);
    expect(configuration.controlTower.centralizedLogging.configurations?.loggingBucket?.retentionDays).toBe(1825);
    expect(configuration.controlTower.centralizedLogging.configurations?.accessLoggingBucket?.retentionDays).toBe(1825);
    expect(configuration.controlTower.config.configurations?.loggingBucket?.retentionDays).toBe(1825);
    expect(configuration.controlTower.config.configurations?.accessLoggingBucket?.retentionDays).toBe(1825);
    expect(configuration.controlTower.centralizedLogging.configurations?.kmsKeyArn).toBeUndefined();
    expect(configuration.controlTower.config.configurations?.kmsKeyArn).toBeUndefined();
  });
});
