# Initialize Control Tower Skill

## Purpose

This skill contains the approved constraints and implementation workflow for AWS Control Tower Landing Zone initialization in AWS European Sovereign Cloud using pre-created Audit and Log Archive accounts.

Use with:

- `.apm/skills/generate-account/SKILL.md` for the approved Audit and Log Archive inventory and Path A account outputs
- `.apm/skills/update-scp-for-control-tower/SKILL.md` for the prerequisite SCP compatibility changes
- `.apm/skills/manage-landing-zone-configuration/SKILL.md` for shared config/schema mechanics

## Scope

Current scope:

- prepare Landing Zone 4.0 initialization support
- consume pre-created Audit and Log Archive account IDs
- initialize Staging first, then Production in the same release run after protected `production` GitHub Environment approval
- validate manifest/configuration
- support asynchronous Control Tower operation tracking

Do not enroll workload OUs/accounts.

Do not modify SCPs.

Do not initialize or deploy during code-generation review.

## Existing State, Version, and ESC Scope

Reuse the existing AWS Organization, Root, 14-OU hierarchy, Security OU, Audit/Log Archive accounts, SCP compatibility changes, CDK/GitHub Actions model, config reader, Zod schemas, and ESC configuration. Do not create a parallel Organization, OU hierarchy, shared accounts, or Landing Zone.

The approved target is AWS Control Tower Landing Zone version `4.0`, initialized with `CreateLandingZone` and a manifest. Do not include the legacy `organizationStructure` field. If the approved version changes, stop and reconcile the manifest/schema before implementation.

Use partition `aws-eusc`, Region `eusc-de-east-1`, and ARN prefix `arn:aws-eusc:`. All Control Tower API/CLI calls target the approved ESC Region and partition; do not introduce commercial AWS assumptions.

## Repository Inspection First

Before making changes:

1. review this skill, the account inventory and Path A contract in `.apm/skills/generate-account/SKILL.md`, and the SCP compatibility scope in `.apm/skills/update-scp-for-control-tower/SKILL.md`
2. inspect current account-provisioning outputs/configuration
3. inspect configuration and schema through `.apm/skills/manage-landing-zone-configuration/SKILL.md`, including `config/default.yaml`, environment files, and the owning Zod schema
4. inspect `bin/landing-zone.ts`
5. inspect existing GitHub Actions deployment workflows
6. inspect existing validation/test conventions
7. inspect how shared-account IDs are resolved and passed at runtime
8. inspect generated APM outputs after `apm install`

Reuse existing repository patterns.

Do not create a second configuration or validation framework.

## Plan Before Edit

Before implementation, provide:

- files to create
- files to modify
- source of Audit account ID
- source of Log Archive account ID
- proposed Landing Zone version
- manifest structure
- enabled/disabled service integrations
- required KMS/retention inputs
- Staging-only deployment guard
- Production readiness approach
- operation polling/error handling
- pre-init checks
- post-init checks
- risks/assumptions/blockers

Do not implement if required manifest decisions are unresolved.

## Manifest Workflow

Build the manifest from validated configuration.

For Landing Zone 4.0:

- do not include `organizationStructure`
- explicitly represent required integration `enabled` flags
- use `eusc-de-east-1` as governed region
- use pre-created shared-account IDs
- keep optional integrations disabled unless approved
- never invent account IDs, KMS keys, retention values or bucket ARNs

Validate the manifest before any deployment action.

## Shared Account Mapping

Use:

- Log Archive account ID for centralized logging when enabled
- Audit account ID for approved security-role / Config integration usage

Validate:

- 12-digit account ID format
- account exists
- account belongs to the correct organization
- expected OU placement

Do not discover by name when a trusted ID is already available.

### Path A ID Contract

- Resolve `AccountIdAudit` and `AccountIdLogArchive` from the deployed `lz-shared-accounts` CloudFormation stack with `aws cloudformation describe-stacks` at workflow runtime.
- Validate both as distinct 12-digit account IDs before passing them to the initialization action.
- Keep the IDs as workflow-runtime inputs. Do not persist them in environment YAML, source, SSM, or cross-stack exports/imports; do not add CDK cross-stack references or `addDependency(...)` to pass them.
- Never create the shared accounts or substitute names/placeholders for the resolved IDs in this skill.

## Configuration and Schema

Follow `.apm/skills/manage-landing-zone-configuration/SKILL.md` for the shared reader, environment-file, schema, and validation workflow. Add only the minimum Control Tower-specific configuration required; the approved Control Tower values and constraints below remain owned by this skill.

Approved Control Tower integration settings:

- `centralizedLogging.enabled: true`
- `config.enabled: true`
- `securityRoles.enabled: true`
- `accessManagement.enabled: false`
- `backup.enabled: false`

Retention is environment-configurable and must not be hard-coded in implementation code:

- Staging: `180` days
- Production: `1825` days

For the initial deployment, do not configure `kmsKeyArn`; use the standard/default Control Tower encryption configuration. No customer-managed KMS key is currently available or approved. Keep the model extensible for a later approved Landing Zone update to customer-managed KMS encryption.

Recommended logical structure may include:

```yaml

controlTower:

  version: "4.0"

  governedRegions:

    - "eusc-de-east-1"

  centralizedLogging:

    enabled: true

    accountId: "<resolved/shared-account-id>"

  config:

    enabled: true

    accountId: "<resolved/shared-account-id>"

  securityRoles:

    enabled: true

    accountId: "<resolved/shared-account-id>"

  accessManagement:

    enabled: "<approved-value>"

  backup:

    enabled: false

```

Adapt to existing repository conventions.

Do not use this example to infer unapproved enabled/disabled values.

## Pre-Initialization Checks

### AWS Organizations Trusted Access

Before `CreateLandingZone`, trusted access must be enabled for all approved service principals:

- `controltower.amazonaws.com`
- `member.org.stacksets.cloudformation.amazonaws.com`
- `config.amazonaws.com`
- `config-multiaccountsetup.amazonaws.com`
- `sso.amazonaws.com` (may already be enabled)

The approved `enable-org-trusted-access` script is invoked by the initialization composite action. Validate every principal and fail with an actionable diagnostic if one is missing. These are one-time-per-organization mutations performed only in the separately authorized deployment, never during local generation/review.

### Management-Account Roles

The API initialization path requires these management-account prerequisite roles before `CreateLandingZone`; the approved `ControlTowerRolesStack` provisions them and pre-init validation verifies them:

- `AWSControlTowerAdmin`, with `AWSControlTowerServiceRolePolicy`, inline `ec2:DescribeAvailabilityZones`, and trust for `controltower.amazonaws.com`.
- `AWSControlTowerCloudTrailRole`, trusted by `cloudtrail.amazonaws.com` and granting CloudWatch Logs write for the Control Tower log group.
- `AWSControlTowerStackSetRole`, trusted by `cloudformation.amazonaws.com` and permitting `sts:AssumeRole` into member-account `AWSControlTowerExecution`.

Keep these distinct from Control Tower-managed member-account roles. Do not pre-create member-account `AWSControlTowerExecution` or other roles that Control Tower creates during initialization. `AWSServiceRoleForAWSControlTower` is AWS-managed and is created when trusted access for `controltower.amazonaws.com` is enabled.

Implement/perform checks for:

- correct environment
- correct management account
- ESC region/partition
- no existing active Control Tower landing zone in Staging
- valid Audit and Log Archive account IDs
- account IDs resolve to the expected account names
- both shared accounts are `ACTIVE`
- shared accounts belong to the expected organization
- shared accounts are in the expected Security OU
- neither shared account is suspended
- SCP compatibility deployment complete
- all AWS Organizations trusted access principals above are enabled
- all management-account prerequisite roles above exist
- the `AWSServiceRoleForAWSControlTower` service-linked role exists
- no known conflicting Config/CloudTrail baseline
- valid Landing Zone 4.0 manifest
- exact approved Landing Zone version
- exact approved governed region
- all integration decisions explicit
- manifest contains only approved integrations
- deployment identity has required Control Tower API permissions
- Production initialization runs only after Staging succeeds and protected `production` GitHub Environment approval is granted

Stop if any check fails.

## Initialization

When deployment is separately authorized:

1. generate the final validated manifest

2. list Landing Zones in the target management account/Region as an idempotency gate
3. if a Landing Zone already exists, do not issue `CreateLandingZone`; return its ARN and validate its current state/manifest
4. if none exists, call `CreateLandingZone` with version `4.0` and the validated manifest
5. capture the Landing Zone ARN and operation identifier
6. poll the operation with bounded retry/backoff until `SUCCEEDED` or `FAILED`
7. on `FAILED`, capture status details, inspect CloudTrail for related failures, and stop without automatic remediation or blind retry
8. on `SUCCEEDED`, run post-init validation

Never issue a second create request while the first operation is `IN_PROGRESS`. Do not treat the initial API response as success.

## Operation Polling

Use bounded polling/backoff.

Track the operation identifier using the Control Tower operation-status API.

`SUCCEEDED` and `FAILED` are the expected terminal statuses. Continue polling only while the operation is in progress, within the configured bound. Do not hide failure details or resubmit an ambiguous request.

Record:

- operation identifier
- current status
- failure details where available
- landing zone ARN

Do not hide or auto-remediate failures.

## Failure Investigation

For failed initialization:

1. capture Control Tower operation details

2. inspect CloudTrail for related failures

3. identify:

   - event source
   - API action
   - calling principal
   - error code
   - error message

4. determine whether failure is:

   - SCP
   - account placement
   - manifest/schema
   - pre-existing resource
   - IAM/role
   - unsupported integration/configuration

Do not modify SCPs automatically.

## Testing

Add tests for:

- manifest version
- governed region
- account-ID validation
- enabled/disabled integration shape
- no `organizationStructure` for LZ 4.0
- ESC partition/region
- no placeholder IDs
- Production non-deployment guard and future protected GitHub Environment promotion readiness
- no OU enrollment by initialization
- no unexpected Organizations resources

Use existing test conventions.

## Static / Local Validation

During code review, run only non-deploying checks:

- build
- type-check
- lint
- unit tests
- Staging synth/config validation
- Production synth/config validation
- manifest validation
- git diff/status

Do not run:

- `aws controltower create-landing-zone`
- `cdk deploy`
- Organizations mutation commands
- GitHub deployment workflows

## Production Boundary

Production initialization runs in the same release run after Staging succeeds:

1. Staging deployment and validation succeed.
2. Capture/preserve the exact successful Staging commit SHA.
3. Complete the required external Architecture, Security, Platform, CAB/change-management, and other agreed governance approvals.
4. The downstream Production job reaches the protected GitHub Environment named `production`.
5. GitHub evaluates the Environment protection rules before the Production job starts.
6. While approval is pending, no Production deployment step, Production OIDC authentication, or Production AWS role assumption may execute.
7. An authorized reviewer approves or rejects the pending Production deployment.
8. After approval, verify the exact Staging-validated SHA, load `config/production.yaml`, authenticate through the approved Production OIDC mechanism, and invoke the same reusable Control Tower initialization action.
9. Validate Production and create the final immutable release tag only after successful validation.


The GitHub Environment approval is the final GitHub deployment authorization gate; it does not replace external governance approvals unless those systems are explicitly integrated.

Never execute this Production path locally or during code generation.

## Enrollment Boundary

Initialization does not:

- register any OU or enroll any account (OU enrollment follows account provisioning and uses `.apm/skills/control-tower-account-enrollment/SKILL.md`)
- modify SCPs (governed by `.apm/skills/update-scp-for-control-tower/SKILL.md`)
- call `UpdateLandingZone` for account auto-enrollment. Only `.apm/skills/control-tower-auto-enrollment/SKILL.md` owns that enable-only update path; it must preserve this skill's deployed manifest and validate it before writing.
- register the Security OU with `AWSControlTowerBaseline` (Audit and Log Archive use service-integration baselines)
- register the Suspended OU

## Post-Initialization Validation

After separately authorized Staging initialization:

1. verify `GetLandingZoneOperation` reports `SUCCEEDED`

2. capture landing zone ARN/version

3. call `GetLandingZone`

4. verify Landing Zone status is healthy/active

5. verify drift status is `IN_SYNC`

6. retrieve the deployed Landing Zone manifest/configuration

7. compare the deployed manifest with the expected repository-generated manifest

8. verify exact governed region

9. verify exact Audit account ID

10. verify exact Log Archive account ID

11. verify all approved integration enabled/disabled states

12. verify shared-account usage

13. inspect Control Tower-created resources

14. verify centralized logging if enabled

15. verify Config/aggregator if enabled

16. inspect CloudTrail for unresolved `AccessDenied`, `UnauthorizedOperation`, or failed Control Tower-related API calls

17. verify no unexpected policy attachments

18. verify OU hierarchy unchanged

19. verify initialization itself registered no OU and enrolled no account

20. verify the Security OU carries no AWSControlTowerBaseline

21. verify Production remains untouched

22. capture centralized logging bucket identity for later SEC-002 scoping review

### Manifest Comparison Rule

The deployed manifest must be compared against the approved repository-generated manifest.

Compare at minimum:

- Landing Zone version
- governed region(s)
- Audit account ID
- Log Archive account ID
- centralized logging state
- Config integration state
- security roles state
- access management state
- backup integration state

Treat field ordering and AWS-generated metadata as non-material differences.

Any material configuration mismatch must fail post-initialization validation and be reported before proceeding to OU enrollment.

## Expected Output

After implementation provide:

- files created
- files modified
- configuration/schema changes
- manifest structure
- shared-account ID source
- pre-init checks implemented
- operation polling/error handling
- tests/validation results
- deployment guard details
- remaining assumptions/decisions
- post-initialization validation checklist
- expected-vs-deployed manifest comparison result
- explicit confirmation that no Control Tower initialization occurred during code generation

## Stop Conditions

Stop and report if:

- Landing Zone version is unresolved
- Audit/Log Archive IDs are unavailable or invalid
- required service integration enabled/disabled decisions are unresolved
- required KMS/retention values are missing
- shared accounts are in unsupported placement
- existing resources conflict with Control Tower prerequisites
- an SCP denial remains
- repository governance conflicts with this skill
- implementation would enroll workload OUs/accounts
- implementation would initialize Production
- implementation requires live AWS mutation during code review

## Completion Criteria

Complete when:

- initialization implementation is code-ready
- manifest is generated from validated configuration
- shared-account IDs are handled safely
- pre-init validation exists
- asynchronous operation handling exists
- tests pass
- Staging/Production configuration validates as applicable
- no deployment occurred during code generation
- code is ready for controlled Staging initialization

## Composite-Action Boundary

The `initialize-control-tower` composite action at `.github/actions/initialize-control-tower/action.yml` is the reusable Control Tower initialization implementation. When changing workflows or other composite actions:

- do not merge the Control Tower composite action with any other composite action
- do not duplicate the Control Tower initialization logic into another composite action
- keep the action invoked by `validate-and-deploy.yml` in both environments
  with its existing contract (inputs `aws-environment`,
  `audit-account-id`, `log-archive-account-id`, `aws-region`; outputs
  `landing-zone-arn`, `operation-identifier`, `landing-zone-exists`)
- keep Path A shared-account ID resolution at workflow runtime and never persist the
  resolved IDs to repository configuration
- preserve every functional rule in this skill
