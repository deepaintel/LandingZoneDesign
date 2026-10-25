/**
 * Common Account Security Baseline v1.0 - account inventory and eligibility.
 *
 * The expected enforcement matrix is generated from configuration (`landingZoneAccounts` and the
 * five controls) and validated against the live inventory. Nothing about the accounts is hardcoded:
 * the configured inventory decides which accounts are enforced, the live Organization supplies their
 * IDs, and `accountBaseline.expectedEnforcedAccountCount` is the reviewed expectation both must meet.
 *
 * Exclusions are enforced twice: by the configuration schema (no Landing Zone account may sit under
 * Security or Suspended, or reuse a shared-account email) and here at runtime (no enforced account
 * may be the Management, Audit or Log Archive account, sit in an excluded OU, or be duplicated).
 */

import {
  ACCOUNT_BASELINE_CONTROL_IDS,
  isExcludedOuPath,
  type AccountBaselineEnvironment
} from '../../config/schemas/account-baseline-schema.js';
import type { LandingZoneConfig } from '../../config/schemas/organization-schema.js';
import type { InventorySnapshot } from './ports.js';
import type { ExcludedAccount, ExpectedMatrix, MatrixAccount } from './types.js';

export const ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;

export interface EnforcedAccount extends MatrixAccount {
  readonly ouId: string;
}

export interface MatrixWithProblems {
  readonly matrix: ExpectedMatrix;
  readonly enforced: readonly EnforcedAccount[];
  readonly problems: readonly string[];
}

export function buildExpectedMatrix(input: {
  readonly environment: AccountBaselineEnvironment;
  readonly config: LandingZoneConfig;
  readonly inventory: InventorySnapshot;
}): MatrixWithProblems {
  const { config, inventory, environment } = input;
  const problems: string[] = [];
  const configured = Object.entries(config.landingZoneAccounts);
  const expectedCount = config.accountBaseline.expectedEnforcedAccountCount;

  if (configured.length !== expectedCount) {
    problems.push(
      `configuration lists ${configured.length} eligible accounts but accountBaseline.expectedEnforcedAccountCount is ${expectedCount}`
    );
  }
  if (inventory.managementAccountId !== config.aws.accountId) {
    problems.push(
      `live management account '${inventory.managementAccountId}' is not the configured '${config.aws.accountId}'`
    );
  }

  const excludedIds = new Map<string, string>([
    [config.aws.accountId, 'Management'],
    [inventory.auditAccountId, 'Audit'],
    [inventory.logArchiveAccountId, 'Log Archive']
  ]);
  for (const [accountId, label] of excludedIds) {
    if (!ACCOUNT_ID_PATTERN.test(accountId))
      problems.push(`${label} account ID '${accountId}' is not a 12-digit account ID`);
  }
  if (excludedIds.size !== 3) problems.push('Management, Audit and Log Archive account IDs must be distinct');

  const liveByKey = new Map(inventory.accounts.map((account) => [account.key, account]));
  const seenIds = new Set<string>();
  const enforced: EnforcedAccount[] = [];
  for (const [key, account] of configured) {
    const live = liveByKey.get(key);
    if (live === undefined) {
      problems.push(`configured account '${key}' (${account.name}) was not resolved in the live Organization`);
      enforced.push({ key, name: account.name, accountId: '', ouPath: account.ouPath, ouId: '' });
      continue;
    }
    if (!ACCOUNT_ID_PATTERN.test(live.accountId)) {
      problems.push(`account '${key}' resolved to an invalid account ID '${live.accountId}'`);
    }
    if (seenIds.has(live.accountId))
      problems.push(`account ID ${live.accountId} appears more than once in the target set`);
    seenIds.add(live.accountId);
    const excludedRole = excludedIds.get(live.accountId);
    if (excludedRole !== undefined) {
      problems.push(
        `account '${key}' (${live.accountId}) is the ${excludedRole} account, which is excluded from enforcement`
      );
    }
    if (live.ouPath !== account.ouPath) {
      problems.push(`account '${key}' is in OU '${live.ouPath}', not the configured '${account.ouPath}'`);
    }
    if (isExcludedOuPath(live.ouPath)) {
      problems.push(`account '${key}' is in the excluded OU '${live.ouPath}'`);
    }
    if (!live.enrolled) problems.push(`account '${key}' (${live.accountId}) is not enrolled in AWS Control Tower`);
    if (inventory.suspendedAccounts.some((suspended) => suspended.accountId === live.accountId)) {
      problems.push(`account '${key}' (${live.accountId}) is in the Suspended OU`);
    }
    enforced.push({ key, name: live.name, accountId: live.accountId, ouPath: live.ouPath, ouId: live.ouId });
  }
  for (const live of inventory.accounts) {
    if (!configured.some(([key]) => key === live.key)) {
      problems.push(
        `live inventory returned unexpected account '${live.key}' (${live.accountId}), not in configuration`
      );
    }
  }
  if (inventory.accounts.length !== configured.length) {
    problems.push(`live inventory resolved ${inventory.accounts.length} accounts; ${configured.length} are configured`);
  }

  const excluded: ExcludedAccount[] = [
    {
      key: 'management',
      name: 'Management',
      accountId: config.aws.accountId,
      ouPath: 'Root',
      reason: 'Management account'
    },
    {
      key: 'audit',
      name: 'Audit',
      accountId: inventory.auditAccountId,
      ouPath: 'Security',
      reason: 'Audit (Security OU)'
    },
    {
      key: 'logArchive',
      name: 'Log Archive',
      accountId: inventory.logArchiveAccountId,
      ouPath: 'Security',
      reason: 'Log Archive (Security OU)'
    },
    ...inventory.suspendedAccounts.map((account) => ({
      key: `suspended-${account.accountId}`,
      name: account.name,
      accountId: account.accountId,
      ouPath: 'Suspended',
      reason: 'Suspended OU'
    }))
  ];

  return {
    matrix: {
      environment,
      controls: [...ACCOUNT_BASELINE_CONTROL_IDS],
      enforcedAccounts: enforced.map(({ key, name, accountId, ouPath }) => ({ key, name, accountId, ouPath })),
      excludedAccounts: excluded,
      expectedEnforcedAccountCount: expectedCount
    },
    enforced,
    problems
  };
}
