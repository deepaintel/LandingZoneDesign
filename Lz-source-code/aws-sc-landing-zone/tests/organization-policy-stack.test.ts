import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { createLandingZoneApp } from '../bin/landing-zone.js';
import type { LandingZoneConfig } from '../config/schemas/organization-schema.js';
import { ResourceControlPolicy } from '../lib/constructs/resource-control-policy.js';
import { ServiceControlPolicy } from '../lib/constructs/service-control-policy.js';
import { OrganizationPolicyStack, ouIdParameterName } from '../lib/organization/organization-policy-stack.js';
import type { OuStructureStack } from '../lib/organization/ou-structure-stack.js';
import {
  approvedPolicies,
  approvedResourceControlPolicies,
  approvedServiceControlPolicies,
  CATALOGUE_RESOURCE_CONTROL_POLICY_COUNT,
  CATALOGUE_SERVICE_CONTROL_POLICY_COUNT,
  withheldPolicies
} from '../lib/organization/policies/index.js';
import { scpEscRoot004 } from '../lib/organization/policies/root-policies.js';
import { policyDocument, statement, type PolicyDocument } from '../lib/organization/policies/types.js';

const ACCOUNT_RESOURCE_TYPE = 'AWS::Organizations::Account';
const COMMERCIAL_ARN_PREFIX = ['arn', 'aws', ''].join(':');
const COMMERCIAL_REGION_PATTERN = /\b(?:us|eu|ap|sa|ca|me|af|il|cn)-(?:gov-)?[a-z]+-\d\b/;
const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
const ESC_REGION = 'eusc-de-east-1';
const ORGANIZATION_ID_PARAMETER_NAME = 'OrganizationId';
const ORGANIZATION_ID_PATTERN = /^o-[0-9a-z]{10,32}$/;
const ORGANIZATION_ROOT_ID_PARAMETER_NAME = 'OrganizationRootId';
const ORGANIZATION_ROOT_ID_PATTERN = /^r-[0-9a-z]{4,32}$/;
const OU_ID_PARAMETER_PREFIX = 'OuId';
const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const OU_RESOURCE_TYPE = 'AWS::Organizations::OrganizationalUnit';
const POLICY_RESOURCE_TYPE = 'AWS::Organizations::Policy';
const EXPECTED_OU_COUNT = 14;

/**
 * The catalogue documents 20 SCPs. SCP-ESC-NET-001 is withheld (see `withheldPolicies`), and no
 * policy is currently on the deployment hold list, so all 19 implemented SCPs synthesize. WL-004 was
 * on the hold list until the tagging standard was reconciled against `global-cloud-tagging-strategy.md`
 * v1.8; the hold has been lifted in `config/default.yaml`.
 */
const EXPECTED_SCP_COUNT = 19;
const EXPECTED_RCP_COUNT = 2;
const DEPLOYMENT_HOLD_POLICIES: readonly string[] = [];

/** Placeholders substituted for deployment-time parameter references when rendering policy content. */
const ORGANIZATION_ID_PLACEHOLDER = 'o-testorganization';
const ROOT_ID_PLACEHOLDER = 'r-a1b2';

/** Exemption principal ARNs, built from configuration so assertions stay readable. */
const ESC_ROLE_ARN_PREFIX = 'arn:aws-eusc:iam::*:role/';
const PIPELINE_ROLE_ARN = `${ESC_ROLE_ARN_PREFIX}github-actions-role`;
const CFN_EXEC_ROLE_ARN = `${ESC_ROLE_ARN_PREFIX}cdk-hnb659fds-cfn-exec-role-*`;
const ASSET_PUBLISHING_ROLE_ARN = `${ESC_ROLE_ARN_PREFIX}cdk-hnb659fds-file-publishing-role-*`;
const BREAK_GLASS_ROLE_ARN = `${ESC_ROLE_ARN_PREFIX}LZ-BreakGlass-Admin`;
const ROOT_USER_ARN = 'arn:aws-eusc:iam::*:root';

/**
 * Control Tower principal ARNs used by the approved compatibility exemptions
 * (`.apm/instructions/control-tower-scp-compatibility.instructions.md`). The service-linked role
 * name is `AWSServiceRoleForAWSControlTower` (not `AWSServiceRoleForControlTower`); the
 * member-account execution role is `AWSControlTowerExecution`. Both live under the aws-eusc
 * partition with a wildcard account segment so no AWS account identifier enters source.
 */
const CONTROL_TOWER_SLR_ARN = `${ESC_ROLE_ARN_PREFIX}aws-service-role/controltower.amazonaws.com/AWSServiceRoleForAWSControlTower`;
const CONTROL_TOWER_EXECUTION_ARN = `${ESC_ROLE_ARN_PREFIX}AWSControlTowerExecution`;

const EXPECTED_SCP_NAMES = [
  'SCP-ESC-ROOT-001',
  'SCP-ESC-ROOT-002',
  'SCP-ESC-ROOT-003',
  'SCP-ESC-ROOT-004',
  'SCP-ESC-SEC-001',
  'SCP-ESC-SEC-002',
  'SCP-ESC-SEC-003',
  'SCP-ESC-WL-001',
  'SCP-ESC-WL-002',
  'SCP-ESC-WL-003',
  'SCP-ESC-WL-004',
  'SCP-ESC-ENC-001',
  'SCP-ESC-ENC-002',
  'SCP-ESC-IAM-001',
  'SCP-ESC-IAM-002',
  'SCP-ESC-INF-001',
  'SCP-ESC-PROD-001',
  'SCP-ESC-SBX-001',
  'SCP-ESC-SUS-001'
];

const EXPECTED_RCP_NAMES = ['RCP-ESC-S3-001', 'RCP-ESC-KMS-001'];

/**
 * SCP-ESC-WL-004 mandatory tag keys, reconciled with `global-cloud-tagging-strategy.md` v1.8
 * (P1 Deny-effect keys, in enterprise-strategy order).
 */
const MANDATORY_TAG_KEYS = [
  'owner',
  'owner-email',
  'environment',
  'lifecycle',
  'data-classification',
  'data-residency',
  'itsystemcode'
];

/** Value constraints for the four enum-typed enterprise tags. */
interface Wl004ValueConstraint {
  readonly key: string;
  readonly sid: string;
  readonly values: readonly string[];
}

const WL004_VALUE_CONSTRAINTS: readonly Wl004ValueConstraint[] = [
  {
    key: 'data-classification',
    sid: 'ScpEscWl004RestrictDataClassificationValues',
    values: ['public', 'internal', 'confidential', 'restricted']
  },
  { key: 'environment', sid: 'ScpEscWl004RestrictEnvironmentValues', values: ['prod', 'staging', 'dev', 'sandbox'] },
  {
    key: 'lifecycle',
    sid: 'ScpEscWl004RestrictLifecycleValues',
    values: ['active', 'deprecated', 'decommissioning', 'archived']
  },
  {
    key: 'data-residency',
    sid: 'ScpEscWl004RestrictDataResidencyValues',
    values: ['eu', 'nordic', 'global', 'no-requirement']
  }
];

/** Presence-check Sid for a given tag key, matching the tagKeySid helper in workload-policies.ts. */
function requireTagSid(tagKey: string): string {
  const camel = tagKey
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  return `ScpEscWl004Require${camel}Tag`;
}

/** Root-attached governance guardrails that must exempt the approved deployment principals. */
const ROOT_GOVERNANCE_STATEMENTS: readonly [string, string][] = [
  ['SCP-ESC-ROOT-001', 'ScpEscRoot001DenyNonEscRegions'],
  ['SCP-ESC-ROOT-003', 'ScpEscRoot003DenyPolicyGovernanceChanges']
];

/** The KMS key-loss statements that share the MFA guard, in SCP-ESC-ENC-001 and SCP-ESC-WL-001. */
const KMS_KEY_LOSS_STATEMENTS: readonly [string, string][] = [
  ['SCP-ESC-ENC-001', 'ScpEscEnc001DenyKeyLossWithoutMfa'],
  ['SCP-ESC-WL-001', 'ScpEscWl001DenyKmsKeyLossWithoutMfa']
];

/**
 * SCP-ESC-SEC-001 is attached to the Root, superseding the earlier Security-OU ruling: the approved
 * Centralized Logging design section 3.2 requires its protections to hold in the Sandbox and
 * Suspended OUs, which a Security-OU-only attachment cannot deliver.
 */
const ROOT_ATTACHED_POLICIES: readonly string[] = [
  'SCP-ESC-ROOT-001',
  'SCP-ESC-ROOT-002',
  'SCP-ESC-ROOT-003',
  'SCP-ESC-ROOT-004',
  'SCP-ESC-SEC-001',
  'SCP-ESC-ENC-001',
  'RCP-ESC-S3-001',
  'RCP-ESC-KMS-001'
];

/** The approved Root / OU attachment matrix, keyed by configuration target key. */
const EXPECTED_ATTACHMENTS: Readonly<Record<string, readonly string[]>> = {
  root: ROOT_ATTACHED_POLICIES,
  security: ['SCP-ESC-SEC-002', 'SCP-ESC-SEC-003'],
  infrastructure: ['SCP-ESC-INF-001'],
  sandbox: ['SCP-ESC-SBX-001'],
  suspended: ['SCP-ESC-SUS-001'],
  workloads: [
    'SCP-ESC-WL-001',
    'SCP-ESC-WL-002',
    'SCP-ESC-WL-003',
    'SCP-ESC-WL-004',
    'SCP-ESC-ENC-002',
    'SCP-ESC-IAM-001',
    'SCP-ESC-IAM-002'
  ],
  'workloads-hybrid-prod': ['SCP-ESC-PROD-001'],
  'workloads-online-prod': ['SCP-ESC-PROD-001'],
  'workloads-corp-prod': ['SCP-ESC-PROD-001']
};

type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

interface TemplatePolicy {
  readonly logicalId: string;
  readonly name: string;
  readonly type: string;
  readonly targetIds: readonly unknown[];
  readonly content: unknown;
}

interface Synthesized {
  readonly config: LandingZoneConfig;
  readonly ouStructureStack: OuStructureStack;
  readonly policyStack: OrganizationPolicyStack;
  readonly ouTemplate: Template;
  readonly policyTemplate: Template;
  readonly policyTemplateJson: string;
  readonly policies: readonly TemplatePolicy[];
}

function synthesize(environment: EnvironmentName): Synthesized {
  const app = new cdk.App({ context: { environment } });
  const { config, ouStructureStack, organizationPolicyStack } = createLandingZoneApp(app);
  const policyTemplate = Template.fromStack(organizationPolicyStack);

  return {
    config,
    ouStructureStack,
    policyStack: organizationPolicyStack,
    ouTemplate: Template.fromStack(ouStructureStack),
    policyTemplate,
    policyTemplateJson: JSON.stringify(policyTemplate.toJSON()),
    policies: collectPolicies(policyTemplate)
  };
}

function collectPolicies(template: Template): TemplatePolicy[] {
  const resources = template.toJSON().Resources as Record<
    string,
    { Type: string; Properties: Record<string, unknown> }
  >;

  return Object.entries(resources)
    .filter(([, resource]) => resource.Type === POLICY_RESOURCE_TYPE)
    .map(([logicalId, resource]) => ({
      logicalId,
      name: String(resource.Properties.Name),
      type: String(resource.Properties.Type),
      targetIds: (resource.Properties.TargetIds ?? []) as readonly unknown[],
      content: resource.Properties.Content
    }));
}

function policyByName(policies: readonly TemplatePolicy[], name: string): TemplatePolicy {
  const found = policies.find((policy) => policy.name === name);
  expect(found, `expected policy '${name}' to synthesize`).toBeDefined();
  return found as TemplatePolicy;
}

/**
 * Substitutes CloudFormation `Ref` intrinsics with placeholder values.
 *
 * `CfnPolicy.content` takes the policy document OBJECT, so CloudFormation renders it as a JSON object
 * and a deployment-time parameter appears as a nested `{ "Ref": ... }` intrinsic rather than as text.
 * Replacing those intrinsics lets the whole catalogue be asserted structurally.
 */
function resolveIntrinsics(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => resolveIntrinsics(item));
  }

  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const ref = record.Ref;

    if (typeof ref === 'string' && Object.keys(record).length === 1) {
      if (ref === ORGANIZATION_ID_PARAMETER_NAME) {
        return ORGANIZATION_ID_PLACEHOLDER;
      }
      if (ref === ORGANIZATION_ROOT_ID_PARAMETER_NAME) {
        return ROOT_ID_PLACEHOLDER;
      }
      throw new Error(`Unexpected Ref in policy content: ${ref}`);
    }

    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolveIntrinsics(item)]));
  }

  return value;
}

function documentOf(policies: readonly TemplatePolicy[], name: string): PolicyDocument {
  return resolveIntrinsics(policyByName(policies, name).content) as PolicyDocument;
}

function statementBySid(document: PolicyDocument, sid: string): Record<string, unknown> {
  const found = document.Statement.find((entry) => entry.Sid === sid);
  expect(found, `expected statement '${sid}'`).toBeDefined();
  return found as unknown as Record<string, unknown>;
}

function actionsOf(document: PolicyDocument, sid: string): string[] {
  const action = statementBySid(document, sid).Action;
  return typeof action === 'string' ? [action] : ((action ?? []) as string[]);
}

type ConditionBlocks = Record<string, Record<string, unknown>>;

/** Reads one condition operator block from a statement, failing the test if it is absent. */
function conditionOf(entry: Record<string, unknown>, operator: string): Record<string, unknown> {
  const block = (entry.Condition as ConditionBlocks | undefined)?.[operator];
  expect(block, `expected condition operator '${operator}'`).toBeDefined();
  return block as Record<string, unknown>;
}

/** Reads a single condition value, for example `Bool` / `ec2:Encrypted`. */
function conditionValue(entry: Record<string, unknown>, operator: string, key: string): unknown {
  return conditionOf(entry, operator)[key];
}

/** Reads a condition value that is a list of strings, such as exemption principal ARNs. */
function conditionList(entry: Record<string, unknown>, operator: string, key: string): string[] {
  const value = conditionOf(entry, operator)[key];
  return Array.isArray(value) ? (value as string[]) : [];
}

/** True when a statement declares the given condition operator. */
function hasOperator(entry: Record<string, unknown>, operator: string): boolean {
  return (entry.Condition as ConditionBlocks | undefined)?.[operator] !== undefined;
}

/**
 * Resolves a synthesized TargetIds entry to the target key it represents.
 *
 * With the two stacks isolated at the CloudFormation layer, every OU target is a Ref to an
 * `OuId<PascalCase(key)>` parameter declared on this stack. No `Fn::ImportValue` is expected here -
 * seeing one would mean the OU stack and the policy stack have been re-coupled through a
 * CloudFormation Export / ImportValue link and must fail the test.
 */
function targetKeyOf(stack: OuStructureStack, targetId: unknown): string {
  if (typeof targetId === 'string') {
    throw new Error(`TargetIds contains the literal value '${targetId}'. Targets must be references.`);
  }

  const reference = targetId as { Ref?: string; 'Fn::ImportValue'?: unknown };

  if (typeof reference['Fn::ImportValue'] !== 'undefined') {
    throw new Error(
      `TargetIds entry uses Fn::ImportValue: ${JSON.stringify(targetId)}. The policy stack must be ` +
        'isolated from the OU stack and every target must be a Ref to a stack-local CfnParameter.'
    );
  }

  if (reference.Ref === ORGANIZATION_ROOT_ID_PARAMETER_NAME) {
    return 'root';
  }

  if (typeof reference.Ref === 'string' && reference.Ref.startsWith(OU_ID_PARAMETER_PREFIX)) {
    for (const key of stack.organizationalUnits.keys()) {
      if (reference.Ref === ouIdParameterName(key)) {
        return key;
      }
    }
    throw new Error(`Ref '${reference.Ref}' does not correspond to any known organizational unit parameter.`);
  }

  throw new Error(`Unsupported TargetIds entry: ${JSON.stringify(targetId)}`);
}

describe.each(ENVIRONMENT_NAMES)('OrganizationPolicyStack (%s)', (environment) => {
  const { config, ouStructureStack, policyStack, ouTemplate, policyTemplate, policyTemplateJson, policies } =
    synthesize(environment);

  describe('existing OU baseline', () => {
    it(`leaves exactly ${EXPECTED_OU_COUNT} organizational units in the OU stack`, () => {
      ouTemplate.resourceCountIs(OU_RESOURCE_TYPE, EXPECTED_OU_COUNT);
      expect(ouStructureStack.organizationalUnits.size).toBe(EXPECTED_OU_COUNT);
    });

    it('creates no policy in the OU stack and no organizational unit in the policy stack', () => {
      ouTemplate.resourceCountIs(POLICY_RESOURCE_TYPE, 0);
      policyTemplate.resourceCountIs(OU_RESOURCE_TYPE, 0);
    });
  });

  describe('stack shape', () => {
    it('takes its stack name from the app wiring and is pinned to the AWS ESC Region', () => {
      expect(policyStack.stackName).toBe('lz-organization-policies');
      expect(policyStack.region).toBe(ESC_REGION);
      expect(config.aws.region).toBe(ESC_REGION);
    });

    it('declares no resource type other than AWS Organizations policies', () => {
      const resources = policyTemplate.toJSON().Resources as Record<string, { Type: string }>;
      expect([...new Set(Object.values(resources).map((resource) => resource.Type))]).toEqual([POLICY_RESOURCE_TYPE]);
    });

    it('takes the existing Organizations Root ID as a pattern-constrained deployment input', () => {
      policyTemplate.hasParameter(ORGANIZATION_ROOT_ID_PARAMETER_NAME, {
        Type: 'String',
        AllowedPattern: ORGANIZATION_ROOT_ID_PATTERN.source
      });
    });

    it('takes the existing Organization ID as a pattern-constrained deployment input', () => {
      policyTemplate.hasParameter(ORGANIZATION_ID_PARAMETER_NAME, {
        Type: 'String',
        AllowedPattern: ORGANIZATION_ID_PATTERN.source
      });
    });

    it('declares one pattern-constrained OU ID parameter per organizational unit and none extra', () => {
      const parameters = (policyTemplate.toJSON().Parameters ?? {}) as Record<string, { AllowedPattern?: string }>;
      const ouParameterNames = Object.keys(parameters).filter((name) => name.startsWith(OU_ID_PARAMETER_PREFIX));
      const expected = [...ouStructureStack.organizationalUnits.keys()].map(ouIdParameterName);

      expect(ouParameterNames.sort()).toEqual(expected.sort());
      for (const name of ouParameterNames) {
        expect(parameters[name]?.AllowedPattern).toBe(OU_ID_PATTERN.source);
      }
    });

    it('creates neither the Organization nor the Organizations Root', () => {
      policyTemplate.resourceCountIs('AWS::Organizations::Organization', 0);
    });

    it('reports the policy counts as stack outputs', () => {
      policyTemplate.hasOutput('ServiceControlPolicyCount', { Value: String(EXPECTED_SCP_COUNT) });
      policyTemplate.hasOutput('ResourceControlPolicyCount', { Value: String(EXPECTED_RCP_COUNT) });
    });
  });

  describe('stack isolation from the OU stack', () => {
    it('carries no Fn::ImportValue reference anywhere in the synthesized template', () => {
      // A single Fn::ImportValue would recouple the two stacks at the CloudFormation layer and
      // reintroduce the cross-stack update failure mode we deliberately removed.
      expect(policyTemplateJson).not.toMatch(/"Fn::ImportValue"/);
    });

    it('produces no cross-stack Export in the OU stack template', () => {
      // CDK auto-generates Fn::Export on the producing stack only when another stack in the same
      // App references its constructs. If we accidentally re-add such a reference, an Export will
      // appear here even though the OU stack itself never declares one.
      const outputs = (ouTemplate.toJSON().Outputs ?? {}) as Record<string, { Export?: unknown }>;
      for (const [name, output] of Object.entries(outputs)) {
        expect(output.Export, `output '${name}' must not carry a CloudFormation Export`).toBeUndefined();
      }
    });

    it('carries no CDK-level dependency on the OU stack', () => {
      expect(policyStack.dependencies).not.toContain(ouStructureStack);
    });
  });

  describe('policy inventory', () => {
    it(`synthesizes exactly ${EXPECTED_SCP_COUNT + EXPECTED_RCP_COUNT} policies`, () => {
      policyTemplate.resourceCountIs(POLICY_RESOURCE_TYPE, EXPECTED_SCP_COUNT + EXPECTED_RCP_COUNT);
    });

    it('synthesizes exactly the approved SCP names and no unexpected SCP', () => {
      const actual = policies.filter((policy) => policy.type === 'SERVICE_CONTROL_POLICY').map((policy) => policy.name);
      expect(actual.sort()).toEqual([...EXPECTED_SCP_NAMES].sort());
    });

    it('synthesizes exactly the approved RCP names and no unexpected RCP', () => {
      const actual = policies
        .filter((policy) => policy.type === 'RESOURCE_CONTROL_POLICY')
        .map((policy) => policy.name);
      expect(actual.sort()).toEqual([...EXPECTED_RCP_NAMES].sort());
    });

    it('marks every SCP with SERVICE_CONTROL_POLICY', () => {
      for (const name of EXPECTED_SCP_NAMES) {
        expect(policyByName(policies, name).type).toBe('SERVICE_CONTROL_POLICY');
      }
    });

    it('marks every RCP with RESOURCE_CONTROL_POLICY and never as an SCP', () => {
      for (const name of EXPECTED_RCP_NAMES) {
        expect(policyByName(policies, name).type).toBe('RESOURCE_CONTROL_POLICY');
      }
    });

    it('does not synthesize the withheld SCP-ESC-NET-001', () => {
      expect(policies.map((policy) => policy.name)).not.toContain('SCP-ESC-NET-001');
      expect(withheldPolicies.map((policy) => policy.policyId)).toContain('SCP-ESC-NET-001');
    });

    it('does not synthesize policies on the deployment hold list', () => {
      // The hold list is configuration-driven. Every listed policy must still be an approved
      // catalogue entry (so it can be re-enabled by removing the entry) but must not synthesize.
      for (const held of DEPLOYMENT_HOLD_POLICIES) {
        expect(policies.map((policy) => policy.name)).not.toContain(held);
        expect(approvedServiceControlPolicies.map((p) => p.policyId)).toContain(held);
      }
      expect(config.governance.disabledPolicies).toEqual(DEPLOYMENT_HOLD_POLICIES);
    });

    it('accounts for every policy in the approved catalogue inventory', () => {
      // Approved catalogue = implemented (synthesized) + held (present in code but disabled).
      const implementedScpCount = EXPECTED_SCP_COUNT + DEPLOYMENT_HOLD_POLICIES.length;
      expect(CATALOGUE_SERVICE_CONTROL_POLICY_COUNT).toBe(implementedScpCount + withheldPolicies.length);
      expect(CATALOGUE_RESOURCE_CONTROL_POLICY_COUNT).toBe(EXPECTED_RCP_COUNT);
      expect(approvedServiceControlPolicies).toHaveLength(implementedScpCount);
      expect(approvedResourceControlPolicies).toHaveLength(EXPECTED_RCP_COUNT);
    });

    it('gives every policy a valid document with at least one statement', () => {
      for (const policy of policies) {
        const document = documentOf(policies, policy.name);
        expect(document.Version).toBe('2012-10-17');
        expect(document.Statement.length).toBeGreaterThan(0);
        for (const entry of document.Statement) {
          expect(entry.Sid).toBeTruthy();
          expect(entry.Effect).toBe('Deny');
        }
      }
    });
  });

  describe('Root / OU attachment wiring', () => {
    it('attaches every policy to exactly its approved targets', () => {
      const actual = new Map<string, string[]>();

      for (const policy of policies) {
        for (const targetId of policy.targetIds) {
          const key = targetKeyOf(ouStructureStack, targetId);
          const existing = actual.get(key) ?? [];
          existing.push(policy.name);
          actual.set(key, existing);
        }
      }

      expect([...actual.keys()].sort()).toEqual(Object.keys(EXPECTED_ATTACHMENTS).sort());

      for (const [key, expectedNames] of Object.entries(EXPECTED_ATTACHMENTS)) {
        expect((actual.get(key) ?? []).sort(), `attachments for '${key}'`).toEqual([...expectedNames].sort());
      }
    });

    it('resolves Root targets through the OrganizationRootId parameter', () => {
      for (const name of ROOT_ATTACHED_POLICIES) {
        expect(policyByName(policies, name).targetIds).toContainEqual({ Ref: ORGANIZATION_ROOT_ID_PARAMETER_NAME });
      }
    });

    it('attaches SCP-ESC-SEC-001 to the Root so Sandbox and Suspended accounts inherit it', () => {
      // Supersedes the earlier Security-OU ruling: Centralized Logging design section 3.2 requires
      // Sandbox management-plane logging to be undisableable and Suspended SCP protections to hold.
      const sec001 = policyByName(policies, 'SCP-ESC-SEC-001');
      expect(sec001.targetIds).toEqual([{ Ref: ORGANIZATION_ROOT_ID_PARAMETER_NAME }]);
      expect(EXPECTED_ATTACHMENTS.security).not.toContain('SCP-ESC-SEC-001');
    });

    it('resolves L1 OU targets through the generated OU resources', () => {
      for (const key of ['security', 'infrastructure', 'sandbox', 'suspended', 'workloads']) {
        const names = EXPECTED_ATTACHMENTS[key] ?? [];
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) {
          const keys = policyByName(policies, name).targetIds.map((targetId) =>
            targetKeyOf(ouStructureStack, targetId)
          );
          expect(keys).toContain(key);
        }
      }
    });

    it('attaches SCP-ESC-PROD-001 to all three L3 Prod OUs from a single policy resource', () => {
      const prod001 = policyByName(policies, 'SCP-ESC-PROD-001');
      const keys = prod001.targetIds.map((targetId) => targetKeyOf(ouStructureStack, targetId)).sort();

      expect(keys).toEqual(['workloads-corp-prod', 'workloads-hybrid-prod', 'workloads-online-prod']);
      expect(policies.filter((policy) => policy.name === 'SCP-ESC-PROD-001')).toHaveLength(1);
    });

    it('adds no attachment for the L2 Hybrid/Corp or any L3 Non-Prod OU', () => {
      const attached = new Set(
        policies.flatMap((policy) => policy.targetIds.map((targetId) => targetKeyOf(ouStructureStack, targetId)))
      );

      for (const key of [
        'workloads-hybrid',
        'workloads-corp',
        'workloads-online',
        'workloads-hybrid-non-prod',
        'workloads-online-non-prod',
        'workloads-corp-non-prod'
      ]) {
        expect(attached.has(key), `'${key}' must inherit only, with no direct attachment`).toBe(false);
      }
    });

    it('never embeds a literal Root or OU ID in an attachment target', () => {
      for (const policy of policies) {
        for (const targetId of policy.targetIds) {
          expect(typeof targetId).not.toBe('string');
        }
      }
      expect(policyTemplateJson).not.toMatch(/"TargetIds":\["r-/);
      expect(policyTemplateJson).not.toMatch(/"TargetIds":\["ou-/);
    });

    it('stays within the AWS Organizations per-node attachment limits', () => {
      for (const [key, names] of Object.entries(EXPECTED_ATTACHMENTS)) {
        const scps = names.filter((name) => name.startsWith('SCP-'));
        const rcps = names.filter((name) => name.startsWith('RCP-'));
        expect(scps.length, `directly attached SCPs on '${key}'`).toBeLessThanOrEqual(10);
        expect(rcps.length, `directly attached RCPs on '${key}'`).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('account-level attachment remains deferred', () => {
    it('synthesizes zero account resources', () => {
      policyTemplate.resourceCountIs(ACCOUNT_RESOURCE_TYPE, 0);
      ouTemplate.resourceCountIs(ACCOUNT_RESOURCE_TYPE, 0);
    });

    it('contains no AWS account ID in any attachment target', () => {
      for (const policy of policies) {
        for (const targetId of policy.targetIds) {
          expect(JSON.stringify(targetId)).not.toMatch(/\b[0-9]{12}\b/);
        }
      }
    });

    it('contains no AWS account ID anywhere in the synthesized template', () => {
      expect(policyTemplateJson).not.toMatch(/\b[0-9]{12}\b/);
    });

    it('keeps every exemption principal account-agnostic', () => {
      const matches = policyTemplateJson.match(/arn:aws-eusc:iam::[^:"]*:/g) ?? [];
      expect(matches.length).toBeGreaterThan(0);
      for (const match of matches) {
        expect(match).toBe('arn:aws-eusc:iam::*:');
      }
    });
  });

  describe('AWS ESC correctness', () => {
    it('contains no commercial AWS partition, Region or STS endpoint reference', () => {
      const sanitized = policyTemplateJson.split(ESC_REGION).join('<esc-region>');
      expect(sanitized).not.toContain(COMMERCIAL_ARN_PREFIX);
      expect(sanitized).not.toContain(['sts', 'amazonaws', 'com'].join('.'));
      expect(sanitized).not.toMatch(COMMERCIAL_REGION_PATTERN);
    });

    it('uses the AWS ESC ARN prefix for every ARN it does contain', () => {
      expect(policyTemplateJson).toContain('arn:aws-eusc:iam::*:role/');
    });

    it('contains no reference to the retired develop model', () => {
      expect(policyTemplateJson.toLowerCase()).not.toContain('develop');
    });
  });

  describe('reconciled exemption configuration', () => {
    const exemptions = () => config.governance.policyExemptions;

    it('exempts the verified CDK bootstrap role chain', () => {
      // Verified against aws-sc-foundation .github/workflows/01-bootstrap-cdk.yaml, which runs
      // `cdk bootstrap` with no --qualifier, so the default hnb659fds qualifier applies.
      expect(exemptions().pipelineRoles).toEqual([
        'github-actions-role',
        'cdk-hnb659fds-deploy-role-*',
        'cdk-hnb659fds-cfn-exec-role-*',
        'cdk-hnb659fds-lookup-role-*'
      ]);
    });

    it('keeps the asset-publishing role out of the general pipeline exemption', () => {
      expect(exemptions().assetPublishingRoles).toEqual(['cdk-hnb659fds-file-publishing-role-*']);
      expect(exemptions().pipelineRoles).not.toContain('cdk-hnb659fds-file-publishing-role-*');
    });

    it('uses the IAM design break-glass role name', () => {
      expect(exemptions().breakGlassRoles).toEqual(['LZ-BreakGlass-Admin']);
      expect(exemptions().breakGlassRoles).not.toContain('AdministratorRole');
    });

    it('resolves the network administrator and KMS administrator permission sets', () => {
      expect(exemptions().networkAdministratorRoles).toEqual([
        'aws-reserved/sso.amazonaws.com/*AWSReservedSSO_LZ-NetworkAdmin-PermissionSet_*'
      ]);
      expect(exemptions().kmsAdministratorRoles).toEqual([
        'aws-reserved/sso.amazonaws.com/*AWSReservedSSO_LZ-KMSAdmin-PermissionSet_*'
      ]);
    });

    it('carries no account ID or ARN in any exemption entry', () => {
      const current = exemptions();
      const allEntries = [
        ...current.pipelineRoles,
        ...current.assetPublishingRoles,
        ...current.breakGlassRoles,
        ...current.finOpsRoles,
        ...current.kmsAdministratorRoles,
        ...current.networkAdministratorRoles,
        ...current.identityCenterServiceRoles,
        ...current.organizationsServiceRoles,
        ...current.controlTowerServiceLinkedRoles,
        ...current.controlTowerExecutionRoles
      ];

      expect(allEntries.length).toBeGreaterThan(0);
      for (const entry of allEntries) {
        expect(entry).not.toMatch(/\b[0-9]{12}\b/);
        expect(entry.startsWith('arn:')).toBe(false);
      }
    });

    it('exempts the CloudFormation execution role on the Root governance guardrails', () => {
      for (const [policyName, sid] of ROOT_GOVERNANCE_STATEMENTS) {
        const entry = statementBySid(documentOf(policies, policyName), sid);
        expect(conditionList(entry, 'StringNotLike', 'aws:PrincipalArn')).toContain(CFN_EXEC_ROLE_ARN);
      }
    });

    it('records the two AWS Control Tower compatibility principal lists exactly as approved', () => {
      // Control Tower compatibility (governed by the compatibility instruction). Only two
      // principals are actually required across the four in-scope SIDs; do not broaden.
      expect(exemptions().controlTowerServiceLinkedRoles).toEqual([
        'aws-service-role/controltower.amazonaws.com/AWSServiceRoleForAWSControlTower'
      ]);
      expect(exemptions().controlTowerExecutionRoles).toEqual(['AWSControlTowerExecution']);
    });
  });

  describe('critical policy statements', () => {
    it('SCP-ESC-ROOT-001 locks every non-global action to the AWS ESC Region', () => {
      const document = documentOf(policies, 'SCP-ESC-ROOT-001');
      const entry = statementBySid(document, 'ScpEscRoot001DenyNonEscRegions');

      expect(entry.NotAction).toEqual([
        'iam:*',
        'sts:*',
        'route53:*',
        'organizations:*',
        'support:*',
        'budgets:*',
        'sso:*'
      ]);
      expect(conditionValue(entry, 'StringNotEquals', 'aws:RequestedRegion')).toBe(ESC_REGION);
      expect(conditionList(entry, 'StringNotLike', 'aws:PrincipalArn')).toContain(PIPELINE_ROLE_ARN);
    });

    it('SCP-ESC-ROOT-002 denies every action performed by the account root user', () => {
      const document = documentOf(policies, 'SCP-ESC-ROOT-002');
      const entry = statementBySid(document, 'ScpEscRoot002DenyRootUserActions');

      expect(entry.Action).toBe('*');
      expect(conditionValue(entry, 'StringLike', 'aws:PrincipalArn')).toBe(ROOT_USER_ARN);
    });

    it('SCP-ESC-ROOT-003 denies the five documented governance verbs', () => {
      expect(actionsOf(documentOf(policies, 'SCP-ESC-ROOT-003'), 'ScpEscRoot003DenyPolicyGovernanceChanges')).toEqual([
        'organizations:CreatePolicy',
        'organizations:UpdatePolicy',
        'organizations:DeletePolicy',
        'organizations:AttachPolicy',
        'organizations:DetachPolicy'
      ]);
    });

    it('SCP-ESC-ROOT-003 exempts the AWS Control Tower service-linked role alongside pipeline roles', () => {
      // Control Tower compatibility: the AWSServiceRoleForAWSControlTower SLR is the caller for
      // organizations:CreatePolicy / AttachPolicy / DetachPolicy when Control Tower manages its
      // aws-guardrails-* SCPs. Pipeline exemption remains; every other principal remains denied.
      const entry = statementBySid(
        documentOf(policies, 'SCP-ESC-ROOT-003'),
        'ScpEscRoot003DenyPolicyGovernanceChanges'
      );
      const exempt = conditionList(entry, 'StringNotLike', 'aws:PrincipalArn');
      expect(exempt).toContain(CONTROL_TOWER_SLR_ARN);
      expect(exempt).toContain(PIPELINE_ROLE_ARN);
      expect(exempt).not.toContain(CONTROL_TOWER_EXECUTION_ARN);
      expect(exempt).not.toContain('*');
    });

    it('SCP-ESC-ROOT-004 denies the customer-directed services and omits the pending boundary', () => {
      const document = documentOf(policies, 'SCP-ESC-ROOT-004');
      const actions = actionsOf(document, 'ScpEscRoot004DenyCustomerDirectedServices');

      // Both services use a single category-wildcard. Catalogue section 3.4 documents intent as
      // "Elastic Beanstalk resource creation API actions" (a category, not an enumerated list) and
      // there is no exception carve-out for any individual Create... verb, so enumerating specific
      // verbs would be inconsistent with Lightsail and drift silently when AWS adds a new Create action.
      expect(actions).toEqual(['lightsail:Create*', 'elasticbeanstalk:Create*']);
      // Individual Beanstalk create verbs are absorbed by the wildcard and must not be listed
      // separately - listing them would drift from the category shape used for Lightsail.
      expect(actions).not.toContain('elasticbeanstalk:CreateApplication');
      expect(actions).not.toContain('elasticbeanstalk:CreateEnvironment');
      // The approved-service boundary is a pending enhancement, not an inferred allowlist.
      expect(document.Statement).toHaveLength(1);
      expect(config.governance.approvedServiceBoundary.services).toEqual([]);
    });

    it('SCP-ESC-SEC-001 protects all four documented monitoring services and no unavailable service', () => {
      const document = documentOf(policies, 'SCP-ESC-SEC-001');
      const allActions = document.Statement.flatMap((entry) => actionsOf(document, entry.Sid));

      expect(allActions).toContain('cloudtrail:StopLogging');
      expect(allActions).toContain('config:StopConfigurationRecorder');
      expect(allActions).toContain('guardduty:DeleteDetector');
      expect(allActions).toContain('securityhub:DisableSecurityHub');
      // Inspector v2 and Macie are unavailable in eusc-de-east-1 and must never appear.
      expect(allActions.some((action) => action.startsWith('inspector'))).toBe(false);
      expect(allActions.some((action) => action.startsWith('macie'))).toBe(false);
    });

    it('SCP-ESC-SEC-001 CloudTrail SID exempts only the Control Tower service-linked role', () => {
      // Control Tower compatibility: management-account org-trail lifecycle
      // (aws-controltower-BaselineCloudTrail) is owned by AWSServiceRoleForAWSControlTower.
      // The AWSControlTowerExecution role is a member-account principal and is intentionally not
      // exempted here. Every other principal remains denied.
      const entry = statementBySid(documentOf(policies, 'SCP-ESC-SEC-001'), 'ScpEscSec001ProtectCloudTrail');
      const exempt = conditionList(entry, 'StringNotLike', 'aws:PrincipalArn');
      expect(exempt).toEqual([CONTROL_TOWER_SLR_ARN]);
      expect(exempt).not.toContain(CONTROL_TOWER_EXECUTION_ARN);
      expect(exempt).not.toContain(PIPELINE_ROLE_ARN);
      expect(exempt).not.toContain('*');
    });

    it('SCP-ESC-SEC-001 Config-recorder SID exempts only the Control Tower execution role', () => {
      // Config recorder and delivery channel are member-account resources; Control Tower calls
      // config:StopConfigurationRecorder / DeleteConfigurationRecorder / DeleteDeliveryChannel
      // inside Audit and Log Archive under AWSControlTowerExecution. SLR is not the caller.
      const entry = statementBySid(documentOf(policies, 'SCP-ESC-SEC-001'), 'ScpEscSec001ProtectConfigRecorder');
      const exempt = conditionList(entry, 'StringNotLike', 'aws:PrincipalArn');
      expect(exempt).toEqual([CONTROL_TOWER_EXECUTION_ARN]);
      expect(exempt).not.toContain(CONTROL_TOWER_SLR_ARN);
      expect(exempt).not.toContain(PIPELINE_ROLE_ARN);
      expect(exempt).not.toContain('*');
    });

    it('SCP-ESC-SEC-001 GuardDuty and Security Hub SIDs stay unconditional', () => {
      // The compatibility instruction prohibits weakening unrelated GuardDuty / Security Hub /
      // CSPM controls. Both SIDs must remain without any Condition block after the change.
      const document = documentOf(policies, 'SCP-ESC-SEC-001');
      for (const sid of ['ScpEscSec001ProtectGuardDuty', 'ScpEscSec001ProtectSecurityHub']) {
        const entry = statementBySid(document, sid);
        expect(entry.Condition).toBeUndefined();
      }
    });

    it('SCP-ESC-SEC-002 protects S3 Object Lock immutability', () => {
      const actions = actionsOf(documentOf(policies, 'SCP-ESC-SEC-002'), 'ScpEscSec002ProtectObjectLockImmutability');
      expect(actions).toContain('s3:PutBucketObjectLockConfiguration');
      expect(actions).toContain('s3:BypassGovernanceRetention');
      expect(actions).toContain('s3:DeleteObjectVersion');
    });

    it('SCP-ESC-SEC-002 exempts only the Control Tower execution role and keeps Resource: "*"', () => {
      // Control Tower Landing Zone 4.0 rewrites the aws-controltower-logs bucket policy from the
      // Log Archive account under AWSControlTowerExecution. Resource:* stays until the bucket ARN
      // is observable post-initialization; a follow-up compatibility change will narrow it.
      const entry = statementBySid(
        documentOf(policies, 'SCP-ESC-SEC-002'),
        'ScpEscSec002ProtectObjectLockImmutability'
      );
      const exempt = conditionList(entry, 'StringNotLike', 'aws:PrincipalArn');
      expect(exempt).toEqual([CONTROL_TOWER_EXECUTION_ARN]);
      expect(entry.Resource).toBe('*');
    });

    it('SCP-ESC-SEC-003 denies the three documented Config Aggregator actions', () => {
      expect(actionsOf(documentOf(policies, 'SCP-ESC-SEC-003'), 'ScpEscSec003ProtectConfigAggregator')).toEqual([
        'config:DeleteConfigurationAggregator',
        'config:DeleteAggregationAuthorization',
        'config:PutConfigurationAggregator'
      ]);
    });

    it('SCP-ESC-SEC-003 exempts the Control Tower execution role alongside pipeline roles', () => {
      // Control Tower Landing Zone 4.0 creates and manages the Audit-account Config aggregator
      // under AWSControlTowerExecution. AWSControlTowerConfigAggregatorRoleForOrganizations is
      // Config's assumed READER role and does NOT call PutConfigurationAggregator; it is
      // intentionally NOT exempted here.
      const entry = statementBySid(documentOf(policies, 'SCP-ESC-SEC-003'), 'ScpEscSec003ProtectConfigAggregator');
      const exempt = conditionList(entry, 'StringNotLike', 'aws:PrincipalArn');
      expect(exempt).toContain(CONTROL_TOWER_EXECUTION_ARN);
      expect(exempt).toContain(PIPELINE_ROLE_ARN);
      expect(exempt).not.toContain(CONTROL_TOWER_SLR_ARN);
      expect(exempt).not.toContain('*');
    });

    it('SCP-ESC-WL-001 exempts only the CDK asset-publishing role from the S3 PutObject statements', () => {
      const document = documentOf(policies, 'SCP-ESC-WL-001');

      for (const sid of ['ScpEscWl001DenyS3PutObjectWithoutSseKmsHeader', 'ScpEscWl001DenyS3PutObjectWithoutKms']) {
        const entry = statementBySid(document, sid);
        expect(conditionList(entry, 'StringNotLike', 'aws:PrincipalArn')).toEqual([ASSET_PUBLISHING_ROLE_ARN]);
      }

      // The asset-publishing identity must not leak into unrelated guardrails.
      const ebs = statementBySid(document, 'ScpEscWl001DenyUnencryptedEbs');
      expect(hasOperator(ebs, 'StringNotLike')).toBe(false);
    });

    it('SCP-ESC-WL-001 requires CMK encryption on S3, EBS and RDS', () => {
      const document = documentOf(policies, 'SCP-ESC-WL-001');

      const s3 = statementBySid(document, 'ScpEscWl001DenyS3PutObjectWithoutKms');
      const ebs = statementBySid(document, 'ScpEscWl001DenyUnencryptedEbs');
      const rds = statementBySid(document, 'ScpEscWl001DenyUnencryptedRds');

      expect(conditionValue(s3, 'StringNotEquals', 's3:x-amz-server-side-encryption')).toBe('aws:kms');
      expect(conditionValue(ebs, 'Bool', 'ec2:Encrypted')).toBe('false');
      expect(conditionValue(rds, 'Bool', 'rds:StorageEncrypted')).toBe('false');
    });

    it('SCP-ESC-WL-002 blocks insecure transport and the three documented legacy TLS policies', () => {
      const document = documentOf(policies, 'SCP-ESC-WL-002');

      const s3 = statementBySid(document, 'ScpEscWl002DenyInsecureS3Transport');
      const elb = statementBySid(document, 'ScpEscWl002DenyLegacyElbTlsPolicies');

      expect(conditionValue(s3, 'Bool', 'aws:SecureTransport')).toBe('false');
      expect(conditionValue(elb, 'StringEquals', 'elasticloadbalancing:SecurityPolicy')).toEqual([
        'ELBSecurityPolicy-2016-08',
        'ELBSecurityPolicy-TLS-1-0-2015-04',
        'ELBSecurityPolicy-2015-05'
      ]);
    });

    it('SCP-ESC-WL-003 denies IAM user and static credential creation with both documented exemptions', () => {
      const document = documentOf(policies, 'SCP-ESC-WL-003');
      const entry = statementBySid(document, 'ScpEscWl003DenyIamUsersAndStaticCredentials');

      expect(entry.Action).toEqual([
        'iam:CreateUser',
        'iam:CreateLoginProfile',
        'iam:CreateAccessKey',
        'iam:UpdateAccessKey'
      ]);
      const exempt = conditionList(entry, 'StringNotLike', 'aws:PrincipalArn');
      expect(exempt).toContain(PIPELINE_ROLE_ARN);
      expect(exempt.some((arn) => arn.includes('AWSServiceRoleForSSO'))).toBe(true);
    });

    it('SCP-ESC-WL-004 requires all seven enterprise mandatory tags', () => {
      const document = documentOf(policies, 'SCP-ESC-WL-004');

      for (const tagKey of MANDATORY_TAG_KEYS) {
        const entry = statementBySid(document, requireTagSid(tagKey));
        expect(conditionValue(entry, 'Null', `aws:RequestTag/${tagKey}`)).toBe('true');
      }
    });

    it('SCP-ESC-WL-004 constrains the four fixed-vocabulary tag values', () => {
      const document = documentOf(policies, 'SCP-ESC-WL-004');

      for (const { key, sid, values } of WL004_VALUE_CONSTRAINTS) {
        const entry = statementBySid(document, sid);
        expect(conditionValue(entry, 'StringNotEquals', `aws:RequestTag/${key}`)).toEqual(values);
      }
    });

    it('SCP-ESC-WL-004 denies removal of any mandatory tag key', () => {
      const document = documentOf(policies, 'SCP-ESC-WL-004');
      const removal = statementBySid(document, 'ScpEscWl004DenyMandatoryTagRemoval');
      expect(conditionValue(removal, 'ForAnyValue:StringEquals', 'aws:TagKeys')).toEqual(MANDATORY_TAG_KEYS);
    });

    it('SCP-ESC-WL-004 no longer uses PascalCase tag keys or the withdrawn Secret classification', () => {
      const document = documentOf(policies, 'SCP-ESC-WL-004');
      const serialized = JSON.stringify(document);
      for (const legacy of ['DataClassification', 'CostCentre', 'Owner', 'Environment']) {
        expect(serialized).not.toContain(`aws:RequestTag/${legacy}`);
      }
      expect(serialized).not.toContain('"Secret"');
    });

    it('Control Tower exemptions do not leak into policies outside the compatibility scope', () => {
      // Per `.apm/instructions/control-tower-scp-compatibility.instructions.md`, only four SIDs
      // across four SCPs are permitted to carry a Control Tower exemption. ENC-001 and every
      // workload/enrollment SCP must not contain the SLR or execution-role ARN anywhere.
      const OUT_OF_SCOPE_POLICIES = [
        'SCP-ESC-ROOT-001',
        'SCP-ESC-ROOT-002',
        'SCP-ESC-ROOT-004',
        'SCP-ESC-ENC-002',
        'SCP-ESC-WL-001',
        'SCP-ESC-WL-002',
        'SCP-ESC-WL-003',
        'SCP-ESC-WL-004',
        'SCP-ESC-IAM-001',
        'SCP-ESC-IAM-002',
        'SCP-ESC-PROD-001',
        'SCP-ESC-INF-001',
        'SCP-ESC-SBX-001',
        'SCP-ESC-SUS-001',
        'RCP-ESC-S3-001',
        'RCP-ESC-KMS-001'
      ];
      for (const name of OUT_OF_SCOPE_POLICIES) {
        const serialized = JSON.stringify(documentOf(policies, name));
        expect(serialized, `${name} must not carry a Control Tower SLR exemption`).not.toContain(CONTROL_TOWER_SLR_ARN);
        expect(serialized, `${name} must not carry a Control Tower execution-role exemption`).not.toContain(
          CONTROL_TOWER_EXECUTION_ARN
        );
      }
    });

    it('SCP-ESC-SEC-001 unrelated statements do not gain a Control Tower exemption', () => {
      // GuardDuty and Security Hub SIDs must remain free of any Control Tower ARN.
      const document = documentOf(policies, 'SCP-ESC-SEC-001');
      for (const sid of ['ScpEscSec001ProtectGuardDuty', 'ScpEscSec001ProtectSecurityHub']) {
        const serialized = JSON.stringify(statementBySid(document, sid));
        expect(serialized).not.toContain(CONTROL_TOWER_SLR_ARN);
        expect(serialized).not.toContain(CONTROL_TOWER_EXECUTION_ARN);
      }
    });

    it('SCP-ESC-ENC-001 guards the CMK lifecycle and omits the withheld PutKeyPolicy control', () => {
      const document = documentOf(policies, 'SCP-ESC-ENC-001');
      const allActions = document.Statement.flatMap((entry) => actionsOf(document, entry.Sid));

      expect(allActions).toContain('kms:ScheduleKeyDeletion');
      expect(allActions).toContain('kms:DisableKeyRotation');
      expect(allActions).toContain('kms:DeleteImportedKeyMaterial');
      expect(allActions).toContain('kms:TagResource');
      expect(allActions).not.toContain('kms:PutKeyPolicy');
      const mfa = statementBySid(document, 'ScpEscEnc001DenyKeyLossWithoutMfa');
      expect(conditionValue(mfa, 'BoolIfExists', 'aws:MultiFactorAuthPresent')).toBe('false');
    });

    it('SCP-ESC-ENC-001 KMS tagging statement exempts Control Tower execution role', () => {
      // Control Tower requires permission to tag KMS keys during initialization (7.5 in requirements)
      const document = documentOf(policies, 'SCP-ESC-ENC-001');
      const taggingStatement = statementBySid(document, 'ScpEscEnc001DenyKeyTagTampering');
      const serialized = JSON.stringify(taggingStatement);

      expect(serialized, 'KMS tagging statement must exempt Control Tower execution role').toContain(
        CONTROL_TOWER_EXECUTION_ARN
      );
    });

    it('keeps the KMS MFA guard but exempts approved KMS and pipeline principals', () => {
      // Human administrative access stays MFA-controlled; OIDC and service-role sessions carry no
      // MFA context, so approved automation principals must be exempt (KMS design 5.1.1, 7.3).
      for (const [policyName, sid] of KMS_KEY_LOSS_STATEMENTS) {
        const entry = statementBySid(documentOf(policies, policyName), sid);
        const exempt = conditionList(entry, 'StringNotLike', 'aws:PrincipalArn');

        expect(conditionValue(entry, 'BoolIfExists', 'aws:MultiFactorAuthPresent')).toBe('false');
        expect(exempt.some((arn) => arn.includes('AWSReservedSSO_LZ-KMSAdmin-PermissionSet_'))).toBe(true);
        expect(exempt).toContain(CFN_EXEC_ROLE_ARN);
        // The deny is unchanged for every other principal.
        expect(exempt).not.toContain('*');
      }
    });

    it('SCP-ESC-ENC-002 enforces the two derivable services and withholds the other four', () => {
      const document = documentOf(policies, 'SCP-ESC-ENC-002');
      const allActions = document.Statement.flatMap((entry) => actionsOf(document, entry.Sid));

      expect(allActions).toContain('elasticfilesystem:CreateFileSystem');
      expect(allActions).toContain('elasticache:CreateReplicationGroup');
      // Withheld: no documented IAM condition key exists for these four services.
      for (const action of ['dynamodb:CreateTable', 'kafka:CreateCluster', 'sqs:CreateQueue', 'sns:CreateTopic']) {
        expect(allActions).not.toContain(action);
      }
    });

    it('SCP-ESC-IAM-001 denies the four escalation actions and exempts break-glass', () => {
      const entry = statementBySid(documentOf(policies, 'SCP-ESC-IAM-001'), 'ScpEscIam001DenyPrivilegeEscalation');

      expect(entry.Action).toEqual([
        'iam:AttachRolePolicy',
        'iam:PutRolePolicy',
        'iam:CreatePolicyVersion',
        'iam:SetDefaultPolicyVersion'
      ]);
      expect(conditionList(entry, 'StringNotLike', 'aws:PrincipalArn')).toContain(BREAK_GLASS_ROLE_ARN);
    });

    it('SCP-ESC-IAM-001 denies identity-provider and permissions-boundary changes', () => {
      const document = documentOf(policies, 'SCP-ESC-IAM-001');
      const entry = statementBySid(document, 'ScpEscIam001DenyIdentityGuardrailChanges');

      expect(entry.Action).toEqual([
        'iam:CreateOpenIDConnectProvider',
        'iam:UpdateOpenIDConnectProviderThumbprint',
        'iam:PutRolePermissionsBoundary',
        'iam:DeleteRolePermissionsBoundary',
        'iam:PutUserPermissionsBoundary',
        'iam:DeleteUserPermissionsBoundary'
      ]);
      // Excluded pending the approved resource paths in IAM design section 4.9.
      const allActions = document.Statement.flatMap((item) => actionsOf(document, item.Sid));
      expect(allActions).not.toContain('iam:PassRole');
    });

    it('SCP-ESC-IAM-002 blocks external RAM shares and unapproved trust-policy modification', () => {
      const document = documentOf(policies, 'SCP-ESC-IAM-002');
      const allActions = document.Statement.flatMap((entry) => actionsOf(document, entry.Sid));

      expect(allActions).toEqual(['ram:CreateResourceShare', 'iam:UpdateAssumeRolePolicy']);

      const ram = statementBySid(document, 'ScpEscIam002DenyExternalResourceShares');
      const trust = statementBySid(document, 'ScpEscIam002DenyTrustPolicyModification');

      expect(conditionValue(ram, 'Bool', 'ram:AllowsExternalPrincipals')).toBe('true');
      expect(conditionList(trust, 'StringNotLike', 'aws:PrincipalArn')).toContain(PIPELINE_ROLE_ARN);
      // Role CREATION with an external trust document stays outside SCP scope: permissions
      // boundaries, IAM Access Analyzer and security review carry that control.
      expect(allActions).not.toContain('iam:CreateRole');
    });

    it('SCP-ESC-INF-001 centralises VPC, internet gateway and peering management', () => {
      const document = documentOf(policies, 'SCP-ESC-INF-001');
      const entry = statementBySid(document, 'ScpEscInf001CentraliseNetworkManagement');

      expect(entry.Action).toEqual([
        'ec2:CreateVpc',
        'ec2:CreateInternetGateway',
        'ec2:AttachInternetGateway',
        'ec2:AcceptVpcPeeringConnection'
      ]);
      // Undocumented, so deliberately absent.
      expect(entry.Action).not.toContain('ec2:CreateVpcPeeringConnection');

      const exempt = conditionList(entry, 'StringNotLike', 'aws:PrincipalArn');
      expect(exempt.some((arn) => arn.includes('AWSReservedSSO_LZ-NetworkAdmin-PermissionSet_'))).toBe(true);
      expect(exempt).toContain(PIPELINE_ROLE_ARN);
    });

    it('SCP-ESC-PROD-001 combines the three documented production controls', () => {
      const document = documentOf(policies, 'SCP-ESC-PROD-001');

      expect(actionsOf(document, 'ScpEscProd001ProtectProductionStacks')).toEqual([
        'cloudformation:DeleteStack',
        'cloudformation:UpdateTerminationProtection'
      ]);
      const acl = statementBySid(document, 'ScpEscProd001DenyPublicS3Acls');
      const ssm = statementBySid(document, 'ScpEscProd001RestrictSessionManager');

      expect(conditionValue(acl, 'StringEquals', 's3:x-amz-acl')).toEqual(['public-read', 'public-read-write']);
      expect(conditionValue(ssm, 'StringNotEquals', 'ssm:resourceTag/MaintenanceWindow')).toEqual([
        'approved',
        'emergency'
      ]);
    });

    it('SCP-ESC-SBX-001 applies the documented cost guardrails', () => {
      const document = documentOf(policies, 'SCP-ESC-SBX-001');

      const instances = statementBySid(document, 'ScpEscSbx001DenyExpensiveInstanceFamilies');
      expect(conditionValue(instances, 'StringLike', 'ec2:InstanceType')).toEqual([
        '*.24xlarge',
        '*.32xlarge',
        '*.48xlarge',
        '*.metal',
        'p3.*',
        'p4.*',
        'p5.*',
        'g5.*',
        'trn1.*',
        'inf2.*'
      ]);
      expect(actionsOf(document, 'ScpEscSbx001DenyNatGateways')).toEqual(['ec2:CreateNatGateway']);
      expect(actionsOf(document, 'ScpEscSbx001DenyReservationPurchases')).toContain('savingsplans:CreateSavingsPlan');
    });

    it('SCP-ESC-SUS-001 is an unconditional full quarantine', () => {
      const document = documentOf(policies, 'SCP-ESC-SUS-001');
      const entry = statementBySid(document, 'ScpEscSus001FullQuarantine');

      expect(document.Statement).toHaveLength(1);
      expect(entry.Action).toBe('*');
      expect(entry.Resource).toBe('*');
      expect(entry.Condition).toBeUndefined();
    });
  });

  describe('resource control policies', () => {
    it.each(EXPECTED_RCP_NAMES)('%s is attached to the Root and carries an explicit Principal', (name) => {
      const policy = policyByName(policies, name);
      expect(policy.targetIds).toEqual([{ Ref: ORGANIZATION_ROOT_ID_PARAMETER_NAME }]);

      const document = documentOf(policies, name);
      for (const entry of document.Statement) {
        expect(entry.Principal).toBe('*');
      }
    });

    it.each(EXPECTED_RCP_NAMES)('%s enforces the data perimeter through the Organization ID parameter', (name) => {
      const document = documentOf(policies, name);
      const entry = document.Statement[0] as unknown as Record<string, unknown>;

      expect(conditionValue(entry, 'StringNotEqualsIfExists', 'aws:PrincipalOrgID')).toBe(ORGANIZATION_ID_PLACEHOLDER);
      // Approved derived guard: without it the perimeter would also block AWS service principals.
      expect(conditionValue(entry, 'BoolIfExists', 'aws:PrincipalIsAWSService')).toBe('false');
    });

    it('RCP-ESC-S3-001 covers all S3 actions', () => {
      expect(actionsOf(documentOf(policies, 'RCP-ESC-S3-001'), 'RcpEscS3001DenyExternalPrincipalAccess')).toEqual([
        's3:*'
      ]);
    });

    it('RCP-ESC-KMS-001 covers the six documented key operations', () => {
      expect(actionsOf(documentOf(policies, 'RCP-ESC-KMS-001'), 'RcpEscKms001DenyExternalKeyOperations')).toEqual([
        'kms:Decrypt',
        'kms:GenerateDataKey',
        'kms:GenerateDataKeyWithoutPlaintext',
        'kms:CreateGrant',
        'kms:ReEncrypt*',
        'kms:DescribeKey'
      ]);
    });

    it('references the Organization ID only through the deployment-time parameter', () => {
      expect(policyTemplateJson).not.toMatch(/\bo-[0-9a-z]{10,32}\b/);
    });
  });
});

describe('SCP-ESC-ROOT-004 approved-service-boundary extension point', () => {
  const context = {
    organizationId: ORGANIZATION_ID_PLACEHOLDER,
    exemptions: {
      pipelineRoles: ['github-actions-role'],
      assetPublishingRoles: [],
      breakGlassRoles: [],
      finOpsRoles: [],
      kmsAdministratorRoles: [],
      networkAdministratorRoles: [],
      identityCenterServiceRoles: [],
      organizationsServiceRoles: [],
      controlTowerServiceLinkedRoles: [],
      controlTowerExecutionRoles: []
    },
    approvedServiceBoundary: { services: [] }
  };

  it('emits only the customer-directed denial while no approved service list is configured', () => {
    const document = scpEscRoot004.document(context);
    expect(document.Statement).toHaveLength(1);
    expect(document.Statement[0]?.Sid).toBe('ScpEscRoot004DenyCustomerDirectedServices');
  });

  it('adds the boundary statement to the SAME policy once an approved service list is configured', () => {
    const document = scpEscRoot004.document({
      ...context,
      approvedServiceBoundary: { services: ['s3', 'ec2', 'kms'] }
    });

    expect(document.Statement).toHaveLength(2);
    expect(document.Statement[1]?.Sid).toBe('ScpEscRoot004ApprovedServiceBoundary');
    expect(document.Statement[1]?.NotAction).toEqual(['s3:*', 'ec2:*', 'kms:*']);
  });

  it('is recorded as partial against the full approved-service-boundary design', () => {
    expect(scpEscRoot004.partialAgainstDesign).toBe(true);
  });
});

describe('OrganizationsPolicy construct guard rails', () => {
  const document = policyDocument([statement({ Sid: 'Test', Effect: 'Deny', Action: '*', Resource: '*' })]);

  function scope(): cdk.Stack {
    return new cdk.Stack(new cdk.App(), 'TestStack');
  }

  it('refuses to attach a policy to an AWS account ID', () => {
    expect(
      () =>
        new ServiceControlPolicy(scope(), 'Policy', {
          policyName: 'SCP-TEST',
          description: 'test',
          document,
          targetIds: ['123456789012']
        })
    ).toThrow(/Account-level attachment is deferred/);
  });

  it('refuses to create a policy with no attachment target', () => {
    expect(
      () =>
        new ResourceControlPolicy(scope(), 'Policy', {
          policyName: 'RCP-TEST',
          description: 'test',
          document,
          targetIds: []
        })
    ).toThrow(/no attachment target/);
  });

  it('refuses to create a policy with no statements', () => {
    expect(
      () =>
        new ServiceControlPolicy(scope(), 'Policy', {
          policyName: 'SCP-TEST',
          description: 'test',
          document: policyDocument([]),
          targetIds: ['r-a1b2']
        })
    ).toThrow(/no statements/);
  });

  it('refuses duplicate attachment targets', () => {
    expect(
      () =>
        new ServiceControlPolicy(scope(), 'Policy', {
          policyName: 'SCP-TEST',
          description: 'test',
          document,
          targetIds: ['r-a1b2', 'r-a1b2']
        })
    ).toThrow(/duplicate attachment targets/);
  });

  it('emits the correct policy type for each construct', () => {
    const stack = scope();
    const scp = new ServiceControlPolicy(stack, 'Scp', {
      policyName: 'SCP-TEST',
      description: 'test',
      document,
      targetIds: ['r-a1b2']
    });
    const rcp = new ResourceControlPolicy(stack, 'Rcp', {
      policyName: 'RCP-TEST',
      description: 'test',
      document,
      targetIds: ['r-a1b2']
    });

    expect(scp.policyType).toBe('SERVICE_CONTROL_POLICY');
    expect(rcp.policyType).toBe('RESOURCE_CONTROL_POLICY');
    Template.fromStack(stack).resourceCountIs('AWS::Organizations::Policy', 2);
  });
});

describe('approved catalogue metadata', () => {
  it('gives every policy a unique ID, a target and a catalogue section', () => {
    const ids = approvedPolicies.map((policy) => policy.policyId);
    expect(new Set(ids).size).toBe(ids.length);

    for (const policy of approvedPolicies) {
      expect(policy.targetKeys.length).toBeGreaterThan(0);
      expect(policy.catalogueSection).toMatch(/^\d+\.\d+$/);
      expect(policy.description.length).toBeGreaterThan(0);
    }
  });

  it('records a status, reason and alternative controls for every withheld policy', () => {
    for (const policy of withheldPolicies) {
      expect(policy.reason.length).toBeGreaterThan(40);
      expect(policy.catalogueSection).toMatch(/^\d+\.\d+$/);
      expect(policy.status).toBe('NOT EXPRESSIBLE / NOT CURRENTLY SCP-ENFORCED');
      expect(policy.alternativeControls.length).toBeGreaterThan(0);
    }
  });

  it('names the approved alternative controls for the withheld SCP-ESC-NET-001', () => {
    const net001 = withheldPolicies.find((policy) => policy.policyId === 'SCP-ESC-NET-001');
    expect(net001).toBeDefined();

    const controls = (net001?.alternativeControls ?? []).join(' | ');
    expect(controls).toContain('wafv2-associated-with-alb');
    expect(controls).toContain('rds-instance-public-access-check');
    expect(controls).toContain('Custom AWS Config rules');
    expect(controls).toContain('Web ACL association');
  });

  it('flags exactly the policies that are partial against the approved design', () => {
    // SCP-ESC-INF-001 is no longer partial: the peering control was resolved from SCP catalogue
    // section 2.2 and the Security Baseline section 4.2 during the design reconciliation.
    const expectedPartial = [
      'SCP-ESC-ENC-001',
      'SCP-ESC-ENC-002',
      'SCP-ESC-IAM-002',
      'SCP-ESC-ROOT-004',
      'SCP-ESC-WL-001'
    ];
    const partial = approvedPolicies.filter((policy) => policy.partialAgainstDesign).map((policy) => policy.policyId);
    expect(partial.sort()).toEqual(expectedPartial.sort());
  });
});
