#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';

const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
const IDENTITY_CENTER_STACK_NAME = 'lz-identity-center-permission-sets';
const PERMISSION_SET_RESOURCE_TYPE = 'AWS::SSO::PermissionSet';
const ASSIGNMENT_RESOURCE_TYPE = 'AWS::SSO::Assignment';
const PROHIBITED_PERMISSION_SET_NAMES = ['github-actions-role', 'BreakGlassAdmin-PS'];

type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

interface CliOptions {
  readonly environment: EnvironmentName;
  readonly outputDir: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseOptions(argv: readonly string[]): CliOptions {
  let environment: EnvironmentName | undefined;
  let outputDir = 'cdk.out';

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--environment' || argument === '-e') {
      if (value === undefined || !(ENVIRONMENT_NAMES as readonly string[]).includes(value)) {
        throw new Error(`--environment must be one of: ${ENVIRONMENT_NAMES.join(', ')}.`);
      }
      environment = value as EnvironmentName;
      index += 1;
    } else if (argument === '--output-dir' || argument === '-o') {
      if (value === undefined) {
        throw new Error('--output-dir requires a path.');
      }
      outputDir = value;
      index += 1;
    }
  }

  if (environment === undefined) {
    throw new Error('--environment is required.');
  }

  return { environment, outputDir };
}

function locateTemplate(outputDir: string): string {
  const absoluteOutputDir = isAbsolute(outputDir) ? outputDir : resolve(process.cwd(), outputDir);
  const manifestPath = resolve(absoluteOutputDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`No cloud assembly manifest found at '${manifestPath}'.`);
  }

  const manifest = asRecord(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown);
  const artifacts = asRecord(manifest?.['artifacts']) ?? {};
  for (const artifact of Object.values(artifacts)) {
    const properties = asRecord(asRecord(artifact)?.['properties']);
    if (properties?.['stackName'] === IDENTITY_CENTER_STACK_NAME && typeof properties['templateFile'] === 'string') {
      return resolve(absoluteOutputDir, properties['templateFile']);
    }
  }

  throw new Error(`Cloud assembly contains no '${IDENTITY_CENTER_STACK_NAME}' stack artifact.`);
}

function managedPolicyName(value: unknown): string | undefined {
  const sub = asRecord(value)?.['Fn::Sub'];
  if (!Array.isArray(sub) || sub.length !== 2 || sub[0] !== 'arn:${AWS::Partition}:iam::aws:policy/${PolicyName}') {
    return undefined;
  }

  const variables = asRecord(sub[1]);
  return typeof variables?.['PolicyName'] === 'string' ? variables['PolicyName'] : undefined;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const config = new ConfigReader(options.environment, {
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();
  const templatePath = locateTemplate(options.outputDir);
  const template = asRecord(JSON.parse(readFileSync(templatePath, 'utf8')) as unknown);
  const resources = asRecord(template?.['Resources']) ?? {};
  const permissionSets = Object.values(resources)
    .map(asRecord)
    .filter((resource) => resource?.['Type'] === PERMISSION_SET_RESOURCE_TYPE);
  const assignments = Object.values(resources)
    .map(asRecord)
    .filter((resource) => resource?.['Type'] === ASSIGNMENT_RESOURCE_TYPE);

  if (permissionSets.length !== config.identityCenter.permissionSets.length) {
    throw new Error(
      `Expected ${config.identityCenter.permissionSets.length} Permission Sets, found ${permissionSets.length}.`
    );
  }
  if (assignments.length !== 0) {
    throw new Error(`Expected zero account assignments before SCIM rollout, found ${assignments.length}.`);
  }

  const actualByName = new Map<string, Record<string, unknown>>();
  for (const permissionSet of permissionSets) {
    const properties = asRecord(permissionSet?.['Properties']);
    const name = properties?.['Name'];
    if (typeof name !== 'string') {
      throw new Error('Permission Set resource has no string Name property.');
    }
    if (actualByName.has(name)) {
      throw new Error(`Permission Set '${name}' is declared more than once.`);
    }
    actualByName.set(name, properties ?? {});
  }

  for (const definition of config.identityCenter.permissionSets) {
    const properties = actualByName.get(definition.name);
    if (properties === undefined) {
      throw new Error(`Configured Permission Set '${definition.name}' is missing from the template.`);
    }
    if (properties['SessionDuration'] !== definition.sessionDuration) {
      throw new Error(
        `Permission Set '${definition.name}' must use its configured ${definition.sessionDuration} session duration.`
      );
    }

    const managedPolicies = Array.isArray(properties['ManagedPolicies'])
      ? properties['ManagedPolicies'].map(managedPolicyName)
      : [];
    if (
      managedPolicies.length !== definition.managedPolicies.length ||
      definition.managedPolicies.some((policyName) => !managedPolicies.includes(policyName))
    ) {
      throw new Error(`Permission Set '${definition.name}' does not match its configured managed-policy baseline.`);
    }
  }

  for (const prohibitedName of PROHIBITED_PERMISSION_SET_NAMES) {
    if (actualByName.has(prohibitedName)) {
      throw new Error(`Prohibited Permission Set '${prohibitedName}' is present in the template.`);
    }
  }

  console.log(`Identity Center template validation passed for ${options.environment}: ${templatePath}`);
}

main();
