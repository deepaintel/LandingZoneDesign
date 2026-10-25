---
name: generate-scp
description: >-
  Use when creating, modifying, reviewing, testing, or validating AWS Organizations SCPs or RCPs
  in this AWS ESC Landing Zone repository. For approved Control Tower compatibility exemptions,
  use update-scp-for-control-tower as well.
---

# Generate and Maintain SCPs / RCPs

This skill defines the general repository workflow and constraints for AWS Organizations Service Control Policies (SCPs) and Resource Control Policies (RCPs). It applies to new policies and changes to existing policy definitions, configuration, attachments, tests, and validators.

## Design Authority and Scope

Use the approved SCP/RCP design catalogue as the authority for policy ID/name, type, Root or OU target, control purpose, priority, framework mapping, documented actions/conditions/exemptions, ESC requirements, inheritance intent, dependencies, and exclusions. The catalogue defines intent, not necessarily complete policy JSON.

Derive only the minimum Organizations policy needed to implement the documented intent. Do not invent controls, broaden or weaken controls, add unrelated protections, infer undocumented targets or exemptions, create policies merely to improve framework coverage, or claim derived JSON was copied verbatim from the catalogue.

A later, approved purpose-specific skill may authorize narrow exceptions to these rules. `update-scp-for-control-tower` is the only workflow for its explicitly approved compatibility scope; it does not authorize other SCP changes.

Before editing a policy, compare its target across the OU inheritance map, complete policy inventory, and individual definition. If they disagree, report the exact conflict and do not choose or implement a target until an approved ruling exists. Preserve approved rulings already recorded in active skills or code.

## Organization and OU Boundaries

Reuse the existing OU hierarchy and attachment mappings. Do not create, duplicate, replace, rename, move, or redesign OUs. Do not create AWS accounts as part of SCP/RCP work. Account-level SCP attachment is a separate approved phase; until the account exists, do not invent or use placeholder account IDs or put such IDs into `targetIds`.

Organization and target identifiers are deployment-time inputs:

- The CDK app does not create the Organization or Root.
- `OrganizationRootId`, `OrganizationId` when needed, and every required `OuId<PascalCase(key)>` are pattern-constrained CloudFormation parameters.
- The workflow reads matching OU outputs from the deployed OU stack and passes IDs as policy-stack parameters.
- Never hard-code or persist generated Root, Organization, or OU IDs.
- Do not use CDK cross-stack references, `stack.addDependency(...)`, `Fn::ImportValue`, `Fn::Export`, cross-account SSM lookups, or another runtime cross-stack coupling mechanism.
- The OU stack emits plain outputs without `exportName`; the workflow owns OU-before-policy ordering.

Follow `.apm/skills/generate-landing-zone-ou/SKILL.md` for the OU stack and workflow contract. Follow `.apm/skills/manage-landing-zone-configuration/SKILL.md` when changing configuration files or Zod schemas; keep policy-specific fields and approved values in this skill and the design catalogue.

## Implementation Architecture

Implement policies with native AWS Organizations CloudFormation resources through CDK:

- `aws-cdk-lib/aws-organizations`
- `organizations.CfnPolicy`
- `SERVICE_CONTROL_POLICY` or `RESOURCE_CONTROL_POLICY` as appropriate
- native `targetIds` for approved Root/OU attachments

Do not use `AWS::Organizations::PolicyAttachment`, Lambda custom resources, AWS SDK/CLI scripts, or manual post-deployment attachment. The organization policy stack owns policy creation and attachment wiring; reusable constructs accept approved content and resolved targets but do not discover AWS state or call Organizations APIs.

Keep large policy documents out of `bin/landing-zone.ts`. Use deterministic construct IDs and the existing policy-definition, statement, condition, principal-exemption, configuration, and stack patterns. Do not introduce a second configuration loader or validator.

Keep SCPs and RCPs distinct. RCPs use `RESOURCE_CONTROL_POLICY`, preserve their own approved IDs, names, intent, and targets, and remain independently testable. The currently approved Root-level RCPs are `RCP-ESC-S3-001` and `RCP-ESC-KMS-001`; do not add others without an approved design.

## AWS ESC Requirements

Use partition `aws-eusc`, Region `eusc-de-east-1`, ARN prefix `arn:aws-eusc:`, and STS endpoint `sts.eusc-de-east-1.amazonaws.eu` when explicit values are required. Do not introduce commercial AWS partitions, Regions, ARNs, or endpoints. If a control depends on AWS ESC behavior or a condition key that cannot be confirmed, stop and report the affected policy instead of guessing.

`aws-sc-foundation` owns GitHub OIDC, deployment roles, bootstrap resources/roles, publishing roles, trust configuration, approved credential actions, ESC STS setup, and bootstrap/readiness validation. Consume these capabilities; do not recreate them in this repository.

## Control Tower Compatibility

Control Tower compatibility changes are governed by `.apm/skills/update-scp-for-control-tower/SKILL.md` and the currently approved compatibility instruction it references. Keep that work separate from general policy generation.

The compatibility skill may authorize narrowly scoped exemptions only for its listed policies/statements and principals. Preserve the original Deny behavior for all non-exempt principals, policy IDs/names, and approved targets. It does not authorize changing RCPs, OUs, accounts, Identity Center, or workload policies outside its explicit scope.

If an account-provisioning operation is blocked by an SCP, report the policy, SID, denied API action, and calling principal. Do not weaken or modify the policy as part of the account-provisioning task.

## Policy Deployment Action Boundary

The calling release workflow owns triggers, job dependencies, environment selection, permissions, OIDC invocation, Production approval, and workflow-level reporting. The `deploy-organization-policies` composite action owns only OU parameter resolution, `cdk diff`/`cdk deploy` for `OrganizationPolicyStack` (`lz-organization-policies`), and directly associated policy-stack validation.

The action must receive `aws-environment`, `account-id`, `aws-region`, `organization-root-id`, and `organization-id` as explicit inputs. It reads the 14 `OuId*` outputs from `lz-ou-structure`, validates the count and each OU ID pattern, and supplies required identifiers as parameters. Post-deployment validation checks stack status, both SCP and RCP policy types enabled on Root, only `AWS::Organizations::Policy` resources, no Organizations Account resources, and no 12-digit account IDs in policy stack outputs.

Do not configure a second credential set, request `id-token: write` inside the action, branch on literal environment names, change production approval, or perform manual policy attachment. Keep OU deployment before policy deployment in the workflow.

## Workflow Before Editing

1. Inspect the catalogue, current policy definition, policy registry/targets, configuration and schema, stack, exemption helpers, tests, and template validators relevant to the change.
2. State the exact policy, statements/SIDs, target, documented intent, proposed minimal change, and any unresolved design ambiguity.
3. For a target conflict, stop and report it. For a condition key or ESC behavior that is not confirmed, stop and report it.
4. Preserve existing public policy IDs/names, targets, action lists, exemptions, and RCP/SCP distinction unless the approved design explicitly changes them.
5. Make the smallest scoped change. Update tests and static validators with the policy change.

## Validation and Safety

For policy code changes, run the relevant policy tests and template validator, then build/type-check/lint and Staging/Production synthesis and validation as required by the repository. Inspect synthesized policy JSON and verify:

- no unapproved policies were added or removed;
- policy types, names, targets, documented actions, and exemptions match the approved design;
- ordinary principals remain denied wherever compatibility exemptions were approved;
- no account, OU, Identity Center, Control Tower, tagging-policy, or deployment-authorization changes were introduced as a side effect;
- no `Fn::Export`, `Fn::ImportValue`, cross-stack references, or CDK dependency between OU and policy stacks was added.

Local synthesis/tests are non-deploying validation only. Do not deploy, bootstrap, run Organizations mutation commands, initialize Control Tower, trigger deployment workflows, or perform live AWS mutations. Do not commit, push, merge, or rebase unless separately authorized.

A policy change is complete when the approved scope is implemented, tests and static validation pass, synthesized resources/attachments match the intended policy, and remaining assumptions or unexpressible controls are explicitly reported.
