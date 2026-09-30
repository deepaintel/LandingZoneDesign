import { describe, vi, beforeEach, afterEach, afterAll, expect, it } from 'vitest';
import process from 'node:process';

const organizationsClientMock = vi.hoisted(() => vi.fn().mockName('organizationsClientMock'));
const paginateListAccountsMock = vi.hoisted(() => vi.fn().mockName('paginateListAccountsMock'));
const paginateListAccountsForParentMock = vi.hoisted(() => vi.fn().mockName('paginateListAccountsForParentMock'));
const paginateListOrganizationalUnitsForParentMock = vi.hoisted(() =>
  vi.fn().mockName('paginateListOrganizationalUnitsForParentMock')
);

describe('organization helper tests', () => {
  let cut: typeof import('./organization-helper.js');

  beforeEach(async () => {
    process.env.REGION = 'REGION';
    vi.mock('@aws-sdk/client-organizations', () => ({
      OrganizationsClient: organizationsClientMock.mockImplementation(() => ({ send: vi.fn() })),
      paginateListAccounts: paginateListAccountsMock,
      paginateListAccountsForParent: paginateListAccountsForParentMock,
      paginateListOrganizationalUnitsForParent: paginateListOrganizationalUnitsForParentMock
    }));

    cut = await import('./organization-helper.js');
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterAll(() => {
    vi.doUnmock('@aws-sdk/client-organizations');
  });

  it('configures the Organizations client with standard retries', () => {
    expect(organizationsClientMock).toHaveBeenCalledWith({
      region: 'REGION',
      maxAttempts: 10,
      retryMode: 'standard'
    });
  });

  it('returns all organization accounts across pages', async () => {
    paginateListAccountsMock.mockImplementation(async function* () {
      yield { Accounts: [{ Id: 'account-id-1' }] };
      yield { Accounts: [{ Id: 'account-id-2' }] };
    });

    await expect(cut.getAccounts()).resolves.toEqual([{ Id: 'account-id-1' }, { Id: 'account-id-2' }]);
    expect(paginateListAccountsMock).toHaveBeenCalledOnce();
    expect(paginateListAccountsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.anything(),
        pageSize: 20
      }),
      {}
    );
  });

  it('returns accounts directly under a parent across pages', async () => {
    paginateListAccountsForParentMock.mockImplementation(async function* () {
      yield { Accounts: [{ Id: 'account-id-1' }] };
      yield { Accounts: [{ Id: 'account-id-2' }] };
    });

    await expect(cut.getAccountsForParent('parent-id')).resolves.toEqual([
      { Id: 'account-id-1' },
      { Id: 'account-id-2' }
    ]);
    expect(paginateListAccountsForParentMock).toHaveBeenCalledOnce();
    expect(paginateListAccountsForParentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.anything(),
        pageSize: 20
      }),
      { ParentId: 'parent-id' }
    );
  });

  it('returns child organizational units under a parent', async () => {
    paginateListOrganizationalUnitsForParentMock.mockImplementation(async function* () {
      yield {
        OrganizationalUnits: [
          { Id: 'ou-id-1', Name: 'ou-name-1', Arn: 'ou-arn-1' },
          { Id: 'ou-id-2', Name: 'ou-name-2', Arn: 'ou-arn-2' }
        ]
      };
    });

    await expect(cut.getOusForParent('parent-id')).resolves.toEqual([
      { Id: 'ou-id-1', Name: 'ou-name-1', Arn: 'ou-arn-1' },
      { Id: 'ou-id-2', Name: 'ou-name-2', Arn: 'ou-arn-2' }
    ]);
    expect(paginateListOrganizationalUnitsForParentMock).toHaveBeenCalledOnce();
    expect(paginateListOrganizationalUnitsForParentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        client: expect.anything(),
        pageSize: 20
      }),
      { ParentId: 'parent-id' }
    );
  });
});
