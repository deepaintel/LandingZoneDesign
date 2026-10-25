#!/usr/bin/env tsx
/**
 * Plans, provisions, and validates the remaining Landing Zone accounts against AWS
 * Organizations. Invoked by the `deploy-landing-zone-accounts` composite action; requires the
 * AWS credentials the workflow configured. Never run locally against a live Organization.
 *
 * Governed by `.apm/skills/generate-account/SKILL.md`. The account inventory comes only from the merged
 * configuration of the selected environment and passes `assertLandingZoneAccountScope`, so a
 * Production run can only ever touch SharedServices and Network.
 *
 * Usage:
 *   provision-landing-zone-accounts.ts <plan|apply|validate>
 *     --environment staging|production --region <aws-region> [--report-file <path>]
 *
 *   plan      Read-only. Classifies every configured account (EXISTING_MATCH, MISSING,
 *             CONFLICT) and exits non-zero when any account is in CONFLICT.
 *   apply     Builds a fresh plan, refuses to run on any CONFLICT, then creates MISSING
 *             accounts one at a time and completes outstanding placement and tags.
 *   validate  Read-only. Builds a fresh plan and requires every account to be a fully
 *             reconciled EXISTING_MATCH. The report lists every account ID.
 *
 * The JSON report (`--report-file`) holds one row per configured account; the composite action
 * renders the plan summary and the `key=id` output from it.
 */

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { assertLandingZoneAccountScope } from '../config/schemas/landing-zone-accounts-schema.js';
import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import {
  applyAccountPlan,
  assertAccountPlanReconciled,
  buildAccountPlan,
  planConflicts,
  toDesiredLandingZoneAccounts,
  type AccountPlan
} from '../lib/organization/landing-zone-account-reconciler.js';
import {
  createOrganizationsAccountPort,
  createOrganizationsClient
} from '../lib/organization/organizations-account-adapter.js';

const MODES = ['plan', 'apply', 'validate'] as const;
const ENVIRONMENTS = ['staging', 'production'] as const;
type Mode = (typeof MODES)[number];
type Environment = (typeof ENVIRONMENTS)[number];

/** Organizations typically finishes CreateAccount within minutes; the bounds fail closed. */
const POLL_INTERVAL_MS = 15_000;
const CREATE_TIMEOUT_MS = 30 * 60_000;
const ACTIVE_TIMEOUT_MS = 10 * 60_000;
/**
 * Confirming a MoveAccount or TagResource write: Organizations usually reflects it within
 * seconds. Up to 25 reads, 5 s apart, before the run fails.
 */
const CONFIRM_POLL_INTERVAL_MS = 5_000;
const CONFIRM_TIMEOUT_MS = 2 * 60_000;

export interface CliOptions {
  readonly mode: Mode;
  readonly environment: Environment;
  readonly region: string;
  readonly reportFile?: string;
}

export function parseCliOptions(argv: readonly string[]): CliOptions {
  // `pnpm run <script> -- <args>` may forward the `--` separator itself.
  const [mode, ...rest] = argv.filter((arg) => arg !== '--');
  if (mode === undefined || !(MODES as readonly string[]).includes(mode)) {
    throw new Error(`First argument must be one of: ${MODES.join(', ')}.`);
  }
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] as string;
    const match = /^--(environment|region|report-file)(?:=(.*))?$/.exec(arg);
    if (match === null) {
      throw new Error(`Unknown argument '${arg}'.`);
    }
    const value = match[2] ?? rest[index + 1];
    if (match[2] === undefined) {
      index += 1;
    }
    if (value === undefined || value.length === 0) {
      throw new Error(`Missing value for --${match[1]}.`);
    }
    values.set(match[1] as string, value);
  }
  const environment = values.get('environment');
  if (environment === undefined || !(ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new Error(`--environment must be one of: ${ENVIRONMENTS.join(', ')}.`);
  }
  const region = values.get('region');
  if (region === undefined) {
    throw new Error('Missing required argument: --region.');
  }
  const reportFile = values.get('report-file');
  return {
    mode: mode as Mode,
    environment: environment as Environment,
    region,
    ...(reportFile === undefined ? {} : { reportFile })
  };
}

export function planReport(environment: Environment, mode: Mode, plan: AccountPlan) {
  return {
    environment,
    mode,
    count: plan.entries.length,
    conflicts: planConflicts(plan).length,
    accounts: plan.entries.map((entry) => ({
      key: entry.key,
      name: entry.name,
      email: entry.email,
      ouPath: entry.ouPath,
      targetOuId: entry.targetOuId,
      classification: entry.classification,
      accountId: entry.accountId ?? '',
      state: entry.state ?? '',
      currentParentId: entry.currentParentId ?? '',
      pendingActions: entry.pendingActions,
      reason: entry.reason ?? ''
    }))
  };
}

function printPlan(plan: AccountPlan): void {
  for (const entry of plan.entries) {
    const pending = entry.pendingActions.length > 0 ? ` pending=${entry.pendingActions.join('+')}` : '';
    console.log(
      `${entry.classification.padEnd(14)} ${entry.key} '${entry.name}' <${entry.email}> ` +
        `id=${entry.accountId ?? '-'} state=${entry.state ?? '-'} ` +
        `ou=${entry.ouPath} (${entry.targetOuId}) current=${entry.currentParentId ?? '-'}${pending}` +
        (entry.reason === undefined ? '' : `\n               reason: ${entry.reason}`)
    );
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const config = new ConfigReader(options.environment, {
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();
  if (options.region !== config.aws.region) {
    throw new Error(`--region '${options.region}' does not match the configured region '${config.aws.region}'.`);
  }
  assertLandingZoneAccountScope(options.environment, config.landingZoneAccounts);
  const desired = toDesiredLandingZoneAccounts(config.landingZoneAccounts);
  if (desired.length === 0) {
    throw new Error(`No Landing Zone accounts are configured for '${options.environment}'.`);
  }

  const port = createOrganizationsAccountPort(createOrganizationsClient(options.region), {
    log: (message) => console.log(message)
  });
  const managementAccountId = await port.getManagementAccountId();
  if (managementAccountId !== config.aws.accountId) {
    throw new Error(
      `Credentials belong to the Organization managed by ${managementAccountId}, not the configured ${config.aws.accountId}.`
    );
  }

  let plan = await buildAccountPlan(port, desired);
  console.log(`Landing Zone account plan for '${options.environment}' (${options.mode}):`);
  printPlan(plan);

  if (options.mode === 'apply' && planConflicts(plan).length === 0) {
    const results = await applyAccountPlan(port, plan, {
      pollIntervalMs: POLL_INTERVAL_MS,
      createTimeoutMs: CREATE_TIMEOUT_MS,
      activeTimeoutMs: ACTIVE_TIMEOUT_MS,
      confirmPollIntervalMs: CONFIRM_POLL_INTERVAL_MS,
      confirmTimeoutMs: CONFIRM_TIMEOUT_MS,
      log: (message) => console.log(message)
    });
    for (const result of results) {
      console.log(`${result.outcome.padEnd(8)} ${result.key} -> ${result.accountId}`);
    }
    plan = await buildAccountPlan(port, desired);
  }

  if (options.reportFile !== undefined) {
    writeFileSync(
      options.reportFile,
      `${JSON.stringify(planReport(options.environment, options.mode, plan), null, 2)}\n`
    );
  }

  const conflicts = planConflicts(plan);
  if (conflicts.length > 0) {
    throw new Error(
      `${conflicts.length} account(s) in CONFLICT: ${conflicts.map((entry) => entry.key).join(', ')}. No account was created.`
    );
  }
  if (options.mode === 'validate') {
    const ids = assertAccountPlanReconciled(plan);
    console.log(`All ${ids.length} Landing Zone accounts are reconciled.`);
  }
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`provision-landing-zone-accounts: ${message}`);
    process.exit(1);
  });
}
