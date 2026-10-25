import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest';
import { LambdaInputEvent } from './schema.js';
import { Context } from 'aws-lambda';
import process from 'node:process';

const deleteUserMock = vi.hoisted(() => vi.fn().mockName('deleteUserMock'));

describe('scim-cleanup:delete-user', () => {
  let cut: typeof import('./index.js');
  const event: LambdaInputEvent = {
    correlationId: 'correlation-id',
    output: {
      userId: 'user-id',
      instanceId: 'instance-id',
      enabled: true
    }
  };
  const context = {} as unknown as Context;

  beforeEach(async () => {
    process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
    process.env.REGION = 'REGION';

    vi.mock('../../helpers/identity-store-helper.js', () => ({
      createIdentityStoreClient: vi.fn().mockReturnValue({
        deleteUser: deleteUserMock
      })
    }));

    cut = await import('./index.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should delete the user', async () => {
    // Setup
    deleteUserMock.mockResolvedValue(undefined);

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.output.successfullyDeleted).toBe(true);
    expect(deleteUserMock).toHaveBeenCalledWith('instance-id', 'user-id');
  });

  it('should throw if the adapter throws', async () => {
    // Setup
    deleteUserMock.mockRejectedValue(new Error('Error calling sdk'));

    // Execute and verify
    await expect(cut.handler(event, context)).rejects.toThrowError('Error calling sdk');
    expect(deleteUserMock).toHaveBeenCalledOnce();
  });
});
