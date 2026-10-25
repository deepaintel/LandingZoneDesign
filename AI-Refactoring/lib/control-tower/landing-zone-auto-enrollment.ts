/**
 * AWS Control Tower account auto-enrollment - pure decisions.
 *
 * Governed by `.apm/skills/control-tower-auto-enrollment/SKILL.md`. No AWS SDK, no AWS CLI, no filesystem and
 * no environment variables: `scripts/configure-control-tower-auto-enrollment.ts` gathers live
 * state and calls these functions, so every decision is unit-tested offline.
 *
 * Auto-enrollment is the Landing Zone remediation type `INHERITANCE_DRIFT`. The API model allows
 * `remediationTypes` to be absent (disabled) or a list of exactly one `INHERITANCE_DRIFT` item
 * (enabled); anything else is malformed and fails closed. This component only ENABLES the setting:
 *  - configured enabled, live enabled   -> no-op;
 *  - configured enabled, live disabled  -> exactly one `UpdateLandingZone` with the live Landing
 *                                          Zone ARN, the deployed version, the repository manifest
 *                                          and `INHERITANCE_DRIFT`;
 *  - configured disabled, live disabled -> no-op;
 *  - configured disabled, live enabled  -> fail closed; disabling is not supported here.
 * A Landing Zone operation already in progress is awaited, never raced; an operation that cannot
 * be identified, a malformed response, or an unhealthy Landing Zone stops before any write.
 */

import { AUTO_ENROLLMENT_REMEDIATION_TYPE, landingZoneProblems } from './baseline-enrollment.js';
import { compareManifests } from './landing-zone-manifest.js';

/** `remediationTypes` sent to `UpdateLandingZone` and expected back from `GetLandingZone`. */
export const AUTO_ENROLLMENT_REMEDIATION_TYPES = [AUTO_ENROLLMENT_REMEDIATION_TYPE] as const;

/** `LandingZoneOperationType` values of the AWS Control Tower API model. */
export const LANDING_ZONE_OPERATION_TYPES = ['CREATE', 'UPDATE', 'DELETE', 'RESET'] as const;
export type LandingZoneOperationType = (typeof LANDING_ZONE_OPERATION_TYPES)[number];

/** `LandingZoneOperationStatus` values of the AWS Control Tower API model. */
export const LANDING_ZONE_OPERATION_STATUSES = ['SUCCEEDED', 'FAILED', 'IN_PROGRESS'] as const;
export type LandingZoneOperationStatus = (typeof LANDING_ZONE_OPERATION_STATUSES)[number];

/** `LandingZoneStatus` values of the AWS Control Tower API model. */
export const LANDING_ZONE_STATUSES = ['ACTIVE', 'PROCESSING', 'FAILED'] as const;

/** `GetLandingZoneOperation` poll cadence. */
export const POLL_INTERVAL_SECONDS = 60;
/** Ceiling for one Landing Zone operation, measured from its start time across rounds. */
export const OPERATION_TIMEOUT_MINUTES = 90;
/** Ceiling for the Landing Zone to leave `PROCESSING` after its operation succeeded. */
export const SETTLE_TIMEOUT_MINUTES = 10;
/** Default per-round budget, leaving ten minutes of a one-hour credential session unused. */
export const DEFAULT_SESSION_BUDGET_SECONDS = 3000;
/** Safety margin before the job deadline at which a round stops polling. */
export const JOB_DEADLINE_MARGIN_SECONDS = 300;
/** Job time reserved after an update for final verification, including the enrollment validator. */
export const VERIFY_ALLOWANCE_SECONDS = 20 * 60;
/**
 * Job time that must remain before `UpdateLandingZone` may be submitted: the full operation
 * ceiling, the final verification and the deadline margin. Less than this fails before the write.
 */
export const UPDATE_REQUIRED_JOB_SECONDS =
  OPERATION_TIMEOUT_MINUTES * 60 + VERIFY_ALLOWANCE_SECONDS + JOB_DEADLINE_MARGIN_SECONDS;
/** No `UpdateLandingZone` starts with less than this left in the credential session. */
export const MIN_SUBMISSION_SESSION_SECONDS = 600;
/** Upper bound on `ListLandingZoneOperations` pages (the API returns the last 90 days). */
export const MAX_OPERATION_PAGES = 50;

const OPERATION_IDENTIFIER_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates an `UpdateLandingZone` / landing zone operation identifier (36-character UUID). */
export function isLandingZoneOperationIdentifier(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_IDENTIFIER_PATTERN.test(value);
}

function isOperationType(value: unknown): value is LandingZoneOperationType {
  return typeof value === 'string' && (LANDING_ZONE_OPERATION_TYPES as readonly string[]).includes(value);
}

function isOperationStatus(value: unknown): value is LandingZoneOperationStatus {
  return typeof value === 'string' && (LANDING_ZONE_OPERATION_STATUSES as readonly string[]).includes(value);
}

function isLandingZoneStatus(value: unknown): boolean {
  return typeof value === 'string' && (LANDING_ZONE_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------------------------
// Environment, identity and Landing Zone ARN.
// ---------------------------------------------------------------------------------------------

/** The Landing Zone ARN must be in the configured partition, home Region and management account. */
export function landingZoneArnProblems(
  arn: string,
  scope: { readonly partition: string; readonly region: string; readonly managementAccountId: string }
): string[] {
  const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `^arn:${escape(scope.partition)}:controltower:${escape(scope.region)}:${escape(scope.managementAccountId)}:landingzone/[^/\\s]+$`
  );
  return pattern.test(arn)
    ? []
    : [
        `Landing Zone ARN '${arn}' is not a ${scope.partition} Control Tower Landing Zone in ${scope.region} ` +
          `owned by management account ${scope.managementAccountId}`
      ];
}

/** A Region set in the runtime environment must be the configured home Region. */
export function runtimeRegionProblems(runtimeRegion: string | undefined, configuredRegion: string): string[] {
  if (runtimeRegion === undefined || runtimeRegion === '') return [];
  return runtimeRegion === configuredRegion
    ? []
    : [`runtime AWS Region '${runtimeRegion}' is not the configured home Region '${configuredRegion}'`];
}

/**
 * The installed AWS CLI must know the commands and request members this component relies on.
 * `skeleton` is the output of `aws controltower <command> --generate-cli-skeleton input`, which the
 * CLI produces from its local service model without calling AWS.
 */
export function cliSkeletonProblems(command: string, skeleton: unknown, requiredMembers: readonly string[]): string[] {
  if (!isObject(skeleton)) {
    return [`the installed AWS CLI has no usable 'controltower ${command}' command`];
  }
  const missing = requiredMembers.filter((member) => !Object.prototype.hasOwnProperty.call(skeleton, member));
  return missing.length === 0
    ? []
    : [
        `the installed AWS CLI 'controltower ${command}' does not support ${missing.join(', ')}; ` +
          'upgrade the runner AWS CLI before enabling auto-enrollment'
      ];
}

// ---------------------------------------------------------------------------------------------
// Landing Zone state.
// ---------------------------------------------------------------------------------------------

export type LiveAutoEnrollment =
  | { readonly kind: 'enabled' }
  | { readonly kind: 'disabled' }
  | { readonly kind: 'malformed'; readonly reason: string };

/**
 * Interprets `GetLandingZone.landingZone.remediationTypes`. Absent means disabled and exactly
 * `["INHERITANCE_DRIFT"]` means enabled; every other value, including an empty list, is malformed.
 */
export function parseRemediationTypes(value: unknown): LiveAutoEnrollment {
  if (value === undefined) return { kind: 'disabled' };
  if (!Array.isArray(value)) {
    return { kind: 'malformed', reason: `remediationTypes ${JSON.stringify(value)} is not a list` };
  }
  if (value.length === 1 && value[0] === AUTO_ENROLLMENT_REMEDIATION_TYPE) return { kind: 'enabled' };
  return {
    kind: 'malformed',
    reason: `remediationTypes ${JSON.stringify(value)} is neither absent nor exactly ["${AUTO_ENROLLMENT_REMEDIATION_TYPE}"]`
  };
}

export interface LandingZoneSnapshot {
  readonly arn: string;
  readonly version: string;
  readonly status: string;
  readonly driftStatus: string;
  readonly manifest: unknown;
  readonly autoEnrollment: LiveAutoEnrollment;
}

/**
 * Reads a `GetLandingZone` response. A missing `landingZone` object, an ARN other than the one
 * requested, a missing version or manifest, or a status outside the API model is a problem; the
 * snapshot is returned only when it can be trusted.
 */
export function readLandingZone(
  response: unknown,
  expectedArn: string
): { readonly snapshot?: LandingZoneSnapshot; readonly problems: readonly string[] } {
  const landingZone = isObject(response) ? response['landingZone'] : undefined;
  if (!isObject(landingZone)) return { problems: ['GetLandingZone returned no landingZone object'] };
  const problems: string[] = [];
  const { arn, version, status, driftStatus, manifest } = landingZone;
  if (arn !== undefined && arn !== expectedArn) {
    problems.push(`GetLandingZone returned Landing Zone '${String(arn)}', not ${expectedArn}`);
  }
  if (typeof version !== 'string' || version === '') problems.push('GetLandingZone returned no version');
  if (status !== undefined && !isLandingZoneStatus(status)) {
    problems.push(`Landing Zone status ${JSON.stringify(status)} is not one of ${LANDING_ZONE_STATUSES.join(', ')}`);
  }
  if (driftStatus !== undefined && !isObject(driftStatus)) {
    problems.push(`Landing Zone driftStatus ${JSON.stringify(driftStatus)} is malformed`);
  }
  if (!isObject(manifest)) problems.push('GetLandingZone returned no manifest object');
  if (problems.length > 0) return { problems };
  const drift = isObject(driftStatus) ? driftStatus['status'] : undefined;
  return {
    snapshot: {
      arn: expectedArn,
      version: version as string,
      status: typeof status === 'string' ? status : '',
      driftStatus: typeof drift === 'string' ? drift : '',
      manifest,
      autoEnrollment: parseRemediationTypes(landingZone['remediationTypes'])
    },
    problems
  };
}

/**
 * Landing Zone health required before any write and after it: the configured version, `ACTIVE`,
 * `IN_SYNC`, and a deployed manifest that matches the repository-built manifest on every material
 * field (the same comparison post-initialization validation uses).
 */
export function landingZoneHealthProblems(
  snapshot: LandingZoneSnapshot,
  expected: { readonly version: string; readonly manifest: unknown }
): string[] {
  return [
    ...landingZoneProblems(snapshot, expected.version),
    ...compareManifests(expected.manifest, snapshot.manifest).map((difference) => `manifest: ${difference}`)
  ];
}

// ---------------------------------------------------------------------------------------------
// Landing Zone operations.
// ---------------------------------------------------------------------------------------------

export interface LandingZoneOperationsPage {
  readonly landingZoneOperations?: unknown;
  /** AWS CLI pagination token (`--max-items` / `--starting-token`). */
  readonly NextToken?: unknown;
  /** Service pagination token, accepted in case the CLI passes it through. */
  readonly nextToken?: unknown;
}

/**
 * Collects every `ListLandingZoneOperations` page. No status filter is sent: every operation of the
 * last 90 days is returned and inspected, so an in-progress operation can never be filtered out by
 * an unsupported filter value. A page without the required list, a malformed or repeated token, or
 * more than `maxPages` pages fails closed.
 */
export function collectLandingZoneOperations(
  fetchPage: (startingToken: string | undefined) => LandingZoneOperationsPage,
  maxPages: number = MAX_OPERATION_PAGES
): unknown[] {
  const operations: unknown[] = [];
  const seen = new Set<string>();
  let token: string | undefined;
  for (let page = 1; page <= maxPages; page += 1) {
    const response = fetchPage(token);
    const list = isObject(response) ? response.landingZoneOperations : undefined;
    if (!Array.isArray(list)) {
      throw new Error("ListLandingZoneOperations returned no 'landingZoneOperations' list.");
    }
    operations.push(...list);
    const next = response.NextToken ?? response.nextToken;
    if (next === undefined || next === null) return operations;
    if (typeof next !== 'string' || next === '') {
      throw new Error(`ListLandingZoneOperations returned a malformed pagination token ${JSON.stringify(next)}.`);
    }
    if (seen.has(next)) throw new Error('ListLandingZoneOperations returned the same pagination token twice.');
    seen.add(next);
    token = next;
  }
  throw new Error(`ListLandingZoneOperations returned more than ${maxPages} pages; refusing to guess.`);
}

export type InProgressOperation =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'one';
      readonly operationIdentifier: string;
      readonly operationType: LandingZoneOperationType;
    }
  | { readonly kind: 'ambiguous'; readonly reasons: readonly string[] };

/**
 * Finds the Landing Zone operation in progress, if any. An entry whose status is outside the API
 * model (it might be in progress), an in-progress entry without a valid identifier or type, or more
 * than one in-progress operation is ambiguous and fails closed.
 */
export function findInProgressOperation(operations: readonly unknown[]): InProgressOperation {
  const reasons: string[] = [];
  const inProgress: { operationIdentifier: string; operationType: LandingZoneOperationType }[] = [];
  operations.forEach((entry, index) => {
    if (!isObject(entry)) {
      reasons.push(`operation #${index + 1} is not an object`);
      return;
    }
    const { status, operationIdentifier, operationType } = entry;
    if (!isOperationStatus(status)) {
      reasons.push(
        `operation ${String(operationIdentifier)} has status ${JSON.stringify(status)}, so it may be in progress`
      );
      return;
    }
    if (status !== 'IN_PROGRESS') return;
    if (!isLandingZoneOperationIdentifier(operationIdentifier)) {
      reasons.push(
        `an IN_PROGRESS operation has a missing or malformed identifier ${JSON.stringify(operationIdentifier)}`
      );
      return;
    }
    if (!isOperationType(operationType)) {
      reasons.push(`IN_PROGRESS operation ${operationIdentifier} has an unknown type ${JSON.stringify(operationType)}`);
      return;
    }
    inProgress.push({ operationIdentifier, operationType });
  });
  if (inProgress.length > 1) {
    reasons.push(
      `${inProgress.length} Landing Zone operations are IN_PROGRESS: ` +
        inProgress.map((operation) => `${operation.operationIdentifier} (${operation.operationType})`).join(', ')
    );
  }
  if (reasons.length > 0) return { kind: 'ambiguous', reasons };
  const [only] = inProgress;
  return only === undefined ? { kind: 'none' } : { kind: 'one', ...only };
}

export interface LandingZoneOperationClassification {
  readonly outcome: LandingZoneOperationStatus | 'MALFORMED';
  /** Why the response is `MALFORMED`. */
  readonly reason?: string;
  /** Operation start time (epoch milliseconds) when AWS reported one. */
  readonly startedAtMs?: number;
  readonly statusMessage?: string;
}

/**
 * `GetLandingZoneOperation.operationDetails` classification. Only the documented `FAILED` status is
 * `FAILED`. A missing or non-object `operationDetails`, an identifier other than the one requested,
 * a missing or different `operationType`, a missing or unknown `status`, or a start or end time that
 * is not a timestamp is `MALFORMED`: it fails closed and never leads to a resubmission.
 */
export function classifyLandingZoneOperation(
  details: unknown,
  expected: { readonly operationIdentifier: string; readonly operationType: LandingZoneOperationType }
): LandingZoneOperationClassification {
  if (!isObject(details)) return { outcome: 'MALFORMED', reason: 'the response has no operationDetails object' };
  const { operationIdentifier, operationType, status, startTime, endTime, statusMessage } = details;
  if (operationIdentifier !== undefined && operationIdentifier !== expected.operationIdentifier) {
    return {
      outcome: 'MALFORMED',
      reason: `operationIdentifier ${JSON.stringify(operationIdentifier)} is not the requested ${expected.operationIdentifier}`
    };
  }
  if (operationType === undefined) {
    return { outcome: 'MALFORMED', reason: 'operationType is missing, so the operation cannot be identified' };
  }
  if (operationType !== expected.operationType) {
    return {
      outcome: 'MALFORMED',
      reason: `operationType ${JSON.stringify(operationType)} is not the expected ${expected.operationType}`
    };
  }
  for (const [name, value] of [
    ['startTime', startTime],
    ['endTime', endTime]
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) {
      return { outcome: 'MALFORMED', reason: `${name} ${JSON.stringify(value)} is not a timestamp` };
    }
  }
  if (status === undefined) return { outcome: 'MALFORMED', reason: 'status is missing' };
  if (!isOperationStatus(status)) {
    return {
      outcome: 'MALFORMED',
      reason: `status ${JSON.stringify(status)} is not one of ${LANDING_ZONE_OPERATION_STATUSES.join(', ')}`
    };
  }
  return {
    outcome: status,
    ...(typeof startTime === 'string' ? { startedAtMs: Date.parse(startTime) } : {}),
    ...(typeof statusMessage === 'string' ? { statusMessage } : {})
  };
}

/** True once an operation has been running longer than `OPERATION_TIMEOUT_MINUTES`. */
export function operationTimedOut(
  startedAtMs: number,
  nowMs: number,
  timeoutMs: number = OPERATION_TIMEOUT_MINUTES * 60 * 1000
): boolean {
  return nowMs - startedAtMs > timeoutMs;
}

// ---------------------------------------------------------------------------------------------
// Budgets.
// ---------------------------------------------------------------------------------------------

export type RoundStatus = 'complete' | 'continue' | 'job-budget-exhausted';

interface BudgetClock {
  readonly nowMs: number;
  /** Epoch milliseconds at which this round's credential budget ends. */
  readonly sessionDeadlineMs: number;
  /** Job deadline in epoch SECONDS (`job-started-at` + `timeout-minutes`), when known. */
  readonly jobDeadlineEpoch: number | undefined;
}

function jobSecondsLeft(input: BudgetClock): number {
  return input.jobDeadlineEpoch === undefined
    ? Number.POSITIVE_INFINITY
    : Math.floor((input.jobDeadlineEpoch * 1000 - input.nowMs) / 1000);
}

/** `undefined` while polling may continue; otherwise the status the round must report. */
export function pollStopReason(input: BudgetClock & { readonly neededSeconds: number }): RoundStatus | undefined {
  if (jobSecondsLeft(input) < input.neededSeconds + JOB_DEADLINE_MARGIN_SECONDS) return 'job-budget-exhausted';
  if (Math.floor((input.sessionDeadlineMs - input.nowMs) / 1000) < input.neededSeconds) return 'continue';
  return undefined;
}

/**
 * `undefined` when `UpdateLandingZone` may be submitted now. The job must still hold the whole
 * operation ceiling plus verification (`UPDATE_REQUIRED_JOB_SECONDS`); otherwise the write is never
 * started. A short credential session only defers the write to the next round.
 */
export function submissionStopReason(input: BudgetClock): RoundStatus | undefined {
  if (jobSecondsLeft(input) < UPDATE_REQUIRED_JOB_SECONDS) return 'job-budget-exhausted';
  if (Math.floor((input.sessionDeadlineMs - input.nowMs) / 1000) < MIN_SUBMISSION_SESSION_SECONDS) return 'continue';
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Decision.
// ---------------------------------------------------------------------------------------------

export type AutoEnrollmentAction = 'none' | 'enable' | 'await' | 'stop';

export interface AutoEnrollmentDecisionInput {
  readonly desiredEnabled: boolean;
  readonly live: LiveAutoEnrollment;
  readonly inProgress: InProgressOperation;
  /** Problems that block every action: identity, Region, ARN, CLI support, unreadable state. */
  readonly blockingProblems: readonly string[];
  /** Landing Zone health problems: version, status, drift, manifest. */
  readonly healthProblems: readonly string[];
  readonly landingZoneStatus: string;
}

export interface AutoEnrollmentDecision {
  readonly action: AutoEnrollmentAction;
  readonly reasons: readonly string[];
}

/**
 * The single action this run may take. An identifiable in-progress Landing Zone operation is
 * awaited before anything else is decided (its Landing Zone is `PROCESSING` until it finishes);
 * every other path requires a healthy Landing Zone. The enable-only table then applies.
 */
export function decideAutoEnrollment(input: AutoEnrollmentDecisionInput): AutoEnrollmentDecision {
  if (input.blockingProblems.length > 0) return { action: 'stop', reasons: [...input.blockingProblems] };
  if (input.inProgress.kind === 'ambiguous') {
    return {
      action: 'stop',
      reasons: [
        'the in-progress Landing Zone operation cannot be identified, so no update is submitted',
        ...input.inProgress.reasons
      ]
    };
  }
  if (input.inProgress.kind === 'one') {
    return {
      action: 'await',
      reasons: [
        `Landing Zone operation ${input.inProgress.operationIdentifier} (${input.inProgress.operationType}) is IN_PROGRESS; ` +
          'it is awaited and the Landing Zone is re-read afterwards'
      ]
    };
  }
  if (input.live.kind === 'malformed') return { action: 'stop', reasons: [input.live.reason] };
  if (input.landingZoneStatus === 'PROCESSING') {
    return {
      action: 'stop',
      reasons: ['the Landing Zone is PROCESSING but no in-progress Landing Zone operation can be identified']
    };
  }
  if (input.healthProblems.length > 0) return { action: 'stop', reasons: [...input.healthProblems] };

  if (input.desiredEnabled) {
    return input.live.kind === 'enabled'
      ? { action: 'none', reasons: ['auto-enrollment is already enabled; no update is needed'] }
      : { action: 'enable', reasons: ['auto-enrollment is configured enabled and AWS reports it disabled'] };
  }
  return input.live.kind === 'disabled'
    ? { action: 'none', reasons: ['auto-enrollment is configured disabled and AWS reports it disabled'] }
    : {
        action: 'stop',
        reasons: [
          'auto-enrollment is configured disabled (controlTower.autoEnrollment.enabled: false) but AWS reports it ' +
            'enabled (remediationTypes ["INHERITANCE_DRIFT"]). This implementation never disables it. Either set the ' +
            "environment's controlTower.autoEnrollment.enabled to true through a reviewed release, or handle the " +
            'mismatch as a separately approved change; disabling must not be improvised as a rollback.'
        ]
      };
}

/**
 * Final verification after the run: the Landing Zone is healthy, its manifest still matches the
 * repository, and the live setting equals the configured one (enabled: exactly
 * `["INHERITANCE_DRIFT"]`; disabled: absent).
 */
export function verificationProblems(
  snapshot: LandingZoneSnapshot,
  expected: { readonly version: string; readonly manifest: unknown; readonly desiredEnabled: boolean }
): string[] {
  const problems = landingZoneHealthProblems(snapshot, expected);
  const live = snapshot.autoEnrollment;
  if (live.kind === 'malformed') {
    problems.push(live.reason);
  } else if (expected.desiredEnabled && live.kind !== 'enabled') {
    problems.push(
      'auto-enrollment is configured enabled but GetLandingZone does not report remediationTypes ["INHERITANCE_DRIFT"]'
    );
  } else if (!expected.desiredEnabled && live.kind !== 'disabled') {
    problems.push('auto-enrollment is configured disabled but GetLandingZone reports it enabled');
  }
  return problems;
}
