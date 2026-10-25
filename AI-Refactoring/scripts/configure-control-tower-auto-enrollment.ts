#!/usr/bin/env tsx
/**
 * AWS Control Tower account auto-enrollment (Staging and Production) - enable only.
 *
 * Governed by `.apm/skills/control-tower-auto-enrollment/SKILL.md`. Invoked only by the
 * `configure-control-tower-auto-enrollment` composite action inside the protected deployment job of
 * an approved environment, after OU enrollment and its read-only validation, with OIDC credentials
 * for `github-actions-role` configured. Never run from CI. This is the ONLY code path in the
 * repository that calls `UpdateLandingZone`.
 *
 *   --mode plan    READ-ONLY. Identity, Region, Landing Zone ARN, AWS CLI support, Landing Zone
 *                  version / status / drift / manifest, `remediationTypes`, in-progress Landing
 *                  Zone operations; prints the decision and exits non-zero when it is `stop`.
 *   --mode apply   Repeats the plan from live state, then takes the single decided action: nothing,
 *                  await an in-progress operation, or ONE `UpdateLandingZone` (live ARN, deployed
 *                  version, repository manifest, `INHERITANCE_DRIFT`) followed by bounded polling.
 *                  The submission is recorded in a run ledger first, so a run never submits twice;
 *                  a `ConflictException` or an ambiguous response is never resubmitted.
 *   --mode verify  READ-ONLY. The Landing Zone is healthy, its manifest unchanged, and the live
 *                  setting equals the configured one.
 *
 * Never calls `ResetLandingZone`, `CreateLandingZone`, `EnableBaseline` or `ResetEnabledBaseline`,
 * and never disables auto-enrollment.
 *
 * Credential and job budgets mirror the enrollment script: each apply round stops polling before
 * `--session-budget-seconds` and reports `continue`; the action refreshes credentials and the next
 * round resumes from live state (the in-progress operation is found and polled, never resubmitted).
 * An update is only submitted while the job still holds the full operation ceiling plus
 * verification; otherwise the round reports `job-budget-exhausted` before the write.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  controlTowerLandingZoneVersion,
  ENROLLMENT_ENVIRONMENTS,
  type EnrollmentEnvironment
} from '../config/schemas/control-tower-schema.js';
import { callerIdentityProblems, isConflictError } from '../lib/control-tower/baseline-enrollment.js';
import {
  AUTO_ENROLLMENT_REMEDIATION_TYPES,
  classifyLandingZoneOperation,
  cliSkeletonProblems,
  collectLandingZoneOperations,
  decideAutoEnrollment,
  DEFAULT_SESSION_BUDGET_SECONDS,
  findInProgressOperation,
  isLandingZoneOperationIdentifier,
  landingZoneArnProblems,
  landingZoneHealthProblems,
  OPERATION_TIMEOUT_MINUTES,
  operationTimedOut,
  POLL_INTERVAL_SECONDS,
  pollStopReason,
  readLandingZone,
  runtimeRegionProblems,
  SETTLE_TIMEOUT_MINUTES,
  submissionStopReason,
  verificationProblems,
  type AutoEnrollmentDecision,
  type InProgressOperation,
  type LandingZoneOperationsPage,
  type LandingZoneOperationType,
  type LandingZoneSnapshot,
  type LiveAutoEnrollment,
  type RoundStatus
} from '../lib/control-tower/landing-zone-auto-enrollment.js';
import { buildLandingZoneManifest } from '../lib/control-tower/landing-zone-manifest.js';
import type { LandingZoneManifest } from '../lib/control-tower/types.js';
import { AwsCli, loadConfig } from './control-tower-enrollment-runtime.js';
import { runCloudTrailDiagnostics } from './initialize-control-tower.js';

/** Items per `ListLandingZoneOperations` page requested through the CLI (`--max-items`). */
export const OPERATIONS_PAGE_SIZE = 50;
/** Bound on plan -> action iterations within one round (await, enable, await own update, done). */
export const MAX_DECISIONS_PER_ROUND = 5;
/**
 * AWS CLI commands and request members this script relies on, checked from the CLI's local service
 * model (`--generate-cli-skeleton input`) before any write. This file is the only code path that
 * calls `update-landing-zone`.
 */
export const REQUIRED_CLI_MEMBERS: Readonly<Record<string, readonly string[]>> = {
  'update-landing-zone': ['landingZoneIdentifier', 'version', 'manifest', 'remediationTypes'],
  'get-landing-zone-operation': ['operationIdentifier'],
  'list-landing-zone-operations': []
};

type Mode = 'plan' | 'apply' | 'verify';

// ---------------------------------------------------------------------------------------------
// Ports.
// ---------------------------------------------------------------------------------------------

export interface UpdateLandingZoneRequest {
  readonly landingZoneArn: string;
  readonly version: string;
  readonly manifest: LandingZoneManifest;
  readonly remediationTypes: readonly string[];
}

/** The AWS operations this component uses; the production implementation wraps `AwsCli`. */
export interface AutoEnrollmentOperations {
  callerIdentity(): { readonly Account?: string; readonly Arn?: string };
  getLandingZone(landingZoneArn: string): unknown;
  listLandingZoneOperationsPage(startingToken: string | undefined): LandingZoneOperationsPage;
  /** Returns `operationDetails` of `GetLandingZoneOperation`. */
  getLandingZoneOperation(operationIdentifier: string): unknown;
  /** MUTATING. The only write. */
  updateLandingZone(request: UpdateLandingZoneRequest): unknown;
  /** `aws controltower <command> --generate-cli-skeleton input`; local, no AWS call. */
  cliSkeleton(command: string): unknown;
  /** Read-only failure diagnostics (CloudTrail access denials since `startedAt`). */
  diagnose(startedAt: Date): string[];
}

export interface AutoEnrollmentClock {
  now(): number;
  sleep(seconds: number): Promise<void>;
}

/** Per-workflow-run state shared by the rounds of one job (kept under `RUNNER_TEMP`). */
export interface AutoEnrollmentLedger {
  /** Set BEFORE `UpdateLandingZone` is called, so a run never submits a second update. */
  updateAttempted: boolean;
  /** Identifier returned by this run's `UpdateLandingZone`, recorded as soon as it is known. */
  updateOperationIdentifier?: string;
  /** Identifier of a Landing Zone operation this run awaited or submitted, for the summary. */
  lastOperationIdentifier?: string;
  /** First observation (epoch ms) of an operation that reported no start time. */
  firstObservedAt: Record<string, number>;
}

export interface AutoEnrollmentLedgerStore {
  read(): AutoEnrollmentLedger;
  write(ledger: AutoEnrollmentLedger): void;
}

export function emptyLedger(): AutoEnrollmentLedger {
  return { updateAttempted: false, firstObservedAt: {} };
}

export interface AutoEnrollmentContext {
  readonly environment: EnrollmentEnvironment;
  readonly landingZoneArn: string;
  readonly managementAccountId: string;
  readonly partition: string;
  readonly region: string;
  /** Region from the runtime environment (`AWS_REGION` / `AWS_DEFAULT_REGION`), when set. */
  readonly runtimeRegion: string | undefined;
  readonly desiredEnabled: boolean;
  readonly expectedVersion: string;
  readonly expectedManifest: LandingZoneManifest;
}

export interface AutoEnrollmentPlan {
  readonly landingZone: LandingZoneSnapshot | undefined;
  readonly live: LiveAutoEnrollment;
  readonly inProgress: InProgressOperation;
  readonly decision: AutoEnrollmentDecision;
}

// ---------------------------------------------------------------------------------------------
// Plan.
// ---------------------------------------------------------------------------------------------

/** Accepts exactly staging and production; anything else fails closed before an AWS call. */
export function assertAutoEnrollmentEnvironment(environment: string): EnrollmentEnvironment {
  if (!(ENROLLMENT_ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new Error(
      `Control Tower auto-enrollment supports only ${ENROLLMENT_ENVIRONMENTS.join(' and ')}; refusing environment '${environment}'.`
    );
  }
  return environment as EnrollmentEnvironment;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the read-only plan from live state. Every check that fails becomes a reason of a `stop`
 * decision; nothing here writes.
 */
export function buildAutoEnrollmentPlan(
  ops: AutoEnrollmentOperations,
  context: AutoEnrollmentContext,
  options: { readonly checkCli: boolean }
): AutoEnrollmentPlan {
  const blockingProblems: string[] = [];

  try {
    blockingProblems.push(
      ...callerIdentityProblems(ops.callerIdentity(), {
        accountId: context.managementAccountId,
        partition: context.partition
      })
    );
  } catch (error) {
    blockingProblems.push(`caller identity could not be read: ${message(error)}`);
  }
  blockingProblems.push(...runtimeRegionProblems(context.runtimeRegion, context.region));
  blockingProblems.push(
    ...landingZoneArnProblems(context.landingZoneArn, {
      partition: context.partition,
      region: context.region,
      managementAccountId: context.managementAccountId
    })
  );

  if (options.checkCli) {
    for (const [command, members] of Object.entries(REQUIRED_CLI_MEMBERS)) {
      try {
        blockingProblems.push(...cliSkeletonProblems(command, ops.cliSkeleton(command), members));
      } catch (error) {
        blockingProblems.push(`the installed AWS CLI cannot describe 'controltower ${command}': ${message(error)}`);
      }
    }
  }

  let landingZone: LandingZoneSnapshot | undefined;
  try {
    const read = readLandingZone(ops.getLandingZone(context.landingZoneArn), context.landingZoneArn);
    blockingProblems.push(...read.problems);
    landingZone = read.snapshot;
  } catch (error) {
    blockingProblems.push(`GetLandingZone failed: ${message(error)}`);
  }

  let inProgress: InProgressOperation;
  try {
    inProgress = findInProgressOperation(
      collectLandingZoneOperations((token) => ops.listLandingZoneOperationsPage(token))
    );
  } catch (error) {
    inProgress = { kind: 'ambiguous', reasons: [message(error)] };
  }

  const live: LiveAutoEnrollment = landingZone?.autoEnrollment ?? {
    kind: 'malformed',
    reason: 'the Landing Zone could not be read'
  };
  const decision = decideAutoEnrollment({
    desiredEnabled: context.desiredEnabled,
    live,
    inProgress,
    blockingProblems,
    healthProblems:
      landingZone === undefined
        ? []
        : landingZoneHealthProblems(landingZone, {
            version: context.expectedVersion,
            manifest: context.expectedManifest
          }),
    landingZoneStatus: landingZone?.status ?? ''
  });
  return { landingZone, live, inProgress, decision };
}

function describeLive(live: LiveAutoEnrollment): string {
  return live.kind === 'malformed' ? `malformed (${live.reason})` : live.kind;
}

export function renderPlan(context: AutoEnrollmentContext, plan: AutoEnrollmentPlan): string[] {
  const lz = plan.landingZone;
  const inProgress =
    plan.inProgress.kind === 'none'
      ? 'none'
      : plan.inProgress.kind === 'one'
        ? `${plan.inProgress.operationIdentifier} (${plan.inProgress.operationType})`
        : `ambiguous (${plan.inProgress.reasons.join('; ')})`;
  return [
    `AWS Control Tower auto-enrollment plan (${context.environment})`,
    `  Landing Zone:                 ${context.landingZoneArn}`,
    `  Version / status / drift:     ${lz === undefined ? '<unreadable>' : `${lz.version} / ${lz.status} / ${lz.driftStatus}`}`,
    `  Configured auto-enrollment:   ${context.desiredEnabled ? 'enabled' : 'disabled'}`,
    `  Live auto-enrollment:         ${describeLive(plan.live)}`,
    `  In-progress LZ operation:     ${inProgress}`,
    `  Decision:                     ${plan.decision.action}`,
    ...plan.decision.reasons.map((reason) => `    - ${reason}`)
  ];
}

// ---------------------------------------------------------------------------------------------
// Apply.
// ---------------------------------------------------------------------------------------------

export interface ApplyRoundOptions {
  readonly sessionBudgetSeconds: number;
  readonly jobDeadlineEpoch: number | undefined;
  readonly log?: (line: string) => void;
}

interface RoundBudget {
  readonly sessionDeadlineMs: number;
  readonly jobDeadlineEpoch: number | undefined;
}

type PollResult =
  | {
      readonly outcome: 'SUCCEEDED' | 'FAILED';
      readonly startedAtMs: number;
      readonly statusMessage?: string;
    }
  | RoundStatus;

/**
 * Polls one Landing Zone operation until it is terminal or a budget runs out. Every response is
 * validated strictly; a malformed response, or an operation running longer than
 * `OPERATION_TIMEOUT_MINUTES`, stops the run without any resubmission.
 */
async function pollLandingZoneOperation(
  ops: AutoEnrollmentOperations,
  clock: AutoEnrollmentClock,
  ledgers: AutoEnrollmentLedgerStore,
  budget: RoundBudget,
  operation: { readonly operationIdentifier: string; readonly operationType: LandingZoneOperationType },
  log: (line: string) => void
): Promise<PollResult> {
  let previous: string | undefined;
  for (;;) {
    const classification = classifyLandingZoneOperation(
      ops.getLandingZoneOperation(operation.operationIdentifier),
      operation
    );
    if (classification.outcome === 'MALFORMED') {
      throw new Error(
        `GetLandingZoneOperation ${operation.operationIdentifier} returned a malformed response: ` +
          `${classification.reason ?? 'unknown reason'}. Nothing was resubmitted; investigate in AWS Control Tower ` +
          'before re-running.'
      );
    }
    if (classification.outcome !== previous) {
      log(`    [poll] ${operation.operationIdentifier} (${operation.operationType}) -> ${classification.outcome}`);
      previous = classification.outcome;
    }

    let startedAtMs = classification.startedAtMs;
    if (startedAtMs === undefined) {
      const ledger = ledgers.read();
      startedAtMs = ledger.firstObservedAt[operation.operationIdentifier] ?? clock.now();
      ledger.firstObservedAt[operation.operationIdentifier] = startedAtMs;
      ledgers.write(ledger);
    }

    if (classification.outcome !== 'IN_PROGRESS') {
      return {
        outcome: classification.outcome,
        startedAtMs,
        ...(classification.statusMessage === undefined ? {} : { statusMessage: classification.statusMessage })
      };
    }
    if (operationTimedOut(startedAtMs, clock.now())) {
      throw new Error(
        `Landing Zone operation ${operation.operationIdentifier} (${operation.operationType}) has been IN_PROGRESS for ` +
          `more than ${OPERATION_TIMEOUT_MINUTES} minutes. No duplicate update was submitted. Re-run the workflow ` +
          'later: the next run finds this operation through ListLandingZoneOperations and polls it, or observes the ' +
          'completed setting.'
      );
    }
    const stop = pollStopReason({ nowMs: clock.now(), ...budget, neededSeconds: POLL_INTERVAL_SECONDS + 60 });
    if (stop !== undefined) return stop;
    await clock.sleep(POLL_INTERVAL_SECONDS);
  }
}

/** Waits, bounded, for the Landing Zone to leave `PROCESSING` after its operation succeeded. */
async function awaitLandingZoneSettled(
  ops: AutoEnrollmentOperations,
  clock: AutoEnrollmentClock,
  budget: RoundBudget,
  context: AutoEnrollmentContext,
  log: (line: string) => void
): Promise<'settled' | RoundStatus> {
  const startedAtMs = clock.now();
  for (;;) {
    const { snapshot } = readLandingZone(ops.getLandingZone(context.landingZoneArn), context.landingZoneArn);
    if (snapshot?.status !== 'PROCESSING') return 'settled';
    if (clock.now() - startedAtMs > SETTLE_TIMEOUT_MINUTES * 60 * 1000) {
      throw new Error(
        `The Landing Zone is still PROCESSING ${SETTLE_TIMEOUT_MINUTES} minutes after its operation succeeded. ` +
          'Nothing was resubmitted; re-run the workflow once it is ACTIVE.'
      );
    }
    log('    [settle] Landing Zone is PROCESSING; waiting for ACTIVE.');
    const stop = pollStopReason({ nowMs: clock.now(), ...budget, neededSeconds: POLL_INTERVAL_SECONDS + 60 });
    if (stop !== undefined) return stop;
    await clock.sleep(POLL_INTERVAL_SECONDS);
  }
}

function failedOperationError(
  ops: AutoEnrollmentOperations,
  operation: { readonly operationIdentifier: string; readonly operationType: LandingZoneOperationType },
  result: { readonly startedAtMs: number; readonly statusMessage?: string },
  ownUpdate: boolean
): Error {
  let diagnostics: string[];
  try {
    diagnostics = ops.diagnose(new Date(result.startedAtMs));
  } catch (error) {
    diagnostics = [`CloudTrail diagnostics could not run: ${message(error)}`];
  }
  return new Error(
    [
      `Landing Zone operation ${operation.operationIdentifier} (${operation.operationType}) FAILED: ` +
        `${result.statusMessage ?? '<no status message>'}.`,
      ownUpdate
        ? 'This was the auto-enrollment UpdateLandingZone submitted by this run.'
        : 'This operation was already in progress when the run started; no update was submitted.',
      ...(diagnostics.length === 0
        ? ['No CloudTrail AccessDenied / UnauthorizedOperation events were found since the operation started.']
        : diagnostics),
      'Nothing was resubmitted, and no ResetLandingZone, ResetEnabledBaseline, EnableBaseline or CreateLandingZone ' +
        'was attempted. Investigate (see the auto-enrollment skill, "Failure Investigation"), fix the cause through ' +
        'the approved process, then re-run the workflow.'
    ].join('\n  ')
  );
}

/**
 * One apply round. Re-plans from live state before every action and takes at most one
 * `UpdateLandingZone` per workflow run (run ledger). Returns `complete` when the configured state
 * is reached, `continue` when the credential budget is used up, or `job-budget-exhausted`.
 */
export async function runApplyRound(
  ops: AutoEnrollmentOperations,
  clock: AutoEnrollmentClock,
  ledgers: AutoEnrollmentLedgerStore,
  context: AutoEnrollmentContext,
  options: ApplyRoundOptions
): Promise<RoundStatus> {
  const log = options.log ?? ((line: string) => console.log(line));
  const budget: RoundBudget = {
    sessionDeadlineMs: clock.now() + options.sessionBudgetSeconds * 1000,
    jobDeadlineEpoch: options.jobDeadlineEpoch
  };

  const awaitOperation = async (
    operation: { readonly operationIdentifier: string; readonly operationType: LandingZoneOperationType },
    ownUpdate: boolean
  ): Promise<RoundStatus | 'succeeded'> => {
    const ledger = ledgers.read();
    ledger.lastOperationIdentifier = operation.operationIdentifier;
    ledgers.write(ledger);
    const result = await pollLandingZoneOperation(ops, clock, ledgers, budget, operation, log);
    if (typeof result === 'string') return result;
    if (result.outcome === 'FAILED') throw failedOperationError(ops, operation, result, ownUpdate);
    const settled = await awaitLandingZoneSettled(ops, clock, budget, context, log);
    return settled === 'settled' ? 'succeeded' : settled;
  };

  for (let step = 0; step < MAX_DECISIONS_PER_ROUND; step += 1) {
    const plan = buildAutoEnrollmentPlan(ops, context, { checkCli: true });
    for (const line of renderPlan(context, plan)) log(line);
    const { action, reasons } = plan.decision;

    if (action === 'stop') throw new Error(`Auto-enrollment prechecks failed:\n  ${reasons.join('\n  ')}`);
    if (action === 'none') return 'complete';

    if (action === 'await') {
      if (plan.inProgress.kind !== 'one') throw new Error('await decided without an identified operation.');
      const ledger = ledgers.read();
      const own = ledger.updateOperationIdentifier === plan.inProgress.operationIdentifier;
      const outcome = await awaitOperation(plan.inProgress, own);
      if (outcome !== 'succeeded') return outcome;
      continue;
    }

    // action === 'enable'
    const ledger = ledgers.read();
    if (ledger.updateAttempted) {
      throw new Error(
        'UpdateLandingZone was already attempted in this workflow run' +
          (ledger.updateOperationIdentifier === undefined ? '' : ` (operation ${ledger.updateOperationIdentifier})`) +
          ' and AWS still reports auto-enrollment disabled. It is not resubmitted. Investigate the operation and the ' +
          'Landing Zone in AWS Control Tower, then re-run the workflow.'
      );
    }
    const blocked = submissionStopReason({ nowMs: clock.now(), ...budget });
    if (blocked !== undefined) {
      log(
        blocked === 'job-budget-exhausted'
          ? '  Not enough job time left for the update, its polling and verification; UpdateLandingZone was not called.'
          : '  Not enough credential time left in this round; UpdateLandingZone is deferred to the next round.'
      );
      return blocked;
    }

    const version = plan.landingZone?.version;
    if (version === undefined) throw new Error('enable decided without a readable Landing Zone version.');
    ledger.updateAttempted = true;
    ledgers.write(ledger);
    log(
      `  Calling UpdateLandingZone: ${context.landingZoneArn}, version ${version}, repository manifest, ` +
        `remediationTypes ${AUTO_ENROLLMENT_REMEDIATION_TYPES.join(',')}.`
    );

    let response: unknown;
    try {
      response = ops.updateLandingZone({
        landingZoneArn: context.landingZoneArn,
        version,
        manifest: context.expectedManifest,
        remediationTypes: AUTO_ENROLLMENT_REMEDIATION_TYPES
      });
    } catch (error) {
      if (isConflictError(error)) {
        log(
          '  UpdateLandingZone returned ConflictException: another operation holds the Landing Zone. Not resubmitting.'
        );
        continue;
      }
      throw new Error(
        `UpdateLandingZone did not return a usable response: ${message(error)}. The request may or may not have ` +
          'been accepted, so it is NOT resubmitted. Re-run the workflow: the next run finds an in-progress operation ' +
          'through ListLandingZoneOperations and polls it, or observes the completed setting.',
        { cause: error }
      );
    }

    const operationIdentifier =
      typeof response === 'object' && response !== null
        ? (response as { operationIdentifier?: unknown }).operationIdentifier
        : undefined;
    if (!isLandingZoneOperationIdentifier(operationIdentifier)) {
      throw new Error(
        `UpdateLandingZone returned no valid operationIdentifier (${JSON.stringify(response)}). It is not ` +
          'resubmitted; check ListLandingZoneOperations and the Landing Zone in AWS Control Tower, then re-run.'
      );
    }
    const recorded = ledgers.read();
    recorded.updateOperationIdentifier = operationIdentifier;
    ledgers.write(recorded);
    log(`  UpdateLandingZone accepted: operation ${operationIdentifier}.`);

    const outcome = await awaitOperation({ operationIdentifier, operationType: 'UPDATE' }, true);
    if (outcome !== 'succeeded') return outcome;
  }
  throw new Error(
    `Auto-enrollment did not reach a stable decision within ${MAX_DECISIONS_PER_ROUND} plan iterations; investigate ` +
      'the Landing Zone operations before re-running.'
  );
}

// ---------------------------------------------------------------------------------------------
// Verify.
// ---------------------------------------------------------------------------------------------

/** Read-only final verification. Returns the live setting; throws with every problem found. */
export function runVerification(ops: AutoEnrollmentOperations, context: AutoEnrollmentContext): 'enabled' | 'disabled' {
  const read = readLandingZone(ops.getLandingZone(context.landingZoneArn), context.landingZoneArn);
  const problems = [...read.problems];
  if (read.snapshot !== undefined) {
    problems.push(
      ...verificationProblems(read.snapshot, {
        version: context.expectedVersion,
        manifest: context.expectedManifest,
        desiredEnabled: context.desiredEnabled
      })
    );
  }
  if (problems.length > 0 || read.snapshot === undefined) {
    throw new Error(
      `Auto-enrollment verification failed:\n  ${problems.join('\n  ')}\n  No reset and no second update is ` +
        'attempted. Investigate the Landing Zone in AWS Control Tower before re-running.'
    );
  }
  return read.snapshot.autoEnrollment.kind === 'enabled' ? 'enabled' : 'disabled';
}

// ---------------------------------------------------------------------------------------------
// AWS CLI implementation and entry point.
// ---------------------------------------------------------------------------------------------

function writeManifest(manifest: LandingZoneManifest): string {
  const runnerTemp = process.env['RUNNER_TEMP'] ?? tmpdir();
  const path = resolve(runnerTemp, `control-tower-auto-enrollment-manifest-${Date.now()}.json`);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

export class CliAutoEnrollmentOperations implements AutoEnrollmentOperations {
  public constructor(private readonly cli: AwsCli) {}

  public callerIdentity(): { Account?: string; Arn?: string } {
    return this.cli.json(['sts', 'get-caller-identity']);
  }

  public getLandingZone(landingZoneArn: string): unknown {
    return this.cli.json(['controltower', 'get-landing-zone', '--landing-zone-identifier', landingZoneArn]);
  }

  /** No status filter is sent; every operation is returned and inspected. */
  public listLandingZoneOperationsPage(startingToken: string | undefined): LandingZoneOperationsPage {
    const args = ['controltower', 'list-landing-zone-operations', '--max-items', String(OPERATIONS_PAGE_SIZE)];
    if (startingToken !== undefined) args.push('--starting-token', startingToken);
    return this.cli.json(args);
  }

  public getLandingZoneOperation(operationIdentifier: string): unknown {
    return this.cli.json<{ operationDetails?: unknown }>([
      'controltower',
      'get-landing-zone-operation',
      '--operation-identifier',
      operationIdentifier
    ]).operationDetails;
  }

  public updateLandingZone(request: UpdateLandingZoneRequest): unknown {
    return this.cli.json([
      'controltower',
      'update-landing-zone',
      '--landing-zone-identifier',
      request.landingZoneArn,
      '--landing-zone-version',
      request.version,
      '--manifest',
      `file://${writeManifest(request.manifest)}`,
      '--remediation-types',
      ...request.remediationTypes
    ]);
  }

  public cliSkeleton(command: string): unknown {
    return this.cli.json(['controltower', command, '--generate-cli-skeleton', 'input']);
  }

  public diagnose(startedAt: Date): string[] {
    return runCloudTrailDiagnostics(startedAt).map(
      (denial) =>
        `CloudTrail ${denial.eventTime} ${denial.eventSource} ${denial.eventName} ${denial.errorCode} ` +
        `${denial.principal}: ${denial.errorMessage}`
    );
  }
}

interface CliOptions {
  readonly mode: Mode;
  readonly environment: string;
  readonly managementAccountId: string;
  readonly landingZoneArn: string;
  readonly auditAccountId: string;
  readonly logArchiveAccountId: string;
  readonly stateFile: string | undefined;
  readonly sessionBudgetSeconds: number;
  readonly jobDeadlineEpoch: number | undefined;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument?.startsWith('--') === true && argument !== '--') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      values.set(argument.slice(2), value);
      index += 1;
    }
  }
  const required = (name: string): string => {
    const value = values.get(name);
    if (value === undefined || value.trim() === '') throw new Error(`--${name} is required.`);
    return value.trim();
  };
  const mode = required('mode');
  if (mode !== 'plan' && mode !== 'apply' && mode !== 'verify') {
    throw new Error(`--mode must be plan, apply or verify, not '${mode}'.`);
  }
  const sessionBudgetSeconds = Number(values.get('session-budget-seconds') ?? DEFAULT_SESSION_BUDGET_SECONDS);
  if (!Number.isInteger(sessionBudgetSeconds) || sessionBudgetSeconds <= 0 || sessionBudgetSeconds >= 3600) {
    throw new Error('--session-budget-seconds must be a whole number of seconds below one hour.');
  }
  const deadline = values.get('job-deadline-epoch');
  const jobDeadlineEpoch = deadline === undefined || deadline === '' ? undefined : Number(deadline);
  if (jobDeadlineEpoch !== undefined && !Number.isInteger(jobDeadlineEpoch)) {
    throw new Error('--job-deadline-epoch must be a whole number of epoch seconds.');
  }
  if (mode === 'apply' && jobDeadlineEpoch === undefined) {
    throw new Error('--job-deadline-epoch is required for --mode apply.');
  }
  return {
    mode,
    environment: required('environment'),
    managementAccountId: required('management-account-id'),
    landingZoneArn: required('landing-zone-arn'),
    auditAccountId: required('audit-account-id'),
    logArchiveAccountId: required('log-archive-account-id'),
    stateFile: mode === 'apply' ? required('state-file') : values.get('state-file'),
    sessionBudgetSeconds,
    jobDeadlineEpoch
  };
}

/** Builds the run context from validated configuration; refuses other environments first. */
export function buildContext(options: {
  readonly environment: string;
  readonly managementAccountId: string;
  readonly landingZoneArn: string;
  readonly auditAccountId: string;
  readonly logArchiveAccountId: string;
}): AutoEnrollmentContext {
  const environment = assertAutoEnrollmentEnvironment(options.environment);
  const config = loadConfig(environment);
  if (options.managementAccountId !== config.aws.accountId) {
    throw new Error(
      `management account '${options.managementAccountId}' does not match configuration '${config.aws.accountId}'.`
    );
  }
  return {
    environment,
    landingZoneArn: options.landingZoneArn,
    managementAccountId: config.aws.accountId,
    partition: config.aws.partition,
    region: config.aws.region,
    runtimeRegion: process.env['AWS_REGION'] ?? process.env['AWS_DEFAULT_REGION'],
    desiredEnabled: config.controlTower.autoEnrollment.enabled,
    expectedVersion: controlTowerLandingZoneVersion,
    expectedManifest: buildLandingZoneManifest(config.controlTower, {
      auditAccountId: options.auditAccountId,
      logArchiveAccountId: options.logArchiveAccountId
    })
  };
}

function fileLedgerStore(path: string): AutoEnrollmentLedgerStore {
  return {
    read: () => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as AutoEnrollmentLedger) : emptyLedger()),
    write: (ledger) => writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
  };
}

function emit(name: string, value: string): void {
  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined && output !== '') appendFileSync(output, `${name}=${value}\n`);
}

function summary(lines: readonly string[]): void {
  const file = process.env['GITHUB_STEP_SUMMARY'];
  if (file !== undefined && file !== '') appendFileSync(file, `${lines.join('\n')}\n`);
}

const realClock: AutoEnrollmentClock = {
  now: () => Date.now(),
  sleep: (seconds) => new Promise((done) => setTimeout(done, seconds * 1000))
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const context = buildContext(options);
  const ops = new CliAutoEnrollmentOperations(new AwsCli(context.region));

  if (options.mode === 'plan') {
    const plan = buildAutoEnrollmentPlan(ops, context, { checkCli: true });
    for (const line of renderPlan(context, plan)) console.log(line);
    emit('action', plan.decision.action);
    summary([
      `### AWS Control Tower auto-enrollment plan (${context.environment})`,
      `- Configured: \`${context.desiredEnabled ? 'enabled' : 'disabled'}\``,
      `- Live: \`${describeLive(plan.live)}\``,
      `- Decision: \`${plan.decision.action}\``
    ]);
    if (plan.decision.action === 'stop') {
      throw new Error(`Auto-enrollment prechecks failed:\n  ${plan.decision.reasons.join('\n  ')}`);
    }
    return;
  }

  if (options.mode === 'apply') {
    const ledgers = fileLedgerStore(options.stateFile ?? '');
    const status = await runApplyRound(ops, realClock, ledgers, context, {
      sessionBudgetSeconds: options.sessionBudgetSeconds,
      jobDeadlineEpoch: options.jobDeadlineEpoch
    });
    emit('status', status);
    console.log(`\nAuto-enrollment round status: ${status}`);
    return;
  }

  const live = runVerification(ops, context);
  emit('auto-enrollment', live);
  console.log(
    `\nAuto-enrollment verification passed: ${live} (configured ${context.desiredEnabled ? 'enabled' : 'disabled'}).`
  );
  summary([
    `### AWS Control Tower auto-enrollment (${context.environment})`,
    `- Configured: \`${context.desiredEnabled ? 'enabled' : 'disabled'}\``,
    `- Verified live setting: \`${live}\``
  ]);
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`\nAuto-enrollment configuration failed.\n${message(error)}`);
    process.exitCode = 1;
  });
}
