import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest';
import { LambdaInputEvent } from './schema.js';
import { Context } from 'aws-lambda';
import process from 'node:process';

const sendMock = vi.hoisted(() => vi.fn().mockName('sendMock'));
const describeAccountAssignmentCreationStatusCommandMock = vi.hoisted(() =>
  vi.fn().mockName('describeAccountAssignmentCreationStatusCommandMock')
);

describe('scim-sync:get-account-assignment-status', () => {
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
      },
      assignmentRequestId: 'request-id'
    },
    status: {
      assignmentsDone: false
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
        StatusValues: {
          FAILED: 'FAILED',
          IN_PROGRESS: 'IN_PROGRESS',
          SUCCEEDED: 'SUCCEEDED'
        },
        DescribeAccountAssignmentCreationStatusCommand: describeAccountAssignmentCreationStatusCommandMock
      };
    });

    cut = await import('./index.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should set assignmentStatus', async () => {
    // Setup
    sendMock.mockResolvedValue({
      AccountAssignmentCreationStatus: {
        Status: 'SUCCEEDED'
      }
    });

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.status.assignmentStatus).toBe('SUCCEEDED');
    expect(describeAccountAssignmentCreationStatusCommandMock).toHaveBeenCalledOnce();
    expect(describeAccountAssignmentCreationStatusCommandMock).toHaveBeenCalledWith({
      AccountAssignmentCreationRequestId: 'request-id',
      InstanceArn: 'instance-arn'
    });
  });

  it('should fail if no assignment status is returned', async () => {
    // Setup
    sendMock.mockResolvedValue({
      AccountAssignmentCreationStatus: undefined
    });

    // Execute
    await expect(cut.handler(event, context)).rejects.toThrow();
    expect(describeAccountAssignmentCreationStatusCommandMock).toHaveBeenCalledOnce();
    expect(describeAccountAssignmentCreationStatusCommandMock).toHaveBeenCalledWith({
      AccountAssignmentCreationRequestId: 'request-id',
      InstanceArn: 'instance-arn'
    });
  });

  it('should set assignmentStatus to IN_PROGRESS if it is not done', async () => {
    // Setup
    sendMock.mockResolvedValue({
      AccountAssignmentCreationStatus: {
        Status: 'IN_PROGRESS'
      }
    });

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.status.assignmentStatus).toBe('IN_PROGRESS');
    expect(describeAccountAssignmentCreationStatusCommandMock).toHaveBeenCalledOnce();
    expect(describeAccountAssignmentCreationStatusCommandMock).toHaveBeenCalledWith({
      AccountAssignmentCreationRequestId: 'request-id',
      InstanceArn: 'instance-arn'
    });
  });

  it('should return error if assignment status is failed', async () => {
    // Setup
    sendMock.mockResolvedValue({
      AccountAssignmentCreationStatus: {
        Status: 'FAILED',
        FailureReason: 'PermissionSet not provisioned'
      }
    });

    // Execute and verify
    await expect(cut.handler(event, context)).rejects.toThrowError(
      'Account assignment creation failed: PermissionSet not provisioned'
    );
  });
});
