#!/usr/bin/env tsx
/**
 * AWS Control Tower OU enrollment - read-only final validation (Staging and Production).
 *
 * Governed by `.apm/skills/control-tower-account-enrollment/SKILL.md`. Runs in the
 * protected deployment job of an approved environment after `enroll-control-tower-accounts.ts --mode enroll`
 * completes; never from CI. Makes no AWS change.
 *
 * Passes only when:
 *  - the Landing Zone is still the configured version, ACTIVE and IN_SYNC;
 *  - every rollout OU has AWSControlTowerBaseline SUCCEEDED at the resolved version, with no
 *    operation in progress, no drift and no conflicting baseline;
 *  - every configured account is ACTIVE, keeps its configured name, email and OU, is enrolled
 *    (child enabled baseline SUCCEEDED) and has the AWSControlTowerExecution role;
 *  - every rollout OU stays within the SCP attachment quota;
 *  - the Security OU has no AWSControlTowerBaseline, Audit and Log Archive remain in it, and their
 *    Landing Zone service-integration baselines are SUCCEEDED;
 *  - no IdentityCenterBaseline is enabled.
 */

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  AwsCli,
  buildEnrollmentPlan,
  executionRoleModel,
  loadConfig,
  renderPlan
} from './control-tower-enrollment-runtime.js';

function option(argv: readonly string[], name: string): string {
  const index = argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : argv[index + 1];
  if (value === undefined || value.trim() === '' || value.startsWith('--')) throw new Error(`--${name} is required.`);
  return value.trim();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const environment = option(argv, 'environment');
  const cli = new AwsCli(loadConfig(environment).aws.region);
  const plan = await buildEnrollmentPlan(
    cli,
    {
      environment,
      managementAccountId: option(argv, 'management-account-id'),
      organizationId: option(argv, 'organization-id'),
      landingZoneArn: option(argv, 'landing-zone-arn'),
      auditAccountId: option(argv, 'audit-account-id'),
      logArchiveAccountId: option(argv, 'log-archive-account-id'),
      accountIdLines: readFileSync(option(argv, 'account-ids-file'), 'utf8'),
      ouIdLines: readFileSync(option(argv, 'ou-ids-file'), 'utf8')
    },
    { configPrecheck: false }
  );

  const problems = [...plan.problems];
  for (const target of plan.targets) {
    if (target.state.kind !== 'governed') {
      problems.push(`${target.target.ouPath}: state is '${target.state.kind}', expected governed.`);
    }
    for (const account of target.accounts) {
      if (!executionRoleModel(cli, plan.partition, account.accountId).controlTowerExecutionRolePresent) {
        problems.push(`${account.key} (${account.accountId}) has no AWSControlTowerExecution role.`);
      }
    }
  }

  const lines = renderPlan(plan);
  console.log(`AWS Control Tower enrollment validation (${environment})\n${lines.join('\n')}`);
  const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
  if (summaryFile !== undefined && summaryFile !== '') {
    appendFileSync(
      summaryFile,
      `${[`### Control Tower enrollment validation (${environment})`, '', ...lines].join('\n')}\n`
    );
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} enrollment validation check(s) failed:\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }
  const accounts = plan.targets.reduce((count, target) => count + target.accounts.length, 0);
  console.log(`\nAll ${plan.targets.length} OUs are governed and all ${accounts} configured accounts are enrolled.`);
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  main().catch((error: unknown) => {
    console.error(`\nControl Tower enrollment validation failed.\n${(error as Error).message}`);
    process.exitCode = 1;
  });
}
