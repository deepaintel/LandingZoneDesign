/**
 * Common Account Security Baseline v1.0 - per-run ledger.
 *
 * The plan, the apply rounds and the verification of ONE deployment job share a ledger file under
 * `RUNNER_TEMP`. It records, per account and control:
 *  - the FIRST observation of the run, before any write (the "previous configuration" of the
 *    report, and the reference for post-apply invariants such as an unchanged default KMS key);
 *  - every write attempt, recorded as `started` BEFORE the call and `succeeded` / `failed` after, so
 *    a crash mid-write still shows in the report.
 * A new workflow run starts with an empty ledger; the live state is always re-read, so a rerun
 * recognizes already-compliant controls.
 */

import type { AccountBaselineControlId, AccountBaselineEnvironment, BaselineWrite, ResultStatus } from './types.js';

export interface LedgerAttempt {
  readonly write: BaselineWrite;
  readonly at: string;
  outcome: 'started' | 'succeeded' | 'failed';
  error?: string;
}

export interface LedgerCell {
  readonly accountId: string;
  readonly control: AccountBaselineControlId;
  readonly firstObserved: string;
  readonly firstStatus: ResultStatus;
  /** Raw first observation; `null` when the first read failed. */
  readonly firstObservation: unknown;
  readonly attempts: LedgerAttempt[];
}

export interface BaselineLedger {
  readonly environment: AccountBaselineEnvironment;
  cells: Record<string, LedgerCell>;
  /** Set when an apply round stopped on a failure; blocks acceptance. */
  failure?: string;
}

export interface LedgerStore {
  read(): BaselineLedger;
  write(ledger: BaselineLedger): void;
}

export function emptyLedger(environment: AccountBaselineEnvironment): BaselineLedger {
  return { environment, cells: {} };
}

export function ledgerKey(accountId: string, control: string): string {
  return `${accountId}|${control}`;
}

/** Writes that this run actually performed (succeeded) for one cell. */
export function performedWrites(ledger: BaselineLedger, accountId: string, control: string): BaselineWrite[] {
  return (ledger.cells[ledgerKey(accountId, control)]?.attempts ?? [])
    .filter((attempt) => attempt.outcome === 'succeeded')
    .map((attempt) => attempt.write);
}

/** Attempts that started but did not succeed: the partial state an interrupted write may leave. */
export function unfinishedAttempts(ledger: BaselineLedger): { key: string; attempt: LedgerAttempt }[] {
  return Object.entries(ledger.cells).flatMap(([key, cell]) =>
    cell.attempts.filter((attempt) => attempt.outcome !== 'succeeded').map((attempt) => ({ key, attempt }))
  );
}
