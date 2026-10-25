import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest';
import { LambdaInputEvent } from './schema.js';
import { Context } from 'aws-lambda';
import process from 'node:process';

const sendMock = vi.hoisted(() => vi.fn().mockName('sendMock'));
const createAccountAssignmentCommandMock = vi.hoisted(() => vi.fn().mockName('createAccountAssignmentCommandMock'));

describe('scim-sync:create-account-assignment', () => {
  let cut: typeof import('./index.js');
  const event: LambdaInputEvent = {
    correlationId: 'correlation-id',
    output: {
      allAccountIds: ['123456789012', '123456789013'],
      identityStoreInfo: {
        instanceArn: 'instance-arn',
        instanceId: 'instance-id'
      },
      allGroups: [
        {
          accountId: '123456789012',
          permissionSetName: 'permissionSetName1',
          groupId: 'groupId1',
          description: 'description1'
        }
      ],
      allPermissionSets: {
        permissionSetName1: 'arn-for-permission-set'
      }
    }
  };
  const context = {} as unknown as Context;

  beforeEach(async () => {
    process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
    process.env.REGION = 'REGION';

    vi.mock('@aws-sdk/client-sso-admin', () => {
      return {
        SSOAdminClient: vi.fn().mockImplementation(() => {
          return {
            send: sendMock
          };
        }),
        CreateAccountAssignmentCommand: createAccountAssignmentCommandMock
      };
    });

    cut = await import('./index.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create account assignment', async () => {
    // Setup
    sendMock.mockResolvedValue({
      AccountAssignmentCreationStatus: {
        RequestId: 'requestId'
      }
    });

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.output.assignmentRequestId).toBe('requestId');
    expect(response.status.assignmentsDone).toBe(false);
    expect(sendMock).toHaveBeenCalledOnce();
    expect(createAccountAssignmentCommandMock).toHaveBeenCalledOnce();
    expect(createAccountAssignmentCommandMock).toHaveBeenCalledWith({
      InstanceArn: 'instance-arn',
      PermissionSetArn: 'arn-for-permission-set',
      PrincipalId: 'groupId1',
      PrincipalType: 'GROUP',
      TargetId: '123456789012',
      TargetType: 'AWS_ACCOUNT'
    });
  });

  it('should set assignmentsDone if there are no more groups to process', async () => {
    // Setup
    event.output.allGroups = [];

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.status.assignmentsDone).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('should accept the carried workflow state on a later invocation', async () => {
    sendMock.mockResolvedValue({
      AccountAssignmentCreationStatus: {
        RequestId: 'next-request-id'
      }
    });

    const carriedEvent: LambdaInputEvent = {
      ...event,
      output: {
        ...event.output,
        allGroups: [
          {
            accountId: '123456789012',
            permissionSetName: 'permissionSetName1',
            groupId: 'groupId1',
            description: 'description1'
          }
        ],
        assignmentRequestId: 'previous-request-id'
      },
      status: { assignmentsDone: false }
    };

    const response = await cut.handler(carriedEvent, context);

    expect(response.output.assignmentRequestId).toBe('next-request-id');
    expect(response.status.assignmentsDone).toBe(false);
    expect(sendMock).toHaveBeenCalledOnce();
  });

  it('should accept status.assignmentStatus carried over from get-account-assignment-status', async () => {
    // Setup: the Step Functions loop feeds a SUCCEEDED/FAILED assignment status straight back
    // into this Lambda's input once the previous assignment is no longer IN_PROGRESS.
    sendMock.mockResolvedValue({
      AccountAssignmentCreationStatus: {
        RequestId: 'next-request-id'
      }
    });

    const carriedEvent: LambdaInputEvent = {
      ...event,
      output: {
        ...event.output,
        allGroups: [
          {
            accountId: '123456789012',
            permissionSetName: 'permissionSetName1',
            groupId: 'groupId1',
            description: 'description1'
          }
        ],
        assignmentRequestId: 'previous-request-id'
      },
      status: { assignmentsDone: false, assignmentStatus: 'SUCCEEDED' }
    };

    // Execute
    const response = await cut.handler(carriedEvent, context);

    // Verify
    expect(response.output.assignmentRequestId).toBe('next-request-id');
    expect(response.status.assignmentsDone).toBe(false);
  });
});
