import { describe, expect, it, vi } from 'vitest';
import type { Account, OrganizationalUnit, OrganizationsClient } from '@aws-sdk/client-organizations';
import {
  isGroupForEnvironment,
  parseGroupName,
  resolveAccountIdsForScope,
  isSupportedScopeIdentifier,
  type ScopeResolverDependencies
} from './scope-resolver.js';

const client = {} as OrganizationsClient;

function dependencies(
  accounts: Record<string, { Id?: string; State?: string }[]> = {},
  ous: Record<string, { Id?: string; Name?: string }[]> = {}
): ScopeResolverDependencies {
  return {
    getAccountsForParent: vi.fn(async (parentId: string) => (accounts[parentId] ?? []) as Account[]),
    getOusForParent: vi.fn(async (parentId: string) => (ous[parentId] ?? []) as OrganizationalUnit[])
  };
}

describe('SCIM group scope resolver', () => {
  it('parses the approved Entra group name grammar', () => {
    expect(parseGroupName('GA AISARCH Staging#123456789012#PlatformEngineer-PS Platform access')).toEqual({
      organizationToken: 'Staging',
      scope: '123456789012',
      permissionSetName: 'PlatformEngineer-PS',
      description: 'Platform access'
    });
  });

  it('accepts canonical account, OU, and Root identifiers only', () => {
    expect(isSupportedScopeIdentifier('123456789012')).toBe(true);
    expect(isSupportedScopeIdentifier('ou-abcd1234-efgh5678')).toBe(true);
    expect(isSupportedScopeIdentifier('r-abcd1234')).toBe(true);
    expect(isSupportedScopeIdentifier('ou-root-1234')).toBe(false);
    expect(isSupportedScopeIdentifier('Workloads/Online/Prod')).toBe(false);
  });

  it('enforces the group environment token', () => {
    expect(isGroupForEnvironment('Staging', 'staging')).toBe(true);
    expect(isGroupForEnvironment('Prod', 'production')).toBe(true);
    expect(isGroupForEnvironment('Prod', 'staging')).toBe(false);
  });

  it('expands nested OU scope to active accounts', async () => {
    const scope = 'ou-abcd1234-efgh5678';
    const childScope = 'ou-ijkl1234-mnop5678';
    const suspendedScope = 'ou-qrst1234-uvwx5678';
    const testDependencies = dependencies(
      {
        [scope]: [
          { Id: '123456789012', State: 'ACTIVE' },
          { Id: '123456789013', State: 'SUSPENDED' }
        ],
        [childScope]: [{ Id: '123456789014', State: 'ACTIVE' }],
        [suspendedScope]: [{ Id: '123456789015', State: 'ACTIVE' }]
      },
      {
        [scope]: [
          { Id: childScope, Name: 'Online' },
          { Id: suspendedScope, Name: 'Suspended' }
        ],
        [childScope]: []
      }
    );

    await expect(resolveAccountIdsForScope(scope, client, testDependencies)).resolves.toEqual([
      '123456789012',
      '123456789014',
      '123456789015'
    ]);
  });

  it('expands Root scope and deduplicates accounts', async () => {
    const root = 'r-abcd1234';
    const childScope = 'ou-abcd1234-efgh5678';
    const testDependencies = dependencies(
      {
        [root]: [{ Id: '123456789012', State: 'ACTIVE' }],
        [childScope]: [
          { Id: '123456789012', State: 'ACTIVE' },
          { Id: '123456789014', State: 'ACTIVE' }
        ]
      },
      {
        [root]: [{ Id: childScope, Name: 'Workloads' }],
        [childScope]: []
      }
    );

    await expect(resolveAccountIdsForScope(root, client, testDependencies)).resolves.toEqual([
      '123456789012',
      '123456789014'
    ]);
  });

  it('returns no accounts for malformed scopes', async () => {
    const testDependencies = dependencies();

    await expect(resolveAccountIdsForScope('ou-invalid', client, testDependencies)).resolves.toEqual([]);
    expect(testDependencies.getAccountsForParent).not.toHaveBeenCalled();
    expect(testDependencies.getOusForParent).not.toHaveBeenCalled();
  });

  it('prevents repeated traversal when the API returns a cycle', async () => {
    const scope = 'ou-abcd1234-efgh5678';
    const testDependencies = dependencies(
      { [scope]: [{ Id: '123456789012', State: 'ACTIVE' }] },
      { [scope]: [{ Id: scope, Name: 'Cycle' }] }
    );

    await expect(resolveAccountIdsForScope(scope, client, testDependencies)).resolves.toEqual(['123456789012']);
    expect(testDependencies.getAccountsForParent).toHaveBeenCalledOnce();
    expect(testDependencies.getOusForParent).toHaveBeenCalledOnce();
  });

  it('expands the Suspended OU like any other OU', async () => {
    const scope = 'ou-susp1234-ijkl5678';
    const testDependencies = dependencies({ [scope]: [{ Id: '123456789015', State: 'ACTIVE' }] }, { [scope]: [] });

    await expect(resolveAccountIdsForScope(scope, client, testDependencies)).resolves.toEqual(['123456789015']);
  });
});
