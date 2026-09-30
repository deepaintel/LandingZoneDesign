#!/usr/bin/env tsx

import { execFileSync } from 'node:child_process';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import type { IdentityCenterConfig } from '../config/schemas/identity-center-schema.js';

const ENVIRONMENTS = ['staging', 'production'] as const;

type EnvironmentName = (typeof ENVIRONMENTS)[number];

export interface RuntimeValidatorOptions {
  readonly environment: EnvironmentName;
  readonly instanceArn: string;
}

export interface IdentityCenterRuntimeClient {
  listPermissionSetArns(instanceArn: string): readonly string[];
  describePermissionSet(instanceArn: string, permissionSetArn: string): PermissionSetRuntimeState;
  listManagedPolicies(instanceArn: string, permissionSetArn: string): readonly string[];
  getInlinePolicy(instanceArn: string, permissionSetArn: string): string | undefined;
  listCustomerManagedPolicies(instanceArn: string, permissionSetArn: string): readonly string[];
  getPermissionsBoundary(instanceArn: string, permissionSetArn: string): unknown;
  listAccountIds(): readonly string[];
  listAssignments(instanceArn: string, permissionSetArn: string, accountId: string): readonly unknown[];
}

export interface PermissionSetRuntimeState {
  readonly name: string;
  readonly description: string | undefined;
  readonly sessionDuration: string | undefined;
}

type CliOptions = RuntimeValidatorOptions;

export function listAssignmentsCommand(
  instanceArn: string,
  permissionSetArn: string,
  accountId: string,
  region: string
): readonly string[] {
  return [
    'sso-admin',
    'list-account-assignments',
    '--instance-arn',
    instanceArn,
    '--permission-set-arn',
    permissionSetArn,
    '--account-id',
    accountId,
    '--region',
    region
  ];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseJson(command: readonly string[]): unknown {
  try {
    return JSON.parse(execFileSync('aws', [...command, '--output', 'json', '--no-cli-pager'], { encoding: 'utf8' }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`AWS runtime validation command failed: aws ${command.join(' ')}\n${message}`, {
      cause: error
    });
  }
}

function isResourceNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.includes('ResourceNotFoundException');
}

export class AwsCliIdentityCenterRuntimeClient implements IdentityCenterRuntimeClient {
  public constructor(private readonly region: string) {}

  public listPermissionSetArns(instanceArn: string): readonly string[] {
    const response = asRecord(
      parseJson(['sso-admin', 'list-permission-sets', '--instance-arn', instanceArn, '--region', this.region])
    );
    return this.stringArray(response?.['PermissionSets'], 'sso-admin list-permission-sets PermissionSets');
  }

  public describePermissionSet(instanceArn: string, permissionSetArn: string): PermissionSetRuntimeState {
    const response = asRecord(
      parseJson([
        'sso-admin',
        'describe-permission-set',
        '--instance-arn',
        instanceArn,
        '--permission-set-arn',
        permissionSetArn,
        '--region',
        this.region
      ])
    );
    const permissionSet = asRecord(response?.['PermissionSet']);
    if (typeof permissionSet?.['Name'] !== 'string') {
      throw new Error(`Permission Set '${permissionSetArn}' has no string Name in the AWS response.`);
    }
    return {
      name: permissionSet['Name'],
      description: typeof permissionSet['Description'] === 'string' ? permissionSet['Description'] : undefined,
      sessionDuration:
        typeof permissionSet['SessionDuration'] === 'string' ? permissionSet['SessionDuration'] : undefined
    };
  }

  public listManagedPolicies(instanceArn: string, permissionSetArn: string): readonly string[] {
    const response = asRecord(
      parseJson([
        'sso-admin',
        'list-managed-policies-in-permission-set',
        '--instance-arn',
        instanceArn,
        '--permission-set-arn',
        permissionSetArn,
        '--region',
        this.region
      ])
    );
    return ((response?.['AttachedManagedPolicies'] as unknown[] | undefined) ?? []).map((policy) => {
      const name = asRecord(policy)?.['Name'];
      if (typeof name !== 'string') {
        throw new Error(`Permission Set '${permissionSetArn}' has a managed policy without a Name.`);
      }
      return name;
    });
  }

  public getInlinePolicy(instanceArn: string, permissionSetArn: string): string | undefined {
    const response = asRecord(
      parseJson([
        'sso-admin',
        'get-inline-policy-for-permission-set',
        '--instance-arn',
        instanceArn,
        '--permission-set-arn',
        permissionSetArn,
        '--region',
        this.region
      ])
    );
    const policy = response?.['InlinePolicy'];
    return typeof policy === 'string' && policy.trim().length > 0 ? policy : undefined;
  }

  public listCustomerManagedPolicies(instanceArn: string, permissionSetArn: string): readonly string[] {
    const response = asRecord(
      parseJson([
        'sso-admin',
        'list-customer-managed-policy-references-in-permission-set',
        '--instance-arn',
        instanceArn,
        '--permission-set-arn',
        permissionSetArn,
        '--region',
        this.region
      ])
    );
    return ((response?.['CustomerManagedPolicyReferences'] as unknown[] | undefined) ?? []).map((policy) => {
      const record = asRecord(policy);
      return `${record?.['Path'] ?? '/'}${record?.['Name'] ?? '<unnamed>'}`;
    });
  }

  public getPermissionsBoundary(instanceArn: string, permissionSetArn: string): unknown {
    try {
      const response = asRecord(
        parseJson([
          'sso-admin',
          'get-permissions-boundary-for-permission-set',
          '--instance-arn',
          instanceArn,
          '--permission-set-arn',
          permissionSetArn,
          '--region',
          this.region
        ])
      );
      return response?.['PermissionsBoundary'];
    } catch (error) {
      if (isResourceNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  public listAccountIds(): readonly string[] {
    const response = asRecord(parseJson(['organizations', 'list-accounts', '--region', this.region]));
    return ((response?.['Accounts'] as unknown[] | undefined) ?? []).map((account) => {
      const id = asRecord(account)?.['Id'];
      if (typeof id !== 'string') {
        throw new Error('AWS Organizations returned an account without an Id.');
      }
      return id;
    });
  }

  public listAssignments(instanceArn: string, permissionSetArn: string, accountId: string): readonly unknown[] {
    const response = asRecord(parseJson(listAssignmentsCommand(instanceArn, permissionSetArn, accountId, this.region)));
    return (response?.['AccountAssignments'] as unknown[] | undefined) ?? [];
  }

  private stringArray(value: unknown, label: string): readonly string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new Error(`AWS response '${label}' must be an array of strings.`);
    }
    return value;
  }
}

export function validateIdentityCenterRuntime(
  config: IdentityCenterConfig,
  instanceArn: string,
  client: IdentityCenterRuntimeClient
): void {
  const permissionSetsByName = new Map<string, string>();
  for (const permissionSetArn of client.listPermissionSetArns(instanceArn)) {
    const permissionSet = client.describePermissionSet(instanceArn, permissionSetArn);
    if (permissionSetsByName.has(permissionSet.name)) {
      throw new Error(`IAM Identity Center contains duplicate Permission Set '${permissionSet.name}'.`);
    }
    permissionSetsByName.set(permissionSet.name, permissionSetArn);
  }

  const accountIds = client.listAccountIds();
  for (const expected of config.permissionSets) {
    const permissionSetArn = permissionSetsByName.get(expected.name);
    if (permissionSetArn === undefined) {
      throw new Error(`Configured Permission Set '${expected.name}' is missing from IAM Identity Center.`);
    }
    const actual = client.describePermissionSet(instanceArn, permissionSetArn);
    if (actual.description !== expected.purpose || actual.sessionDuration !== expected.sessionDuration) {
      throw new Error(`Permission Set '${expected.name}' differs from its configured description or session duration.`);
    }
    assertSameSet(
      expected.name,
      'managed policies',
      expected.managedPolicies,
      client.listManagedPolicies(instanceArn, permissionSetArn)
    );
    if (client.getInlinePolicy(instanceArn, permissionSetArn) !== undefined) {
      throw new Error(`Permission Set '${expected.name}' has an unmodelled inline policy.`);
    }
    if (client.listCustomerManagedPolicies(instanceArn, permissionSetArn).length > 0) {
      throw new Error(`Permission Set '${expected.name}' has unmodelled customer-managed policies.`);
    }
    if (client.getPermissionsBoundary(instanceArn, permissionSetArn) !== undefined) {
      throw new Error(`Permission Set '${expected.name}' has an unmodelled permissions boundary.`);
    }
    for (const accountId of accountIds) {
      if (client.listAssignments(instanceArn, permissionSetArn, accountId).length > 0) {
        throw new Error(`Permission Set '${expected.name}' has an unexpected account assignment for '${accountId}'.`);
      }
    }
  }
}

function assertSameSet(name: string, label: string, expected: readonly string[], actual: readonly string[]): void {
  if (
    new Set(expected).size !== expected.length ||
    new Set(actual).size !== actual.length ||
    expected.length !== actual.length ||
    expected.some((value) => !actual.includes(value))
  ) {
    throw new Error(`Permission Set '${name}' has unexpected ${label}.`);
  }
}

function parseOptions(argv: readonly string[]): CliOptions {
  let environment: EnvironmentName | undefined;
  let instanceArn: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === '--environment' && value !== undefined && (ENVIRONMENTS as readonly string[]).includes(value)) {
      environment = value as EnvironmentName;
      index += 1;
    } else if (argument === '--instance-arn' && value !== undefined) {
      instanceArn = value;
      index += 1;
    }
  }
  if (environment === undefined || instanceArn === undefined) {
    throw new Error('--environment (staging|production) and --instance-arn are required.');
  }
  return { environment, instanceArn };
}

if (process.argv[1]?.endsWith('validate-identity-center-runtime.ts')) {
  const options = parseOptions(process.argv.slice(2));
  const config = new ConfigReader(options.environment, {
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();
  validateIdentityCenterRuntime(
    config.identityCenter,
    options.instanceArn,
    new AwsCliIdentityCenterRuntimeClient(config.aws.region)
  );
  console.log(`IAM Identity Center runtime validation passed for ${options.environment}.`);
}
