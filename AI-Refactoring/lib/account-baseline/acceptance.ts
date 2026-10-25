/**
 * Common Account Security Baseline v1.0 - centralized acceptance evaluator.
 *
 * Every expected account and enabled control must produce exactly one valid result row. The
 * environment-level outcome is PASS only when every mandatory rule below holds; anything else is
 * FAIL, and the caller exits non-zero.
 *
 * | Status            | preflight                                   | post-apply |
 * |-------------------|---------------------------------------------|------------|
 * | COMPLIANT         | PASS                                        | PASS       |
 * | NON_COMPLIANT     | PASS only with an allowed enable-only write | FAIL       |
 * | REQUIRES_APPROVAL | FAIL (no approved exception policy)         | FAIL       |
 * | UNSUPPORTED       | FAIL                                        | FAIL       |
 * | ERROR             | FAIL                                        | FAIL       |
 * | NOT_ASSESSED      | FAIL                                        | FAIL       |
 * | EXCLUDED          | only for excluded accounts, with no write   | same       |
 *
 * Structural rules: no missing account, no missing control, no duplicate account/control result,
 * no row for an unexpected account or another environment, no excluded account in the enforced set,
 * the enforced set matches the configured expectation, and every blocker (inventory, capability,
 * apply failure) is a FAIL.
 *
 * Exceptions: no exception-management policy is approved for v1.0. Exception entries are validated
 * (malformed, expired, unknown account/control) and reported, but even a well-formed exception never
 * turns REQUIRES_APPROVAL into a pass, and an approved exception is never reported as COMPLIANT.
 */

import { accountBaselineExceptionSchema } from '../../config/schemas/account-baseline-schema.js';
import {
  RESULT_STATUSES,
  type AccountBaselineControlId,
  type BaselineResultRow,
  type BaselineWrite,
  type ExpectedMatrix,
  type ResultStatus
} from './types.js';

export type AcceptancePhase = 'preflight' | 'post-apply';
export type AcceptanceOutcome = 'PASS' | 'FAIL';

/** Write kinds each control may plan. Anything else is not an approved enable-only action. */
export const ALLOWED_WRITES: Readonly<Record<AccountBaselineControlId, readonly BaselineWrite['kind'][]>> = {
  's3-account-public-access-block': ['PutAccountPublicAccessBlock'],
  'ebs-encryption-by-default': ['EnableEbsEncryptionByDefault'],
  'ec2-imds-defaults': ['ModifyInstanceMetadataDefaults'],
  'ebs-snapshot-block-public-access': ['EnableSnapshotBlockPublicAccess'],
  'ec2-image-block-public-access': ['EnableImageBlockPublicAccess']
};

export interface AcceptanceInput {
  readonly phase: AcceptancePhase;
  readonly matrix: ExpectedMatrix;
  readonly rows: readonly BaselineResultRow[];
  /** Environment-level blockers: inventory, eligibility, capability, apply failure. */
  readonly blockers: readonly string[];
  /** Exception entries as found (v1.0 configuration accepts none). */
  readonly exceptions: readonly unknown[];
  /** ISO date used to evaluate exception expiry. */
  readonly today: string;
}

export interface AcceptanceResult {
  readonly phase: AcceptancePhase;
  readonly outcome: AcceptanceOutcome;
  readonly problems: readonly string[];
  readonly expectedResults: number;
  readonly actualResults: number;
  readonly expectedEnforcedAccounts: number;
  readonly enforcedAccounts: number;
  readonly counts: Readonly<Record<ResultStatus, number>>;
}

function cellKey(accountId: string, control: string): string {
  return `${accountId}|${control}`;
}

function exceptionProblems(exceptions: readonly unknown[], matrix: ExpectedMatrix, today: string): string[] {
  const problems: string[] = [];
  exceptions.forEach((candidate, index) => {
    const parsed = accountBaselineExceptionSchema.safeParse(candidate);
    if (!parsed.success) {
      problems.push(
        `exception #${index + 1} is invalid: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`
      );
      return;
    }
    const entry = parsed.data;
    if (entry.environment !== matrix.environment) {
      problems.push(`exception ${entry.id} is for ${entry.environment}, not ${matrix.environment}`);
    }
    if (!matrix.enforcedAccounts.some((account) => account.key === entry.accountKey)) {
      problems.push(`exception ${entry.id} names unknown account '${entry.accountKey}'`);
    }
    if (entry.expiresOn < today) problems.push(`exception ${entry.id} expired on ${entry.expiresOn}`);
    problems.push(
      `exception ${entry.id} is recorded, but no exception-management policy is approved for v1.0; ` +
        `${entry.accountKey}/${entry.control} stays blocking`
    );
  });
  return problems;
}

export function evaluateAcceptance(input: AcceptanceInput): AcceptanceResult {
  const { matrix, rows, phase } = input;
  const problems: string[] = [...input.blockers];
  const counts = Object.fromEntries(RESULT_STATUSES.map((status) => [status, 0])) as Record<ResultStatus, number>;

  if (matrix.enforcedAccounts.length !== matrix.expectedEnforcedAccountCount) {
    problems.push(
      `${matrix.enforcedAccounts.length} enforced accounts, but ${matrix.expectedEnforcedAccountCount} are expected`
    );
  }
  if (matrix.enforcedAccounts.length === 0) problems.push('no enforced accounts: an empty matrix is never accepted');
  if (matrix.controls.length === 0) problems.push('no controls: an empty matrix is never accepted');

  const enforcedIds = new Set(matrix.enforcedAccounts.map((account) => account.accountId));
  const excludedIds = new Set(matrix.excludedAccounts.map((account) => account.accountId));
  for (const account of matrix.enforcedAccounts) {
    if (account.accountId === '') problems.push(`enforced account '${account.key}' has no resolved account ID`);
    if (excludedIds.has(account.accountId)) {
      problems.push(`excluded account ${account.accountId} is in the enforced set (${account.key})`);
    }
  }
  if (enforcedIds.size !== matrix.enforcedAccounts.length)
    problems.push('the enforced set contains duplicate account IDs');

  const controls = new Set<string>(matrix.controls);
  const seen = new Map<string, BaselineResultRow>();
  for (const row of rows) {
    if (!(RESULT_STATUSES as readonly string[]).includes(row.status)) {
      problems.push(`${row.accountId}/${row.control}: invalid status '${String(row.status)}'`);
      continue;
    }
    counts[row.status] += 1;
    if (row.environment !== matrix.environment) {
      problems.push(`${row.accountId}/${row.control}: result belongs to ${row.environment}, not ${matrix.environment}`);
    }
    if (!controls.has(row.control)) problems.push(`${row.accountId}: unexpected control '${row.control}'`);
    const key = cellKey(row.accountId, row.control);
    if (seen.has(key)) problems.push(`${row.accountId}/${row.control}: duplicate result`);
    seen.set(key, row);

    const isEnforced = enforcedIds.has(row.accountId);
    const isExcluded = excludedIds.has(row.accountId);
    if (!isEnforced && !isExcluded) {
      problems.push(`${row.accountId}/${row.control}: result for an unexpected account`);
      continue;
    }
    if (isExcluded) {
      if (row.status !== 'EXCLUDED' || row.enforcement !== 'excluded') {
        problems.push(`${row.accountId}/${row.control}: excluded account reported as ${row.status}`);
      }
      if (row.performedWrites.length > 0 || row.plannedWrites.length > 0) {
        problems.push(`${row.accountId}/${row.control}: excluded account has planned or performed writes`);
      }
      continue;
    }
    if (row.enforcement !== 'enforced')
      problems.push(`${row.accountId}/${row.control}: enforced account marked excluded`);

    const label = `${row.accountKey} (${row.accountId}) ${row.control}`;
    switch (row.status) {
      case 'COMPLIANT':
        break;
      case 'NON_COMPLIANT': {
        if (phase === 'post-apply') {
          problems.push(`${label}: NON_COMPLIANT after apply - ${row.reason}`);
          break;
        }
        const allowed = ALLOWED_WRITES[row.control] ?? [];
        if (row.plannedWrites.length === 0) problems.push(`${label}: NON_COMPLIANT with no safe enable-only action`);
        for (const write of row.plannedWrites) {
          if (!allowed.includes(write.kind)) problems.push(`${label}: planned write ${write.kind} is not allowed`);
        }
        break;
      }
      case 'EXCLUDED':
        problems.push(`${label}: EXCLUDED is not allowed for an enforced account`);
        break;
      default:
        problems.push(`${label}: ${row.status} - ${row.reason}`);
    }
  }

  for (const account of [...matrix.enforcedAccounts, ...matrix.excludedAccounts]) {
    for (const control of matrix.controls) {
      if (!seen.has(cellKey(account.accountId, control))) {
        problems.push(`${account.key} (${account.accountId || 'unresolved'}) ${control}: no result`);
      }
    }
  }

  problems.push(...exceptionProblems(input.exceptions, matrix, input.today));

  const expectedResults = (matrix.enforcedAccounts.length + matrix.excludedAccounts.length) * matrix.controls.length;
  return {
    phase,
    outcome: problems.length === 0 ? 'PASS' : 'FAIL',
    problems,
    expectedResults,
    actualResults: rows.length,
    expectedEnforcedAccounts: matrix.expectedEnforcedAccountCount,
    enforcedAccounts: matrix.enforcedAccounts.length,
    counts
  };
}
