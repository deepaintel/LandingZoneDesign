import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import { IdentityCenterPermissionSetsStack } from '../lib/iam/identity-center-permission-sets-stack.js';

function loadConfiguration() {
  return new ConfigReader('staging', {
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();
}

function createTemplate(configuration: ReturnType<typeof loadConfiguration>): Template {
  const app = new cdk.App();
  const stack = new IdentityCenterPermissionSetsStack(app, 'IdentityCenterPermissionSetsStack', {
    instanceArn: cdk.Fn.importValue('IdentityCenterInstanceArn'),
    permissionSets: configuration.identityCenter.permissionSets
  });

  return Template.fromStack(stack);
}

describe('IdentityCenterPermissionSetsStack', () => {
  const configuration = loadConfiguration();
  const template = createTemplate(configuration);

  it('creates one permission set for every approved catalogue entry', () => {
    template.resourceCountIs('AWS::SSO::PermissionSet', 10);
    template.resourceCountIs('AWS::SSO::Assignment', 0);
  });

  it('configures every permission set with its approved session duration', () => {
    for (const definition of configuration.identityCenter.permissionSets) {
      template.hasResourceProperties('AWS::SSO::PermissionSet', {
        Name: definition.name,
        SessionDuration: definition.sessionDuration
      });
    }
  });

  it('uses the configured Identity Center instance parameter', () => {
    template.allResourcesProperties('AWS::SSO::PermissionSet', {
      InstanceArn: {
        'Fn::ImportValue': 'IdentityCenterInstanceArn'
      }
    });
  });

  it('attaches the configured partition-aware managed policies', () => {
    template.hasResourceProperties('AWS::SSO::PermissionSet', {
      Name: 'ReadOnly-PS',
      ManagedPolicies: [
        {
          'Fn::Sub': ['arn:${AWS::Partition}:iam::aws:policy/${PolicyName}', { PolicyName: 'ReadOnlyAccess' }]
        }
      ]
    });
  });

  it('creates no account assignments before SCIM-provisioned groups are available', () => {
    template.resourceCountIs('AWS::SSO::Assignment', 0);
  });

  it('does not create GitHub Actions or break-glass permission sets', () => {
    const resources = template.findResources('AWS::SSO::PermissionSet');
    const names = Object.values(resources).map((resource) => resource.Properties.Name);

    expect(names).not.toContain('github-actions-role');
    expect(names).not.toContain('BreakGlassAdmin-PS');
  });
});
