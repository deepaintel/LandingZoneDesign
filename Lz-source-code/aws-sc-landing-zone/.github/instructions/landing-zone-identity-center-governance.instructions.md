---
description: 'AWS ESC Landing Zone IAM Identity Center architecture and implementation guardrails'
applyTo: '**/*'
---

# AWS ESC Landing Zone IAM Identity Center Instructions

Use these instructions when designing, reviewing, or implementing workforce identity and access for the AWS European Sovereign Cloud Landing Zone.

## Scope and platform facts

- Target AWS partition: `aws-eusc`.
- Target AWS Region: `eusc-de-east-1`.
- Use `arn:aws-eusc:` for AWS resource ARNs where applicable.
- Human workforce access must use AWS IAM Identity Center.
- The corporate identity provider is Microsoft Entra ID.
- Microsoft Entra ID federates authentication to AWS IAM Identity Center using SAML 2.0.
- Use SCIM 2.0 for automated user and group provisioning from Microsoft Entra ID to IAM Identity Center. Controlled manual provisioning is a fallback only if SCIM is unavailable or not yet enabled.
- Do not use OIDC as the Entra ID -> IAM Identity Center workforce federation protocol.
- OIDC remains the authentication mechanism for non-human GitHub Actions deployment roles and must not be conflated with human workforce federation.
- IAM Identity Center is available and approved as the centralized workforce access service for the AWS ESC Landing Zone.

## Identity architecture

Model human access as:

`Microsoft Entra ID -> SAML 2.0 -> AWS IAM Identity Center -> Identity Center group -> Permission Set -> AWS account assignment -> short-lived AWS role session`

Model identity provisioning as:

`Microsoft Entra ID -> SCIM 2.0 -> IAM Identity Center identity store`

Do not create long-lived IAM users or access keys for normal human access. The only exception is an explicitly approved and separately governed emergency break-glass mechanism.

## Environment separation

- Staging and Production are separate AWS Organizations.
- Maintain independent IAM Identity Center configuration, group mappings, and account assignments for Staging and Production.
- Both environments should use the same approved corporate IdP integration pattern and a common Permission Set catalogue.
- Keep environment isolation in account assignments rather than creating environment-suffixed Permission Sets unless the effective permissions materially differ.
- Staging assignments must not grant Production access.
- Production assignments must not grant Staging access.

## Permission Set catalogue

Use the following Landing Zone Permission Set names unless an approved design change replaces them:

- `PlatformAdmin-PS`
- `PlatformEngineer-PS`
- `ComplianceReadOnly-PS`
- `SecurityReadOnly-PS`
- `SecurityAdmin-PS`
- `NetworkAdmin-PS`
- `KMSAdmin-PS`
- `LoggingAdmin-PS`
- `WorkloadAdmin-PS`
- `ReadOnly-PS`

Permission Sets must follow least privilege and separation of duties. Account scope is part of the authorization model; never infer that a Permission Set is globally assignable merely because it exists.

GitHub Actions deployment is not an IAM Identity Center resource. It is a single dedicated non-human IAM role assumed directly through GitHub Actions OIDC:

- `github-actions-role`, provisioned through the Landing Zone Foundation project (`aws-sc-foundation`) and used as the common deployment identity for both the Staging and Production AWS Organizations.

This role is never represented as an Identity Center group, Permission Set, or account assignment. It is assumed only through the protected `release/*` GitHub Actions workflows. It must not be issued to or assumable by human identities, `main`, `feature/*`, `hotfix/*`, or `backport/*` branches.

The emergency role is `BreakGlassAdmin-PS`. It is reserved for explicitly authorized emergency administration and is not a normal Permission Set or standing access path.

## Access role model

Use these access constructs from the approved design:

- Cloud Platform Administrator -> `PlatformAdmin-PS`, privileged and JIT-controlled.
- Cloud Platform Engineer -> `PlatformEngineer-PS`, elevated operational access subject to scope.
- Security Administrator -> `SecurityAdmin-PS`.
- Compliance / Audit Reviewer -> `ComplianceReadOnly-PS`.
- Network Administrator -> `NetworkAdmin-PS`.
- KMS Administrator -> `KMSAdmin-PS`.
- Logging Administrator -> `LoggingAdmin-PS`.
- Workload Account Owner -> `WorkloadAdmin-PS`, scoped to approved workload accounts.
- General read-only access -> `ReadOnly-PS`.

Use group-based mappings and explicit account scope. Do not treat these constructs as globally assignable by default.

## Production access

Production follows a pipeline-first model.

- Do not create standing privileged administrative access for human identities in Production.
- Normal standing Production access should be read-only or narrowly scoped.
- Human Production write/admin access must use approved Just-in-Time elevation or emergency break-glass.
- JIT elevated access must be time-bound.
- The current design target is a maximum JIT session duration of one hour.
- Privileged elevation requires MFA re-authentication through Microsoft Entra ID.
- Users must not approve their own JIT elevation or their own Production deployment changes.
- Temporary group membership or temporary account assignment used for JIT must be automatically removed when the approved window ends.

Do not invent the PAM/ITSM integration. Treat the JIT orchestration tool, approvers, and automatic revocation mechanism as external dependencies unless they are explicitly defined in repository configuration or project documentation.

The current design target is:

- Cloud Platform Lead or another approved independent authority approves elevation.
- The requester cannot approve their own elevation or Production deployment change.
- Temporary group membership or account assignment is removed automatically at the end of the approved window.
- The maximum JIT session duration is one hour.

## Session and MFA controls

- Standard IAM Identity Center Permission Set session duration: one hour unless an approved exception says otherwise.
- MFA is enforced by Microsoft Entra ID for federated users.
- Do not describe IAM Identity Center built-in MFA as the authoritative MFA mechanism when using Entra ID as an external IdP.
- Privileged JIT elevation requires re-authentication/MFA according to the approved Entra Conditional Access and access-governance process.

## Groups and assignments

Prefer group-based authorization. Do not assign Permission Sets directly to individual users unless there is an explicit approved exception.

Use a mapping pattern such as:

`Entra group -> IAM Identity Center group -> Permission Set -> approved AWS accounts`

Example:

`AWS-LZ-PlatformEngineers -> PlatformEngineer-PS -> approved Staging/Production account assignments`

Treat exact Entra group names as configuration unless they are explicitly standardized.

The recommended mapping is:

`Entra group -> IAM Identity Center group -> Permission Set -> approved AWS accounts`

Example: `AWS-LZ-PlatformEngineers -> PlatformEngineer-PS -> approved Staging accounts`.

Keep Staging and Production group mappings and account assignments independent even when they use the same corporate Entra groups and common Permission Set catalogue.

## SCIM group scope grammar and OU expansion

SCIM provisioning group names use this grammar:

`GA AISARCH {environment}#{scope}#{permission-set} {description}`

The `{environment}` token is `Staging` or `Prod` and must match the target organization's runtime environment. A mismatched group must not create an assignment.

The `{scope}` token may be:

- a 12-digit AWS account ID
- a canonical AWS Organizations OU ID matching `^ou-[a-z0-9]{4,32}-[a-z0-9]{8,32}$`
- a canonical AWS Organizations Root ID matching `^r-[a-z0-9]{4,32}$`

OU and Root scopes are expanded before assignment creation. The resolver must traverse direct accounts and child OUs with AWS Organizations paginators, include only `ACTIVE` accounts, deduplicate account IDs, and preserve the downstream account-assignment contract. The Root scope includes all accounts in the organization tree subject to the same filters.

Every OU is treated uniformly, including `Suspended`: an OU scope expands to all ACTIVE accounts directly under that OU and recursively under its child OUs. A `Security` OU scope includes active Audit and Log Archive accounts when they are located under that OU. OU paths and derived OU keys are not valid scope values unless separately approved.

Malformed, mismatched, unresolved, or empty group scopes are skipped with structured operational logging; valid groups in the same synchronization continue processing. The group-discovery Lambda may use only the read-only Organizations APIs required for account and child-OU traversal. It must not create, move, update, or close Organizations resources.

## Infrastructure as Code and GitOps

Landing Zone IAM Identity Center desired-state configuration belongs under the IAM portion of the Landing Zone codebase, currently expected under `lib/iam/`.

IaC should manage stable desired-state resources where supported, including:

- Permission Set definitions
- Permission Set policies and attachments
- group-to-Permission Set mappings where technically practical
- standard account assignments
- related IAM policies and trust controls

Operational identity lifecycle processes may remain outside IaC when required, including:

- joiner/mover/leaver lifecycle
- SCIM synchronization
- temporary JIT membership
- temporary JIT account assignments
- emergency access operations

Any non-IaC change must remain approved, auditable, and reconcilable with the declared Landing Zone access model.

Follow the protected-release GitOps model:

`feature/* or hotfix/* -> main -> protected release/* -> Staging -> manual Production`

- `main` is the integration/source-of-truth branch and is CI-only.
- Initial creation of a protected `release/*` branch from an approved main commit triggers the first Staging deployment.
- A correction to an existing release is merged to `main` first, then selectively cherry-picked into a temporary `backport/*` branch created from the active `release/*` branch.
- Only an approved `backport/* -> release/*` pull request may update the protected release and trigger Staging redeployment.
- `backport/*` never receives AWS deployment credentials and never deploys directly.
- Production is manually promoted from the same Staging-validated `release/*` commit through `workflow_dispatch` and protected environment approval.
- Direct commits and direct cherry-picks to `release/*` are prohibited.

Do not bypass the established deployment workflow for normal changes.

## Delegated administration and service boundaries

Where supported in AWS ESC, use delegated administrator accounts for approved service functions only:

- Security services -> Security Account.
- Logging -> Log Archive Account.
- KMS -> Security or Shared Services Account.
- Network -> Shared Services Account.
- Compliance -> Audit Account.

Delegated administration must not provide unrestricted member-account administration. If a service is unavailable or differs in AWS ESC, record an approved exception rather than assuming commercial AWS parity.

## Break-glass and root governance

- Maintain one separate console-only break-glass IAM user in each Organization's Management Account.
- Do not create access keys for the break-glass user or any normal human identity.
- The break-glass user has no standing administrative permissions and may assume `BreakGlassAdmin-PS` only after explicit CISO or Cloud Platform Lead authorization.
- Require MFA, an ITSM incident before credential retrieval, automatic alerting, CloudTrail evidence, and retrospective review within 24 hours.
- Limit the break-glass window to four hours unless formally extended and documented.
- Revoke or rotate credentials immediately after use and reconcile any infrastructure change through the normal GitOps flow.
- Root-user access is separate from break-glass IAM access. Root is not used for routine operations, root access keys are prohibited, root MFA and contact ownership are controlled, and root use is alerted and periodically verified.

Machine identities, including GitHub deployment roles, CloudFormation/StackSet roles, service roles, automation roles, logging identities, and delegated-administration roles, must be non-human, least-privileged, protected from unauthorized changes, and periodically reviewed.

## Drift and validation

Do not assume CloudFormation drift detection gives complete coverage for IAM Identity Center.

Validation should compare the intended model with runtime state using supported mechanisms such as:

- CDK synth and CDK diff
- CloudFormation/StackSet drift checks where supported
- IAM Identity Center service APIs
- exported Permission Set inventories
- account assignment inventories
- group mapping validation
- IAM APIs
- AWS Organizations APIs
- trust-policy validation
- targeted validation scripts
- CloudTrail evidence where appropriate
- IAM Access Analyzer and unused-access analysis where available in AWS ESC, with an approved API-based fallback where unavailable

Material unexplained drift must block promotion until it is resolved or explicitly approved and documented.

## Governance and audit

- All human access must be attributable to a federated corporate identity.
- Use short-lived sessions.
- Record privileged actions in CloudTrail.
- Keep account assignments and group mappings reviewable and auditable.
- Unconfirmed or stale access must be revoked according to the approved governance process.
- Perform quarterly review and recertification of IAM Identity Center groups, Permission Sets, account assignments, and relevant trust policies.
- Correlate privileged and deployment activity with the GitHub PR, commit SHA, protected release, workflow run, and applicable ITSM/CAB reference where applicable.

## Implementation behavior for AI agents

When generating or reviewing implementation:

1. Separate human workforce identity from GitHub Actions OIDC.
2. Prefer configuration-driven Permission Sets, mappings, and account assignments.
3. Avoid hard-coding account IDs, group IDs, Identity Center instance ARNs, or identity-store IDs when they can be discovered or supplied by environment configuration.
4. Preserve Staging/Production isolation.
5. Do not create standing Production admin assignments.
6. Preserve the confirmed Microsoft Entra ID and SAML 2.0 federation decision; do not replace it with OIDC.
7. Treat SCIM synchronization, JIT orchestration, PAM/ITSM tooling, break-glass vault custody, access-review ownership, and ABAC (Attribute-Based Access Control) support as external dependencies unless explicitly configured.
8. Do not invent unresolved enterprise identity decisions.
9. Identify AWS ESC/CDK/CloudFormation feature gaps explicitly instead of assuming commercial AWS parity.
10. When a resource cannot be reliably managed through CloudFormation/CDK, propose an auditable API/custom-resource or validation mechanism rather than silently ignoring it.
11. Keep the design least-privileged and auditable.
12. Treat the repository as authoritative desired state for stable Landing Zone IAM configuration.

## SCIM Sync Deployment Composite Action

The follow-up workflow refactor extracts the SCIM synchronization stack deployment
mechanics into a reusable local composite action under
`.github/actions/<action-name>/action.yml`. The shared workflow-vs-composite-action
responsibility boundary, workspace and release-validation actions, refactoring principle,
authentication boundary, Production authorization boundary, and no-live-deployment rule
are authored once in
`.apm/instructions/landing-zone-ou-governance.instructions.md` §22. This section defines
only the boundary specific to the SCIM sync deployment action.

Scope note: this action deploys the CDK-managed SCIM synchronization state machine
(`lz-scim-sync`) that reconciles Entra ID SCIM group state against IAM Identity Center
account assignments. It does not implement, replace, or govern the Entra ID -> IAM
Identity Center SCIM 2.0 protocol itself. The Entra SCIM feed remains an external
dependency, unchanged by this refactor.

Responsibilities encapsulated by the action:

- `cdk diff` for `ScimSyncStack` with the `diff-continue-on-error` semantics used by the
  other deploy actions (advisory in Staging, strict in Production)
- `cdk deploy` for `ScimSyncStack` (CloudFormation stack name `lz-scim-sync`), invoked
  with `--exclusively --require-approval never --progress events`
- post-deployment runtime validation: stack status is
  `CREATE_COMPLETE` / `UPDATE_COMPLETE`, and the deployed stack contains only the
  expected SCIM runtime resource types with counts matching the static template
  validator (`scripts/validate-scim-sync-template.ts`) — at minimum six
  `AWS::Lambda::Function` resources, one `AWS::StepFunctions::StateMachine`, and one
  `AWS::Events::Rule`

Required inputs supplied by the calling workflow:

- `environment` (`staging` or `production`)
- `account-id` (12-digit management account ID)
- `aws-region` (defaults to `eusc-de-east-1`)
- `stack-id` (defaults to `ScimSyncStack`)
- `diff-continue-on-error` (`'true'` from Staging, `'false'` from Production)

Outputs exposed to the calling workflow: none. The SCIM sync stack does not produce
identifiers consumed by later workflow steps.

Prohibitions:

- must not introduce CloudFormation `Fn::Export` / `Fn::ImportValue` coupling between the
  SCIM sync stack and any other stack, and must not introduce a CDK cross-stack
  reference or `addDependency(...)` from any other stack to the SCIM sync stack, per
  `.apm/instructions/landing-zone-cloudformation-governance.instructions.md`
- must not configure a second set of AWS credentials for the same job and must not
  request `id-token: write` at the action level
- must not branch on literal environment names to select behavior; every value that
  would otherwise drive the branch is an input
- must not modify Lambda runtime code, IAM policies, Step Functions state-machine
  definitions, or event-rule configuration; those live in `src/functions/` and `lib/iam/`
  and change through the normal source-code path, not through the composite action
- must not deploy any resource type outside the approved SCIM runtime set (Lambda,
  Step Functions, EventBridge Rule, IAM roles/policies and log groups belonging to
  those); must not create Organizations resources of any kind
- must not perform Entra SCIM protocol operations or reconfigure the Entra IdP; the
  action only deploys the AWS-side state machine

Environment gating stays in the workflow:

- Both Staging and Production invoke this action, in that order in the deploy job,
  between `deploy-identity-center` and `deploy-organization-policies`.
- Production's `PRODUCTION_DEPLOYMENT_ENABLED` gate, protected `production` GitHub
  Environment approval, release-ref / commit-SHA verification, and evidence capture
  remain in `production-deploy.yml` and are not embedded in this action.

Testing:

- keep `pnpm run validate:scim-sync-template` running in `.github/actions/validate-release`
  unchanged; that static validator remains the source of truth for template-time
  guarantees (Lambda runtime version, memory, timeout, ESC region strings, retired
  environment absence)
- add or update tests only where the extraction moves shell logic previously covered by
  workflow-level assertions and that is testable in isolation
- confirm local synthesis and the static template validator still fail on any
  commercial-partition or non-ESC region reference introduced anywhere in the SCIM
  sync stack template
