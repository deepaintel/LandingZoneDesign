/**
 * Control Tower prerequisite roles stack.
 *
 * Creates the three management-account IAM roles that AWS Control Tower Landing Zone 4.0 requires
 * to exist BEFORE `CreateLandingZone` is invoked through the API. The Console-based flow auto-
 * creates them; the API-based flow this repository uses does not.
 *
 * Governed by `.apm/instructions/control-tower-initialization.instructions.md` §11.1
 * ("Management-Account API-Setup Prerequisite Roles"). This is an APPROVED EXCEPTION to the
 * general "do not pre-create Control Tower roles" rule, which continues to apply to
 * MEMBER-account roles such as `AWSControlTowerExecution` (created by Control Tower itself
 * during `CreateLandingZone`).
 *
 * The three roles created here:
 *
 *  - `AWSControlTowerAdmin` — trusted by `controltower.amazonaws.com`; carries the AWS-managed
 *    policy `AWSControlTowerServiceRolePolicy` and an inline statement granting
 *    `ec2:DescribeAvailabilityZones`. Control Tower assumes this role during Landing Zone
 *    initialization; a missing role is what produces the
 *    "could not assume the AWSControlTowerAdmin role" ValidationException.
 *
 *  - `AWSControlTowerCloudTrailRole` — trusted by `cloudtrail.amazonaws.com`; carries the
 *    AWS-managed policy `AWSControlTowerCloudTrailRolePolicy`, which grants CloudWatch Logs
 *    write on the Control Tower CloudTrail log group. Control Tower's `CreateLandingZone`
 *    preflight check inspects ATTACHED managed policies specifically (not inline policies) for
 *    this role; an inline policy granting equivalent permissions is invisible to that check and
 *    produces "does not exist or have sufficient permissions... attach the managed policy
 *    AWSControlTowerCloudTrailRolePolicy".
 *
 *  - `AWSControlTowerStackSetRole` — trusted by `cloudformation.amazonaws.com`; grants
 *    `sts:AssumeRole` on `AWSControlTowerExecution` in member accounts so Control Tower's
 *    StackSet operations can deploy the member-account baseline.
 *
 * All three role names are FIXED by AWS — Control Tower looks them up by exact name and rejects
 * any other name. `CfnRole` (L1) is used so CDK does not synthesize a name suffix.
 *
 * Reference: AWS Control Tower User Guide — "Set up AWS Control Tower using the API"
 * (https://docs.aws.amazon.com/controltower/latest/userguide/setting-up-lz-api.html).
 *
 * Stack isolation: this stack does not reference any construct in another stack and produces no
 * CloudFormation `Export`/`Fn::ImportValue`. It deploys into the management account/region and
 * runs BEFORE the OU, policy, and shared-accounts stacks so its outputs are available at the
 * point Control Tower initialization runs.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

const CONTROL_TOWER_SERVICE_PRINCIPAL = 'controltower.amazonaws.com';
const CLOUDTRAIL_SERVICE_PRINCIPAL = 'cloudtrail.amazonaws.com';
const CLOUDFORMATION_SERVICE_PRINCIPAL = 'cloudformation.amazonaws.com';

const CONTROL_TOWER_ADMIN_ROLE_NAME = 'AWSControlTowerAdmin';
const CONTROL_TOWER_CLOUDTRAIL_ROLE_NAME = 'AWSControlTowerCloudTrailRole';
const CONTROL_TOWER_STACKSET_ROLE_NAME = 'AWSControlTowerStackSetRole';
const CONTROL_TOWER_EXECUTION_ROLE_NAME = 'AWSControlTowerExecution';

const SERVICE_ROLE_PATH = '/service-role/';

/**
 * AWS-managed policy ARNs attached to the Control Tower prerequisite roles. Verified available
 * in `aws-eusc` at these exact ARNs per the environment audit that preceded this change; the
 * partition-qualified form is used explicitly rather than deriving it from
 * `Stack.of(this).partition` so a misconfigured partition context cannot silently substitute a
 * commercial ARN.
 */
const CONTROL_TOWER_SERVICE_ROLE_POLICY_ARN =
  'arn:aws-eusc:iam::aws:policy/service-role/AWSControlTowerServiceRolePolicy';
const CONTROL_TOWER_CLOUDTRAIL_ROLE_POLICY_ARN =
  'arn:aws-eusc:iam::aws:policy/service-role/AWSControlTowerCloudTrailRolePolicy';

export class ControlTowerRolesStack extends cdk.Stack {
  public readonly adminRole: cdk.aws_iam.CfnRole;
  public readonly cloudTrailRole: cdk.aws_iam.CfnRole;
  public readonly stackSetRole: cdk.aws_iam.CfnRole;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.adminRole = new cdk.aws_iam.CfnRole(this, 'AWSControlTowerAdminRole', {
      roleName: CONTROL_TOWER_ADMIN_ROLE_NAME,
      path: SERVICE_ROLE_PATH,
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: CONTROL_TOWER_SERVICE_PRINCIPAL },
            Action: 'sts:AssumeRole'
          }
        ]
      },
      managedPolicyArns: [CONTROL_TOWER_SERVICE_ROLE_POLICY_ARN],
      policies: [
        {
          policyName: 'AWSControlTowerAdminPolicy',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'ec2:DescribeAvailabilityZones',
                Resource: '*'
              }
            ]
          }
        }
      ]
    });
    this.adminRole.overrideLogicalId('AWSControlTowerAdminRole');

    this.cloudTrailRole = new cdk.aws_iam.CfnRole(this, 'AWSControlTowerCloudTrailRole', {
      roleName: CONTROL_TOWER_CLOUDTRAIL_ROLE_NAME,
      path: SERVICE_ROLE_PATH,
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: CLOUDTRAIL_SERVICE_PRINCIPAL },
            Action: 'sts:AssumeRole'
          }
        ]
      },
      managedPolicyArns: [CONTROL_TOWER_CLOUDTRAIL_ROLE_POLICY_ARN]
    });
    this.cloudTrailRole.overrideLogicalId('AWSControlTowerCloudTrailRole');

    this.stackSetRole = new cdk.aws_iam.CfnRole(this, 'AWSControlTowerStackSetRole', {
      roleName: CONTROL_TOWER_STACKSET_ROLE_NAME,
      path: SERVICE_ROLE_PATH,
      assumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Service: CLOUDFORMATION_SERVICE_PRINCIPAL },
            Action: 'sts:AssumeRole'
          }
        ]
      },
      policies: [
        {
          policyName: 'AWSControlTowerStackSetRolePolicy',
          policyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'sts:AssumeRole',
                Resource: `arn:aws-eusc:iam::*:role/${CONTROL_TOWER_EXECUTION_ROLE_NAME}`
              }
            ]
          }
        }
      ]
    });
    this.stackSetRole.overrideLogicalId('AWSControlTowerStackSetRole');

    new cdk.CfnOutput(this, 'ControlTowerAdminRoleArn', {
      value: this.adminRole.attrArn,
      description: 'ARN of the AWSControlTowerAdmin role required by CreateLandingZone.'
    });
    new cdk.CfnOutput(this, 'ControlTowerCloudTrailRoleArn', {
      value: this.cloudTrailRole.attrArn,
      description: 'ARN of the AWSControlTowerCloudTrailRole required by CreateLandingZone.'
    });
    new cdk.CfnOutput(this, 'ControlTowerStackSetRoleArn', {
      value: this.stackSetRole.attrArn,
      description: 'ARN of the AWSControlTowerStackSetRole required by CreateLandingZone.'
    });
  }
}
