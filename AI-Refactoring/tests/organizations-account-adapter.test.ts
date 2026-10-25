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
  TagResourceCommand
} from '@aws-sdk/client-organizations';
import { describe, expect, it, vi } from 'vitest';

import { ensureAccountPlacement, type ApplyOptions } from '../lib/organization/landing-zone-account-reconciler.js';
import {
  createOrganizationsAccountPort,
  createOrganizationsClient
} from '../lib/organization/organizations-account-adapter.js';
import {
  ORGANIZATIONS_RETRY_MAX_ATTEMPTS,
  ORGANIZATIONS_RETRY_MAX_DELAY_MS,
  ORGANIZATIONS_RETRY_START_DELAY_MS,
  ORGANIZATIONS_SDK_MAX_ATTEMPTS,
  isRetryableOrganizationsError
} from '../lib/organization/organizations-retry.js';

const REGION = 'eusc-de-east-1';
const ROOT_ID = 'r-a1b2';
const TARGET_OU = 'ou-a1b2-corpnp01';
const OTHER_OU = 'ou-a1b2-corppr01';
const ACCOUNT_ID = '111111111111';

type CommandClass = abstract new (...args: never[]) => object;
type Reply = unknown;

/** An AWS SDK v3 style service error. */
function awsError(name: string, extra: Record<string, unknown> = {}): Error {
  const error = new Error(`${name} raised by the test`);
  error.name = name;
  return Object.assign(error, extra);
}

/** A Node.js network error, which carries `code` rather than an AWS error name. */
function networkError(code: string): Error {
  return Object.assign(new Error(`socket ${code}`), { code });
}

interface Sent {
  readonly command: object;
  readonly input: Record<string, unknown>;
}

/**
 * Builds the production adapter over a real `OrganizationsClient` whose `send` is mocked. Each
 * command class answers from its own queue; an `Error` in the queue is thrown.
 */
function harness(replies: Array<[CommandClass, Reply[]]>, random: () => number = () => 0.5) {
  const queues = new Map<CommandClass, Reply[]>(replies.map(([command, queue]) => [command, [...queue]]));
  const sent: Sent[] = [];
  const delays: number[] = [];
  const logs: string[] = [];
  const client = new OrganizationsClient({ region: REGION });
  const send = vi.spyOn(client, 'send').mockImplementation((async (command: object) => {
    sent.push({ command, input: (command as { input: Record<string, unknown> }).input });
    const entry = [...queues.entries()].find(([type]) => command instanceof type);
    if (entry === undefined || entry[1].length === 0) {
      throw new Error(`Unexpected ${command.constructor.name}`);
    }
    const reply = entry[1].shift();
    if (reply instanceof Error) {
      throw reply;
    }
    return reply;
  }) as never);
  const adapter = createOrganizationsAccountPort(client, {
    sleep: async (milliseconds) => void delays.push(milliseconds),
    random,
    log: (message) => void logs.push(message)
  });
  const sentOf = (type: CommandClass) => sent.filter((call) => call.command instanceof type);
  return { adapter, send, sent, sentOf, delays, logs };
}

function account(id: string, name = `Account-${id}`): Record<string, string> {
  return { Id: id, Name: name, Email: `${name}@if.se`, State: 'ACTIVE' };
}

describe('Organizations client configuration', () => {
  it('limits the SDK to one attempt per call so the adapter retry is the only retry layer', async () => {
    const client = createOrganizationsClient(REGION);
    expect(ORGANIZATIONS_SDK_MAX_ATTEMPTS).toBe(1);
    await expect(client.config.maxAttempts()).resolves.toBe(1);
    await expect(client.config.region()).resolves.toBe(REGION);
  });

  it('uses the LZA starting delay and attempt count, with a cap on a single wait', () => {
    expect(ORGANIZATIONS_RETRY_START_DELAY_MS).toBe(150);
    expect(ORGANIZATIONS_RETRY_MAX_ATTEMPTS).toBe(12);
    expect(ORGANIZATIONS_RETRY_MAX_DELAY_MS).toBe(20_000);
  });
});

describe('pagination', () => {
  it('returns a single page as-is', async () => {
    const { adapter, sentOf } = harness([[ListAccountsCommand, [{ Accounts: [account('100000000001')] }]]]);
    await expect(adapter.listAccounts()).resolves.toEqual([
      { id: '100000000001', name: 'Account-100000000001', email: 'Account-100000000001@if.se', state: 'ACTIVE' }
    ]);
    expect(sentOf(ListAccountsCommand)).toHaveLength(1);
  });

  it('keeps every page, in order, across an empty intermediate page', async () => {
    const { adapter, sentOf } = harness([
      [
        ListAccountsCommand,
        [
          { Accounts: [account('100000000001'), account('100000000002')], NextToken: 't1' },
          { Accounts: [], NextToken: 't2' },
          { NextToken: 't3' },
          { Accounts: [account('100000000003')] }
        ]
      ]
    ]);
    const accounts = await adapter.listAccounts();
    expect(accounts.map((entry) => entry.id)).toEqual(['100000000001', '100000000002', '100000000003']);
    expect(new Set(accounts.map((entry) => entry.id)).size).toBe(accounts.length);
    expect(sentOf(ListAccountsCommand).map((call) => call.input.NextToken)).toEqual([undefined, 't1', 't2', 't3']);
  });

  it('pages ListOrganizationalUnitsForParent with the requested ParentId', async () => {
    const { adapter, sentOf } = harness([
      [
        ListOrganizationalUnitsForParentCommand,
        [
          { OrganizationalUnits: [{ Id: 'ou-a1b2-aaaaaaaa', Name: 'Prod' }], NextToken: 'n1' },
          { OrganizationalUnits: [{ Id: 'ou-a1b2-bbbbbbbb', Name: 'Non-Prod' }] }
        ]
      ]
    ]);
    await expect(adapter.listOrganizationalUnitsForParent('ou-a1b2-corp0001')).resolves.toEqual([
      { id: 'ou-a1b2-aaaaaaaa', name: 'Prod' },
      { id: 'ou-a1b2-bbbbbbbb', name: 'Non-Prod' }
    ]);
    expect(sentOf(ListOrganizationalUnitsForParentCommand).map((call) => call.input)).toEqual([
      { ParentId: 'ou-a1b2-corp0001', NextToken: undefined },
      { ParentId: 'ou-a1b2-corp0001', NextToken: 'n1' }
    ]);
  });

  it('pages ListTagsForResource with the account as ResourceId', async () => {
    const { adapter, sentOf } = harness([
      [
        ListTagsForResourceCommand,
        [{ Tags: [{ Key: 'owner', Value: 'CCoE' }], NextToken: 'n1' }, { Tags: [{ Key: 'domain', Value: 'X' }] }]
      ]
    ]);
    await expect(adapter.listTags(ACCOUNT_ID)).resolves.toEqual([
      { key: 'owner', value: 'CCoE' },
      { key: 'domain', value: 'X' }
    ]);
    expect(sentOf(ListTagsForResourceCommand).map((call) => call.input)).toEqual([
      { ResourceId: ACCOUNT_ID, NextToken: undefined },
      { ResourceId: ACCOUNT_ID, NextToken: 'n1' }
    ]);
  });

  it('pages ListCreateAccountStatus for IN_PROGRESS requests only', async () => {
    const { adapter, sentOf } = harness([
      [
        ListCreateAccountStatusCommand,
        [
          { CreateAccountStatuses: [{ Id: 'car-1', State: 'IN_PROGRESS', AccountName: 'A' }], NextToken: 'n1' },
          { CreateAccountStatuses: [{ Id: 'car-2', State: 'IN_PROGRESS', AccountName: 'B' }] }
        ]
      ]
    ]);
    await expect(adapter.listInProgressCreateAccountRequests()).resolves.toEqual([
      { id: 'car-1', state: 'IN_PROGRESS', accountName: 'A' },
      { id: 'car-2', state: 'IN_PROGRESS', accountName: 'B' }
    ]);
    expect(sentOf(ListCreateAccountStatusCommand).map((call) => call.input)).toEqual([
      { States: ['IN_PROGRESS'], NextToken: undefined },
      { States: ['IN_PROGRESS'], NextToken: 'n1' }
    ]);
  });

  it('pages ListRoots and ListParents before applying the single-result rule', async () => {
    const { adapter, sentOf } = harness([
      [ListRootsCommand, [{ Roots: [], NextToken: 'n1' }, { Roots: [{ Id: ROOT_ID }] }]],
      [
        ListParentsCommand,
        [{ Parents: [], NextToken: 'n1' }, { Parents: [{ Id: TARGET_OU, Type: 'ORGANIZATIONAL_UNIT' }] }]
      ]
    ]);
    await expect(adapter.getRootId()).resolves.toBe(ROOT_ID);
    await expect(adapter.getParent(ACCOUNT_ID)).resolves.toEqual({ id: TARGET_OU, type: 'ORGANIZATIONAL_UNIT' });
    expect(sentOf(ListRootsCommand)).toHaveLength(2);
    expect(sentOf(ListParentsCommand).map((call) => call.input)).toEqual([
      { ChildId: ACCOUNT_ID, NextToken: undefined },
      { ChildId: ACCOUNT_ID, NextToken: 'n1' }
    ]);
  });

  it('re-requests only a throttled page and keeps the pages already read', async () => {
    const { adapter, sentOf, delays } = harness([
      [
        ListAccountsCommand,
        [
          { Accounts: [account('100000000001')], NextToken: 't1' },
          awsError('TooManyRequestsException'),
          { Accounts: [account('100000000002')], NextToken: 't2' },
          { Accounts: [account('100000000003')] }
        ]
      ]
    ]);
    const accounts = await adapter.listAccounts();
    expect(accounts.map((entry) => entry.id)).toEqual(['100000000001', '100000000002', '100000000003']);
    expect(sentOf(ListAccountsCommand).map((call) => call.input.NextToken)).toEqual([undefined, 't1', 't1', 't2']);
    expect(delays).toHaveLength(1);
  });

  it.each([
    [
      'a repeated NextToken',
      [
        { Accounts: [], NextToken: 'same' },
        { Accounts: [], NextToken: 'same' }
      ],
      /repeated a NextToken/
    ],
    ['a non-string NextToken', [{ Accounts: [], NextToken: 42 }], /NextToken is not a string/],
    ['a non-array item list', [{ Accounts: { Id: '100000000001' } }], /item list is not an array/],
    ['a non-object page', [undefined], /page 1 is not an object/]
  ])('fails on %s', async (_label, pages, message) => {
    const { adapter } = harness([[ListAccountsCommand, pages]]);
    await expect(adapter.listAccounts()).rejects.toThrow(message);
  });
});

describe('SDK command mapping', () => {
  it('DescribeAccount sends the AccountId', async () => {
    const { adapter, sentOf } = harness([[DescribeAccountCommand, [{ Account: account(ACCOUNT_ID) }]]]);
    await adapter.describeAccount(ACCOUNT_ID);
    expect(sentOf(DescribeAccountCommand)[0]?.input).toEqual({ AccountId: ACCOUNT_ID });
  });

  it('DescribeCreateAccountStatus sends the CreateAccountRequestId', async () => {
    const { adapter, sentOf } = harness([
      [DescribeCreateAccountStatusCommand, [{ CreateAccountStatus: { Id: 'car-1', State: 'IN_PROGRESS' } }]]
    ]);
    await expect(adapter.describeCreateAccountStatus('car-1')).resolves.toEqual({ id: 'car-1', state: 'IN_PROGRESS' });
    expect(sentOf(DescribeCreateAccountStatusCommand)[0]?.input).toEqual({ CreateAccountRequestId: 'car-1' });
  });

  it('CreateAccount sends exactly the name, email, and tags, leaving the access role at the AWS default', async () => {
    const { adapter, sentOf } = harness([
      [CreateAccountCommand, [{ CreateAccountStatus: { Id: 'car-9', State: 'IN_PROGRESS' } }]]
    ]);
    const requestId = await adapter.createAccount({
      name: 'Network',
      email: 'FMITaws-cloud-org-002+Network@if.se',
      tags: [
        { key: 'owner', value: 'Connectivity' },
        { key: 'data-residency', value: 'EU' }
      ]
    });
    expect(requestId).toBe('car-9');
    expect(sentOf(CreateAccountCommand)[0]?.input).toEqual({
      AccountName: 'Network',
      Email: 'FMITaws-cloud-org-002+Network@if.se',
      Tags: [
        { Key: 'owner', Value: 'Connectivity' },
        { Key: 'data-residency', Value: 'EU' }
      ]
    });
  });

  it('MoveAccount sends the account, source, and destination', async () => {
    const { adapter, sentOf } = harness([[MoveAccountCommand, [{}]]]);
    await adapter.moveAccount(ACCOUNT_ID, ROOT_ID, TARGET_OU);
    expect(sentOf(MoveAccountCommand)[0]?.input).toEqual({
      AccountId: ACCOUNT_ID,
      SourceParentId: ROOT_ID,
      DestinationParentId: TARGET_OU
    });
  });

  it('TagResource sends the account as ResourceId with the configured tags', async () => {
    const { adapter, sentOf } = harness([[TagResourceCommand, [{}]]]);
    await adapter.tagAccount(ACCOUNT_ID, [{ key: 'lifecycle', value: 'active' }]);
    expect(sentOf(TagResourceCommand)[0]?.input).toEqual({
      ResourceId: ACCOUNT_ID,
      Tags: [{ Key: 'lifecycle', Value: 'active' }]
    });
  });

  it('DescribeOrganization returns the management account ID', async () => {
    const { adapter } = harness([
      [DescribeOrganizationCommand, [{ Organization: { MasterAccountId: '222222222222' } }]]
    ]);
    await expect(adapter.getManagementAccountId()).resolves.toBe('222222222222');
  });

  it('builds a fresh command for every attempt', async () => {
    const { adapter, sentOf } = harness([[MoveAccountCommand, [awsError('ConcurrentModificationException'), {}]]]);
    await adapter.moveAccount(ACCOUNT_ID, ROOT_ID, TARGET_OU);
    const [first, second] = sentOf(MoveAccountCommand);
    expect(first?.command).not.toBe(second?.command);
    expect(first?.input).toEqual(second?.input);
  });

  it('reads the account State, falling back to the older Status field', async () => {
    const { adapter } = harness([
      [DescribeAccountCommand, [{ Account: { Id: ACCOUNT_ID, Name: 'A', Email: 'a@if.se', Status: 'SUSPENDED' } }]]
    ]);
    await expect(adapter.describeAccount(ACCOUNT_ID)).resolves.toMatchObject({ state: 'SUSPENDED' });
  });
});

describe('malformed responses', () => {
  const cases: Array<
    [
      string,
      Array<[CommandClass, Reply[]]>,
      (adapter: ReturnType<typeof harness>['adapter']) => Promise<unknown>,
      RegExp
    ]
  > = [
    ['zero roots', [[ListRootsCommand, [{ Roots: [] }]]], (a) => a.getRootId(), /exactly one Root but found 0/],
    [
      'two roots',
      [[ListRootsCommand, [{ Roots: [{ Id: ROOT_ID }, { Id: 'r-abcd' }] }]]],
      (a) => a.getRootId(),
      /exactly one Root but found 2/
    ],
    ['a missing Root ID', [[ListRootsCommand, [{ Roots: [{}] }]]], (a) => a.getRootId(), /missing Root.Id/],
    [
      'a malformed Root ID',
      [[ListRootsCommand, [{ Roots: [{ Id: 'root-1' }] }]]],
      (a) => a.getRootId(),
      /Root.Id 'root-1' does not match/
    ],
    [
      'a missing OU ID',
      [[ListOrganizationalUnitsForParentCommand, [{ OrganizationalUnits: [{ Name: 'Prod' }] }]]],
      (a) => a.listOrganizationalUnitsForParent(ROOT_ID),
      /missing OrganizationalUnit.Id/
    ],
    [
      'a malformed OU ID',
      [[ListOrganizationalUnitsForParentCommand, [{ OrganizationalUnits: [{ Id: 'ou-x', Name: 'Prod' }] }]]],
      (a) => a.listOrganizationalUnitsForParent(ROOT_ID),
      /OrganizationalUnit.Id 'ou-x' does not match/
    ],
    [
      'a missing OU name',
      [[ListOrganizationalUnitsForParentCommand, [{ OrganizationalUnits: [{ Id: TARGET_OU }] }]]],
      (a) => a.listOrganizationalUnitsForParent(ROOT_ID),
      /missing OrganizationalUnit.Name/
    ],
    [
      'a malformed account ID',
      [[ListAccountsCommand, [{ Accounts: [account('12345')] }]]],
      (a) => a.listAccounts(),
      /Account.Id '12345' does not match/
    ],
    [
      'a missing account name',
      [[ListAccountsCommand, [{ Accounts: [{ Id: ACCOUNT_ID, Email: 'a@if.se', State: 'ACTIVE' }] }]]],
      (a) => a.listAccounts(),
      /missing Account.Name/
    ],
    [
      'a missing account email',
      [[ListAccountsCommand, [{ Accounts: [{ Id: ACCOUNT_ID, Name: 'A', State: 'ACTIVE' }] }]]],
      (a) => a.listAccounts(),
      /missing Account.Email/
    ],
    [
      'a missing account State',
      [[ListAccountsCommand, [{ Accounts: [{ Id: ACCOUNT_ID, Name: 'A', Email: 'a@if.se' }] }]]],
      (a) => a.listAccounts(),
      /missing Account.State/
    ],
    [
      'a missing Account in DescribeAccount',
      [[DescribeAccountCommand, [{}]]],
      (a) => a.describeAccount(ACCOUNT_ID),
      /missing Account/
    ],
    [
      'a missing CreateAccount request ID',
      [[CreateAccountCommand, [{ CreateAccountStatus: { State: 'IN_PROGRESS' } }]]],
      (a) => a.createAccount({ name: 'A', email: 'a@if.se', tags: [] }),
      /missing CreateAccountStatus.Id/
    ],
    [
      'a missing CreateAccountStatus',
      [[CreateAccountCommand, [{}]]],
      (a) => a.createAccount({ name: 'A', email: 'a@if.se', tags: [] }),
      /missing CreateAccountStatus/
    ],
    [
      'SUCCEEDED without an AccountId',
      [[DescribeCreateAccountStatusCommand, [{ CreateAccountStatus: { Id: 'car-1', State: 'SUCCEEDED' } }]]],
      (a) => a.describeCreateAccountStatus('car-1'),
      /SUCCEEDED without an AccountId/
    ],
    [
      'a malformed created AccountId',
      [
        [
          DescribeCreateAccountStatusCommand,
          [{ CreateAccountStatus: { Id: 'car-1', State: 'SUCCEEDED', AccountId: 'abc' } }]
        ]
      ],
      (a) => a.describeCreateAccountStatus('car-1'),
      /CreateAccountStatus.AccountId 'abc' does not match/
    ],
    [
      'an unknown CreateAccount state',
      [[DescribeCreateAccountStatusCommand, [{ CreateAccountStatus: { Id: 'car-1', State: 'PAUSED' } }]]],
      (a) => a.describeCreateAccountStatus('car-1'),
      /unknown CreateAccountStatus.State 'PAUSED'/
    ],
    ['zero parents', [[ListParentsCommand, [{ Parents: [] }]]], (a) => a.getParent(ACCOUNT_ID), /has 0 parents/],
    [
      'two parents',
      [
        [
          ListParentsCommand,
          [
            {
              Parents: [
                { Id: ROOT_ID, Type: 'ROOT' },
                { Id: TARGET_OU, Type: 'ORGANIZATIONAL_UNIT' }
              ]
            }
          ]
        ]
      ],
      (a) => a.getParent(ACCOUNT_ID),
      /has 2 parents/
    ],
    [
      'an unknown parent type',
      [[ListParentsCommand, [{ Parents: [{ Id: TARGET_OU, Type: 'ACCOUNT' }] }]]],
      (a) => a.getParent(ACCOUNT_ID),
      /unexpected Parent.Type 'ACCOUNT'/
    ],
    [
      'a parent ID that does not match its type',
      [[ListParentsCommand, [{ Parents: [{ Id: ROOT_ID, Type: 'ORGANIZATIONAL_UNIT' }] }]]],
      (a) => a.getParent(ACCOUNT_ID),
      /Parent.Id 'r-a1b2' does not match/
    ],
    [
      'a tag without a Key',
      [[ListTagsForResourceCommand, [{ Tags: [{ Value: 'x' }] }]]],
      (a) => a.listTags(ACCOUNT_ID),
      /missing Tag.Key/
    ],
    [
      'a malformed management account ID',
      [[DescribeOrganizationCommand, [{ Organization: { MasterAccountId: 'none' } }]]],
      (a) => a.getManagementAccountId(),
      /MasterAccountId 'none' does not match/
    ]
  ];

  it.each(cases)('fails clearly on %s', async (_label, replies, run, message) => {
    const { adapter } = harness(replies);
    await expect(run(adapter)).rejects.toThrow(message);
  });
});

describe('retry and backoff', () => {
  it('makes one call and logs nothing when the first request succeeds', async () => {
    const { adapter, sentOf, delays, logs } = harness([[DescribeAccountCommand, [{ Account: account(ACCOUNT_ID) }]]]);
    await adapter.describeAccount(ACCOUNT_ID);
    expect(sentOf(DescribeAccountCommand)).toHaveLength(1);
    expect(delays).toEqual([]);
    expect(logs).toEqual([]);
  });

  it.each([
    ['ConcurrentModificationException', awsError('ConcurrentModificationException')],
    ['TooManyRequestsException', awsError('TooManyRequestsException')],
    ['ThrottlingException', awsError('ThrottlingException')],
    ['Throttling', awsError('Throttling')],
    ['ServiceException', awsError('ServiceException')],
    ['InternalErrorException', awsError('InternalErrorException')],
    ['ECONNRESET', networkError('ECONNRESET')],
    ['ETIMEDOUT', networkError('ETIMEDOUT')],
    ['an SDK-flagged retryable error', awsError('SomeTransientError', { $retryable: {} })]
  ])('retries %s and then succeeds', async (label, error) => {
    const { adapter, sentOf, delays, logs } = harness([
      [DescribeAccountCommand, [error, { Account: account(ACCOUNT_ID) }]]
    ]);
    await expect(adapter.describeAccount(ACCOUNT_ID)).resolves.toMatchObject({ id: ACCOUNT_ID });
    expect(sentOf(DescribeAccountCommand)).toHaveLength(2);
    expect(delays).toHaveLength(1);
    expect(logs).toEqual([
      `Organizations DescribeAccount: attempt 1/12 failed with ${label === 'an SDK-flagged retryable error' ? 'SomeTransientError' : label}; retrying in ${delays[0]} ms.`
    ]);
  });

  it('stops after exactly the configured number of attempts and keeps the AWS error', async () => {
    const throttled = Array.from({ length: 20 }, () => awsError('ThrottlingException'));
    const { adapter, sentOf, delays } = harness([[ListRootsCommand, throttled]], () => 0.999999);
    const failure = adapter.getRootId();
    await expect(failure).rejects.toThrow(/Organizations ListRoots failed after 12 attempts: ThrottlingException/);
    await failure.catch((error: Error) => expect((error.cause as Error).name).toBe('ThrottlingException'));
    expect(sentOf(ListRootsCommand)).toHaveLength(ORGANIZATIONS_RETRY_MAX_ATTEMPTS);
    expect(delays).toHaveLength(ORGANIZATIONS_RETRY_MAX_ATTEMPTS - 1);
    delays.forEach((delay, index) => {
      const bound = Math.min(ORGANIZATIONS_RETRY_MAX_DELAY_MS, ORGANIZATIONS_RETRY_START_DELAY_MS * 2 ** index);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(bound);
    });
    expect(Math.max(...delays)).toBeLessThanOrEqual(ORGANIZATIONS_RETRY_MAX_DELAY_MS);
  });

  it('uses full jitter: a random draw of 0 means no wait', async () => {
    const { adapter, delays } = harness(
      [
        [
          DescribeAccountCommand,
          [awsError('ThrottlingException'), awsError('ThrottlingException'), { Account: account(ACCOUNT_ID) }]
        ]
      ],
      () => 0
    );
    await adapter.describeAccount(ACCOUNT_ID);
    expect(delays).toEqual([0, 0]);
  });

  it.each(['AccessDeniedException', 'InvalidInputException', 'AWSOrganizationsNotInUseException'])(
    'does not retry %s',
    async (name) => {
      const { adapter, sentOf, delays } = harness([[DescribeAccountCommand, [awsError(name)]]]);
      await expect(adapter.describeAccount(ACCOUNT_ID)).rejects.toThrow(
        `Organizations DescribeAccount failed: ${name}`
      );
      expect(sentOf(DescribeAccountCommand)).toHaveLength(1);
      expect(delays).toEqual([]);
    }
  );

  it('does not retry a permanent account quota constraint and reports its reason', async () => {
    const { adapter, sentOf } = harness([
      [CreateAccountCommand, [awsError('ConstraintViolationException', { Reason: 'ACCOUNT_NUMBER_LIMIT_EXCEEDED' })]]
    ]);
    await expect(adapter.createAccount({ name: 'A', email: 'a@if.se', tags: [] })).rejects.toThrow(
      /CreateAccount failed: ConstraintViolationException \(Reason: ACCOUNT_NUMBER_LIMIT_EXCEEDED\)/
    );
    expect(sentOf(CreateAccountCommand)).toHaveLength(1);
  });

  it('does not retry an SDK-flagged error that Organizations defines as permanent', () => {
    expect(
      isRetryableOrganizationsError(awsError('ConstraintViolationException', { $retryable: {} }), 'idempotent')
    ).toBe(false);
  });

  it('retries CreateAccount only when AWS rejected the request before acting on it', async () => {
    const throttled = harness([
      [
        CreateAccountCommand,
        [awsError('TooManyRequestsException'), { CreateAccountStatus: { Id: 'car-1', State: 'IN_PROGRESS' } }]
      ]
    ]);
    await expect(throttled.adapter.createAccount({ name: 'A', email: 'a@if.se', tags: [] })).resolves.toBe('car-1');
    expect(throttled.sentOf(CreateAccountCommand)).toHaveLength(2);

    for (const ambiguous of [awsError('ServiceException'), networkError('ECONNRESET')]) {
      const { adapter, sentOf } = harness([[CreateAccountCommand, [ambiguous]]]);
      await expect(adapter.createAccount({ name: 'A', email: 'a@if.se', tags: [] })).rejects.toThrow(
        /CreateAccount failed/
      );
      expect(sentOf(CreateAccountCommand)).toHaveLength(1);
    }
  });
});

describe('MoveAccount placement with the production adapter', () => {
  const pollSleeps: number[] = [];
  const options: ApplyOptions = {
    pollIntervalMs: 0,
    createTimeoutMs: 1_000,
    activeTimeoutMs: 1_000,
    confirmPollIntervalMs: 5_000,
    confirmTimeoutMs: 60_000,
    sleep: async (milliseconds) => void pollSleeps.push(milliseconds)
  };
  const inRoot = { Parents: [{ Id: ROOT_ID, Type: 'ROOT' }] };
  const inTarget = { Parents: [{ Id: TARGET_OU, Type: 'ORGANIZATIONAL_UNIT' }] };

  it('E: a throttled ListParents is retried by the adapter, and a stale Root read keeps the poll going', async () => {
    pollSleeps.length = 0;
    const { adapter, sentOf, delays } = harness([
      [ListParentsCommand, [inRoot, awsError('TooManyRequestsException'), inRoot, inTarget]],
      [MoveAccountCommand, [{}]]
    ]);
    await ensureAccountPlacement(adapter, ACCOUNT_ID, TARGET_OU, ROOT_ID, options);
    expect(sentOf(MoveAccountCommand)).toHaveLength(1);
    expect(sentOf(ListParentsCommand)).toHaveLength(4);
    // One API retry for the throttle; one poll wait for the stale Root. The throttle is not a poll.
    expect(delays).toHaveLength(1);
    expect(pollSleeps).toEqual([5_000]);
  });

  it('F: a throttled MoveAccount is retried by the adapter and then confirmed', async () => {
    pollSleeps.length = 0;
    const { adapter, sentOf } = harness([
      [ListParentsCommand, [inRoot, inTarget]],
      [MoveAccountCommand, [awsError('TooManyRequestsException'), {}]]
    ]);
    await ensureAccountPlacement(adapter, ACCOUNT_ID, TARGET_OU, ROOT_ID, options);
    const moves = sentOf(MoveAccountCommand);
    expect(moves).toHaveLength(2);
    expect(moves[0]?.input).toEqual(moves[1]?.input);
    expect(sentOf(ListParentsCommand)).toHaveLength(2);
    expect(pollSleeps).toEqual([]);
  });

  it.each(['AccessDeniedException', 'InvalidInputException'])(
    'G: a permanent %s from MoveAccount fails without polling for the parent',
    async (name) => {
      pollSleeps.length = 0;
      const { adapter, sentOf } = harness([
        [ListParentsCommand, [inRoot]],
        [MoveAccountCommand, [awsError(name)]]
      ]);
      await expect(ensureAccountPlacement(adapter, ACCOUNT_ID, TARGET_OU, ROOT_ID, options)).rejects.toThrow(
        `Organizations MoveAccount failed: ${name}`
      );
      expect(sentOf(MoveAccountCommand)).toHaveLength(1);
      expect(sentOf(ListParentsCommand)).toHaveLength(1);
      expect(pollSleeps).toEqual([]);
    }
  );

  it('fails closed when the adapter reports an unexpected OU after the move', async () => {
    pollSleeps.length = 0;
    const { adapter, sentOf } = harness([
      [ListParentsCommand, [inRoot, { Parents: [{ Id: OTHER_OU, Type: 'ORGANIZATIONAL_UNIT' }] }]],
      [MoveAccountCommand, [{}]]
    ]);
    await expect(ensureAccountPlacement(adapter, ACCOUNT_ID, TARGET_OU, ROOT_ID, options)).rejects.toThrow(
      new RegExp(`appeared under ${OTHER_OU}`)
    );
    expect(sentOf(MoveAccountCommand)).toHaveLength(1);
  });
});
