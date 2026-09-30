---
description: Governance and implementation constraints for updating existing SCPs to support AWS Control Tower initialization in AWS European Sovereign Cloud.
applies_to:
  - aws-sc-landing-zone
  - staging
  - production
  - aws-eusc
  - eusc-de-east-1
status: approved-client-direction
---

# Control Tower SCP Compatibility Instructions

## 1. Purpose

This instruction defines the authoritative constraints for updating the **existing** AWS Organizations Service Control Policies (SCPs) so that AWS Control Tower can be initialized and subsequently manage its required baseline resources in AWS European Sovereign Cloud.

The Audit and Log Archive accounts are provisioned separately through the approved shared-account provisioning phase.

This phase is limited to **Control Tower compatibility updates to existing SCPs**. Preserve the original security intent and introduce only the minimum approved exception or scope change required for AWS Control Tower.

## 2. Current Execution Boundary

The implementation must be reusable for both **Staging** and **Production**.

For the current activity:

- update code/configuration/tests for both environments where the same policy implementation is shared
- **do not deploy any SCP changes to Staging or Production during code generation**
- Staging deployment will occur only after code review and approval
- Production deployment remains a later separately approved activity
- do not initialize AWS Control Tower as part of this activity

## 3. Existing Policy Ownership

Use and preserve:

- `.apm/instructions/landing-zone-scp-governance.instructions.md`
- the approved SCP/RCP design catalogue and captured rulings
- existing policy IDs and names
- existing Root / OU targets and attachment model
- the existing `OrganizationPolicyStack`
- `@ccoe-aws_if-it/ccoe-config-reader`
- the existing Zod configuration/validation model
- the existing deployment-time Root / OU ID parameter pattern
- the existing GitHub Actions deployment model

Do not:

- create replacement or duplicate SCPs for Control Tower
- change policy targets unless explicitly required by this instruction
- weaken unrelated statements
- modify RCPs
- recreate or modify OUs
- create accounts
- initialize Control Tower

## 4. SCPs in Scope

Update only these existing SCPs for the initial Control Tower compatibility phase:

1. `SCP-ESC-ROOT-003`
2. `SCP-ESC-SEC-001`
3. `SCP-ESC-SEC-002`
4. `SCP-ESC-SEC-003`
5. `SCP-ESC-ENC-001`

No other SCP is in scope unless implementation analysis proves that Control Tower initialization in the Security OU is blocked by another existing policy. If that occurs, stop and report the exact policy, SID, API/action and reason before changing it.

## 5. General Remediation Principle

For every in-scope policy:

- preserve the original deny/control intent
- introduce the narrowest possible Control Tower compatibility change
- prefer a **principal exemption** when the conflict is principal-specific
- prefer **resource scoping** when the current policy is broader than the intended protected resource
- do not remove an existing SCP
- do not remove an entire deny statement when a scoped exemption is sufficient
- do not create broad `Allow` statements as a workaround
- do not grant general exemptions to unrelated principals
- keep Control Tower exemptions explicit and independently identifiable where practical
- reuse the existing principal-exemption/configuration mechanism if one already exists

## 6. Control Tower Principals

Before implementation, inspect the current repository and determine which Control Tower principals are actually required by the affected API actions.

Potentially relevant roles/principals may include:

- `AWSServiceRoleForControlTower` — service-linked role in the management account (auto-created when Organizations trusted access is enabled for `controltower.amazonaws.com`; see `control-tower-initialization.instructions.md` §6.1)
- `AWSControlTowerAdmin` — customer-managed prerequisite in the management account (created by `ControlTowerRolesStack`; see `control-tower-initialization.instructions.md` §11.1)
- `AWSControlTowerExecution` — Control Tower-managed member-account role (created by Control Tower during initialization; NOT pre-created)
- `AWSControlTowerStackSetRole` — customer-managed prerequisite in the management account (created by `ControlTowerRolesStack`; see §11.1)
- Control Tower / CloudFormation StackSet execution-role patterns required by the current implementation

Do **not** blindly add every listed role to every policy.

For each policy statement:

1. identify the principal that performs the blocked action
2. exempt only the principal(s) needed for that statement
3. preserve the deny for all other principals
4. use the correct `arn:aws-eusc:` partition or existing partition-aware ARN construction
5. avoid commercial `arn:aws:` assumptions

If the exact principal/action relationship cannot be established from the approved design/repository context, stop and report the uncertainty instead of guessing.

## 7. Policy-Specific Requirements

### 7.1 `SCP-ESC-ROOT-003` — Policy Governance Protection

Preserve the protection restricting Organizations policy mutation to approved automation principals.

Control Tower compatibility must allow only the required Control Tower governance principal(s) to perform the existing protected policy lifecycle actions, including as applicable:

- `organizations:CreatePolicy`
- `organizations:UpdatePolicy`
- `organizations:DeletePolicy`
- `organizations:AttachPolicy`
- `organizations:DetachPolicy`

Keep existing pipeline-role exemptions intact. Do not broadly exempt all AWS service principals.

### 7.2 `SCP-ESC-SEC-001` — Security Monitoring Protection

Preserve CloudTrail and AWS Config protection.

Add scoped Control Tower principal exemptions only to the statement(s) whose lifecycle actions Control Tower requires during initialization or later management.

Do not weaken unrelated GuardDuty/Security Hub/CSPM controls unless analysis proves they are part of the same required operation.

Do not create or modify CloudTrail/Config resources in this SCP activity.

### 7.3 `SCP-ESC-SEC-002` — Log Archive / S3 Immutability Protection

Preserve the Log Archive immutability objective.

The current policy must be reviewed for overly broad `Resource: "*"` scope on S3 destructive/object-lock/bucket-policy actions.

Preferred approach:

1. determine whether the resource scope of the Control Tower-managed centralized logging bucket created during landing-zone initialization is reliably known
2. if known, prefer narrowing the resource scope while preserving immutability
3. if resource scoping alone is insufficient, add only the required Control Tower principal exemption
4. preserve protection for non-Control-Tower principals

Do not assume a fixed bucket name/prefix and do not invent a bucket ARN or ARN pattern. If the resource identity for the **Control Tower-managed centralized logging bucket created during landing-zone initialization** cannot be known reliably before initialization, retain only the approved principal-scoped exemption for this phase and defer resource-level narrowing to a separate post-initialization compatibility update.

### 7.4 `SCP-ESC-SEC-003` — AWS Config Aggregator Protection

Preserve the Config aggregator protection.

Add only the required Control Tower principal exemption to the existing protected aggregator actions.

Do not create or configure the aggregator in this phase.

### 7.5 `SCP-ESC-ENC-001` — KMS Lifecycle / Tag Protection

Preserve KMS deletion, disable and rotation protections.

Modify only the statement(s) that actually conflict with Control Tower. Add the required Control Tower principal exemption to KMS tagging operations where needed.

Do not weaken KMS deletion/rotation protections unless separately approved and demonstrably required.

Do not create KMS resources in this phase.

## 8. Policies Explicitly Deferred

Do **not** modify these workload/enrollment-related policies in the initial Control Tower initialization compatibility change:

- `SCP-ESC-WL-004`
- `SCP-ESC-IAM-001`
- `SCP-ESC-IAM-002`
- `SCP-ESC-PROD-001`
- other workload-only policies not inherited by the Security OU

These may require Control Tower StackSet/execution-role exemptions later when Workloads OUs/accounts are registered or enrolled.

The current objective is only to make the Root/Security policy path compatible with initial Control Tower setup using the pre-created Audit and Log Archive accounts.

## 9. Configuration Model

Follow the current repository model.

If new Control Tower principal exemptions are configuration-driven:

- extend the existing governance/policy-exemption configuration
- keep environment-independent principal patterns in `config/default.yaml` where appropriate
- use `config/staging.yaml` / `config/production.yaml` only for genuinely environment-specific values
- extend the existing Zod schema if required
- continue using `@ccoe-aws_if-it/ccoe-config-reader`
- reuse existing exemption helpers/configuration rather than duplicating them

Do not hard-code customer/environment identifiers or commercial AWS ARNs in policy source code.

## 10. AWS European Sovereign Cloud Requirements

Required context:

- Partition: `aws-eusc`
- Region: `eusc-de-east-1`
- ARN prefix: `arn:aws-eusc:`

Any principal ARN patterns must use ESC-compatible or partition-aware construction.

## 11. Testing and Validation

Add/update tests for every modified policy.

Validation must demonstrate:

1. original security deny still applies to ordinary/non-exempt principals
2. only intended Control Tower principal(s) are exempted
3. existing approved pipeline/break-glass exemptions remain intact unless intentionally changed
4. policy target/attachment remains unchanged
5. no new SCP/RCP is created
6. no existing SCP/RCP is removed
7. no OU/account resource is created
8. no tagging policy is modified
9. no Control Tower API call is executed
10. no deployment is performed

Run only non-deploying validation during implementation/review:

- build
- type-check
- lint
- unit tests
- CDK synth for Staging
- CDK synth for Production
- existing SCP/template static validation
- CDK diff only if read-only and non-mutating

Review synthesized policy JSON for unintended exemption breadth.

## 12. Deployment Boundary

This instruction permits implementation/code preparation only.

During this activity:

- do not execute `cdk deploy`
- do not trigger GitHub deployment workflows
- do not call Organizations mutation APIs
- do not initialize Control Tower

After review/approval, Staging SCP deployment will be a separate controlled action. Production deployment is not approved in the current phase.

## 13. Exit Criteria

Complete when:

- all five in-scope existing SCPs have the minimum required Control Tower compatibility updates
- original security intent remains intact
- implementation is reusable for Staging and Production
- tests validate both deny behaviour and scoped exemptions
- Staging and Production synth/validation succeed
- no deployment occurred
- no workload-enrollment SCP was modified
- Control Tower was not initialized
- code is ready for review and later controlled Staging deployment

## 14. Next Phase

After code review and controlled Staging deployment/validation of these SCP updates:

1. initialize AWS Control Tower programmatically using the pre-created Staging Audit and Log Archive account IDs
2. validate Control Tower initialization and shared-account setup
3. address workload-enrollment SCP compatibility separately before enrolling Workloads OUs/accounts
