# Update SCP for Control Tower Skill

## Purpose

This skill contains the approved Control Tower SCP compatibility scope and the workflow for implementing, reviewing, testing, and validating those changes. It is the active home for these compatibility constraints.

Use with:

- `.apm/skills/generate-scp/SKILL.md` for general SCP/RCP policy and stack governance

The general SCP skill governs shared policy architecture and safety boundaries. This skill owns the narrower approved Control Tower compatibility decisions.

## Scope

Modify only these existing policies and statements:

- `SCP-ESC-ROOT-003` — `ScpEscRoot003DenyPolicyGovernanceChanges`
- `SCP-ESC-SEC-001` — `ScpEscSec001ProtectCloudTrail`, `ScpEscSec001ProtectConfigRecorder`
- `SCP-ESC-SEC-002` — `ScpEscSec002ProtectObjectLockImmutability`
- `SCP-ESC-SEC-003` — `ScpEscSec003ProtectConfigAggregator`
- `SCP-ESC-ENC-001` — `ScpEscEnc001DenyKeyTagTampering`
- `SCP-ESC-IAM-001` — `ScpEscIam001DenyPrivilegeEscalation` only
- `SCP-ESC-WL-004` — seven `Require*Tag` and four `Restrict*Values` tag-on-create statements only

Do not deploy.

Do not initialize Control Tower or enable a baseline.

## Approved Compatibility Matrix

The following are the only approved Control Tower principals/statements. Exemptions are scoped per statement; all other principals remain denied.

| Policy / SID | Required Control Tower principal | Boundary |
|---|---|---|
| `SCP-ESC-ROOT-003` / `ScpEscRoot003DenyPolicyGovernanceChanges` | `AWSServiceRoleForAWSControlTower` (`controlTowerServiceLinkedRoles`) | Organizations policy lifecycle actions only; preserve pipeline-role exemption |
| `SCP-ESC-SEC-001` / `ScpEscSec001ProtectCloudTrail` | `AWSServiceRoleForAWSControlTower` | Optional Control Tower-managed organization trail lifecycle only |
| `SCP-ESC-SEC-001` / `ScpEscSec001ProtectConfigRecorder` | `AWSControlTowerExecution` (`controlTowerExecutionRoles`) | Member-account Config recorder/delivery-channel lifecycle only |
| `SCP-ESC-SEC-002` / `ScpEscSec002ProtectObjectLockImmutability` | `AWSControlTowerExecution` | Log Archive bucket-policy lifecycle; resource scoping is deferred until the bucket ARN is reliably known |
| `SCP-ESC-SEC-003` / `ScpEscSec003ProtectConfigAggregator` | `AWSControlTowerExecution` | Audit-account organization Config aggregator lifecycle; preserve pipeline-role exemption |
| `SCP-ESC-ENC-001` / `ScpEscEnc001DenyKeyTagTampering` | `AWSControlTowerExecution` | KMS key tagging operations only |
| `SCP-ESC-IAM-001` / `ScpEscIam001DenyPrivilegeEscalation` | `stacksets-exec-*` and `AWSControlTowerExecution` | This SID only; preserve pipeline and break-glass exemptions and its four denied IAM actions |
| `SCP-ESC-WL-004` / 11 tag-on-create SIDs | `AWSControlTowerExecution` | Require-tag and restrict-tag-value statements only; no tag-removal exemption |

Principal facts:

- `AWSServiceRoleForAWSControlTower` is the management-account Control Tower service-linked role that performs Organizations policy lifecycle operations and, when selected, owns the optional Control Tower-managed organization trail `aws-controltower-BaselineCloudTrail`. Use the exact configured role path; do not substitute `AWSServiceRoleForControlTower`.
- `AWSControlTowerExecution` is the Control Tower-managed member-account role. The Control Tower baseline uses it for account-local Config recorder operations, Log Archive bucket policy updates, Audit-account aggregator setup, and the explicitly listed IAM/tag-on-create operations.
- `stacksets-exec-*` is the CloudFormation StackSets service-managed execution role on path `/`; it deploys `AWSControlTowerExecution` and attaches `AdministratorAccess` during Workloads OU enrollment. Exempt it only from `ScpEscIam001DenyPrivilegeEscalation`.
- `AWSControlTowerConfigAggregatorRoleForOrganizations` is assumed by AWS Config to read aggregated source-account data; it does not call `config:PutConfigurationAggregator` and receives no exemption.
- Do not exempt `AWSControlTowerAdmin`, `AWSControlTowerStackSetRole`, or service-linked roles that are not subject to SCPs unless a specific approved statement/action mapping requires them.

Per-policy requirements:

- `ROOT-003`: preserve denies on `organizations:CreatePolicy`, `UpdatePolicy`, `DeletePolicy`, `AttachPolicy`, and `DetachPolicy` for ordinary principals; add only the Control Tower service-linked role alongside the pipeline exemption.
- `SEC-001`: exempt the Control Tower service-linked role on the CloudTrail SID and `AWSControlTowerExecution` on the Config recorder SID. Leave GuardDuty and Security Hub SIDs unchanged.
- `SEC-002`: preserve Log Archive immutability. Do not invent a bucket name, prefix, or ARN. Keep the approved narrow principal exemption until reliable bucket identity is available, then defer resource narrowing to a separately reviewed follow-up.
- `SEC-003`: add only `AWSControlTowerExecution` alongside pipeline roles; do not create/configure the aggregator here.
- `ENC-001`: change only the KMS key tagging statement for `AWSControlTowerExecution`; do not weaken deletion, disable, or rotation protections.
- `IAM-001`: exempt both approved enrollment callers only from the privilege-escalation SID. Leave `ScpEscIam001DenyIdentityGuardrailChanges` untouched and without any Control Tower exemption.
- `WL-004`: exempt `AWSControlTowerExecution` on the seven presence and four value statements. Never exempt any principal from `ScpEscWl004DenyMandatoryTagRemoval`; never exempt `stacksets-exec-*` from WL-004.

The WL-004 compatibility is required because `AWSControlTowerBaseline` 5.0 deploys its CloudWatch blueprint as `AWSControlTowerExecution`, creating an SNS topic and notification Lambda without the enterprise P1 tags. Each tag-on-create statement independently denies a request with a missing tag. The tag-removal statement remains unchanged and denied for every principal.

The StackSets execution-role exemption matches `stacksets-exec-*` on path `/` only. A look-alike role does not gain permission to attach or put policies on that role unless the caller itself is separately authorized. Before the first Workloads OU is enrolled, the enrollment plan confirms on an enrolled Infrastructure account (outside IAM-001 scope) that both `AWSControlTowerExecution` and a root-path `stacksets-exec-*` role exist; otherwise enrollment stops.

Policies reviewed and unchanged: `SCP-ESC-IAM-002`, `SCP-ESC-PROD-001`, `SCP-ESC-WL-001`, `SCP-ESC-WL-002`, `SCP-ESC-WL-003`, `SCP-ESC-ENC-002`, `SCP-ESC-INF-001`, `SCP-ESC-ROOT-001`, `SCP-ESC-ROOT-002`, `SCP-ESC-ROOT-004`, GuardDuty and Security Hub statements in `SEC-001`, and all RCPs. Change one only if a concrete blocked Control Tower action is established; stop and report its policy, SID, action, principal, and reason first.

## Repository Inspection First

Before changing code:

1. review the general SCP/RCP boundaries in `.apm/skills/generate-scp/SKILL.md` and this skill's approved compatibility matrix
2. inspect the existing policy definitions and tests
3. inspect policy-exemption configuration and its schema using `.apm/skills/manage-landing-zone-configuration/SKILL.md`
4. inspect helpers used to build principal-exemption conditions
5. inspect `OrganizationPolicyStack` and static validators
6. verify generated governance artifacts after `apm install` do not conflict

Prefer extending existing helpers/configuration over creating new abstractions.

## Plan Before Edit

Before implementation, prepare a mapping:

| Policy | Existing SID(s) affected | Blocked Control Tower action | Required Control Tower principal | Proposed change | Security intent preserved |
|---|---|---|---|---|---|

Do not change files until this mapping is complete.

If a principal/action relationship cannot be established, stop and report it.

## Implementation Principles

For each affected statement:

- make the smallest possible change
- preserve existing Deny semantics for non-exempt principals
- use existing exemption-helper patterns where available
- avoid blanket AWS-service-principal exemptions
- do not remove a policy/statement merely to make Control Tower work
- preserve policy IDs, names and targets
- preserve ESC partition handling
- keep generated policy structure within repository validation limits

Where a principal exemption is needed, prefer a dedicated Control Tower principal category if that cleanly fits the existing configuration model.

## Policy Workflow

### `SCP-ESC-ROOT-003`

Inspect the Organizations policy-governance statement.

Update only the principal-exemption condition required for Control Tower policy lifecycle operations.

Validate that:

- required Control Tower governance principal(s) are exempt
- existing pipeline roles remain exempt
- ordinary principals remain denied

### `SCP-ESC-SEC-001`

Inspect CloudTrail and Config protection SIDs separately.

Determine which Control Tower principal performs each blocked lifecycle action.

Add scoped exemptions only to the affected statements.

Do not alter unrelated security service statements unless proven necessary.

### `SCP-ESC-SEC-002`

Inspect the S3 immutability statement and current resource scope.

Determine whether a reliable Control Tower Log Archive bucket ARN/pattern is available.

- if yes, prefer resource scoping where it preserves intent and solves the conflict
- if no, do not invent a bucket pattern; use only an approved narrow principal exemption or stop for clarification

Test both ordinary-principal denial and Control Tower compatibility.

### `SCP-ESC-SEC-003`

Add only the required Control Tower principal exemption to protected Config aggregator actions.

Do not create/configure an aggregator.

### `SCP-ESC-ENC-001`

Identify the exact KMS statement conflicting with Control Tower.

Update only the Control Tower-required tagging/lifecycle exemption.

Do not weaken deletion, disable or rotation protections without explicit approval.

### `SCP-ESC-IAM-001`

Change only `ScpEscIam001DenyPrivilegeEscalation`. Exempt exactly `cloudFormationStackSetsExecutionRoles` (`stacksets-exec-*`, the service-managed StackSet caller that deploys `AWSControlTowerExecution`) and `controlTowerExecutionRoles` (`AWSControlTowerExecution`, the baseline blueprint caller), next to the unchanged pipeline and break-glass exemptions.

Keep the four denied actions. Leave `ScpEscIam001DenyIdentityGuardrailChanges` without any Control Tower exemption.

### `SCP-ESC-WL-004`

Exempt only `controlTowerExecutionRoles` on the seven `Require*Tag` and four `Restrict*Values` statements, merged with each statement's existing tag condition through `mergeConditions`.

Never exempt any principal from `ScpEscWl004DenyMandatoryTagRemoval`. Do not exempt the StackSets execution role from WL-004.

## Configuration and Schema

When changing configuration files or schemas, follow `.apm/skills/manage-landing-zone-configuration/SKILL.md`. Keep exemption fields and policy semantics specific to the approved Control Tower compatibility scope, use partition-aware ARN construction, and do not hard-code commercial AWS ARNs.

## Tests

Update/add policy tests covering at minimum:

- policy ID/name unchanged
- target unchanged
- protected Deny actions remain intact except approved changes
- ordinary principals remain denied
- required Control Tower principal is exempted
- unrelated principals are not exempted
- existing pipeline/break-glass exemptions remain correct
- ESC/partition-aware ARN patterns are used
- no exemption leaks into another SID of the same or any other policy
- the WL-004 tag-removal deny has no exemption
- no RCP changed

Keep `APPROVED_CONTROL_TOWER_STATEMENTS` in `scripts/validate-policy-template.ts` and its unit tests in `tests/validate-policy-template.test.ts` in step with every approved SID.

Where condition JSON is complex, assert the exact synthesized condition structure.

## Static Validation

Run non-deployment checks:

- build
- type-check
- lint
- unit tests
- Staging synth
- Production synth
- SCP/policy template validator

Review synthesized JSON for each modified policy.

Verify:

- no extra policies
- no removed policies
- no target movement
- no OU changes
- no accounts
- no Control Tower resources
- no tagging-policy changes
- no Production deployment enablement

## No-Deployment Rule

During this skill execution:

- do not run `cdk deploy`
- do not execute Organizations mutation commands
- do not trigger GitHub deployment workflows
- do not initialize Control Tower
- do not modify live AWS

When separately approved for release, the Organization Policy step deploys compatibility changes before Control Tower OU enrollment in the protected release workflow: Staging first, then Production after its protected GitHub Environment approval. Never initialize Control Tower or enable a baseline as part of this skill.

The output is reviewed code only.

## Stop Conditions

Stop and report if:

- a required Control Tower principal cannot be confirmed
- a conflict appears outside the approved SCPs and statements
- `SCP-ESC-SEC-002` requires an unknown Log Archive bucket ARN/pattern
- an exemption would weaken security for non-Control-Tower principals
- the existing helper/config model cannot express the exemption safely
- the actual calling principal of a blocked Control Tower operation cannot be established
- a change would modify an RCP, OU, account or IAM Identity Center, or touch a tagging control beyond the approved WL-004 tag-on-create exemptions
- implementation requires live AWS mutation

## Expected Output

After implementation provide:

- files created
- files modified
- policy-by-policy change summary
- exact SIDs changed
- Control Tower principals exempted by each policy
- configuration/schema changes
- tests added/updated
- validation results
- remaining assumptions/risks
- explicit confirmation that no deployment occurred
- explicit confirmation that Control Tower was not initialized

## Completion Criteria

Complete when:

- all approved in-scope SCP compatibility changes are implemented
- security intent is preserved
- policy tests pass
- Staging and Production synth/validation pass
- no deployment occurred
- code is ready for review and later controlled Staging deployment
