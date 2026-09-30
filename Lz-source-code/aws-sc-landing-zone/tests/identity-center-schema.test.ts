import { describe, expect, it } from 'vitest';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { IdentityCenterSchema } from '../config/schemas/identity-center-schema.js';
import { LandingZoneSchema } from '../config/schemas/organization-schema.js';

const configuration = new ConfigReader('staging', {
  configDirName: 'config',
  schema: LandingZoneSchema
}).getConfig().identityCenter;

describe('IdentityCenterSchema', () => {
  it('provides the approved ten-permission-set catalogue', () => {
    const parsedConfiguration = IdentityCenterSchema.parse(configuration);

    expect(parsedConfiguration.permissionSets).toHaveLength(10);
    expect(parsedConfiguration.permissionSets.map((permissionSet) => permissionSet.name)).toEqual([
      'PlatformAdmin-PS',
      'PlatformEngineer-PS',
      'ComplianceReadOnly-PS',
      'SecurityReadOnly-PS',
      'SecurityAdmin-PS',
      'NetworkAdmin-PS',
      'KMSAdmin-PS',
      'LoggingAdmin-PS',
      'WorkloadAdmin-PS',
      'ReadOnly-PS'
    ]);
  });

  it('rejects a catalogue with a duplicate permission set name', () => {
    const permissionSets = configuration.permissionSets.map((permissionSet, index) =>
      index === configuration.permissionSets.length - 1
        ? { ...permissionSet, name: configuration.permissionSets[0]?.name }
        : permissionSet
    );

    expect(() => IdentityCenterSchema.parse({ ...configuration, permissionSets })).toThrow(/names must be unique/);
  });

  it('rejects an incomplete catalogue', () => {
    expect(() =>
      IdentityCenterSchema.parse({ ...configuration, permissionSets: configuration.permissionSets.slice(0, 9) })
    ).toThrow(/exactly 10 element/);
  });

  it('rejects an unapproved permission set name', () => {
    const permissionSets = configuration.permissionSets.map((permissionSet, index) =>
      index === 0 ? { ...permissionSet, name: 'Unapproved-PS' } : permissionSet
    );

    expect(() => IdentityCenterSchema.parse({ ...configuration, permissionSets })).toThrow(
      /approved catalogue exactly/
    );
  });

  it('rejects a permission set that does not match its managed-policy baseline', () => {
    const permissionSets = configuration.permissionSets.map((permissionSet, index) =>
      index === 0 ? { ...permissionSet, managedPolicies: ['ReadOnlyAccess'] } : permissionSet
    );

    expect(() => IdentityCenterSchema.parse({ ...configuration, permissionSets })).toThrow(
      /managed policies must match/
    );
  });

  it('requires JIT-only Production access for the platform administrator', () => {
    const permissionSets = configuration.permissionSets.map((permissionSet, index) =>
      index === 0 ? { ...permissionSet, productionAccess: 'read-only' } : permissionSet
    );

    expect(() => IdentityCenterSchema.parse({ ...configuration, permissionSets })).toThrow(/must be JIT-only/);
  });

  it('rejects unknown fields', () => {
    expect(() =>
      IdentityCenterSchema.parse({
        ...configuration,
        unexpectedField: true
      })
    ).toThrow(/Unrecognized key/);
  });
});
