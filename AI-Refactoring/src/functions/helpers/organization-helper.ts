import {
  OrganizationsClient,
  paginateListAccounts,
  OrganizationsPaginationConfiguration,
  Account,
  paginateListAccountsForParent,
  paginateListOrganizationalUnitsForParent,
  OrganizationalUnit
} from '@aws-sdk/client-organizations';
import process from 'node:process';
import type { Tracer } from '@aws-lambda-powertools/tracer';

const defaultClient = new OrganizationsClient({
  region: process.env.REGION,
  maxAttempts: 10,
  retryMode: 'standard'
});

export function createOrganizationsClient(tracer: Tracer): OrganizationsClient {
  return tracer.captureAWSv3Client(
    new OrganizationsClient({
      region: process.env.REGION,
      maxAttempts: 10,
      retryMode: 'standard'
    })
  );
}

async function collectPaginatedItems<TPage, TItem>(
  pages: AsyncIterable<TPage>,
  getItems: (page: TPage) => TItem[] | undefined
): Promise<TItem[]> {
  const items: TItem[] = [];

  for await (const page of pages) {
    items.push(...(getItems(page) ?? []));
  }

  return items;
}

export async function getAccounts(client: OrganizationsClient = defaultClient): Promise<Account[]> {
  const config: OrganizationsPaginationConfiguration = {
    client,
    pageSize: 20
  };
  return collectPaginatedItems(paginateListAccounts(config, {}), (page) => page.Accounts);
}

export async function getAccountsForParent(
  parentId: string,
  client: OrganizationsClient = defaultClient
): Promise<Account[]> {
  const paginatorConfig: OrganizationsPaginationConfiguration = {
    client: client,
    pageSize: 20
  };
  const paginator = paginateListAccountsForParent(paginatorConfig, { ParentId: parentId });
  return collectPaginatedItems(paginator, (page) => page.Accounts);
}

export async function getOusForParent(
  parentId: string,
  client: OrganizationsClient = defaultClient
): Promise<OrganizationalUnit[]> {
  const paginatorConfig: OrganizationsPaginationConfiguration = {
    client: client,
    pageSize: 20
  };
  const paginator = paginateListOrganizationalUnitsForParent(paginatorConfig, { ParentId: parentId });
  return collectPaginatedItems(paginator, (page) => page.OrganizationalUnits);
}
