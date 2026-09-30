import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLandingZoneApp, OU_STRUCTURE_STACK_ID } from '../bin/landing-zone.js';
import type { LandingZoneConfig } from '../config/schemas/organization-schema.js';
import { OuStructureStack, organizationalUnitConstructId } from '../lib/organization/ou-structure-stack.js';

const COMMERCIAL_ARN_PREFIX = ['arn', 'aws', ''].join(':');
const EXPECTED_OU_COUNT = 14;
const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
const ESC_REGION = 'eusc-de-east-1';
const ORGANIZATION_ROOT_ID_PARAMETER_NAME = 'OrganizationRootId';
const ORGANIZATION_ROOT_ID_PATTERN = /^r-[0-9a-z]{4,32}$/;
const OU_COUNT_OUTPUT_NAME = 'OrganizationalUnitCount';
const OU_ID_OUTPUT_PREFIX = 'OuId';
const OU_RESOURCE_TYPE = 'AWS::Organizations::OrganizationalUnit';
const ACCOUNT_RESOURCE_TYPE = 'AWS::Organizations::Account';
const POLICY_RESOURCE_TYPE = 'AWS::Organizations::Policy';
type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

interface Synthesized {
  readonly config: LandingZoneConfig;
  readonly stack: OuStructureStack;
  readonly template: Template;
  readonly templateJson: string;
}

function synthesize(environment: EnvironmentName): Synthesized {
  const app = new cdk.App({ context: { environment } });
  const { config, ouStructureStack } = createLandingZoneApp(app);
  const template = Template.fromStack(ouStructureStack);

  return { config, stack: ouStructureStack, template, templateJson: JSON.stringify(template.toJSON()) };
}

function parentLogicalId(stack: OuStructureStack, key: string): string {
  const unit = stack.organizationalUnits.get(key);
  expect(unit, `expected OU '${key}' to exist`).toBeDefined();
  // CfnElement.logicalId is a lazy token; resolve it through the stack to get the real logical ID.
  return unit === undefined ? '' : stack.getLogicalId(unit.cfnOrganizationalUnit);
}

function resourceTypes(template: Template): string[] {
  const resources = template.toJSON().Resources as Record<string, { Type: string }>;
  return Object.values(resources).map((resource) => resource.Type);
}

describe.each(ENVIRONMENT_NAMES)('OuStructureStack (%s)', (environment) => {
  const { config, stack, template, templateJson } = synthesize(environment);

  it('takes its stack name from configuration', () => {
    expect(stack.stackName).toBe('lz-ou-structure');
  });

  it('is pinned to the AWS ESC Region', () => {
    expect(stack.region).toBe(ESC_REGION);
    expect(config.aws.region).toBe(ESC_REGION);
  });

  it(`synthesizes exactly ${EXPECTED_OU_COUNT} organizational units`, () => {
    template.resourceCountIs(OU_RESOURCE_TYPE, EXPECTED_OU_COUNT);
    expect(stack.organizationalUnits.size).toBe(EXPECTED_OU_COUNT);
  });

  it('synthesizes zero accounts', () => {
    template.resourceCountIs(ACCOUNT_RESOURCE_TYPE, 0);
  });

  it('synthesizes zero policies', () => {
    template.resourceCountIs(POLICY_RESOURCE_TYPE, 0);
  });

  it('contains no resource type other than organizational units', () => {
    expect([...new Set(resourceTypes(template))]).toEqual([OU_RESOURCE_TYPE]);
  });

  it('does not create the Organizations Root', () => {
    // The Root arrives as an external, pattern-constrained deployment input.
    template.hasParameter(ORGANIZATION_ROOT_ID_PARAMETER_NAME, {
      Type: 'String',
      AllowedPattern: ORGANIZATION_ROOT_ID_PATTERN.source
    });
    expect(resourceTypes(template)).not.toContain('AWS::Organizations::Organization');
    template.resourceCountIs('AWS::Organizations::Organization', 0);
  });

  it('never embeds a literal Root or OU ID', () => {
    expect(templateJson).not.toMatch(/"ParentId":"r-/);
    expect(templateJson).not.toMatch(/"ParentId":"ou-/);
  });

  it('attaches every L1 OU to the external Root parameter', () => {
    const l1Names = ['Security', 'Infrastructure', 'Sandbox', 'Suspended', 'Workloads'];

    for (const name of l1Names) {
      template.hasResourceProperties(OU_RESOURCE_TYPE, {
        Name: name,
        ParentId: { Ref: ORGANIZATION_ROOT_ID_PARAMETER_NAME }
      });
    }

    const resources = template.toJSON().Resources as Record<string, { Properties: { ParentId: unknown } }>;
    const rootChildren = Object.values(resources).filter(
      (resource) =>
        JSON.stringify(resource.Properties.ParentId) === JSON.stringify({ Ref: ORGANIZATION_ROOT_ID_PARAMETER_NAME })
    );
    expect(rootChildren).toHaveLength(l1Names.length);
  });

  it('attaches L2 workload domains to the generated Workloads OU resource', () => {
    const workloadsLogicalId = parentLogicalId(stack, 'workloads');

    for (const name of ['Hybrid', 'Online', 'Corp']) {
      template.hasResourceProperties(OU_RESOURCE_TYPE, {
        Name: name,
        ParentId: { 'Fn::GetAtt': [workloadsLogicalId, 'Id'] }
      });
    }
  });

  it.each(['workloads-hybrid', 'workloads-online', 'workloads-corp'])(
    'attaches Prod and Non-Prod to the generated %s OU resource',
    (parentKey) => {
      const logicalId = parentLogicalId(stack, parentKey);

      for (const name of ['Prod', 'Non-Prod']) {
        template.hasResourceProperties(OU_RESOURCE_TYPE, {
          Name: name,
          ParentId: { 'Fn::GetAtt': [logicalId, 'Id'] }
        });
      }
    }
  );

  it('creates deterministic construct IDs derived from the configuration keys', () => {
    expect(organizationalUnitConstructId('workloads-hybrid-non-prod')).toBe('WorkloadsHybridNonProd');

    for (const entry of stack.hierarchy) {
      const unit = stack.organizationalUnits.get(entry.key);
      expect(unit?.node.id).toBe(organizationalUnitConstructId(entry.key));
    }
  });

  it('creates the parent OU resource before its children', () => {
    const resources = Object.keys(template.toJSON().Resources as Record<string, unknown>);
    const workloadsIndex = resources.indexOf(parentLogicalId(stack, 'workloads'));
    const hybridIndex = resources.indexOf(parentLogicalId(stack, 'workloads-hybrid'));
    const hybridProdIndex = resources.indexOf(parentLogicalId(stack, 'workloads-hybrid-prod'));

    expect(workloadsIndex).toBeGreaterThanOrEqual(0);
    expect(workloadsIndex).toBeLessThan(hybridIndex);
    expect(hybridIndex).toBeLessThan(hybridProdIndex);
  });

  it('exports one OU ID output per OU plus the OU count', () => {
    const outputs = template.toJSON().Outputs as Record<string, { Value: unknown }>;
    const ouIdOutputs = Object.keys(outputs).filter((key) => key.startsWith(OU_ID_OUTPUT_PREFIX));

    expect(ouIdOutputs).toHaveLength(EXPECTED_OU_COUNT);
    template.hasOutput(OU_COUNT_OUTPUT_NAME, { Value: String(EXPECTED_OU_COUNT) });
    template.hasOutput(`${OU_ID_OUTPUT_PREFIX}WorkloadsHybridNonProd`, {});
  });

  it('contains no commercial AWS partition or Region reference', () => {
    expect(templateJson).not.toContain(COMMERCIAL_ARN_PREFIX);
    expect(templateJson).not.toMatch(/\b(?:us|eu|ap|sa|ca|me|af|il|cn)-(?:gov-)?[a-z]+-\d\b/);
  });

  it('contains no reference to the retired develop model', () => {
    expect(templateJson.toLowerCase()).not.toContain('develop');
  });
});

describe('OuStructureStack guard rails', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to build a stack from an inconsistent hierarchy', () => {
    const app = new cdk.App();

    expect(
      () =>
        new OuStructureStack(app, OU_STRUCTURE_STACK_ID, {
          organizationConfig: {
            organizationalUnits: [{ key: 'orphan', name: 'Orphan', parent: 'missing-parent' }]
          } as LandingZoneConfig['organization']
        })
    ).toThrow(/missing parent/);
  });

  it('rejects an environment that has no configuration file', () => {
    const app = new cdk.App({ context: { environment: 'develop' } });
    expect(() => createLandingZoneApp(app)).toThrow(/Unsupported environment/);
  });

  it('requires an explicit target environment', () => {
    vi.stubEnv('LANDING_ZONE_ENVIRONMENT', '');
    const app = new cdk.App();
    expect(() => createLandingZoneApp(app)).toThrow(/Unsupported environment/);
  });
});
