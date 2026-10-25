import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';

import { ScimSyncStack } from '../lib/iam/scim-sync-stack.js';

const LAMBDA_RESOURCE_TYPE = 'AWS::Lambda::Function';
const IAM_POLICY_RESOURCE_TYPE = 'AWS::IAM::Policy';
const IAM_ROLE_RESOURCE_TYPE = 'AWS::IAM::Role';
const STATE_MACHINE_RESOURCE_TYPE = 'AWS::StepFunctions::StateMachine';
const RULE_RESOURCE_TYPE = 'AWS::Events::Rule';
const LAMBDA_TASK_NAMES = [
  'GetAllAccountIdsTask',
  'GetIdentityStoreInfoTask',
  'GetIdentityStoreGroupsTask',
  'GetAllPermissionSetsTask',
  'CreateAccountAssignmentTask',
  'GetAccountAssignmentStatusTask'
] as const;
const EXPECTED_LAMBDA_ACTIONS = [
  'identitystore:ListGroups',
  'organizations:ListAccountsForParent',
  'organizations:ListOrganizationalUnitsForParent',
  'sso:CreateAccountAssignment',
  'sso:DescribeAccountAssignmentCreationStatus',
  'sso:ListInstances',
  'sso:DescribePermissionSet',
  'sso:ListPermissionSets'
] as const;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function renderIntrinsic(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  const record = asRecord(value);
  if (record?.['Fn::Join'] !== undefined) {
    const join = record['Fn::Join'];
    if (!Array.isArray(join) || join.length !== 2 || typeof join[0] !== 'string' || !Array.isArray(join[1])) {
      throw new Error('Unexpected Fn::Join shape in the state machine definition.');
    }
    return join[1].map(renderIntrinsic).join(join[0]);
  }

  if (record?.['Ref'] !== undefined || record?.['Fn::GetAtt'] !== undefined) {
    return 'CloudFormationReference';
  }

  throw new Error('Unexpected intrinsic in the state machine definition.');
}

function policyStatements(policy: JsonRecord): JsonRecord[] {
  const properties = asRecord(policy['Properties']);
  const documents: JsonRecord[] = [];
  const policyDocument = asRecord(properties?.['PolicyDocument']);
  if (policyDocument !== undefined) {
    documents.push(policyDocument);
  }

  const inlinePolicies = properties?.['Policies'];
  if (Array.isArray(inlinePolicies)) {
    for (const inlinePolicy of inlinePolicies) {
      const document = asRecord(asRecord(inlinePolicy)?.['PolicyDocument']);
      if (document !== undefined) {
        documents.push(document);
      }
    }
  }

  return documents.flatMap((document) => {
    const statements = document['Statement'];
    if (statements === undefined) {
      return [];
    }
    return (Array.isArray(statements) ? statements : [statements]).flatMap((statement) => {
      const record = asRecord(statement);
      return record === undefined ? [] : [record];
    });
  });
}

function policyActions(policy: JsonRecord): string[] {
  return policyStatements(policy).flatMap((statement) => {
    const action = statement['Action'];
    return typeof action === 'string'
      ? [action]
      : Array.isArray(action)
        ? action.filter((value) => typeof value === 'string')
        : [];
  });
}

function synthesize(): Template {
  const app = new cdk.App();
  const stack = new ScimSyncStack(app, 'ScimSyncStack', {
    stackName: 'lz-scim-sync',
    environmentName: 'staging',
    env: {
      account: '118669550429',
      region: 'eusc-de-east-1'
    },
    timeBetweenActivatingScimSyncFlow: 120,
    timeBetweenCheckingForAssignmentStatus: 5
  });
  return Template.fromStack(stack);
}

describe('ScimSyncStack', () => {
  const template = synthesize();
  const templateJson = template.toJSON() as JsonRecord;
  const resources = asRecord(templateJson['Resources']) ?? {};

  it('creates the six Lambda functions, state machine, and schedule rule', () => {
    template.resourceCountIs(LAMBDA_RESOURCE_TYPE, 6);
    template.resourceCountIs(STATE_MACHINE_RESOURCE_TYPE, 1);
    template.resourceCountIs(RULE_RESOURCE_TYPE, 1);
    template.resourceCountIs(IAM_ROLE_RESOURCE_TYPE, 8);
    template.resourceCountIs(IAM_POLICY_RESOURCE_TYPE, 8);
  });

  it('configures every Lambda with the approved runtime and operational settings', () => {
    const functions = Object.entries(resources).filter(
      ([, resource]) => asRecord(resource)?.['Type'] === LAMBDA_RESOURCE_TYPE
    );

    for (const [logicalId, resource] of functions) {
      const properties = asRecord(asRecord(resource)?.['Properties']);
      expect(properties, logicalId).toMatchObject({
        Runtime: 'nodejs24.x',
        Handler: 'index.handler',
        MemorySize: 1024,
        Timeout: 60,
        TracingConfig: { Mode: 'Active' }
      });
      expect(asRecord(properties?.['Environment'])?.['Variables']).toMatchObject({
        POWERTOOLS_LOG_LEVEL: 'INFO',
        POWERTOOLS_LOGGER_BUFFERING: 'true',
        REGION: 'eusc-de-east-1',
        SCIM_ENVIRONMENT: 'staging'
      });
    }
  });

  it('keeps Lambda IAM actions scoped to the individual adapter operations', () => {
    const policies = Object.values(resources).filter((resource) => {
      const type = asRecord(resource)?.['Type'];
      return type === IAM_POLICY_RESOURCE_TYPE || type === IAM_ROLE_RESOURCE_TYPE;
    }) as JsonRecord[];
    const actions = policies.flatMap(policyActions);

    for (const action of EXPECTED_LAMBDA_ACTIONS) {
      expect(actions.filter((candidate) => candidate === action)).toHaveLength(1);
    }

    const lambdaPolicies = policies.filter((policy) =>
      EXPECTED_LAMBDA_ACTIONS.some((action) => policyActions(policy).includes(action))
    );
    expect(lambdaPolicies).toHaveLength(5);

    const organizationReadOnlyRole = Object.values(resources).find((resource) => {
      const record = asRecord(resource);
      const properties = asRecord(record?.['Properties']);
      const managedPolicies = properties?.['ManagedPolicyArns'];
      return (
        record?.['Type'] === IAM_ROLE_RESOURCE_TYPE &&
        Array.isArray(managedPolicies) &&
        managedPolicies.some((policy) => JSON.stringify(policy).includes('AWSOrganizationsReadOnlyAccess'))
      );
    });
    expect(organizationReadOnlyRole).toBeDefined();
  });

  it('limits the Step Functions role to invoking the six Lambda functions', () => {
    const policies = Object.values(resources).filter(
      (resource) => asRecord(resource)?.['Type'] === IAM_POLICY_RESOURCE_TYPE
    ) as JsonRecord[];
    const invokePolicies = policies.filter((policy) => policyActions(policy).includes('lambda:InvokeFunction'));

    expect(invokePolicies).toHaveLength(1);
    const resourcesInPolicy = policyStatements(invokePolicies[0] ?? {}).flatMap((statement) => {
      const action = statement['Action'];
      const invokesLambda =
        action === 'lambda:InvokeFunction' || (Array.isArray(action) && action.includes('lambda:InvokeFunction'));
      if (!invokesLambda) {
        return [];
      }
      const resource = statement['Resource'];
      return Array.isArray(resource) ? resource : resource === undefined ? [] : [resource];
    });
    expect(resourcesInPolicy).toHaveLength(12);
  });

  it('limits the EventBridge role to starting the SCIM state machine', () => {
    const policies = Object.values(resources).filter(
      (resource) => asRecord(resource)?.['Type'] === IAM_POLICY_RESOURCE_TYPE
    ) as JsonRecord[];
    const startExecutionPolicies = policies.filter((policy) => policyActions(policy).includes('states:StartExecution'));

    expect(startExecutionPolicies).toHaveLength(1);
    const properties = asRecord(asRecord(startExecutionPolicies[0]?.['Properties']));
    const document = asRecord(properties?.['PolicyDocument']);
    const statement = Array.isArray(document?.['Statement']) ? asRecord(document.Statement[0]) : undefined;
    expect(statement?.['Resource']).toEqual({ Ref: expect.stringMatching(/^ScimProvisioning/) });
  });

  it('wires the state machine through the assignment loop and configured wait interval', () => {
    const stateMachine = Object.values(resources).find(
      (resource) => asRecord(resource)?.['Type'] === STATE_MACHINE_RESOURCE_TYPE
    );
    const properties = asRecord(asRecord(stateMachine)?.['Properties']);
    const definition = JSON.parse(renderIntrinsic(properties?.['DefinitionString'])) as JsonRecord;
    const states = asRecord(definition['States']);

    expect(definition['StartAt']).toBe('GetAllAccountIdsTask');
    expect(states).toBeDefined();

    for (const [index, taskName] of LAMBDA_TASK_NAMES.entries()) {
      const state = asRecord(states?.[taskName]);
      expect(state?.['Type'], taskName).toBe('Task');
      if (index < LAMBDA_TASK_NAMES.length - 2) {
        expect(state?.['Next'], taskName).toBe(LAMBDA_TASK_NAMES[index + 1]);
      }
      expect(state?.['OutputPath'], taskName).toBe('$.Payload');
    }

    expect(asRecord(states?.['CreateAccountAssignmentTask'])?.['Next']).toBe('IsAssignmentsDone?');
    expect(asRecord(states?.['GetAccountAssignmentStatusTask'])?.['Next']).toBe('IsAssignmentInProgress?');

    expect(asRecord(states?.['IsAssignmentsDone?'])).toMatchObject({
      Type: 'Choice',
      Default: 'ScimSyncEndState'
    });
    expect(asRecord(states?.['IsAssignmentInProgress?'])).toMatchObject({
      Type: 'Choice',
      Default: 'CreateAccountAssignmentTask'
    });
    expect(asRecord(states?.['Wait'])).toMatchObject({
      Type: 'Wait',
      Seconds: 5,
      Next: 'GetAccountAssignmentStatusTask'
    });
    expect(asRecord(states?.['ScimSyncEndState'])).toMatchObject({ Type: 'Pass', End: true });
  });

  it('schedules the state machine every two minutes with an event correlation id', () => {
    template.hasResourceProperties(RULE_RESOURCE_TYPE, {
      Name: 'scim-provisioning-schedule-rule',
      ScheduleExpression: 'rate(2 minutes)',
      State: 'ENABLED',
      Targets: [
        {
          Id: 'Target0',
          InputTransformer: {
            InputPathsMap: { id: '$.id' },
            InputTemplate: '{"correlationId":<id>}'
          }
        }
      ]
    });
  });

  it('rejects non-positive timing values', () => {
    const app = new cdk.App();
    expect(
      () =>
        new ScimSyncStack(app, 'InvalidScimSyncStack', {
          environmentName: 'staging',
          timeBetweenActivatingScimSyncFlow: 0,
          timeBetweenCheckingForAssignmentStatus: 5
        })
    ).toThrow('SCIM sync timing values must be greater than zero');
  });
});
