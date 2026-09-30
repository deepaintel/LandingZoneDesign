import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import type { LandingZoneAccountsConfig } from '../config/schemas/landing-zone-accounts-schema.js';
import {
  LandingZoneAccountsStack,
  landingZoneAccountConstructId,
  ouPathToParameterName
} from '../lib/organization/landing-zone-accounts-stack.js';

const ACCOUNT_RESOURCE_TYPE = 'AWS::Organizations::Account';
const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const ESC_REGION = 'eusc-de-east-1';
const CLOUD_APPLICATION_PLATFORM = 'Cloud Application Platform';

const FIXTURE_ACCOUNTS: LandingZoneAccountsConfig = {
  securityTooling: {
    name: 'SecurityTooling',
    email: 'FMITaws-cloud-org-002+SecurityTooling@if.se',
    ouPath: 'Security',
    owner: 'CCoE',
    costCentre: 'AISARCH',
    securityContact: 'FMITaws-cloud-org-002+SecurityContact@if.se',
    operationsContact: 'cloud@if.eu',
    tags: {
      environment: 'staging',
      lifecycle: 'active',
      dataClassification: 'internal',
      dataResidency: 'EU',
      domain: CLOUD_APPLICATION_PLATFORM
    }
  },
  network: {
    name: 'Network',
    email: 'FMITaws-cloud-org-002+Network@if.se',
    ouPath: 'Infrastructure',
    owner: 'Connectivity',
    costCentre: 'AISCCNO',
    securityContact: 'FMITaws-cloud-org-002+SecurityContact@if.se',
    operationsContact: 'network-hub@if.fi',
    tags: {
      environment: 'staging',
      lifecycle: 'active',
      dataClassification: 'internal',
      dataResidency: 'EU',
      domain: CLOUD_APPLICATION_PLATFORM
    }
  },
  ccoeHybridProd01: {
    name: 'CCoE-Hybrid-Prod-01',
    email: 'FMITaws-cloud-org-002+CCoE-Hybrid-Prod-01@if.se',
    ouPath: 'Workloads/Hybrid/Prod',
    owner: 'CCoE',
    costCentre: 'AISARCH',
    securityContact: 'FMITaws-cloud-org-002+SecurityContact@if.se',
    operationsContact: 'cloud@if.eu',
    tags: {
      environment: 'prod',
      lifecycle: 'active',
      dataClassification: 'internal',
      dataResidency: 'EU',
      domain: CLOUD_APPLICATION_PLATFORM
    }
  }
};

function synthesizeFixture(accounts: LandingZoneAccountsConfig): {
  stack: LandingZoneAccountsStack;
  template: Template;
  templateJson: string;
} {
  const app = new cdk.App();
  const stack = new LandingZoneAccountsStack(app, 'LandingZoneAccountsStack', {
    stackName: 'lz-landing-zone-accounts',
    env: { account: '111111111111', region: ESC_REGION },
    landingZoneAccountsConfig: accounts
  });
  const template = Template.fromStack(stack);
  return { stack, template, templateJson: JSON.stringify(template.toJSON()) };
}

describe('LandingZoneAccountsStack', () => {
  it('synthesizes exactly one AWS::Organizations::Account resource per configured account', () => {
    const { template, stack } = synthesizeFixture(FIXTURE_ACCOUNTS);
    template.resourceCountIs(ACCOUNT_RESOURCE_TYPE, Object.keys(FIXTURE_ACCOUNTS).length);
    expect(stack.accounts.size).toBe(Object.keys(FIXTURE_ACCOUNTS).length);
  });

  it('synthesizes zero resources for an empty active configuration', () => {
    const { template } = synthesizeFixture({});
    template.resourceCountIs(ACCOUNT_RESOURCE_TYPE, 0);
  });

  it('applies Retain to every account for both delete and update-replace', () => {
    const { template } = synthesizeFixture(FIXTURE_ACCOUNTS);
    const resources = template.toJSON().Resources as Record<
      string,
      { Type: string; DeletionPolicy?: string; UpdateReplacePolicy?: string }
    >;
    const accounts = Object.entries(resources).filter(([, r]) => r.Type === ACCOUNT_RESOURCE_TYPE);
    expect(accounts.length).toBe(Object.keys(FIXTURE_ACCOUNTS).length);
    for (const [logicalId, resource] of accounts) {
      expect(resource.DeletionPolicy, `${logicalId} DeletionPolicy`).toBe('Retain');
      expect(resource.UpdateReplacePolicy, `${logicalId} UpdateReplacePolicy`).toBe('Retain');
    }
  });

  it('declares one OuId parameter per distinct OU with the correct pattern constraint', () => {
    const { template } = synthesizeFixture(FIXTURE_ACCOUNTS);
    const expectedParameters = new Set<string>();
    for (const entry of Object.values(FIXTURE_ACCOUNTS)) {
      expectedParameters.add(ouPathToParameterName(entry.ouPath));
    }
    for (const parameterName of expectedParameters) {
      template.hasParameter(parameterName, { Type: 'String', AllowedPattern: OU_ID_PATTERN.source });
    }
    const parameters = template.toJSON().Parameters as Record<string, unknown>;
    const observedOuParameters = Object.keys(parameters).filter((name) => name.startsWith('OuId'));
    expect(new Set(observedOuParameters)).toEqual(expectedParameters);
  });

  it('references each account parent as { Ref: OuId<Key> } - no literal OU ID, no Fn::ImportValue', () => {
    const { template, templateJson } = synthesizeFixture(FIXTURE_ACCOUNTS);
    expect(templateJson).not.toMatch(/"ParentIds":\["ou-/);
    expect(templateJson).not.toContain('Fn::ImportValue');
    for (const entry of Object.values(FIXTURE_ACCOUNTS)) {
      const parameterName = ouPathToParameterName(entry.ouPath);
      template.hasResourceProperties(ACCOUNT_RESOURCE_TYPE, {
        AccountName: entry.name,
        Email: entry.email,
        ParentIds: [{ Ref: parameterName }]
      });
    }
  });

  it('emits no output with a Fn::Export block', () => {
    const { template } = synthesizeFixture(FIXTURE_ACCOUNTS);
    const outputs = template.toJSON().Outputs as Record<string, Record<string, unknown>>;
    for (const [name, value] of Object.entries(outputs)) {
      expect(value.Export, `${name} must not declare an Export block`).toBeUndefined();
    }
  });

  it('emits one AccountId<Key> output per instantiated account plus LandingZoneAccountCount', () => {
    const { template } = synthesizeFixture(FIXTURE_ACCOUNTS);
    const outputs = template.toJSON().Outputs as Record<string, { Value: unknown }>;
    const accountIdOutputs = Object.keys(outputs).filter((key) => key.startsWith('AccountId'));
    expect(accountIdOutputs).toHaveLength(Object.keys(FIXTURE_ACCOUNTS).length);
    template.hasOutput('LandingZoneAccountCount', { Value: String(Object.keys(FIXTURE_ACCOUNTS).length) });
    for (const key of Object.keys(FIXTURE_ACCOUNTS)) {
      template.hasOutput(`AccountId${landingZoneAccountConstructId(key)}`, {});
    }
  });

  // AWS::Organizations::Account.Tags is synthesized as an alphabetically-ordered array by CDK.
  // Tag assertions below use the `tagsFor(...)` helper (raw JS access into the synthesized
  // template) combined with Vitest's `toContainEqual` matcher, which is order-independent and
  // does not depend on CDK's `Match.arrayWith` (which - in aws-cdk-lib 2.264 - requires
  // patterns to appear as an ORDERED SUBSEQUENCE in the actual array and would silently fail
  // whenever tag pattern order diverged from the alphabetical synthesized order).
  const EXPECTED_TAG_KEYS = [
    'owner',
    'owner-email',
    'environment',
    'lifecycle',
    'data-classification',
    'data-residency',
    'itsystemcode',
    'domain'
  ] as const;

  function tagsFor(template: Template, accountName: string): Array<{ Key: string; Value: string }> {
    const resources = template.toJSON().Resources as Record<
      string,
      { Type: string; Properties?: { AccountName?: string; Tags?: Array<{ Key: string; Value: string }> } }
    >;
    for (const resource of Object.values(resources)) {
      if (resource.Type === ACCOUNT_RESOURCE_TYPE && resource.Properties?.AccountName === accountName) {
        return resource.Properties?.Tags ?? [];
      }
    }
    throw new Error(`No AWS::Organizations::Account with AccountName='${accountName}' found.`);
  }

  it('applies all eight mandatory P1 tags on every account using the approved mappings', () => {
    const { template } = synthesizeFixture(FIXTURE_ACCOUNTS);
    for (const entry of Object.values(FIXTURE_ACCOUNTS)) {
      const observed = tagsFor(template, entry.name);
      expect(observed).toHaveLength(EXPECTED_TAG_KEYS.length);
      expect(observed.map((t) => t.Key).sort()).toEqual([...EXPECTED_TAG_KEYS].sort());
      expect(observed).toContainEqual({ Key: 'owner', Value: entry.owner });
      expect(observed).toContainEqual({ Key: 'owner-email', Value: entry.email });
      expect(observed).toContainEqual({ Key: 'environment', Value: entry.tags.environment });
      expect(observed).toContainEqual({ Key: 'lifecycle', Value: entry.tags.lifecycle });
      expect(observed).toContainEqual({ Key: 'data-classification', Value: entry.tags.dataClassification });
      expect(observed).toContainEqual({ Key: 'data-residency', Value: 'EU' });
      expect(observed).toContainEqual({ Key: 'itsystemcode', Value: entry.costCentre });
      expect(observed).toContainEqual({ Key: 'domain', Value: entry.tags.domain });
    }
  });

  it('sets owner-email tag to the AWS Account Email value (mapping check)', () => {
    const { template } = synthesizeFixture(FIXTURE_ACCOUNTS);
    for (const entry of Object.values(FIXTURE_ACCOUNTS)) {
      // The `Email` property (used for AWS::Organizations::Account creation) and the
      // `owner-email` tag must both equal the workbook Account Email per §9 of the
      // Landing Zone account provisioning instruction.
      template.hasResourceProperties(ACCOUNT_RESOURCE_TYPE, {
        AccountName: entry.name,
        Email: entry.email
      });
      const observed = tagsFor(template, entry.name);
      expect(observed.map((t) => t.Key).sort()).toEqual([...EXPECTED_TAG_KEYS].sort());
      expect(observed).toContainEqual({ Key: 'owner', Value: entry.owner });
      expect(observed).toContainEqual({ Key: 'owner-email', Value: entry.email });
    }
  });

  it('sets itsystemcode tag from costCentre (Cost Centre -> itsystemcode mapping)', () => {
    const { template } = synthesizeFixture(FIXTURE_ACCOUNTS);
    for (const entry of Object.values(FIXTURE_ACCOUNTS)) {
      const observed = tagsFor(template, entry.name);
      // Prove Cost Centre -> itsystemcode and the customer-approved fixed data-residency.
      expect(observed.map((t) => t.Key).sort()).toEqual([...EXPECTED_TAG_KEYS].sort());
      expect(observed).toContainEqual({ Key: 'itsystemcode', Value: entry.costCentre });
      expect(observed).toContainEqual({ Key: 'data-residency', Value: 'EU' });
      // Prove no separate CostCentre / cost-centre / cost-center AWS tag was emitted.
      for (const forbiddenKey of ['CostCentre', 'cost-centre', 'cost-center']) {
        expect(observed.some((t) => t.Key === forbiddenKey)).toBe(false);
      }
    }
  });

  it('sets domain from the account tags block - Cloud Application Platform for current LZ accounts', () => {
    const { template } = synthesizeFixture(FIXTURE_ACCOUNTS);
    for (const entry of Object.values(FIXTURE_ACCOUNTS)) {
      const observed = tagsFor(template, entry.name);
      // §8.1: for every current LZ account, `domain` is the customer-confirmed literal
      // `Cloud Application Platform` sourced from configuration (not hard-coded in TypeScript).
      expect(observed.map((t) => t.Key).sort()).toEqual([...EXPECTED_TAG_KEYS].sort());
      expect(observed).toContainEqual({ Key: 'domain', Value: CLOUD_APPLICATION_PLATFORM });
    }
  });

  it('reads environment, lifecycle, and data-classification directly from configuration (no inference)', () => {
    const { template } = synthesizeFixture({
      ccoeHybridProd01: {
        name: 'CCoE-Hybrid-Prod-01',
        email: 'FMITaws-cloud-org-002+CCoE-Hybrid-Prod-01@if.se',
        ouPath: 'Workloads/Hybrid/Prod',
        owner: 'CCoE',
        costCentre: 'AISARCH',
        securityContact: 'FMITaws-cloud-org-002+SecurityContact@if.se',
        operationsContact: 'cloud@if.eu',
        tags: {
          // Deliberately mismatched with the "Prod" account-name / OU fragment to prove no
          // inference: the tag values follow configuration, not the account name.
          environment: 'sandbox',
          lifecycle: 'decommissioning',
          dataClassification: 'restricted',
          dataResidency: 'EU',
          domain: CLOUD_APPLICATION_PLATFORM
        }
      }
    });
    const observed = tagsFor(template, 'CCoE-Hybrid-Prod-01');
    expect(observed.map((t) => t.Key).sort()).toEqual([...EXPECTED_TAG_KEYS].sort());
    expect(observed).toContainEqual({ Key: 'owner', Value: 'CCoE' });
    expect(observed).toContainEqual({ Key: 'owner-email', Value: 'FMITaws-cloud-org-002+CCoE-Hybrid-Prod-01@if.se' });
    expect(observed).toContainEqual({ Key: 'environment', Value: 'sandbox' });
    expect(observed).toContainEqual({ Key: 'lifecycle', Value: 'decommissioning' });
    expect(observed).toContainEqual({ Key: 'data-classification', Value: 'restricted' });
    expect(observed).toContainEqual({ Key: 'data-residency', Value: 'EU' });
    expect(observed).toContainEqual({ Key: 'itsystemcode', Value: 'AISARCH' });
    expect(observed).toContainEqual({ Key: 'domain', Value: CLOUD_APPLICATION_PLATFORM });
  });

  it('accepts a non-Cloud-Application-Platform domain (future workload configurability)', () => {
    const { template } = synthesizeFixture({
      futureWorkload: {
        name: 'MachineLearning-Prod-01',
        email: 'FMITaws-cloud-org-002+MachineLearning-Prod-01@if.se',
        ouPath: 'Workloads/Hybrid/Prod',
        owner: 'AnalyticsTeam',
        costCentre: 'AISML01',
        securityContact: 'FMITaws-cloud-org-002+SecurityContact@if.se',
        operationsContact: 'cloud@if.eu',
        tags: {
          environment: 'prod',
          lifecycle: 'active',
          dataClassification: 'confidential',
          dataResidency: 'EU',
          domain: 'MachineLearning'
        }
      }
    });
    const observed = tagsFor(template, 'MachineLearning-Prod-01');
    expect(observed.map((t) => t.Key).sort()).toEqual([...EXPECTED_TAG_KEYS].sort());
    // §8.2: future workload accounts supply their own domain; the generic schema is not
    // literal-bound to `Cloud Application Platform`.
    expect(observed).toContainEqual({ Key: 'domain', Value: 'MachineLearning' });
  });

  it('produces PascalCase construct IDs for each account key', () => {
    const { stack } = synthesizeFixture(FIXTURE_ACCOUNTS);
    expect(landingZoneAccountConstructId('securityTooling')).toBe('SecurityTooling');
    expect(landingZoneAccountConstructId('ccoeHybridProd01')).toBe('CcoeHybridProd01');
    for (const key of Object.keys(FIXTURE_ACCOUNTS)) {
      expect(stack.accounts.get(key)?.node.id).toBe(landingZoneAccountConstructId(key));
    }
  });

  it('maps OU paths to the expected OuId parameter names', () => {
    expect(ouPathToParameterName('Security')).toBe('OuIdSecurity');
    expect(ouPathToParameterName('Infrastructure')).toBe('OuIdInfrastructure');
    expect(ouPathToParameterName('Workloads/Hybrid/Prod')).toBe('OuIdWorkloadsHybridProd');
    expect(ouPathToParameterName('Workloads/Hybrid/Non-Prod')).toBe('OuIdWorkloadsHybridNonProd');
    expect(ouPathToParameterName('Workloads/Corp/Non-Prod')).toBe('OuIdWorkloadsCorpNonProd');
  });
});
