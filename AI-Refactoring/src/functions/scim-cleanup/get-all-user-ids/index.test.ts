import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest';
import { LambdaInputEvent } from './schema.js';
import { Context } from 'aws-lambda';
import process from 'node:process';

const listUsersMock = vi.hoisted(() => vi.fn().mockName('listUsersMock'));

describe('scim-cleanup:get-all-user-ids', () => {
  let cut: typeof import('./index.js');
  const event: LambdaInputEvent = {
    correlationId: 'correlation-id',
    output: {
      identityStoreInfo: {
        instanceId: 'instance-id'
      }
    }
  };
  const context = {} as unknown as Context;

  beforeEach(async () => {
    process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
    process.env.REGION = 'REGION';

    vi.mock('../../helpers/identity-store-helper.js', () => ({
      createIdentityStoreClient: vi.fn().mockReturnValue({
        listUsers: listUsersMock
      })
    }));

    cut = await import('./index.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return all user ids', async () => {
    // Setup
    listUsersMock.mockResolvedValue([{ UserId: 'Id' }]);

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.output.userIds).toEqual([
      { output: { instanceId: 'instance-id', userId: 'Id' }, correlationId: 'correlation-id' }
    ]);
    expect(listUsersMock).toHaveBeenCalledWith('instance-id');
  });

  it('should return empty array if no users are found', async () => {
    // Setup
    listUsersMock.mockResolvedValue([]);

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.output.userIds).toEqual([]);
  });

  it('should skip users without a UserId', async () => {
    // Setup
    listUsersMock.mockResolvedValue([{}]);

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.output.userIds).toEqual([]);
  });

  it('throws an error if the adapter throws', async () => {
    // Setup
    listUsersMock.mockRejectedValue(new Error('Pagination failed'));

    // Execute and verify
    await expect(cut.handler(event, context)).rejects.toThrowError('Pagination failed');
  });
});
