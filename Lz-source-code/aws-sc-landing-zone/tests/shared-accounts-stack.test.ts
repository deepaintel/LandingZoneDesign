import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { createLandingZoneApp, SHARED_ACCOUNTS_STACK_ID } from '../bin/landing-zone.js';
import type { LandingZoneConfig } from '../config/schemas/organization-schema.js';
import { sharedAccountKeys } from '../config/schemas/shared-accounts-schema.js';
import { SharedAccountsStack, sharedAccountConstructId } from '../lib/organization/shared-accounts-stack.js';

const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
const ACCOUNT_RESOURCE_TYPE = 'AWS::Organizations::Account';
const OU_RESOURCE_TYPE = 'AWS::Organizations::OrganizationalUnit';
const POLICY_RESOURCE_TYPE = 'AWS::Organizations::Policy';
const OU_ID_SECURITY_PARAMETER_NAME = 'OuIdSecurity';
const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const ACCOUNT_ID_OUTPUT_PREFIX = 'AccountId';
const ACCOUNT_COUNT_OUTPUT_NAME = 'SharedAccountCount';
const EXPECTED_ACCOUNT_COUNT = 2;
const COMMERCIAL_ARN_PREFIX = ['arn', 'aws', ''].join(':');
const ESC_REGION = 'eusc-de-east-1';
type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

interface Synthesized {
  readonly config: LandingZoneConfig;
  readonly stack: SharedAccountsStack;
  readonly template: Template;
  readonly templateJson: string;
}

function synthesize(environment: EnvironmentName): Synthesized {
  const app = new cdk.App({ context: { environment } });
  const { config, sharedAccountsStack } = createLandingZoneApp(app);
  const template = Template.fromStack(sharedAccountsStack);

  return {
    config,
    stack: sharedAccountsStack,
    template,
    templateJson: JSON.stringify(template.toJSON())
  };
}

function resourceTypes(template: Template): string[] {
  const resources = template.toJSON().Resources as Record<string, { Type: string }>;
  return Object.values(resources).map((resource) => resource.Type);
}

describe.each(ENVIRONMENT_NAMES)('SharedAccountsStack (%s)', (environment) => {
  const { config, stack, template, templateJson } = synthesize(environment);

  it('takes its stack name from bin/landing-zone.ts', () => {
    expect(stack.stackName).toBe('lz-shared-accounts');
  });

  it('is pinned to the AWS ESC Region', () => {
    expect(stack.region).toBe(ESC_REGION);
    expect(config.aws.region).toBe(ESC_REGION);
  });

  it(`synthesizes exactly ${EXPECTED_ACCOUNT_COUNT} accounts`, () => {
    template.resourceCountIs(ACCOUNT_RESOURCE_TYPE, EXPECTED_ACCOUNT_COUNT);
    expect(stack.accounts.size).toBe(EXPECTED_ACCOUNT_COUNT);
  });

  it('synthesizes zero OUs', () => {
    template.resourceCountIs(OU_RESOURCE_TYPE, 0);
  });

  it('synthesizes zero policies', () => {
    template.resourceCountIs(POLICY_RESOURCE_TYPE, 0);
  });

  it('contains no resource type other than accounts', () => {
    expect([...new Set(resourceTypes(template))]).toEqual([ACCOUNT_RESOURCE_TYPE]);
  });

  it('declares the OuIdSecurity CloudFormation parameter with the correct pattern', () => {
    template.hasParameter(OU_ID_SECURITY_PARAMETER_NAME, {
      Type: 'String',
      AllowedPattern: OU_ID_PATTERN.source
    });
  });

  it('never embeds a literal OU ID', () => {
    expect(templateJson).not.toMatch(/"ParentIds":\["ou-/);
    expect(templateJson).not.toMatch(/"ParentIds":"ou-/);
  });

  it('attaches every account to the OuIdSecurity parameter (no cross-stack ImportValue)', () => {
    expect(templateJson).not.toContain('Fn::ImportValue');
    for (const key of sharedAccountKeys) {
      const entry = config.accounts[key];
      template.hasResourceProperties(ACCOUNT_RESOURCE_TYPE, {
        AccountName: entry.name,
        Email: entry.email,
        ParentIds: [{ Ref: OU_ID_SECURITY_PARAMETER_NAME }]
      });
    }
  });

  it('applies Retain to every account for both delete and update-replace', () => {
    const resources = template.toJSON().Resources as Record<
      string,
      { Type: string; DeletionPolicy?: string; UpdateReplacePolicy?: string }
    >;
    const accountEntries = Object.entries(resources).filter(([, r]) => r.Type === ACCOUNT_RESOURCE_TYPE);
    expect(accountEntries).toHaveLength(EXPECTED_ACCOUNT_COUNT);
    for (const [logicalId, resource] of accountEntries) {
      expect(resource.DeletionPolicy, `${logicalId} DeletionPolicy`).toBe('Retain');
      expect(resource.UpdateReplacePolicy, `${logicalId} UpdateReplacePolicy`).toBe('Retain');
    }
  });

  it('emits one AccountId output per account plus the count', () => {
    const outputs = template.toJSON().Outputs as Record<string, { Value: unknown }>;
    const accountIdOutputs = Object.keys(outputs).filter((key) => key.startsWith(ACCOUNT_ID_OUTPUT_PREFIX));
    expect(accountIdOutputs).toHaveLength(EXPECTED_ACCOUNT_COUNT);
    template.hasOutput(ACCOUNT_COUNT_OUTPUT_NAME, { Value: String(EXPECTED_ACCOUNT_COUNT) });
    template.hasOutput(`${ACCOUNT_ID_OUTPUT_PREFIX}LogArchive`, {});
    template.hasOutput(`${ACCOUNT_ID_OUTPUT_PREFIX}Audit`, {});
  });

  it('emits no output with a Fn::Export block', () => {
    const outputs = template.toJSON().Outputs as Record<string, Record<string, unknown>>;
    for (const [name, value] of Object.entries(outputs)) {
      expect(value.Export, `${name} must not declare an Export block`).toBeUndefined();
    }
  });

  it('produces PascalCase construct IDs for each account key', () => {
    expect(sharedAccountConstructId('logArchive')).toBe('LogArchive');
    expect(sharedAccountConstructId('audit')).toBe('Audit');
    for (const key of sharedAccountKeys) {
      const account = stack.accounts.get(key);
      expect(account?.node.id).toBe(sharedAccountConstructId(key));
    }
  });

  it('contains no commercial AWS partition or Region reference', () => {
    expect(templateJson).not.toContain(COMMERCIAL_ARN_PREFIX);
    expect(templateJson).not.toMatch(/\b(?:us|eu|ap|sa|ca|me|af|il|cn)-(?:gov-)?[a-z]+-\d\b/);
  });

  it('contains no reference to the retired develop model', () => {
    expect(templateJson.toLowerCase()).not.toContain('develop');
  });

  it('carries no cross-stack ImportValue or Export link to the OU or policy stack', () => {
    // Matches the assertion convention already established in
    // tests/organization-policy-stack.test.ts: an actual coupling is either an Fn::ImportValue
    // reference or a CloudFormation Export block, never a prose mention of another stack's name.
    // The OuIdSecurity parameter's Description LEGITIMATELY names 'lz-ou-structure' as
    // human-readable provenance ("supplied at deployment time from the ... lz-ou-structure
    // stack"), mirroring the OuId* parameters already declared by OrganizationPolicyStack - that
    // text is documentation, not a CloudFormation reference, so it must not be banned here.
    expect(templateJson).not.toMatch(/"Fn::ImportValue"/);

    const outputs = template.toJSON().Outputs as Record<string, { Export?: unknown }>;
    for (const [name, output] of Object.entries(outputs)) {
      expect(output.Export, `output '${name}' must not carry a CloudFormation Export`).toBeUndefined();
    }
  });

  it('carries the expected environment-specific email through configuration, not code', () => {
    const expectedLogArchiveEmail =
      environment === 'staging' ? 'FMITaws-cloud-org-002+LogArchive@if.se' : 'FMITaws-cloud-org-001+LogArchive@if.se';
    expect(config.accounts.logArchive.email).toBe(expectedLogArchiveEmail);
    template.hasResourceProperties(ACCOUNT_RESOURCE_TYPE, {
      AccountName: 'Log Archive',
      Email: expectedLogArchiveEmail
    });
  });
});

describe(`SharedAccountsStack (${SHARED_ACCOUNTS_STACK_ID} identity)`, () => {
  it('exports the expected construct ID', () => {
    expect(SHARED_ACCOUNTS_STACK_ID).toBe('SharedAccountsStack');
  });
});
