import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

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
  backup: { enabled: false },
  autoEnrollment: { enabled: false }
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

  it('requires an explicit autoEnrollment.enabled boolean with no default', () => {
    const withoutAutoEnrollment: Record<string, unknown> = { ...validControlTower };
    delete withoutAutoEnrollment['autoEnrollment'];
    expect(() => controlTowerSchema.parse(withoutAutoEnrollment)).toThrow(/autoEnrollment/);
    expect(() => controlTowerSchema.parse({ ...validControlTower, autoEnrollment: {} })).toThrow();
    expect(() => controlTowerSchema.parse({ ...validControlTower, autoEnrollment: { enabled: 'yes' } })).toThrow();
    expect(() =>
      controlTowerSchema.parse({ ...validControlTower, autoEnrollment: { enabled: true, disable: true } })
    ).toThrow();
    const parsed = controlTowerSchema.parse({ ...validControlTower, autoEnrollment: { enabled: true } });
    expect(parsed.autoEnrollment).toEqual({ enabled: true });
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

describe('controlTower.enrollment.rolloutOrder', () => {
  const ROLLOUT_ORDER = [
    'Infrastructure',
    'Sandbox',
    'Workloads',
    'Workloads/Corp',
    'Workloads/Corp/Non-Prod',
    'Workloads/Hybrid',
    'Workloads/Online',
    'Workloads/Hybrid/Non-Prod',
    'Workloads/Online/Non-Prod',
    'Workloads/Corp/Prod',
    'Workloads/Hybrid/Prod',
    'Workloads/Online/Prod'
  ];
  const withOrder = (rolloutOrder: string[]) => ({ ...validControlTower, enrollment: { rolloutOrder } });

  it('accepts parents before children', () => {
    expect(() => controlTowerSchema.parse(withOrder(ROLLOUT_ORDER))).not.toThrow();
  });

  it('rejects a child listed before its parent', () => {
    expect(() => controlTowerSchema.parse(withOrder(['Infrastructure', 'Workloads/Corp', 'Workloads']))).toThrow(
      /must come after its parent OU 'Workloads'/
    );
  });

  it('rejects a leaf whose ancestors are not listed at all', () => {
    expect(() => controlTowerSchema.parse(withOrder(['Workloads/Corp/Non-Prod']))).toThrow(
      /after its parent OU 'Workloads'/
    );
  });

  it.each(['Security', 'Suspended', 'Suspended/Anything'])('rejects the %s OU', (ouPath) => {
    expect(() => controlTowerSchema.parse(withOrder(['Infrastructure', 'Suspended', ouPath]))).toThrow(
      /must not be enrolled/
    );
  });

  it('accepts Sandbox as a top-level target', () => {
    expect(() => controlTowerSchema.parse(withOrder(['Infrastructure', 'Sandbox']))).not.toThrow();
  });

  it('rejects duplicate OU paths', () => {
    expect(() => controlTowerSchema.parse(withOrder(['Infrastructure', 'Infrastructure']))).toThrow(/more than once/);
  });

  it('is configured once in config/default.yaml and resolves identically in Staging and Production', () => {
    const staging = new ConfigReader('staging', { configDirName: 'config', schema: LandingZoneSchema }).getConfig();
    const production = new ConfigReader('production', {
      configDirName: 'config',
      schema: LandingZoneSchema
    }).getConfig();
    expect(staging.controlTower.enrollment?.rolloutOrder).toEqual(ROLLOUT_ORDER);
    expect(production.controlTower.enrollment?.rolloutOrder).toEqual(ROLLOUT_ORDER);
    const raw = (file: string) =>
      parse(readFileSync(join('config', file), 'utf8')) as { controlTower?: { enrollment?: unknown } };
    expect(raw('default.yaml').controlTower?.enrollment).toEqual({ rolloutOrder: ROLLOUT_ORDER });
    expect(raw('staging.yaml').controlTower?.enrollment).toBeUndefined();
    expect(raw('production.yaml').controlTower?.enrollment).toBeUndefined();
  });

  it('declares auto-enrollment explicitly per environment: Release A enables Staging only', () => {
    const raw = (file: string) =>
      parse(readFileSync(join('config', file), 'utf8')) as { controlTower?: { autoEnrollment?: unknown } };
    expect(raw('default.yaml').controlTower?.autoEnrollment).toBeUndefined();
    expect(raw('staging.yaml').controlTower?.autoEnrollment).toEqual({ enabled: true });
    expect(raw('production.yaml').controlTower?.autoEnrollment).toEqual({ enabled: false });
    const load = (environment: 'staging' | 'production') =>
      new ConfigReader(environment, { configDirName: 'config', schema: LandingZoneSchema }).getConfig();
    expect(load('staging').controlTower.autoEnrollment.enabled).toBe(true);
    expect(load('production').controlTower.autoEnrollment.enabled).toBe(false);
  });

  describe('cross-checks against the organization and account configuration', () => {
    const roots: string[] = [];
    afterEach(() => {
      for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    function loadWithOrder(environment: 'staging' | 'production', rolloutOrder: string[]) {
      const root = mkdtempSync(join(tmpdir(), 'lz-enrollment-'));
      roots.push(root);
      cpSync('config', join(root, 'config'), { recursive: true });
      const file = join(root, 'config', 'default.yaml');
      const document = parse(readFileSync(file, 'utf8')) as {
        controlTower: { enrollment: { rolloutOrder: string[] } };
      };
      document.controlTower.enrollment.rolloutOrder = rolloutOrder;
      writeFileSync(file, stringify(document), 'utf8');
      return new ConfigReader(environment, {
        configRoot: root,
        configDirName: 'config',
        schema: LandingZoneSchema
      }).getConfig();
    }

    it.each(['staging', 'production'] as const)(
      '%s: rejects an OU path that is not in the organization',
      (environment) => {
        expect(() => loadWithOrder(environment, [...ROLLOUT_ORDER, 'Workloads/Corp/Dev'])).toThrow(
          /'Workloads\/Corp\/Dev' is not an OU/
        );
      }
    );

    it('staging: rejects an order that leaves an account-bearing OU uncovered', () => {
      expect(() =>
        loadWithOrder(
          'staging',
          ROLLOUT_ORDER.filter((ouPath) => ouPath !== 'Workloads/Online/Prod')
        )
      ).toThrow(/OU 'Workloads\/Online\/Prod' of configured account 'ccoeOnlineVerificationProd01' is missing/);
    });

    it('production: rejects an order that leaves Infrastructure (SharedServices, Network) uncovered', () => {
      expect(() => loadWithOrder('production', ['Sandbox'])).toThrow(/OU 'Infrastructure' of configured account/);
    });
  });
});
