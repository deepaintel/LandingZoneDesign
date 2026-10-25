#!/usr/bin/env tsx
/**
 * AWS Control Tower OU enrollment (Staging and Production).
 *
 * Governed by `.apm/skills/control-tower-account-enrollment/SKILL.md`. Invoked only by the
 * `enroll-control-tower-accounts` composite action inside the protected deployment job of an
 * approved environment, after OIDC credentials for `github-actions-role` are configured. Never run
 * from CI.
 *
 *   --mode plan    READ-ONLY. Discovery and every precheck; prints the plan; exits non-zero when
 *                  anything blocks mutation.
 *   --mode enroll  Repeats the plan and prechecks, then processes the rollout targets in order,
 *                  one at a time: EnableBaseline (not governed), ResetEnabledBaseline (at most once
 *                  per target per run), polling of an operation already in progress, or bounded
 *                  convergence while AWS Control Tower enrolls an account itself (auto-enrollment)
 *                  or another operation holds the OU. Stops at the first failed target. Validates
 *                  each OU after its operation succeeds.
 *
 * Credential and job budgets: `github-actions-role` sessions last one hour. Each enroll round
 * stops starting new work before `--session-budget-seconds` elapses and reports `continue`; the
 * composite action refreshes credentials and starts the next round, which resumes from live
 * Control Tower state (in-progress operations are polled, never resubmitted). When the job
 * deadline (`--job-deadline-epoch`) approaches, the round reports `job-budget-exhausted` and the
 * action fails cleanly so a workflow re-run resumes the rollout.
 *
 * Outputs: `status=complete|continue|job-budget-exhausted` in `$GITHUB_OUTPUT` and a per-OU table
 * in `$GITHUB_STEP_SUMMARY` when those files are available.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  classifyBaselineOperation,
  classifyTarget,
  convergenceDecision,
  isConflictError,
  isOperationIdentifier,
  plannedAction,
  type BaselineOperation,
  type EnabledBaselineSummary,
  type ExecutionRoleModel,
  type TargetState
} from '../lib/control-tower/baseline-enrollment.js';
import {
  AwsCli,
  buildEnrollmentPlan,
  configPrecheck,
  executionRoleModel,
  loadConfig,
  renderPlan,
  type EnrollmentPlan,
  type PlannedTarget,
  type RuntimeInputs
} from './control-tower-enrollment-runtime.js';

/** GetBaselineOperation / convergence poll cadence. */
export const POLL_INTERVAL_SECONDS = 30;
/** Ceiling for a single baseline operation, measured from its start time across rounds. */
export const OPERATION_TIMEOUT_MINUTES = 90;
/**
 * Ceiling for convergence: auto-enrollment of moved accounts, or another operation holding the OU.
 * Measured from the first observation in this workflow run (run ledger), so it holds across rounds.
 */
export const CONVERGENCE_TIMEOUT_MINUTES = 60;
/** Default per-round budget, leaving ten minutes of a one-hour credential session unused. */
export const DEFAULT_SESSION_BUDGET_SECONDS = 3000;
/** No new EnableBaseline / ResetEnabledBaseline starts with less than this left in either budget. */
export const MIN_MUTATION_HEADROOM_SECONDS = 600;
/** Safety margin before the job deadline at which a round stops polling. */
export const JOB_DEADLINE_MARGIN_SECONDS = 300;

type Mode = 'plan' | 'enroll';
export type RoundStatus = 'complete' | 'continue' | 'job-budget-exhausted';

interface CliOptions extends RuntimeInputs {
  readonly mode: Mode;
  readonly sessionBudgetSeconds: number;
  readonly jobDeadlineEpoch: number | undefined;
  readonly stateFile: string;
}

/** Per-workflow-run state shared by the rounds of one job (kept under `RUNNER_TEMP`). */
export interface RunLedger {
  /** Targets that already used their single ResetEnabledBaseline in this workflow run. */
  resets: Record<string, string>;
  /** Whether the execution-role model has been confirmed on an enrolled account. */
  executionRoleModelConfirmed: boolean;
  /** Epoch milliseconds at which convergence waiting started, per target. */
  convergenceStartedAt: Record<string, number>;
}

export interface LedgerStore {
  read(): RunLedger;
  write(ledger: RunLedger): void;
}

/** The AWS operations an enrollment round uses; the production implementation wraps `AwsCli`. */
export interface EnrollmentOperations {
  /** Read-only plan from live state (no AWS Config precheck; that runs per target). */
  plan(): Promise<EnrollmentPlan>;
  configPrecheck(plan: EnrollmentPlan, target: PlannedTarget): string[];
  executionRoleModel(plan: EnrollmentPlan, accountId: string): ExecutionRoleModel;
  listEnabledBaselines(
    filter: Readonly<Record<string, readonly string[]>>,
    includeChildren?: boolean
  ): EnabledBaselineSummary[];
  getBaselineOperation(operationIdentifier: string): BaselineOperation | undefined;
  enableBaseline(baselineArn: string, version: string, ouArn: string): { operationIdentifier?: string };
  resetEnabledBaseline(enabledBaselineArn: string): { operationIdentifier?: string };
  diagnose(plan: EnrollmentPlan, target: PlannedTarget, operation: BaselineOperation | undefined): string[];
}

export interface EnrollmentClock {
  now(): number;
  sleep(seconds: number): Promise<void>;
}

export interface RoundOptions {
  readonly sessionBudgetSeconds: number;
  readonly jobDeadlineEpoch: number | undefined;
  readonly log?: (message: string) => void;
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
  if (mode !== 'plan' && mode !== 'enroll') throw new Error(`--mode must be plan or enroll, not '${mode}'.`);
  const accountIdsFile = required('account-ids-file');
  const ouIdsFile = required('ou-ids-file');
  const deadline = values.get('job-deadline-epoch');
  return {
    mode,
    environment: required('environment'),
    managementAccountId: required('management-account-id'),
    organizationId: required('organization-id'),
    landingZoneArn: required('landing-zone-arn'),
    auditAccountId: required('audit-account-id'),
    logArchiveAccountId: required('log-archive-account-id'),
    accountIdLines: readFileSync(accountIdsFile, 'utf8'),
    ouIdLines: readFileSync(ouIdsFile, 'utf8'),
    sessionBudgetSeconds: Number(values.get('session-budget-seconds') ?? DEFAULT_SESSION_BUDGET_SECONDS),
    jobDeadlineEpoch: deadline === undefined || deadline === '' ? undefined : Number(deadline),
    stateFile: required('state-file')
  };
}

function fileLedgerStore(path: string): LedgerStore {
  return {
    read: () =>
      existsSync(path)
        ? (JSON.parse(readFileSync(path, 'utf8')) as RunLedger)
        : { resets: {}, executionRoleModelConfirmed: false, convergenceStartedAt: {} },
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

class Budget {
  private readonly sessionDeadline: number;

  public constructor(
    private readonly clock: EnrollmentClock,
    sessionBudgetSeconds: number,
    private readonly jobDeadline: number | undefined
  ) {
    this.sessionDeadline = clock.now() + sessionBudgetSeconds * 1000;
  }

  private secondsLeft(deadlineMs: number): number {
    return Math.floor((deadlineMs - this.clock.now()) / 1000);
  }

  /** `undefined` when work may continue; otherwise the status the round must report. */
  public stopReason(neededSeconds: number): RoundStatus | undefined {
    const jobLeft =
      this.jobDeadline === undefined ? Number.POSITIVE_INFINITY : this.secondsLeft(this.jobDeadline * 1000);
    if (jobLeft < neededSeconds + JOB_DEADLINE_MARGIN_SECONDS) return 'job-budget-exhausted';
    if (this.secondsLeft(this.sessionDeadline) < neededSeconds) return 'continue';
    return undefined;
  }
}

/** Live classification of one target, used after an operation and while awaiting convergence. */
function liveTargetState(ops: EnrollmentOperations, plan: EnrollmentPlan, target: PlannedTarget): TargetState {
  const records = ops.listEnabledBaselines({ targetIdentifiers: [target.ouArn] });
  const record = records.find((entry) => entry.baselineIdentifier === plan.controlTowerBaseline.arn);
  return classifyTarget({
    ouPath: target.target.ouPath,
    ouArn: target.ouArn,
    scope: {
      partition: plan.partition,
      region: plan.region,
      managementAccountId: plan.managementAccountId,
      organizationId: plan.organizationId
    },
    targetRecords: records,
    childRecords: record === undefined ? [] : ops.listEnabledBaselines({ parentIdentifiers: [record.arn] }, true),
    expectedAccountArns: target.accounts.map((account) => account.accountArn),
    controlTowerBaselineArn: plan.controlTowerBaseline.arn,
    configBaselineArn: plan.configBaseline?.arn,
    expectedVersion: plan.version.version,
    parentState: 'governed'
  });
}

/**
 * Polls an operation until it is terminal or a budget runs out. The 90-minute ceiling is measured
 * from the operation's own start time, so it holds across rounds.
 */
async function pollOperation(
  ops: EnrollmentOperations,
  clock: EnrollmentClock,
  operationIdentifier: string,
  budget: Budget,
  log: (message: string) => void
): Promise<
  | { outcome: 'SUCCEEDED' | 'FAILED'; operation: BaselineOperation | undefined }
  | { outcome: 'MALFORMED'; reason: string }
  | RoundStatus
> {
  let previous: string | undefined;
  for (;;) {
    const operation = ops.getBaselineOperation(operationIdentifier);
    const { outcome, reason } = classifyBaselineOperation(operation, operationIdentifier);
    if (outcome === 'MALFORMED') return { outcome, reason: reason ?? 'malformed response' };
    if (operation?.status !== previous) {
      log(`    [poll] ${operationIdentifier} -> ${operation?.status ?? '<unknown>'}`);
      previous = operation?.status;
    }
    if (outcome !== 'IN_PROGRESS') return { outcome, operation };
    const started = operation?.startTime === undefined ? clock.now() : Date.parse(operation.startTime);
    if (clock.now() - started > OPERATION_TIMEOUT_MINUTES * 60 * 1000) {
      throw new Error(
        `Baseline operation ${operationIdentifier} has been IN_PROGRESS for more than ${OPERATION_TIMEOUT_MINUTES} minutes. ` +
          'Investigate in AWS Control Tower before re-running; no duplicate operation was submitted.'
      );
    }
    const stop = budget.stopReason(POLL_INTERVAL_SECONDS + 60);
    if (stop !== undefined) return stop;
    await clock.sleep(POLL_INTERVAL_SECONDS);
  }
}

/**
 * Bounded wait for AWS Control Tower to finish work it started itself - auto-enrollment of a
 * moved account, or the operation behind a `ConflictException`. Never resets or resubmits; fails
 * closed when the target has not converged within `CONVERGENCE_TIMEOUT_MINUTES`.
 */
async function awaitConvergence(
  ops: EnrollmentOperations,
  clock: EnrollmentClock,
  budget: Budget,
  plan: EnrollmentPlan,
  target: PlannedTarget,
  ledgers: LedgerStore,
  log: (message: string) => void
): Promise<'converged' | RoundStatus> {
  const ledger = ledgers.read();
  const startedAtMs = ledger.convergenceStartedAt[target.target.ouPath] ?? clock.now();
  ledger.convergenceStartedAt[target.target.ouPath] = startedAtMs;
  ledgers.write(ledger);
  for (;;) {
    const state = liveTargetState(ops, plan, target);
    const decision = convergenceDecision({
      state: state.kind,
      startedAtMs,
      nowMs: clock.now(),
      timeoutMs: CONVERGENCE_TIMEOUT_MINUTES * 60 * 1000
    });
    log(`    [converge] ${target.target.ouPath}: ${state.kind} -> ${decision}`);
    if (decision === 'converged') return 'converged';
    if (decision === 'unexpected') {
      const reasons = state.kind === 'incompatible' ? `: ${state.reasons.join('; ')}` : '';
      throw new Error(`${target.target.ouPath}: state '${state.kind}' while awaiting convergence${reasons}.`);
    }
    if (decision === 'timeout') {
      throw new Error(
        `${target.target.ouPath} did not converge within ${CONVERGENCE_TIMEOUT_MINUTES} minutes (last state '${state.kind}'). ` +
          'No reset was attempted while AWS Control Tower was processing the OU; investigate before re-running.\n  ' +
          ops.diagnose(plan, target, undefined).join('\n  ')
      );
    }
    const stop = budget.stopReason(POLL_INTERVAL_SECONDS + 60);
    if (stop !== undefined) return stop;
    await clock.sleep(POLL_INTERVAL_SECONDS);
  }
}

/** Confirms on an enrolled, non-IAM-guarded account that the StackSets role deployed the execution role. */
function confirmExecutionRoleModel(
  ops: EnrollmentOperations,
  plan: EnrollmentPlan,
  log: (message: string) => void
): void {
  for (const target of plan.targets) {
    if (target.iamEscalationGuarded || target.state.kind !== 'governed') continue;
    for (const account of target.accounts) {
      const model = ops.executionRoleModel(plan, account.accountId);
      if (model.problems.length === 0) {
        log(
          `  Execution-role model confirmed on ${account.key}: ${model.stackSetsExecutionRoles.join(', ')} deployed ` +
            'AWSControlTowerExecution; SCP-ESC-IAM-001 exempts that principal.'
        );
        return;
      }
      throw new Error(
        `Execution-role model check failed on ${account.key} (${account.accountId}): ${model.problems.join('; ')}. ` +
          'SCP-ESC-IAM-001 would block OU registration under Workloads; stopping before any Workloads OU.'
      );
    }
  }
  throw new Error(
    'No enrolled account outside SCP-ESC-IAM-001 scope is available to confirm the execution-role model. Enroll an ' +
      'OU outside Workloads first (the rollout order starts with Infrastructure).'
  );
}

/** Post-operation OU validation: governed at the expected version, every account enrolled, role present. */
function validateTarget(
  ops: EnrollmentOperations,
  plan: EnrollmentPlan,
  target: PlannedTarget,
  log: (message: string) => void
): void {
  const state = liveTargetState(ops, plan, target);
  if (state.kind !== 'governed') {
    throw new Error(`${target.target.ouPath}: post-enrollment state is '${state.kind}', expected governed.`);
  }
  for (const account of target.accounts) {
    if (!ops.executionRoleModel(plan, account.accountId).controlTowerExecutionRolePresent) {
      throw new Error(`${target.target.ouPath}: ${account.key} has no AWSControlTowerExecution role after enrollment.`);
    }
  }
  log(`  ${target.target.ouPath}: governed at ${plan.version.version}; ${target.accounts.length} account(s) enrolled.`);
}

/**
 * One enrollment round. Builds the plan from live state first and refuses to mutate anything when
 * it reports a problem; then processes the rollout targets in order.
 */
export async function runEnrollmentRound(
  ops: EnrollmentOperations,
  clock: EnrollmentClock,
  ledgers: LedgerStore,
  options: RoundOptions
): Promise<RoundStatus> {
  const log = options.log ?? ((message: string) => console.log(message));
  const budget = new Budget(clock, options.sessionBudgetSeconds, options.jobDeadlineEpoch);
  const replan = async (): Promise<EnrollmentPlan> => {
    const fresh = await ops.plan();
    if (fresh.problems.length > 0) throw new Error(`Enrollment prechecks failed:\n  ${fresh.problems.join('\n  ')}`);
    return fresh;
  };

  let plan = await replan();
  log(`  Account auto-enrollment: ${plan.autoEnrollment.enabled ? 'enabled' : 'disabled'} (read only).`);
  for (let index = 0; ; index += 1) {
    const target = plan.targets[index];
    if (target === undefined) return 'complete';
    const ouPath = target.target.ouPath;

    const action = plannedAction(
      target.state,
      ledgers.read().resets[ouPath] !== undefined,
      plan.autoEnrollment.enabled
    );
    log(`\n[${index + 1}/${plan.targets.length}] ${ouPath}: ${target.state.kind} -> ${action}`);
    if (action === 'none') {
      validateTarget(ops, plan, target, log);
      continue;
    }
    if (action === 'stop') {
      const reasons = target.state.kind === 'incompatible' ? target.state.reasons.join('; ') : target.state.kind;
      throw new Error(
        `${ouPath}: cannot continue (${reasons}). ` +
          (ledgers.read().resets[ouPath] !== undefined ? 'Its single reset for this run was already used.' : '')
      );
    }
    if (action === 'converge') {
      const outcome = await awaitConvergence(ops, clock, budget, plan, target, ledgers, log);
      if (outcome !== 'converged') return outcome;
      validateTarget(ops, plan, target, log);
      plan = await replan();
      continue;
    }

    if (target.iamEscalationGuarded && !ledgers.read().executionRoleModelConfirmed) {
      confirmExecutionRoleModel(ops, plan, log);
      const ledger = ledgers.read();
      ledger.executionRoleModelConfirmed = true;
      ledgers.write(ledger);
    }

    let operationIdentifier: string;
    if (action === 'poll' && target.state.kind === 'in-progress') {
      operationIdentifier = target.state.operationIdentifier;
    } else {
      const stop = budget.stopReason(MIN_MUTATION_HEADROOM_SECONDS);
      if (stop !== undefined) return stop;
      const precheck = ops.configPrecheck(plan, target);
      if (precheck.length > 0) throw new Error(`AWS Config precheck failed:\n  ${precheck.join('\n  ')}`);
      if (!target.headroom.ok) throw new Error(`${ouPath}: SCP headroom exhausted.`);

      let response: { operationIdentifier?: string };
      try {
        if (action === 'enable') {
          log(`  EnableBaseline ${plan.controlTowerBaseline.arn} ${plan.version.version} -> ${target.ouArn}`);
          response = ops.enableBaseline(plan.controlTowerBaseline.arn, plan.version.version, target.ouArn);
        } else {
          const record =
            target.state.kind === 'previously-failed' || target.state.kind === 'governed-account-not-enrolled'
              ? target.state.record
              : undefined;
          if (record === undefined) throw new Error(`${ouPath}: no enabled baseline to reset.`);
          log(`  ResetEnabledBaseline ${record.arn} (single reset for this target in this run)`);
          response = ops.resetEnabledBaseline(record.arn);
        }
      } catch (error) {
        if (!isConflictError(error)) throw error;
        // Another operation holds the OU (AWS Control Tower or a concurrent caller). Wait for it
        // instead of resubmitting; nothing is recorded as this run's reset.
        log(`  ${ouPath}: ConflictException - awaiting the operation already in progress.`);
        const outcome = await awaitConvergence(ops, clock, budget, plan, target, ledgers, log);
        if (outcome !== 'converged') return outcome;
        validateTarget(ops, plan, target, log);
        plan = await replan();
        continue;
      }
      if (!isOperationIdentifier(response.operationIdentifier)) {
        throw new Error(
          `${action === 'enable' ? 'EnableBaseline' : 'ResetEnabledBaseline'} returned no operation identifier.`
        );
      }
      operationIdentifier = response.operationIdentifier;
      if (action === 'reset') {
        const ledger = ledgers.read();
        ledger.resets[ouPath] = operationIdentifier;
        ledgers.write(ledger);
      }
      log(`  operation ${operationIdentifier}`);
    }

    const result = await pollOperation(ops, clock, operationIdentifier, budget, log);
    if (typeof result === 'string') {
      log(`  ${result}: operation ${operationIdentifier} continues; the next round resumes polling it.`);
      return result;
    }
    if (result.outcome === 'MALFORMED') {
      // Not an AWS FAILED operation: no reset, retry or new operation; the job stops here.
      throw new Error(
        `GetBaselineOperation ${operationIdentifier} for ${ouPath} returned a malformed response: ${result.reason}. ` +
          'Stopping without any reset, retry or new operation; investigate in AWS Control Tower before re-running.\n  ' +
          ops.diagnose(plan, target, undefined).join('\n  ')
      );
    }
    if (result.outcome === 'FAILED') {
      throw new Error(
        `Enrollment of ${ouPath} failed:\n  ${ops.diagnose(plan, target, result.operation).join('\n  ')}`
      );
    }
    validateTarget(ops, plan, target, log);
    // Live state changed: later targets (children of this OU in particular) are re-classified.
    plan = await replan();
  }
}

/** Read-only diagnostics for a failed target: operation, child baselines, member-account denials. */
function diagnose(
  cli: AwsCli,
  plan: EnrollmentPlan,
  target: PlannedTarget,
  operation: BaselineOperation | undefined
): string[] {
  const lines = [
    `${target.target.ouPath}: operation ${operation?.operationIdentifier ?? '<none>'} ${operation?.operationType ?? ''} ` +
      `${operation?.status ?? '<unknown>'} - ${operation?.statusMessage ?? '<no status message>'}`
  ];
  const record = cli
    .listEnabledBaselines({ targetIdentifiers: [target.ouArn] })
    .find((entry) => entry.baselineIdentifier === plan.controlTowerBaseline.arn);
  if (record !== undefined) {
    for (const child of cli.listEnabledBaselines({ parentIdentifiers: [record.arn] }, true)) {
      lines.push(`  child ${child.targetIdentifier}: ${child.statusSummary?.status ?? '<none>'}`);
    }
  }
  const startTime = operation?.startTime ?? new Date(Date.now() - 3600 * 1000).toISOString();
  for (const account of target.accounts) {
    try {
      const env = cli.memberEnv(plan.partition, account.accountId, 'diag');
      const events =
        cli.json<{ Events?: { CloudTrailEvent?: string }[] }>(
          [
            'cloudtrail',
            'lookup-events',
            '--start-time',
            startTime,
            '--lookup-attributes',
            'AttributeKey=ReadOnly,AttributeValue=false',
            '--max-items',
            '500'
          ],
          env
        ).Events ?? [];
      const denials = events
        .map((event) => JSON.parse(event.CloudTrailEvent ?? '{}') as Record<string, unknown>)
        .filter((event) => String(event['errorCode'] ?? '').startsWith('AccessDenied'))
        .slice(0, 10);
      for (const denial of denials) {
        const identity = denial['userIdentity'] as { arn?: string } | undefined;
        lines.push(
          `  ${account.key}: ${String(denial['eventSource'])} ${String(denial['eventName'])} by ${identity?.arn ?? '<unknown>'}: ` +
            `${String(denial['errorMessage'] ?? '')}`
        );
      }
    } catch (error) {
      lines.push(`  ${account.key}: CloudTrail diagnostics unavailable (${(error as Error).message.split('\n')[0]})`);
    }
  }
  return lines;
}

function awsOperations(cli: AwsCli, inputs: RuntimeInputs): EnrollmentOperations {
  return {
    plan: () => buildEnrollmentPlan(cli, inputs, { configPrecheck: false }),
    configPrecheck: (plan, target) => configPrecheck(cli, plan.partition, target),
    executionRoleModel: (plan, accountId) => executionRoleModel(cli, plan.partition, accountId),
    listEnabledBaselines: (filter, includeChildren) => cli.listEnabledBaselines(filter, includeChildren),
    getBaselineOperation: (operationIdentifier) => cli.getBaselineOperation(operationIdentifier),
    enableBaseline: (baselineArn, version, ouArn) => cli.enableBaseline(baselineArn, version, ouArn),
    resetEnabledBaseline: (enabledBaselineArn) => cli.resetEnabledBaseline(enabledBaselineArn),
    diagnose: (plan, target, operation) => diagnose(cli, plan, target, operation)
  };
}

const systemClock: EnrollmentClock = {
  now: () => Date.now(),
  sleep: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000))
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const cli = new AwsCli(loadConfig(options.environment).aws.region);
  console.log(`AWS Control Tower OU enrollment (${options.environment}, mode=${options.mode})`);

  if (options.mode === 'plan') {
    const plan = await buildEnrollmentPlan(cli, options, { configPrecheck: true });
    const lines = renderPlan(plan);
    console.log(lines.join('\n'));
    summary([`### Control Tower enrollment plan (${options.environment})`, '', ...lines]);
    if (plan.problems.length > 0) {
      throw new Error(`Enrollment prechecks failed:\n  ${plan.problems.join('\n  ')}`);
    }
    console.log('\nAll enrollment prechecks passed. No AWS resource was changed.');
    return;
  }

  const status = await runEnrollmentRound(
    awsOperations(cli, options),
    systemClock,
    fileLedgerStore(options.stateFile),
    {
      sessionBudgetSeconds: options.sessionBudgetSeconds,
      jobDeadlineEpoch: options.jobDeadlineEpoch
    }
  );
  emit('status', status);
  console.log(`\nRound finished: ${status}.`);
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`\nControl Tower enrollment failed.\n${(error as Error).message}`);
    process.exitCode = 1;
  });
}
