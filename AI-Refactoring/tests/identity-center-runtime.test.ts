import { describe, expect, it } from 'vitest';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import {
  listAssignmentsCommand,
  type IdentityCenterRuntimeClient,
  validateIdentityCenterRuntime
} from '../scripts/validate-identity-center-runtime.js';

const config = new ConfigReader('staging', { configDirName: 'config', schema: LandingZoneSchema }).getConfig();

function createClient(overrides: Partial<IdentityCenterRuntimeClient> = {}): IdentityCenterRuntimeClient {
  const arnsByName = new Map(
    config.identityCenter.permissionSets.map((permissionSet) => [permissionSet.name, `arn:${permissionSet.name}`])
  );
  const definitionsByArn = new Map(
    config.identityCenter.permissionSets.map((permissionSet) => [`arn:${permissionSet.name}`, permissionSet])
  );
  return {
    listPermissionSetArns: () => [...arnsByName.values()],
    describePermissionSet: (_, arn) => {
      const definition = definitionsByArn.get(arn);
      if (definition === undefined) throw new Error(`Unknown ARN ${arn}`);
      return { name: definition.name, description: definition.purpose, sessionDuration: definition.sessionDuration };
    },
    listManagedPolicies: (_, arn) => definitionsByArn.get(arn)?.managedPolicies ?? [],
    getInlinePolicy: () => undefined,
    listCustomerManagedPolicies: () => [],
    getPermissionsBoundary: () => undefined,
    listAccountIds: () => ['000000000000'],
    listAssignments: () => [],
    ...overrides
  };
}

describe('validateIdentityCenterRuntime', () => {
  it('uses the account-id parameter for account assignment discovery', () => {
    expect(listAssignmentsCommand('arn:instance', 'arn:permission-set', '118669550429', 'eusc-de-east-1')).toEqual([
      'sso-admin',
      'list-account-assignments',
      '--instance-arn',
      'arn:instance',
      '--permission-set-arn',
      'arn:permission-set',
      '--account-id',
      '118669550429',
      '--region',
      'eusc-de-east-1'
    ]);
  });

  it('accepts the configured baseline with no assignments', () => {
    expect(() => validateIdentityCenterRuntime(config.identityCenter, 'arn:instance', createClient())).not.toThrow();
  });

  it('rejects a missing Permission Set', () => {
    const client = createClient({ listPermissionSetArns: () => ['arn:PlatformAdmin-PS'] });
    expect(() => validateIdentityCenterRuntime(config.identityCenter, 'arn:instance', client)).toThrow(/is missing/);
  });

  it('rejects an unmodelled authorization attachment', () => {
    const client = createClient({ getInlinePolicy: () => '{"Version":"2012-10-17"}' });
    expect(() => validateIdentityCenterRuntime(config.identityCenter, 'arn:instance', client)).toThrow(
      /unmodelled inline policy/
    );
  });

  it('rejects an unexpected account assignment', () => {
    const client = createClient({ listAssignments: () => [{}] });
    expect(() => validateIdentityCenterRuntime(config.identityCenter, 'arn:instance', client)).toThrow(
      /unexpected account assignment/
    );
  });
});
