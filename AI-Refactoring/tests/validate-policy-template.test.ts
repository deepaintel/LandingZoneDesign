import { describe, expect, it } from 'vitest';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import { approvedPolicies, type PolicyContext } from '../lib/organization/policies/index.js';
import {
  findControlTowerExemptionViolations,
  type PolicyDocumentUnderTest
} from '../scripts/validate-policy-template.js';

const ROLE_ARN_PREFIX = 'arn:aws-eusc:iam::*:role/';
const CONTROL_TOWER_EXECUTION_ARN = `${ROLE_ARN_PREFIX}AWSControlTowerExecution`;
const STACKSETS_EXECUTION_ARN = `${ROLE_ARN_PREFIX}stacksets-exec-*`;

const config = new ConfigReader('staging', { configDirName: 'config', schema: LandingZoneSchema }).getConfig();
const exemptions = config.governance.policyExemptions;
const context: PolicyContext = {
  organizationId: 'o-testorganization',
  exemptions,
  approvedServiceBoundary: config.governance.approvedServiceBoundary
};
const baseExemptionArns = {
  pipelineRoles: exemptions.pipelineRoles.map((role) => `${ROLE_ARN_PREFIX}${role}`),
  breakGlassRoles: exemptions.breakGlassRoles.map((role) => `${ROLE_ARN_PREFIX}${role}`)
};

type MutableStatement = Record<string, unknown> & { Condition?: Record<string, Record<string, unknown>> };

/** Fresh, deep-copied rendering of every approved policy so each test can mutate freely. */
function renderPolicies(): PolicyDocumentUnderTest[] {
  return approvedPolicies.map((policy) => ({
    name: policy.policyId,
    document: JSON.parse(JSON.stringify(policy.document(context))) as Record<string, unknown>
  }));
}

function statementOf(policies: PolicyDocumentUnderTest[], name: string, sid: string): MutableStatement {
  const policy = policies.find((entry) => entry.name === name);
  const statements = (policy?.document['Statement'] ?? []) as MutableStatement[];
  const found = statements.find((entry) => entry['Sid'] === sid);
  if (found === undefined) throw new Error(`fixture missing ${name}#${sid}`);
  return found;
}

function exemptionListOf(entry: MutableStatement): string[] {
  return (entry.Condition?.['StringNotLike']?.['aws:PrincipalArn'] ?? []) as string[];
}

describe('findControlTowerExemptionViolations', () => {
  it('accepts the policies exactly as the catalogue renders them', () => {
    expect(findControlTowerExemptionViolations(renderPolicies(), baseExemptionArns)).toEqual([]);
  });

  it('rejects a Control Tower exemption leaking into the second SCP-ESC-IAM-001 statement', () => {
    const policies = renderPolicies();
    const entry = statementOf(policies, 'SCP-ESC-IAM-001', 'ScpEscIam001DenyIdentityGuardrailChanges');
    exemptionListOf(entry).push(CONTROL_TOWER_EXECUTION_ARN);

    expect(findControlTowerExemptionViolations(policies, baseExemptionArns)).toEqual([
      expect.stringContaining("SID 'ScpEscIam001DenyIdentityGuardrailChanges' references a Control Tower")
    ]);
  });

  it('rejects any exemption added to the SCP-ESC-WL-004 tag-removal statement', () => {
    const policies = renderPolicies();
    const entry = statementOf(policies, 'SCP-ESC-WL-004', 'ScpEscWl004DenyMandatoryTagRemoval');
    entry.Condition = { ...entry.Condition, StringNotLike: { 'aws:PrincipalArn': [CONTROL_TOWER_EXECUTION_ARN] } };

    expect(findControlTowerExemptionViolations(policies, baseExemptionArns)).toEqual([
      expect.stringContaining("SID 'ScpEscWl004DenyMandatoryTagRemoval' references a Control Tower")
    ]);
  });

  it('rejects SCP-ESC-IAM-001 when the StackSets execution role exemption is missing', () => {
    const policies = renderPolicies();
    const list = exemptionListOf(statementOf(policies, 'SCP-ESC-IAM-001', 'ScpEscIam001DenyPrivilegeEscalation'));
    list.splice(list.indexOf(STACKSETS_EXECUTION_ARN), 1);

    expect(findControlTowerExemptionViolations(policies, baseExemptionArns)).toEqual([
      expect.stringContaining('must exempt exactly')
    ]);
  });

  it('rejects an extra StackSets exemption on a WL-004 tag-on-create statement', () => {
    const policies = renderPolicies();
    exemptionListOf(statementOf(policies, 'SCP-ESC-WL-004', 'ScpEscWl004RequireOwnerTag')).push(
      STACKSETS_EXECUTION_ARN
    );

    expect(findControlTowerExemptionViolations(policies, baseExemptionArns)).toEqual([
      expect.stringContaining("SID 'ScpEscWl004RequireOwnerTag' must exempt exactly")
    ]);
  });

  it('rejects SCP-ESC-IAM-001 when a pipeline or break-glass exemption is dropped', () => {
    const policies = renderPolicies();
    const list = exemptionListOf(statementOf(policies, 'SCP-ESC-IAM-001', 'ScpEscIam001DenyPrivilegeEscalation'));
    const breakGlass = baseExemptionArns.breakGlassRoles[0] ?? '';
    list.splice(list.indexOf(breakGlass), 1);

    expect(findControlTowerExemptionViolations(policies, baseExemptionArns)).toEqual([
      expect.stringContaining('must keep exactly the ["pipelineRoles","breakGlassRoles"] exemptions')
    ]);
  });

  it('rejects a narrowed SCP-ESC-IAM-001 action list', () => {
    const policies = renderPolicies();
    statementOf(policies, 'SCP-ESC-IAM-001', 'ScpEscIam001DenyPrivilegeEscalation')['Action'] = [
      'iam:AttachRolePolicy'
    ];

    expect(findControlTowerExemptionViolations(policies, baseExemptionArns)).toEqual([
      expect.stringContaining('must deny exactly')
    ]);
  });

  it('rejects a WL-004 tag-on-create statement that gains a non-Control-Tower exemption', () => {
    const policies = renderPolicies();
    exemptionListOf(statementOf(policies, 'SCP-ESC-WL-004', 'ScpEscWl004RestrictEnvironmentValues')).push(
      baseExemptionArns.pipelineRoles[0] ?? ''
    );

    expect(findControlTowerExemptionViolations(policies, baseExemptionArns)).toEqual([
      expect.stringContaining("SID 'ScpEscWl004RestrictEnvironmentValues' must keep exactly the []")
    ]);
  });

  it('rejects a missing approved statement', () => {
    const policies = renderPolicies().filter((policy) => policy.name !== 'SCP-ESC-ENC-001');

    expect(findControlTowerExemptionViolations(policies, baseExemptionArns)).toEqual([
      expect.stringContaining("missing statement 'ScpEscEnc001DenyKeyTagTampering'")
    ]);
  });
});
