# Landing Zone SCP / RCP Governance

## Purpose

These instructions define the mandatory governance constraints for AWS Organizations Service Control Policy (SCP) and Resource Control Policy (RCP) implementation in the `aws-sc-landing-zone` repository.

These rules apply whenever an AI agent creates, modifies, reviews, validates, or integrates SCP/RCP functionality.

---

## Authoritative Design Source

The approved SCP/RCP design catalogue is authoritative for:

- policy ID and policy name
- policy type
- Root / OU target
- control purpose and intent
- priority
- framework mappings
- explicitly documented AWS actions
- explicitly documented conditions
- explicitly documented exemptions
- AWS European Sovereign Cloud requirements
- inheritance intent
- documented dependencies and exclusions

The design catalogue is a design specification and is not necessarily a complete policy JSON specification.

Where implementation detail is not explicitly provided, derive only the minimum AWS Organizations policy required to satisfy the documented control intent.

Do not:

- invent new controls
- add unrelated protections
- broaden an approved control
- weaken an approved control
- infer undocumented targets
- infer undocumented exemptions
- create additional SCPs merely to improve framework coverage
- claim derived policy JSON was copied directly from the catalogue

Any ambiguity affecting policy semantics or target placement must be reported rather than silently resolved.

---

## Policy Target Consistency

Before implementing or modifying an SCP, validate its target against all applicable authoritative references, including:

- OU hierarchy and SCP inheritance mapping
- complete SCP inventory
- individual SCP definition

If authoritative references disagree:

- mark the policy as having a target conflict
- do not silently select one target
- do not implement the affected target until an approved ruling exists
- report the exact conflict

Approved rulings already captured in the repository must be preserved.

---

## Existing OU Boundary

The existing Landing Zone OU implementation is authoritative.

The current OU hierarchy contains 14 OUs.

SCP/RCP implementation must:

- reuse the approved OU inventory (same OU keys, same names, same hierarchy)
- resolve OU IDs at deployment time through CloudFormation parameters, not through cross-stack references
- preserve the approved OU hierarchy
- preserve inheritance relationships
- preserve approved Root / OU attachment mappings

Do not:

- recreate OUs
- duplicate OU resources
- redesign the OU hierarchy
- hard-code generated OU IDs
- create `AWS::Organizations::Account` resources as part of SCP work (shared-account provisioning is a separate approved phase governed by `.apm/instructions/shared-account-provisioning.instructions.md` and `.apm/skills/generate-account/SKILL.md`, which must reuse the existing OU hierarchy without modifying it and must not modify SCPs as part of the same change)

---

## Organization Policy Stack Integration

The shared `landing-zone-cloudformation-governance` instruction defines the repository-wide prohibition on CloudFormation Export/Import coupling. For the OU Structure stack (`lz-ou-structure`) and Organization Policy stack (`lz-organization-policies`), apply that rule as follows:

The Organization Policy stack must:

- declare `OrganizationRootId` as a pattern-constrained CloudFormation parameter
- declare `OrganizationId` as a pattern-constrained CloudFormation parameter
- declare one pattern-constrained CloudFormation parameter per OU it needs (named `OuId<PascalCase(key)>`, matching the OU stack's corresponding output name)
- resolve every policy `targetIds` entry to a `Ref` on one of those parameters
- reference no construct, token or property of the OU stack, so CDK synthesizes no cross-stack `Fn::Export` / `Fn::ImportValue`

The OU Structure stack must:

- emit one plain `CfnOutput` per OU (no `exportName`), so the deployment workflow can read the OU IDs via `aws cloudformation describe-stacks`
- emit no `Fn::Export` (adding `exportName` to any output is prohibited)

The deployment workflow must:

- deploy the OU stack first
- read the OU IDs from the deployed OU stack's `OuId*` outputs (and the Root ID from the `prepare-organization` composite action)
- pass every required identifier to the policy stack as `--parameters "Name=Value"`, exactly as `OrganizationRootId` is already passed today

The CDK application must NOT:

- use `stack.addDependency(...)` to express the OU-before-policy ordering (workflow-level ordering replaces it)
- pass one stack's construct instance into another stack's props
- read another stack's `CfnOutput`, `attr*` value or generated resource attribute
- introduce `Fn::ImportValue`, cross-account SSM Parameter Store lookups, or any other runtime cross-stack coupling mechanism

Local synthesis, unit tests and the static template validator must fail on any `Fn::ImportValue` or `Fn::Export` appearing between these two stacks.

---

## SCP Implementation Requirements

SCPs must use AWS Organizations native CloudFormation resources through AWS CDK.

Use:

- `aws-cdk-lib/aws-organizations`
- `organizations.CfnPolicy`
- `SERVICE_CONTROL_POLICY`
- native `targetIds` for approved Root / OU attachment

Do not use:

- `AWS::Organizations::PolicyAttachment`
- Lambda custom resources for SCP attachment
- AWS SDK scripts for SCP attachment
- AWS CLI commands for SCP attachment
- manual post-deployment SCP attachment

The organization policy stack owns policy creation and Root / OU attachment wiring.

---

## Account-Level SCP Attachments

Account-level SCP attachment is a separate implementation phase.

Where the catalogue identifies an account-level SCP target and the account is not yet available:

- retain the intended account mapping as deferred metadata
- mark the mapping as `DEFERRED - ACCOUNT NOT YET CREATED`
- do not create the account
- do not invent an account ID
- do not use placeholder account IDs
- do not add account IDs to policy `targetIds`

Account-level attachments must only be implemented during the approved account-level SCP attachment phase after account creation.

---

## RCP Governance

Resource Control Policies must remain distinct from Service Control Policies.

Approved RCPs must:

- preserve their approved policy names
- preserve their approved policy intent
- preserve their approved targets
- use `RESOURCE_CONTROL_POLICY`
- remain independently testable

Do not implement an RCP as an SCP.

The currently approved Root-level RCPs are:

- `RCP-ESC-S3-001`
- `RCP-ESC-KMS-001`

Do not introduce additional RCPs unless they are present in the approved design.

---

## AWS European Sovereign Cloud Requirements

All policy implementation must remain compatible with AWS European Sovereign Cloud.

Required values:

- Partition: `aws-eusc`
- Region: `eusc-de-east-1`
- ARN prefix: `arn:aws-eusc:`
- STS endpoint: `sts.eusc-de-east-1.amazonaws.eu`

Do not introduce commercial AWS partition, region, ARN or endpoint assumptions.

If an SCP or RCP depends on AWS ESC behaviour that cannot be confirmed, report the affected implementation as blocked rather than introducing
an assumption.

---

## Organization Identifiers

The CDK application does not create the AWS Organization or Organizations Root.

`OrganizationRootId` must be resolved at deployment time.

`OrganizationId`, where required for RCP implementation, must also remain deployment-time information.

Every OU ID required by a policy attachment must be resolved at deployment time through an `OuId<PascalCase(key)>` CloudFormation parameter declared on the policy stack; the value is supplied by the deployment workflow from the OU stack's matching output. OU IDs must never be resolved through cross-stack references, `Fn::ImportValue`, `Fn::GetAtt` on another stack's resource, `stack.addDependency(...)`, or any other CDK / CloudFormation coupling mechanism.

Do not:

- hard-code `OrganizationRootId`
- hard-code `OrganizationId`
- hard-code any OU ID
- store generated Root IDs in source configuration
- store Organization IDs in source configuration
- store generated OU IDs in source configuration
- introduce a second organization discovery mechanism where an existing approved interface already exists

---

## Configuration Model

Preserve the existing repository configuration model:

- `config/default.yaml`
- `config/staging.yaml`
- `config/production.yaml`
- `config/schemas/organization-schema.ts`

Use:

- `@ccoe-aws_if-it/ccoe-config-reader`
- the existing Zod validation model

Extend configuration only when genuinely required for policy metadata.

Do not:

- reintroduce removed `lib/config/*` files
- create a second configuration loader
- create a second validation framework

---

## Repository Architecture

Preserve separation of responsibilities.

Reusable organization-policy constructs may:

- create AWS Organizations policies
- accept approved policy content
- accept resolved Root / OU targets
- use deterministic construct IDs

Reusable policy constructs must not perform:

- AWS discovery
- AWS deployment
- Organizations API calls outside CloudFormation

The organization policy stack may:

- orchestrate approved SCPs and RCPs
- declare a CloudFormation parameter per required deployment-time identifier (Root ID, Organization ID, one per OU)
- consume the shared organization configuration for the LIST of OU keys, so it can declare the matching `OuId<PascalCase(key)>` parameters without touching the OU stack
- consume deployment-time Organization identifiers
- own policy attachment through `targetIds`

The organization policy stack must NOT:

- import, reference or read any construct, token, output or resource attribute from the OU stack
- receive an instance of the OU stack (or any of its constructs) through its props
- declare a CDK-level `addDependency(...)` on the OU stack (workflow-level ordering replaces it)

Do not place large SCP/RCP policy definitions in `bin/landing-zone.ts`.

---

## Foundation Ownership Boundary

`aws-sc-foundation` owns:

- GitHub OIDC
- `github-actions-role`
- CDK bootstrap resources
- CDK bootstrap roles
- publishing roles
- IAM trust configuration
- approved foundation credential actions
- AWS ESC STS endpoint configuration
- bootstrap/readiness validation

`aws-sc-landing-zone` consumes these capabilities.

Do not recreate foundation-owned resources in the Landing Zone repository.

---

## Branch and Deployment Governance

The approved deployment flow is:

`feature/* -> main -> release/* -> Staging -> approvals -> manual Production`

Rules:

- `main` is CI-only
- `main` must not deploy
- `release/*` is the only AWS deployment source
- Production remains manual through `workflow_dispatch`
- Production must deploy the same approved `release/*` baseline validated in Staging
- feature, hotfix and backport branches must not deploy directly
- do not introduce a `develop` deployment model
- do not weaken GitHub Environment or branch protections

CI remains non-deploying.

---

## Deployment and Attachment Ownership

The organization policy stack owns policy creation and Root / OU attachment wiring.

Deployment workflows must deploy the stack and must not recreate policy attachment using:

- AWS CLI
- AWS SDK scripts
- custom attachment resources
- manual post-deployment procedures

Preserve the deployment ORDER `OU stack -> organization policy stack` in every deployment workflow:

- deploy the OU stack first
- read the OU stack's `OuId*` outputs through `aws cloudformation describe-stacks` (with the `--stack-name` of the OU stack) after it reaches `CREATE_COMPLETE` / `UPDATE_COMPLETE`
- pass the Root ID (from the `prepare-organization` composite action) and every required OU ID to `cdk deploy` for the policy stack as `--parameters "OrganizationRootId=..."`, `--parameters "OuIdSecurity=..."`, and so on

Ordering is enforced by the workflow, not by a CDK-level `addDependency(...)` or a CloudFormation Export / ImportValue link. This keeps the two stacks isolated at the CloudFormation layer, so either stack can be updated, replaced, renamed or torn down independently.

---

## Security and Safety

Agents must not autonomously:

- execute SCP/RCP deployment
- run Organizations mutation commands
- perform CDK bootstrap
- create AWS accounts as part of SCP work
- trigger GitHub Actions deployment workflows
- commit, push, merge or rebase repository changes unless explicitly authorized

Local synthesis and tests are validation only and must not mutate AWS.

If account creation performed under the separate account-provisioning phase (governed by `.apm/instructions/shared-account-provisioning.instructions.md` and `.apm/skills/generate-account/SKILL.md`) is blocked by an existing SCP, the account-provisioning activity must stop and report the exact denied API, policy ID, and SID. Do not modify SCPs as part of the account-provisioning change; SCP compatibility adjustments, if required, are a separate approved activity.

---

## Framework Language

Framework mappings are alignment references and do not by themselves represent certification.

Acceptable wording includes:

- `NIST SP 800-53 aligned`
- `mapped to NIST SP 800-53 controls`
- `supports alignment with NIST SP 800-53`

Do not use wording such as:

- `NIST compliant`
- `NIST certified`
- `fully compliant with NIST 800-53`

unless supported by a separately approved compliance assessment.
