# Control Tower Account Enrollment Skill

## Purpose

This skill defines how to implement, review, run and troubleshoot AWS Control Tower OU enrollment of the Landing Zone OUs and accounts in Staging and Production.

Use with:

- `.apm/skills/manage-landing-zone-configuration/SKILL.md` when changing repository configuration or Zod schemas
- `.apm/skills/update-scp-for-control-tower/SKILL.md` (approved SCP exemptions enrollment depends on)
- `.apm/skills/generate-account/SKILL.md` (account inventory and reconciled account/OU output contract)

## Components

| Component | Responsibility |
|---|---|
| `lib/control-tower/baseline-enrollment.ts` | Pure decisions: baseline selection, LZ -> baseline compatibility table, version resolution, target derivation, enabled-baseline classification, planned action, operation classification, OU ARN, account state, Config precheck, SCP headroom, execution-role model |
| `config/schemas/control-tower-schema.ts`, `organization-schema.ts` | `controlTower.enrollment.rolloutOrder` validation |
| `lib/organization/landing-zone-account-reconciler.ts` (account provisioning) | Reused, unchanged: `buildAccountPlan` / `assertAccountPlanReconciled` for account readiness and `resolveOuPath` for live OU IDs |
| `scripts/control-tower-enrollment-runtime.ts` | AWS CLI access and the read-only plan builder |
| `scripts/enroll-control-tower-accounts.ts` | `--mode plan` (read-only) and `--mode enroll` |
| `scripts/validate-control-tower-enrollment.ts` | Read-only final validation |
| `.github/actions/enroll-control-tower-accounts/action.yml` | Environment guard (staging, production), inputs, credential rounds, plan, enroll, validate |
| `.github/workflows/validate-and-deploy.yml` | One step after `deploy-landing-zone-accounts`, run for staging and production |

Keep every decision in the pure module and cover it with unit tests. Runtime code only gathers state and calls the pure functions.

## Workflow Position

```
Organization Policy stack (includes enrollment SCP compatibility)
  -> Shared accounts -> Control Tower roles -> Control Tower initialization (idempotent)
  -> deploy-landing-zone-accounts (plan -> create MISSING only -> validate; emits account-ids, ou-ids)
  -> enroll-control-tower-accounts (staging and production; Production only after its environment approval)
       refuse other environments -> validate inputs
       -> refresh OIDC -> plan (read-only)
       -> round 1..6: refresh OIDC -> enroll (resumes from live state)
       -> budget check -> refresh OIDC -> validate (read-only)
  -> configure-control-tower-auto-enrollment (enable only; separate skill
     `.apm/skills/control-tower-auto-enrollment/SKILL.md`)
```

Never add a second account-provisioning invocation. Never add enrollment to `ci.yml`.

## Approved Rollout Order and Scope

The shared `controlTower.enrollment.rolloutOrder` contains OU paths, never account names, in this exact order:

1. `Infrastructure`
2. `Sandbox`
3. `Workloads`
4. `Workloads/Corp`
5. `Workloads/Corp/Non-Prod`
6. `Workloads/Hybrid`
7. `Workloads/Online`
8. `Workloads/Hybrid/Non-Prod`
9. `Workloads/Online/Non-Prod`
10. `Workloads/Corp/Prod`
11. `Workloads/Hybrid/Prod`
12. `Workloads/Online/Prod`

The same 12 targets are enrolled in Staging and Production. Empty OUs are registered too, so they establish their governance boundary before accounts arrive.

| OU scope | Staging accounts | Production accounts |
|---|---|---|
| `Infrastructure` | SharedServices, Network | SharedServices, Network |
| `Sandbox`, `Workloads`, and the three Workloads domain OUs | none | none |
| Six `Workloads/*/Prod` and `Workloads/*/Non-Prod` leaves | one CCoE Verification account per leaf | none |
| `Security`, `Suspended`, and descendants | prohibited | prohibited |

There are eight configured member accounts in Staging and two in Production; the shared Audit/Log Archive accounts are not enrolled as `AWSControlTowerBaseline` targets. Parents must precede children. Infrastructure goes first because it has SharedServices/Network and is outside Workloads-only SCPs; Sandbox follows; the Corp Non-Prod Workloads leaf is the first Workloads leaf, and Prod leaves are last. The schema must reject duplicate paths, absent account-bearing OUs, unknown OUs, and Security/Suspended targets.

## Baseline, Security OU, and SCP Quota

- Enable only `AWSControlTowerBaseline`, and only on OUs. Never pass `parameters` to `EnableBaseline`; `ConfigBaseline` and `IdentityCenterBaseline` are not approved.
- The approved compatibility table is Landing Zone `4.0` -> `AWSControlTowerBaseline` `5.0`. `GetBaseline` supplies no version. Resolve from consistent successful OU-level enablements when present and cross-check against the table; with none, use the table. Unknown Landing Zone versions, inconsistent successful versions, or mismatches fail closed. The resolved version is never persisted.
- The Landing Zone must be the configured version, `ACTIVE`, and `IN_SYNC` before mutation.
- Security is never an `AWSControlTowerBaseline` or `ConfigBaseline` target. Audit and Log Archive remain in Security and must each have successful service-integration baselines; any `AWSControlTowerBaseline` or `ConfigBaseline` found there fails validation.
- Before mutation, count directly attached SCPs on every target using `ListPoliciesForTarget`, including `FullAWSAccess`. Control Tower adds one `aws-guardrails-*` SCP on top-level OUs only; nested OUs need no extra slot. Projected count must not exceed the Organizations limit of 10 policies per node.

## Live-State Decision Rules

Classify every target from live state before mutation; the read-only plan and final validation use the same rules:

| Live state | Action |
|---|---|
| `AWSControlTowerBaseline` succeeded at the resolved version, no OU drift, every configured account has a healthy succeeded child baseline at that version | Validate and continue |
| OU is governed, but a configured account child baseline is missing, `FAILED`, or `DRIFTED`; auto-enrollment disabled | Run the Config precheck, then reset at most once for the target in this workflow run |
| Same child-baseline problem; auto-enrollment enabled | Wait for bounded convergence; never reset |
| No baseline record and parent is governed or scheduled earlier in this rollout | Run Config precheck and SCP headroom checks, then enable |
| Operation is `UNDER_CHANGE` and has a valid operation ID | Poll that operation; never submit another |
| Wrong/missing version, conflicting baseline, malformed ARN/target/parent/drift metadata, unknown status, unexplained inheritance drift, ungoverned parent, or prohibited OU | Fail closed with diagnostics |
| Operation `FAILED` | Run Config precheck, then the single permitted reset for that target |

Drift is interpreted only from the documented `driftStatusSummary.types.*.status` values `IN_SYNC` or `DRIFTED`; an absent summary means no drift reported. Any other shape/value is malformed. Inheritance drift is expected only while a configured child account is missing, failed, or drifted. Malformed metadata never falls through to a reset.

`ResetEnabledBaseline` is allowed at most once per target per workflow run, recorded in a `RUNNER_TEMP` ledger. If a reset does not converge, stop; there is no reset retry loop. `ConflictException` from enable/reset means another operation is in progress: identify it and wait for convergence, never resubmit.

## Plan (read-only)

The plan runs, in order:

1. `sts get-caller-identity`: management account and `aws-eusc` partition.
2. `controltower get-landing-zone`: configured version, `ACTIVE`, `IN_SYNC`; `remediationTypes` reported as the auto-enrollment setting (`INHERITANCE_DRIFT` = enabled). Read only.
3. `controltower list-baselines`: exactly one `AWSControlTowerBaseline` with an `aws-eusc` home-Region ARN; optional `ConfigBaseline` and `IdentityCenterBaseline` ARNs for state checks. `get-baseline` confirms the top-level `arn` and `name`. A response without its required list (`baselines`, `enabledBaselines`, `Policies`) fails the plan.
4. `controltower list-enabled-baselines`: no `IdentityCenterBaseline`; resolve the version (existing successful records, cross-checked against the compatibility table).
5. Account readiness: a fresh read-only account plan from the reconciler must be fully reconciled (every account `ACTIVE`, exact name and email, configured parent OU, P1 tags); the `account-ids` and `ou-ids` handoffs must match it exactly.
6. Per rollout OU, empty OUs included: OU ID resolved live from the Organization Root, OU ARN from `describe-organizational-unit` and validated; target and child enabled baselines; classification and planned action; `list-policies-for-target` SCP headroom.
7. AWS Config precheck through `OrganizationAccountAccessRole` for every account of an OU to be enabled or reset.
8. Security OU: neither `AWSControlTowerBaseline` nor `ConfigBaseline`; Audit and Log Archive in the Security OU with `SUCCEEDED` service-integration baselines.

Any problem fails the step before mutation, with every problem listed.

## Enroll

For each rollout OU, in order, the script takes exactly one action:

- `none`: validate the OU and continue;
- `enable`: Config precheck, SCP headroom, then `enable-baseline` with only `--baseline-identifier`, `--baseline-version` and `--target-identifier`;
- `reset`: Config precheck, then `reset-enabled-baseline`; recorded in the run ledger, at most once per target per run;
- `poll`: poll the existing operation;
- `converge`: auto-enrollment is enabled and a configured account is not yet enrolled in a governed OU; re-read the OU every 30 seconds until it is governed, for at most 60 minutes per run, then fail closed. Never reset. The bound spans credential rounds, honours the job budget, and a re-run waits again from live state; a `FAILED` or `DRIFTED` child is not repaired by auto-enrollment, so investigate it rather than re-running repeatedly;
- `stop`: fail with the classification reasons.

A `ConflictException` from `enable-baseline` or `reset-enabled-baseline` switches the target to the same bounded convergence wait; nothing is resubmitted and no reset is recorded.

Before the first OU under the Workloads root (SCP-ESC-IAM-001 scope), confirm the execution-role model on an enrolled Infrastructure account.

After each operation, poll `get-baseline-operation` every 30 seconds until terminal, then validate the OU and re-plan from live state.

The round ends with `continue` when the credential budget is used up, or `job-budget-exhausted` near the job deadline. The next round, or a workflow re-run, picks up any in-progress operation through case 3.

### Operation and Job Budgets

- Poll `GetBaselineOperation` every 30 seconds. `SUCCEEDED` is the only success; handle the documented `FAILED` state explicitly. A missing/malformed operation, unknown status, mismatched operation ID, or unparsable start time fails with diagnostics and never triggers reset or resubmission.
- An operation still `IN_PROGRESS` after 90 minutes from its start time fails without resubmission.
- Auto-enrollment convergence re-reads the OU and child baselines every 30 seconds and is bounded to 60 minutes from first observation in the workflow run. The bound is recorded in the run ledger across credential rounds. If it expires, fail closed; do not reset while auto-enrollment is enabled.
- `github-actions-role` sessions last one hour. Enrollment runs in up to six rounds of at most 50 minutes, refreshing credentials before each round through the approved `aws-credentials` action. Do not begin a mutation when less than 10 minutes remain in the credential round.
- The job timeout is 360 minutes. Stop starting new work when less than five minutes plus the next poll/mutation allowance remain; fail with a rerun instruction rather than being killed during an operation. Reruns resume from live state.
- AWS documents an OU with 680 accounts can take up to two hours. This rollout's OUs hold zero to two configured accounts in one Region. Planning estimates are about 30 minutes per account-bearing OU and 15 minutes per empty OU: about 4.75 hours for Staging and 3.25 hours for Production. Governed OUs are skipped on rerun.

## Failure Investigation

On a failed operation the script prints:

- the operation type, status and `statusMessage`;
- every child enabled baseline of the OU with its status;
- up to ten `AccessDenied*` CloudTrail events per account since the operation started (read through `OrganizationAccountAccessRole`), with event source, event name, calling principal and error message.

Then:

1. A denial naming an SCP: identify the policy, SID, action and calling principal, and follow the stop-and-report rule of the SCP compatibility instruction. Never weaken an SCP from the enrollment run.
2. A Config conflict: report it; do not delete or modify Config resources from automation.
3. A failure after the single reset: stop. Fix the cause, then re-run the release workflow. A new run allows one more reset.

## Rerun Behaviour

A re-run of the protected Staging or Production deployment is safe:

- governed OUs are validated and skipped;
- operations still `UNDER_CHANGE` are polled, never resubmitted;
- a previously failed OU gets one reset per run;
- an account moved into a governed OU is reset once (auto-enrollment disabled) or awaited (auto-enrollment enabled);
- accounts are never recreated: the account step reuses every existing account and creates only missing ones, and enrollment itself never creates an account.

## Tests

Keep offline tests for:

- baseline selection (zero, one, duplicate, wrong partition, wrong Region);
- version resolution (4.0 -> 5.0, unsupported LZ version, agreeing and disagreeing existing versions);
- every classification case and planned action, including reset-once and stop-after-reset;
- rollout scope: the same 12 OUs in Staging and Production, with 8 and 2 configured accounts; Sandbox and every empty OU accepted;
- fail-closed child classification: `UNDER_CHANGE` without a valid operation identifier, unknown status, missing or wrong version, malformed drift, target, parent or ARN all stop without any mutation; `DRIFTED` and `FAILED` children take only the bounded account path;
- Security OU: `AWSControlTowerBaseline` and `ConfigBaseline` both rejected;
- rollout ordering (parents first, child-before-parent, Security/Suspended rejected, duplicates, unknown OU, uncovered account OU);
- auto-enrollment (disabled reset path, enabled convergence success and timeout, no competing reset);
- round behaviour against a fake Control Tower: plan failure means zero `EnableBaseline` calls, full 12-OU enablement, governed skip, `UNDER_CHANGE` polling, one bounded reset after `FAILED`;
- workflow wiring: one step for staging and production after account provisioning, the action's environment guard, and reusable credentials only;
- account handoff and account state (ACTIVE, non-ACTIVE, name, email, OU, key-set mismatch, `State` before `Status`);
- the Config precheck (empty, Control Tower-managed on rerun, foreign recorder, foreign channel);
- SCP headroom and the execution-role model;
- the SCP exemptions and their per-SID validator.

## Local Validation

Run only offline checks:

- `pnpm run validate` (build, type-check, lint, tests, synth and static validators for both environments)
- `apm compile` and `apm audit --ci` after APM changes

Never run `pnpm run enroll:control-tower-accounts` or `pnpm run validate:control-tower-enrollment` locally or in CI. They exist for the protected Staging and Production deployment jobs only.

## Stop Conditions

Stop and report if:

- a change would enroll the Security or Suspended OU, or run enrollment for an environment other than staging and production;
- a change would make the enrollment action or scripts enable, disable or otherwise change the Landing Zone auto-enrollment setting (only `configure-control-tower-auto-enrollment` may enable it; see `.apm/skills/control-tower-auto-enrollment/SKILL.md`);
- a change would pass `parameters` to `EnableBaseline` or enable `IdentityCenterBaseline` or `ConfigBaseline`;
- a change would create `AWSControlTowerExecution` or any member-account resource;
- a change would duplicate the account inventory or persist account IDs or baseline ARNs;
- a change would add AWS credentials or Control Tower calls to CI;
- the calling principal of a blocked Control Tower operation cannot be established.
