import { expect, describe, beforeEach, afterEach, it, vi } from 'vitest';
import { LambdaInputEvent } from './schema.js';
import { Context } from 'aws-lambda';
import process from 'node:process';

const listGroupMembershipsForMemberMock = vi.hoisted(() => vi.fn().mockName('listGroupMembershipsForMemberMock'));

describe('scim-cleanup:is-user-enabled', () => {
  let cut: typeof import('./index.js');
  const event: LambdaInputEvent = {
    correlationId: 'correlation-id',
    output: {
      userId: 'user-id',
      instanceId: 'instance-id'
    }
  };
  const context = {} as unknown as Context;

  beforeEach(async () => {
    process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';
    process.env.REGION = 'REGION';

    vi.mock('../../helpers/identity-store-helper.js', () => ({
      createIdentityStoreClient: vi.fn().mockReturnValue({
        listGroupMembershipsForMember: listGroupMembershipsForMemberMock
      })
    }));

    cut = await import('./index.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return enabled false if user has no group memberships', async () => {
    // Setup
    listGroupMembershipsForMemberMock.mockResolvedValue([]);

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.output.enabled).toBe(false);
    expect(listGroupMembershipsForMemberMock).toHaveBeenCalledWith('instance-id', 'user-id');
  });

  it('should return enabled true if user has group memberships', async () => {
    // Setup
    listGroupMembershipsForMemberMock.mockResolvedValue([{ GroupId: 'group-id' }]);

    // Execute
    const response = await cut.handler(event, context);

    // Verify
    expect(response.output.enabled).toBe(true);
  });

  it('should throw if the adapter throws', async () => {
    // Setup
    listGroupMembershipsForMemberMock.mockRejectedValue(new Error('Pagination error'));

    // Execute and verify
    await expect(cut.handler(event, context)).rejects.toThrowError('Pagination error');
  });
});
