#!/usr/bin/env tsx
/**
 * Validates a synthesized Shared Accounts template against the approved account-provisioning
 * design.
 *
 * Runs entirely offline against `cdk.out` - no AWS calls, no deployment. Intended to run in CI
 * immediately after `cdk synth`:
 *
 *   pnpm run synth:staging && pnpm run validate:accounts-template -- --environment staging --output-dir cdk.out/staging
 *   pnpm run synth:production && pnpm run validate:accounts-template -- --environment production --output-dir cdk.out/production
 *
 * Assertions (governed by `.apm/instructions/shared-account-provisioning.instructions.md`):
 *  1. exactly two `AWS::Organizations::Account` resources (Audit, Log Archive);
 *  2. zero `AWS::Organizations::OrganizationalUnit` resources;
 *  3. zero `AWS::Organizations::Policy` resources;
 *  4. no other resource types at all (no IAM, KMS, Config recorder, CloudTrail, StackSet,
 *     tagging, IAM Identity Center - minimal pre-Control-Tower state per instruction §9);
 *  5. every account resource carries `DeletionPolicy: Retain` AND `UpdateReplacePolicy: Retain`,
 *     protecting real AWS accounts from stack-delete or replacement-only property drift;
 *  6. the `OuIdSecurity` CloudFormation parameter exists and is pattern-constrained;
 *  7. every account's `ParentIds` is `[{ Ref: OuIdSecurity }]` - no literal OU ID, no cross-stack
 *     ImportValue, no Fn::GetAtt on another stack's resource;
 *  8. the account name and email in the template match the merged configuration;
 *  9. one `AccountId<Key>` output per account plus the `SharedAccountCount` output;
 * 10. ESC correctness: no commercial ARN prefix, no commercial Region, no commercial STS endpoint;
 * 11. no reference to the retired `develop` environment model;
 * 12. no output declares a `Fn::Export` / `Export` block (matching the OU stack convention -
 *     downstream stacks pass values through workflow parameters, not CloudFormation exports).
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema, type LandingZoneConfig } from '../config/schemas/organization-schema.js';
import { sharedAccountKeys, type SharedAccountKey } from '../config/schemas/shared-accounts-schema.js';
import { sharedAccountConstructId } from '../lib/organization/shared-accounts-stack.js';

const ACCOUNT_RESOURCE_TYPE = 'AWS::Organizations::Account';
const OU_RESOURCE_TYPE = 'AWS::Organizations::OrganizationalUnit';
const POLICY_RESOURCE_TYPE = 'AWS::Organizations::Policy';
const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
const ESC_REGION = 'eusc-de-east-1';
const OU_ID_SECURITY_PARAMETER_NAME = 'OuIdSecurity';
const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const ACCOUNT_ID_OUTPUT_PREFIX = 'AccountId';
const ACCOUNT_COUNT_OUTPUT_NAME = 'SharedAccountCount';
const RETIRED_ENVIRONMENT_NAMES = ['develop', 'dev', 'development'] as const;
const EXPECTED_ACCOUNT_COUNT = 2;
const STACK_NAME = 'lz-shared-accounts';
type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

const COMMERCIAL_REGION_PATTERN = /\b(?:us|eu|ap|sa|ca|me|af|il|cn)-(?:gov-)?[a-z]+-\d\b/g;
const COMMERCIAL_ARN_PREFIX = ['arn', 'aws', ''].join(':');
const COMMERCIAL_STS_ENDPOINT = ['sts', 'amazonaws', 'com'].join('.');

interface CliOptions {
  readonly environments: readonly EnvironmentName[];
  readonly outputDir: string | undefined;
  readonly templatePath: string | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const environments: EnvironmentName[] = [];
  let outputDir: string | undefined;
  let templatePath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--environment' || argument === '-e') {
      if (value === undefined) {
        throw new Error('--environment requires a value (staging or production).');
      }
      const normalized = value.trim().toLowerCase();
      if (!(ENVIRONMENT_NAMES as readonly string[]).includes(normalized)) {
        throw new Error(`Unsupported environment '${value}'. Use one of: ${ENVIRONMENT_NAMES.join(', ')}.`);
      }
      environments.push(normalized as EnvironmentName);
      index += 1;
    } else if (argument === '--output-dir' || argument === '-o') {
      if (value === undefined) {
        throw new Error('--output-dir requires a path.');
      }
      outputDir = value;
      index += 1;
    } else if (argument === '--template' || argument === '-t') {
      if (value === undefined) {
        throw new Error('--template requires a path.');
      }
      templatePath = value;
      index += 1;
    }
  }

  return {
    environments: environments.length > 0 ? environments : [...ENVIRONMENT_NAMES],
    outputDir,
    templatePath
  };
}

function absolute(path: string): string {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function locateTemplate(environment: EnvironmentName, options: CliOptions): string {
  if (options.templatePath !== undefined) {
    return absolute(options.templatePath);
  }

  const outputDir = absolute(options.outputDir ?? 'cdk.out');
  const manifestPath = resolve(outputDir, 'manifest.json');

  if (existsSync(manifestPath)) {
    const manifest = asRecord(JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown);
    const artifacts = asRecord(manifest?.['artifacts']);

    for (const artifact of Object.values(artifacts ?? {})) {
      const record = asRecord(artifact);
      if (record?.['type'] !== 'aws:cloudformation:stack') {
        continue;
      }

      const properties = asRecord(record['properties']);
      if (properties?.['stackName'] !== STACK_NAME) {
        continue;
      }

      const templateFile = properties['templateFile'];
      if (typeof templateFile === 'string') {
        return resolve(outputDir, templateFile);
      }
    }

    throw new Error(
      `Cloud assembly '${manifestPath}' contains no ${STACK_NAME} stack artifact. Run: pnpm run synth:${environment}`
    );
  }

  const fallbacks = [
    resolve(outputDir, `${STACK_NAME}.template.json`),
    resolve(outputDir, 'SharedAccountsStack.template.json')
  ];
  const found = fallbacks.find((candidate) => existsSync(candidate));

  if (found === undefined) {
    throw new Error(`No synthesized template found under '${outputDir}'. Run: pnpm run synth:${environment}`);
  }

  return found;
}

function assertParentReference(logicalId: string, parentIds: unknown): void {
  if (!Array.isArray(parentIds) || parentIds.length !== 1) {
    throw new Error(
      `Resource '${logicalId}' must declare exactly one ParentIds entry (the Security OU parameter reference).`
    );
  }
  const entry = parentIds[0];
  const reference = asRecord(entry);
  const ref = reference?.['Ref'];
  if (typeof ref !== 'string') {
    throw new Error(
      `Resource '${logicalId}' declares a non-reference ParentIds entry (${JSON.stringify(entry)}). Must be ` +
        `{ Ref: ${OU_ID_SECURITY_PARAMETER_NAME} }.`
    );
  }
  if (ref !== OU_ID_SECURITY_PARAMETER_NAME) {
    throw new Error(
      `Resource '${logicalId}' references '${ref}' as its parent. Shared accounts must reference the ` +
        `${OU_ID_SECURITY_PARAMETER_NAME} parameter.`
    );
  }
}

function assertRetainPolicies(logicalId: string, resource: Record<string, unknown>): void {
  if (resource['DeletionPolicy'] !== 'Retain') {
    throw new Error(
      `Resource '${logicalId}' must declare DeletionPolicy: Retain so a stack-delete cannot close a real AWS account.`
    );
  }
  if (resource['UpdateReplacePolicy'] !== 'Retain') {
    throw new Error(
      `Resource '${logicalId}' must declare UpdateReplacePolicy: Retain so a replacement-only property change ` +
        'cannot orphan and reopen a real AWS account.'
    );
  }
}

function assertNoExports(outputs: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(outputs)) {
    const record = asRecord(value);
    if (record?.['Export'] !== undefined) {
      throw new Error(
        `Output '${name}' declares an Export block. The Shared Accounts stack must emit plain CfnOutput values ` +
          'so downstream stacks/workflows read them through describe-stacks, not through cross-stack ImportValue.'
      );
    }
  }
}

function assertEscCorrectness(templateJson: string, templatePath: string): void {
  const sanitized = templateJson.split(ESC_REGION).join('<esc-region>');

  if (sanitized.includes(COMMERCIAL_ARN_PREFIX)) {
    throw new Error(`'${templatePath}' contains a commercial ARN prefix. All ARNs must use arn:aws-eusc:.`);
  }

  if (sanitized.includes(COMMERCIAL_STS_ENDPOINT)) {
    throw new Error(`'${templatePath}' references the commercial STS endpoint.`);
  }

  const commercialRegions = [...new Set(sanitized.match(COMMERCIAL_REGION_PATTERN) ?? [])];
  if (commercialRegions.length > 0) {
    throw new Error(
      `'${templatePath}' references non-ESC Region(s): ${commercialRegions.join(', ')}. Only ${ESC_REGION} is permitted.`
    );
  }

  const retired = RETIRED_ENVIRONMENT_NAMES.filter((name) => sanitized.toLowerCase().includes(name));
  if (retired.length > 0) {
    throw new Error(`'${templatePath}' references the retired environment model: ${retired.join(', ')}.`);
  }
}

function validateEnvironment(environment: EnvironmentName, options: CliOptions): void {
  const config: LandingZoneConfig = new ConfigReader(environment, {
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();

  const templatePath = locateTemplate(environment, options);

  console.log(`\n=== ${environment} :: ${STACK_NAME} ===`);
  console.log(`  template: ${templatePath}`);

  const templateJson = readFileSync(templatePath, 'utf8');
  const template = asRecord(JSON.parse(templateJson) as unknown);
  if (template === undefined) {
    throw new Error(`'${templatePath}' is not a CloudFormation template object.`);
  }

  const resources = asRecord(template['Resources']) ?? {};
  const parameters = asRecord(template['Parameters']) ?? {};
  const outputs = asRecord(template['Outputs']) ?? {};

  const resourceTypes = new Map<string, number>();
  for (const resource of Object.values(resources)) {
    const type = asRecord(resource)?.['Type'];
    const key = typeof type === 'string' ? type : 'unknown';
    resourceTypes.set(key, (resourceTypes.get(key) ?? 0) + 1);
  }

  const accountCount = resourceTypes.get(ACCOUNT_RESOURCE_TYPE) ?? 0;
  const ouCount = resourceTypes.get(OU_RESOURCE_TYPE) ?? 0;
  const policyCount = resourceTypes.get(POLICY_RESOURCE_TYPE) ?? 0;

  console.log(`  ${ACCOUNT_RESOURCE_TYPE}: ${accountCount}`);
  console.log(`  ${OU_RESOURCE_TYPE}: ${ouCount}`);
  console.log(`  ${POLICY_RESOURCE_TYPE}: ${policyCount}`);

  if (accountCount !== EXPECTED_ACCOUNT_COUNT) {
    throw new Error(
      `Expected exactly ${EXPECTED_ACCOUNT_COUNT} ${ACCOUNT_RESOURCE_TYPE} resources but found ${accountCount}.`
    );
  }

  if (ouCount !== 0) {
    throw new Error(`Expected zero ${OU_RESOURCE_TYPE} resources but found ${ouCount}.`);
  }

  if (policyCount !== 0) {
    throw new Error(`Expected zero ${POLICY_RESOURCE_TYPE} resources but found ${policyCount}.`);
  }

  const unexpectedTypes = [...resourceTypes.keys()].filter((type) => type !== ACCOUNT_RESOURCE_TYPE);
  if (unexpectedTypes.length > 0) {
    throw new Error(
      `The account-provisioning phase template must contain only ${ACCOUNT_RESOURCE_TYPE} resources but also ` +
        `contains: ${unexpectedTypes.join(', ')}.`
    );
  }

  const ouIdParameter = asRecord(parameters[OU_ID_SECURITY_PARAMETER_NAME]);
  if (ouIdParameter === undefined) {
    throw new Error(
      `Template is missing the ${OU_ID_SECURITY_PARAMETER_NAME} parameter. The existing Security OU ID must be ` +
        'supplied externally at deployment time.'
    );
  }
  if (ouIdParameter['AllowedPattern'] !== OU_ID_PATTERN.source) {
    throw new Error(
      `${OU_ID_SECURITY_PARAMETER_NAME} must constrain its value with AllowedPattern '${OU_ID_PATTERN.source}'.`
    );
  }

  const expectedAccountsByName = new Map<string, { key: SharedAccountKey; email: string }>();
  for (const key of sharedAccountKeys) {
    const entry = config.accounts[key];
    expectedAccountsByName.set(entry.name, { key, email: entry.email });
  }

  const observedByKey = new Map<SharedAccountKey, { logicalId: string; email: string }>();

  for (const [logicalId, resource] of Object.entries(resources)) {
    const record = asRecord(resource);
    if (record?.['Type'] !== ACCOUNT_RESOURCE_TYPE) {
      continue;
    }

    assertRetainPolicies(logicalId, record);

    const properties = asRecord(record['Properties']);
    const name = properties?.['AccountName'];
    const email = properties?.['Email'];
    if (typeof name !== 'string' || typeof email !== 'string') {
      throw new Error(`Resource '${logicalId}' is missing a string AccountName or Email property.`);
    }
    assertParentReference(logicalId, properties?.['ParentIds']);

    const expected = expectedAccountsByName.get(name);
    if (expected === undefined) {
      throw new Error(
        `Resource '${logicalId}' has AccountName '${name}' which is not in the approved accounts configuration ` +
          `(${[...expectedAccountsByName.keys()].join(', ')}).`
      );
    }
    if (email !== expected.email) {
      throw new Error(
        `Resource '${logicalId}' declares Email '${email}' but configuration expects '${expected.email}' for '${name}'.`
      );
    }
    if (observedByKey.has(expected.key)) {
      throw new Error(`Duplicate synthesized account for key '${expected.key}' (resources include '${logicalId}').`);
    }
    observedByKey.set(expected.key, { logicalId, email });
  }

  for (const key of sharedAccountKeys) {
    if (!observedByKey.has(key)) {
      throw new Error(`Configured account '${key}' is missing from the synthesized template.`);
    }
    const expectedOutput = `${ACCOUNT_ID_OUTPUT_PREFIX}${sharedAccountConstructId(key)}`;
    if (asRecord(outputs[expectedOutput]) === undefined) {
      throw new Error(`Template is missing the '${expectedOutput}' output for shared account '${key}'.`);
    }
  }

  const accountIdOutputs = Object.keys(outputs).filter((name) => name.startsWith(ACCOUNT_ID_OUTPUT_PREFIX));
  if (accountIdOutputs.length !== EXPECTED_ACCOUNT_COUNT) {
    throw new Error(
      `Expected ${EXPECTED_ACCOUNT_COUNT} '${ACCOUNT_ID_OUTPUT_PREFIX}*' outputs but found ${accountIdOutputs.length}.`
    );
  }

  const countOutput = asRecord(outputs[ACCOUNT_COUNT_OUTPUT_NAME]);
  if (countOutput?.['Value'] !== String(EXPECTED_ACCOUNT_COUNT)) {
    throw new Error(`Output '${ACCOUNT_COUNT_OUTPUT_NAME}' must equal '${EXPECTED_ACCOUNT_COUNT}'.`);
  }

  assertNoExports(outputs);
  assertEscCorrectness(templateJson, templatePath);

  for (const key of sharedAccountKeys) {
    const observed = observedByKey.get(key);
    if (observed !== undefined) {
      console.log(`  ok  ${key} (${config.accounts[key].name}) -> ${observed.logicalId}`);
    }
  }
  console.log(`\n  OK: ${environment} shared-accounts template matches the approved design.`);
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2));
  console.log('Validating synthesized AWS ESC Landing Zone shared-accounts templates');

  for (const environment of options.environments) {
    validateEnvironment(environment, options);
  }

  console.log(`\nAll requested templates are valid: ${options.environments.join(', ')}.`);
}

try {
  main();
} catch (error) {
  console.error(`\nShared-accounts template validation failed.\n${(error as Error).message}`);
  process.exitCode = 1;
}
