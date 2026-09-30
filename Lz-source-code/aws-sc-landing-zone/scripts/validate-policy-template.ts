#!/usr/bin/env tsx
/**
 * Validates a synthesized Organization Policy template against the approved SCP / RCP catalogue.
 *
 * Runs entirely offline against `cdk.out` - no AWS calls, no deployment. Intended to run in CI
 * immediately after `cdk synth`:
 *
 *   pnpm run synth:staging && pnpm run validate:policy-template -- --environment staging --output-dir cdk.out/staging
 *
 * Assertions:
 *  1. exactly the approved number of AWS::Organizations::Policy resources;
 *  2. exactly the approved policy names - nothing missing, nothing unexpected;
 *  3. every SCP carries type SERVICE_CONTROL_POLICY and every RCP carries RESOURCE_CONTROL_POLICY;
 *  4. no withheld policy synthesizes;
 *  5. zero AWS::Organizations::Account resources and no other resource type at all;
 *  6. the OrganizationRootId, OrganizationId, and one OuId<PascalCase(key)> parameter per OU in the
 *     shared organization configuration all exist and are pattern-constrained;
 *  7. every attachment target is a Ref to one of those stack-local parameters - never a literal
 *     Root ID, OU ID or AWS account ID, and never an Fn::ImportValue / Fn::GetAtt into another
 *     stack (a cross-stack reference would recouple this stack to the OU stack);
 *  8. the Root / OU attachment matrix matches the approved design exactly;
 *  9. no AWS account ID or literal Organization ID appears anywhere in the template;
 * 10. ESC correctness: no commercial ARN prefix, no commercial Region, no commercial STS endpoint;
 * 11. every policy document parses, declares the policy language version, and has statements.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import { ouIdParameterName } from '../lib/organization/organization-policy-stack.js';
import {
  resolveActivePolicies,
  withheldPolicies,
  type OrganizationsPolicyDefinition
} from '../lib/organization/policies/index.js';

const ACCOUNT_RESOURCE_TYPE = 'AWS::Organizations::Account';
const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
const ESC_REGION = 'eusc-de-east-1';
const ORGANIZATION_ID_PARAMETER_NAME = 'OrganizationId';
const ORGANIZATION_ID_PATTERN = /^o-[0-9a-z]{10,32}$/;
const ORGANIZATION_ROOT_ID_PARAMETER_NAME = 'OrganizationRootId';
const ORGANIZATION_ROOT_ID_PATTERN = /^r-[0-9a-z]{4,32}$/;
const OU_ID_PARAMETER_PREFIX = 'OuId';
const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const POLICY_DOCUMENT_VERSION = '2012-10-17';
const POLICY_RESOURCE_TYPE = 'AWS::Organizations::Policy';
const POLICY_STACK_NAME = 'lz-organization-policies';
const ROOT_TARGET_KEY = 'root';

const COMMERCIAL_ARN_PREFIX = ['arn', 'aws', ''].join(':');
const COMMERCIAL_REGION_PATTERN = /\b(?:us|eu|ap|sa|ca|me|af|il|cn)-(?:gov-)?[a-z]+-\d\b/g;
const COMMERCIAL_STS_ENDPOINT = ['sts', 'amazonaws', 'com'].join('.');
const ACCOUNT_ID_PATTERN = /\b[0-9]{12}\b/;
const LITERAL_ORGANIZATION_ID_PATTERN = /\bo-[0-9a-z]{10,32}\b/;

/**
 * AWS Control Tower compatibility exemptions permitted by
 * `.apm/instructions/control-tower-scp-compatibility.instructions.md`. The approved plan touches
 * exactly the four SIDs below, exempting either the AWS Control Tower service-linked role
 * (`AWSServiceRoleForAWSControlTower`) or the member-account execution role
 * (`AWSControlTowerExecution`). The validator fails synthesis if any of the four SIDs synthesizes
 * without its expected exemption, and if any Control Tower ARN appears in a policy outside the
 * approved scope.
 */
const CT_ARN_PREFIX = 'arn:aws-eusc:iam::*:role/';
const CONTROL_TOWER_SLR_ARN = `${CT_ARN_PREFIX}aws-service-role/controltower.amazonaws.com/AWSServiceRoleForAWSControlTower`;
const CONTROL_TOWER_EXECUTION_ARN = `${CT_ARN_PREFIX}AWSControlTowerExecution`;

interface ControlTowerExemption {
  readonly policyName: string;
  readonly sid: string;
  readonly principalArn: string;
}

const EXPECTED_CONTROL_TOWER_EXEMPTIONS: readonly ControlTowerExemption[] = [
  {
    policyName: 'SCP-ESC-ROOT-003',
    sid: 'ScpEscRoot003DenyPolicyGovernanceChanges',
    principalArn: CONTROL_TOWER_SLR_ARN
  },
  { policyName: 'SCP-ESC-SEC-001', sid: 'ScpEscSec001ProtectCloudTrail', principalArn: CONTROL_TOWER_SLR_ARN },
  {
    policyName: 'SCP-ESC-SEC-001',
    sid: 'ScpEscSec001ProtectConfigRecorder',
    principalArn: CONTROL_TOWER_EXECUTION_ARN
  },
  {
    policyName: 'SCP-ESC-SEC-002',
    sid: 'ScpEscSec002ProtectObjectLockImmutability',
    principalArn: CONTROL_TOWER_EXECUTION_ARN
  },
  {
    policyName: 'SCP-ESC-SEC-003',
    sid: 'ScpEscSec003ProtectConfigAggregator',
    principalArn: CONTROL_TOWER_EXECUTION_ARN
  },
  {
    policyName: 'SCP-ESC-ENC-001',
    sid: 'ScpEscEnc001DenyKeyTagTampering',
    principalArn: CONTROL_TOWER_EXECUTION_ARN
  }
];

const CONTROL_TOWER_EXEMPTION_POLICIES = new Set(EXPECTED_CONTROL_TOWER_EXEMPTIONS.map((entry) => entry.policyName));

type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

interface CliOptions {
  readonly environments: readonly EnvironmentName[];
  readonly outputDir: string | undefined;
  readonly templatePath: string | undefined;
}

interface TemplatePolicy {
  readonly logicalId: string;
  readonly name: string;
  readonly type: string;
  readonly targetIds: readonly unknown[];
  readonly content: unknown;
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

/** Locates the synthesized policy template, preferring the cloud assembly manifest. */
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
      if (properties?.['stackName'] !== POLICY_STACK_NAME) {
        continue;
      }

      const templateFile = properties['templateFile'];
      if (typeof templateFile === 'string') {
        return resolve(outputDir, templateFile);
      }
    }

    throw new Error(
      `Cloud assembly '${manifestPath}' contains no '${POLICY_STACK_NAME}' artifact. ` +
        `Run: pnpm run synth:${environment}`
    );
  }

  const fallbacks = [
    resolve(outputDir, `${POLICY_STACK_NAME}.template.json`),
    resolve(outputDir, 'OrganizationPolicyStack.template.json')
  ];
  const found = fallbacks.find((candidate) => existsSync(candidate));

  if (found === undefined) {
    throw new Error(`No synthesized policy template found under '${outputDir}'. Run: pnpm run synth:${environment}`);
  }

  return found;
}

function collectPolicies(resources: Record<string, unknown>): TemplatePolicy[] {
  const policies: TemplatePolicy[] = [];

  for (const [logicalId, resource] of Object.entries(resources)) {
    const record = asRecord(resource);
    if (record?.['Type'] !== POLICY_RESOURCE_TYPE) {
      continue;
    }

    const properties = asRecord(record['Properties']);
    const name = properties?.['Name'];
    const type = properties?.['Type'];
    const targetIds = properties?.['TargetIds'];

    if (typeof name !== 'string') {
      throw new Error(`Resource '${logicalId}' has no string Name property.`);
    }
    if (typeof type !== 'string') {
      throw new Error(`Resource '${logicalId}' has no string Type property.`);
    }
    if (!Array.isArray(targetIds)) {
      throw new Error(`Resource '${logicalId}' has no TargetIds array.`);
    }

    policies.push({ logicalId, name, type, targetIds, content: properties?.['Content'] });
  }

  return policies;
}

/**
 * Classifies an attachment target. Root targets reference the `OrganizationRootId` parameter and OU
 * targets reference an `OuId<PascalCase(key)>` parameter declared on the same stack. Literal IDs are
 * a defect, and so is any `Fn::ImportValue` / `Fn::GetAtt` intrinsic - those would recouple the
 * policy stack to the OU stack through a CloudFormation Export / ImportValue link, which we
 * removed on purpose to keep the two stacks isolated.
 */
function classifyTarget(
  policyName: string,
  targetId: unknown
): { kind: 'root' } | { kind: 'ou'; parameterName: string } {
  if (typeof targetId === 'string') {
    throw new Error(
      `Policy '${policyName}' declares the literal attachment target '${targetId}'. Targets must reference the ` +
        `${ORGANIZATION_ROOT_ID_PARAMETER_NAME} parameter or an ${OU_ID_PARAMETER_PREFIX}<PascalCase(key)> parameter.`
    );
  }

  const reference = asRecord(targetId);
  if (reference === undefined) {
    throw new Error(`Policy '${policyName}' has an unreadable attachment target.`);
  }

  if (typeof reference['Fn::ImportValue'] !== 'undefined' || typeof reference['Fn::GetAtt'] !== 'undefined') {
    throw new Error(
      `Policy '${policyName}' references another stack through ${JSON.stringify(targetId)}. The policy stack must ` +
        'be isolated from the OU stack - every target must be a Ref to a stack-local CloudFormation parameter.'
    );
  }

  const ref = reference['Ref'];
  if (typeof ref === 'string') {
    if (ref === ORGANIZATION_ROOT_ID_PARAMETER_NAME) {
      return { kind: 'root' };
    }
    if (ref.startsWith(OU_ID_PARAMETER_PREFIX)) {
      return { kind: 'ou', parameterName: ref };
    }
    throw new Error(
      `Policy '${policyName}' references '${ref}' as an attachment target. Root attachment must use the ` +
        `${ORGANIZATION_ROOT_ID_PARAMETER_NAME} parameter and OU attachment must use an ` +
        `${OU_ID_PARAMETER_PREFIX}<PascalCase(key)> parameter declared on this stack.`
    );
  }

  throw new Error(`Policy '${policyName}' has an unsupported attachment target: ${JSON.stringify(targetId)}`);
}

/**
 * Reads a synthesized Content property as a policy document.
 *
 * `CfnPolicy.content` is a CloudFormation Json-typed property, so the synthesized template carries the
 * document as an OBJECT. A deployment-time parameter appears inside it as a nested `Ref` intrinsic.
 */
function policyDocumentOf(policyName: string, content: unknown): Record<string, unknown> {
  const document = asRecord(content);
  if (document === undefined) {
    throw new Error(`Policy '${policyName}' has an unreadable Content object.`);
  }
  return document;
}

/**
 * Reads the `Condition.StringNotLike['aws:PrincipalArn']` exemption list from a statement.
 *
 * A missing StringNotLike operator returns `[]`; a single string value is wrapped so callers can
 * do a simple `.includes(...)` check.
 */
function principalExemptionList(entry: unknown): readonly string[] {
  const condition = asRecord(asRecord(entry)?.['Condition']);
  const stringNotLike = asRecord(condition?.['StringNotLike']);
  const value = stringNotLike?.['aws:PrincipalArn'];
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  return typeof value === 'string' ? [value] : [];
}

/**
 * Verifies the four AWS Control Tower compatibility exemptions expected by the approved plan and
 * refuses to accept a Control Tower ARN inside any other policy. A config-only regression that
 * empties the exemption list, or a copy-paste mistake that leaks a CT ARN into an unrelated
 * policy, fails synthesis here rather than at deploy time.
 */
function assertControlTowerExemptions(policies: readonly TemplatePolicy[]): void {
  const policyByName = new Map(policies.map((policy) => [policy.name, policy]));

  for (const { policyName, sid, principalArn } of EXPECTED_CONTROL_TOWER_EXEMPTIONS) {
    const policy = policyByName.get(policyName);
    if (policy === undefined) {
      throw new Error(
        `Policy '${policyName}' expected to carry a Control Tower exemption on SID '${sid}' was not found.`
      );
    }
    const document = policyDocumentOf(policyName, policy.content);
    const statements = document['Statement'];
    if (!Array.isArray(statements)) {
      throw new Error(`Policy '${policyName}' has no Statement array.`);
    }
    const statement = statements.find((entry) => asRecord(entry)?.['Sid'] === sid);
    if (statement === undefined) {
      throw new Error(
        `Policy '${policyName}' is missing statement '${sid}' expected to carry a Control Tower exemption.`
      );
    }
    const exemptions = principalExemptionList(statement);
    if (!exemptions.includes(principalArn)) {
      throw new Error(
        `Policy '${policyName}' SID '${sid}' must exempt '${principalArn}' in ` +
          `Condition.StringNotLike['aws:PrincipalArn'] per the approved Control Tower compatibility plan, but the ` +
          `exemption list is ${JSON.stringify(exemptions)}.`
      );
    }
  }

  // Negative scope: no Control Tower ARN may appear inside a policy that is not one of the four
  // in-scope compatibility policies. Catches both accidental leakage (copy-paste) and any future
  // config change that broadcasts CT exemptions to unrelated policies.
  for (const policy of policies) {
    if (CONTROL_TOWER_EXEMPTION_POLICIES.has(policy.name)) {
      continue;
    }
    const serialized = JSON.stringify(policyDocumentOf(policy.name, policy.content));
    if (serialized.includes(CONTROL_TOWER_SLR_ARN)) {
      throw new Error(
        `Policy '${policy.name}' contains the AWS Control Tower service-linked role ARN but is not in the approved ` +
          'Control Tower compatibility scope.'
      );
    }
    if (serialized.includes(CONTROL_TOWER_EXECUTION_ARN)) {
      throw new Error(
        `Policy '${policy.name}' contains the AWS Control Tower execution-role ARN but is not in the approved ` +
          'Control Tower compatibility scope.'
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
      `'${templatePath}' references non-ESC Region(s): ${commercialRegions.join(', ')}. ` +
        `Only ${ESC_REGION} is permitted.`
    );
  }
}

function expectedAttachmentMatrix(definitions: readonly OrganizationsPolicyDefinition[]): Map<string, string[]> {
  const matrix = new Map<string, string[]>();

  for (const definition of definitions) {
    for (const targetKey of definition.targetKeys) {
      const existing = matrix.get(targetKey) ?? [];
      existing.push(definition.policyId);
      matrix.set(targetKey, existing);
    }
  }

  return matrix;
}

/**
 * Loads the merged Landing Zone configuration for an environment through the same reader the CDK
 * app uses. Returns the governance block (for the deployment hold list) and the organization block
 * (for the expected set of OU parameter names) so the validator expects exactly what the stack
 * synthesizes, no more and no less.
 */
function loadLandingZoneConfig(environment: EnvironmentName) {
  const reader = new ConfigReader(environment, { configDirName: 'config', schema: LandingZoneSchema });
  const config = reader.getConfig();
  return { governance: config.governance, organization: config.organization };
}

function validateEnvironment(environment: EnvironmentName, options: CliOptions): void {
  const templatePath = locateTemplate(environment, options);
  const { governance, organization } = loadLandingZoneConfig(environment);
  const activePolicies = resolveActivePolicies({ disabledPolicies: governance.disabledPolicies });
  const expectedOuParameterNames = new Set(organization.organizationalUnits.map((unit) => ouIdParameterName(unit.key)));

  console.log(`\n=== ${environment} :: ${POLICY_STACK_NAME} ===`);
  console.log(`  template: ${templatePath}`);
  if (governance.disabledPolicies.length > 0) {
    console.log(`  disabled policies (deployment hold): ${governance.disabledPolicies.join(', ')}`);
  }

  const templateJson = readFileSync(templatePath, 'utf8');
  const template = asRecord(JSON.parse(templateJson) as unknown);
  if (template === undefined) {
    throw new Error(`'${templatePath}' is not a CloudFormation template object.`);
  }

  const resources = asRecord(template['Resources']) ?? {};
  const parameters = asRecord(template['Parameters']) ?? {};

  const resourceTypes = new Map<string, number>();
  for (const resource of Object.values(resources)) {
    const type = asRecord(resource)?.['Type'];
    const key = typeof type === 'string' ? type : 'unknown';
    resourceTypes.set(key, (resourceTypes.get(key) ?? 0) + 1);
  }

  const expectedScpCount = activePolicies.filter((p) => p.policyType === 'SERVICE_CONTROL_POLICY').length;
  const expectedRcpCount = activePolicies.filter((p) => p.policyType === 'RESOURCE_CONTROL_POLICY').length;
  const expectedPolicyCount = expectedScpCount + expectedRcpCount;

  const policyCount = resourceTypes.get(POLICY_RESOURCE_TYPE) ?? 0;
  const accountCount = resourceTypes.get(ACCOUNT_RESOURCE_TYPE) ?? 0;

  console.log(`  ${POLICY_RESOURCE_TYPE}: ${policyCount} (expected ${expectedPolicyCount})`);
  console.log(`  ${ACCOUNT_RESOURCE_TYPE}: ${accountCount}`);

  if (policyCount !== expectedPolicyCount) {
    throw new Error(
      `Expected exactly ${expectedPolicyCount} ${POLICY_RESOURCE_TYPE} resources but found ${policyCount}.`
    );
  }

  if (accountCount !== 0) {
    throw new Error(`Expected zero ${ACCOUNT_RESOURCE_TYPE} resources but found ${accountCount}.`);
  }

  const unexpectedTypes = [...resourceTypes.keys()].filter((type) => type !== POLICY_RESOURCE_TYPE);
  if (unexpectedTypes.length > 0) {
    throw new Error(
      `The policy stack template must contain only ${POLICY_RESOURCE_TYPE} resources but also contains: ` +
        `${unexpectedTypes.join(', ')}.`
    );
  }

  for (const [name, pattern] of [
    [ORGANIZATION_ROOT_ID_PARAMETER_NAME, ORGANIZATION_ROOT_ID_PATTERN],
    [ORGANIZATION_ID_PARAMETER_NAME, ORGANIZATION_ID_PATTERN]
  ] as const) {
    const parameter = asRecord(parameters[name]);
    if (parameter === undefined) {
      throw new Error(`Template is missing the ${name} parameter. It must be supplied externally at deployment time.`);
    }
    if (parameter['AllowedPattern'] !== pattern.source) {
      throw new Error(`${name} must constrain its value with AllowedPattern '${pattern.source}'.`);
    }
  }

  // OU IDs arrive through per-OU parameters rather than a cross-stack ImportValue link. Every OU
  // declared in the shared configuration must have a matching parameter here, and no extra
  // OuId* parameter may appear.
  const actualOuParameterNames = Object.keys(parameters).filter((name) => name.startsWith(OU_ID_PARAMETER_PREFIX));
  const missingOuParameters = [...expectedOuParameterNames].filter((name) => !(name in parameters));
  const unexpectedOuParameters = actualOuParameterNames.filter((name) => !expectedOuParameterNames.has(name));
  if (missingOuParameters.length > 0 || unexpectedOuParameters.length > 0) {
    throw new Error(
      'OU CloudFormation parameters do not match the approved organization configuration.' +
        (missingOuParameters.length > 0 ? `\n  missing: ${missingOuParameters.join(', ')}` : '') +
        (unexpectedOuParameters.length > 0 ? `\n  unexpected: ${unexpectedOuParameters.join(', ')}` : '')
    );
  }
  for (const name of actualOuParameterNames) {
    const parameter = asRecord(parameters[name]);
    if (parameter?.['AllowedPattern'] !== OU_ID_PATTERN.source) {
      throw new Error(`${name} must constrain its value with AllowedPattern '${OU_ID_PATTERN.source}'.`);
    }
  }

  // A cross-stack ImportValue would recouple the policy stack to the OU stack through a
  // CloudFormation Export - the exact failure mode we removed by switching to per-OU parameters.
  if (templateJson.includes('"Fn::ImportValue"')) {
    throw new Error(
      `'${templatePath}' contains an Fn::ImportValue intrinsic. The policy stack must be isolated from the OU ` +
        'stack; every OU target must be a Ref to a stack-local CloudFormation parameter.'
    );
  }

  const policies = collectPolicies(resources);
  const actualNames = policies.map((policy) => policy.name).sort();
  const expectedNames = activePolicies.map((definition) => definition.policyId).sort();

  const missing = expectedNames.filter((name) => !actualNames.includes(name));
  const unexpected = actualNames.filter((name) => !expectedNames.includes(name));

  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      'Synthesized policy set does not match the approved catalogue.' +
        (missing.length > 0 ? `\n  missing: ${missing.join(', ')}` : '') +
        (unexpected.length > 0 ? `\n  unexpected: ${unexpected.join(', ')}` : '')
    );
  }

  for (const withheld of withheldPolicies) {
    if (actualNames.includes(withheld.policyId)) {
      throw new Error(
        `Policy '${withheld.policyId}' is recorded as withheld but synthesized anyway. Reason on record: ` +
          withheld.reason
      );
    }
  }

  const definitionsById = new Map(activePolicies.map((definition) => [definition.policyId, definition]));

  for (const policy of policies) {
    const definition = definitionsById.get(policy.name);
    if (definition === undefined) {
      throw new Error(`Policy '${policy.name}' is not in the approved catalogue.`);
    }

    if (policy.type !== definition.policyType) {
      throw new Error(`Policy '${policy.name}' has type '${policy.type}' but must be '${definition.policyType}'.`);
    }

    if (policy.targetIds.length !== definition.targetKeys.length) {
      throw new Error(
        `Policy '${policy.name}' has ${policy.targetIds.length} attachment target(s) but the approved design ` +
          `declares ${definition.targetKeys.length}.`
      );
    }

    const rootTargets = policy.targetIds.filter((targetId) => classifyTarget(policy.name, targetId).kind === 'root');
    const expectedRootTargets = definition.targetKeys.filter((key) => key === ROOT_TARGET_KEY);
    if (rootTargets.length !== expectedRootTargets.length) {
      throw new Error(
        `Policy '${policy.name}' attaches to the Root ${rootTargets.length} time(s) but the approved design ` +
          `declares ${expectedRootTargets.length}.`
      );
    }

    const actualOuParameters = policy.targetIds
      .map((targetId) => classifyTarget(policy.name, targetId))
      .filter((entry): entry is { kind: 'ou'; parameterName: string } => entry.kind === 'ou')
      .map((entry) => entry.parameterName)
      .sort();
    const expectedOuParameters = definition.targetKeys
      .filter((key) => key !== ROOT_TARGET_KEY)
      .map((key) => ouIdParameterName(key))
      .sort();
    if (JSON.stringify(actualOuParameters) !== JSON.stringify(expectedOuParameters)) {
      throw new Error(
        `Policy '${policy.name}' attaches to OU parameters [${actualOuParameters.join(', ')}] but the approved ` +
          `design declares [${expectedOuParameters.join(', ')}].`
      );
    }

    const document = policyDocumentOf(policy.name, policy.content);
    if (document['Version'] !== POLICY_DOCUMENT_VERSION) {
      throw new Error(`Policy '${policy.name}' does not declare policy language version ${POLICY_DOCUMENT_VERSION}.`);
    }
    const statements = document['Statement'];
    if (!Array.isArray(statements) || statements.length === 0) {
      throw new Error(`Policy '${policy.name}' has no statements.`);
    }

    if (definition.policyType === 'RESOURCE_CONTROL_POLICY') {
      for (const entry of statements) {
        if (asRecord(entry)?.['Principal'] === undefined) {
          throw new Error(`Resource Control Policy '${policy.name}' has a statement without a Principal.`);
        }
      }
    }
  }

  const matrix = expectedAttachmentMatrix(activePolicies);
  const rootAttached = policies.filter((policy) =>
    policy.targetIds.some((targetId) => classifyTarget(policy.name, targetId).kind === 'root')
  );
  const expectedRootAttached = matrix.get(ROOT_TARGET_KEY) ?? [];
  if (rootAttached.length !== expectedRootAttached.length) {
    throw new Error(
      `Expected ${expectedRootAttached.length} policies attached to the Root but found ${rootAttached.length}.`
    );
  }

  const accountIdMatch = templateJson.match(ACCOUNT_ID_PATTERN);
  if (accountIdMatch !== null) {
    throw new Error(
      `'${templatePath}' contains what looks like an AWS account ID ('${accountIdMatch[0]}'). Account-level ` +
        'attachment is deferred and no account identifier may appear in this template.'
    );
  }

  const organizationIdMatch = templateJson.match(LITERAL_ORGANIZATION_ID_PATTERN);
  if (organizationIdMatch !== null) {
    throw new Error(
      `'${templatePath}' contains a literal Organization ID ('${organizationIdMatch[0]}'). It must arrive through ` +
        `the ${ORGANIZATION_ID_PARAMETER_NAME} parameter at deployment time.`
    );
  }

  assertEscCorrectness(templateJson, templatePath);

  // AWS Control Tower compatibility exemptions (governed by
  // `.apm/instructions/control-tower-scp-compatibility.instructions.md`). Fails synthesis if any
  // of the four in-scope SIDs is missing its expected exemption or if a Control Tower ARN leaks
  // into any other policy.
  assertControlTowerExemptions(policies);

  for (const [targetKey, policyIds] of [...matrix.entries()].sort()) {
    console.log(`  ok  ${targetKey.padEnd(24)} ${policyIds.join(', ')}`);
  }

  for (const withheld of withheldPolicies) {
    console.log(
      `  --  withheld: ${withheld.policyId} (catalogue section ${withheld.catalogueSection}) - ${withheld.status}`
    );
  }

  console.log(
    `\n  OK: ${environment} policy template matches the approved catalogue ` +
      `(${expectedScpCount} SCPs, ${expectedRcpCount} RCPs, 0 account targets).`
  );
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2));
  console.log('Validating synthesized AWS ESC Landing Zone policy templates');

  for (const environment of options.environments) {
    validateEnvironment(environment, options);
  }

  console.log(`\nAll requested templates are valid: ${options.environments.join(', ')}.`);
}

try {
  main();
} catch (error) {
  console.error(`\nPolicy template validation failed.\n${(error as Error).message}`);
  process.exitCode = 1;
}
