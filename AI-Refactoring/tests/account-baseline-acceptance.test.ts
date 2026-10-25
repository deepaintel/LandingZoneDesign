import { describe, expect, it } from 'vitest';

import { ACCOUNT_BASELINE_CONTROL_IDS } from '../config/schemas/account-baseline-schema.js';
import { evaluateAcceptance, type AcceptanceInput, type AcceptancePhase } from '../lib/account-baseline/acceptance.js';
import type {
  AccountBaselineEnvironment,
  BaselineResultRow,
  ExpectedMatrix,
  MatrixAccount,
  ResultStatus
} from '../lib/account-baseline/types.js';

/**
 * The centralized acceptance evaluator: every mandatory rule must hold, and any single unresolved
 * account/control result fails the whole environment.
 */

const CONTROLS = [...ACCOUNT_BASELINE_CONTROL_IDS];

function accounts(count: number, prefix = '2000000001'): MatrixAccount[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `account${index}`,
    name: `Account-${index}`,
    accountId: `${prefix}${String(index).padStart(2, '0')}`,
    ouPath: 'Workloads/Corp/Non-Prod'
  }));
}

function matrix(environment: AccountBaselineEnvironment, count: number): ExpectedMatrix {
  return {
    environment,
    controls: CONTROLS,
    enforcedAccounts: accounts(count),
    excludedAccounts: [
      {
        key: 'management',
        name: 'Management',
        accountId: '111111111111',
        ouPath: 'Root',
        reason: 'Management account'
      },
      { key: 'audit', name: 'Audit', accountId: '333333333333', ouPath: 'Security', reason: 'Audit' },
      { key: 'logArchive', name: 'Log Archive', accountId: '444444444444', ouPath: 'Security', reason: 'Log Archive' }
    ],
    expectedEnforcedAccountCount: count
  };
}

function row(
  environment: AccountBaselineEnvironment,
  account: MatrixAccount,
  control: (typeof CONTROLS)[number],
  status: ResultStatus,
  enforcement: 'enforced' | 'excluded' = 'enforced'
): BaselineResultRow {
  return {
    environment,
    accountKey: account.key,
    accountName: account.name,
    accountId: account.accountId,
    ouPath: account.ouPath,
    control,
    enforcement,
    status,
    previous: 'x',
    required: 'y',
    observed: 'z',
    plannedWrites: status === 'NON_COMPLIANT' ? [{ kind: 'EnableEbsEncryptionByDefault' }] : [],
    performedWrites: [],
    reason: status === 'COMPLIANT' ? '' : `status ${status}`
  };
}

function allRows(expected: ExpectedMatrix, status: ResultStatus = 'COMPLIANT'): BaselineResultRow[] {
  return [
    ...expected.enforcedAccounts.flatMap((account) =>
      CONTROLS.map((control) => row(expected.environment, account, control, status))
    ),
    ...expected.excludedAccounts.flatMap((account) =>
      CONTROLS.map((control) => row(expected.environment, account, control, 'EXCLUDED', 'excluded'))
    )
  ];
}

function evaluate(
  expected: ExpectedMatrix,
  rows: BaselineResultRow[],
  overrides: Partial<Omit<AcceptanceInput, 'matrix' | 'rows'>> & { phase?: AcceptancePhase } = {}
) {
  return evaluateAcceptance({
    phase: 'post-apply',
    matrix: expected,
    rows,
    blockers: [],
    exceptions: [],
    today: '2026-10-20',
    ...overrides
  });
}

function replace(rows: BaselineResultRow[], index: number, status: ResultStatus): BaselineResultRow[] {
  const copy = [...rows];
  const original = copy[index] as BaselineResultRow;
  copy[index] = {
    ...original,
    status,
    plannedWrites: status === 'NON_COMPLIANT' ? [{ kind: 'EnableEbsEncryptionByDefault' }] : []
  };
  return copy;
}

const staging = matrix('staging', 8);

describe('acceptance evaluator', () => {
  it('8 Staging accounts with all five controls compliant -> PASS with 40 enforced results', () => {
    const result = evaluate(staging, allRows(staging));
    expect(result.outcome).toBe('PASS');
    expect(result.problems).toEqual([]);
    expect(result.counts.COMPLIANT).toBe(40);
    expect(result.counts.EXCLUDED).toBe(15);
    expect(result.expectedResults).toBe(55);
  });

  it('2 Production accounts with all five controls compliant -> PASS with 10 enforced results', () => {
    const production = matrix('production', 2);
    const result = evaluate(production, allRows(production));
    expect(result.outcome).toBe('PASS');
    expect(result.counts.COMPLIANT).toBe(10);
  });

  it('7 compliant accounts and one account with a failed control -> FAIL', () => {
    const result = evaluate(staging, replace(allRows(staging), 37, 'ERROR'));
    expect(result.outcome).toBe('FAIL');
    expect(result.problems).toHaveLength(1);
  });

  it.each([
    ['NON_COMPLIANT after apply', 'NON_COMPLIANT'],
    ['an unresolved REQUIRES_APPROVAL', 'REQUIRES_APPROVAL'],
    ['an UNSUPPORTED result', 'UNSUPPORTED'],
    ['an ERROR result', 'ERROR'],
    ['a NOT_ASSESSED result', 'NOT_ASSESSED'],
    ['EXCLUDED on an enforced account', 'EXCLUDED']
  ] as const)('one %s -> FAIL', (_label, status) => {
    expect(evaluate(staging, replace(allRows(staging), 3, status)).outcome).toBe('FAIL');
  });

  it('allows NON_COMPLIANT in preflight only with an approved enable-only action', () => {
    const rows = replace(allRows(staging), 1, 'NON_COMPLIANT');
    expect(evaluate(staging, rows, { phase: 'preflight' }).outcome).toBe('PASS');
    const noAction = rows.map((entry, index) => (index === 1 ? { ...entry, plannedWrites: [] } : entry));
    expect(evaluate(staging, noAction, { phase: 'preflight' }).outcome).toBe('FAIL');
    const wrongAction = rows.map((entry, index) =>
      index === 1
        ? { ...entry, plannedWrites: [{ kind: 'EnableImageBlockPublicAccess', state: 'block-new-sharing' } as const] }
        : entry
    );
    expect(evaluate(staging, wrongAction, { phase: 'preflight' }).problems.join(' ')).toMatch(/not allowed/);
  });

  it('REQUIRES_APPROVAL fails in preflight as well', () => {
    expect(evaluate(staging, replace(allRows(staging), 0, 'REQUIRES_APPROVAL'), { phase: 'preflight' }).outcome).toBe(
      'FAIL'
    );
  });

  it('a missing account -> FAIL', () => {
    const rows = allRows(staging).filter((entry) => entry.accountId !== staging.enforcedAccounts[4]?.accountId);
    const result = evaluate(staging, rows);
    expect(result.outcome).toBe('FAIL');
    expect(result.problems.filter((problem) => problem.includes('no result'))).toHaveLength(5);
  });

  it('a missing control -> FAIL', () => {
    const rows = allRows(staging);
    rows.splice(7, 1);
    expect(evaluate(staging, rows).problems.join(' ')).toMatch(/no result/);
  });

  it('duplicate results -> FAIL', () => {
    const rows = allRows(staging);
    rows.push({ ...(rows[0] as BaselineResultRow) });
    expect(evaluate(staging, rows).problems.join(' ')).toMatch(/duplicate result/);
  });

  it('an excluded account included in enforcement -> FAIL', () => {
    const audit = staging.excludedAccounts[1] as MatrixAccount;
    const leaked: ExpectedMatrix = { ...staging, enforcedAccounts: [...staging.enforcedAccounts.slice(1), audit] };
    const result = evaluate(leaked, allRows(leaked));
    expect(result.outcome).toBe('FAIL');
    expect(result.problems.join(' ')).toMatch(/excluded account 333333333333 is in the enforced set/);
  });

  it('an excluded account reported with a status other than EXCLUDED, or with a write -> FAIL', () => {
    const rows = allRows(staging);
    const index = rows.findIndex((entry) => entry.enforcement === 'excluded');
    rows[index] = { ...(rows[index] as BaselineResultRow), status: 'COMPLIANT' };
    expect(evaluate(staging, rows).outcome).toBe('FAIL');
    const written = allRows(staging);
    written[index] = {
      ...(written[index] as BaselineResultRow),
      performedWrites: [{ kind: 'EnableEbsEncryptionByDefault' }]
    };
    expect(evaluate(staging, written).problems.join(' ')).toMatch(/excluded account has planned or performed writes/);
  });

  it('an unexpected account included in the results -> FAIL', () => {
    const stranger: MatrixAccount = {
      key: 'stranger',
      name: 'Stranger',
      accountId: '999999999999',
      ouPath: 'Infrastructure'
    };
    const rows = [...allRows(staging), row('staging', stranger, 'ec2-imds-defaults', 'COMPLIANT')];
    expect(evaluate(staging, rows).problems.join(' ')).toMatch(/unexpected account/);
  });

  it('an enforced set that differs from the configured expectation -> FAIL', () => {
    const shrunk: ExpectedMatrix = { ...staging, enforcedAccounts: staging.enforcedAccounts.slice(0, 7) };
    expect(evaluate(shrunk, allRows(shrunk)).problems.join(' ')).toMatch(/7 enforced accounts, but 8 are expected/);
  });

  it('never accepts an empty matrix', () => {
    const empty: ExpectedMatrix = { ...staging, enforcedAccounts: [], expectedEnforcedAccountCount: 0 };
    expect(evaluate(empty, allRows(empty)).outcome).toBe('FAIL');
  });

  it('any environment-level blocker -> FAIL even when every row is compliant', () => {
    expect(evaluate(staging, allRows(staging), { blockers: ['apply stopped on a failure: x'] }).outcome).toBe('FAIL');
  });

  it('Production validation cannot substitute for Staging: results of another environment -> FAIL', () => {
    const production = matrix('production', 8);
    const result = evaluate(staging, allRows(production));
    expect(result.outcome).toBe('FAIL');
    expect(result.problems.join(' ')).toMatch(/belongs to production, not staging/);
  });

  it('an invalid or expired exception -> FAIL', () => {
    const rows = replace(allRows(staging), 0, 'REQUIRES_APPROVAL');
    const invalid = evaluate(staging, rows, { exceptions: [{ id: 'nope' }] });
    expect(invalid.outcome).toBe('FAIL');
    expect(invalid.problems.join(' ')).toMatch(/exception #1 is invalid/);
    const expired = evaluate(staging, rows, {
      exceptions: [
        {
          id: 'ABX-0001',
          environment: 'staging',
          accountKey: 'account0',
          control: 's3-account-public-access-block',
          approver: 'IF Security',
          reason: 'temporary public website bucket',
          expiresOn: '2026-01-01'
        }
      ]
    });
    expect(expired.problems.join(' ')).toMatch(/expired on 2026-01-01/);
  });

  it('a well-formed exception is handled only by the approved policy: none is approved, so it stays blocking and is never COMPLIANT', () => {
    const rows = replace(allRows(staging), 0, 'REQUIRES_APPROVAL');
    const result = evaluate(staging, rows, {
      exceptions: [
        {
          id: 'ABX-0002',
          environment: 'staging',
          accountKey: 'account0',
          control: 's3-account-public-access-block',
          approver: 'IF Security',
          reason: 'documented business exception',
          expiresOn: '2027-01-01'
        }
      ]
    });
    expect(result.outcome).toBe('FAIL');
    expect(result.counts.COMPLIANT).toBe(39);
    expect(result.counts.REQUIRES_APPROVAL).toBe(1);
    expect(result.problems.join(' ')).toMatch(/no exception-management policy is approved/);
  });
});
