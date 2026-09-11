---
description: Governance and implementation constraints for AWS Control Tower landing zone initialization in AWS European Sovereign Cloud using pre-created shared accounts.
applies_to:
  - aws-sc-landing-zone
  - staging
  - production
  - aws-eusc
  - eusc-de-east-1
status: approved-client-direction
---

# Control Tower Initialization Instructions

## 1. Purpose

This instruction defines the authoritative constraints for initializing AWS Control Tower in the existing AWS European Sovereign Cloud Landing Zone after:

- the Audit and Log Archive accounts have been provisioned
- the required Control Tower SCP compatibility updates have been deployed and validated

The current objective is to prepare the repository implementation required to initialize AWS Control Tower programmatically by using the pre-created shared-account IDs.

This phase must preserve the existing AWS Organizations / OU structure and must not create a parallel Landing Zone hierarchy.

## 2. Current Execution Boundary

The implementation must be reusable for both **Staging** and **Production** where practical.

For the current activity:

- prepare the Control Tower initialization code/configuration/workflow support
- use **Staging** as the first target environment
- **do not initialize or deploy Control Tower during code-generation/review**
- Production must remain code/configuration-ready only unless separately approved
- do not enroll Workloads OUs/accounts in this phase
- do not modify unrelated SCPs
- do not create additional AWS accounts
- do not implement tagging or IAM Identity Center assignments unless explicitly enabled as part of the approved Control Tower manifest

Actual Staging initialization is a separate controlled deployment step after code review and approval.

## 3. Authoritative Existing State

Assume the following already exists and must be reused:

- Staging AWS Organization
- existing Root and OU hierarchy
- existing Security OU
- pre-created Staging Audit account
- pre-created Staging Log Archive account
- deployed Control Tower-compatible SCP updates
- existing CDK / GitHub Actions deployment model
- existing `@ccoe-aws_if-it/ccoe-config-reader`
- existing Zod validation model
- existing environment configuration files
- existing AWS ESC region/partition configuration

Do not recreate any of these resources.

## 4. AWS Control Tower Version

Target **AWS Control Tower Landing Zone version 4.0**, unless the repository/customer explicitly records another approved version before implementation.

Landing Zone 4.0 uses the `CreateLandingZone` API with a manifest.

Do not use legacy `organizationStructure` manifest fields for Landing Zone 4.0.

If the approved Landing Zone version differs from 4.0, stop and reconcile the manifest/schema before implementation.

## 5. AWS European Sovereign Cloud Requirements

Use:

- Partition: `aws-eusc`
- Region: `eusc-de-east-1`
- ARN prefix: `arn:aws-eusc:`

Do not introduce commercial AWS partition/region assumptions.

All Control Tower API/CLI/CDK calls must target the approved AWS ESC region and partition.

## 6. Shared Account Inputs

The Control Tower manifest must consume the already-created shared-account IDs.

Required Staging shared accounts:

- **Log Archive** account ID — used for centralized logging when that integration is enabled
- **Audit** account ID — used for security roles and/or AWS Config aggregation when those integrations are enabled

Do not:

- create new shared accounts
- invent account IDs
- use placeholder IDs during deployment
- rename or move the shared accounts
- dynamically discover accounts by display name during initialization when approved IDs are already available

Validate every supplied account ID as a 12-digit AWS account ID before invoking Control Tower.

## 7. Shared Account Placement

Before initialization, validate that the Audit and Log Archive accounts:

- belong to the Staging organization
- are located in the existing Security OU
- satisfy the current Landing Zone 4.0 placement prerequisites
- are not suspended
- are not already governed by another Control Tower landing zone

If placement does not satisfy the current prerequisites, stop before initialization.

Do not move accounts automatically as part of this task.

## 8. Landing Zone Manifest

Generate the Landing Zone 4.0 manifest from validated repository configuration.

The manifest may contain:

- `governedRegions`
- `centralizedLogging`
- `config`
- `securityRoles`
- `accessManagement`
- `backup`

Only configure integrations that are explicitly approved for this Landing Zone.

For Landing Zone 4.0, configured service integrations must use their required `enabled` flags. Do not rely on implicit defaults.

The approved governed region for the current AWS ESC Landing Zone is:

- `eusc-de-east-1`

Do not add additional regions without approval.

## 9. Centralized Logging

If centralized logging is enabled:

- use the pre-created Log Archive account ID
- configure retention values only from approved configuration
- do not invent or hard-code the generated centralized logging bucket name/ARN
- do not pre-create a Control Tower-managed centralized logging bucket
- do not perform post-initialization SCP resource scoping in this phase

The generated bucket identity must be inspected only after successful Control Tower initialization.

Any `SCP-ESC-SEC-002` resource-level narrowing is a separate post-initialization compatibility activity.

## 10. AWS Config Integration

For Landing Zone 4.0, AWS Config integration is represented separately in the manifest.

If Config integration is enabled:

- use the approved account ID for the Config aggregator/resources
- use only approved retention/KMS settings
- do not pre-create conflicting Config recorders, delivery channels or aggregators
- do not invent a KMS ARN

If the project has not yet approved whether Config is enabled, stop and request the decision before generating the final deployment manifest.

## 11. Security Roles Integration

If `securityRoles.enabled` is true:

- use the approved Audit account ID
- allow Control Tower to create/manage the required security-role resources
- do not manually pre-create Control Tower-owned security roles unless the approved API-only setup process explicitly requires them

If this integration is disabled, omit account-specific configuration not required by the schema.

## 12. Access Management / IAM Identity Center

Landing Zone 4.0 requires an explicit `accessManagement.enabled` decision.

Do not assume this value.

If enabled:

- use the existing approved IAM Identity Center design
- do not create customer group/permission-set mappings unless they are part of a separately approved IAM phase

If disabled:

- ensure dependent Control Tower integrations remain schema-compatible

If the decision is not already captured in repository/customer-approved inputs, stop before finalizing the manifest.

## 13. Backup Integration

Do not enable AWS Backup integration unless explicitly approved.

Do not invent Backup account IDs or KMS keys.

## 14. Configuration Model

Follow the existing repository configuration pattern:

- `config/default.yaml`
- `config/staging.yaml`
- `config/production.yaml`
- existing Zod schema
- `@ccoe-aws_if-it/ccoe-config-reader`

Store:

- environment-independent Control Tower settings in shared/default config where appropriate
- Staging account IDs and environment-specific values in `config/staging.yaml`
- Production-specific values in `config/production.yaml`

Do not create a second configuration loader or validation framework.

Do not hard-code account IDs in TypeScript.

## 15. Initialization Method

Use the AWS Control Tower API/CLI/CDK mechanism approved by the repository.

For an API-based implementation, the required operation is conceptually:

`CreateLandingZone`

with:

- Landing Zone version
- validated manifest

The operation is asynchronous.

Capture:

- landing zone ARN
- operation identifier

Do not treat the initial API response as successful completion.

Poll the operation until it reaches a terminal state.

## 16. Operation Status Handling

Track the `CreateLandingZone` operation using the Control Tower operation-status API.

Expected terminal states include:

- `SUCCEEDED`
- `FAILED`

While status is `IN_PROGRESS`, continue polling using bounded retry/backoff logic.

Do not:

- issue a second `CreateLandingZone` request because the first call is still running
- retry blindly after a failure
- suppress the failure reason

On failure:

- capture the operation identifier
- capture available failure/status details
- inspect CloudTrail for `AccessDenied` / SCP-related failures
- stop and report the exact failure before attempting remediation

## 17. Pre-Initialization Validation

Before any Staging initialization is authorized, validate:

- correct AWS identity / Staging management account
- region is `eusc-de-east-1`
- partition is `aws-eusc`
- no existing Control Tower landing zone is already active for the Staging organization
- Audit account ID is valid and resolves to the expected Audit account
- Log Archive account ID is valid and resolves to the expected Log Archive account
- both shared accounts belong to the Staging organization
- both shared accounts are `ACTIVE`
- both shared accounts are under the expected Security OU
- neither shared account is suspended
- neither shared account is already governed by another Control Tower landing zone
- required Control Tower SCP compatibility updates are deployed
- no conflicting Config recorder/delivery channel exists in the shared accounts
- no conflicting customer-managed Control Tower-equivalent baseline is present
- manifest validates against Landing Zone 4.0 requirements
- Landing Zone version is exactly the approved version
- governed region is exactly the approved region
- all service integration enabled/disabled decisions are explicit
- the manifest contains only approved integrations and does not introduce unexpected defaults
- deployment identity has the required permission to invoke the Control Tower API
- Production is not selected

If any prerequisite is not satisfied, stop before calling `CreateLandingZone`.

## 18. SCP Boundary

Do not modify SCPs during the Control Tower initialization implementation.

If initialization encounters a new SCP denial:

- identify the exact API
- identify the calling principal
- identify the policy/SID causing the denial
- stop and report it
- handle any new SCP adjustment through the approved SCP compatibility process

Do not weaken an SCP from the Control Tower initialization workflow.

## 19. Workload Enrollment Boundary

Do not register/enroll Workloads OUs/accounts during this phase.

The following compatibility work remains deferred until after successful initial Control Tower setup:

- `SCP-ESC-WL-004`
- `SCP-ESC-IAM-001`
- `SCP-ESC-IAM-002`
- `SCP-ESC-PROD-001`
- other workload-enrollment policies proven to block Control Tower baseline deployment

Do not register the Suspended OU.

## 20. No-Deployment Rule for Code Generation

During code-generation/review:

- do not call `CreateLandingZone`
- do not run `cdk deploy`
- do not trigger GitHub deployment workflows
- do not mutate AWS Organizations
- do not register OUs
- do not enroll accounts
- do not modify live AWS

Only non-mutating validation is allowed.

## 21. Post-Initialization Validation

After a separately authorized Staging initialization succeeds, validate:

- `GetLandingZoneOperation` reports `SUCCEEDED`
- landing zone ARN is captured
- `GetLandingZone` returns the expected Landing Zone
- Landing Zone version matches the approved version
- Landing Zone status is healthy/active
- Landing Zone drift status is `IN_SYNC`
- configured service integrations show the expected state
- Audit and Log Archive account IDs in the deployed Landing Zone configuration match the approved repository values
- Audit and Log Archive accounts are recognized correctly
- centralized logging resources are healthy if enabled
- AWS Config integration/aggregator is healthy if enabled
- required Control Tower roles/resources are present
- no unexpected Control Tower policy attachments were created outside approved targets
- no unexpected OU/account enrollment occurred
- existing OU hierarchy remains unchanged
- no workload OUs/accounts were enrolled
- Production remains untouched
- CloudTrail review shows no unresolved `AccessDenied`, `UnauthorizedOperation`, or failed Control Tower-related API calls

### 21.1 Deployed Manifest Validation

After successful initialization:

1. retrieve the deployed Landing Zone configuration using `GetLandingZone`
2. extract the returned Landing Zone manifest/configuration
3. compare it with the expected manifest generated from the repository
4. validate at minimum:
   - governed region(s)
   - Landing Zone version
   - Audit account ID
   - Log Archive account ID
   - centralized logging enabled/disabled state
   - AWS Config enabled/disabled state
   - security roles enabled/disabled state
   - access management enabled/disabled state
   - backup enabled/disabled state
5. fail validation if the deployed configuration materially differs from the approved repository-generated configuration

The comparison must focus on approved functional configuration. Do not fail solely because AWS returns fields in a different order or includes service-generated metadata that is not part of the repository manifest.

Capture the generated centralized logging bucket identity for the separate post-init `SCP-ESC-SEC-002` scoping review.

## 22. Exit Criteria

The implementation/code-review phase is complete when:

- Landing Zone 4.0 manifest generation is implemented
- Staging shared-account IDs are consumed from approved configuration/output
- configuration/schema validation is implemented
- pre-init checks are implemented
- asynchronous operation polling/error handling is implemented
- tests/static validations pass
- Production remains non-deploying
- no live initialization occurred during code generation
- implementation is ready for controlled Staging initialization

The Staging initialization phase itself is complete only when the Control Tower operation reports `SUCCEEDED` and post-initialization validation passes.
