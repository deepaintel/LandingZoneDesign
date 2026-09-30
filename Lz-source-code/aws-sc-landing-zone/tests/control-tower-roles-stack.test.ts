import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { createLandingZoneApp } from '../bin/landing-zone.js';
import { ControlTowerRolesStack } from '../lib/control-tower/control-tower-roles-stack.js';

const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
const IAM_ROLE_RESOURCE_TYPE = 'AWS::IAM::Role';
const SERVICE_ROLE_PATH = '/service-role/';
const ESC_REGION = 'eusc-de-east-1';

/**
 * AWS-managed policy ARNs the two service-trusted roles must carry. Asserted by ARN rather than
 * by permission simulation because AWS Control Tower's `CreateLandingZone` preflight check
 * specifically inspects ATTACHED managed policies for these roles - an inline policy granting
 * equivalent permissions is invisible to that check and fails initialization with "does not
 * exist or have sufficient permissions... attach the managed policy <name>".
 */
const CONTROL_TOWER_SERVICE_ROLE_POLICY_ARN =
  'arn:aws-eusc:iam::aws:policy/service-role/AWSControlTowerServiceRolePolicy';
const CONTROL_TOWER_CLOUDTRAIL_ROLE_POLICY_ARN =
  'arn:aws-eusc:iam::aws:policy/service-role/AWSControlTowerCloudTrailRolePolicy';

type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

interface Synthesized {
  readonly stack: ControlTowerRolesStack;
  readonly template: Template;
}

function synthesize(environment: EnvironmentName): Synthesized {
  const app = new cdk.App({ context: { environment } });
  const { controlTowerRolesStack } = createLandingZoneApp(app);
  return { stack: controlTowerRolesStack, template: Template.fromStack(controlTowerRolesStack) };
}

describe.each(ENVIRONMENT_NAMES)('ControlTowerRolesStack (%s)', (environment) => {
  const { stack, template } = synthesize(environment);

  it('takes its stack name from bin/landing-zone.ts', () => {
    expect(stack.stackName).toBe('lz-control-tower-roles');
  });

  it('is pinned to the AWS ESC Region', () => {
    expect(stack.region).toBe(ESC_REGION);
  });

  it('synthesizes exactly three IAM roles', () => {
    template.resourceCountIs(IAM_ROLE_RESOURCE_TYPE, 3);
  });

  it('AWSControlTowerAdmin trusts controltower.amazonaws.com and carries the AWS-managed service-role policy', () => {
    template.hasResourceProperties(IAM_ROLE_RESOURCE_TYPE, {
      RoleName: 'AWSControlTowerAdmin',
      Path: SERVICE_ROLE_PATH,
      AssumeRolePolicyDocument: {
        Statement: [{ Effect: 'Allow', Principal: { Service: 'controltower.amazonaws.com' }, Action: 'sts:AssumeRole' }]
      },
      ManagedPolicyArns: [CONTROL_TOWER_SERVICE_ROLE_POLICY_ARN]
    });
  });

  it('AWSControlTowerCloudTrailRole trusts cloudtrail.amazonaws.com and attaches the AWS-managed CloudTrail policy as a MANAGED policy, not inline', () => {
    // Regression guard: an earlier implementation granted the equivalent logs:CreateLogStream /
    // logs:PutLogEvents permissions through an INLINE policy that happened to share the same
    // name as the AWS-managed policy. AWS Control Tower's CreateLandingZone preflight check
    // inspects attached MANAGED policies specifically for this role, so the inline-policy
    // version passed `cdk synth` but failed live initialization with: "AWS Control Tower cannot
    // perform this operation because the IAM role AWSControlTowerCloudTrailRole does not exist
    // or have sufficient permissions. ... attach the managed policy
    // AWSControlTowerCloudTrailRolePolicy". Asserting ManagedPolicyArns (not Policies) is the
    // whole point of this test.
    template.hasResourceProperties(IAM_ROLE_RESOURCE_TYPE, {
      RoleName: 'AWSControlTowerCloudTrailRole',
      Path: SERVICE_ROLE_PATH,
      AssumeRolePolicyDocument: {
        Statement: [{ Effect: 'Allow', Principal: { Service: 'cloudtrail.amazonaws.com' }, Action: 'sts:AssumeRole' }]
      },
      ManagedPolicyArns: [CONTROL_TOWER_CLOUDTRAIL_ROLE_POLICY_ARN]
    });

    const cloudTrailRoleResource = Object.values(
      template.toJSON().Resources as Record<string, { Properties?: unknown }>
    )
      .map((resource) => resource.Properties as { RoleName?: string; Policies?: unknown } | undefined)
      .find((properties) => properties?.RoleName === 'AWSControlTowerCloudTrailRole');

    expect(cloudTrailRoleResource?.Policies).toBeUndefined();
  });

  it('AWSControlTowerStackSetRole trusts cloudformation.amazonaws.com and grants AssumeRole on AWSControlTowerExecution in member accounts', () => {
    template.hasResourceProperties(IAM_ROLE_RESOURCE_TYPE, {
      RoleName: 'AWSControlTowerStackSetRole',
      Path: SERVICE_ROLE_PATH,
      AssumeRolePolicyDocument: {
        Statement: [
          { Effect: 'Allow', Principal: { Service: 'cloudformation.amazonaws.com' }, Action: 'sts:AssumeRole' }
        ]
      },
      Policies: [
        {
          PolicyDocument: {
            Statement: [
              {
                Effect: 'Allow',
                Action: 'sts:AssumeRole',
                Resource: 'arn:aws-eusc:iam::*:role/AWSControlTowerExecution'
              }
            ]
          }
        }
      ]
    });
  });

  it('never uses a commercial ARN prefix', () => {
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).not.toContain('arn:aws:iam::aws:policy');
  });

  it('produces no CloudFormation Export / Fn::ImportValue (stack isolation)', () => {
    const templateJson = JSON.stringify(template.toJSON());
    expect(templateJson).not.toContain('Fn::ImportValue');
  });
});
