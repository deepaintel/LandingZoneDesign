import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest';
import { LambdaInputEvent } from './schema.js';
import { Context } from 'aws-lambda';
import process from 'node:process';

const sendMock = vi.hoisted(() => vi.fn().mockName('sendMock'));
const listInstancesCommandMock = vi.hoisted(() => vi.fn().mockName('listInstancesCommandMock'));

describe('scim-sync:get-identity-store-info', () => {
  let cut: typeof import('./index.js');
  const event: LambdaInputEvent = {
    correlationId: 'correlation-id',
    output: {
      allAccountIds: []
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
        ListInstancesCommand: listInstancesCommandMock
      };
    });

    cut = await import('./index.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return arn and id if sso identity store is created', async () => {
    // Setup
    sendMock.mockResolvedValue({
      Instances: [{ IdentityStoreId: 'IdentityStoreId', InstanceArn: 'InstanceArn' }],
      NextToken: undefined
    });

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response).toEqual({
      correlationId: 'correlation-id',
      output: {
        allAccountIds: [],
        identityStoreInfo: {
          instanceArn: 'InstanceArn',
          instanceId: 'IdentityStoreId'
        }
      }
    });
    expect(sendMock).toHaveBeenCalledOnce();
    expect(listInstancesCommandMock).toHaveBeenCalledOnce();
  });

  it('should stop execution and throw error if no metadata is returned', async () => {
    // Setup
    sendMock.mockResolvedValue({});

    // Execute and verify
    await expect(cut.handler(event, context)).rejects.toThrowError('No IAM Identity Center instance');
    expect(sendMock).toHaveBeenCalledOnce();
    expect(listInstancesCommandMock).toHaveBeenCalledOnce();
  });

  it('should stop execution and throw error if no id is returned', async () => {
    // Setup
    sendMock.mockResolvedValue({ Instances: [{}] });

    // Execute and verify
    await expect(cut.handler(event, context)).rejects.toThrowError('No IdentityStoreId found');
    expect(sendMock).toHaveBeenCalledOnce();
    expect(listInstancesCommandMock).toHaveBeenCalledOnce();
  });

  it('should stop execution and throw error if no arn is returned', async () => {
    // Setup
    sendMock.mockResolvedValue({ Instances: [{ IdentityStoreId: 'IdentityStoreId' }] });

    // Execute and verify
    await expect(cut.handler(event, context)).rejects.toThrowError('No IAM Identity Center InstanceArn found');
    expect(sendMock).toHaveBeenCalledOnce();
    expect(listInstancesCommandMock).toHaveBeenCalledOnce();
  });
});
