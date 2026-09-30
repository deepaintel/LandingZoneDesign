import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as nodejsLambda from 'aws-cdk-lib/aws-lambda-nodejs';
import { createCommonLambdaProps } from '../lambda/common-lambda-props.js';
import path from 'node:path';
import { __srcDirname } from '../../scripts/esm-extensions.js';

export interface ScimCleanupProps extends cdk.StackProps {
  timeBetweenActivatingScimCleanupFlow: number;
}

export class ScimCleanupStack extends cdk.Stack {
  public readonly getIdentityStoreInstanceIdFunction: nodejsLambda.NodejsFunction;
  public readonly getAllUserIdsFunction: nodejsLambda.NodejsFunction;
  public readonly isUserEnabledFunction: nodejsLambda.NodejsFunction;
  public readonly deleteUserFunction: nodejsLambda.NodejsFunction;

  constructor(scope: Construct, id: string, props: ScimCleanupProps) {
    super(scope, id, props);

    if (props.timeBetweenActivatingScimCleanupFlow <= 0) {
      throw new Error('SCIM cleanup timing value must be greater than zero');
    }

    const createScimCleanupLambda = (
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
            POWERTOOLS_SERVICE_NAME: serviceName
          }
        })
      });

    //#region Get identity store instance ID lambda
    const getIdentityStoreIdRole = new iam.Role(this, 'GetIdentityStoreIdRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for the GetIdentityStoreInstanceId lambda',
      inlinePolicies: {
        CustomPolicy: new iam.PolicyDocument({
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

    this.getIdentityStoreInstanceIdFunction = createScimCleanupLambda(
      'GetIdentityStoreInstanceId',
      'scim-cleanup:get-identity-store-id',
      path.join(__srcDirname, './functions/scim-cleanup/get-identity-store-id/index.ts'),
      'Retrieves the identity store instance id for the account',
      getIdentityStoreIdRole
    );

    const getIdentityStoreIdTask = new tasks.LambdaInvoke(this, 'GetIdentityStoreIdTask', {
      lambdaFunction: this.getIdentityStoreInstanceIdFunction,
      outputPath: '$.Payload'
    });
    //#endregion

    //#region Get all user ids lambda
    const getAllUserIdsRole = new iam.Role(this, 'GetAllUserIdsRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for the GetAllUserIds lambda',
      inlinePolicies: {
        CustomPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['identitystore:ListUsers'],
              resources: ['*']
            })
          ]
        })
      },
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    });

    this.getAllUserIdsFunction = createScimCleanupLambda(
      'GetAllUserIds',
      'scim-cleanup:get-all-user-ids',
      path.join(__srcDirname, './functions/scim-cleanup/get-all-user-ids/index.ts'),
      'Retrieves all user ids in the identity store',
      getAllUserIdsRole
    );

    const getAllUserIdsTask = new tasks.LambdaInvoke(this, 'GetAllUserIdsTask', {
      lambdaFunction: this.getAllUserIdsFunction,
      outputPath: '$.Payload'
    });
    //#endregion

    //#region Is user enabled lambda
    const isUserEnabledRole = new iam.Role(this, 'IsUserEnabledRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for the IsUserEnabled lambda',
      inlinePolicies: {
        CustomPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['identitystore:ListGroupMembershipsForMember'],
              resources: ['*']
            })
          ]
        })
      },
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    });

    this.isUserEnabledFunction = createScimCleanupLambda(
      'IsUserEnabled',
      'scim-cleanup:is-user-enabled',
      path.join(__srcDirname, './functions/scim-cleanup/is-user-enabled/index.ts'),
      'Checks if a user is enabled in the identity store',
      isUserEnabledRole
    );

    const isUserEnabledTask = new tasks.LambdaInvoke(this, 'IsUserEnabledTask', {
      lambdaFunction: this.isUserEnabledFunction,
      outputPath: '$.Payload'
    });
    //#endregion

    //#region Delete user lambda
    const deleteUserRole = new iam.Role(this, 'DeleteUserRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for the DeleteUser lambda',
      inlinePolicies: {
        CustomPolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['identitystore:DeleteUser'],
              resources: ['*']
            })
          ]
        })
      },
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
    });

    this.deleteUserFunction = createScimCleanupLambda(
      'DeleteUser',
      'scim-cleanup:delete-user',
      path.join(__srcDirname, './functions/scim-cleanup/delete-user/index.ts'),
      'Deletes a user from the identity store',
      deleteUserRole
    );

    const deleteUserTask = new tasks.LambdaInvoke(this, 'DeleteUserTask', {
      lambdaFunction: this.deleteUserFunction,
      outputPath: '$.Payload'
    });
    //#endregion

    const choiceDeleteUser = new stepfunctions.Choice(this, 'ShouldUserBeDeleted');
    const end = new stepfunctions.Pass(this, 'ScimCleanupEndState');
    const skipUserDeletion = new stepfunctions.Pass(this, 'SkipUserDeletion');

    // prettier-ignore
    const chain = stepfunctions.Chain.start(
      getIdentityStoreIdTask
      .next(getAllUserIdsTask)
      .next(new stepfunctions.Map(this, 'FilterEnabledUsersMap', {
        maxConcurrency: 1,
        itemsPath: stepfunctions.JsonPath.stringAt('$.output.userIds'),
      })
        .iterator(
          isUserEnabledTask
          .next(
            choiceDeleteUser.when(
              stepfunctions.Condition.booleanEquals('$.output.enabled', false), deleteUserTask
            )
            .otherwise(skipUserDeletion)
          )
        )
        .next(end)
      )
    );

    const stateMachineRole = new iam.Role(this, 'ScimCleanupStepFunctionRole', {
      description: 'Role for the SCIM cleanup step function',
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        InvokeScimLambdas: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [
                this.getIdentityStoreInstanceIdFunction.functionArn,
                this.getAllUserIdsFunction.functionArn,
                this.isUserEnabledFunction.functionArn,
                this.deleteUserFunction.functionArn
              ]
            })
          ]
        })
      }
    });

    const stateMachine = new stepfunctions.StateMachine(this, 'ScimCleanup', {
      definitionBody: stepfunctions.DefinitionBody.fromChainable(chain),
      tracingEnabled: true,
      role: stateMachineRole
    });

    new events.Rule(this, 'Rule', {
      schedule: events.Schedule.rate(cdk.Duration.seconds(props.timeBetweenActivatingScimCleanupFlow)),
      ruleName: 'scim-cleanup-schedule-rule',
      targets: [
        new targets.SfnStateMachine(stateMachine, {
          input: events.RuleTargetInput.fromObject({
            correlationId: events.EventField.eventId
          })
        })
      ],
      description: 'Scheduled event to run SCIM cleanup, this will remove disabled users from the identity store'
    });
  }
}
