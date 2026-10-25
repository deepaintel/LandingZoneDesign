/**
 * AWS SDK v3 implementation of `OrganizationsAccountPort`, used by the
 * `deploy-landing-zone-accounts` composite action through
 * `scripts/provision-landing-zone-accounts.ts`.
 *
 * - Every request goes through `withOrganizationsRetry` (bounded exponential backoff with full
 *   jitter). The SDK's own retry is limited to a single attempt, so the retry layer is the only
 *   one.
 * - Paginated APIs are read with an explicit `NextToken` loop, so each page request is retried on
 *   its own. A throttled page is re-requested with the same token; pages already read are kept,
 *   and nothing is read twice.
 * - Every SDK command is built fresh for each attempt.
 * - Responses are validated here. A missing or malformed identifier fails the call, so the
 *   reconciler only ever sees well-formed domain values.
 */

import {
  CreateAccountCommand,
  DescribeAccountCommand,
  DescribeCreateAccountStatusCommand,
  DescribeOrganizationCommand,
  ListAccountsCommand,
  ListCreateAccountStatusCommand,
  ListOrganizationalUnitsForParentCommand,
  ListParentsCommand,
  ListRootsCommand,
  ListTagsForResourceCommand,
  MoveAccountCommand,
  OrganizationsClient,
  TagResourceCommand,
  type Account,
  type CreateAccountStatus
} from '@aws-sdk/client-organizations';

import {
  ACCOUNT_ID_PATTERN,
  OU_ID_PATTERN,
  ROOT_ID_PATTERN,
  type AccountTag,
  type CreateAccountRequestStatus,
  type OrganizationAccount,
  type OrganizationsAccountPort
} from './landing-zone-account-reconciler.js';
import {
  DEFAULT_ORGANIZATIONS_RETRY_OPTIONS,
  ORGANIZATIONS_SDK_MAX_ATTEMPTS,
  withOrganizationsRetry,
  type OrganizationsRetryOptions,
  type OrganizationsRetryScope
} from './organizations-retry.js';

/** Upper bound on pages for one listing; a longer chain indicates a malformed response. */
const MAX_PAGES = 1_000;

export interface OrganizationsAccountAdapter extends OrganizationsAccountPort {
  /** Management account ID of the Organization the credentials belong to. */
  getManagementAccountId(): Promise<string>;
}

export function createOrganizationsClient(region: string): OrganizationsClient {
  return new OrganizationsClient({ region, maxAttempts: ORGANIZATIONS_SDK_MAX_ATTEMPTS });
}

function invalid(context: string, detail: string): Error {
  return new Error(`AWS Organizations ${context} returned an invalid response: ${detail}.`);
}

function requiredString(value: unknown, context: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(context, `missing ${field}`);
  }
  return value;
}

function matching(value: unknown, pattern: RegExp, context: string, field: string): string {
  const text = requiredString(value, context, field);
  if (!pattern.test(text)) {
    throw invalid(context, `${field} '${text}' does not match ${pattern.source}`);
  }
  return text;
}

function toAccount(account: Account | undefined, context: string): OrganizationAccount {
  if (account === undefined || account === null) {
    throw invalid(context, 'missing Account');
  }
  return {
    id: matching(account.Id, ACCOUNT_ID_PATTERN, context, 'Account.Id'),
    name: requiredString(account.Name, context, 'Account.Name'),
    email: requiredString(account.Email, context, 'Account.Email'),
    state: requiredString(account.State ?? account.Status, context, 'Account.State')
  };
}

function toCreateAccountStatus(status: CreateAccountStatus | undefined, context: string): CreateAccountRequestStatus {
  if (status === undefined || status === null) {
    throw invalid(context, 'missing CreateAccountStatus');
  }
  const id = requiredString(status.Id, context, 'CreateAccountStatus.Id');
  const state = requiredString(status.State, context, 'CreateAccountStatus.State');
  if (state !== 'IN_PROGRESS' && state !== 'SUCCEEDED' && state !== 'FAILED') {
    throw invalid(context, `unknown CreateAccountStatus.State '${state}'`);
  }
  if (state === 'SUCCEEDED' && status.AccountId === undefined) {
    throw invalid(context, `request ${id} is SUCCEEDED without an AccountId`);
  }
  return {
    id,
    state,
    ...(status.AccountName === undefined ? {} : { accountName: status.AccountName }),
    ...(status.AccountId === undefined
      ? {}
      : { accountId: matching(status.AccountId, ACCOUNT_ID_PATTERN, context, 'CreateAccountStatus.AccountId') }),
    ...(status.FailureReason === undefined ? {} : { failureReason: status.FailureReason })
  };
}

function toSdkTags(tags: readonly AccountTag[]): Array<{ Key: string; Value: string }> {
  return tags.map((tag) => ({ Key: tag.key, Value: tag.value }));
}

export function createOrganizationsAccountPort(
  client: OrganizationsClient,
  retryOverrides: Partial<OrganizationsRetryOptions> = {}
): OrganizationsAccountAdapter {
  const retry: OrganizationsRetryOptions = { ...DEFAULT_ORGANIZATIONS_RETRY_OPTIONS, ...retryOverrides };

  // `client.send` has generic overloads per command; the adapter validates every response it
  // reads, so it treats the raw output as unknown and narrows it explicitly.
  const send = (command: object): Promise<unknown> =>
    (client.send as unknown as (command: object) => Promise<unknown>).call(client, command);

  function call<TOutput>(operation: string, scope: OrganizationsRetryScope, build: () => object): Promise<TOutput> {
    return withOrganizationsRetry(operation, scope, () => send(build()) as Promise<TOutput>, retry);
  }

  async function paginate<TPage extends { NextToken?: string }, TItem>(
    operation: string,
    build: (nextToken: string | undefined) => object,
    items: (page: TPage) => TItem[] | undefined
  ): Promise<TItem[]> {
    const collected: TItem[] = [];
    const seenTokens = new Set<string>();
    let nextToken: string | undefined;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const token = nextToken;
      const response = await call<TPage>(operation, 'idempotent', () => build(token));
      if (typeof response !== 'object' || response === null) {
        throw invalid(operation, `page ${page} is not an object`);
      }
      const pageItems = items(response);
      if (pageItems !== undefined && !Array.isArray(pageItems)) {
        throw invalid(operation, `page ${page} item list is not an array`);
      }
      collected.push(...(pageItems ?? []));
      const following: unknown = response.NextToken;
      if (following === undefined || following === null || following === '') {
        return collected;
      }
      if (typeof following !== 'string') {
        throw invalid(operation, `page ${page} NextToken is not a string`);
      }
      if (seenTokens.has(following)) {
        throw invalid(operation, `page ${page} repeated a NextToken`);
      }
      seenTokens.add(following);
      nextToken = following;
    }
    throw invalid(operation, `more than ${MAX_PAGES} pages`);
  }

  return {
    async listAccounts() {
      const accounts = await paginate<{ NextToken?: string; Accounts?: Account[] }, Account>(
        'ListAccounts',
        (NextToken) => new ListAccountsCommand({ NextToken }),
        (page) => page.Accounts
      );
      return accounts.map((account) => toAccount(account, 'ListAccounts'));
    },

    async getRootId() {
      const roots = await paginate<{ NextToken?: string; Roots?: Array<{ Id?: string }> }, { Id?: string }>(
        'ListRoots',
        (NextToken) => new ListRootsCommand({ NextToken }),
        (page) => page.Roots
      );
      if (roots.length !== 1) {
        throw invalid('ListRoots', `expected exactly one Root but found ${roots.length}`);
      }
      return matching(roots[0]?.Id, ROOT_ID_PATTERN, 'ListRoots', 'Root.Id');
    },

    async listOrganizationalUnitsForParent(parentId) {
      const units = await paginate<
        { NextToken?: string; OrganizationalUnits?: Array<{ Id?: string; Name?: string }> },
        { Id?: string; Name?: string }
      >(
        'ListOrganizationalUnitsForParent',
        (NextToken) => new ListOrganizationalUnitsForParentCommand({ ParentId: parentId, NextToken }),
        (page) => page.OrganizationalUnits
      );
      return units.map((unit) => ({
        id: matching(unit.Id, OU_ID_PATTERN, 'ListOrganizationalUnitsForParent', 'OrganizationalUnit.Id'),
        name: requiredString(unit.Name, 'ListOrganizationalUnitsForParent', 'OrganizationalUnit.Name')
      }));
    },

    async getParent(accountId) {
      const parents = await paginate<
        { NextToken?: string; Parents?: Array<{ Id?: string; Type?: string }> },
        { Id?: string; Type?: string }
      >(
        'ListParents',
        (NextToken) => new ListParentsCommand({ ChildId: accountId, NextToken }),
        (page) => page.Parents
      );
      if (parents.length !== 1) {
        throw invalid('ListParents', `account ${accountId} has ${parents.length} parents (expected 1)`);
      }
      const parent = parents[0] as { Id?: string; Type?: string };
      if (parent.Type === 'ROOT') {
        return { id: matching(parent.Id, ROOT_ID_PATTERN, 'ListParents', 'Parent.Id'), type: 'ROOT' };
      }
      if (parent.Type === 'ORGANIZATIONAL_UNIT') {
        return {
          id: matching(parent.Id, OU_ID_PATTERN, 'ListParents', 'Parent.Id'),
          type: 'ORGANIZATIONAL_UNIT'
        };
      }
      throw invalid('ListParents', `unexpected Parent.Type '${String(parent.Type)}' for account ${accountId}`);
    },

    async listTags(accountId) {
      const tags = await paginate<
        { NextToken?: string; Tags?: Array<{ Key?: string; Value?: string }> },
        { Key?: string; Value?: string }
      >(
        'ListTagsForResource',
        (NextToken) => new ListTagsForResourceCommand({ ResourceId: accountId, NextToken }),
        (page) => page.Tags
      );
      return tags.map((tag) => ({
        key: requiredString(tag.Key, 'ListTagsForResource', 'Tag.Key'),
        value: tag.Value ?? ''
      }));
    },

    async listInProgressCreateAccountRequests() {
      const statuses = await paginate<
        { NextToken?: string; CreateAccountStatuses?: CreateAccountStatus[] },
        CreateAccountStatus
      >(
        'ListCreateAccountStatus',
        (NextToken) => new ListCreateAccountStatusCommand({ States: ['IN_PROGRESS'], NextToken }),
        (page) => page.CreateAccountStatuses
      );
      return statuses.map((status) => toCreateAccountStatus(status, 'ListCreateAccountStatus'));
    },

    async createAccount(request) {
      const response = await call<{ CreateAccountStatus?: CreateAccountStatus }>(
        'CreateAccount',
        'non-idempotent',
        () =>
          new CreateAccountCommand({ AccountName: request.name, Email: request.email, Tags: toSdkTags(request.tags) })
      );
      return toCreateAccountStatus(response?.CreateAccountStatus, 'CreateAccount').id;
    },

    async describeCreateAccountStatus(requestId) {
      const response = await call<{ CreateAccountStatus?: CreateAccountStatus }>(
        'DescribeCreateAccountStatus',
        'idempotent',
        () => new DescribeCreateAccountStatusCommand({ CreateAccountRequestId: requestId })
      );
      return toCreateAccountStatus(response?.CreateAccountStatus, 'DescribeCreateAccountStatus');
    },

    async describeAccount(accountId) {
      const response = await call<{ Account?: Account }>(
        'DescribeAccount',
        'idempotent',
        () => new DescribeAccountCommand({ AccountId: accountId })
      );
      return toAccount(response?.Account, 'DescribeAccount');
    },

    async moveAccount(accountId, sourceParentId, destinationParentId) {
      await call(
        'MoveAccount',
        'non-idempotent',
        () =>
          new MoveAccountCommand({
            AccountId: accountId,
            SourceParentId: sourceParentId,
            DestinationParentId: destinationParentId
          })
      );
    },

    async tagAccount(accountId, tags) {
      await call(
        'TagResource',
        'idempotent',
        () => new TagResourceCommand({ ResourceId: accountId, Tags: toSdkTags(tags) })
      );
    },

    async getManagementAccountId() {
      const response = await call<{ Organization?: { MasterAccountId?: string } }>(
        'DescribeOrganization',
        'idempotent',
        () => new DescribeOrganizationCommand({})
      );
      return matching(
        response?.Organization?.MasterAccountId,
        ACCOUNT_ID_PATTERN,
        'DescribeOrganization',
        'Organization.MasterAccountId'
      );
    }
  };
}
