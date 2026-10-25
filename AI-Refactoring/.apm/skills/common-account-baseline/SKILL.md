# Common Account Security Baseline Skill

## Purpose

This skill defines how to implement, review, run and troubleshoot the Common Account Security Baseline v1.0 in Staging and Production.

Use with:

- `.apm/skills/manage-landing-zone-configuration/SKILL.md` when changing repository configuration or Zod schemas
- `.apm/skills/control-tower-account-enrollment/SKILL.md` and `.apm/skills/control-tower-auto-enrollment/SKILL.md` (which run first)
- `.apm/skills/generate-account/SKILL.md` (the approved account inventory and account-ID/OU handoff boundaries)

## Approved v1.0 Scope

This skill owns the approved common account security baseline v1.0: exactly five enable-only account/Region defaults. Targets are literals in `config/schemas/account-baseline-schema.ts`; weakening, disabling, or adding an unknown target is a schema/governance change.

| Control | Required target |
|---|---|
| `s3-account-public-access-block` | `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets` all `true` |
| `ebs-encryption-by-default` | Encryption by default `true`; preserve the existing approved default key `alias/aws/ebs` |
| `ec2-imds-defaults` | `HttpTokens=required`, `HttpPutResponseHopLimit=2` for future launches |
| `ebs-snapshot-block-public-access` | `block-all-sharing` |
| `ec2-image-block-public-access` | `block-new-sharing` |

S3 account BPA applies to buckets/access points the account owns. `RestrictPublicBuckets` also limits cross-account access granted by a public policy; non-public grants are unaffected. Existing public policies remain, so removing a setting would re-expose resources. EBS encryption-by-default does not change the default key or existing volumes; snapshots encrypted with `aws/ebs` cannot be shared cross-account. IMDS defaults affect future launches only and are overridden by launch-time/template settings. Snapshot `block-all-sharing` treats existing public snapshots as private; AMI `block-new-sharing` leaves existing public AMIs public and may take up to 10 minutes to take effect.

ESC documentation alone does not prove API support. Confirm each control's capability through local CLI-model checks and the first live Staging read; unsupported capability remains `UNSUPPORTED`, never a reason to choose a weaker substitute.

## Account Scope and Ownership

- Enforce on every configured `landingZoneAccounts` account in Staging (eight: SharedServices, Network, and six CCoE Verification accounts) and Production (two: SharedServices and Network). The required expectations are Staging `8` and Production `2`, each equal to the configured inventory.
- Exclude the Management account, Audit, Log Archive, and every account under Security or Suspended. These fixed exclusions are enforced in configuration and runtime; excluded accounts are reported `EXCLUDED` and never accessed.
- Account and OU IDs are resolved live, never configured. The configured inventory and `expectedEnforcedAccountCount` are validated in each environment before any member-account access.
- The common baseline runs after account provisioning, Control Tower OU enrollment, and auto-enrollment, as the final Staging/Production deployment step. Future accounts enter scope only through the approved inventory and count update.
- This baseline neither creates resources nor changes IAM, KMS, Lambda, StackSets, Organizations policies, Config, CloudTrail, or Control Tower. It is separate from service enablement and account provisioning.

## Write and Change Boundary

The only approved writes are:

- `PutPublicAccessBlock` on the account with all four settings `true`.
- `EnableEbsEncryptionByDefault` only; preserve the default key `alias/aws/ebs`.
- `ModifyInstanceMetadataDefaults`, setting exactly one approved target field per call.
- `EnableSnapshotBlockPublicAccess` with `block-all-sharing`.
- `EnableImageBlockPublicAccess` with `block-new-sharing`.

Never disable or weaken these settings, change the EBS default key, edit bucket/object/access-point policies or ACLs, change AMIs/snapshots/instances/launch templates/Auto Scaling groups, or write IAM/KMS/Lambda/StackSet/Organizations policy/Config/CloudTrail/Control Tower resources. The baseline creates no account resources, IAM roles, Lambda functions, StackSets, or KMS keys. Do not run it in CI; only Staging and Production protected release jobs invoke it.

The deployment role is IF-managed `github-actions-role`; member-account access uses the existing `OrganizationAccountAccessRole`, with identity, account, partition, and Region verified before reads/writes. Do not change IAM here. EC2 writes are preflight-probed with `DryRun`; S3 Control has no dry-run, so permission failure stops the run.

## Fail-Closed Acceptance

The existing pure planning and acceptance modules are authoritative. A plan must validate the complete expected account/control matrix before any write. Any missing account/control, mismatched inventory count, excluded account in scope, incomplete handoff, unverified member session, unsupported capability, conflict, malformed result, or unsafe write blocks the job.

Statuses are `COMPLIANT`, `NON_COMPLIANT`, `REQUIRES_APPROVAL`, `EXCLUDED`, `UNSUPPORTED`, `ERROR`, and `NOT_ASSESSED`:

| Status | Preflight | Post-apply |
|---|---|---|
| `COMPLIANT` | pass | pass |
| `NON_COMPLIANT` | pass only when an approved enable-only write is planned | fail |
| `REQUIRES_APPROVAL` | fail | fail |
| `UNSUPPORTED`, `ERROR`, `NOT_ASSESSED` | fail | fail |
| `EXCLUDED` | pass only for a configured excluded account, with no access/write | same |

Conflicts never cause a write. Examples include public S3 policies/ACLs/access points that a missing BPA setting would affect; an unapproved, disabled, pending-deletion, or non-symmetric EBS default key; explicit non-target IMDS values or declarative-policy management; public snapshots where `block-all-sharing` is not active; or public AMIs. These return `REQUIRES_APPROVAL` or `ERROR` and block apply. There are no approved exceptions in v1.0; the exception array remains empty, and a future exception policy requires explicit approval/schema change.

The first failed write stops further changes. Each apply round re-runs the complete gate, rechecks the account and control precondition immediately before writing, then polls to `COMPLIANT` within a bounded budget while preserving invariants. Reruns skip already compliant cells. Nothing rolls back automatically; the report/ledger records prior state. Reverting a setting is an out-of-band, change-controlled break-glass operation. Never weaken snapshot protection to `block-new-sharing` or remove S3 protection while public policies remain.

## Release Evidence and Validation

- Production starts only after Staging succeeds and the protected `production` GitHub Environment approval, for the same release commit. The baseline action runs last in both environment jobs and cannot be skipped with `continue-on-error`, `always()`, or a conditional bypass.
- The report and job summary record environment, account/OU, control, previous/required/final state, action, result/reason, counts, and readiness. Upload `account-baseline-report-<environment>` with `account-baseline-report.json`; expose acceptance and result outputs to the combined deployment summary.
- Capture and retain the per-account checklist/evidence for audit. Quarterly review checks existing accounts against the 12-point readiness checklist; a gap discovered outside that review is a P2 incident and is remediated within five business days.
- Local/CI tests use in-memory fakes only and never call AWS. Use the validation requirements below before declaring implementation changes complete.

No rollback is automated. A partial run leaves later accounts untouched; investigate the failure, fix its cause, and rerun the failed protected job. Compliant controls are recognized and skipped.

## Out of Scope

This v1.0 baseline does not implement GuardDuty, Security Hub CSPM, Microsoft Sentinel, customer-managed KMS keys, new SCPs/RCPs, Organizations S3 policies, EC2 declarative policies, AWS Config rules or conformance packs, network infrastructure, backup policies, Control Tower-managed resource changes, or IAM changes. These require their own approved scope and owner.

## Components

| Component | Responsibility |
|---|---|
| `config/schemas/account-baseline-schema.ts` | Literal control targets, fixed exclusions, required `expectedEnforcedAccountCount`, empty `exceptions` |
| `config/schemas/organization-schema.ts` | Cross-checks: expectation equals the configured inventory; no excluded OU or shared-account email |
| `lib/account-baseline/types.ts` | Statuses, `BaselineWrite` (the write allow-list), result rows, AWS error classification |
| `lib/account-baseline/ports.ts` | `MemberAccountPort`, `InventoryPort`, clock |
| `lib/account-baseline/controls/*.ts` | One module per control: `read`, pure `classify`, pure `invariantProblems` |
| `lib/account-baseline/eligibility.ts` | Expected matrix from configuration and live inventory; runtime exclusion checks |
| `lib/account-baseline/capabilities.ts` | CLI commands and members per control; local capability problems |
| `lib/account-baseline/plan.ts` | Environment-wide preflight gate and post-apply validation |
| `lib/account-baseline/apply.ts` | Apply round: gate, budgets, pre-write recheck, write, settle, invariants, ledger |
| `lib/account-baseline/acceptance.ts` | Centralized acceptance evaluator |
| `lib/account-baseline/report.ts` | `account-baseline-report.json` and the job summary |
| `scripts/account-baseline-runtime.ts` | AWS CLI adapter: inventory (reuses `buildEnrollmentPlan`), `OrganizationAccountAccessRole` sessions, the five write commands |
| `scripts/reconcile-account-baseline.ts` | `--phase plan` / `apply` / `verify` |
| `.github/actions/reconcile-account-baseline/action.yml` | Environment guard, input validation, credential refresh per phase, preflight, three apply rounds, budget check, verification, artifact |
| `.github/workflows/validate-and-deploy.yml` | One step, last, for staging and production |

Keep every decision in the pure modules with unit tests. The scripts only gather state, call the pure functions and perform the allow-listed writes.

## Workflow Position

```
deploy-landing-zone-accounts
  -> enroll-control-tower-accounts
  -> configure-control-tower-auto-enrollment
  -> reconcile-account-baseline (preflight -> rounds -> verify -> artifact)
```

## Adding or Changing a Control

1. Stop unless the change is approved: a new control, a new target or a new write is a governance change.
2. Add the literal target to the schema and `config/default.yaml`.
3. Add the write to `BaselineWrite` with literal values only, and to `ALLOWED_WRITES` in `acceptance.ts`.
4. Implement the control module: read through the port, classify purely, never plan a write for a conflict, define invariants.
5. Add CLI requirements in `capabilities.ts` and adapter methods in the runtime.
6. Register the control in `controls/index.ts` in `ACCOUNT_BASELINE_CONTROL_IDS` order.
7. Add unit tests (compliant, safe non-compliant, conflicts, unsupported, AccessDenied, timeout, invariants) and extend the guard tests.

## Read-Only CLI Runbook

Run with credentials for the member account (through the established role) in `eusc-de-east-1`. Expected values after a successful deployment:

```bash
aws s3control get-public-access-block --account-id <account-id> --region eusc-de-east-1
# all four settings true
aws ec2 get-ebs-encryption-by-default --region eusc-de-east-1
# "EbsEncryptionByDefault": true
aws ec2 get-ebs-default-kms-key-id --region eusc-de-east-1
# unchanged from the report's "previous" value (alias/aws/ebs)
aws ec2 get-instance-metadata-defaults --region eusc-de-east-1
# AccountLevel.HttpTokens "required", HttpPutResponseHopLimit 2
aws ec2 get-snapshot-block-public-access-state --region eusc-de-east-1
# "State": "block-all-sharing"
aws ec2 get-image-block-public-access-state --region eusc-de-east-1
# "ImageBlockPublicAccessState": "block-new-sharing"
```

Inventory checks before a `REQUIRES_APPROVAL` decision:

```bash
aws s3api get-bucket-policy-status --bucket <bucket>
aws s3api get-bucket-ownership-controls --bucket <bucket>
aws ec2 describe-snapshots --owner-ids self --restorable-by-user-ids all --query 'Snapshots[].SnapshotId'
aws ec2 describe-images --owners self --filters Name=is-public,Values=true --query 'Images[].ImageId'
```

## Troubleshooting

| Symptom | Meaning | Action |
|---|---|---|
| Preflight `NOT_ASSESSED` everywhere | Inventory, identity, Landing Zone or enrollment blocked | Fix the reported blocker; no member account was accessed |
| `ERROR` "cannot open a OrganizationAccountAccessRole session" | Role trust or `github-actions-role` permission | IF dependency; do not change IAM from this repository |
| `ERROR` "write ... is not authorized" (DryRun) | SCP or IAM denies the EC2 write | Report the denied action and policy to IF |
| `UNSUPPORTED` | CLI model or EUSC Region rejects the operation | Record as EUSC verification result; do not substitute another control |
| `REQUIRES_APPROVAL` | Existing configuration would be changed by the baseline | Owner/IF decision; remediate the resource or approve a change to the design |
| "precondition changed since the plan" | Live state changed between plan and write | Investigate the change; rerun |
| "did not read back COMPLIANT" | Eventual consistency beyond the settle budget, or a failed apply | Re-read with the runbook; rerun failed jobs |

## Validation Before Review

```bash
pnpm run build
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run synth:staging && pnpm run synth:production
apm compile && apm audit --ci
```

All tests use in-memory fakes; local and CI validation never call AWS.
