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

This instruction is limited to shared-account creation and account-ID handling. SCP compatibility changes and Control Tower initialization are separate subsequent phases.

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

## 13. Accounts Explicitly Out of Scope

Do not create the following accounts as part of this shared-account implementation/deployment:

- Security Tooling
- Shared Services
- Network
- CCoE-Hybrid-Prod-01
- CCoE-Hybrid-NonProd-01
- CCoE-Online-Prod-01
- CCoE-Online-NonProd-01
- CCoE-Corp-Prod-01
- CCoE-Corp-NonProd-01
- Sandbox team/developer accounts
- Production workload accounts

Production **Audit and Log Archive configuration/code support is in scope**, but their actual creation/deployment is not.

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
