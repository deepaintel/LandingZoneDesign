/**
 * Common Account Security Baseline v1.0 - environment-wide plan (preflight) and verification.
 *
 * `buildBaselinePlan` is READ-ONLY. It is the mandatory pre-apply completeness gate when called with
 * `phase: 'preflight'`, and the post-deployment validation when called with `phase: 'post-apply'`:
 *
 *  1. resolve the expected matrix from configuration and the live inventory (identity, organization,
 *     Landing Zone and enrollment health, OU paths, exclusions, duplicates, expected count);
 *  2. if anything in (1) is blocked, NO member account is touched: every enforced cell is
 *     NOT_ASSESSED and the gate fails;
 *  3. otherwise open the established cross-account session per account and verify it is really that
 *     account; a failure makes every cell of the account ERROR;
 *  4. assess every control (local capability problems make a control UNSUPPORTED everywhere);
 *  5. preflight only: authorization-probe each planned EC2 write with `DryRun`;
 *  6. post-apply only: check invariants against the run's first observation (for example an
 *     unchanged default EBS KMS key);
 *  7. emit exactly one row per expected account and control, and evaluate acceptance.
 */

import type { AccountBaselineConfig } from '../../config/schemas/account-baseline-schema.js';
import type { LandingZoneConfig } from '../../config/schemas/organization-schema.js';
import { evaluateAcceptance, type AcceptancePhase, type AcceptanceResult } from './acceptance.js';
import { BASELINE_CONTROLS, describeFailure, type ControlContext, type RegisteredControl } from './controls/index.js';
import { buildExpectedMatrix, type EnforcedAccount } from './eligibility.js';
import { ledgerKey, performedWrites, type BaselineLedger } from './ledger.js';
import type { InventorySnapshot, MemberAccountPort } from './ports.js';
import {
  AwsCallError,
  type AccountBaselineControlId,
  type AccountBaselineEnvironment,
  type BaselineResultRow,
  type ControlAssessment,
  type ExpectedMatrix
} from './types.js';

export const MEMBER_ACCESS_ROLE_NAME = 'OrganizationAccountAccessRole';

export interface PlannedCell {
  readonly account: EnforcedAccount;
  readonly control: RegisteredControl;
  readonly assessment: ControlAssessment;
  readonly observation?: unknown;
}

export interface BaselinePlan {
  readonly environment: AccountBaselineEnvironment;
  readonly phase: AcceptancePhase;
  readonly matrix: ExpectedMatrix;
  readonly blockers: readonly string[];
  readonly cells: readonly PlannedCell[];
  readonly rows: readonly BaselineResultRow[];
  readonly acceptance: AcceptanceResult;
}

export interface PlanInput {
  readonly environment: AccountBaselineEnvironment;
  readonly phase: AcceptancePhase;
  readonly config: LandingZoneConfig;
  readonly inventory: InventorySnapshot;
  readonly openSession: (accountId: string) => MemberAccountPort;
  /** Local CLI capability problems per control (`cliCapabilityProblems`). */
  readonly capabilityProblems: ReadonlyMap<AccountBaselineControlId, readonly string[]>;
  readonly ledger?: BaselineLedger;
  readonly today: string;
  readonly controls?: readonly RegisteredControl[];
}

/** Problems with a member session's identity: it must be the target account, in the ESC partition, via the established role. */
export function memberIdentityProblems(
  identity: { readonly Account?: string; readonly Arn?: string },
  expected: { readonly accountId: string; readonly partition: string }
): string[] {
  const problems: string[] = [];
  if (identity.Account !== expected.accountId) {
    problems.push(`member session is for account '${identity.Account ?? '<none>'}', not ${expected.accountId}`);
  }
  const prefix = `arn:${expected.partition}:sts::${expected.accountId}:assumed-role/${MEMBER_ACCESS_ROLE_NAME}/`;
  if (typeof identity.Arn !== 'string' || !identity.Arn.startsWith(prefix)) {
    problems.push(`member session ARN '${identity.Arn ?? '<none>'}' is not ${prefix}*`);
  }
  return problems;
}

function controlContext(config: LandingZoneConfig, accountId: string): ControlContext {
  return {
    partition: config.aws.partition,
    region: config.aws.region,
    accountId,
    controls: config.accountBaseline.controls
  };
}

function withStatus(
  assessment: ControlAssessment,
  status: ControlAssessment['status'],
  reasons: readonly string[]
): ControlAssessment {
  return { ...assessment, status, writes: [], reasons: [...assessment.reasons, ...reasons] };
}

/** Preflight: an EC2 write must be authorized (DryRun) before the gate can pass. */
function probeWrites(session: MemberAccountPort, assessment: ControlAssessment): ControlAssessment {
  if (assessment.status !== 'NON_COMPLIANT') return assessment;
  for (const write of assessment.writes) {
    try {
      session.dryRun(write);
    } catch (error) {
      const unsupported = error instanceof AwsCallError && error.kind === 'unsupported';
      return withStatus(assessment, unsupported ? 'UNSUPPORTED' : 'ERROR', [
        `write ${write.kind} is not authorized or not available: ${describeFailure(error)}`
      ]);
    }
  }
  return assessment;
}

export function buildBaselinePlan(input: PlanInput): BaselinePlan {
  const controls = input.controls ?? BASELINE_CONTROLS;
  const {
    matrix,
    enforced,
    problems: matrixProblems
  } = buildExpectedMatrix({
    environment: input.environment,
    config: input.config,
    inventory: input.inventory
  });
  const blockers = [...input.inventory.problems, ...matrixProblems];
  if (input.ledger?.failure !== undefined) blockers.push(`apply stopped on a failure: ${input.ledger.failure}`);
  if (input.ledger !== undefined && input.ledger.environment !== input.environment) {
    blockers.push(`run ledger belongs to ${input.ledger.environment}, not ${input.environment}`);
  }

  const cells: PlannedCell[] = [];
  const blockedBeforeAccounts = input.inventory.problems.length > 0 || matrixProblems.length > 0;
  for (const account of enforced) {
    if (blockedBeforeAccounts) {
      for (const control of controls) {
        cells.push({
          account,
          control,
          assessment: {
            control: control.id,
            status: 'ERROR',
            observed: 'not assessed',
            required: control.required(controlContext(input.config, account.accountId)),
            writes: [],
            reasons: ['NOT_ASSESSED: the environment preflight is blocked; no member account was accessed'],
            fingerprint: ''
          }
        });
      }
      continue;
    }

    const context = controlContext(input.config, account.accountId);
    let session: MemberAccountPort | undefined;
    let sessionProblem: string | undefined;
    try {
      session = input.openSession(account.accountId);
      const identityProblems = memberIdentityProblems(session.callerIdentity(), {
        accountId: account.accountId,
        partition: input.config.aws.partition
      });
      if (identityProblems.length > 0) sessionProblem = identityProblems.join('; ');
    } catch (error) {
      sessionProblem = `cannot open a ${MEMBER_ACCESS_ROLE_NAME} session: ${describeFailure(error)}`;
    }

    for (const control of controls) {
      const capability = input.capabilityProblems.get(control.id) ?? [];
      if (session === undefined || sessionProblem !== undefined) {
        cells.push({
          account,
          control,
          assessment: {
            control: control.id,
            status: 'ERROR',
            observed: 'not readable',
            required: control.required(context),
            writes: [],
            reasons: [sessionProblem ?? 'no member session'],
            fingerprint: ''
          }
        });
        continue;
      }
      if (capability.length > 0) {
        cells.push({
          account,
          control,
          assessment: {
            control: control.id,
            status: 'UNSUPPORTED',
            observed: 'not assessed',
            required: control.required(context),
            writes: [],
            reasons: [...capability],
            fingerprint: ''
          }
        });
        continue;
      }
      const { assessment, observation } = control.assess(session, context);
      let final = input.phase === 'preflight' ? probeWrites(session, assessment) : assessment;
      if (input.phase === 'post-apply' && observation !== undefined) {
        const first = input.ledger?.cells[ledgerKey(account.accountId, control.id)];
        if (first !== undefined && first.firstObservation !== null) {
          const invariant = control.invariantProblems(first.firstObservation, observation);
          if (invariant.length > 0) final = withStatus(final, 'ERROR', invariant);
        }
      }
      cells.push({ account, control, assessment: final, ...(observation === undefined ? {} : { observation }) });
    }
  }

  const rows: BaselineResultRow[] = cells.map((cell) => {
    const first = input.ledger?.cells[ledgerKey(cell.account.accountId, cell.control.id)];
    const notAssessed = cell.assessment.reasons[0]?.startsWith('NOT_ASSESSED') === true;
    return {
      environment: input.environment,
      accountKey: cell.account.key,
      accountName: cell.account.name,
      accountId: cell.account.accountId,
      ouPath: cell.account.ouPath,
      control: cell.control.id,
      enforcement: 'enforced',
      status: notAssessed ? 'NOT_ASSESSED' : cell.assessment.status,
      previous: first?.firstObserved ?? cell.assessment.observed,
      required: cell.assessment.required,
      observed: cell.assessment.observed,
      plannedWrites: cell.assessment.writes,
      performedWrites:
        input.ledger === undefined ? [] : performedWrites(input.ledger, cell.account.accountId, cell.control.id),
      reason: cell.assessment.reasons.join('; ')
    };
  });
  for (const account of matrix.excludedAccounts) {
    for (const control of controls) {
      rows.push({
        environment: input.environment,
        accountKey: account.key,
        accountName: account.name,
        accountId: account.accountId,
        ouPath: account.ouPath,
        control: control.id,
        enforcement: 'excluded',
        status: 'EXCLUDED',
        previous: 'not assessed (excluded from v1.0)',
        required: 'not enforced',
        observed: 'not assessed (excluded from v1.0)',
        plannedWrites: [],
        performedWrites: [],
        reason: `excluded from v1.0 enforcement: ${account.reason}`
      });
    }
  }

  const acceptance = evaluateAcceptance({
    phase: input.phase,
    matrix: { ...matrix, controls: controls.map((control) => control.id) },
    rows,
    blockers,
    exceptions: input.config.accountBaseline.exceptions as AccountBaselineConfig['exceptions'],
    today: input.today
  });
  return { environment: input.environment, phase: input.phase, matrix, blockers, cells, rows, acceptance };
}
