import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest';
import { LambdaInputEvent } from './schema.js';
import { Context } from 'aws-lambda';
import process from 'node:process';

const sendMock = vi.hoisted(() => vi.fn().mockName('sendMock'));
const paginateListPermissionSetsMock = vi.hoisted(() => vi.fn().mockName('paginateListPermissionSetsMock'));
const describePermissionSetCommandMock = vi.hoisted(() => vi.fn().mockName('describePermissionSetCommandMock'));

describe('scim-sync:get-permission-sets', () => {
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
      ]
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
        paginateListPermissionSets: paginateListPermissionSetsMock,
        DescribePermissionSetCommand: describePermissionSetCommandMock
      };
    });

    cut = await import('./index.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolve output in normal flow', async () => {
    // Setup
    sendMock
      .mockResolvedValueOnce({
        PermissionSet: {
          CreatedDate: new Date('2023-01-03T15:56:18.000Z'),
          Description: 'Description1',
          Name: 'Name1',
          PermissionSetArn: 'permissionSetArn1',
          RelayState: undefined,
          SessionDuration: 'PT1H'
        }
      })
      .mockResolvedValueOnce({
        PermissionSet: {
          CreatedDate: new Date('2023-01-03T15:56:18.000Z'),
          Description: 'Description2',
          Name: 'Name2',
          PermissionSetArn: 'permissionSetArn2',
          RelayState: undefined,
          SessionDuration: 'PT1H'
        }
      });
    paginateListPermissionSetsMock.mockImplementation(async function* () {
      yield {
        PermissionSets: ['arn1', 'arn2'],
        NextToken: undefined
      };
    });

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.output.allPermissionSets).toEqual({
      Name1: 'permissionSetArn1',
      Name2: 'permissionSetArn2'
    });
    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(paginateListPermissionSetsMock).toHaveBeenCalledOnce();
  });
});
