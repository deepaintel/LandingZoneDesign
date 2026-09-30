#!/usr/bin/env tsx
/**
 * Validates a synthesized OU Structure template against the approved design.
 *
 * Runs entirely offline against `cdk.out` - no AWS calls, no deployment. Intended to run in CI
 * immediately after `cdk synth`:
 *
 *   pnpm run synth:staging && pnpm run validate:ou-template:staging
 *   pnpm run validate:ou-template -- --environment production --output-dir cdk.out/production
 *
 * Assertions:
 *  1. exactly `expectedOrganizationalUnitCount` AWS::Organizations::OrganizationalUnit resources;
 *  2. zero AWS::Organizations::Account resources;
 *  3. zero AWS::Organizations::Policy resources;
 *  4. no other resource types at all (no IAM, KMS, logging, StackSets, tagging, networking);
 *  5. the OrganizationRootId parameter exists and is pattern-constrained;
 *  6. no OU declares a literal parent ID - L1 OUs reference the Root parameter, deeper OUs
 *     reference their parent resource through Fn::GetAtt;
 *  7. the hierarchy reconstructed from the template matches the configured hierarchy exactly;
 *  8. one OU ID output per OU plus the OU count output;
 *  9. ESC correctness: no commercial ARN prefix, no commercial Region, no commercial STS endpoint;
 * 10. no reference to the retired `develop` environment model.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema, type LandingZoneConfig } from '../config/schemas/organization-schema.js';

const ACCOUNT_RESOURCE_TYPE = 'AWS::Organizations::Account';
const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
const ESC_REGION = 'eusc-de-east-1';
const ORGANIZATION_ROOT_ID_PARAMETER_NAME = 'OrganizationRootId';
const ORGANIZATION_ROOT_ID_PATTERN = /^r-[0-9a-z]{4,32}$/;
const OU_COUNT_OUTPUT_NAME = 'OrganizationalUnitCount';
const OU_ID_OUTPUT_PREFIX = 'OuId';
const OU_RESOURCE_TYPE = 'AWS::Organizations::OrganizationalUnit';
const POLICY_RESOURCE_TYPE = 'AWS::Organizations::Policy';
const RETIRED_ENVIRONMENT_NAMES = ['develop', 'dev', 'development'] as const;
const ROOT_DISPLAY_NAME = 'Root';
const ROOT_PARENT_KEY = 'root';
const EXPECTED_OU_COUNT = 14;
type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

const COMMERCIAL_REGION_PATTERN = /\b(?:us|eu|ap|sa|ca|me|af|il|cn)-(?:gov-)?[a-z]+-\d\b/g;
const COMMERCIAL_ARN_PREFIX = ['arn', 'aws', ''].join(':');
const COMMERCIAL_STS_ENDPOINT = ['sts', 'amazonaws', 'com'].join('.');

interface CliOptions {
  readonly environments: readonly EnvironmentName[];
  readonly outputDir: string | undefined;
  readonly templatePath: string | undefined;
}

type ParentReference = { readonly kind: 'root' } | { readonly kind: 'organizationalUnit'; readonly logicalId: string };

interface TemplateOrganizationalUnit {
  readonly logicalId: string;
  readonly name: string;
  readonly parent: ParentReference;
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

/** Locates the synthesized template for a stack, preferring the cloud assembly manifest. */
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
      if (properties?.['stackName'] !== 'lz-ou-structure') {
        continue;
      }

      const templateFile = properties['templateFile'];
      if (typeof templateFile === 'string') {
        return resolve(outputDir, templateFile);
      }
    }

    throw new Error(
      `Cloud assembly '${manifestPath}' contains no OU Structure stack artifact. ` +
        `Run: pnpm run synth:${environment}`
    );
  }

  const fallbacks = [
    resolve(outputDir, 'lz-ou-structure.template.json'),
    resolve(outputDir, 'OuStructureStack.template.json')
  ];
  const found = fallbacks.find((candidate) => existsSync(candidate));

  if (found === undefined) {
    throw new Error(`No synthesized template found under '${outputDir}'. Run: pnpm run synth:${environment}`);
  }

  return found;
}

function parseParentReference(logicalId: string, parentId: unknown): ParentReference {
  if (typeof parentId === 'string') {
    throw new Error(
      `Resource '${logicalId}' declares a literal ParentId '${parentId}'. Parent containers must be referenced ` +
        `through the ${ORGANIZATION_ROOT_ID_PARAMETER_NAME} parameter or Fn::GetAtt on the parent resource.`
    );
  }

  const reference = asRecord(parentId);
  if (reference === undefined) {
    throw new Error(`Resource '${logicalId}' has an unreadable ParentId.`);
  }

  const ref = reference['Ref'];
  if (typeof ref === 'string') {
    if (ref !== ORGANIZATION_ROOT_ID_PARAMETER_NAME) {
      throw new Error(
        `Resource '${logicalId}' references '${ref}' as its parent. Top-level OUs must reference the ` +
          `${ORGANIZATION_ROOT_ID_PARAMETER_NAME} parameter.`
      );
    }
    return { kind: 'root' };
  }

  const getAtt = reference['Fn::GetAtt'];
  if (Array.isArray(getAtt) && getAtt.length === 2) {
    const target = getAtt[0];
    const attribute = getAtt[1];
    if (typeof target === 'string' && attribute === 'Id') {
      return { kind: 'organizationalUnit', logicalId: target };
    }
  }

  throw new Error(`Resource '${logicalId}' has an unsupported ParentId expression: ${JSON.stringify(parentId)}`);
}

function collectOrganizationalUnits(resources: Record<string, unknown>): TemplateOrganizationalUnit[] {
  const units: TemplateOrganizationalUnit[] = [];

  for (const [logicalId, resource] of Object.entries(resources)) {
    const record = asRecord(resource);
    if (record?.['Type'] !== OU_RESOURCE_TYPE) {
      continue;
    }

    const properties = asRecord(record['Properties']);
    const name = properties?.['Name'];
    if (typeof name !== 'string') {
      throw new Error(`Resource '${logicalId}' has no string Name property.`);
    }

    units.push({ logicalId, name, parent: parseParentReference(logicalId, properties?.['ParentId']) });
  }

  return units;
}

/** Rebuilds `Root/A/B/C` paths purely from the template graph, so nothing depends on logical-ID naming. */
function reconstructPaths(units: readonly TemplateOrganizationalUnit[]): string[] {
  const byLogicalId = new Map<string, TemplateOrganizationalUnit>();
  for (const unit of units) {
    byLogicalId.set(unit.logicalId, unit);
  }

  return units.map((unit) => {
    const segments: string[] = [];
    const visited = new Set<string>();
    let cursor: TemplateOrganizationalUnit | undefined = unit;

    while (cursor !== undefined) {
      if (visited.has(cursor.logicalId)) {
        throw new Error(`Circular parent reference detected in the synthesized template at '${cursor.logicalId}'.`);
      }
      visited.add(cursor.logicalId);
      segments.unshift(cursor.name);

      if (cursor.parent.kind === 'root') {
        break;
      }

      const parent = byLogicalId.get(cursor.parent.logicalId);
      if (parent === undefined) {
        throw new Error(
          `Resource '${cursor.logicalId}' references parent '${cursor.parent.logicalId}', which is not an ` +
            'organizational unit in this template.'
        );
      }
      cursor = parent;
    }

    return [ROOT_DISPLAY_NAME, ...segments].join('/');
  });
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

function resolveConfiguredPaths(config: LandingZoneConfig): string[] {
  const unitsByKey = new Map(config.organization.organizationalUnits.map((unit) => [unit.key, unit]));

  return config.organization.organizationalUnits.map((unit) => {
    const ancestors: string[] = [];
    let currentKey: string | undefined = unit.key;

    while (currentKey !== ROOT_PARENT_KEY) {
      if (currentKey === undefined) {
        throw new Error(`Configuration contains an unresolved parent for OU '${unit.key}'.`);
      }

      const current = unitsByKey.get(currentKey);
      if (current === undefined) {
        throw new Error(`Configuration contains an unresolved parent '${currentKey}'.`);
      }

      ancestors.unshift(current.name);
      currentKey = current.parent;
    }

    return [ROOT_DISPLAY_NAME, ...ancestors].join('/');
  });
}

function validateEnvironment(environment: EnvironmentName, options: CliOptions): void {
  const config = new ConfigReader(environment, { configDirName: 'config', schema: LandingZoneSchema }).getConfig();
  const expectedPaths = resolveConfiguredPaths(config);
  const templatePath = locateTemplate(environment, options);

  console.log(`\n=== ${environment} :: lz-ou-structure ===`);
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

  const ouCount = resourceTypes.get(OU_RESOURCE_TYPE) ?? 0;
  const accountCount = resourceTypes.get(ACCOUNT_RESOURCE_TYPE) ?? 0;
  const policyCount = resourceTypes.get(POLICY_RESOURCE_TYPE) ?? 0;

  console.log(`  ${OU_RESOURCE_TYPE}: ${ouCount}`);
  console.log(`  ${ACCOUNT_RESOURCE_TYPE}: ${accountCount}`);
  console.log(`  ${POLICY_RESOURCE_TYPE}: ${policyCount}`);

  if (ouCount !== EXPECTED_OU_COUNT) {
    throw new Error(`Expected exactly ${EXPECTED_OU_COUNT} ${OU_RESOURCE_TYPE} resources ` + `but found ${ouCount}.`);
  }

  if (accountCount !== 0) {
    throw new Error(`Expected zero ${ACCOUNT_RESOURCE_TYPE} resources but found ${accountCount}.`);
  }

  if (policyCount !== 0) {
    throw new Error(`Expected zero ${POLICY_RESOURCE_TYPE} resources but found ${policyCount}.`);
  }

  const unexpectedTypes = [...resourceTypes.keys()].filter((type) => type !== OU_RESOURCE_TYPE);
  if (unexpectedTypes.length > 0) {
    throw new Error(
      `The OU phase template must contain only ${OU_RESOURCE_TYPE} resources but also contains: ` +
        `${unexpectedTypes.join(', ')}.`
    );
  }

  const rootParameter = asRecord(parameters[ORGANIZATION_ROOT_ID_PARAMETER_NAME]);
  if (rootParameter === undefined) {
    throw new Error(
      `Template is missing the ${ORGANIZATION_ROOT_ID_PARAMETER_NAME} parameter. The existing Organizations Root ID ` +
        'must be supplied externally at deployment time.'
    );
  }

  if (rootParameter['AllowedPattern'] !== ORGANIZATION_ROOT_ID_PATTERN.source) {
    throw new Error(
      `${ORGANIZATION_ROOT_ID_PARAMETER_NAME} must constrain its value with AllowedPattern ` +
        `'${ORGANIZATION_ROOT_ID_PATTERN.source}'.`
    );
  }

  const units = collectOrganizationalUnits(resources);
  const actualPaths = reconstructPaths(units).sort();
  expectedPaths.sort();

  const missing = expectedPaths.filter((path) => !actualPaths.includes(path));
  const extra = actualPaths.filter((path) => !expectedPaths.includes(path));

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      'Synthesized OU hierarchy does not match the approved design.' +
        (missing.length > 0 ? `\n  missing: ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `\n  unexpected: ${extra.join(', ')}` : '')
    );
  }

  const l1Count = units.filter((unit) => unit.parent.kind === 'root').length;
  const expectedL1Count = config.organization.organizationalUnits.filter(
    (unit) => unit.parent === ROOT_PARENT_KEY
  ).length;
  if (l1Count !== expectedL1Count) {
    throw new Error(`Expected ${expectedL1Count} OUs directly below the Root but found ${l1Count}.`);
  }

  const ouIdOutputs = Object.keys(outputs).filter((key) => key.startsWith(OU_ID_OUTPUT_PREFIX));
  if (ouIdOutputs.length !== ouCount) {
    throw new Error(`Expected ${ouCount} '${OU_ID_OUTPUT_PREFIX}*' outputs but found ${ouIdOutputs.length}.`);
  }

  const countOutput = asRecord(outputs[OU_COUNT_OUTPUT_NAME]);
  if (countOutput?.['Value'] !== String(ouCount)) {
    throw new Error(`Output '${OU_COUNT_OUTPUT_NAME}' must equal '${ouCount}'.`);
  }

  assertEscCorrectness(templateJson, templatePath);

  for (const path of expectedPaths) {
    console.log(`  ok  ${path}`);
  }
  console.log(`\n  OK: ${environment} OU template matches the approved 14-OU design.`);
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2));
  console.log('Validating synthesized AWS ESC Landing Zone OU templates');

  for (const environment of options.environments) {
    validateEnvironment(environment, options);
  }

  console.log(`\nAll requested templates are valid: ${options.environments.join(', ')}.`);
}

try {
  main();
} catch (error) {
  console.error(`\nOU template validation failed.\n${(error as Error).message}`);
  process.exitCode = 1;
}
