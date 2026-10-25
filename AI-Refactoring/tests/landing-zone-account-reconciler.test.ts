import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { LandingZoneAccountsConfig } from '../config/schemas/landing-zone-accounts-schema.js';
import {
  applyAccountPlan,
  assertAccountPlanReconciled,
  buildAccountPlan,
  buildLandingZoneAccountTags,
  ensureAccountPlacement,
  planConflicts,
  resolveOuPath,
  toDesiredLandingZoneAccounts,
  type AccountTag,
  type ApplyOptions,
  type CreateAccountRequestStatus,
  type DesiredLandingZoneAccount,
  type OrganizationsAccountPort,
  type ParentType
} from '../lib/organization/landing-zone-account-reconciler.js';
import { parseCliOptions } from '../scripts/provision-landing-zone-accounts.js';

const ROOT_ID = 'r-a1b2';
const OU_IDS = {
  Infrastructure: 'ou-a1b2-infra001',
  Workloads: 'ou-a1b2-wkld0001',
  'Workloads/Corp': 'ou-a1b2-corp0001',
  'Workloads/Corp/Non-Prod': 'ou-a1b2-corpnp01',
  'Workloads/Corp/Prod': 'ou-a1b2-corppr01'
} as const;

const OPTIONS: ApplyOptions = {
  pollIntervalMs: 0,
  createTimeoutMs: 1_000,
  activeTimeoutMs: 1_000,
  confirmPollIntervalMs: 0,
  confirmTimeoutMs: 1_000,
  sleep: async () => {}
};

function account(
  name: string,
  email: string,
  ouPath: string,
  owner = 'CCoE',
  costCentre = 'AISARCH'
): LandingZoneAccountsConfig[string] {
  return {
    name,
    email,
    ouPath: ouPath as LandingZoneAccountsConfig[string]['ouPath'],
    owner,
    costCentre,
    securityContact: 'FMITaws-cloud-org-002+SecurityContact@if.se',
    operationsContact: 'cloud@if.eu',
    tags: {
      environment: 'staging',
      lifecycle: 'active',
      dataClassification: 'internal',
      dataResidency: 'EU',
      domain: 'Cloud Application Platform'
    }
  };
}

const CONFIG: LandingZoneAccountsConfig = {
  sharedServices: account('SharedServices', 'FMITaws-cloud-org-002+SharedServices@if.se', 'Infrastructure'),
  network: account('Network', 'FMITaws-cloud-org-002+Network@if.se', 'Infrastructure', 'Connectivity', 'AISCCNO'),
  ccoeCorpVerificationNonProd01: account(
    'CcoeCorpVerification-NonProd-01',
    'FMITaws-cloud-org-002+CcoeCorpVerification-NonProd-01@if.se',
    'Workloads/Corp/Non-Prod'
  )
};

const DESIRED = toDesiredLandingZoneAccounts(CONFIG);

function desired(key: string): DesiredLandingZoneAccount {
  const entry = DESIRED.find((candidate) => candidate.key === key);
  if (entry === undefined) throw new Error(`no fixture ${key}`);
  return entry;
}

interface FakeAccount {
  id: string;
  name: string;
  email: string;
  state: string;
  parentId: string;
  tags: AccountTag[];
}

/** In-memory AWS Organizations. Records every call so tests can assert on mutations. */
class FakeOrganization implements OrganizationsAccountPort {
  readonly accounts: FakeAccount[] = [];
  readonly calls: string[] = [];
  readonly inProgress: CreateAccountRequestStatus[] = [];
  units: Array<{ id: string; name: string; parentId: string }> = [
    { id: OU_IDS.Infrastructure, name: 'Infrastructure', parentId: ROOT_ID },
    { id: OU_IDS.Workloads, name: 'Workloads', parentId: ROOT_ID },
    { id: OU_IDS['Workloads/Corp'], name: 'Corp', parentId: OU_IDS.Workloads },
    { id: OU_IDS['Workloads/Corp/Non-Prod'], name: 'Non-Prod', parentId: OU_IDS['Workloads/Corp'] },
    { id: OU_IDS['Workloads/Corp/Prod'], name: 'Prod', parentId: OU_IDS['Workloads/Corp'] }
  ];
  /** Number of IN_PROGRESS polls before a create request reports SUCCEEDED. */
  createPolls = 1;
  /** Names whose CreateAccount fails with this reason. */
  readonly failCreate = new Map<string, string>();
  /** Fail MoveAccount once for these account names. */
  readonly failMoveOnce = new Set<string>();
  /** Parent IDs that ListParents reports, in order, before it reports the real parent. */
  readonly scriptedParentReads = new Map<string, string[]>();
  private readonly requests = new Map<string, { name: string; accountId: string; polls: number; failure?: string }>();
  private nextId = 100000000001;

  seed(entry: DesiredLandingZoneAccount, overrides: Partial<FakeAccount> = {}): FakeAccount {
    const seeded: FakeAccount = {
      id: String(this.nextId++),
      name: entry.name,
      email: entry.email,
      state: 'ACTIVE',
      parentId: OU_IDS[entry.ouPath as keyof typeof OU_IDS],
      tags: [...entry.tags],
      ...overrides
    };
    this.accounts.push(seeded);
    return seeded;
  }

  count(prefix: string): number {
    return this.calls.filter((call) => call.startsWith(prefix)).length;
  }

  async listAccounts() {
    this.calls.push('listAccounts');
    return this.accounts.map(({ id, name, email, state }) => ({ id, name, email, state }));
  }
  async getRootId() {
    return ROOT_ID;
  }
  async listOrganizationalUnitsForParent(parentId: string) {
    return this.units.filter((unit) => unit.parentId === parentId).map(({ id, name }) => ({ id, name }));
  }
  async getParent(accountId: string) {
    const found = this.require(accountId);
    this.calls.push(`getParent:${found.name}`);
    const parentId = this.scriptedParentReads.get(accountId)?.shift() ?? found.parentId;
    const type: ParentType = parentId === ROOT_ID ? 'ROOT' : 'ORGANIZATIONAL_UNIT';
    return { id: parentId, type };
  }
  async listTags(accountId: string) {
    return [...this.require(accountId).tags];
  }
  async listInProgressCreateAccountRequests() {
    return [...this.inProgress];
  }
  async createAccount(request: { name: string; email: string; tags: readonly AccountTag[] }) {
    this.calls.push(`createAccount:${request.name}`);
    if (this.accounts.some((existing) => existing.email.toLowerCase() === request.email.toLowerCase())) {
      throw new Error(`DuplicateAccountException: email ${request.email} already exists`);
    }
    const requestId = `car-${this.requests.size + 1}`;
    const failure = this.failCreate.get(request.name);
    const accountId = String(this.nextId++);
    this.requests.set(requestId, {
      name: request.name,
      accountId,
      polls: this.createPolls,
      ...(failure ? { failure } : {})
    });
    if (failure === undefined) {
      // CreateAccount lands the account in the Root with the creation tags.
      this.accounts.push({
        id: accountId,
        name: request.name,
        email: request.email,
        state: 'PENDING_ACTIVATION',
        parentId: ROOT_ID,
        tags: [...request.tags]
      });
    }
    return requestId;
  }
  async describeCreateAccountStatus(requestId: string): Promise<CreateAccountRequestStatus> {
    const request = this.requests.get(requestId);
    if (request === undefined) throw new Error(`unknown request ${requestId}`);
    if (request.polls > 0) {
      request.polls -= 1;
      return { id: requestId, state: 'IN_PROGRESS', accountName: request.name };
    }
    if (request.failure !== undefined) {
      return { id: requestId, state: 'FAILED', accountName: request.name, failureReason: request.failure };
    }
    const created = this.require(request.accountId);
    created.state = 'ACTIVE';
    return { id: requestId, state: 'SUCCEEDED', accountName: request.name, accountId: request.accountId };
  }
  async describeAccount(accountId: string) {
    const { id, name, email, state } = this.require(accountId);
    return { id, name, email, state };
  }
  async moveAccount(accountId: string, sourceParentId: string, destinationParentId: string) {
    const found = this.require(accountId);
    this.calls.push(`moveAccount:${found.name}`);
    if (this.failMoveOnce.delete(found.name)) {
      throw new Error('Organizations MoveAccount failed after 12 attempts: ConcurrentModificationException');
    }
    if (found.parentId !== sourceParentId) throw new Error('SourceParentNotFoundException');
    found.parentId = destinationParentId;
  }
  async tagAccount(accountId: string, tags: readonly AccountTag[]) {
    const found = this.require(accountId);
    this.calls.push(`tagAccount:${found.name}`);
    for (const tag of tags) {
      found.tags = [...found.tags.filter((existing) => existing.key !== tag.key), tag];
    }
  }

  private require(accountId: string): FakeAccount {
    const found = this.accounts.find((candidate) => candidate.id === accountId);
    if (found === undefined) throw new Error(`AccountNotFoundException ${accountId}`);
    return found;
  }
}

async function provision(org: FakeOrganization) {
  const plan = await buildAccountPlan(org, DESIRED);
  const results = await applyAccountPlan(org, plan, OPTIONS);
  return { plan, results };
}

describe('account classification', () => {
  it('classifies an existing account with the same email and name as EXISTING_MATCH', async () => {
    const org = new FakeOrganization();
    const seeded = org.seed(desired('network'));
    const plan = await buildAccountPlan(org, DESIRED);
    const entry = plan.entries.find((candidate) => candidate.key === 'network');
    expect(entry).toMatchObject({ classification: 'EXISTING_MATCH', accountId: seeded.id, pendingActions: [] });
  });

  it('matches the email case-insensitively', async () => {
    const org = new FakeOrganization();
    org.seed(desired('network'), { email: desired('network').email.toLowerCase() });
    const plan = await buildAccountPlan(org, DESIRED);
    expect(plan.entries.find((entry) => entry.key === 'network')?.classification).toBe('EXISTING_MATCH');
  });

  it('classifies an account that does not exist as MISSING', async () => {
    const plan = await buildAccountPlan(new FakeOrganization(), DESIRED);
    expect(plan.entries.map((entry) => entry.classification)).toEqual(['MISSING', 'MISSING', 'MISSING']);
  });

  it('classifies an email that exists under a different name as CONFLICT', async () => {
    const org = new FakeOrganization();
    org.seed(desired('network'), { name: 'Network-Old' });
    const entry = (await buildAccountPlan(org, DESIRED)).entries.find((candidate) => candidate.key === 'network');
    expect(entry?.classification).toBe('CONFLICT');
    expect(entry?.reason).toMatch(/named 'Network-Old'/);
  });

  it('classifies a name that exists under a different email as CONFLICT', async () => {
    const org = new FakeOrganization();
    org.seed(desired('network'), { email: 'someone-else@if.se' });
    const entry = (await buildAccountPlan(org, DESIRED)).entries.find((candidate) => candidate.key === 'network');
    expect(entry?.classification).toBe('CONFLICT');
    expect(entry?.reason).toMatch(/different email/);
  });

  it('classifies an ambiguous name (matching email plus a second account with the name) as CONFLICT', async () => {
    const org = new FakeOrganization();
    org.seed(desired('network'));
    org.seed(desired('network'), { email: 'duplicate@if.se' });
    const entry = (await buildAccountPlan(org, DESIRED)).entries.find((candidate) => candidate.key === 'network');
    expect(entry?.classification).toBe('CONFLICT');
    expect(entry?.reason).toMatch(/ambiguous/);
  });

  it.each(['SUSPENDED', 'PENDING_CLOSURE', 'PENDING_ACTIVATION'])(
    'classifies a %s account as CONFLICT',
    async (state) => {
      const org = new FakeOrganization();
      org.seed(desired('network'), { state });
      const entry = (await buildAccountPlan(org, DESIRED)).entries.find((candidate) => candidate.key === 'network');
      expect(entry?.classification).toBe('CONFLICT');
      expect(entry?.reason).toContain(state);
    }
  );

  it('classifies an account under a different OU as CONFLICT and never moves it', async () => {
    const org = new FakeOrganization();
    org.seed(desired('ccoeCorpVerificationNonProd01'), { parentId: OU_IDS['Workloads/Corp/Prod'] });
    const plan = await buildAccountPlan(org, DESIRED);
    expect(plan.entries.find((entry) => entry.key === 'ccoeCorpVerificationNonProd01')?.classification).toBe(
      'CONFLICT'
    );
    await expect(applyAccountPlan(org, plan, OPTIONS)).rejects.toThrow(/CONFLICT/);
    expect(org.count('moveAccount')).toBe(0);
    expect(org.count('createAccount')).toBe(0);
  });

  it('classifies an account with a CreateAccount request still IN_PROGRESS as CONFLICT', async () => {
    const org = new FakeOrganization();
    org.inProgress.push({ id: 'car-9', state: 'IN_PROGRESS', accountName: 'Network' });
    const entry = (await buildAccountPlan(org, DESIRED)).entries.find((candidate) => candidate.key === 'network');
    expect(entry?.classification).toBe('CONFLICT');
  });

  it('reports drifted or missing P1 tags as a pending action on an EXISTING_MATCH', async () => {
    const org = new FakeOrganization();
    org.seed(desired('network'), { tags: desired('network').tags.filter((tag) => tag.key !== 'domain') });
    const entry = (await buildAccountPlan(org, DESIRED)).entries.find((candidate) => candidate.key === 'network');
    expect(entry).toMatchObject({ classification: 'EXISTING_MATCH', pendingActions: ['APPLY_TAGS'] });
    expect(entry?.tagsToApply.map((tag) => tag.key)).toEqual(['domain']);
  });

  it('plans every account before any mutation, and performs no mutation while planning', async () => {
    const org = new FakeOrganization();
    org.seed(desired('network'), { name: 'Wrong' });
    const plan = await buildAccountPlan(org, DESIRED);
    expect(plan.entries.map((entry) => entry.key)).toEqual([
      'ccoeCorpVerificationNonProd01',
      'network',
      'sharedServices'
    ]);
    expect(planConflicts(plan).map((entry) => entry.key)).toEqual(['network']);
    expect(org.calls.filter((call) => call !== 'listAccounts')).toEqual([]);
  });
});

describe('provisioning', () => {
  it('makes no CreateAccount call for accounts that already exist', async () => {
    const org = new FakeOrganization();
    for (const entry of DESIRED) org.seed(entry);
    const { results } = await provision(org);
    expect(org.count('createAccount')).toBe(0);
    expect(results.every((result) => result.outcome === 'REUSED')).toBe(true);
  });

  it('makes exactly one CreateAccount call for one missing account and places and tags it', async () => {
    const org = new FakeOrganization();
    org.seed(desired('network'));
    org.seed(desired('sharedServices'));
    const { results } = await provision(org);
    expect(org.calls.filter((call) => call.startsWith('createAccount'))).toEqual([
      'createAccount:CcoeCorpVerification-NonProd-01'
    ]);
    const created = org.accounts.find((candidate) => candidate.name === 'CcoeCorpVerification-NonProd-01');
    expect(created).toMatchObject({ state: 'ACTIVE', parentId: OU_IDS['Workloads/Corp/Non-Prod'] });
    expect(created?.tags).toEqual(desired('ccoeCorpVerificationNonProd01').tags);
    expect(results.find((result) => result.key === 'ccoeCorpVerificationNonProd01')).toMatchObject({
      outcome: 'CREATED',
      accountId: created?.id
    });
  });

  it('handles a mix of existing and missing accounts in configuration-key order', async () => {
    const org = new FakeOrganization();
    org.seed(desired('network'));
    const { results } = await provision(org);
    expect(org.calls.filter((call) => call.startsWith('createAccount'))).toEqual([
      'createAccount:CcoeCorpVerification-NonProd-01',
      'createAccount:SharedServices'
    ]);
    expect(results.map((result) => [result.key, result.outcome])).toEqual([
      ['ccoeCorpVerificationNonProd01', 'CREATED'],
      ['network', 'REUSED'],
      ['sharedServices', 'CREATED']
    ]);
  });

  it('returns 12-digit IDs for both existing and newly created accounts', async () => {
    const org = new FakeOrganization();
    const existing = org.seed(desired('network'));
    await provision(org);
    const ids = assertAccountPlanReconciled(await buildAccountPlan(org, DESIRED));
    expect(ids.map((id) => id.key)).toEqual(['ccoeCorpVerificationNonProd01', 'network', 'sharedServices']);
    expect(ids.every((id) => /^[0-9]{12}$/.test(id.accountId))).toBe(true);
    expect(ids.find((id) => id.key === 'network')?.accountId).toBe(existing.id);
  });

  it('stops on the first failure and creates nothing after it', async () => {
    const org = new FakeOrganization();
    org.failCreate.set('CcoeCorpVerification-NonProd-01', 'EMAIL_ALREADY_EXISTS');
    const plan = await buildAccountPlan(org, DESIRED);
    await expect(applyAccountPlan(org, plan, OPTIONS)).rejects.toThrow(
      /stopped at 'ccoeCorpVerificationNonProd01'.*EMAIL_ALREADY_EXISTS/
    );
    expect(org.count('createAccount')).toBe(1);
  });

  it('resumes after a partial failure without a second CreateAccount for already-created accounts', async () => {
    const org = new FakeOrganization();
    // First run: the first account is created but MoveAccount fails, so it is left in the Root.
    org.failMoveOnce.add('CcoeCorpVerification-NonProd-01');
    await expect(provision(org)).rejects.toThrow(/ConcurrentModificationException/);
    expect(org.count('createAccount')).toBe(1);
    const stranded = org.accounts.find((candidate) => candidate.name === 'CcoeCorpVerification-NonProd-01');
    expect(stranded?.parentId).toBe(ROOT_ID);

    // Rerun: the stranded account is an EXISTING_MATCH that only needs placement.
    const plan = await buildAccountPlan(org, DESIRED);
    expect(plan.entries.find((entry) => entry.key === 'ccoeCorpVerificationNonProd01')).toMatchObject({
      classification: 'EXISTING_MATCH',
      accountId: stranded?.id,
      pendingActions: ['PLACE_FROM_ROOT']
    });
    const results = await applyAccountPlan(org, plan, OPTIONS);

    expect(org.calls.filter((call) => call.startsWith('createAccount'))).toEqual([
      'createAccount:CcoeCorpVerification-NonProd-01',
      'createAccount:Network',
      'createAccount:SharedServices'
    ]);
    expect(results.find((result) => result.key === 'ccoeCorpVerificationNonProd01')?.outcome).toBe('REUSED');
    expect(stranded?.parentId).toBe(OU_IDS['Workloads/Corp/Non-Prod']);
  });

  it('is a no-op on a rerun after success: no duplicate CreateAccount and no AlreadyExists error', async () => {
    const org = new FakeOrganization();
    await provision(org);
    const createsAfterFirstRun = org.count('createAccount');
    await provision(org);
    await provision(org);
    expect(createsAfterFirstRun).toBe(3);
    expect(org.count('createAccount')).toBe(3);
    expect(org.count('moveAccount')).toBe(3);
    expect(org.count('tagAccount')).toBe(0);
  });

  it('completes drifted tags on an existing account without recreating it', async () => {
    const org = new FakeOrganization();
    for (const entry of DESIRED) org.seed(entry);
    const network = org.accounts.find((candidate) => candidate.name === 'Network') as FakeAccount;
    network.tags = network.tags.map((tag) =>
      tag.key === 'lifecycle' ? { key: 'lifecycle', value: 'deprecated' } : tag
    );
    await provision(org);
    expect(org.count('createAccount')).toBe(0);
    expect(network.tags.find((tag) => tag.key === 'lifecycle')?.value).toBe('active');
  });

  it('fails when CreateAccount reports a terminal FAILED state', async () => {
    const org = new FakeOrganization();
    org.failCreate.set('CcoeCorpVerification-NonProd-01', 'INVALID_EMAIL');
    await expect(provision(org)).rejects.toThrow(/FAILED: INVALID_EMAIL/);
  });

  it('times out instead of polling forever', async () => {
    const org = new FakeOrganization();
    org.createPolls = Number.MAX_SAFE_INTEGER;
    let clock = 0;
    const plan = await buildAccountPlan(org, DESIRED);
    await expect(
      applyAccountPlan(org, plan, { ...OPTIONS, now: () => clock, sleep: async () => void (clock += 600) })
    ).rejects.toThrow(/Timed out/);
    expect(org.count('createAccount')).toBe(1);
  });

  it('resumes after a quota failure: run 2 reuses every account run 1 discovered or created', async () => {
    // Run 1: the first account exists, the second is created, the third fails on quota.
    const org = new FakeOrganization();
    const existing = org.seed(desired('ccoeCorpVerificationNonProd01'));
    org.failCreate.set('SharedServices', 'ACCOUNT_LIMIT_EXCEEDED');
    await expect(provision(org)).rejects.toThrow(/stopped at 'sharedServices'.*ACCOUNT_LIMIT_EXCEEDED/);
    const createdInRun1 = org.accounts.find((candidate) => candidate.name === 'Network');
    expect(createdInRun1).toBeDefined();

    // Run 2: the quota is raised. Discovered and earlier-created accounts are reused; only the
    // missing account is created, and no CreateAccount hits an existing email.
    org.failCreate.clear();
    const { results } = await provision(org);
    expect(results.map((result) => [result.key, result.outcome, result.accountId])).toEqual([
      ['ccoeCorpVerificationNonProd01', 'REUSED', existing.id],
      ['network', 'REUSED', createdInRun1?.id],
      ['sharedServices', 'CREATED', org.accounts.find((candidate) => candidate.name === 'SharedServices')?.id]
    ]);
    expect(org.calls.filter((call) => call.startsWith('createAccount'))).toEqual([
      'createAccount:Network',
      'createAccount:SharedServices',
      'createAccount:SharedServices'
    ]);

    // Downstream sees one ID per configured account, regardless of how it was obtained.
    const ids = assertAccountPlanReconciled(await buildAccountPlan(org, DESIRED));
    expect(ids.map((id) => id.accountId)).toEqual(results.map((result) => result.accountId));
  });
});

describe('OU placement after MoveAccount', () => {
  const target = OU_IDS['Workloads/Corp/Non-Prod'];

  function strandedInRoot(): { org: FakeOrganization; accountId: string } {
    const org = new FakeOrganization();
    const stranded = org.seed(desired('ccoeCorpVerificationNonProd01'), { parentId: ROOT_ID });
    return { org, accountId: stranded.id };
  }

  it('A: keeps polling while ListParents still reports the Root, then succeeds', async () => {
    const { org, accountId } = strandedInRoot();
    org.scriptedParentReads.set(accountId, [ROOT_ID, ROOT_ID, ROOT_ID]);
    const sleeps: number[] = [];
    await ensureAccountPlacement(org, accountId, target, ROOT_ID, {
      ...OPTIONS,
      confirmPollIntervalMs: 5_000,
      sleep: async (milliseconds) => void sleeps.push(milliseconds)
    });
    // The pre-move read consumes the first scripted Root; two stale reads follow, then the OU.
    expect(org.count('moveAccount')).toBe(1);
    expect(org.count('getParent')).toBe(4);
    expect(sleeps).toEqual([5_000, 5_000]);
  });

  it('B: succeeds on the first read when the move has already propagated', async () => {
    const { org, accountId } = strandedInRoot();
    await ensureAccountPlacement(org, accountId, target, ROOT_ID, OPTIONS);
    expect(org.count('moveAccount')).toBe(1);
    expect(org.count('getParent')).toBe(2);
  });

  it('C: fails after the bound with a diagnostic when the Root is still reported', async () => {
    const { org, accountId } = strandedInRoot();
    org.scriptedParentReads.set(accountId, Array<string>(100).fill(ROOT_ID));
    let clock = 0;
    await expect(
      ensureAccountPlacement(org, accountId, target, ROOT_ID, {
        ...OPTIONS,
        confirmPollIntervalMs: 5_000,
        confirmTimeoutMs: 20_000,
        now: () => clock,
        sleep: async (milliseconds) => void (clock += milliseconds)
      })
    ).rejects.toThrow(
      new RegExp(
        `Timed out after 20000 ms and 5 reads waiting for account ${accountId}.*last observed: parent ${ROOT_ID}`
      )
    );
    expect(org.count('moveAccount')).toBe(1);
  });

  it('D: fails immediately when the account appears under a different OU, and never moves it again', async () => {
    const { org, accountId } = strandedInRoot();
    org.scriptedParentReads.set(accountId, [ROOT_ID, OU_IDS['Workloads/Corp/Prod']]);
    await expect(ensureAccountPlacement(org, accountId, target, ROOT_ID, OPTIONS)).rejects.toThrow(
      new RegExp(`appeared under ${OU_IDS['Workloads/Corp/Prod']} after MoveAccount`)
    );
    expect(org.count('moveAccount')).toBe(1);
    expect(org.count('getParent')).toBe(2);
  });

  it('refuses to move an account that is under another OU before any move', async () => {
    const org = new FakeOrganization();
    const elsewhere = org.seed(desired('ccoeCorpVerificationNonProd01'), { parentId: OU_IDS['Workloads/Corp/Prod'] });
    await expect(ensureAccountPlacement(org, elsewhere.id, target, ROOT_ID, OPTIONS)).rejects.toThrow(
      /refusing to move it/
    );
    expect(org.count('moveAccount')).toBe(0);
  });

  it('confirms drifted tags by polling until the corrected values are read back', async () => {
    const org = new FakeOrganization();
    for (const entry of DESIRED) org.seed(entry);
    const network = org.accounts.find((candidate) => candidate.name === 'Network') as FakeAccount;
    network.tags = network.tags.filter((tag) => tag.key !== 'domain');
    // Network reads: plan, pre-tag check, then a stale read after TagResource, then the fix.
    const realListTags = org.listTags.bind(org);
    let networkReads = 0;
    org.listTags = async (accountId: string) => {
      const tags = await realListTags(accountId);
      if (accountId !== network.id) return tags;
      networkReads += 1;
      return networkReads === 3 ? tags.filter((tag) => tag.key !== 'domain') : tags;
    };
    await provision(org);
    expect(org.count('tagAccount')).toBe(1);
    expect(networkReads).toBe(4);
    expect(network.tags.find((tag) => tag.key === 'domain')?.value).toBe('Cloud Application Platform');
  });
});

describe('OU path resolution', () => {
  it('resolves a nested path one segment at a time from the Root', async () => {
    await expect(resolveOuPath(new FakeOrganization(), ROOT_ID, 'Workloads/Corp/Non-Prod')).resolves.toBe(
      OU_IDS['Workloads/Corp/Non-Prod']
    );
  });

  it('fails when a segment is missing', async () => {
    await expect(resolveOuPath(new FakeOrganization(), ROOT_ID, 'Workloads/Online/Prod')).rejects.toThrow(
      /no OU named 'Online'/
    );
  });

  it('fails when a segment is ambiguous', async () => {
    const org = new FakeOrganization();
    org.units.push({ id: 'ou-a1b2-corp0002', name: 'Corp', parentId: OU_IDS.Workloads });
    await expect(resolveOuPath(org, ROOT_ID, 'Workloads/Corp/Non-Prod')).rejects.toThrow(/2 OUs named 'Corp'/);
  });

  it('fails the whole plan before classification when an OU path cannot be resolved', async () => {
    const org = new FakeOrganization();
    org.units = org.units.filter((unit) => unit.name !== 'Non-Prod');
    await expect(buildAccountPlan(org, DESIRED)).rejects.toThrow(/no OU named 'Non-Prod'/);
    expect(org.count('listAccounts')).toBe(0);
  });
});

describe('configuration mapping', () => {
  it('orders accounts by key and builds the eight P1 tags from the approved mappings', () => {
    expect(DESIRED.map((entry) => entry.key)).toEqual(['ccoeCorpVerificationNonProd01', 'network', 'sharedServices']);
    expect(buildLandingZoneAccountTags(CONFIG.network as LandingZoneAccountsConfig[string])).toEqual([
      { key: 'owner', value: 'Connectivity' },
      { key: 'owner-email', value: 'FMITaws-cloud-org-002+Network@if.se' },
      { key: 'environment', value: 'staging' },
      { key: 'lifecycle', value: 'active' },
      { key: 'data-classification', value: 'internal' },
      { key: 'data-residency', value: 'EU' },
      { key: 'itsystemcode', value: 'AISCCNO' },
      { key: 'domain', value: 'Cloud Application Platform' }
    ]);
  });

  it('parses the CLI modes and rejects unknown input', () => {
    expect(parseCliOptions(['plan', '--environment', 'staging', '--region=eusc-de-east-1'])).toEqual({
      mode: 'plan',
      environment: 'staging',
      region: 'eusc-de-east-1'
    });
    expect(() => parseCliOptions(['deploy', '--environment', 'staging', '--region', 'eusc-de-east-1'])).toThrow();
    expect(() => parseCliOptions(['apply', '--environment', 'dev', '--region', 'eusc-de-east-1'])).toThrow();
    expect(() => parseCliOptions(['apply', '--environment', 'staging', '--force'])).toThrow(/Unknown argument/);
  });
});

describe('source governance', () => {
  const sources = [
    'lib/organization/landing-zone-account-reconciler.ts',
    'lib/organization/organizations-account-adapter.ts',
    'scripts/provision-landing-zone-accounts.ts',
    '.github/actions/deploy-landing-zone-accounts/action.yml'
  ].map((path) => readFileSync(path, 'utf8'));

  it('contains no account-specific special case', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/CcoeCorpVerification|ccoeCorpVerification/);
    }
  });

  it('couples nothing through CloudFormation exports or ImportValue', () => {
    for (const source of sources) {
      expect(source).not.toMatch(/ImportValue|exportName|Fn::Export/);
    }
  });
});
