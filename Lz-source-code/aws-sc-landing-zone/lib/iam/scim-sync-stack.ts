import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as nodejsLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { createCommonLambdaProps } from '../lambda/common-lambda-props.js';
import path from 'node:path';
import { __srcDirname } from '../../scripts/esm-extensions.js';

const ASSIGNMENT_IN_PROGRESS = 'IN_PROGRESS';

export interface ScimSyncProps extends cdk.StackProps {
  environmentName: 'staging' | 'production';
  timeBetweenActivatingScimSyncFlow: number;
  timeBetweenCheckingForAssignmentStatus: number;
}

export class ScimSyncStack extends cdk.Stack {
  public readonly getAllAccountIdsFunction: nodejsLambda.NodejsFunction;
  public readonly getIdentityStoreInfoFunction: nodejsLambda.NodejsFunction;
  public readonly getIdentityStoreGroupsFunction: nodejsLambda.NodejsFunction;
  public readonly getAllPermissionSetsFunction: nodejsLambda.NodejsFunction;
  public readonly createAccountAssignmentFunction: nodejsLambda.NodejsFunction;
  public readonly getAccountAssignmentStatusFunction: nodejsLambda.NodejsFunction;
  public readonly stateMachine: stepfunctions.StateMachine;
  public readonly scheduleRule: events.Rule;

  constructor(scope: Construct, id: string, props: ScimSyncProps) {
    super(scope, id, props);

    if (props.timeBetweenActivatingScimSyncFlow <= 0 || props.timeBetweenCheckingForAssignmentStatus <= 0) {
      throw new Error('SCIM sync timing values must be greater than zero');
    }

    const createScimLambda = (
      functionId: string,
      serviceName: string,
      entry: string,
      description: string,
      role: iam.Role
    ): nodejsLambda.NodejsFunction =>
      new nodejsLambda.NodejsFunction(this, functionId, {
        ...createCommonLambdaProps({
          entry,
          description,
          role,
          environment: {
            REGION: cdk.Stack.of(this).region,
            POWERTOOLS_SERVICE_NAME: serviceName,
            SCIM_ENVIRONMENT: props.environmentName
          }
        })
      });

    //#region Get All Account Ids
    const getAllAccountIdsRole = new iam.Role(this, 'GetAllAccountIdsRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for the GetAllAccountIds lambda',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSOrganizationsReadOnlyAccess')
      ]
    });

    this.getAllAccountIdsFunction = createScimLambda(
      'GetAllAccountIds',
      'scim-sync:get-all-account-ids',
      path.join(__srcDirname, './functions/scim-sync/get-all-account-ids/index.ts'),
      'Retrieves all account IDs in the organization',
      getAllAccountIdsRole
    );

    const getAllAccountIdsTask = new tasks.LambdaInvoke(this, 'GetAllAccountIdsTask', {
      lambdaFunction: this.getAllAccountIdsFunction,
      outputPath: '$.Payload'
    });
    //#endregion

    //#region Get Identity Store Info
    const getIdentityStoreInfoRole = new iam.Role(this, 'GetIdentityStoreInfoRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for the GetIdentityStoreInfo lambda',
      inlinePolicies: {
        GetIdentityStoreInfoPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sso:ListInstances'],
              resources: ['*']
            })
          ]
        })
      },
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    });

    this.getIdentityStoreInfoFunction = createScimLambda(
      'GetIdentityStoreInfo',
      'scim-sync:get-identity-store-info',
      path.join(__srcDirname, './functions/scim-sync/get-identity-store-info/index.ts'),
      'Retrieves the Identity Store ARN and ID',
      getIdentityStoreInfoRole
    );

    const getIdentityStoreInfoTask = new tasks.LambdaInvoke(this, 'GetIdentityStoreInfoTask', {
      lambdaFunction: this.getIdentityStoreInfoFunction,
      outputPath: '$.Payload'
    });
    //#endregion

    //#region Get Identity Store Groups
    const getIdentityStoreGroupsRole = new iam.Role(this, 'GetIdentityStoreGroupsRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for the GetIdentityStoreGroups lambda',
      inlinePolicies: {
        GetIdentityStoreGroupsPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'identitystore:ListGroups',
                'organizations:ListAccountsForParent',
                'organizations:ListOrganizationalUnitsForParent'
              ],
              resources: ['*']
            })
          ]
        })
      },
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    });

    this.getIdentityStoreGroupsFunction = createScimLambda(
      'GetIdentityStoreGroups',
      'scim-sync:get-all-identity-store-groups',
      path.join(__srcDirname, './functions/scim-sync/get-all-identity-store-groups/index.ts'),
      'Retrieves Identity Store groups',
      getIdentityStoreGroupsRole
    );

    const getIdentityStoreGroupsTask = new tasks.LambdaInvoke(this, 'GetIdentityStoreGroupsTask', {
      lambdaFunction: this.getIdentityStoreGroupsFunction,
      outputPath: '$.Payload'
    });
    //#endregion

    //#region Get all permission sets
    const getAllPermissionSetsRole = new iam.Role(this, 'GetAllPermissionSetsRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for the GetAllPermissionSets lambda',
      inlinePolicies: {
        GetAllPermissionSetsPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sso:ListPermissionSets', 'sso:DescribePermissionSet'],
              resources: ['*']
            })
          ]
        })
      },
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    });

    this.getAllPermissionSetsFunction = createScimLambda(
      'GetAllPermissionSets',
      'scim-sync:get-all-permission-sets',
      path.join(__srcDirname, './functions/scim-sync/get-permission-sets/index.ts'),
      'Retrieves all Permission Sets',
      getAllPermissionSetsRole
    );

    const getAllPermissionSetsTask = new tasks.LambdaInvoke(this, 'GetAllPermissionSetsTask', {
      lambdaFunction: this.getAllPermissionSetsFunction,
      outputPath: '$.Payload'
    });
    //#endregion

    //#region Create account assignment
    const createAccountAssignmentRole = new iam.Role(this, 'CreateAccountAssignmentRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for the CreateAccountAssignment lambda',
      inlinePolicies: {
        CreateAccountAssignmentPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sso:CreateAccountAssignment'],
              resources: ['*']
            }),
            // Required when an assignment targets the management account itself: IAM Identity
            // Center provisions the AWSReservedSSO_* role directly (no member-account StackSet),
            // so the caller - not just the SSO service-linked role - needs these IAM permissions.
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'iam:AttachRolePolicy',
                'iam:CreateRole',
                'iam:CreateSAMLProvider',
                'iam:DeleteRole',
                'iam:DeleteRolePolicy',
                'iam:DetachRolePolicy',
                'iam:GetRole',
                'iam:GetSAMLProvider',
                'iam:ListAttachedRolePolicies',
                'iam:ListRolePolicies',
                'iam:PutRolePolicy',
                'iam:UpdateRoleDescription',
                'iam:UpdateSAMLProvider'
              ],
              resources: [
                `arn:${cdk.Aws.PARTITION}:iam::*:role/aws-reserved/sso.amazonaws.com/*`,
                `arn:${cdk.Aws.PARTITION}:iam::*:saml-provider/AWSSSO_*`
              ]
            })
          ]
        })
      },
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    });

    this.createAccountAssignmentFunction = createScimLambda(
      'CreateAccountAssignment',
      'scim-sync:create-account-assignment',
      path.join(__srcDirname, './functions/scim-sync/create-account-assignment/index.ts'),
      'Creates an account assignment',
      createAccountAssignmentRole
    );

    const createAccountAssignmentTask = new tasks.LambdaInvoke(this, 'CreateAccountAssignmentTask', {
      lambdaFunction: this.createAccountAssignmentFunction,
      outputPath: '$.Payload'
    });
    // IAM Identity Center returns ConflictException when another assignment operation for the
    // same principal/target/permission-set is still in progress; the AWS SDK does not retry this
    // because it is not a throttling/transient error, so retry it here with jittered backoff.
    createAccountAssignmentTask.addRetry({
      errors: ['ConflictException'],
      interval: cdk.Duration.seconds(5),
      maxAttempts: 6,
      backoffRate: 2,
      jitterStrategy: stepfunctions.JitterType.FULL
    });
    //#endregion

    //#region Get account assignment status
    const getAccountAssignmentStatusRole = new iam.Role(this, 'GetAccountAssignmentStatusRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for the GetAccountAssignmentStatus lambda',
      inlinePolicies: {
        GetAccountAssignmentStatusPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['sso:DescribeAccountAssignmentCreationStatus'],
              resources: ['*']
            })
          ]
        })
      },
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    });

    this.getAccountAssignmentStatusFunction = createScimLambda(
      'GetAccountAssignmentStatus',
      'scim-sync:get-account-assignment-status',
      path.join(__srcDirname, './functions/scim-sync/get-account-assignment-status/index.ts'),
      'Gets the account assignment status',
      getAccountAssignmentStatusRole
    );

    const getAccountAssignmentStatusTask = new tasks.LambdaInvoke(this, 'GetAccountAssignmentStatusTask', {
      lambdaFunction: this.getAccountAssignmentStatusFunction,
      outputPath: '$.Payload'
    });
    //#endregion

    const end = new stepfunctions.Pass(this, 'ScimSyncEndState');
    const waitStep = new stepfunctions.Wait(this, 'Wait', {
      time: stepfunctions.WaitTime.duration(cdk.Duration.seconds(props.timeBetweenCheckingForAssignmentStatus))
    });

    // prettier-ignore
    const chain = stepfunctions.Chain.start(
      getAllAccountIdsTask
      .next(getIdentityStoreInfoTask)
      .next(getIdentityStoreGroupsTask)
      .next(getAllPermissionSetsTask)
      .next(createAccountAssignmentTask) // loop 1
      .next(new stepfunctions.Choice(this, 'IsAssignmentsDone?')
      .when(
        stepfunctions.Condition.booleanEquals('$.status.assignmentsDone', false),
          getAccountAssignmentStatusTask // loop 2
          .next(new stepfunctions.Choice(this, 'IsAssignmentInProgress?')
          .when(stepfunctions.Condition.stringEquals('$.status.assignmentStatus', ASSIGNMENT_IN_PROGRESS),
            waitStep
            .next(getAccountAssignmentStatusTask) // loop 2
        ).otherwise(createAccountAssignmentTask)) // loop 1
      ).otherwise(end))
    );

    const stateMachineRole = new iam.Role(this, 'ScimProvisioningStepFunctionRole', {
      description: 'Role for the SCIM provisioning state machine',
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        InvokeScimLambdas: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [
                this.getAllAccountIdsFunction.functionArn,
                this.getIdentityStoreInfoFunction.functionArn,
                this.getIdentityStoreGroupsFunction.functionArn,
                this.getAllPermissionSetsFunction.functionArn,
                this.createAccountAssignmentFunction.functionArn,
                this.getAccountAssignmentStatusFunction.functionArn
              ]
            })
          ]
        })
      }
    });

    this.stateMachine = new stepfunctions.StateMachine(this, 'ScimProvisioning', {
      definitionBody: stepfunctions.DefinitionBody.fromChainable(chain),
      tracingEnabled: true,
      role: stateMachineRole
    });

    this.scheduleRule = new events.Rule(this, 'Rule', {
      schedule: events.Schedule.rate(cdk.Duration.seconds(props.timeBetweenActivatingScimSyncFlow)),
      ruleName: 'scim-provisioning-schedule-rule',
      targets: [
        new targets.SfnStateMachine(this.stateMachine, {
          input: events.RuleTargetInput.fromObject({
            correlationId: events.EventField.eventId
          })
        })
      ],
      description: `Scheduled event to run the SCIM provisioning state machine every ${props.timeBetweenActivatingScimSyncFlow} seconds`
    });
  }
}
