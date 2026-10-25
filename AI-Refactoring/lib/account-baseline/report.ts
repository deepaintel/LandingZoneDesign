/**
 * Common Account Security Baseline v1.0 - deployment evidence.
 *
 * `buildReport` produces the machine-readable `account-baseline-report.json`; `renderReportMarkdown`
 * the GitHub Actions job summary. Both carry the expected and actual account/control counts, every
 * row, the unresolved issues and the environment-level acceptance result. The readiness outcome is
 * PASS only when the acceptance evaluator passed; it is never inferred from the rows.
 */

import type { AcceptanceResult } from './acceptance.js';
import { unfinishedAttempts, type BaselineLedger } from './ledger.js';
import type { BaselinePlan } from './plan.js';
import { describeWrite, type BaselineResultRow } from './types.js';

export const REPORT_SCHEMA_VERSION = '1.0';

export interface AccountBaselineReport {
  readonly schemaVersion: string;
  readonly baseline: 'Common Account Security Baseline v1.0';
  readonly environment: string;
  readonly phase: string;
  readonly generatedAt: string;
  readonly commitSha: string;
  readonly expected: {
    readonly enforcedAccounts: number;
    readonly excludedAccounts: number;
    readonly controls: readonly string[];
    readonly results: number;
  };
  readonly actual: {
    readonly enforcedAccounts: number;
    readonly results: number;
    readonly byStatus: AcceptanceResult['counts'];
    readonly writesPerformed: number;
  };
  readonly unresolvedIssues: readonly string[];
  readonly partialState: readonly string[];
  readonly acceptance: AcceptanceResult['outcome'];
  readonly deploymentReadiness: 'PASS' | 'FAIL';
  readonly rows: readonly BaselineResultRow[];
}

export function buildReport(input: {
  readonly plan: BaselinePlan;
  readonly ledger?: BaselineLedger;
  readonly generatedAt: string;
  readonly commitSha: string;
}): AccountBaselineReport {
  const { plan } = input;
  const writesPerformed = plan.rows.reduce((total, row) => total + row.performedWrites.length, 0);
  const partialState =
    input.ledger === undefined
      ? []
      : unfinishedAttempts(input.ledger).map(
          ({ key, attempt }) =>
            `${key}: ${describeWrite(attempt.write)} ${attempt.outcome}${attempt.error === undefined ? '' : ` - ${attempt.error}`}`
        );
  const unresolved = [...plan.acceptance.problems];
  if (partialState.length > 0) unresolved.push(...partialState.map((entry) => `unfinished write: ${entry}`));
  const pass = plan.acceptance.outcome === 'PASS' && partialState.length === 0;
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    baseline: 'Common Account Security Baseline v1.0',
    environment: plan.environment,
    phase: plan.phase,
    generatedAt: input.generatedAt,
    commitSha: input.commitSha,
    expected: {
      enforcedAccounts: plan.matrix.expectedEnforcedAccountCount,
      excludedAccounts: plan.matrix.excludedAccounts.length,
      controls: plan.matrix.controls,
      results: plan.acceptance.expectedResults
    },
    actual: {
      enforcedAccounts: plan.matrix.enforcedAccounts.length,
      results: plan.acceptance.actualResults,
      byStatus: plan.acceptance.counts,
      writesPerformed
    },
    unresolvedIssues: unresolved,
    partialState,
    acceptance: pass ? 'PASS' : 'FAIL',
    deploymentReadiness: pass ? 'PASS' : 'FAIL',
    rows: plan.rows
  };
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function action(row: BaselineResultRow, phase: string): string {
  if (row.performedWrites.length > 0) return row.performedWrites.map(describeWrite).join('; ');
  if (phase === 'preflight' && row.plannedWrites.length > 0) {
    return `planned: ${row.plannedWrites.map(describeWrite).join('; ')}`;
  }
  return 'none';
}

export function renderReportMarkdown(report: AccountBaselineReport): string[] {
  const lines = [
    `### Common Account Security Baseline v1.0 - ${report.environment} (${report.phase})`,
    '',
    `- Deployment readiness: **${report.deploymentReadiness}**`,
    `- Commit: \`${report.commitSha}\``,
    `- Enforced accounts: ${report.actual.enforcedAccounts} of ${report.expected.enforcedAccounts} expected; ` +
      `excluded accounts: ${report.expected.excludedAccounts}`,
    `- Results: ${report.actual.results} of ${report.expected.results} expected ` +
      `(${report.expected.controls.length} controls per account)`,
    `- By status: ${
      Object.entries(report.actual.byStatus)
        .filter(([, count]) => count > 0)
        .map(([status, count]) => `${status} ${count}`)
        .join(', ') || 'none'
    }`,
    `- Writes performed by this run: ${report.actual.writesPerformed}`,
    ''
  ];
  if (report.unresolvedIssues.length > 0) {
    lines.push('Unresolved issues:', '', ...report.unresolvedIssues.map((issue) => `- ${cell(issue)}`), '');
  }
  lines.push(
    '| Environment | Account | Account ID | OU | Control | Previous | Required | Action | Final | Status | Reason |',
    '|---|---|---|---|---|---|---|---|---|---|---|'
  );
  for (const row of report.rows) {
    lines.push(
      `| ${row.environment} | ${cell(row.accountName)} | ${row.accountId || '-'} | ${cell(row.ouPath)} | ${row.control} | ` +
        `${cell(row.previous)} | ${cell(row.required)} | ${cell(action(row, report.phase))} | ${cell(row.observed)} | ` +
        `${row.status} | ${cell(row.reason || '-')} |`
    );
  }
  return lines;
}
