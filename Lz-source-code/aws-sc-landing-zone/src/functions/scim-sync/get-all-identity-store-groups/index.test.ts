import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest';
import { LambdaInputEvent } from './schema.js';
import { Context } from 'aws-lambda';
import process from 'node:process';

const paginateListGroupsMock = vi.hoisted(() => vi.fn().mockName('paginateListGroupsMock'));
const createOrganizationsClientMock = vi.hoisted(() => vi.fn().mockName('createOrganizationsClientMock'));
const getAccountsForParentMock = vi.hoisted(() => vi.fn().mockName('getAccountsForParentMock'));
const getOusForParentMock = vi.hoisted(() => vi.fn().mockName('getOusForParentMock'));

describe('scim-sync:get-all-identity-store-groups', () => {
  let cut: typeof import('./index.js');
  const event: LambdaInputEvent = {
    correlationId: 'correlation-id',
    output: {
      allAccountIds: ['123456789012', '123456789013'],
      identityStoreInfo: {
        instanceArn: 'instance-arn',
        instanceId: 'instance-id'
      }
    }
  };
  const context = {} as unknown as Context;

  beforeEach(async () => {
    process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
    process.env.REGION = 'REGION';
    process.env.SCIM_ENVIRONMENT = 'staging';
    vi.mock('@aws-sdk/client-identitystore', () => ({
      IdentitystoreClient: vi.fn(),
      paginateListGroups: paginateListGroupsMock
    }));
    vi.mock('../../helpers/organization-helper.js', () => ({
      createOrganizationsClient: createOrganizationsClientMock.mockReturnValue({}),
      getAccountsForParent: getAccountsForParentMock,
      getOusForParent: getOusForParentMock
    }));
    getAccountsForParentMock.mockResolvedValue([]);
    getOusForParentMock.mockResolvedValue([]);
    cut = await import('./index.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps a direct account group to a permission set and description', async () => {
    paginateListGroupsMock.mockImplementation(async function* () {
      yield {
        Groups: [
          {
            Description: 'Platform access',
            DisplayName: 'GA AISARCH Staging#123456789012#PlatformEngineer-PS Platform access',
            GroupId: 'GroupId',
            IdentityStoreId: 'IdentityStoreId'
          }
        ]
      };
    });

    const response = await cut.handler(event, context);

    expect(response.output.allGroups).toEqual([
      {
        accountId: '123456789012',
        permissionSetName: 'PlatformEngineer-PS',
        groupId: 'GroupId',
        description: 'Platform access'
      }
    ]);
  });

  it('expands an OU and its child OUs to active account ids', async () => {
    paginateListGroupsMock.mockImplementation(async function* () {
      yield {
        Groups: [
          {
            Description: 'Read access',
            DisplayName: 'GA AISARCH Staging#ou-root1234-abcd1234#ReadOnly-PS Read access',
            GroupId: 'GroupId',
            IdentityStoreId: 'IdentityStoreId'
          }
        ]
      };
    });
    getAccountsForParentMock.mockImplementation(async (parentId: string) =>
      parentId === 'ou-root1234-abcd1234'
        ? [{ Id: '123456789012', State: 'ACTIVE' }]
        : [{ Id: '123456789013', State: 'ACTIVE' }]
    );
    getOusForParentMock.mockImplementation(async (parentId: string) =>
      parentId === 'ou-root1234-abcd1234' ? [{ Id: 'ouchild5678-efgh5678' }] : []
    );

    const response = await cut.handler(event, context);

    expect(response.output.allGroups).toEqual([
      {
        accountId: '123456789012',
        permissionSetName: 'ReadOnly-PS',
        groupId: 'GroupId',
        description: 'Read access'
      },
      {
        accountId: '123456789013',
        permissionSetName: 'ReadOnly-PS',
        groupId: 'GroupId',
        description: 'Read access'
      }
    ]);
  });

  it('skips groups with unknown permission sets or missing ids', async () => {
    paginateListGroupsMock.mockImplementation(async function* () {
      yield {
        Groups: [
          {
            Description: 'Unknown access',
            DisplayName: 'GA AISARCH Staging#123456789012#Unknown-PS Unknown access',
            GroupId: 'GroupId',
            IdentityStoreId: 'IdentityStoreId'
          },
          {
            Description: 'Missing id',
            DisplayName: 'GA AISARCH Staging#123456789012#ReadOnly-PS Missing id',
            GroupId: undefined,
            IdentityStoreId: 'IdentityStoreId'
          }
        ]
      };
    });

    const response = await cut.handler(event, context);

    expect(response.output.allGroups).toEqual([]);
  });
});
