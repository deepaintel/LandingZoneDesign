#!/usr/bin/env tsx
/**
 * AWS Control Tower Landing Zone 4.0 initialiser.
 *
 * Governed by `.apm/instructions/control-tower-initialization.instructions.md` §15, §16 and
 * `.apm/skills/initialize-control-tower/SKILL.md` (Initialization, Operation Polling, Failure
 * Investigation).
 *
 * ONE-TIME CONTROLLED BOOTSTRAP - invoked from a deploy workflow (`staging-deploy.yml` today,
 * `production-deploy.yml` when Production Control Tower initialisation is separately approved and
 * its shared-accounts prerequisite is wired), INSIDE the same job that deploys the OU / policy /
 * shared-accounts stacks. The calling workflow issues a `controltower:ListLandingZones`
 * idempotency check first; this initialiser runs only when no Landing Zone exists in the target
 * management account/region, so CreateLandingZone is invoked at most once per environment.
 * Subsequent release-branch (Staging) or dispatched (Production) deployments detect the existing
 * Landing Zone and skip both pre-init and this script.
 *
 * Authorisation gates are enforced entirely by the calling workflow: the protected `release/**`
 * branch trigger and protected `staging` GitHub Environment for Staging; `workflow_dispatch` +
 * `PRODUCTION_DEPLOYMENT_ENABLED == 'true'` + protected `production` GitHub Environment for
 * Production. Together with the runtime `list-landing-zones` gate they replace the earlier manual
 * `workflow_dispatch`-only initialisation workflow.
 *
 * Wire sequence:
 *   1. Run all pre-init checks (`preinit-control-tower.ts`); abort on any failure.
 *   2. Build the Landing Zone 4.0 manifest from validated configuration + runtime shared-account
 *      IDs; write the JSON to `RUNNER_TEMP`.
 *   3. `aws controltower create-landing-zone --landing-zone-version 4.0 --manifest file://...`.
 *   4. Capture landing zone ARN and operation identifier.
 *   5. Poll `aws controltower get-landing-zone-operation` every 60s, bounded to 90 minutes.
 *   6. On SUCCEEDED, exit 0. Post-init validation is a separate script.
 *   7. On FAILED, run CloudTrail-scoped failure diagnostics and exit non-zero.
 *
 * Never issues a second CreateLandingZone while the first operation is IN_PROGRESS - the pre-init
 * `controltower:ListLandingZones` check guarantees no active LZ exists before this script begins.
 *
 * Shared-account IDs are supplied at the CLI (Path A) and validated. Offline placeholders used by
 * the offline manifest validator are refused explicitly.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import {
  awsAccountIdPattern,
  controlTowerGovernedRegion,
  controlTowerLandingZoneVersion
} from '../config/schemas/control-tower-schema.js';
import { buildLandingZoneManifest } from '../lib/control-tower/landing-zone-manifest.js';
import type { ControlTowerOperationStatus } from '../lib/control-tower/types.js';
import {
  OFFLINE_PLACEHOLDER_AUDIT_ACCOUNT_ID,
  OFFLINE_PLACEHOLDER_LOG_ARCHIVE_ACCOUNT_ID
} from './validate-control-tower-manifest.js';

const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

/** Poll cadence for GetLandingZoneOperation (seconds). */
export const POLL_INTERVAL_SECONDS = 60;
/** Overall polling ceiling (minutes). */
export const POLL_TIMEOUT_MINUTES = 90;

interface CliOptions {
  readonly environment: EnvironmentName;
  readonly auditAccountId: string;
  readonly logArchiveAccountId: string;
  /** When true, everything runs except CreateLandingZone / GetLandingZoneOperation. */
  readonly dryRun: boolean;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let environment: EnvironmentName | undefined;
  let auditAccountId: string | undefined;
  let logArchiveAccountId: string | undefined;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--environment' || argument === '-e') {
      if (value === undefined) throw new Error('--environment requires a value.');
      const normalized = value.trim().toLowerCase();
      if (!(ENVIRONMENT_NAMES as readonly string[]).includes(normalized)) {
        throw new Error(`Unsupported environment '${value}'. Use one of: ${ENVIRONMENT_NAMES.join(', ')}.`);
      }
      environment = normalized as EnvironmentName;
      index += 1;
    } else if (argument === '--audit-account-id') {
      if (value === undefined) throw new Error('--audit-account-id requires a value.');
      auditAccountId = value;
      index += 1;
    } else if (argument === '--log-archive-account-id') {
      if (value === undefined) throw new Error('--log-archive-account-id requires a value.');
      logArchiveAccountId = value;
      index += 1;
    } else if (argument === '--dry-run') {
      dryRun = true;
    }
  }

  if (environment === undefined) throw new Error('--environment is required.');
  if (auditAccountId === undefined) throw new Error('--audit-account-id is required (Path A runtime input).');
  if (logArchiveAccountId === undefined) {
    throw new Error('--log-archive-account-id is required (Path A runtime input).');
  }

  return { environment, auditAccountId, logArchiveAccountId, dryRun };
}

function assertSharedAccountId(label: string, value: string): void {
  if (!awsAccountIdPattern.test(value)) {
    throw new Error(`${label} '${value}' is not a 12-digit AWS account ID.`);
  }
  if (value === OFFLINE_PLACEHOLDER_AUDIT_ACCOUNT_ID || value === OFFLINE_PLACEHOLDER_LOG_ARCHIVE_ACCOUNT_ID) {
    throw new Error(
      `${label} '${value}' is an offline placeholder from the manifest validator. ` +
        'The initializer requires real runtime IDs resolved from the lz-shared-accounts stack.'
    );
  }
}

function cli(command: readonly string[]): unknown {
  try {
    return JSON.parse(execFileSync('aws', [...command, '--output', 'json', '--no-cli-pager'], { encoding: 'utf8' }));
  } catch (error) {
    throw new Error(`aws ${command.join(' ')} failed: ${(error as Error).message}`, { cause: error });
  }
}

interface CreateLandingZoneResponse {
  readonly arn: string;
  readonly operationIdentifier: string;
}

export function invokeCreateLandingZone(manifestPath: string): CreateLandingZoneResponse {
  const response = cli([
    'controltower',
    'create-landing-zone',
    '--landing-zone-version',
    controlTowerLandingZoneVersion,
    '--manifest',
    `file://${manifestPath}`
  ]) as { arn?: string; operationIdentifier?: string };
  if (typeof response.arn !== 'string' || typeof response.operationIdentifier !== 'string') {
    throw new Error(`CreateLandingZone response is missing arn or operationIdentifier: ${JSON.stringify(response)}`);
  }
  return { arn: response.arn, operationIdentifier: response.operationIdentifier };
}

interface GetLandingZoneOperationResponse {
  readonly operationDetails?: {
    readonly status?: string;
    readonly statusMessage?: string;
    readonly operationIdentifier?: string;
  };
}

/**
 * Pure: given an operation-status response body, returns the terminal-state classification used
 * by the polling loop. Anything other than `IN_PROGRESS` or `SUCCEEDED` is treated as `FAILED`
 * so an unknown value never appears to succeed.
 */
export function classifyOperationStatus(response: GetLandingZoneOperationResponse): ControlTowerOperationStatus {
  const status = response.operationDetails?.status;
  if (status === 'SUCCEEDED') return 'SUCCEEDED';
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'FAILED';
}

async function sleepSeconds(seconds: number): Promise<void> {
  return new Promise((res) => setTimeout(res, seconds * 1000));
}

export async function pollOperationUntilTerminal(
  operationIdentifier: string,
  intervalSeconds: number = POLL_INTERVAL_SECONDS,
  timeoutMinutes: number = POLL_TIMEOUT_MINUTES,
  fetch: (id: string) => GetLandingZoneOperationResponse = (id) =>
    cli(['controltower', 'get-landing-zone-operation', '--operation-identifier', id]) as GetLandingZoneOperationResponse
): Promise<{ status: ControlTowerOperationStatus; response: GetLandingZoneOperationResponse; elapsedSeconds: number }> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMinutes * 60 * 1000;
  let previousStatus: string | undefined;
  while (Date.now() < deadline) {
    const response = fetch(operationIdentifier);
    const status = classifyOperationStatus(response);
    const rawStatus = response.operationDetails?.status ?? '<unknown>';
    if (rawStatus !== previousStatus) {
      console.log(`  [poll] status transition -> ${rawStatus}`);
      previousStatus = rawStatus;
    }
    if (status !== 'IN_PROGRESS') {
      return { status, response, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) };
    }
    await sleepSeconds(intervalSeconds);
  }
  throw new Error(
    `GetLandingZoneOperation ${operationIdentifier} did not reach a terminal state within ` +
      `${timeoutMinutes} minutes. No retry, no cleanup - investigate manually.`
  );
}

interface CloudTrailDenial {
  readonly eventTime: string;
  readonly eventSource: string;
  readonly eventName: string;
  readonly principal: string;
  readonly errorCode: string;
  readonly errorMessage: string;
}

const CLOUDTRAIL_DENIAL_SOURCES = [
  'controltower.amazonaws.com',
  'organizations.amazonaws.com',
  'config.amazonaws.com',
  'cloudtrail.amazonaws.com',
  's3.amazonaws.com',
  'kms.amazonaws.com'
];

export function runCloudTrailDiagnostics(startedAt: Date): readonly CloudTrailDenial[] {
  const startTime = startedAt.toISOString();
  const denials: CloudTrailDenial[] = [];
  for (const source of CLOUDTRAIL_DENIAL_SOURCES) {
    const response = cli([
      'cloudtrail',
      'lookup-events',
      '--lookup-attributes',
      `AttributeKey=EventSource,AttributeValue=${source}`,
      '--start-time',
      startTime
    ]) as { Events?: readonly { CloudTrailEvent?: string }[] };
    for (const event of response.Events ?? []) {
      if (typeof event.CloudTrailEvent !== 'string') continue;
      const parsed = JSON.parse(event.CloudTrailEvent) as {
        eventTime?: string;
        eventSource?: string;
        eventName?: string;
        userIdentity?: { arn?: string };
        errorCode?: string;
        errorMessage?: string;
      };
      const errorCode = parsed.errorCode ?? '';
      if (!['AccessDenied', 'AccessDeniedException', 'UnauthorizedOperation'].includes(errorCode)) {
        continue;
      }
      denials.push({
        eventTime: parsed.eventTime ?? '',
        eventSource: parsed.eventSource ?? source,
        eventName: parsed.eventName ?? '',
        principal: parsed.userIdentity?.arn ?? '',
        errorCode,
        errorMessage: parsed.errorMessage ?? ''
      });
    }
  }
  return denials;
}

function writeManifest(manifest: unknown): string {
  const runnerTemp = process.env['RUNNER_TEMP'] ?? tmpdir();
  const path = resolve(runnerTemp, `control-tower-landing-zone-manifest-${Date.now()}.json`);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  console.log(`AWS Control Tower Landing Zone 4.0 initialiser (${options.environment})`);
  console.log(`  version:                 ${controlTowerLandingZoneVersion}`);
  console.log(`  region:                  ${controlTowerGovernedRegion}`);
  console.log(`  audit account:           ${options.auditAccountId}`);
  console.log(`  log archive account:     ${options.logArchiveAccountId}`);
  console.log(`  dry-run:                 ${options.dryRun ? 'yes' : 'no'}`);

  assertSharedAccountId('auditAccountId', options.auditAccountId);
  assertSharedAccountId('logArchiveAccountId', options.logArchiveAccountId);
  if (options.auditAccountId === options.logArchiveAccountId) {
    throw new Error('audit and log archive account IDs must differ.');
  }

  const config = new ConfigReader(options.environment, {
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();

  const manifest = buildLandingZoneManifest(config.controlTower, {
    auditAccountId: options.auditAccountId,
    logArchiveAccountId: options.logArchiveAccountId
  });
  const manifestPath = writeManifest(manifest);
  console.log(`\n  Manifest written to ${manifestPath}`);

  if (options.dryRun) {
    console.log('\n  DRY-RUN: skipping CreateLandingZone and polling.');
    console.log(
      `  Would invoke: aws controltower create-landing-zone --landing-zone-version ${controlTowerLandingZoneVersion} --manifest file://${manifestPath}`
    );
    return;
  }

  const startedAt = new Date();
  console.log('\n  Invoking CreateLandingZone ...');
  const created = invokeCreateLandingZone(manifestPath);
  console.log(`  Landing Zone ARN:        ${created.arn}`);
  console.log(`  Operation identifier:    ${created.operationIdentifier}`);

  console.log(
    `\n  Polling GetLandingZoneOperation every ${POLL_INTERVAL_SECONDS}s (max ${POLL_TIMEOUT_MINUTES}min) ...`
  );
  const outcome = await pollOperationUntilTerminal(created.operationIdentifier);
  console.log(`  Terminal status: ${outcome.status} after ${outcome.elapsedSeconds}s`);

  if (outcome.status === 'FAILED') {
    console.error('\n  CreateLandingZone FAILED. Running CloudTrail failure diagnostics ...');
    const denials = runCloudTrailDiagnostics(startedAt);
    if (denials.length === 0) {
      console.error('  No CloudTrail AccessDenied / UnauthorizedOperation events found in the operation window.');
    } else {
      for (const denial of denials) {
        console.error(
          `  ${denial.eventTime}  ${denial.eventSource}  ${denial.eventName}  ${denial.errorCode}  ${denial.principal}`
        );
        console.error(`    ${denial.errorMessage}`);
      }
    }
    console.error(
      `\n  Operation ${created.operationIdentifier} failed: ${outcome.response.operationDetails?.statusMessage ?? '<no message>'}`
    );
    console.error('  Not modifying SCPs. Hand any SCP conflict to the approved SCP compatibility process.');
    process.exitCode = 1;
    return;
  }

  console.log('\n  CreateLandingZone SUCCEEDED. Run scripts/postinit-control-tower.ts next.');
  console.log(
    `  Persist for post-init: landingZoneArn=${created.arn} operationIdentifier=${created.operationIdentifier}`
  );
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  main().catch((error) => {
    console.error(`\nInitialisation failed.\n${(error as Error).message}`);
    process.exitCode = 1;
  });
}
