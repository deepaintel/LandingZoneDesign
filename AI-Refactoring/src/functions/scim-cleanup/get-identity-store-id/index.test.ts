import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest';
import { LambdaInputEvent } from './schema.js';
import { Context } from 'aws-lambda';
import process from 'node:process';

const listInstancesMock = vi.hoisted(() => vi.fn().mockName('listInstancesMock'));

describe('scim-cleanup:get-identity-store-id', () => {
  let cut: typeof import('./index.js');
  const event: LambdaInputEvent = {
    correlationId: 'correlation-id'
  };
  const context = {} as unknown as Context;

  beforeEach(async () => {
    process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
    process.env.REGION = 'REGION';

    vi.mock('../../helpers/identity-center-sso-helper.js', () => ({
      createIdentityCenterSsoClient: vi.fn().mockReturnValue({
        listInstances: listInstancesMock
      })
    }));

    cut = await import('./index.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return id if sso identity store is created', async () => {
    // Setup
    listInstancesMock.mockResolvedValue([{ identityStoreId: 'IdentityStoreId', instanceArn: 'InstanceArn' }]);

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.output.identityStoreInfo.instanceId).toEqual('IdentityStoreId');
  });

  it('should stop execution and throw error if no instances are returned', async () => {
    // Setup
    listInstancesMock.mockResolvedValue([]);

    // Execute and verify
    await expect(cut.handler(event, context)).rejects.toThrowError('No IAM Identity Center instance');
  });

  it('should stop execution and throw error if no identityStoreId is returned', async () => {
    // Setup
    listInstancesMock.mockResolvedValue([{}]);

    // Execute and verify
    await expect(cut.handler(event, context)).rejects.toThrowError('No IdentityStoreId found');
  });
});
