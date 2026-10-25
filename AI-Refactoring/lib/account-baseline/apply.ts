/**
 * Common Account Security Baseline v1.0 - apply round.
 *
 * One round, inside one credential window:
 *  1. build the full READ-ONLY environment plan from live state (`phase: 'preflight'`) and record the
 *     run's first observations in the ledger;
 *  2. if the preflight gate is not PASS, throw `PreflightBlockedError` before ANY write;
 *  3. for each NON_COMPLIANT cell, account by account and control by control:
 *     - stop the round (`continue` / `job-budget-exhausted`) before a write that might not finish
 *       inside the credential or job budget, so the next round resumes from live state;
 *     - re-check the account (ACTIVE, still in its OU) and re-assess the control with a fresh
 *       session. Only an unchanged NON_COMPLIANT precondition is written; an already COMPLIANT cell is
 *       skipped; anything else stops the run (`ApplyFailedError`);
 *     - perform the planned enable-only writes, each recorded as `started` before the call;
 *     - poll with a bounded budget until the control reads COMPLIANT with its invariants intact.
 *  4. the first failure stops every further change and is recorded in the ledger, which keeps the
 *     post-apply validation and the Production job from accepting the environment.
 *
 * A rerun repeats the same logic: controls that are already compliant are recognized and skipped.
 */

import type { LandingZoneConfig } from '../../config/schemas/organization-schema.js';
import { canonicalJson, describeFailure, type ControlContext, type RegisteredControl } from './controls/index.js';
import { ledgerKey, type BaselineLedger, type LedgerAttempt, type LedgerStore } from './ledger.js';
import { buildBaselinePlan, type BaselinePlan, type PlannedCell } from './plan.js';
import type { BaselineClock, InventoryPort, MemberAccountPort } from './ports.js';
import { describeWrite, type AccountBaselineControlId, type AccountBaselineEnvironment } from './types.js';

export type ApplyRoundStatus = 'complete' | 'continue' | 'job-budget-exhausted';

/** Seconds kept free after a write's settle budget, for the next steps of the job. */
export const WRITE_SAFETY_MARGIN_SECONDS = 120;

export class PreflightBlockedError extends Error {
  public constructor(public readonly plan: BaselinePlan) {
    super(`account baseline preflight failed; no AWS write was made:\n  ${plan.acceptance.problems.join('\n  ')}`);
    this.name = 'PreflightBlockedError';
  }
}

export class ApplyFailedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ApplyFailedError';
  }
}

export interface ApplyRoundDependencies {
  readonly environment: AccountBaselineEnvironment;
  readonly config: LandingZoneConfig;
  readonly inventory: InventoryPort;
  readonly capabilityProblems: ReadonlyMap<AccountBaselineControlId, readonly string[]>;
  readonly ledgers: LedgerStore;
  readonly clock: BaselineClock;
  readonly today: string;
  readonly controls?: readonly RegisteredControl[];
}

export interface ApplyRoundBudget {
  /** Epoch ms after which no new write may start in this credential window. */
  readonly roundDeadlineMs: number;
  /** Epoch ms of the job timeout. */
  readonly jobDeadlineMs: number;
}

export interface ApplyRoundResult {
  readonly status: ApplyRoundStatus;
  readonly plan: BaselinePlan;
  readonly writesPerformed: number;
}

/** Records the run's first observation of every cell; later rounds never overwrite it. */
export function recordFirstObservations(ledger: BaselineLedger, plan: BaselinePlan): void {
  for (const row of plan.rows) {
    if (row.enforcement !== 'enforced') continue;
    const key = ledgerKey(row.accountId, row.control);
    if (ledger.cells[key] !== undefined) continue;
    const cell = plan.cells.find(
      (candidate) => candidate.account.accountId === row.accountId && candidate.control.id === row.control
    );
    ledger.cells[key] = {
      accountId: row.accountId,
      control: row.control,
      firstObserved: row.observed,
      firstStatus: row.status,
      firstObservation: cell?.observation ?? null,
      attempts: []
    };
  }
}

function contextFor(config: LandingZoneConfig, accountId: string): ControlContext {
  return {
    partition: config.aws.partition,
    region: config.aws.region,
    accountId,
    controls: config.accountBaseline.controls
  };
}

function settleSeconds(cell: PlannedCell): number {
  return cell.control.settle.attempts * cell.control.settle.intervalSeconds;
}

function fail(ledgers: LedgerStore, ledger: BaselineLedger, message: string): never {
  ledger.failure = message;
  ledgers.write(ledger);
  throw new ApplyFailedError(message);
}

export async function runApplyRound(deps: ApplyRoundDependencies, budget: ApplyRoundBudget): Promise<ApplyRoundResult> {
  const snapshot = await deps.inventory.snapshot();
  const ledger = deps.ledgers.read();
  if (ledger.failure !== undefined) {
    throw new ApplyFailedError(`an earlier apply round of this run failed; no further changes: ${ledger.failure}`);
  }
  const plan = buildBaselinePlan({
    environment: deps.environment,
    phase: 'preflight',
    config: deps.config,
    inventory: snapshot,
    openSession: (accountId) => deps.inventory.openSession(accountId),
    capabilityProblems: deps.capabilityProblems,
    ledger,
    today: deps.today,
    ...(deps.controls === undefined ? {} : { controls: deps.controls })
  });
  recordFirstObservations(ledger, plan);
  deps.ledgers.write(ledger);
  if (plan.acceptance.outcome !== 'PASS') throw new PreflightBlockedError(plan);

  let writesPerformed = 0;
  for (const cell of plan.cells) {
    if (cell.assessment.status !== 'NON_COMPLIANT') continue;
    const label = `${cell.account.key} (${cell.account.accountId}) ${cell.control.id}`;
    const needed = (cell.assessment.writes.length * 30 + settleSeconds(cell) + WRITE_SAFETY_MARGIN_SECONDS) * 1000;
    const now = deps.clock.now();
    if (now + needed > budget.jobDeadlineMs) {
      return { status: 'job-budget-exhausted', plan, writesPerformed };
    }
    if (now + needed > budget.roundDeadlineMs) return { status: 'continue', plan, writesPerformed };

    // Pre-write recheck: the account and the control's precondition are re-read immediately before the write.
    const eligibility = await deps.inventory.accountStillEligible(cell.account.accountId, cell.account.ouId);
    if (eligibility.length > 0)
      fail(deps.ledgers, ledger, `${label}: account no longer eligible: ${eligibility.join('; ')}`);
    const context = contextFor(deps.config, cell.account.accountId);
    let session: MemberAccountPort;
    try {
      session = deps.inventory.openSession(cell.account.accountId);
    } catch (error) {
      fail(deps.ledgers, ledger, `${label}: cannot open the member session: ${describeFailure(error)}`);
    }
    const recheck = cell.control.assess(session, context);
    if (recheck.assessment.status === 'COMPLIANT') continue;
    if (
      recheck.assessment.status !== 'NON_COMPLIANT' ||
      recheck.assessment.fingerprint !== cell.assessment.fingerprint ||
      canonicalJson(recheck.assessment.writes) !== canonicalJson(cell.assessment.writes)
    ) {
      fail(
        deps.ledgers,
        ledger,
        `${label}: precondition changed since the plan (now ${recheck.assessment.status}: ${recheck.assessment.reasons.join('; ') || recheck.assessment.observed}); nothing written`
      );
    }

    const ledgerCell = ledger.cells[ledgerKey(cell.account.accountId, cell.control.id)];
    for (const write of recheck.assessment.writes) {
      const recorded: LedgerAttempt = { write, at: new Date(deps.clock.now()).toISOString(), outcome: 'started' };
      ledgerCell?.attempts.push(recorded);
      deps.ledgers.write(ledger);
      try {
        session.write(write);
      } catch (error) {
        recorded.outcome = 'failed';
        recorded.error = describeFailure(error);
        fail(deps.ledgers, ledger, `${label}: ${describeWrite(write)} failed: ${describeFailure(error)}`);
      }
      recorded.outcome = 'succeeded';
      writesPerformed += 1;
      deps.ledgers.write(ledger);
    }

    // Bounded polling until the change is visible and nothing else moved.
    let settled = false;
    let last = '';
    for (let attempt = 0; attempt < cell.control.settle.attempts; attempt += 1) {
      await deps.clock.sleep(cell.control.settle.intervalSeconds);
      let verifySession: MemberAccountPort;
      try {
        verifySession = deps.inventory.openSession(cell.account.accountId);
      } catch (error) {
        last = describeFailure(error);
        continue;
      }
      const after = cell.control.assess(verifySession, context);
      if (after.observation !== undefined && recheck.observation !== undefined) {
        const invariant = cell.control.invariantProblems(recheck.observation, after.observation);
        if (invariant.length > 0)
          fail(deps.ledgers, ledger, `${label}: invariant violated after the write: ${invariant.join('; ')}`);
      }
      if (after.assessment.status === 'COMPLIANT') {
        settled = true;
        break;
      }
      last = `${after.assessment.status}: ${after.assessment.reasons.join('; ') || after.assessment.observed}`;
    }
    if (!settled) {
      fail(
        deps.ledgers,
        ledger,
        `${label}: did not read back COMPLIANT within ${settleSeconds(cell)}s after the write (last: ${last})`
      );
    }
  }
  return { status: 'complete', plan, writesPerformed };
}
