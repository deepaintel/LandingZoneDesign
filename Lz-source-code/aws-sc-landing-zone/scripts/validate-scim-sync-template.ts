#!/usr/bin/env tsx
/**
 * Validates a synthesized SCIM synchronization template against the configured Lambda and
 * workflow contract. Runs entirely offline against cdk.out - no AWS calls or deployment.
 *
 * Usage:
 *   pnpm run synth:staging && pnpm run validate:scim-sync-template -- --environment staging --output-dir cdk.out/staging
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';

const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
const STACK_NAME = 'lz-scim-sync';
const LAMBDA_RESOURCE_TYPE = 'AWS::Lambda::Function';
const STATE_MACHINE_RESOURCE_TYPE = 'AWS::StepFunctions::StateMachine';
const RULE_RESOURCE_TYPE = 'AWS::Events::Rule';
const EXPECTED_LAMBDA_COUNT = 6;
const EXPECTED_STATE_MACHINE_COUNT = 1;
const EXPECTED_RULE_COUNT = 1;
const EXPECTED_RUNTIME = 'nodejs24.x';
const EXPECTED_MEMORY_SIZE = 1024;
const EXPECTED_TIMEOUT = 60;
const ESC_REGION = 'eusc-de-east-1';
const COMMERCIAL_ARN_PREFIX = ['arn', 'aws', ''].join(':');
const COMMERCIAL_STS_ENDPOINT = ['sts', 'amazonaws', 'com'].join('.');
const COMMERCIAL_REGION_PATTERN = /\b(?:us|eu|ap|sa|ca|me|af|il|cn)-(?:gov-)?[a-z]+-\d\b/g;
const RETIRED_ENVIRONMENT_NAMES = ['develop', 'dev', 'development'] as const;
const ALLOWED_RESOURCE_TYPES = new Set([
  'AWS::Events::Rule',
  'AWS::IAM::Policy',
  'AWS::IAM::Role',
  'AWS::Lambda::Function',
  'AWS::StepFunctions::StateMachine'
]);

type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

type JsonRecord = Record<string, unknown>;

interface CliOptions {
  readonly environment: EnvironmentName;
  readonly outputDir: string;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined;
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
    if (properties?.['stackName'] === STACK_NAME && typeof properties['templateFile'] === 'string') {
      return resolve(absoluteOutputDir, properties['templateFile']);
    }
  }

  throw new Error(`Cloud assembly contains no '${STACK_NAME}' stack artifact.`);
}

function resourceProperties(resource: JsonRecord, logicalId: string): JsonRecord {
  const properties = asRecord(resource['Properties']);
  if (properties === undefined) {
    throw new Error(`Resource '${logicalId}' has no Properties object.`);
  }
  return properties;
}

function resourceTypeCounts(resources: JsonRecord): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [logicalId, resource] of Object.entries(resources)) {
    const record = asRecord(resource);
    const type = record?.['Type'];
    if (typeof type !== 'string') {
      throw new Error(`Resource '${logicalId}' has no string Type.`);
    }
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return counts;
}

function expectResourceCount(counts: Map<string, number>, type: string, expected: number): void {
  const actual = counts.get(type) ?? 0;
  if (actual !== expected) {
    throw new Error(`Expected ${expected} ${type} resources, found ${actual}.`);
  }
}

function renderIntrinsic(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  const record = asRecord(value);
  if (record?.['Fn::Join'] !== undefined) {
    const join = record['Fn::Join'];
    if (!Array.isArray(join) || join.length !== 2 || typeof join[0] !== 'string' || !Array.isArray(join[1])) {
      throw new Error('Unsupported Fn::Join shape in the SCIM state machine definition.');
    }
    return join[1].map(renderIntrinsic).join(join[0]);
  }

  if (record?.['Ref'] !== undefined || record?.['Fn::GetAtt'] !== undefined) {
    return 'CloudFormationReference';
  }

  throw new Error('Unsupported intrinsic in the SCIM state machine definition.');
}

// Mirrors aws-cdk-lib's Schedule.rate(), which prefers days, then hours, then minutes.
function expectedRateExpression(seconds: number): string {
  const pluralize = (value: number, unit: string): string => `rate(${value} ${unit}${value === 1 ? '' : 's'})`;

  if (seconds % 86400 === 0) {
    return pluralize(seconds / 86400, 'day');
  }
  if (seconds % 3600 === 0) {
    return pluralize(seconds / 3600, 'hour');
  }
  if (seconds % 60 === 0) {
    return pluralize(seconds / 60, 'minute');
  }
  return `rate(${seconds} seconds)`;
}

function assertEscCorrectness(templateJson: string, templatePath: string): void {
  const sanitized = templateJson.split(ESC_REGION).join('<esc-region>');
  if (sanitized.includes(COMMERCIAL_ARN_PREFIX)) {
    throw new Error(`'${templatePath}' contains a commercial ARN prefix.`);
  }
  if (sanitized.includes(COMMERCIAL_STS_ENDPOINT)) {
    throw new Error(`'${templatePath}' references the commercial STS endpoint.`);
  }
  const commercialRegions = [...new Set(sanitized.match(COMMERCIAL_REGION_PATTERN) ?? [])];
  if (commercialRegions.length > 0) {
    throw new Error(`'${templatePath}' references non-ESC Region(s): ${commercialRegions.join(', ')}.`);
  }
  const retired = RETIRED_ENVIRONMENT_NAMES.filter((name) => sanitized.toLowerCase().includes(name));
  if (retired.length > 0) {
    throw new Error(`'${templatePath}' references the retired environment model: ${retired.join(', ')}.`);
  }
}

function validateTemplate(environment: EnvironmentName, outputDir: string): void {
  const config = new ConfigReader(environment, {
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();
  const templatePath = locateTemplate(outputDir);
  const templateJson = readFileSync(templatePath, 'utf8');
  const template = asRecord(JSON.parse(templateJson) as unknown);
  if (template === undefined) {
    throw new Error(`'${templatePath}' is not a CloudFormation template object.`);
  }

  const resources = asRecord(template['Resources']) ?? {};
  const counts = resourceTypeCounts(resources);
  expectResourceCount(counts, LAMBDA_RESOURCE_TYPE, EXPECTED_LAMBDA_COUNT);
  expectResourceCount(counts, STATE_MACHINE_RESOURCE_TYPE, EXPECTED_STATE_MACHINE_COUNT);
  expectResourceCount(counts, RULE_RESOURCE_TYPE, EXPECTED_RULE_COUNT);

  for (const type of counts.keys()) {
    if (!ALLOWED_RESOURCE_TYPES.has(type)) {
      throw new Error(`Unexpected resource type '${type}' in the SCIM synchronization template.`);
    }
  }

  const lambdaFunctions = Object.entries(resources).filter(
    ([, resource]) => asRecord(resource)?.['Type'] === LAMBDA_RESOURCE_TYPE
  );
  for (const [logicalId, resource] of lambdaFunctions) {
    const properties = resourceProperties(asRecord(resource) ?? {}, logicalId);
    if (properties['Runtime'] !== EXPECTED_RUNTIME) {
      throw new Error(`Lambda '${logicalId}' must use runtime '${EXPECTED_RUNTIME}'.`);
    }
    if (properties['MemorySize'] !== EXPECTED_MEMORY_SIZE || properties['Timeout'] !== EXPECTED_TIMEOUT) {
      throw new Error(`Lambda '${logicalId}' must use ${EXPECTED_MEMORY_SIZE} MB and ${EXPECTED_TIMEOUT} seconds.`);
    }
    if (asRecord(properties['TracingConfig'])?.['Mode'] !== 'Active') {
      throw new Error(`Lambda '${logicalId}' must have active tracing enabled.`);
    }
  }

  const stateMachineEntry = Object.entries(resources).find(
    ([, resource]) => asRecord(resource)?.['Type'] === STATE_MACHINE_RESOURCE_TYPE
  );
  if (stateMachineEntry === undefined) {
    throw new Error('SCIM state machine resource is missing.');
  }
  const stateMachineProperties = resourceProperties(asRecord(stateMachineEntry[1]) ?? {}, stateMachineEntry[0]);
  const definitionString = renderIntrinsic(stateMachineProperties['DefinitionString']);
  const definition = JSON.parse(definitionString) as JsonRecord;
  const states = asRecord(definition['States']);
  if (definition['StartAt'] !== 'GetAllAccountIdsTask' || states === undefined) {
    throw new Error('SCIM state machine must start at GetAllAccountIdsTask and declare States.');
  }
  const waitState = asRecord(states['Wait']);
  if (
    waitState?.['Type'] !== 'Wait' ||
    waitState['Seconds'] !== config.identityCenter.scim.queryAccountAssignmentStatus
  ) {
    throw new Error('SCIM state machine Wait interval does not match configuration.');
  }

  const ruleEntry = Object.entries(resources).find(
    ([, resource]) => asRecord(resource)?.['Type'] === RULE_RESOURCE_TYPE
  );
  if (ruleEntry === undefined) {
    throw new Error('SCIM schedule rule resource is missing.');
  }
  const ruleProperties = resourceProperties(asRecord(ruleEntry[1]) ?? {}, ruleEntry[0]);
  const expectedRate = expectedRateExpression(config.identityCenter.scim.checkForScimSync);
  if (ruleProperties['ScheduleExpression'] !== expectedRate) {
    throw new Error(
      `SCIM schedule must use '${expectedRate}', found '${String(ruleProperties['ScheduleExpression'])}'.`
    );
  }

  assertEscCorrectness(templateJson, templatePath);
  console.log(`SCIM synchronization template validation passed for ${environment}: ${templatePath}`);
}

const options = parseOptions(process.argv.slice(2));
validateTemplate(options.environment, options.outputDir);
