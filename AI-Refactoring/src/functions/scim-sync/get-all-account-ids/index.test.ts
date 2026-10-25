import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest';
import { LambdaInputEvent } from './schema.js';
import { Context } from 'aws-lambda';
import process from 'node:process';

const paginateListAccountsMock = vi.hoisted(() => vi.fn().mockName('paginateListAccountsMock'));

describe('scim-sync:get-all-account-ids', () => {
  let cut: typeof import('./index.js');
  const event: LambdaInputEvent = {
    correlationId: 'correlation-id'
  };
  const context = {} as unknown as Context;

  beforeEach(async () => {
    process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
    process.env.REGION = 'REGION';

    vi.mock('@aws-sdk/client-organizations', () => {
      return {
        OrganizationsClient: vi.fn(),
        paginateListAccounts: paginateListAccountsMock
      };
    });

    cut = await import('./index.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should not return any accounts if no accounts in the organization', async () => {
    // Setup
    paginateListAccountsMock.mockImplementation(async function* () {
      yield { Accounts: [] };
    });

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response).toEqual({
      correlationId: 'correlation-id',
      output: {
        allAccountIds: []
      }
    });
    expect(paginateListAccountsMock).toHaveBeenCalledOnce();
  });

  it('should fail when an active account has no account id', async () => {
    // Setup
    paginateListAccountsMock.mockImplementation(async function* () {
      yield {
        Accounts: [
          {
            Id: undefined,
            Arn: 'arn:aws:organizations::123456789012:account/o-123456789012/123456789012',
            Email: 'test@test.dk',
            Name: 'Test',
            State: 'ACTIVE',
            JoinedMethod: 'CREATED',
            JoinedTimestamp: new Date('2021-01-01T00:00:00.000Z')
          }
        ]
      };
    });

    // Execute
    const response = cut.handler(event, context);

    // Verify
    await expect(response).rejects.toThrow('AWS Organizations returned an active account without an ID');
    expect(paginateListAccountsMock).toHaveBeenCalledOnce();
  });

  it('should return all account ids', async () => {
    // Setup
    paginateListAccountsMock.mockImplementation(async function* () {
      yield {
        Accounts: [
          {
            Id: '123456789012',
            Arn: 'arn:aws:organizations::123456789012:account/o-123456789012/123456789012',
            Email: 'test@test.dk',
            Name: 'Test',
            State: 'ACTIVE',
            JoinedMethod: 'CREATED',
            JoinedTimestamp: new Date('2021-01-01T00:00:00.000Z')
          }
        ],
        NextToken: undefined
      };
    });

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response).toEqual({
      correlationId: 'correlation-id',
      output: {
        allAccountIds: ['123456789012']
      }
    });
    expect(paginateListAccountsMock).toHaveBeenCalledOnce();
  });
});
