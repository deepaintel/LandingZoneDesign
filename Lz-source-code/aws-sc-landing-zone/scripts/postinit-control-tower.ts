#!/usr/bin/env tsx
/**
 * AWS Control Tower Landing Zone 4.0 post-initialisation validator.
 *
 * Governed by `.apm/instructions/control-tower-initialization.instructions.md` §21 and
 * `.apm/skills/initialize-control-tower/SKILL.md` (Post-Initialization Validation).
 *
 * Runs after a successful `CreateLandingZone` operation. All checks are read-only. Executes the
 * expected-vs-deployed manifest comparison per §21.1 (Manifest Comparison Rule), and performs
 * NAME-NEUTRAL discovery of the Control Tower-managed centralised logging bucket - no bucket
 * name or prefix is hard-coded or assumed.
 *
 * Shared-account IDs are supplied at the CLI (Path A). The Landing Zone ARN and the operation
 * identifier are captured from the preceding initialiser run.
 */

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import {
  awsAccountIdPattern,
  controlTowerGovernedRegion,
  controlTowerLandingZoneVersion
} from '../config/schemas/control-tower-schema.js';
import { buildLandingZoneManifest } from '../lib/control-tower/landing-zone-manifest.js';
import type { LandingZoneManifest, SharedAccountIds } from '../lib/control-tower/types.js';

const ENVIRONMENT_NAMES = ['staging', 'production'] as const;
type EnvironmentName = (typeof ENVIRONMENT_NAMES)[number];

const LANDING_ZONE_ARN_PATTERN = /^arn:aws-eusc:controltower:eusc-de-east-1:[0-9]{12}:landingzone\/.+$/;

interface CliOptions {
  readonly environment: EnvironmentName;
  readonly landingZoneArn: string;
  readonly auditAccountId: string;
  readonly logArchiveAccountId: string;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let environment: EnvironmentName | undefined;
  let landingZoneArn: string | undefined;
  let auditAccountId: string | undefined;
  let logArchiveAccountId: string | undefined;

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
    } else if (argument === '--landing-zone-arn') {
      if (value === undefined) throw new Error('--landing-zone-arn requires a value.');
      landingZoneArn = value;
      index += 1;
    } else if (argument === '--audit-account-id') {
      if (value === undefined) throw new Error('--audit-account-id requires a value.');
      auditAccountId = value;
      index += 1;
    } else if (argument === '--log-archive-account-id') {
      if (value === undefined) throw new Error('--log-archive-account-id requires a value.');
      logArchiveAccountId = value;
      index += 1;
    }
  }

  if (environment === undefined) throw new Error('--environment is required.');
  if (landingZoneArn === undefined) throw new Error('--landing-zone-arn is required.');
  if (auditAccountId === undefined) throw new Error('--audit-account-id is required.');
  if (logArchiveAccountId === undefined) throw new Error('--log-archive-account-id is required.');

  if (!LANDING_ZONE_ARN_PATTERN.test(landingZoneArn)) {
    throw new Error(`--landing-zone-arn '${landingZoneArn}' is not an aws-eusc Control Tower Landing Zone ARN.`);
  }
  if (!awsAccountIdPattern.test(auditAccountId)) {
    throw new Error(`--audit-account-id '${auditAccountId}' is not a 12-digit AWS account ID.`);
  }
  if (!awsAccountIdPattern.test(logArchiveAccountId)) {
    throw new Error(`--log-archive-account-id '${logArchiveAccountId}' is not a 12-digit AWS account ID.`);
  }

  return { environment, landingZoneArn, auditAccountId, logArchiveAccountId };
}

function cli(command: readonly string[]): unknown {
  try {
    return JSON.parse(execFileSync('aws', [...command, '--output', 'json', '--no-cli-pager'], { encoding: 'utf8' }));
  } catch (error) {
    throw new Error(`aws ${command.join(' ')} failed: ${(error as Error).message}`, { cause: error });
  }
}

/**
 * Pure: canonicalises a manifest object for the material-vs-metadata diff described in
 * instruction §21.1. Sorts object keys and strips AWS-generated read-only metadata that AWS
 * echoes back inside `GetLandingZone` but is not part of the repository-generated manifest.
 * Exported for tests.
 */
export function canonicaliseManifestForComparison(input: unknown): unknown {
  const nonMaterialKeys = new Set([
    'identifier',
    'createdTime',
    'lastUpdatedTime',
    'driftStatus',
    'latestAvailableVersion',
    'status',
    'version'
  ]);
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === 'object') {
      const entries: [string, unknown][] = [];
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        if (nonMaterialKeys.has(key)) continue;
        entries.push([key, walk((value as Record<string, unknown>)[key])]);
      }
      return Object.fromEntries(entries);
    }
    return value;
  };
  return walk(input);
}

/**
 * Pure: compares expected vs deployed after canonicalisation and returns an array of material
 * differences. Empty array = equivalent. Exported for tests.
 */
export function compareManifests(expected: unknown, deployed: unknown): readonly string[] {
  const a = JSON.stringify(canonicaliseManifestForComparison(expected));
  const b = JSON.stringify(canonicaliseManifestForComparison(deployed));
  if (a === b) return [];
  return [`Deployed manifest differs materially from expected. expected=${a} deployed=${b}`];
}

/**
 * Post-init check severity. Landing Zone health signals (`ACTIVE`, `IN_SYNC`, manifest drift,
 * shared-account placement) are hard-fail. Enrichment / capture-only checks that don't move the
 * Landing Zone health verdict (e.g. centralised logging bucket identity capture per
 * instruction §21.1 line 495, used by a later `SCP-ESC-SEC-002` scoping activity) use `warning`
 * (ran but produced no usable result) or `skipped` (couldn't run at all, e.g. permission gap
 * for read-only ad-hoc runs). Only `failed` contributes to the non-zero exit code.
 */
type CheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';

interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

function getLandingZone(landingZoneArn: string): {
  manifest: unknown;
  version: string;
  status: string;
  driftStatus: string;
} {
  const response = cli(['controltower', 'get-landing-zone', '--landing-zone-identifier', landingZoneArn]) as {
    landingZone?: {
      manifest?: unknown;
      version?: string;
      status?: string;
      driftStatus?: { status?: string };
    };
  };
  const lz = response.landingZone ?? {};
  return {
    manifest: lz.manifest,
    version: lz.version ?? '',
    status: lz.status ?? '',
    driftStatus: lz.driftStatus?.status ?? ''
  };
}

/**
 * Structured outcome of `discoverCentralisedLoggingBucket`. `status` is mapped by the caller to
 * a `CheckResult` severity: `passed` when at least one bucket matched the fingerprint,
 * `warning` when discovery ran but produced zero matches, `skipped` when discovery could not
 * run at all (e.g. `sts:AssumeRole` denied for the caller). The Landing Zone health verdict
 * never depends on this outcome — bucket-identity capture is an enrichment activity for the
 * later `SCP-ESC-SEC-002` scoping review per `.apm/instructions/control-tower-initialization.instructions.md`
 * §21.1 line 495.
 */
export interface BucketDiscoveryOutcome {
  readonly status: 'passed' | 'warning' | 'skipped';
  readonly detail: string;
  readonly bucketName?: string;
  readonly counts?: BucketDiscoveryCounts;
}

export interface BucketDiscoveryCounts {
  readonly bucketsListed: number;
  readonly bucketsTagged: number;
  readonly bucketsWithNoTags: number;
  readonly bucketsWithErrors: number;
}

/** Single tag as returned by `s3api get-bucket-tagging`. */
interface S3Tag {
  readonly Key?: string;
  readonly Value?: string;
}

/**
 * Pure fingerprint check. A bucket is treated as Control Tower-owned if it carries either the
 * `aws:controltower:LandingZoneArn` tag matching the current landing zone, or an
 * `aws:cloudformation:stack-name` tag whose value starts with a Control Tower-owned StackSet
 * prefix. Exported for tests. Name-neutral per instruction §9 — no bucket-name pattern is
 * consulted here.
 */
export function isControlTowerLoggingBucket(tags: readonly S3Tag[], landingZoneArn: string): boolean {
  return tags.some(
    (tag) =>
      (tag.Key === 'aws:controltower:LandingZoneArn' && tag.Value === landingZoneArn) ||
      (tag.Key === 'aws:cloudformation:stack-name' &&
        typeof tag.Value === 'string' &&
        (tag.Value.startsWith('AWSControlTowerBP-') || tag.Value.startsWith('AWSControlTowerStackSet-')))
  );
}

/** Formats the counts block for operator diagnostics. Exported for tests. */
export function formatDiscoveryCounts(counts: BucketDiscoveryCounts): string {
  return (
    `buckets listed=${counts.bucketsListed}, ` +
    `tagged=${counts.bucketsTagged}, ` +
    `no-tags=${counts.bucketsWithNoTags}, ` +
    `errors=${counts.bucketsWithErrors}`
  );
}

function discoverCentralisedLoggingBucket(logArchiveAccountId: string, landingZoneArn: string): BucketDiscoveryOutcome {
  // Name-neutral discovery per instructions §9 and §21.1: no `aws-controltower-logs-*` prefix
  // guess. AWSControlTowerExecution is created by Control Tower during initialisation, so
  // assuming into it AFTER a successful CreateLandingZone is the intended path. When that
  // assume-role is denied (e.g. an ad-hoc read-only run outside CI), report `skipped` — the
  // Landing Zone itself is already verified healthy by the earlier checks and this discovery
  // only feeds the later SCP-ESC-SEC-002 scoping activity.
  const roleArn = `arn:aws-eusc:iam::${logArchiveAccountId}:role/AWSControlTowerExecution`;
  let credsResponse: { Credentials?: { AccessKeyId?: string; SecretAccessKey?: string; SessionToken?: string } };
  try {
    credsResponse = cli([
      'sts',
      'assume-role',
      '--role-arn',
      roleArn,
      '--role-session-name',
      `lz-postinit-${logArchiveAccountId}`
    ]) as typeof credsResponse;
  } catch (error) {
    return {
      status: 'skipped',
      detail:
        `unable to assume ${roleArn}: ${firstLineOfError(error)}. ` +
        'Bucket-identity capture (§21.1) is enrichment-only; Landing Zone health is verified by the earlier checks.'
    };
  }
  const creds = credsResponse.Credentials ?? {};
  if (!creds.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
    return {
      status: 'skipped',
      detail: `assume-role for ${roleArn} returned no Credentials block; skipping bucket discovery.`
    };
  }
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: creds.AccessKeyId,
    AWS_SECRET_ACCESS_KEY: creds.SecretAccessKey,
    AWS_SESSION_TOKEN: creds.SessionToken
  };

  let listResponse: string;
  try {
    listResponse = execFileSync('aws', ['s3api', 'list-buckets', '--output', 'json', '--no-cli-pager'], {
      encoding: 'utf8',
      env
    });
  } catch (error) {
    return {
      status: 'skipped',
      detail: `s3api list-buckets failed in Log Archive: ${firstLineOfError(error)}.`
    };
  }
  const bucketNames = ((JSON.parse(listResponse) as { Buckets?: readonly { Name?: string }[] }).Buckets ?? [])
    .map((b) => b.Name)
    .filter((n): n is string => typeof n === 'string');

  const controlTowerOwned: string[] = [];
  const errorSamples: string[] = [];
  let bucketsTagged = 0;
  let bucketsWithNoTags = 0;
  let bucketsWithErrors = 0;

  for (const name of bucketNames) {
    let tagResponse: string;
    try {
      tagResponse = execFileSync(
        'aws',
        ['s3api', 'get-bucket-tagging', '--bucket', name, '--output', 'json', '--no-cli-pager'],
        { encoding: 'utf8', env }
      );
    } catch (error) {
      const message = firstLineOfError(error);
      // NoSuchTagSet is S3's documented response for a bucket that exists but has never had a
      // tag set applied. This is expected on many Log Archive buckets and is NOT a diagnostic
      // signal — count it separately from real errors.
      if (/NoSuchTagSet/i.test(message)) {
        bucketsWithNoTags += 1;
      } else {
        bucketsWithErrors += 1;
        // Preserve the first few errors verbatim so the operator can see specific failure modes
        // (PermanentRedirect / region mismatch, AccessDenied, throttling, etc.).
        if (errorSamples.length < 3) {
          errorSamples.push(`${name}: ${message}`);
        }
      }
      continue;
    }
    const tags = (JSON.parse(tagResponse) as { TagSet?: readonly S3Tag[] }).TagSet ?? [];
    if (tags.length === 0) {
      // Empty TagSet — bucket has a tagging configuration with zero tags. S3 sometimes returns
      // this instead of NoSuchTagSet; treat identically.
      bucketsWithNoTags += 1;
      continue;
    }
    bucketsTagged += 1;
    if (isControlTowerLoggingBucket(tags, landingZoneArn)) {
      controlTowerOwned.push(name);
    }
  }

  const counts: BucketDiscoveryCounts = {
    bucketsListed: bucketNames.length,
    bucketsTagged,
    bucketsWithNoTags,
    bucketsWithErrors
  };
  const countsSummary = formatDiscoveryCounts(counts);

  if (controlTowerOwned.length === 0) {
    const errorTail = errorSamples.length > 0 ? ` sample errors: ${errorSamples.join(' | ')}` : '';
    return {
      status: 'warning',
      detail:
        `no Control Tower-tagged buckets discovered in Log Archive (${countsSummary}).${errorTail} ` +
        'Landing Zone health is unaffected; this capture is only used by the later SCP-ESC-SEC-002 scoping review.',
      counts
    };
  }
  return {
    status: 'passed',
    detail: `discovered Control Tower-owned bucket(s) in Log Archive: ${controlTowerOwned.join(', ')} (${countsSummary})`,
    bucketName: controlTowerOwned[0],
    counts
  };
}

/** Extracts the first line of an error message for compact diagnostic output. */
function firstLineOfError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/, 1)[0] ?? message;
}

function runChecks(options: CliOptions): readonly CheckResult[] {
  const config = new ConfigReader(options.environment, {
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();

  const sharedIds: SharedAccountIds = {
    auditAccountId: options.auditAccountId,
    logArchiveAccountId: options.logArchiveAccountId
  };
  const expectedManifest: LandingZoneManifest = buildLandingZoneManifest(config.controlTower, sharedIds);

  const results: CheckResult[] = [];

  const lz = getLandingZone(options.landingZoneArn);
  if (lz.version !== controlTowerLandingZoneVersion) {
    results.push({
      name: 'Landing Zone version',
      status: 'failed',
      detail: `deployed version '${lz.version}' does not match expected '${controlTowerLandingZoneVersion}'.`
    });
  } else {
    results.push({ name: 'Landing Zone version', status: 'passed', detail: lz.version });
  }
  if (lz.status !== 'ACTIVE') {
    results.push({ name: 'Landing Zone status', status: 'failed', detail: `status='${lz.status}' (expected ACTIVE).` });
  } else {
    results.push({ name: 'Landing Zone status', status: 'passed', detail: 'ACTIVE' });
  }
  if (lz.driftStatus !== 'IN_SYNC') {
    results.push({
      name: 'Landing Zone drift',
      status: 'failed',
      detail: `driftStatus='${lz.driftStatus}' (expected IN_SYNC).`
    });
  } else {
    results.push({ name: 'Landing Zone drift', status: 'passed', detail: 'IN_SYNC' });
  }

  const differences = compareManifests(expectedManifest, lz.manifest);
  if (differences.length > 0) {
    for (const diff of differences) {
      results.push({ name: 'Manifest comparison', status: 'failed', detail: diff });
    }
  } else {
    results.push({
      name: 'Manifest comparison',
      status: 'passed',
      detail: 'deployed manifest matches expected on all material fields (§21.1).'
    });
  }

  // Shared-account placement re-check
  const securityChildren = cli(['organizations', 'list-accounts-for-parent', '--parent-id', resolveSecurityOuId()]) as {
    Accounts?: readonly { Id?: string; Name?: string; Status?: string }[];
  };
  const under = securityChildren.Accounts ?? [];
  const auditPresent = under.find((a) => a.Id === options.auditAccountId);
  const logArchivePresent = under.find((a) => a.Id === options.logArchiveAccountId);
  if (auditPresent === undefined || logArchivePresent === undefined) {
    results.push({
      name: 'Shared-account placement',
      status: 'failed',
      detail:
        `Audit=${auditPresent?.Name ?? '<missing>'} LogArchive=${logArchivePresent?.Name ?? '<missing>'} ` +
        'under the Security OU.'
    });
  } else {
    results.push({
      name: 'Shared-account placement',
      status: 'passed',
      detail: `Audit (${auditPresent.Id}) and Log Archive (${logArchivePresent.Id}) present under Security OU.`
    });
  }

  if (expectedManifest.centralizedLogging?.enabled) {
    const discovery = discoverCentralisedLoggingBucket(options.logArchiveAccountId, options.landingZoneArn);
    results.push({
      name: 'Centralised logging bucket discovery (name-neutral)',
      // Enrichment / capture-only check per instruction §21.1 line 495: never hard-fails the
      // post-init verdict. `warning` when discovery ran but produced no fingerprint match;
      // `skipped` when it couldn't run at all (assume-role or list-buckets denied).
      status: discovery.status,
      detail: discovery.detail
    });
  }

  return results;
}

function resolveSecurityOuId(): string {
  const value = execFileSync(
    'aws',
    [
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      'lz-ou-structure',
      '--query',
      "Stacks[0].Outputs[?OutputKey=='OuIdSecurity'].OutputValue | [0]",
      '--output',
      'text',
      '--no-cli-pager'
    ],
    { encoding: 'utf8' }
  ).trim();
  if (value === '' || value === 'None') {
    throw new Error('lz-ou-structure does not expose an OuIdSecurity output.');
  }
  return value;
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2));
  console.log(`AWS Control Tower Landing Zone 4.0 post-initialisation validator (${options.environment})`);
  console.log(`  region:                ${controlTowerGovernedRegion}`);
  console.log(`  landing zone ARN:      ${options.landingZoneArn}`);
  console.log(`  audit account:         ${options.auditAccountId}`);
  console.log(`  log archive account:   ${options.logArchiveAccountId}`);

  const results = runChecks(options);
  let failed = 0;
  let warnings = 0;
  let skipped = 0;
  console.log('');
  for (const r of results) {
    const marker =
      r.status === 'passed' ? 'PASS' : r.status === 'failed' ? 'FAIL' : r.status === 'warning' ? 'WARN' : 'SKIP';
    console.log(`  [${marker}] ${r.name} - ${r.detail}`);
    if (r.status === 'failed') failed += 1;
    else if (r.status === 'warning') warnings += 1;
    else if (r.status === 'skipped') skipped += 1;
  }
  // Only hard failures (Landing Zone health signals: version / status / drift / manifest /
  // shared-account placement) block the post-init verdict. Warnings and skips are surfaced but
  // never fail the run — see the enrichment-check rationale in instruction §21.1 line 495.
  if (failed > 0) {
    const suffix = warnings + skipped > 0 ? ` (${warnings} warning(s), ${skipped} skipped — non-blocking).` : '.';
    console.error(`\n${failed} post-initialisation check(s) failed${suffix}`);
    process.exitCode = 1;
    return;
  }
  const advisory = warnings + skipped > 0 ? ` ${warnings} warning(s), ${skipped} skipped (non-blocking).` : '';
  console.log(`\nAll hard-fail post-initialisation checks passed.${advisory}`);
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(`\nPost-initialisation validation failed.\n${(error as Error).message}`);
    process.exitCode = 1;
  }
}
