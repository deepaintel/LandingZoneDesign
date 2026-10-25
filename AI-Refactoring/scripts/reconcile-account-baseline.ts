#!/usr/bin/env tsx
/**
 * Common Account Security Baseline v1.0 (Staging and Production) - enable only.
 *
 * Governed by `.apm/skills/common-account-baseline/SKILL.md`. Invoked only by the `reconcile-account-baseline`
 * composite action inside the protected deployment job of an approved environment, after account
 * provisioning, Control Tower OU enrollment and auto-enrollment, with OIDC credentials for
 * `github-actions-role` configured. Never run from CI.
 *
 *   --phase plan    READ-ONLY. The environment-wide pre-apply completeness gate: inventory,
 *                   eligibility, sessions, capabilities, every control, DryRun authorization. Records
 *                   the first observations in the run ledger and exits non-zero unless the gate passes.
 *   --phase apply   One apply round: repeats the full gate from live state, then performs the planned
 *                   enable-only writes account by account with a pre-write recheck, bounded settle
 *                   polling and invariant checks. Prints `status=complete|continue|job-budget-exhausted`.
 *                   The first failure stops every further change and is recorded in the ledger.
 *   --phase verify  READ-ONLY. Post-deployment validation: re-reads every setting, evaluates the
 *                   acceptance gate, writes the job summary and `account-baseline-report.json`, and
 *                   exits non-zero unless the environment is accepted.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import {
  assertAccountBaselineEnvironment,
  type AccountBaselineEnvironment
} from '../config/schemas/account-baseline-schema.js';
import { LandingZoneSchema, type LandingZoneConfig } from '../config/schemas/organization-schema.js';
import {
  ApplyFailedError,
  PreflightBlockedError,
  recordFirstObservations,
  runApplyRound
} from '../lib/account-baseline/apply.js';
import { emptyLedger, type BaselineLedger, type LedgerStore } from '../lib/account-baseline/ledger.js';
import { buildBaselinePlan } from '../lib/account-baseline/plan.js';
import type { BaselineClock } from '../lib/account-baseline/ports.js';
import { buildReport, renderReportMarkdown } from '../lib/account-baseline/report.js';
import { AwsCliRunner, CliInventory, localCapabilityProblems } from './account-baseline-runtime.js';

type Phase = 'plan' | 'apply' | 'verify';

export const DEFAULT_SESSION_BUDGET_SECONDS = 3000;

interface CliOptions {
  readonly phase: Phase;
  readonly environment: AccountBaselineEnvironment;
  readonly managementAccountId: string;
  readonly organizationId: string;
  readonly landingZoneArn: string;
  readonly auditAccountId: string;
  readonly logArchiveAccountId: string;
  readonly accountIdsFile: string;
  readonly ouIdsFile: string;
  readonly stateFile: string;
  readonly reportFile: string | undefined;
  readonly sessionBudgetSeconds: number;
  readonly jobDeadlineEpoch: number | undefined;
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
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
  const phase = required('phase');
  if (phase !== 'plan' && phase !== 'apply' && phase !== 'verify') {
    throw new Error(`--phase must be plan, apply or verify, not '${phase}'.`);
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
  if (phase === 'apply' && jobDeadlineEpoch === undefined)
    throw new Error('--job-deadline-epoch is required for --phase apply.');
  return {
    phase,
    environment: assertAccountBaselineEnvironment(required('environment')),
    managementAccountId: required('management-account-id'),
    organizationId: required('organization-id'),
    landingZoneArn: required('landing-zone-arn'),
    auditAccountId: required('audit-account-id'),
    logArchiveAccountId: required('log-archive-account-id'),
    accountIdsFile: required('account-ids-file'),
    ouIdsFile: required('ou-ids-file'),
    stateFile: required('state-file'),
    reportFile: phase === 'verify' ? required('report-file') : values.get('report-file'),
    sessionBudgetSeconds,
    jobDeadlineEpoch
  };
}

export function fileLedgerStore(path: string, environment: AccountBaselineEnvironment): LedgerStore {
  return {
    read: () =>
      existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as BaselineLedger) : emptyLedger(environment),
    write: (ledger) => writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8')
  };
}

function loadConfig(environment: AccountBaselineEnvironment): LandingZoneConfig {
  return new ConfigReader(environment, { configDirName: 'config', schema: LandingZoneSchema }).getConfig();
}

function emit(name: string, value: string): void {
  const output = process.env['GITHUB_OUTPUT'];
  if (output !== undefined && output !== '') appendFileSync(output, `${name}=${value}\n`);
}

function summary(lines: readonly string[]): void {
  const file = process.env['GITHUB_STEP_SUMMARY'];
  if (file !== undefined && file !== '') appendFileSync(file, `${lines.join('\n')}\n`);
}

const realClock: BaselineClock = {
  now: () => Date.now(),
  sleep: (seconds) => new Promise((done) => setTimeout(done, seconds * 1000))
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const config = loadConfig(options.environment);
  if (options.managementAccountId !== config.aws.accountId) {
    throw new Error(
      `management account '${options.managementAccountId}' does not match configuration '${config.aws.accountId}'.`
    );
  }
  const inventory = new CliInventory(config, {
    environment: options.environment,
    managementAccountId: options.managementAccountId,
    organizationId: options.organizationId,
    landingZoneArn: options.landingZoneArn,
    auditAccountId: options.auditAccountId,
    logArchiveAccountId: options.logArchiveAccountId,
    accountIdLines: readFileSync(options.accountIdsFile, 'utf8'),
    ouIdLines: readFileSync(options.ouIdsFile, 'utf8')
  });
  const capabilityProblems = localCapabilityProblems(new AwsCliRunner(config.aws.region));
  const ledgers = fileLedgerStore(options.stateFile, options.environment);
  const commitSha = process.env['GITHUB_SHA'] ?? 'local';

  if (options.phase === 'apply') {
    const now = Date.now();
    try {
      const result = await runApplyRound(
        {
          environment: options.environment,
          config,
          inventory,
          capabilityProblems,
          ledgers,
          clock: realClock,
          today: today()
        },
        {
          roundDeadlineMs: now + options.sessionBudgetSeconds * 1000,
          jobDeadlineMs: (options.jobDeadlineEpoch ?? 0) * 1000
        }
      );
      emit('status', result.status);
      console.log(`Account baseline apply round: ${result.status} (${result.writesPerformed} write(s) performed).`);
    } catch (error) {
      if (error instanceof PreflightBlockedError) {
        summary(
          renderReportMarkdown(
            buildReport({ plan: error.plan, ledger: ledgers.read(), generatedAt: new Date().toISOString(), commitSha })
          )
        );
      }
      emit('status', error instanceof ApplyFailedError ? 'failed' : 'blocked');
      throw error;
    }
    return;
  }

  const ledger = ledgers.read();
  const plan = buildBaselinePlan({
    environment: options.environment,
    phase: options.phase === 'plan' ? 'preflight' : 'post-apply',
    config,
    inventory: await inventory.snapshot(),
    openSession: (accountId) => inventory.openSession(accountId),
    capabilityProblems,
    ledger,
    today: today()
  });
  if (options.phase === 'plan') {
    recordFirstObservations(ledger, plan);
    ledgers.write(ledger);
  }
  const report = buildReport({ plan, ledger, generatedAt: new Date().toISOString(), commitSha });
  const lines = renderReportMarkdown(report);
  console.log(lines.join('\n'));
  summary(lines);
  if (options.reportFile !== undefined) {
    writeFileSync(options.reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  emit('acceptance', report.acceptance);
  emit('results', `${report.actual.results}/${report.expected.results}`);
  if (report.acceptance !== 'PASS') {
    throw new Error(
      `Account baseline ${options.phase === 'plan' ? 'preflight' : 'acceptance'} failed for ${options.environment}:\n  ` +
        report.unresolvedIssues.join('\n  ')
    );
  }
  console.log(
    `\nAccount baseline ${options.phase === 'plan' ? 'preflight' : 'acceptance'} passed for ${options.environment}.`
  );
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  main().catch((error: unknown) => {
    console.error(`\nCommon Account Security Baseline failed.\n${(error as Error).message}`);
    process.exitCode = 1;
  });
}
