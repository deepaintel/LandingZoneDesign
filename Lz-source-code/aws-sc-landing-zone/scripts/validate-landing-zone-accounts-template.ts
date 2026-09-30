#!/usr/bin/env tsx
/**
 * Validates a synthesized Landing Zone Accounts template against the approved
 * account-provisioning design.
 *
 * Runs entirely offline against `cdk.out` - no AWS calls, no deployment. Intended to run in CI
 * immediately after `cdk synth`:
 *
 *   pnpm run synth:staging && pnpm run validate:landing-zone-accounts-template -- --environment staging --output-dir cdk.out/staging
 *
 * Assertions (governed by `.apm/instructions/landing-zone-account-provisioning.instructions.md`):
 *  1. every synthesized resource is `AWS::Organizations::Account`; the number of accounts
 *     matches the validated active configuration exactly (zero is acceptable when the merged
 *     configuration contains no `landingZoneAccounts` entries, per §12 DEPLOYMENT CONFIGURATION
 *     PENDING);
 *  2. every account resource carries `DeletionPolicy: Retain` AND `UpdateReplacePolicy: Retain`;
 *  3. every OU referenced by an active account is declared as a pattern-constrained `OuId*`
 *     CloudFormation parameter;
 *  4. every account's `ParentIds` is `[{ Ref: OuId<Key> }]` - no literal OU ID, no cross-stack
 *     ImportValue, no `Fn::GetAtt` on another stack's resource;
 *  5. every account carries the eight mandatory P1 tags with values sourced under the approved
 *     mappings (`owner = account.owner`, `owner-email = account.email`,
 *     `itsystemcode = account.costCentre`, `data-residency = EU`, and the remaining four from
 *     the account's validated `tags` block);
 *  6. `domain` is present and non-empty on every account (per §8.1 the current Landing Zone
 *     value is `Cloud Application Platform`; the schema does not literal-bind it so future
 *     workload configurations remain valid);
 *  7. one `AccountId<Key>` output per instantiated account plus the `LandingZoneAccountCount`
 *     output;
 *  8. no output declares a `Fn::Export` block;
 *  9. ESC correctness: no commercial ARN prefix, no commercial Region, no commercial STS
 *     endpoint;
 * 10. no reference to the retired `develop` environment model.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema, type LandingZoneConfig } from '../config/schemas/organization-schema.js';
import {
  landingZoneAccountConstructId,
  ouPathToParameterName
} from '../lib/organization/landing-zone-accounts-stack.js';

const ACCOUNT_RESOURCE_TYPE = 'AWS::Organizations::Account';
const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
const ESC_REGION = 'eusc-de-east-1';
const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const ACCOUNT_ID_OUTPUT_PREFIX = 'AccountId';
const ACCOUNT_COUNT_OUTPUT_NAME = 'LandingZoneAccountCount';
const STACK_NAME = 'lz-landing-zone-accounts';
const RETIRED_ENVIRONMENT_NAMES = ['develop', 'development'] as const;

const REQUIRED_TAG_KEYS = [
  'owner',
  'owner-email',
  'environment',
  'lifecycle',
  'data-classification',
  'data-residency',
  'itsystemcode',
  'domain'
] as const;

type TagKey = (typeof REQUIRED_TAG_KEYS)[number];
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
    resolve(outputDir, 'LandingZoneAccountsStack.template.json')
  ];
  const found = fallbacks.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(`No synthesized template found under '${outputDir}'. Run: pnpm run synth:${environment}`);
  }
  return found;
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

function assertParentReference(logicalId: string, parentIds: unknown, expectedParameter: string): void {
  if (!Array.isArray(parentIds) || parentIds.length !== 1) {
    throw new Error(
      `Resource '${logicalId}' must declare exactly one ParentIds entry (a Ref to '${expectedParameter}').`
    );
  }
  const reference = asRecord(parentIds[0]);
  const ref = reference?.['Ref'];
  if (typeof ref !== 'string') {
    throw new Error(
      `Resource '${logicalId}' declares a non-reference ParentIds entry (${JSON.stringify(parentIds[0])}). ` +
        `Must be { Ref: '${expectedParameter}' }.`
    );
  }
  if (ref !== expectedParameter) {
    throw new Error(
      `Resource '${logicalId}' references '${ref}' as its parent OU but the account's ouPath resolves to ` +
        `'${expectedParameter}'.`
    );
  }
}

function assertOuParameter(parameters: Record<string, unknown>, parameterName: string): void {
  const parameter = asRecord(parameters[parameterName]);
  if (parameter === undefined) {
    throw new Error(
      `Template is missing the '${parameterName}' parameter. Every OU referenced by an active account must be ` +
        'supplied externally at deployment time via a pattern-constrained CloudFormation parameter.'
    );
  }
  if (parameter['AllowedPattern'] !== OU_ID_PATTERN.source) {
    throw new Error(
      `Parameter '${parameterName}' must constrain its value with AllowedPattern '${OU_ID_PATTERN.source}'.`
    );
  }
}

function assertTagValue(logicalId: string, tags: Map<TagKey, string>, key: TagKey, expected: string): void {
  const observed = tags.get(key);
  if (observed !== expected) {
    throw new Error(
      `Resource '${logicalId}' tag '${key}' must equal '${expected}' but observed '${observed ?? '<missing>'}'.`
    );
  }
}

function collectTags(logicalId: string, properties: Record<string, unknown> | undefined): Map<TagKey, string> {
  const rawTags = properties?.['Tags'];
  if (!Array.isArray(rawTags)) {
    throw new Error(`Resource '${logicalId}' is missing the required Tags array (all eight P1 tags must be present).`);
  }
  const collected = new Map<TagKey, string>();
  for (const entry of rawTags) {
    const record = asRecord(entry);
    const rawKey = record?.['Key'];
    const rawValue = record?.['Value'];
    if (typeof rawKey !== 'string' || typeof rawValue !== 'string') {
      throw new Error(`Resource '${logicalId}' has a malformed Tag entry: ${JSON.stringify(entry)}.`);
    }
    if ((REQUIRED_TAG_KEYS as readonly string[]).includes(rawKey)) {
      collected.set(rawKey as TagKey, rawValue);
    }
  }
  const missing = REQUIRED_TAG_KEYS.filter((key) => !collected.has(key));
  if (missing.length > 0) {
    throw new Error(`Resource '${logicalId}' is missing mandatory P1 tag(s): ${missing.join(', ')}.`);
  }
  return collected;
}

function assertNoExports(outputs: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(outputs)) {
    const record = asRecord(value);
    if (record?.['Export'] !== undefined) {
      throw new Error(
        `Output '${name}' declares an Export block. The Landing Zone Accounts stack must emit plain CfnOutput ` +
          'values so downstream stacks/workflows read them through describe-stacks.'
      );
    }
  }
}

function assertNoImportValue(templateJson: string, templatePath: string): void {
  if (templateJson.includes('"Fn::ImportValue"')) {
    throw new Error(
      `'${templatePath}' contains Fn::ImportValue. OU IDs must flow through pattern-constrained parameters.`
    );
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

  const activeAccounts = Object.entries(config.landingZoneAccounts);
  const expectedAccountCount = activeAccounts.length;

  const templatePath = locateTemplate(environment, options);
  console.log(`\n=== ${environment} :: ${STACK_NAME} ===`);
  console.log(`  template: ${templatePath}`);
  console.log(`  active configured accounts: ${expectedAccountCount}`);

  const templateJson = readFileSync(templatePath, 'utf8');
  const template = asRecord(JSON.parse(templateJson) as unknown);
  if (template === undefined) {
    throw new Error(`'${templatePath}' is not a CloudFormation template object.`);
  }

  const resources = asRecord(template['Resources']) ?? {};
  const parameters = asRecord(template['Parameters']) ?? {};
  const outputs = asRecord(template['Outputs']) ?? {};

  // Resource-type check: only AWS::Organizations::Account is permitted.
  const resourceTypes = new Map<string, number>();
  for (const resource of Object.values(resources)) {
    const type = asRecord(resource)?.['Type'];
    const key = typeof type === 'string' ? type : 'unknown';
    resourceTypes.set(key, (resourceTypes.get(key) ?? 0) + 1);
  }
  const accountCount = resourceTypes.get(ACCOUNT_RESOURCE_TYPE) ?? 0;
  console.log(`  ${ACCOUNT_RESOURCE_TYPE}: ${accountCount}`);
  if (accountCount !== expectedAccountCount) {
    throw new Error(
      `Expected exactly ${expectedAccountCount} ${ACCOUNT_RESOURCE_TYPE} resources (matching the validated active ` +
        `configuration) but found ${accountCount}.`
    );
  }
  const unexpectedTypes = [...resourceTypes.keys()].filter((type) => type !== ACCOUNT_RESOURCE_TYPE);
  if (unexpectedTypes.length > 0) {
    throw new Error(
      `The Landing Zone accounts stack template must contain only ${ACCOUNT_RESOURCE_TYPE} resources but also ` +
        `contains: ${unexpectedTypes.join(', ')}.`
    );
  }

  // Every OU referenced by an active account must have a corresponding OuId* parameter.
  const requiredOuParameters = new Set<string>();
  for (const [, entry] of activeAccounts) {
    requiredOuParameters.add(ouPathToParameterName(entry.ouPath));
  }
  for (const parameterName of requiredOuParameters) {
    assertOuParameter(parameters, parameterName);
  }

  // No stray OuId parameters beyond what active accounts require.
  const observedOuParameters = Object.keys(parameters).filter((name) => name.startsWith('OuId'));
  for (const name of observedOuParameters) {
    if (!requiredOuParameters.has(name)) {
      throw new Error(
        `Template declares stray OU parameter '${name}' with no active account referencing it. Remove or use it.`
      );
    }
  }

  // Per-account validation.
  const observedByKey = new Map<string, { logicalId: string; email: string }>();
  const expectedByLogicalId = new Map<
    string,
    { key: string; entry: (typeof activeAccounts)[number][1]; parameterName: string }
  >();
  for (const [key, entry] of activeAccounts) {
    const logicalId = `${landingZoneAccountConstructId(key)}Resource`;
    expectedByLogicalId.set(logicalId, {
      key,
      entry,
      parameterName: ouPathToParameterName(entry.ouPath)
    });
  }

  for (const [logicalId, resource] of Object.entries(resources)) {
    const record = asRecord(resource);
    if (record?.['Type'] !== ACCOUNT_RESOURCE_TYPE) {
      continue;
    }
    const expectation = expectedByLogicalId.get(logicalId);
    if (expectation === undefined) {
      throw new Error(
        `Unexpected AWS::Organizations::Account resource '${logicalId}' in the template. Expected logical IDs: ` +
          `${[...expectedByLogicalId.keys()].join(', ')}.`
      );
    }

    assertRetainPolicies(logicalId, record);

    const properties = asRecord(record['Properties']);
    const name = properties?.['AccountName'];
    const email = properties?.['Email'];
    if (typeof name !== 'string' || typeof email !== 'string') {
      throw new Error(`Resource '${logicalId}' is missing a string AccountName or Email property.`);
    }
    if (name !== expectation.entry.name) {
      throw new Error(
        `Resource '${logicalId}' declares AccountName '${name}' but configuration for '${expectation.key}' expects '${expectation.entry.name}'.`
      );
    }
    if (email !== expectation.entry.email) {
      throw new Error(
        `Resource '${logicalId}' declares Email '${email}' but configuration for '${expectation.key}' expects '${expectation.entry.email}'.`
      );
    }
    assertParentReference(logicalId, properties?.['ParentIds'], expectation.parameterName);

    const tags = collectTags(logicalId, properties);
    const entry = expectation.entry;
    assertTagValue(logicalId, tags, 'owner', entry.owner);
    assertTagValue(logicalId, tags, 'owner-email', entry.email);
    assertTagValue(logicalId, tags, 'environment', entry.tags.environment);
    assertTagValue(logicalId, tags, 'lifecycle', entry.tags.lifecycle);
    assertTagValue(logicalId, tags, 'data-classification', entry.tags.dataClassification);
    assertTagValue(logicalId, tags, 'data-residency', 'EU');
    assertTagValue(logicalId, tags, 'itsystemcode', entry.costCentre);
    const observedDomain = tags.get('domain');
    if (observedDomain === undefined || observedDomain.length === 0) {
      throw new Error(`Resource '${logicalId}' tag 'domain' must be a non-empty configured value.`);
    }
    if (observedDomain !== entry.tags.domain) {
      throw new Error(
        `Resource '${logicalId}' tag 'domain' is '${observedDomain}' but configuration expects '${entry.tags.domain}'.`
      );
    }

    observedByKey.set(expectation.key, { logicalId, email });
  }

  for (const [key] of activeAccounts) {
    if (!observedByKey.has(key)) {
      throw new Error(`Configured account '${key}' is missing from the synthesized template.`);
    }
    const expectedOutput = `${ACCOUNT_ID_OUTPUT_PREFIX}${landingZoneAccountConstructId(key)}`;
    if (asRecord(outputs[expectedOutput]) === undefined) {
      throw new Error(`Template is missing the '${expectedOutput}' output for Landing Zone account '${key}'.`);
    }
  }

  const accountIdOutputs = Object.keys(outputs).filter((name) => name.startsWith(ACCOUNT_ID_OUTPUT_PREFIX));
  if (accountIdOutputs.length !== expectedAccountCount) {
    throw new Error(
      `Expected ${expectedAccountCount} '${ACCOUNT_ID_OUTPUT_PREFIX}*' outputs but found ${accountIdOutputs.length}.`
    );
  }
  const countOutput = asRecord(outputs[ACCOUNT_COUNT_OUTPUT_NAME]);
  if (countOutput?.['Value'] !== String(expectedAccountCount)) {
    throw new Error(`Output '${ACCOUNT_COUNT_OUTPUT_NAME}' must equal '${expectedAccountCount}'.`);
  }

  assertNoExports(outputs);
  assertNoImportValue(templateJson, templatePath);
  assertEscCorrectness(templateJson, templatePath);

  // Indexed access guarded to satisfy `noUncheckedIndexedAccess`; every key in `observedByKey`
  // originates from the same `activeAccounts` iteration used to build the expectation map, so
  // the invariant holds and the guard is defensive.
  for (const [key, observed] of observedByKey) {
    const entry = config.landingZoneAccounts[key];
    if (entry === undefined) {
      throw new Error(`Configured account '${key}' disappeared from the validated configuration.`);
    }
    console.log(`  ok  ${key} (${entry.name}) -> ${observed.logicalId} (domain='${entry.tags.domain}')`);
  }
  console.log(`\n  OK: ${environment} Landing Zone accounts template matches the approved design.`);
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2));
  console.log('Validating synthesized AWS ESC Landing Zone accounts templates');

  for (const environment of options.environments) {
    validateEnvironment(environment, options);
  }

  console.log(`\nAll requested templates are valid: ${options.environments.join(', ')}.`);
}

try {
  main();
} catch (error) {
  console.error(`\nLanding Zone accounts template validation failed.\n${(error as Error).message}`);
  process.exitCode = 1;
}
