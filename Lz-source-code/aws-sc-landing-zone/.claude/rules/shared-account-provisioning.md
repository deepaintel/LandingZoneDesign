# Shared Account Provisioning Instructions

## 1. Purpose

This instruction defines the authoritative constraints for provisioning the AWS Control Tower shared accounts **Audit** and **Log Archive** through the existing `aws-sc-landing-zone` CDK / AWS Organizations automation.

The customer has selected **Control Tower Option 1(b) – API-only / code-first onboarding**. Under this model, the Audit and Log Archive accounts must exist before AWS Control Tower landing-zone initialization and their account IDs are later supplied to Control Tower as existing shared accounts.

The implementation must be reusable for both **Staging** and **Production** organizations.

### Current delivery boundary

- Code, configuration schema, and environment configuration must be prepared for **both Staging and Production**.
- **Only Staging is approved for deployment now.**
- Production account creation must **not** be executed until a separate production deployment approval is provided.
- The implementation must use the same code path for both environments and select environment-specific values through the existing configuration model.

This instruction is limited to shared-account creation and account-ID handling. SCP compatibility changes and Control Tower initialization are separate subsequent phases. Provisioning of the remaining approved Landing Zone platform and Staging test accounts (SecurityTooling, SharedServices, Network, and the CCoE Staging test accounts) is governed by `.apm/instructions/landing-zone-account-provisioning.instructions.md` and must not be authored against this instruction.

---

## 2. Approved Implementation Sequence

The approved overall sequence is:

1. Implement the reusable Audit and Log Archive account-provisioning capability for Staging and Production.
2. Deploy the account-provisioning change to **Staging only**.
3. Create the Staging Audit and Log Archive accounts under the existing Security OU.
4. Capture and persist/reference the generated Staging account IDs for later Control Tower configuration.
5. Update the required SCPs to allow the minimum Control Tower service principals / execution roles.
6. Validate the SCP changes in Staging.
7. Initialize AWS Control Tower programmatically in Staging and supply the pre-created Audit and Log Archive account IDs.
8. Validate Control Tower shared-account configuration.
9. Create/onboard the remaining Staging accounts after the Control Tower foundation is stable.
10. Production follows the same code path later, only after separate approval.
11. Finalize tagging separately after customer confirmation.

For the current implementation activity, steps 1–4 are in scope. Steps 5 onward are explicitly out of scope.

---

## 3. Existing Organization State

The implementation must assume the following already exists in each organization and must **not** be recreated:

- AWS Organization.
- Existing root and OU hierarchy deployed through CDK.
- Existing **Security OU**.
- Existing custom SCP/RCP catalogue and attachments.
- Existing GitHub Actions / CDK deployment model.
- Existing `@ccoe-aws_if-it/ccoe-config-reader` configuration-loading pattern.
- Existing Zod-based configuration validation.

Account provisioning must integrate with the existing organization and OU resources rather than create a parallel hierarchy.

---

## 4. Shared Accounts in Scope

The reusable implementation supports only the following shared account purposes in this phase:

- Log Archive
- Audit

### Staging inputs

| Environment | Target OU | Account Purpose | AWS Account Name | Account Email                            | Owner / Team | Cost Centre | Security Contact                              | Operations Contact |
| ----------- | --------- | --------------- | ---------------- | ---------------------------------------- | ------------ | ----------- | --------------------------------------------- | ------------------ |
| Staging     | Security  | Log Archive     | `Log Archive`    | `FMITaws-cloud-org-002+LogArchive@if.se` | CCoE         | AISARCH     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu`      |
| Staging     | Security  | Audit           | `Audit`          | `FMITaws-cloud-org-002+Audit@if.se`      | CCoE         | AISARCH     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu`      |

### Production inputs

| Environment | Target OU | Account Purpose | AWS Account Name | Account Email                            | Owner / Team | Cost Centre | Security Contact       | Operations Contact |
| ----------- | --------- | --------------- | ---------------- | ---------------------------------------- | ------------ | ----------- | ---------------------- | ------------------ |
| Production  | Security  | Log Archive     | `Log Archive`    | `FMITaws-cloud-org-001+LogArchive@if.se` | CCoE         | AISARCH     | `Cloud-Security@if.eu` | `cloud@if.eu`      |
| Production  | Security  | Audit           | `Audit`          | `FMITaws-cloud-org-001+Audit@if.se`      | CCoE         | AISARCH     | `Cloud-Security@if.eu` | `cloud@if.eu`      |

### Account-name and provisioning-note clarification

The customer workbook records the selected approach using wording such as:

- `Log Archive -> Provisioned via CDK / AWS Organizations (pre-created for Control Tower)`
- `Audit -> Provisioned via CDK / AWS Organizations (pre-created for Control Tower)`

The text after `->` is **provisioning-method documentation only**. It must not be used as part of the AWS account name.

The actual AWS account names are:

- `Log Archive`
- `Audit`

---

## 5. Environment-Neutral Implementation Requirement

Account provisioning must be implemented once and reused across environments.

Requirements:

- Do not create separate Staging-only and Production-only CDK stacks when the behavior is identical.
- Select account inputs using the repository's existing environment/configuration mechanism.
- Follow the existing `ccoe-config-reader` pattern.
- Extend the existing Zod schema instead of introducing a second configuration validator.
- Do not hard-code environment-specific account data in TypeScript.
- Do not branch implementation logic on literal account IDs or customer email addresses.
- Production support must be present in code/configuration, but production deployment must remain disabled/not invoked in this activity.

---

## 6. Configuration Placement for Account Attributes

Environment-specific shared-account values must be stored in the corresponding environment configuration:

- `config/staging.yaml`
- `config/production.yaml`

Use `config/default.yaml` only for values that are genuinely common across both environments and already follow the repository's shared/default configuration pattern.

Recommended logical configuration structure:

```yaml
accounts:
  logArchive:
    name: 'Log Archive'
    email: '<environment-specific email>'
    ouPath: 'Security'
    owner: 'CCoE'
    costCentre: 'AISARCH'
    securityContact: '<environment-specific security contact>'
    operationsContact: 'cloud@if.eu'

  audit:
    name: 'Audit'
    email: '<environment-specific email>'
    ouPath: 'Security'
    owner: 'CCoE'
    costCentre: 'AISARCH'
    securityContact: '<environment-specific security contact>'
    operationsContact: 'cloud@if.eu'
```

The exact YAML shape may be adapted to the repository's established schema/naming convention. Do not introduce a parallel configuration structure if an existing account/config section already serves this purpose.

### Attribute usage boundary

For account creation/placement, the relevant inputs are:

- AWS account name
- unique AWS account email
- target Security OU

The following are customer-provided business/account metadata that must be preserved in configuration for future use:

- owner
- costCentre
- securityContact
- operationsContact

Do not assume these metadata fields are direct `AWS::Organizations::Account` creation properties.

- Do not convert `owner` or `costCentre` into tags until the tagging design is confirmed.
- `securityContact` and `operationsContact` may be used later if/when alternate account contact configuration is implemented.
- Do not create additional contact/tagging resources in the current account-creation change unless explicitly approved.

---

## 7. Account ID Handling

AWS account IDs are generated by AWS and are therefore **outputs**, not initial provisioning inputs.

Requirements:

- Do not invent or pre-populate new Audit/Log Archive account IDs.
- Capture the generated account IDs from the Organizations / CloudFormation account-creation result.
- Expose them through the repository's established output mechanism.
- Make them available to the later Control Tower API onboarding phase.
- Do not hard-code generated IDs in TypeScript.
- Do not dynamically rewrite YAML during deployment.

If the repository's established convention is to persist resolved account IDs in the environment YAML:

- Staging IDs may be added to `config/staging.yaml` **after successful Staging account creation**, through a separate reviewed Git change.
- Production IDs must remain unset until Production accounts are actually created later.
- Do not insert placeholder Production account IDs merely to satisfy schema validation; account ID fields must be optional/not-yet-resolved until creation occurs.

The implementation must maintain one clear source of truth for resolved account IDs.

---

## 8. Account Creation Method

The accounts must be created from the relevant organization management account through the existing code-driven deployment model.

Implementation requirements:

- Use the repository's approved AWS Organizations / CDK account-provisioning mechanism.
- Reuse the existing Security OU resolution mechanism.
- Place both accounts directly under the existing Security OU.
- Do not create another Security OU.
- Do not use manual AWS Console account creation.
- Ensure repeated deployments do not request duplicate accounts.
- Protect created accounts from accidental replacement/deletion caused by unrelated stack/configuration changes.
- Capture account IDs for later Control Tower onboarding.

---

## 9. Minimal State Before Control Tower

The Audit and Log Archive accounts must remain **clean/minimally configured** before Control Tower initialization.

Do **not** deploy the following as part of this phase:

- AWS Config configuration recorders.
- AWS Config delivery channels.
- Organization Config aggregator.
- Custom organization CloudTrail intended to replace/overlap Control Tower-managed configuration.
- Control Tower-equivalent StackSets.
- Custom shared-account baselines that may fail Control Tower pre-launch checks.
- IAM Identity Center assignments.
- Account/resource tagging enforcement.

Only prerequisites strictly necessary for account creation and later Control Tower API onboarding are permitted.

---

## 10. SCP Boundary

The existing SCP catalogue remains deployed during account creation.

For this account-creation activity:

- Do not modify or remove SCPs.
- Do not add Control Tower service-principal exemptions yet.
- Do not change `SCP-ESC-WL-004`.
- If account creation itself is blocked, stop and report the exact policy/SID/API denial.

The subsequent Control Tower compatibility phase is expected to address:

- `SCP-ESC-ROOT-003`
- `SCP-ESC-SEC-001`
- `SCP-ESC-SEC-002`
- `SCP-ESC-SEC-003`
- `SCP-ESC-ENC-001`

Those changes are explicitly out of scope here.

---

## 11. Tagging Boundary

Tagging is not finalized.

Do not:

- invent account tag values
- make P1/P2/P3 tag decisions
- automatically map Owner/Team or Cost Centre to AWS tags
- modify mandatory tagging policies

Tagging rules will be handled under a separate approved instruction after customer confirmation.

---

## 12. IAM Identity Center Boundary

IAM Identity Center group creation, permission-set assignment, and account-to-group mapping are out of scope.

These must not block Audit/Log Archive account creation.

---

## 13. Accounts Outside This Shared-Account Provisioning Phase

The following accounts are **outside the scope of this shared-account provisioning phase**. They must not be created by the shared-accounts stack or by any implementation change authored against this instruction. They are **not** globally out of Landing Zone scope — the accounts listed under (a) below are governed by a separate approved instruction, and the patterns under (c) are future account-vending scope.

(a) Approved remaining Landing Zone platform and Staging test accounts governed by `.apm/instructions/landing-zone-account-provisioning.instructions.md`:

- SecurityTooling (Staging and Production, Security OU)
- SharedServices (Staging and Production, Infrastructure OU)
- Network (Staging and Production, Infrastructure OU)
- CCoE-Hybrid-Prod-01 (Staging, Workloads/Hybrid/Prod)
- CCoE-Hybrid-NonProd-01 (Staging, Workloads/Hybrid/Non-Prod)
- CCoE-Online-Prod-01 (Staging, Workloads/Online/Prod)
- CCoE-Online-NonProd-01 (Staging, Workloads/Online/Non-Prod)
- CCoE-Corp-Prod-01 (Staging, Workloads/Corp/Prod)
- CCoE-Corp-NonProd-01 (Staging, Workloads/Corp/Non-Prod)

(b) Sandbox team/developer accounts remain out of scope for both this instruction and the Landing Zone platform/test instruction, pending a separate approved sandbox-provisioning design.

(c) Production workload accounts following the pattern `{solution}-{accountType}-{index}` (for Hybrid/Online/Corp × Prod/Non-Prod) are **future account-vending scope** and must not be materialized as `AWS::Organizations::Account` resources by the current Landing Zone account-provisioning implementation. See §13 of `.apm/instructions/landing-zone-account-provisioning.instructions.md`.

This instruction remains authoritative only for:

- Log Archive
- Audit
- their pre-Control-Tower provisioning lifecycle
- their generated account-ID handling
- their Control Tower Path A integration

Production Audit and Log Archive **configuration/code support is in scope of this instruction**, but their actual creation/deployment is deferred pending separate Production approval.

---

## 14. Deployment Safety

Before Staging deployment:

- Confirm environment is `staging`.
- Confirm partition is `aws-eusc`.
- Confirm region context is `eusc-de-east-1` where applicable.
- Resolve the existing Security OU ID; do not hard-code/guess it.
- Validate Staging emails exactly match the approved customer inputs.
- Ensure only the two shared accounts are included.
- Ensure Production resources are not part of the Staging deployment target.
- `cdk synth` must succeed.
- `cdk diff` must show only expected account/config/schema/workflow changes.
- No OU replacement/deletion is allowed.
- No SCP change is allowed.
- No Control Tower initialization is allowed.
- No full account baseline is allowed.

After Staging deployment:

- Confirm both account-creation requests complete successfully.
- Confirm both accounts are members of the Staging organization.
- Confirm both accounts are under the existing Security OU.
- Capture both generated account IDs.
- Confirm no unexpected baseline resources were deployed.
- Record the IDs for the later Control Tower phase.

### Production safety

For this activity:

- Update `config/production.yaml` and common code/schema so the solution is Production-ready.
- Validate/synthesize Production configuration where supported without deploying.
- Do not invoke any Production deployment workflow/action.
- Do not create Production Audit or Log Archive accounts.
- Do not populate generated Production account IDs.

---

## 15. Instruction vs Skill Boundary

This file defines **facts, constraints, scope, and approved decisions**.

Detailed implementation procedure belongs in:

`.apm/skills/generate-account/SKILL.md`

Do not turn this instruction into a deployment runbook.

---

## 16. Exit Criteria

The current implementation phase is complete when:

- One reusable shared-account provisioning implementation supports Staging and Production configuration.
- Staging `Log Archive` account exists under the existing Security OU.
- Staging `Audit` account exists under the existing Security OU.
- Staging uses the approved account emails.
- Staging account IDs are captured for later Control Tower API initialization.
- Production account inputs are represented and validated in configuration.
- Production deployment has **not** occurred.
- Production account IDs remain unresolved until Production creation is approved.
- No full Audit/Log Archive baseline has been deployed prematurely.
- Existing OU hierarchy and SCP catalogue remain intact.
- Tagging and IAM Identity Center remain deferred.

---

## 17. Next Phase

After successful Staging account creation, create a separate implementation change for **Control Tower SCP compatibility**.

Only after those SCP changes are approved, deployed, and validated in Staging should Control Tower API initialization be performed using the pre-created Staging Audit and Log Archive account IDs.

### Subsequent Phases

The Audit and Log Archive accounts are prerequisites for the approved Control Tower API initialization approach (Path A). After:

1. Audit and Log Archive provisioning (this instruction),
2. Control Tower SCP compatibility (`.apm/instructions/control-tower-scp-compatibility.instructions.md`),
3. Control Tower initialization (`.apm/instructions/control-tower-initialization.instructions.md`), and
4. Control Tower validation / stabilization,

the remaining approved Landing Zone platform and Staging test accounts may be provisioned under `.apm/instructions/landing-zone-account-provisioning.instructions.md`.

Those remaining accounts must reuse the approved account-provisioning architecture where technically applicable (AWS Organizations / CDK, `@ccoe-aws_if-it/ccoe-config-reader`, existing Zod validation, environment-specific YAML configuration, reusable account construct patterns, deletion/replacement protection, and the existing OU-ID resolution mechanism) but must **not** inherit Control Tower-specific shared-account behavior — in particular:

- Path A Control Tower account-ID handoff,
- Control Tower shared-account manifest integration,
- pre-Control-Tower baseline restrictions in §9,
- and any other constraint in this instruction that exists solely because Audit and Log Archive precede Control Tower initialization.

Production workload account vending (patterns of the form `{solution}-{accountType}-{index}`) remains a separate future capability and is not authorized by either instruction.

The Control Tower sequencing already documented in §2 and §10 of this instruction, including the SCP compatibility prerequisites, remains authoritative for the Audit / Log Archive lifecycle and must be preserved.

---

## 18. Shared-Accounts Deployment Composite Action

The follow-up workflow refactor extracts the shared-accounts deployment mechanics into a
reusable local composite action under `.github/actions/<action-name>/action.yml`. The
shared workflow-vs-composite-action responsibility boundary, workspace and
release-validation actions, refactoring principle, authentication boundary, Production
authorization boundary, and no-live-deployment rule are authored once in
`.apm/instructions/landing-zone-ou-governance.instructions.md` §22. This section defines
only the boundary specific to the shared-accounts deployment action.

Responsibilities encapsulated by the action:

- Security OU ID resolution from the deployed OU stack outputs (the `OuIdSecurity`
  output currently read via `aws cloudformation describe-stacks --stack-name
  lz-ou-structure`), including the pattern check
  `^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$`
- `cdk diff` and `cdk deploy` for `SharedAccountsStack` (stack name
  `lz-shared-accounts`), invoked with `--exclusively` and the resolved
  `OuIdSecurity` parameter
- the post-deployment shared-accounts validation currently in-line in
  `staging-deploy.yml`: stack status is `CREATE_COMPLETE` / `UPDATE_COMPLETE`, the
  stack contains only `AWS::Organizations::Account` resources, exactly two shared
  accounts are reported with valid 12-digit AWS account IDs, both `Log Archive` and
  `Audit` appear exactly once under the Security OU, and neither account name is
  duplicated

Required inputs supplied by the calling workflow:

- `environment` (`staging` or `production`)
- `account-id` (12-digit management account ID)
- `aws-region` (defaults to `eusc-de-east-1`)

Outputs exposed to the calling workflow:

- `audit-account-id` — the 12-digit `AccountIdAudit` value resolved from the
  `lz-shared-accounts` stack outputs after deployment
- `log-archive-account-id` — the 12-digit `AccountIdLogArchive` value resolved from the
  same source

The calling workflow passes these outputs directly to the Control Tower initialization
composite action per Path A resolution in
`.apm/instructions/control-tower-initialization.instructions.md` §6. Both IDs must be
validated as 12-digit AWS account IDs before being used downstream, and the two IDs must
differ.

Path A preservation:

- Resolved shared-account IDs are workflow-runtime values only. The action must not
  persist `AccountIdAudit` or `AccountIdLogArchive` into `config/staging.yaml`,
  `config/production.yaml`, or any other repository-tracked file.
- The action must not introduce CloudFormation `Fn::Export` / `Fn::ImportValue`
  coupling between the shared-accounts stack and any other stack, and must not
  introduce a CDK cross-stack reference or `addDependency(...)` for the sole purpose
  of moving these IDs between stacks. Values flow from the deployed stack's outputs
  back into the workflow via `aws cloudformation describe-stacks`.

Environment-specific gating stays in the workflow:

- Staging invokes the action after the OU and organization policy stacks deploy.
- Production must not invoke the action during the current phase, per §14. The
  Production workflow's `lz-shared-accounts` stack existence check that gates the
  Control Tower initialization step is workflow-level and must not be embedded in this
  composite action.

Prohibitions:

- must not configure a second set of AWS credentials for the same job and must not
  request `id-token: write` at the action level
- must not branch on literal environment names to select behavior; every value that
  would otherwise drive the branch is an input
- must not create or move OUs, must not modify SCP/RCP policies, and must not deploy
  any additional accounts beyond `Log Archive` and `Audit` (per §13)
- must not deploy any pre-Control-Tower baseline resource forbidden by §9

Testing:

- add or update tests where the extraction moves shell logic that was previously
  covered by workflow-level assertions and that is testable in isolation
- keep every existing shared-accounts unit test, CDK assertion test, and static
  template validator passing without functional change
