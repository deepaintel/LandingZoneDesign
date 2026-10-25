# Control Tower Account Auto-Enrollment Skill

## Purpose

This skill defines how to implement, review, run and troubleshoot the enable-only AWS Control Tower account auto-enrollment step in Staging and Production.

Use with:

- `.apm/skills/manage-landing-zone-configuration/SKILL.md` when changing repository configuration or Zod schemas
- `.apm/skills/control-tower-account-enrollment/SKILL.md` (OU enrollment, which runs first)
- `.apm/skills/initialize-control-tower/SKILL.md` (initialization boundary and deployed-manifest comparison contract)


| Component | Responsibility |
|---|---|
| `lib/control-tower/landing-zone-auto-enrollment.ts` | Pure decisions: `remediationTypes` parsing, Landing Zone read and health, ARN / Region / CLI checks, operation listing and classification, budgets, the enable-only decision table, final verification |
| `lib/control-tower/landing-zone-manifest.ts` | Manifest builder and the §21.1 comparison shared with post-initialization |
| `config/schemas/control-tower-schema.ts` | Required `controlTower.autoEnrollment.enabled` |
| `scripts/configure-control-tower-auto-enrollment.ts` | AWS CLI access; `--mode plan` (read-only), `--mode apply` (the only `UpdateLandingZone`), `--mode verify` (read-only) |
| `.github/actions/configure-control-tower-auto-enrollment/action.yml` | Environment guard, inputs, credential refresh per phase, plan, up to three apply rounds, budget check, verification, enrollment validator after an operation |
| `.github/workflows/validate-and-deploy.yml` | One step after `enroll-control-tower-accounts`, run for staging and production |

Keep every decision in the pure module with unit tests. The script only gathers state, calls the pure functions and performs the single write.

## Workflow Position

```
enroll-control-tower-accounts (plan -> rounds -> validate)
  -> configure-control-tower-auto-enrollment
       refuse other environments -> validate inputs
       -> refresh OIDC -> plan (read-only)
       -> round 1..3: refresh OIDC -> apply (re-plans from live state each time)
       -> budget check (exports operation-identifier, update-submitted from the run ledger)
       -> refresh OIDC -> verify (read-only)
       -> enrollment validator (read-only), only when a Landing Zone operation ran
```

Never add a second `UpdateLandingZone` caller. Never add this step to `ci.yml`.

## Configuration and Release Gates

- `controlTower.autoEnrollment.enabled` is required and has no default. Declare it separately in each environment file; do not place it in `config/default.yaml` or allow an inherited value to enable an environment.
- **Release A:** Staging is `true`; Production is `false` and must be a no-op while AWS reports disabled.
- **Release B:** set Production to `true` only after explicit written sign-off that the live Staging checks below, the controlled Staging account-move test, and the Suspended/decommissioning validation have passed.
- The skill's execution sequence remains after OU enrollment and its read-only validation. Production runs in the protected Production job after Staging succeeds for the same release commit and GitHub Environment approval.

## Plan (read-only)

1. Environment is `staging` or `production`; configuration loads through `ccoe-config-reader` and the management account matches.
2. `sts get-caller-identity`: the management account in `aws-eusc`; any `AWS_REGION` equals the home Region.
3. The Landing Zone ARN belongs to the partition, home Region and management account.
4. `--generate-cli-skeleton input` for `update-landing-zone` (must list `remediationTypes`), `get-landing-zone-operation` and `list-landing-zone-operations`. No AWS call.
5. `controltower get-landing-zone`: version `4.0`, `ACTIVE`, `IN_SYNC`, manifest equal to the repository-built manifest, `remediationTypes` absent or exactly `["INHERITANCE_DRIFT"]`.
6. `controltower list-landing-zone-operations --max-items 50 [--starting-token ...]`, every page, **no status filter**. Statuses are inspected: none in progress, or exactly one identifiable operation to await.
7. The decision: `none`, `enable`, `await` or `stop`, printed with its reasons and written to the step summary.

## Apply

Each round re-plans and takes at most one action per iteration:

- `none`: return `complete`;
- `await`: poll the in-progress operation, wait for the Landing Zone to leave `PROCESSING`, re-plan;
- `enable`: check the run ledger (no earlier submission in this run) and the budgets, record the attempt, call `update-landing-zone` once, record the operation identifier, poll it, re-plan (the setting must now read enabled);
- `stop`: fail with every reason.

`ConflictException`: re-plan and await the identifiable operation; never resubmit. Any other error from the call is ambiguous: fail and never resubmit.

The run ledger records the update attempt before submission and the operation ID as soon as returned. Submit at most one update per run. Poll every 60 seconds. Malformed/missing operation details, mismatched IDs/types, unknown status, or invalid times fail closed; `FAILED` includes operation details and CloudTrail denials. An operation still `IN_PROGRESS` after 90 minutes fails without resubmission. After success, wait up to 10 minutes for `PROCESSING` to clear and re-plan; the setting must then read enabled. Do not start an update unless the job budget includes the 90-minute operation ceiling, 20-minute verification, and 5-minute margin. Use at most three credential rounds of 50 minutes, refreshing the existing OIDC role each round.

## Failure Investigation

The run prints the operation identifier, type, status and `statusMessage`, and on `FAILED` up to the CloudTrail `AccessDenied` / `UnauthorizedOperation` events since the operation started (event source, name, principal, message).

Then:

1. A denial naming an SCP or an IAM permission: identify the policy, SID or permission, the action and the principal. Report it; SCP changes follow `control-tower-scp-compatibility.instructions.md`, IAM changes go to the foundation owner.
2. A malformed response or an unidentifiable in-progress operation: inspect the operations read-only (runbook below). Do not script around it.
3. `remediationTypes` enabled while configuration says `false`: decide through a reviewed release whether the environment should be `true`; disabling is not supported.
4. Never use `ResetLandingZone`, `ResetEnabledBaseline`, `EnableBaseline` or `CreateLandingZone` to recover a failed auto-enrollment update.

## Safe Re-run

A re-run of the protected deployment is safe:

- already enabled: no-op, zero updates;
- an update still `IN_PROGRESS`: found through `ListLandingZoneOperations` and polled, never resubmitted;
- an update lost in transit: found as above, or observed as enabled;
- a `FAILED` update: the re-run submits again only after the cause is fixed and a person re-runs it deliberately.

The step never changes the Landing Zone version, manifest, or any other setting. It never calls `CreateLandingZone`, `ResetLandingZone`, `EnableBaseline`, or `ResetEnabledBaseline` as a recovery path.

`UpdateLandingZone` must receive the live Landing Zone ARN, the already-deployed version, the complete repository-built manifest, and `remediationTypes: ["INHERITANCE_DRIFT"]`. Enabling auto-enrollment does not repair inheritance drift caused by account moves made before it was enabled.

## Account-Move Safety

- Every manual member-account OU move requires an approved change ticket. With auto-enrollment enabled, moving into a registered OU has automatic effects.
- Never test by moving an account into Security, Suspended, or the Organization Root. Moving to an unregistered OU or the root can automatically remove Control Tower baselines and controls.
- Source and destination OUs with different configurations may produce moved-member-account drift.
- Enrollment after a move is eventually consistent and may take minutes or hours. The EUSC documentation lists no restriction for auto-enrollment or `UpdateLandingZone`, but that is not proof of support; only the approved live Staging checks establish capability for this repository.
- Suspended/decommissioning moves are not validated by this feature. Before Release B, operationally validate that moving an account into Suspended works with the no-exemption `SCP-ESC-SUS-001`; update the procedure only after approved evidence.
- A child baseline in `FAILED` or `DRIFTED` is not repaired by auto-enrollment. Enrollment waits boundedly and fails closed; investigate rather than repeatedly rerunning.

## Read-Only CLI Runbook

Run with read-only management-account credentials in `eusc-de-east-1`:

```bash
aws controltower list-landing-zones --region eusc-de-east-1
aws controltower get-landing-zone --landing-zone-identifier "<landing zone arn>" --region eusc-de-east-1 \
  --query 'landingZone.{version:version,status:status,drift:driftStatus.status,remediationTypes:remediationTypes}'
aws controltower list-landing-zone-operations --region eusc-de-east-1
aws controltower get-landing-zone-operation --operation-identifier "<operation id>" --region eusc-de-east-1
aws controltower update-landing-zone --generate-cli-skeleton input   # local only: CLI support check
```

Child baselines of a registered OU (account enrollment):

```bash
aws controltower list-enabled-baselines --region eusc-de-east-1 \
  --filter '{"targetIdentifiers":["<ou arn>"]}'
aws controltower list-enabled-baselines --region eusc-de-east-1 --include-children \
  --filter '{"parentIdentifiers":["<ou enabled baseline arn>"]}'
```

There is no runbook for disabling auto-enrollment or for calling `UpdateLandingZone` by hand.

## Controlled Staging Account-Move Test

Prerequisites: Release A deployed and verified in Staging; separate written approval; a change ticket; no release run during the window (coordinate with the release owner); a named operator with the approved Staging management-account access.

1. Choose one CCoE Verification account and two registered Workloads leaf OUs with the same baseline and controls, for example `Workloads/Corp/Non-Prod` to `Workloads/Hybrid/Non-Prod`. Never use Security, Suspended or the organization root.
2. Record before-state (read-only): the account's parent, both OUs' enabled baselines and child baselines, `AWSControlTowerExecution` in the account.
3. Move the account (`aws organizations move-account --account-id <id> --source-parent-id <ou> --destination-parent-id <ou>`) under the change ticket.
4. Poll read-only until the account has a `SUCCEEDED` child baseline under the destination OU with no drift; record the time taken. If it does not converge within the agreed window, stop and investigate; do not reset anything.
5. Move the account back to its configured OU and verify the same way.
6. Re-run the Staging deployment: the account step must reconcile with no placement conflict, enrollment must validate, and auto-enrollment must be a no-op.
7. Attach the evidence to the change ticket for the Release B sign-off.

## Release A Live Staging Acceptance

Before Release B is approved, verify on live Staging that: the plan decides `enable`; the single update is accepted and reaches `SUCCEEDED`; `GetLandingZone` reports `remediationTypes: ["INHERITANCE_DRIFT"]`, version `4.0`, `ACTIVE`, and `IN_SYNC`; the manifest is unchanged; the enrollment validator still passes; a protected Staging rerun is a no-op with zero update calls; and the controlled account-move test passes. Offline tests and synthesis do not prove this AWS ESC capability.

## Permissions, Rollback, and Future Updates

- Use the existing `github-actions-role` via the approved reusable OIDC action. This repository does not change IAM. The foundation/platform owner confirms permissions for `GetLandingZone`, `ListLandingZoneOperations`, `GetLandingZoneOperation`, `UpdateLandingZone`, required caller-side permissions, enrollment validation reads, and `cloudtrail:LookupEvents` for diagnostics. Missing permission is a Staging gate, not a reason to broaden IAM here.
- Disabling auto-enrollment is unsupported and is not a rollback. Reverting code or setting configuration to `false` does not disable a live setting; if configuration is false while AWS reports enabled, fail closed. Disabling requires a separately approved design and validation.
- Any future `UpdateLandingZone` (including version or manifest updates) must explicitly send and validate the intended `remediationTypes`; omission may turn auto-enrollment off. Design that work separately; do not add it to this step.

## Tests

Keep offline tests for:

- `remediationTypes` parsing (absent, exact, empty, unknown, duplicate, wrong type);
- Landing Zone read problems; ARN, Region and CLI skeleton checks; the environment guard;
- pagination (tokens, missing list, malformed or repeated token, page bound) and that no status filter is sent;
- in-progress detection (none, one, two, unknown status, missing identifier or type);
- operation classification (each documented status; missing details, unknown status, mismatched identifier, missing or wrong type, invalid times);
- the decision table, including disabled-but-enabled and PROCESSING without an operation;
- apply rounds against a fake: already enabled, enable once with exact arguments, idempotent re-run, health failures, awaiting an existing operation, a failed existing operation, ambiguity, conflict, lost response, missing identifier, `FAILED`, timeout, malformed responses, success without the setting, settle timeout, insufficient job or credential budget, resuming across rounds;
- verification failures after success;
- the CLI adapter arguments;
- workflow wiring, action order and credential sources, the round check, the single `update-landing-zone` caller and CI exclusions;
- enrollment convergence across rounds, near the job deadline and on re-run, never resetting.

## Local Validation

Run only offline checks: `pnpm run validate`, then `apm compile` and `apm audit --ci` after APM changes. Never run `pnpm run configure:control-tower-auto-enrollment` locally or in CI.

## Stop Conditions

Stop and report if a change would:

- call `UpdateLandingZone` outside `scripts/configure-control-tower-auto-enrollment.ts`;
- disable auto-enrollment, or change the Landing Zone version, manifest or another setting through this step;
- use `ResetLandingZone`, `ResetEnabledBaseline`, `EnableBaseline` or `CreateLandingZone` as a recovery path;
- retry or resubmit `UpdateLandingZone` automatically;
- move accounts, or test with Security, Suspended or the organization root;
- add AWS credentials or Landing Zone calls to CI, or broaden IAM permissions;
- enable Production before the Release B sign-off.
