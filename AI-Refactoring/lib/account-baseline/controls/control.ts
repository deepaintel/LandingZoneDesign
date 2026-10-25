/**
 * Common Account Security Baseline v1.0 - control framework.
 *
 * A control is three independently testable parts:
 *  - `read`: gathers the observation through a `MemberAccountPort` (read-only calls only);
 *  - `classify`: PURE. Maps an observation to a status, a human-readable configuration and the
 *    enable-only writes that reach the target. A conflict is never resolved by a write: it is
 *    REQUIRES_APPROVAL with no writes;
 *  - `invariantProblems`: PURE. What must not change between two observations of the same account
 *    (for example the default EBS KMS key).
 *
 * `defineControl` wraps a control so failures are classified uniformly: an unsupported operation
 * or parameter is UNSUPPORTED, every other failure (access denied, timeout, throttling exhausted,
 * malformed response) is ERROR. Nothing is ever converted into COMPLIANT or skipped.
 */

import type { AccountBaselineConfig } from '../../../config/schemas/account-baseline-schema.js';
import type { MemberAccountPort } from '../ports.js';
import {
  AwsCallError,
  type AccountBaselineControlId,
  type AssessedStatus,
  type BaselineWrite,
  type ControlAssessment
} from '../types.js';

export interface ControlContext {
  readonly partition: string;
  readonly region: string;
  readonly accountId: string;
  readonly controls: AccountBaselineConfig['controls'];
}

export interface ClassifiedState {
  readonly status: Exclude<AssessedStatus, 'UNSUPPORTED'>;
  readonly observed: string;
  readonly writes: readonly BaselineWrite[];
  readonly reasons: readonly string[];
}

export interface BaselineControl<O> {
  readonly id: AccountBaselineControlId;
  readonly title: string;
  /** Bounded polling after a write: the setting must read back COMPLIANT within this budget. */
  readonly settle: { readonly attempts: number; readonly intervalSeconds: number };
  required(context: ControlContext): string;
  read(port: MemberAccountPort, context: ControlContext): O;
  classify(observation: O, context: ControlContext): ClassifiedState;
  invariantProblems(before: O, after: O): string[];
}

export interface AssessmentWithObservation {
  readonly assessment: ControlAssessment;
  /** Present when the read succeeded. */
  readonly observation?: unknown;
}

export interface RegisteredControl {
  readonly id: AccountBaselineControlId;
  readonly title: string;
  readonly settle: { readonly attempts: number; readonly intervalSeconds: number };
  required(context: ControlContext): string;
  assess(port: MemberAccountPort, context: ControlContext): AssessmentWithObservation;
  /** Classifies a recorded observation again (for example from the run ledger). */
  classifyRecorded(observation: unknown, context: ControlContext): ControlAssessment;
  invariantProblems(before: unknown, after: unknown): string[];
}

/** Canonical JSON: object keys sorted, so equal observations have equal fingerprints. */
export function canonicalJson(value: unknown): string {
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input as Record<string, unknown>)
          .sort()
          .map((key) => [key, walk((input as Record<string, unknown>)[key])])
      );
    }
    return input;
  };
  return JSON.stringify(walk(value) ?? null);
}

export function describeFailure(error: unknown): string {
  if (error instanceof AwsCallError) {
    return `${error.operation} failed${error.code === undefined ? '' : ` (${error.code})`}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function toAssessment<O>(control: BaselineControl<O>, context: ControlContext, observation: O): ControlAssessment {
  const classified = control.classify(observation, context);
  const fingerprint = canonicalJson(observation);
  // The status/write contract is enforced here rather than trusted: NON_COMPLIANT must carry the
  // writes that reach the target, and no other status may carry a write.
  if (classified.status === 'NON_COMPLIANT' && classified.writes.length === 0) {
    return {
      control: control.id,
      status: 'ERROR',
      observed: classified.observed,
      required: control.required(context),
      writes: [],
      reasons: [...classified.reasons, 'internal: NON_COMPLIANT without an enable-only write'],
      fingerprint
    };
  }
  return {
    control: control.id,
    status: classified.status,
    observed: classified.observed,
    required: control.required(context),
    writes: classified.status === 'NON_COMPLIANT' ? [...classified.writes] : [],
    reasons: [...classified.reasons],
    fingerprint
  };
}

export function defineControl<O>(control: BaselineControl<O>): RegisteredControl {
  return {
    id: control.id,
    title: control.title,
    settle: control.settle,
    required: (context) => control.required(context),
    assess: (port, context) => {
      let observation: O;
      try {
        observation = control.read(port, context);
      } catch (error) {
        const unsupported = error instanceof AwsCallError && error.kind === 'unsupported';
        return {
          assessment: {
            control: control.id,
            status: unsupported ? 'UNSUPPORTED' : 'ERROR',
            observed: 'not readable',
            required: control.required(context),
            writes: [],
            reasons: [describeFailure(error)],
            fingerprint: ''
          }
        };
      }
      try {
        return { assessment: toAssessment(control, context, observation), observation };
      } catch (error) {
        return {
          assessment: {
            control: control.id,
            status: 'ERROR',
            observed: 'not classifiable',
            required: control.required(context),
            writes: [],
            reasons: [describeFailure(error)],
            fingerprint: canonicalJson(observation)
          },
          observation
        };
      }
    },
    classifyRecorded: (observation, context) => toAssessment(control, context, observation as O),
    invariantProblems: (before, after) => control.invariantProblems(before as O, after as O)
  };
}
