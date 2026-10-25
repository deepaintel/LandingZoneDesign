---
name: aws-identity-center-landing-zone
description: >-
  Activate when designing, implementing, reviewing, testing, or troubleshooting
  AWS IAM Identity Center for the AWS European Sovereign Cloud Landing Zone,
  especially Microsoft Entra ID federation, SAML, SCIM, Permission Sets,
  group mappings, AWS account assignments, Staging/Production separation,
  JIT privileged access, or Identity Center drift validation.
---

# AWS IAM Identity Center Landing Zone Skill

Use this skill to produce implementation-ready designs and code changes for workforce identity in the AWS ESC Landing Zone.

When changing repository YAML configuration or Zod schemas, also follow `.apm/skills/manage-landing-zone-configuration/SKILL.md`; this skill remains authoritative for Identity Center-specific fields, values, and invariants.

This skill contains the active IAM Identity Center architecture, implementation, and validation constraints for the repository.

## Goal

Implement IAM Identity Center as the authoritative AWS workforce-access layer while preserving:

- Microsoft Entra ID as the corporate identity provider
- SAML 2.0 for Entra ID -> IAM Identity Center authentication federation
- SCIM 2.0 for user/group provisioning when enabled
- Permission Set based authorization
- group-based access
- separate Staging and Production account assignments
- short-lived sessions
- least privilege
- JIT privileged Production access
- full auditability
- GitOps-managed desired state
- a single common non-human deployment role shared by Staging and Production
- controlled emergency break-glass access
- delegated administration constrained to approved service functions

## Start every task by classifying it

Determine whether the request is about:

1. **Federation** — Entra ID, SAML metadata, sign-in flow.
2. **Provisioning** — SCIM users/groups and identity lifecycle.
3. **Authorization** — Permission Sets, policies, group mappings, account assignments.
4. **Privileged access** — JIT elevation, Production administration, MFA re-authentication.
5. **IaC implementation** — CDK constructs, config model, deployment order.
6. **Validation** — runtime discovery, drift detection, tests, acceptance criteria.
7. **Governance** — recertification, audit evidence, separation of duties.
8. **Non-human identity** — GitHub Actions OIDC; keep this separate from Identity Center.

Do not combine federation, provisioning, and authorization into a single vague concept. State which layer is being changed.

## Architecture constraints

### Authentication

Use:

`Microsoft Entra ID --SAML 2.0--> AWS IAM Identity Center`

Do not propose OIDC as a replacement for SAML for the Entra ID -> IAM Identity Center external IdP connection.

### Provisioning

Preferred:

`Microsoft Entra ID --SCIM 2.0--> IAM Identity Center identity store`

SCIM handles user/group provisioning and deprovisioning. If SCIM is unavailable or not yet approved, controlled manual provisioning is a fallback, not the desired end state.

### Authorization

Use:

`Entra group -> Identity Center group -> Permission Set -> AWS account assignment`

Prefer groups rather than direct user assignments.

### SCIM scope resolution

The approved Entra group grammar is:

`GA AISARCH {environment}#{scope}#{permission-set} {description}`

For SCIM provisioning, `{scope}` accepts a 12-digit account ID, a canonical Organizations OU ID, or a canonical Organizations Root ID. Any OU, including `Suspended`, expands to all ACTIVE accounts directly under that OU and recursively under its child OUs before account assignments are created. Deduplicate accounts, use paginated Organizations APIs, and retain account-level `AWS_ACCOUNT` assignment output.

Enforce the `Staging`/`Prod` environment token against runtime configuration. Skip malformed, mismatched, unresolved, or empty scopes with structured logging while continuing valid groups. Do not add OU paths or keys without an approved configuration-resolution design. The group-discovery Lambda receives only the least-privilege Organizations read permissions required for traversal.

### Automation identities

Use:

`GitHub Actions --OIDC--> dedicated IAM deployment role`

GitHub Actions deployment roles are outside IAM Identity Center. Never represent them as Identity Center users, groups, Permission Sets, or account assignments, and never route GitHub Actions through IAM Identity Center.

## Permission Set baseline

Use these names as the baseline catalogue:

| Permission Set          | Intent                                                       |
| ----------------------- | ------------------------------------------------------------ |
| `PlatformAdmin-PS`      | Privileged Landing Zone administration; Production JIT only |
| `PlatformEngineer-PS`   | Platform engineering, deployment support, validation        |
| `ComplianceReadOnly-PS` | Compliance and audit read-only                              |
| `SecurityReadOnly-PS`   | Security findings and control validation read-only          |
| `SecurityAdmin-PS`      | Scoped security administration                              |
| `NetworkAdmin-PS`       | Central network administration                              |
| `KMSAdmin-PS`           | KMS administration                                          |
| `LoggingAdmin-PS`       | Central logging administration                              |
| `WorkloadAdmin-PS`      | Scoped workload administration                              |
| `ReadOnly-PS`           | General read-only troubleshooting and inspection            |

Do not create `-Staging` and `-Production` copies automatically. Reuse the common Permission Set and vary the account assignment unless the policy itself differs.

The deployment identity is a single dedicated IAM role outside this human Permission Set catalogue:

- `github-actions-role`, provisioned through the Landing Zone Foundation project (`aws-sc-foundation`) and shared by both the Staging and Production AWS Organizations

This role is assumed directly through GitHub Actions OIDC and is never provisioned, assigned, or accessed through IAM Identity Center.

The emergency role is `BreakGlassAdmin-PS`. It is not a standing human access path.

## Account-assignment rules

When generating assignments:

- Make account scope explicit.
- Keep Staging and Production independent.
- Never make a broad assignment merely because the Permission Set exists.
- Production workload administration should be pipeline-first.
- Standing human Production access should be read-only or narrowly scoped.
- Privileged Production assignments must be temporary/JIT.

## JIT rules

For Production privileged access:

1. User submits an approved access request through the enterprise PAM/ITSM process.
2. Approval must be performed by an authorized person other than the requester.
3. Require Entra MFA re-authentication.
4. Grant temporary Identity Center group membership or account assignment.
5. Grant the approved privileged Permission Set.
6. Limit the access window; current design maximum is one hour.
7. Remove temporary membership/assignment automatically.
8. Preserve CloudTrail and access-request evidence.

Do not fabricate the specific PAM product or workflow if it is not provided.

The approved design also requires four-hour maximum break-glass access, MFA, ITSM authorization before credential retrieval, CloudTrail/EventBridge alerting, immediate credential rotation or disablement, and retrospective review within 24 hours. A dedicated console-only break-glass IAM user exists only in each Organization's Management Account and has no access keys or standing administrator permissions.

## CDK implementation guidance

Prefer a configuration-driven design.

A useful conceptual model is:

```ts
interface IdentityCenterConfig {
  permissionSets: PermissionSetDefinition[];
  groupMappings: GroupPermissionMapping[];
  accountAssignments: AccountAssignmentDefinition[];
}
```

Environment configuration should determine account scope rather than embedding Staging/Production knowledge throughout constructs.

Keep stable desired-state configuration in the repository. Runtime-discovered values such as Identity Center instance ARN, identity-store ID, group IDs, and account IDs should be discovered or resolved through configuration rather than copied into code without justification.

Before generating specific CDK resource types, verify that the required IAM Identity Center resources are supported in the target AWS ESC partition and by the CDK/CloudFormation version used by the repository. If not supported, state the gap and use a deliberate, auditable fallback such as a custom resource or controlled deployment script.

Also model delegated administration explicitly where applicable: Security in the Audit account (centralized security administration, where supported in AWS ESC), Logging in the Log Archive Account, KMS in the Security or Shared Services Account, Network in the Shared Services Account, and Compliance in the Audit Account. Delegated administration must remain limited to approved service functions.

## Suggested implementation sequence

When asked to implement Identity Center, prefer this order:

1. Resolve the target AWS Organization/environment.
2. Discover or configure the IAM Identity Center instance and identity-store identifiers.
3. Define the Permission Set catalogue.
4. Define policies/attachments for each Permission Set.
5. Resolve configured Entra/Identity Center groups.
6. Define group-to-Permission Set mappings.
7. Define account assignments.
8. Apply Staging/Production isolation.
9. Configure session duration.
10. Add validation for assignments and Permission Sets.
11. Add drift/reconciliation checks.
12. Deploy the first approved release through the protected `release/*` path to Staging.
13. For a correction to a release that has not been published yet, merge the fix to `main`, create `backport/*` from the active release, cherry-pick only the approved commit, and merge it through an approved PR into `release/*`.
14. Validate Staging and capture drift/audit evidence.
15. Queue the same Staging-validated `release/*` commit for Production in the release run; protected `production` GitHub Environment approval precedes the Production job. External governance evidence remains outside the workflow.
16. After successful Production deployment, the release run tags the commit, publishes the GitHub Release with generated notes, and deletes the release branch. The released branch is closed; later changes ship in a new release branch from `main`.

Never deploy directly from `main`, `feature/*`, `hotfix/*`, or `backport/*`. Direct commits and direct cherry-picks to `release/*` are prohibited.

## Testing and acceptance checks

For generated tests or acceptance criteria, verify at minimum:

- IAM Identity Center exists/is discoverable for the target environment.
- Corporate federation is documented/configured as Microsoft Entra ID using SAML 2.0.
- SCIM provisioning status is explicit.
- Required Permission Sets exist.
- Permission Set session duration matches the approved design.
- Expected group mappings exist.
- Expected AWS account assignments exist.
- Unexpected cross-environment assignments do not exist.
- OU and Root scoped groups resolve only to approved ACTIVE accounts in the target organization.
- Production Platform Admin is not a standing human assignment.
- GitHub Actions deployment roles still use OIDC and are not human-assumable.
- Drift validation can enumerate Permission Sets and account assignments.
- CloudTrail provides audit evidence for privileged activity.
- Break-glass use is time-limited, MFA-protected, ITSM-authorized, alerted, rotated/disabled after use, and reviewed within 24 hours.
- Root-user controls are verified and root access keys do not exist.
- Machine identities and deployment roles are non-human and least-privileged.
- Delegated administrator roles remain limited to their approved service functions.
- Quarterly access recertification covers groups, Permission Sets, account assignments, and relevant trust policies.
- Deployment evidence correlates PR, commit, release branch, workflow run, target account/role, and ITSM/CAB reference where applicable.

## Review checklist

When reviewing a pull request, flag:

- direct IAM users for normal human access
- long-lived access keys
- OIDC proposed for Entra -> IAM Identity Center
- direct user assignments where group assignment should be used
- wildcard/broad account assignments
- Staging groups mapped into Production unintentionally
- standing Production admin assignments
- hard-coded Identity Center IDs without clear reason
- missing one-hour session control where required
- missing JIT handling for privileged Production access
- missing break-glass MFA, ITSM, four-hour limit, alerting, rotation, or 24-hour review controls
- missing root-user governance or machine-identity review
- delegated administration that grants unrestricted member-account access
- direct commits/cherry-picks to `release/*` or deployment credentials on `backport/*`
- code that assumes commercial AWS service support without validating AWS ESC
- IaC changes with no corresponding drift/runtime validation strategy

## Output expectations

When asked for a design, produce:

- architecture
- configuration model
- required AWS resources
- enterprise dependencies
- security controls
- deployment sequence
- validation approach
- unresolved decisions

When asked for implementation, produce code that fits the repository conventions and explicitly call out any AWS ESC or CloudFormation/CDK limitation that prevents a fully declarative implementation.

When asked for a User Story, separate:

- implementation tasks
- external identity-team dependencies
- acceptance criteria
- follow-up items that depend on PAM/SCIM/enterprise decisions

## SCIM Sync Deployment Composite Action

The `deploy-scim-sync` action deploys the AWS-side state machine that reconciles Entra-provisioned SCIM group state against IAM Identity Center account assignments. It does **not** implement or replace the Entra ID -> IAM Identity Center SCIM 2.0 protocol, and it does not reconfigure the Entra IdP.

The action owns only the cohesive `ScimSyncStack` deployment mechanics:

- `cdk diff` for `ScimSyncStack`, using advisory diff behavior in Staging and strict behavior in Production as explicitly passed by the workflow;
- `cdk deploy` for stack name `lz-scim-sync`, with `--exclusively --require-approval never --progress events`;
- post-deployment status and resource-count validation against `scripts/validate-scim-sync-template.ts` (at minimum six Lambda functions, one Step Functions state machine, and one EventBridge rule).

Inputs supplied by the calling workflow are `aws-environment`, `account-id`, `aws-region`, `stack-id`, `scim-sync-stack-name`, and `diff-continue-on-error`. The action produces no outputs. The calling workflow sets up the workspace, configures credentials, selects environment/permissions, gates Production, and writes workflow summaries. Invoke it in both environments after `deploy-identity-center` and before `deploy-organization-policies`.

The action must not:

- configure a second credential set, request `id-token: write`, or branch on literal environment names;
- introduce `Fn::Export`/`Fn::ImportValue` or CDK cross-stack references;
- modify Lambda runtime code, IAM policies, Step Functions definitions, event-rule configuration, or Entra SCIM settings;
- deploy resources outside the approved SCIM runtime set or create Organizations resources;
- move Production authorization or external approval evidence into the composite action.

Keep `pnpm run validate:scim-sync-template` in the release validator; it remains the source of truth for template properties such as Lambda runtime, memory, timeout, and ESC Region. Add isolated action-logic tests where applicable and preserve CI's AWS-credential-free boundary.
