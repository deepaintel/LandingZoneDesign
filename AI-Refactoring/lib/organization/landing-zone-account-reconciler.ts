/**
 * Idempotent runtime reconciliation of the remaining Landing Zone accounts (SharedServices,
 * Network, and the Staging CCoE Verification accounts) against AWS Organizations.
 *
 * Governance: `.apm/skills/generate-account/SKILL.md`. The `deploy-landing-zone-accounts` composite action
 * is the single owner of these accounts. Configuration is the desired state; the live
 * Organization is the source of every Account ID and OU ID. Every run discovers and reuses what
 * already exists and creates only what is missing, so a run that stops after creating some
 * accounts resumes on the next run without a second `CreateAccount` for them. Callers receive
 * the same Account ID whether an account was discovered or created.
 *
 * Three phases, all driven through the `OrganizationsAccountPort` so the logic is testable
 * without AWS. The port's production adapter handles API throttling and transient errors; this
 * module sees only successful, validated responses:
 *
 *  1. `buildAccountPlan` (read-only). Resolves every configured OU path from the Root and
 *     classifies every configured account. The account email is the reconciliation key; the
 *     name is verified second.
 *       EXISTING_MATCH  email found, exact name, ACTIVE, parent is the configured OU (or the
 *                       Organization Root, where `CreateAccount` leaves an account whose
 *                       placement was interrupted). Reused; never created again.
 *       MISSING         neither the email nor the name exists. The only class that may call
 *                       `CreateAccount`.
 *       CONFLICT        email exists under another name, name exists under another email,
 *                       ambiguous identity, non-ACTIVE state, parent in a different OU, or a
 *                       `CreateAccount` request for the name still IN_PROGRESS. Nothing is
 *                       renamed, re-addressed, or moved out of another OU automatically.
 *  2. `applyAccountPlan`. Refuses to run when any entry is CONFLICT, then works through the
 *     plan one account at a time in configuration-key order and stops on the first failure:
 *     MISSING accounts are created (CreateAccount -> DescribeCreateAccountStatus until SUCCEEDED
 *     -> DescribeAccount until ACTIVE -> name/email check -> placement -> tags); EXISTING_MATCH
 *     accounts only complete outstanding placement and tags. AWS Organizations is eventually
 *     consistent, so a move and a tag write are each confirmed by bounded polling
 *     (`waitForAccountParent`, `ensureAccountTags`) until the expected state is observed.
 *  3. `assertAccountPlanReconciled`. A fresh plan after apply must show every account as an
 *     EXISTING_MATCH in its configured OU with its P1 tags in place. Returns the account IDs.
 */

import type {
  LandingZoneAccountConfig,
  LandingZoneAccountsConfig
} from '../../config/schemas/landing-zone-accounts-schema.js';

export const ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
export const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
export const ROOT_ID_PATTERN = /^r-[0-9a-z]{4,32}$/;

export type AccountClassification = 'EXISTING_MATCH' | 'MISSING' | 'CONFLICT';
export type PendingAccountAction = 'PLACE_FROM_ROOT' | 'APPLY_TAGS';
export type ParentType = 'ROOT' | 'ORGANIZATIONAL_UNIT';
export type CreateAccountState = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';

export interface AccountTag {
  readonly key: string;
  readonly value: string;
}

/** One configured account, in the shape the reconciler needs. */
export interface DesiredLandingZoneAccount {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  readonly ouPath: string;
  readonly tags: readonly AccountTag[];
}

export interface OrganizationAccount {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** Account `State` (`Status` on older responses), for example ACTIVE or SUSPENDED. */
  readonly state: string;
}

export interface OrganizationParent {
  readonly id: string;
  readonly type: ParentType;
}

export interface OrganizationalUnitSummary {
  readonly id: string;
  readonly name: string;
}

export interface CreateAccountRequestStatus {
  readonly id: string;
  readonly state: CreateAccountState;
  readonly accountName?: string;
  readonly accountId?: string;
  readonly failureReason?: string;
}

/** The AWS Organizations operations the reconciler uses. Implemented over SDK v3 in production. */
export interface OrganizationsAccountPort {
  listAccounts(): Promise<readonly OrganizationAccount[]>;
  /** The single Organization Root. */
  getRootId(): Promise<string>;
  listOrganizationalUnitsForParent(parentId: string): Promise<readonly OrganizationalUnitSummary[]>;
  /** The single parent (Root or OU) of an account. */
  getParent(accountId: string): Promise<OrganizationParent>;
  listTags(accountId: string): Promise<readonly AccountTag[]>;
  listInProgressCreateAccountRequests(): Promise<readonly CreateAccountRequestStatus[]>;
  createAccount(request: { name: string; email: string; tags: readonly AccountTag[] }): Promise<string>;
  describeCreateAccountStatus(requestId: string): Promise<CreateAccountRequestStatus>;
  describeAccount(accountId: string): Promise<OrganizationAccount>;
  moveAccount(accountId: string, sourceParentId: string, destinationParentId: string): Promise<void>;
  tagAccount(accountId: string, tags: readonly AccountTag[]): Promise<void>;
}

export interface AccountPlanEntry {
  readonly key: string;
  readonly name: string;
  readonly email: string;
  readonly ouPath: string;
  readonly targetOuId: string;
  readonly classification: AccountClassification;
  readonly accountId?: string;
  readonly state?: string;
  readonly currentParentId?: string;
  readonly currentParentType?: ParentType;
  readonly pendingActions: readonly PendingAccountAction[];
  /** Configured tags whose key is missing or whose value differs on the existing account. */
  readonly tagsToApply: readonly AccountTag[];
  readonly reason?: string;
  readonly desired: DesiredLandingZoneAccount;
}

export interface AccountPlan {
  readonly rootId: string;
  readonly entries: readonly AccountPlanEntry[];
}

export interface ProvisionedAccount {
  readonly key: string;
  readonly name: string;
  readonly accountId: string;
  readonly outcome: 'CREATED' | 'REUSED';
}

export interface ApplyOptions {
  /** Interval between DescribeCreateAccountStatus / DescribeAccount polls for a new account. */
  readonly pollIntervalMs: number;
  readonly createTimeoutMs: number;
  readonly activeTimeoutMs: number;
  /** Interval between ListParents / ListTagsForResource reads that confirm a write. */
  readonly confirmPollIntervalMs: number;
  /** Bound on confirming one placement or one tag write. */
  readonly confirmTimeoutMs: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
  readonly log?: (message: string) => void;
}

/**
 * Returns the configured accounts ordered by configuration key using plain code-unit
 * comparison (not `localeCompare`, whose collation depends on the runtime locale). This order
 * drives sequential creation, so it must be identical on every machine.
 */
export function sortLandingZoneAccountEntries(
  accounts: LandingZoneAccountsConfig
): Array<[string, LandingZoneAccountConfig]> {
  return Object.entries(accounts).sort(([leftKey], [rightKey]) =>
    leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  );
}

/**
 * Builds the P1 tag list for an account per
 * `landing-zone-account-provisioning.instructions.md` §6 and §9. `owner`, `owner-email`, and
 * `itsystemcode` come from the account's `owner`, `email`, and `costCentre` (workbook mapping);
 * the remaining five values come from the account's validated `tags` block.
 */
export function buildLandingZoneAccountTags(entry: LandingZoneAccountConfig): AccountTag[] {
  return [
    { key: 'owner', value: entry.owner },
    { key: 'owner-email', value: entry.email },
    { key: 'environment', value: entry.tags.environment },
    { key: 'lifecycle', value: entry.tags.lifecycle },
    { key: 'data-classification', value: entry.tags.dataClassification },
    { key: 'data-residency', value: entry.tags.dataResidency },
    { key: 'itsystemcode', value: entry.costCentre },
    { key: 'domain', value: entry.tags.domain }
  ];
}

export function toDesiredLandingZoneAccounts(accounts: LandingZoneAccountsConfig): DesiredLandingZoneAccount[] {
  return sortLandingZoneAccountEntries(accounts).map(([key, entry]) => ({
    key,
    name: entry.name,
    email: entry.email,
    ouPath: entry.ouPath,
    tags: buildLandingZoneAccountTags(entry)
  }));
}

/** AWS Organizations treats account email addresses case-insensitively. */
function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Resolves a slash-delimited OU path (for example `Workloads/Corp/Non-Prod`) by walking down
 * from the Root, one segment at a time. Each segment must match exactly one child OU by name;
 * a missing or ambiguous segment fails. OU IDs are never cached outside the current run.
 */
export async function resolveOuPath(
  port: OrganizationsAccountPort,
  rootId: string,
  ouPath: string,
  cache: Map<string, string> = new Map()
): Promise<string> {
  const segments = ouPath.split('/').map((segment) => segment.trim());
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw new Error(`OU path '${ouPath}' is empty or contains an empty segment.`);
  }

  let parentId = rootId;
  let walked = '';
  for (const segment of segments) {
    walked = walked.length === 0 ? segment : `${walked}/${segment}`;
    const cached = cache.get(walked);
    if (cached !== undefined) {
      parentId = cached;
      continue;
    }
    const children = await port.listOrganizationalUnitsForParent(parentId);
    const matches = children.filter((child) => child.name === segment);
    if (matches.length === 0) {
      throw new Error(`OU path '${ouPath}': no OU named '${segment}' under parent ${parentId}.`);
    }
    if (matches.length > 1) {
      throw new Error(
        `OU path '${ouPath}': ${matches.length} OUs named '${segment}' under parent ${parentId}; refusing to guess.`
      );
    }
    const ouId = (matches[0] as OrganizationalUnitSummary).id;
    cache.set(walked, ouId);
    parentId = ouId;
  }
  return parentId;
}

function diffTags(desired: readonly AccountTag[], actual: readonly AccountTag[]): AccountTag[] {
  const actualByKey = new Map(actual.map((tag) => [tag.key, tag.value]));
  return desired.filter((tag) => actualByKey.get(tag.key) !== tag.value);
}

function conflict(
  base: Omit<AccountPlanEntry, 'classification' | 'pendingActions' | 'tagsToApply' | 'reason'>,
  reason: string
): AccountPlanEntry {
  return { ...base, classification: 'CONFLICT', pendingActions: [], tagsToApply: [], reason };
}

/**
 * Read-only plan. Lists the Organization once, resolves every configured OU path, and
 * classifies every configured account. Makes no mutating call.
 */
export async function buildAccountPlan(
  port: OrganizationsAccountPort,
  desiredAccounts: readonly DesiredLandingZoneAccount[]
): Promise<AccountPlan> {
  const rootId = await port.getRootId();

  const ouCache = new Map<string, string>();
  const targetOuIds = new Map<string, string>();
  for (const desired of desiredAccounts) {
    if (!targetOuIds.has(desired.ouPath)) {
      targetOuIds.set(desired.ouPath, await resolveOuPath(port, rootId, desired.ouPath, ouCache));
    }
  }

  const accounts = await port.listAccounts();
  const inProgress = await port.listInProgressCreateAccountRequests();

  const entries: AccountPlanEntry[] = [];
  for (const desired of desiredAccounts) {
    const targetOuId = targetOuIds.get(desired.ouPath) as string;
    const base = {
      key: desired.key,
      name: desired.name,
      email: desired.email,
      ouPath: desired.ouPath,
      targetOuId,
      desired
    };

    const byEmail = accounts.filter((account) => emailKey(account.email) === emailKey(desired.email));
    const byName = accounts.filter((account) => account.name === desired.name);
    const pendingRequest = inProgress.find((request) => request.accountName === desired.name);

    if (pendingRequest !== undefined) {
      entries.push(
        conflict(
          base,
          `CreateAccount request ${pendingRequest.id} for '${desired.name}' is still IN_PROGRESS; rerun after it completes.`
        )
      );
      continue;
    }

    if (byEmail.length > 1) {
      entries.push(conflict(base, `${byEmail.length} accounts share the email ${desired.email}.`));
      continue;
    }

    if (byEmail.length === 0) {
      if (byName.length > 0) {
        const others = byName.map((account) => `${account.id} <${account.email}>`).join(', ');
        entries.push(conflict(base, `An account named '${desired.name}' exists with a different email: ${others}.`));
      } else {
        entries.push({ ...base, classification: 'MISSING', pendingActions: [], tagsToApply: [] });
      }
      continue;
    }

    const account = byEmail[0] as OrganizationAccount;
    const found = { ...base, accountId: account.id, state: account.state };
    if (account.name !== desired.name) {
      entries.push(conflict(found, `Email ${desired.email} belongs to account ${account.id} named '${account.name}'.`));
      continue;
    }
    const sameNameOthers = byName.filter((other) => other.id !== account.id);
    if (sameNameOthers.length > 0) {
      const others = sameNameOthers.map((other) => other.id).join(', ');
      entries.push(
        conflict(found, `The name '${desired.name}' is also used by account(s) ${others}; identity is ambiguous.`)
      );
      continue;
    }
    if (account.state !== 'ACTIVE') {
      entries.push(conflict(found, `Account ${account.id} is in state '${account.state}', not ACTIVE.`));
      continue;
    }

    const parent = await port.getParent(account.id);
    const placed = { ...found, currentParentId: parent.id, currentParentType: parent.type };

    const pendingActions: PendingAccountAction[] = [];
    if (parent.id !== targetOuId) {
      if (parent.type === 'ROOT' && parent.id === rootId) {
        // `CreateAccount` places a new account in the Root. Finding it there means an earlier
        // run stopped between creation and placement; the move completes that run.
        pendingActions.push('PLACE_FROM_ROOT');
      } else {
        entries.push(
          conflict(
            placed,
            `Account ${account.id} is under ${parent.id}, not the configured '${desired.ouPath}' OU ${targetOuId}. ` +
              'Accounts are never moved out of another OU automatically.'
          )
        );
        continue;
      }
    }

    const tagsToApply = diffTags(desired.tags, await port.listTags(account.id));
    if (tagsToApply.length > 0) {
      pendingActions.push('APPLY_TAGS');
    }
    entries.push({ ...placed, classification: 'EXISTING_MATCH', pendingActions, tagsToApply });
  }

  return { rootId, entries };
}

export function planConflicts(plan: AccountPlan): AccountPlanEntry[] {
  return plan.entries.filter((entry) => entry.classification === 'CONFLICT');
}

interface PollBounds {
  readonly intervalMs: number;
  readonly timeoutMs: number;
}

/**
 * Bounded polling for state that a successful AWS call has not propagated yet. `probe` returns
 * a value when the expected state is observed, `undefined` to keep waiting, or throws to fail
 * immediately. API throttling never reaches this loop: the adapter retries it.
 */
async function pollUntil<T>(
  description: string,
  probe: () => Promise<T | undefined>,
  bounds: PollBounds,
  options: ApplyOptions,
  lastObserved: () => string = () => 'no result'
): Promise<T> {
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const deadline = now() + bounds.timeoutMs;
  for (let attempt = 1; ; attempt += 1) {
    const value = await probe();
    if (value !== undefined) {
      return value;
    }
    if (now() >= deadline) {
      throw new Error(
        `Timed out after ${bounds.timeoutMs} ms and ${attempt} reads waiting for ${description}; last observed: ${lastObserved()}.`
      );
    }
    await sleep(bounds.intervalMs);
  }
}

function confirmBounds(options: ApplyOptions): PollBounds {
  return { intervalMs: options.confirmPollIntervalMs, timeoutMs: options.confirmTimeoutMs };
}

/**
 * Confirms that an account moved from the Root has reached its destination OU. Reading the Root
 * again means the move has not propagated yet, so polling continues. Any other parent fails
 * immediately: the account is somewhere it was never sent, and it is not moved again.
 */
export async function waitForAccountParent(
  port: OrganizationsAccountPort,
  accountId: string,
  expectedOuId: string,
  rootId: string,
  options: ApplyOptions
): Promise<void> {
  let observed = rootId;
  await pollUntil(
    `account ${accountId} to appear under ${expectedOuId} after MoveAccount`,
    async () => {
      const parent = await port.getParent(accountId);
      observed = parent.id;
      if (parent.id === expectedOuId) {
        return parent;
      }
      if (parent.id === rootId) {
        return undefined;
      }
      throw new Error(
        `Account ${accountId} appeared under ${parent.id} after MoveAccount to ${expectedOuId}; refusing to continue.`
      );
    },
    confirmBounds(options),
    options,
    () => `parent ${observed}`
  );
}

/**
 * Places an account under its configured OU. An account already there is left alone. An account
 * in the Root (an interrupted creation) is moved once, then confirmed by `waitForAccountParent`.
 * An account under any other parent is refused.
 */
export async function ensureAccountPlacement(
  port: OrganizationsAccountPort,
  accountId: string,
  targetOuId: string,
  rootId: string,
  options: ApplyOptions
): Promise<void> {
  const parent = await port.getParent(accountId);
  if (parent.id === targetOuId) {
    return;
  }
  if (parent.id !== rootId) {
    throw new Error(`Account ${accountId} is under ${parent.id}; refusing to move it to ${targetOuId}.`);
  }
  await port.moveAccount(accountId, rootId, targetOuId);
  await waitForAccountParent(port, accountId, targetOuId, rootId, options);
}

/**
 * Adds missing configured tags and corrects drifted values, then confirms them by bounded
 * polling. Tags that are not configured are left untouched.
 */
export async function ensureAccountTags(
  port: OrganizationsAccountPort,
  accountId: string,
  desired: readonly AccountTag[],
  options: ApplyOptions
): Promise<void> {
  const missing = diffTags(desired, await port.listTags(accountId));
  if (missing.length === 0) {
    return;
  }
  await port.tagAccount(accountId, missing);
  let remaining = missing;
  await pollUntil(
    `tags on account ${accountId}`,
    async () => {
      remaining = diffTags(desired, await port.listTags(accountId));
      return remaining.length === 0 ? true : undefined;
    },
    confirmBounds(options),
    options,
    () => `missing ${remaining.map((tag) => tag.key).join(', ')}`
  );
}

async function createMissingAccount(
  port: OrganizationsAccountPort,
  entry: AccountPlanEntry,
  rootId: string,
  options: ApplyOptions
): Promise<string> {
  const log = options.log ?? (() => undefined);
  const requestId = await port.createAccount({ name: entry.name, email: entry.email, tags: entry.desired.tags });
  log(`${entry.key}: CreateAccount request ${requestId} submitted.`);

  const status = await pollUntil(
    `CreateAccount request ${requestId}`,
    async () => {
      const current = await port.describeCreateAccountStatus(requestId);
      return current.state === 'IN_PROGRESS' ? undefined : current;
    },
    { intervalMs: options.pollIntervalMs, timeoutMs: options.createTimeoutMs },
    options
  );
  if (status.state !== 'SUCCEEDED') {
    throw new Error(
      `CreateAccount request ${requestId} for '${entry.name}' ended ${status.state}: ${status.failureReason ?? 'no reason reported'}.`
    );
  }
  const accountId = status.accountId;
  if (accountId === undefined) {
    throw new Error(`CreateAccount request ${requestId} succeeded without an account ID.`);
  }
  log(`${entry.key}: created account ${accountId}.`);

  const account = await pollUntil(
    `account ${accountId} to become ACTIVE`,
    async () => {
      const current = await port.describeAccount(accountId);
      return current.state === 'ACTIVE' ? current : undefined;
    },
    { intervalMs: options.pollIntervalMs, timeoutMs: options.activeTimeoutMs },
    options
  );
  if (account.name !== entry.name || emailKey(account.email) !== emailKey(entry.email)) {
    throw new Error(
      `Account ${accountId} reports name '${account.name}' / email ${account.email}; expected '${entry.name}' / ${entry.email}.`
    );
  }

  await ensureAccountPlacement(port, accountId, entry.targetOuId, rootId, options);
  await ensureAccountTags(port, accountId, entry.desired.tags, options);
  return accountId;
}

/**
 * Applies a plan built by `buildAccountPlan`. Refuses to start when any entry is CONFLICT.
 * Processes entries sequentially and stops on the first failure, so at most one account is
 * ever being created and a rerun picks up from the live Organization state.
 */
export async function applyAccountPlan(
  port: OrganizationsAccountPort,
  plan: AccountPlan,
  options: ApplyOptions
): Promise<ProvisionedAccount[]> {
  const conflicts = planConflicts(plan);
  if (conflicts.length > 0) {
    throw new Error(
      `Refusing to provision: ${conflicts.length} account(s) are in CONFLICT (${conflicts.map((entry) => entry.key).join(', ')}).`
    );
  }

  const log = options.log ?? (() => undefined);
  const results: ProvisionedAccount[] = [];
  for (const entry of plan.entries) {
    try {
      if (entry.classification === 'MISSING') {
        const accountId = await createMissingAccount(port, entry, plan.rootId, options);
        results.push({ key: entry.key, name: entry.name, accountId, outcome: 'CREATED' });
        continue;
      }
      const accountId = entry.accountId as string;
      if (entry.pendingActions.includes('PLACE_FROM_ROOT')) {
        log(`${entry.key}: moving ${accountId} from the Root to ${entry.targetOuId}.`);
        await ensureAccountPlacement(port, accountId, entry.targetOuId, plan.rootId, options);
      }
      if (entry.pendingActions.includes('APPLY_TAGS')) {
        log(`${entry.key}: applying ${entry.tagsToApply.map((tag) => tag.key).join(', ')} to ${accountId}.`);
        await ensureAccountTags(port, accountId, entry.desired.tags, options);
      }
      log(`${entry.key}: reusing existing account ${accountId}.`);
      results.push({ key: entry.key, name: entry.name, accountId, outcome: 'REUSED' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Provisioning stopped at '${entry.key}': ${message}`, { cause: error });
    }
  }
  return results;
}

/**
 * Asserts that a fresh plan shows every configured account fully reconciled and returns the
 * account IDs in plan order. Used after apply as the post-provisioning validation.
 */
export function assertAccountPlanReconciled(plan: AccountPlan): Array<{ key: string; accountId: string }> {
  const problems = plan.entries
    .filter((entry) => entry.classification !== 'EXISTING_MATCH' || entry.pendingActions.length > 0)
    .map((entry) =>
      entry.classification === 'EXISTING_MATCH'
        ? `${entry.key}: pending ${entry.pendingActions.join(', ')}`
        : `${entry.key}: ${entry.classification}${entry.reason === undefined ? '' : ` - ${entry.reason}`}`
    );
  if (problems.length > 0) {
    throw new Error(`Landing Zone accounts are not reconciled:\n  ${problems.join('\n  ')}`);
  }
  return plan.entries.map((entry) => ({ key: entry.key, accountId: entry.accountId as string }));
}
