import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.hoisted(() => vi.fn().mockName('sendMock'));
const identityStoreClientMock = vi.hoisted(() => vi.fn().mockName('identityStoreClientMock'));
const captureAwsV3ClientMock = vi.hoisted(() => vi.fn().mockName('captureAwsV3ClientMock'));
const paginateListGroupsMock = vi.hoisted(() => vi.fn().mockName('paginateListGroupsMock'));

const tracer = {
  captureAWSv3Client: captureAwsV3ClientMock
};

describe('identity store helper', () => {
  let cut: typeof import('./identity-store-helper.js');

  beforeEach(async () => {
    process.env.REGION = 'REGION';
    identityStoreClientMock.mockImplementation(() => ({ send: sendMock }));
    captureAwsV3ClientMock.mockImplementation((client) => client);

    vi.mock('@aws-sdk/client-identitystore', () => ({
      IdentitystoreClient: identityStoreClientMock,
      paginateListGroups: paginateListGroupsMock
    }));

    cut = await import('./identity-store-helper.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterAll(() => {
    vi.doUnmock('@aws-sdk/client-identitystore');
  });

  it('creates and traces the Identity Store client with retry settings', () => {
    cut.createIdentityStoreClient(tracer as never);

    expect(identityStoreClientMock).toHaveBeenCalledWith({
      region: 'REGION',
      maxAttempts: 10,
      retryMode: 'standard'
    });
    expect(captureAwsV3ClientMock).toHaveBeenCalledOnce();
  });

  it('collects groups across pages', async () => {
    paginateListGroupsMock.mockImplementation(async function* () {
      yield { Groups: [{ GroupId: 'group-1', DisplayName: 'Group 1' }] };
      yield { Groups: [{ GroupId: 'group-2', DisplayName: 'Group 2' }] };
    });
    const client = cut.createIdentityStoreClient(tracer as never);

    await expect(client.listGroups('identity-store-id')).resolves.toEqual([
      { GroupId: 'group-1', DisplayName: 'Group 1' },
      { GroupId: 'group-2', DisplayName: 'Group 2' }
    ]);
    expect(paginateListGroupsMock).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 20 }), {
      IdentityStoreId: 'identity-store-id'
    });
  });
});
