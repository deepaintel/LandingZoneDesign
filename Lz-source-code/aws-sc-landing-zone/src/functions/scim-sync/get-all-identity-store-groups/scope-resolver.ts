import type { Account, OrganizationalUnit, OrganizationsClient } from '@aws-sdk/client-organizations';
import { getAccountsForParent, getOusForParent } from '../../helpers/organization-helper.js';

const ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const ORGANIZATIONAL_UNIT_ID_PATTERN = /^ou-[a-z0-9]{4,32}-[a-z0-9]{8,32}$/;
const ROOT_ID_PATTERN = /^r-[a-z0-9]{4,32}$/;

export type ScimEnvironment = 'staging' | 'production';

export interface ScopeResolverDependencies {
  readonly getAccountsForParent: (parentId: string, client: OrganizationsClient) => Promise<Account[]>;
  readonly getOusForParent: (parentId: string, client: OrganizationsClient) => Promise<OrganizationalUnit[]>;
}

const defaultDependencies: ScopeResolverDependencies = {
  getAccountsForParent,
  getOusForParent
};

function expectedOrganizationToken(environment: ScimEnvironment): 'Staging' | 'Prod' {
  return environment === 'staging' ? 'Staging' : 'Prod';
}

function isSupportedScope(scope: string): boolean {
  return ACCOUNT_ID_PATTERN.test(scope) || ORGANIZATIONAL_UNIT_ID_PATTERN.test(scope) || ROOT_ID_PATTERN.test(scope);
}

async function collectActiveAccountIds(
  parentId: string,
  client: OrganizationsClient,
  dependencies: ScopeResolverDependencies,
  visitedParents: Set<string>
): Promise<string[]> {
  if (visitedParents.has(parentId)) {
    return [];
  }
  visitedParents.add(parentId);

  const [accounts, childOrganizationalUnits] = await Promise.all([
    dependencies.getAccountsForParent(parentId, client),
    dependencies.getOusForParent(parentId, client)
  ]);

  const directAccountIds = accounts.flatMap((account) =>
    account.State === 'ACTIVE' && account.Id && ACCOUNT_ID_PATTERN.test(account.Id) ? [account.Id] : []
  );

  const childAccountIds = await Promise.all(
    childOrganizationalUnits.flatMap((organizationalUnit) =>
      organizationalUnit.Id ? collectActiveAccountIds(organizationalUnit.Id, client, dependencies, visitedParents) : []
    )
  );

  return [...new Set([...directAccountIds, ...childAccountIds.flat()])];
}

export interface GroupScopeResolution {
  readonly organizationToken: string;
  readonly scope: string;
  readonly permissionSetName: string;
  readonly description: string;
}

export function parseGroupName(displayName: string): GroupScopeResolution | undefined {
  const match = /^GA AISARCH (Staging|Prod)#([^#]+)#([A-Za-z0-9]+-PS) (.+)$/.exec(displayName);
  if (!match) {
    return undefined;
  }

  const [, organizationToken, scope, permissionSetName, description] = match;
  if (!organizationToken || !scope || !permissionSetName || !description) {
    return undefined;
  }

  return { organizationToken, scope, permissionSetName, description };
}

export async function resolveAccountIdsForScope(
  scope: string,
  client: OrganizationsClient,
  dependencies: ScopeResolverDependencies = defaultDependencies
): Promise<string[]> {
  if (ACCOUNT_ID_PATTERN.test(scope)) {
    return [scope];
  }

  if (!ORGANIZATIONAL_UNIT_ID_PATTERN.test(scope) && !ROOT_ID_PATTERN.test(scope)) {
    return [];
  }

  return collectActiveAccountIds(scope, client, dependencies, new Set<string>());
}

export function isGroupForEnvironment(organizationToken: string, environment: ScimEnvironment): boolean {
  return organizationToken === expectedOrganizationToken(environment);
}

export function isSupportedScopeIdentifier(scope: string): boolean {
  return isSupportedScope(scope);
}

export { ACCOUNT_ID_PATTERN, ORGANIZATIONAL_UNIT_ID_PATTERN, ROOT_ID_PATTERN };
