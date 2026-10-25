# Generate Account Skill

## Purpose

This skill defines the reusable account-provisioning workflow and the approved account categories, inventory, configuration values, and safety boundaries for `aws-sc-landing-zone`. It is the active home for this account-provisioning guidance.

---

## Account Category and Scope

Before making any implementation change, determine which approved account category applies. Its lifecycle and requirements are defined in this skill's category, inventory, and account-specific sections.

| Category | Accounts | Lifecycle / scope | Path A | Account tags |
|---|---|---|---|---|
| Control Tower shared accounts | Log Archive, Audit | Provision before Control Tower initialization; Staging deploy is authorized, Production creation requires its protected release approval | Required; stack outputs feed the initializer | No tags in this phase |
| Landing Zone platform accounts | SharedServices, Network | Both environments, after Control Tower is stable | Not applicable | Mandatory P1 set |
| Staging Verification accounts | Six CCoE verification accounts | Staging only, after Control Tower is stable | Not applicable | Mandatory P1 set |
| Production workload accounts | `{solution}-{accountType}-{index}` patterns | Future account-vending scope; not materialized | No | None |
| Sandbox accounts | Team/developer accounts | Out of scope pending a separate approved design | No | None |

Stop and report if a requested account does not fall into a category above or if the change would combine the distinct shared-account and remaining-account lifecycles.

---

## Current Scope

The following categories are the concrete in-scope categories for this skill:

- **Log Archive** and **Audit** — reusable code/configuration support for Staging and Production. Staging deployment is authorized; Production creation requires the protected Production approval.
- **SharedServices / Network** (platform, Staging and Production) and the **six CCoE Verification accounts** (Staging only) — eight remaining Staging member accounts and two remaining Production member accounts. Provision after shared accounts, Control Tower initialization, and validation/stabilization.

Use the category-specific mechanism defined below and place each account in its inventory OU. Existing OUs must be reused; no OU may be created, replaced, renamed, or moved by this skill.

Production workload account patterns (`{solution}-{accountType}-{index}`) and sandbox accounts remain out of scope for this skill.

---

## Approved Account Inventory

This inventory is the approved concrete scope, carried forward from the customer workbook's "Account Provisioning Inputs" and "Tagging Questions" worksheets and subsequent explicit confirmations. The source workbook is not included in this repository; the approved values are reproduced here. Do not silently normalize, infer, or invent values. For shared-account workbook rows, text after `->` describes provisioning method, not the AWS account name.

### Audit and Log Archive

Both accounts target the existing `Security` OU. These fields are common: owner `CCoE`, cost centre `AISARCH`, operations contact `cloud@if.eu`; no account tags are applied in this phase.

| Environment | Account | Email | Security contact |
|---|---|---|---|
| Staging | Log Archive | `FMITaws-cloud-org-002+LogArchive@if.se` | `FMITaws-cloud-org-002+SecurityContact@if.se` |
| Staging | Audit | `FMITaws-cloud-org-002+Audit@if.se` | `FMITaws-cloud-org-002+SecurityContact@if.se` |
| Production | Log Archive | `FMITaws-cloud-org-001+LogArchive@if.se` | `Cloud-Security@if.eu` |
| Production | Audit | `FMITaws-cloud-org-001+Audit@if.se` | `Cloud-Security@if.eu` |

### Remaining Platform and Verification Accounts

| Environment | Account | Email | Canonical OU | Owner / Team | Cost Centre | Security contact | Operations contact |
|---|---|---|---|---|---|---|---|
| Staging | SharedServices | `FMITaws-cloud-org-002+SharedServices@if.se` | `Infrastructure` | CCoE | AISARCH | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu` |
| Staging | Network | `FMITaws-cloud-org-002+Network@if.se` | `Infrastructure` | Connectivity | AISCCNO | `FMITaws-cloud-org-002+SecurityContact@if.se` | `network-hub@if.fi` |
| Staging | CcoeHybridVerification-Prod-01 | `FMITaws-cloud-org-002+CcoeHybridVerification-Prod-01@if.se` | `Workloads/Hybrid/Prod` | CCoE | AISARCH | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu` |
| Staging | CcoeHybridVerification-NonProd-01 | `FMITaws-cloud-org-002+CcoeHybridVerification-NonProd-01@if.se` | `Workloads/Hybrid/Non-Prod` | CCoE | AISARCH | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu` |
| Staging | CcoeOnlineVerification-Prod-01 | `FMITaws-cloud-org-002+CcoeOnlineVerification-Prod-01@if.se` | `Workloads/Online/Prod` | CCoE | AISARCH | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu` |
| Staging | CcoeOnlineVerification-NonProd-01 | `FMITaws-cloud-org-002+CcoeOnlineVerification-NonProd-01@if.se` | `Workloads/Online/Non-Prod` | CCoE | AISARCH | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu` |
| Staging | CcoeCorpVerification-Prod-01 | `FMITaws-cloud-org-002+CcoeCorpVerification-Prod-01@if.se` | `Workloads/Corp/Prod` | CCoE | AISARCH | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu` |
| Staging | CcoeCorpVerification-NonProd-01 | `FMITaws-cloud-org-002+CcoeCorpVerification-NonProd-01@if.se` | `Workloads/Corp/Non-Prod` | CCoE | AISARCH | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu` |
| Production | SharedServices | `FMITaws-cloud-org-001+SharedServices@if.se` | `Infrastructure` | CCoE | AISARCH | `Cloud-Security@if.eu` | `cloud@if.eu` |
| Production | Network | `FMITaws-cloud-org-001+Network@if.se` | `Infrastructure` | Connectivity | AISCCNO | `Cloud-Security@if.eu` | `network-hub@if.fi` |

For these ten accounts, `owner-email` equals the account's `Account Email`; `itsystemcode` equals `Cost Centre`; `data-residency` is `EU`; `lifecycle` is `active`; `data-classification` is `internal`; and `domain` is the configured literal `Cloud Application Platform`. The environment tag is `prod` for both platform accounts and all Verification `Prod`-OU accounts; it is `staging` for Verification `Non-Prod`-OU accounts, including within the Staging AWS Organization. This tag is classification metadata and does not select the AWS Organization.

The workbook's Workloads OU shorthand omits the `Workloads/` prefix; configuration and runtime resolution use the canonical paths shown above. `Security` is reserved for Audit and Log Archive. Do not create any additional Production workload accounts or Sandbox accounts under this inventory.

---

## Repository-First Rule

Before changing files:

1. Inspect the current repository.
2. When changing configuration files or schemas, follow `.apm/skills/manage-landing-zone-configuration/SKILL.md`.
3. Reuse existing environment selection (`staging` / `production`).
4. Reuse existing OU ID lookup/output patterns.
5. Reuse established stack/construct naming and dependency conventions.
6. Reuse existing GitHub Actions deployment patterns.
7. Do not create duplicate constructs if an existing account-provisioning abstraction can be extended safely.

Prefer minimal extension of existing architecture.

---

## Inputs and Related Skills

Use:

- This skill's embedded approved account inventory, category rules, tagging decisions, safety constraints, and deployment boundaries.
- `.apm/skills/manage-landing-zone-configuration/SKILL.md` for common configuration and schema workflow.
- `.apm/skills/generate-landing-zone-ou/SKILL.md` for the existing OU hierarchy and OU deployment contract.
- `.apm/skills/initialize-control-tower/SKILL.md` for shared-account Path A handoff behavior.
- `.apm/skills/control-tower-account-enrollment/SKILL.md` for the later enrollment workflow.
- `config/default.yaml`
- `config/staging.yaml`
- `config/production.yaml`
- Current Zod schemas under `config/schemas/`
- Current OU / organization / shared-account CDK stacks and constructs under `lib/`
- Current deployment workflows and composite actions under `.github/`
- The approved account inventory and values embedded in this skill, transcribed from the customer workbook and subsequent explicit confirmations

If implementation code or repository configuration conflicts with the approved inventory and decisions in this skill, or if the workbook conflicts with these decisions, **stop and report** the conflict. Do not silently correct, normalize, infer, or invent customer-provided values.

---

## Account Configuration Requirements

Use the shared configuration workflow in `.apm/skills/manage-landing-zone-configuration/SKILL.md`. This section owns the account-specific inventory, value sources, field placement, and validation rules.

### Shared accounts (Audit / Log Archive)

Existing shape in `config/default.yaml`, with environment-specific `email` and `securityContact` overrides in `config/<env>.yaml`:

```yaml
accounts:
  logArchive:
    name: 'Log Archive'
    ouPath: 'Security'
    owner: 'CCoE'
    costCentre: 'AISARCH'
    operationsContact: 'cloud@if.eu'
  audit:
    name: 'Audit'
    ouPath: 'Security'
    owner: 'CCoE'
    costCentre: 'AISARCH'
    operationsContact: 'cloud@if.eu'
```

Environment values:

- Staging Log Archive email: `FMITaws-cloud-org-002+LogArchive@if.se`
- Staging Audit email: `FMITaws-cloud-org-002+Audit@if.se`
- Staging Security Contact: `FMITaws-cloud-org-002+SecurityContact@if.se`
- Staging Operations Contact: `cloud@if.eu`
- Production Log Archive email: `FMITaws-cloud-org-001+LogArchive@if.se`
- Production Audit email: `FMITaws-cloud-org-001+Audit@if.se`
- Production Security Contact: `Cloud-Security@if.eu`
- Production Operations Contact: `cloud@if.eu`
- Common: owner `CCoE`, costCentre `AISARCH`, target OU `Security`, account names `Log Archive` and `Audit`.

Do not interpret provisioning-note text after `->` in the workbook as part of an account name.

### Remaining Landing Zone accounts (platform + Staging Verification)

The remaining accounts live in the top-level `landingZoneAccounts:` collection (validated by `config/schemas/landing-zone-accounts-schema.ts`). The concrete inventory is embedded in this skill under **Approved Account Inventory**. Per-account fields include, at minimum:

- `name` — AWS account name from the approved inventory in this skill (never silently correct customer-provided values; see the stop conditions).
- `email` — unique AWS account email from the workbook.
- `ouPath` — logical OU path from the deployed hierarchy (`Infrastructure`, `Workloads/Hybrid/Prod`, `Workloads/Hybrid/Non-Prod`, `Workloads/Online/Prod`, `Workloads/Online/Non-Prod`, `Workloads/Corp/Prod`, `Workloads/Corp/Non-Prod`). `Security` is reserved for Audit and Log Archive and is rejected by the schema.
- `owner` — from workbook `Owner / Team` (approved source for the `owner` tag).
- `costCentre` — from workbook `Cost Centre` (approved source for the `itsystemcode` tag; see §7 of the Landing Zone instruction).
- `securityContact`, `operationsContact` — from workbook (business metadata; not automatically mapped to any AWS tag).
- Mandatory P1 tag values: `owner`, `owner-email`, `environment`, `lifecycle`, `data-classification`, `data-residency`, `itsystemcode`, and `domain`, as defined in this skill's account-tagging requirements.

Apply the shared/default-versus-environment-file rules from the configuration skill as follows:

- An account in **both** environments (SharedServices, Network) keeps its environment-invariant values in `config/default.yaml` (`name`, `ouPath`, `owner`, `costCentre`, `operationsContact`, `tags.dataResidency`, `tags.domain`). Each environment file supplies `email`, `securityContact`, and the per-environment tags `environment`, `lifecycle`, `dataClassification`. The default entries stay deliberately incomplete, so an environment that omits its values fails validation instead of inheriting them.
- An account in **one** environment only (the Staging Verification accounts) is declared in full in that environment's file and never in `config/default.yaml`, because every default key is merged into both environments.

Do not hard-code customer-specific account values in TypeScript, and do not introduce a `CostCentre` / `cost-centre` / `cost-center` AWS tag anywhere. The AWS tag key is `itsystemcode`, populated from Cost Centre.

---

## Account Schema Validation

Follow the shared schema workflow in `.apm/skills/manage-landing-zone-configuration/SKILL.md`. Account-specific schema requirements are:

Validate, as appropriate to the current repository patterns:

- Known account keys / categories.
- Non-empty, printable account names within the AWS 1–50 character range.
- Syntactically valid email addresses.
- OU path resolvable within the deployed OU hierarchy (widen the existing `z.literal('Security')` shared-account guard only for the remaining platform/verification account schema).
- Uniqueness of account names and account emails per environment.
- Optional / generated account ID where appropriate.
- Environment configuration completeness (both `staging` and `production` structurally validate even when Production is not deployed).

For remaining platform and Staging Verification accounts, additionally validate the mandatory P1 tag model:

- `owner` present and non-empty. **Authoritative mapping: workbook `Owner / Team` → `owner`** per that instruction §6.1 and §9. Examples: `CCoE → owner=CCoE`; `Connectivity → owner=Connectivity`. Do **not** infer from account name or OU.
- `owner-email` present and syntactically valid (reuse `ACCOUNT_EMAIL_PATTERN`). **Authoritative mapping: workbook `Account Email` → `owner-email`** per that instruction §6.1 and §9. The same string is both the `AWS::Organizations::Account` `Email` property and the `owner-email` tag value. Do **not** substitute Operations Contact, Security Contact, or a separately invented owner mailbox.
- `environment` ∈ { `prod`, `staging`, `dev`, `sandbox` } — **mandatory configuration-driven** tag with the customer-approved enumeration. Each concrete account must have an explicit configured value in `config/staging.yaml` / `config/production.yaml`; Zod must fail configuration load if the value is missing or outside the enumeration. Do **not** infer from account name, OU, AWS Organization, or other metadata. In particular, do not derive `environment` from the `Prod` / `NonProd` fragment in the account name / OU of the six Staging CCoE Verification accounts. Missing value blocks account creation for the affected account.
- `lifecycle` ∈ { `active`, `deprecated`, `decommissioning`, `archived` } — **mandatory configuration-driven** tag. Each concrete account must have an explicit configured value; Zod must fail configuration load if missing or outside the enumeration. Do **not** hard-code or default `lifecycle = active` in CDK / application code. An explicitly configured `active` is an input value, not an inferred default. Missing value blocks account creation for the affected account.
- `data-classification` ∈ { `public`, `internal`, `confidential`, `restricted` } — **mandatory configuration-driven** tag. Each concrete account must have an explicit configured value; Zod must fail configuration load if missing or outside the enumeration. Do **not** assume classification from account name, OU, environment, or workload. Missing value blocks account creation for the affected account.
- `data-residency` = `EU` (fixed literal — workbook Must-have tags row A26 "data-residency (Hardcoded to EU)").
- `itsystemcode` present and non-empty, sourced from the corresponding workbook `Cost Centre` value under the `Cost Centre → itsystemcode` mapping. Cost attribution combines `itsystemcode` and `domain` in reporting per workbook Q10; do **not** introduce a `CostCentre` / `cost-centre` / `cost-center` AWS tag.
- `domain` present and non-empty per account — **mandatory configuration-driven** tag. For current Landing Zone accounts the configured value is the customer-confirmed literal `Cloud Application Platform`; because that value is identical for every current Landing Zone account it may live in `config/default.yaml` if that is consistent with repository conventions. For future workload accounts the value must come from per-account provisioning / order input and must **not** be globally defaulted to `Cloud Application Platform`. In both categories, Zod must fail configuration load if `domain` is missing or empty. Do **not** derive `domain` from `owner`, `Owner / Team`, `Cost Centre`, `itsystemcode`, account name, or OU. Do **not** encode `domain` as a universal code-level default in TypeScript. Keep the Domain source decoupled so a later approved account-ordering / ServiceNow source can replace YAML without redesigning account provisioning; do **not** implement ServiceNow integration in this phase.

Production must validate before Production account IDs exist. Generated account-ID fields must not be mandatory until after account creation. Do not require unresolved Production IDs for schema validation.

### Account-creation blocking inputs

For a remaining platform or Staging Verification account, every mandatory P1 tag is an **account-creation blocking input**: it must be present and valid in configuration before the `AWS::Organizations::Account` for that account is created. The set is:

`AccountName`, `Account Email` (also the `owner-email` tag value), `OU path`, `owner`, `environment`, `lifecycle`, `data-classification`, `data-residency` (`EU`), `itsystemcode`, `domain`.

`domain` is included in this set following the customer-confirmed rule in this skill's account inventory and tagging requirements.

---

## Account-Provisioning Design

The two account categories use different mechanisms. Reuse the one that matches the category; do not author a third.

### Audit / Log Archive

The `lz-shared-accounts` CDK stack owns these accounts through `lib/constructs/shared-account.ts`, a thin `CfnAccount` wrapper with `RemovalPolicy.RETAIN` and `updateReplacePolicy: RETAIN`. The stack:

1. Resolves the Security OU through the pattern-constrained `OuIdSecurity` CloudFormation parameter, populated from the OU stack's output at deploy time. There is no `Fn::Export` / `Fn::ImportValue` and no CDK cross-stack reference.
2. Exposes `AccountIdAudit` and `AccountIdLogArchive` as outputs for Path A.
3. Applies no account tags (deferred by that instruction §11).

### Remaining Landing Zone Accounts

The `deploy-landing-zone-accounts` composite action owns these accounts at runtime. It runs `scripts/provision-landing-zone-accounts.ts`, which uses the pure reconciler in `lib/organization/landing-zone-account-reconciler.ts` behind the `OrganizationsAccountPort` and its SDK v3 adapter in `lib/organization/organizations-account-adapter.ts`. Extend this mechanism rather than adding a second one.

The mechanism:

1. Loads the validated environment configuration and applies `assertLandingZoneAccountScope` before any AWS call. It checks that the credentials belong to the configured management account.
2. Resolves each configured OU path at runtime from the Organization Root: exactly one child OU per segment. A missing or ambiguous segment fails the run.
3. **Plan (read-only).** Classifies every account by email, then by name, as `EXISTING_MATCH`, `MISSING`, or `CONFLICT` per that instruction §5. Any `CONFLICT` stops the run before a mutating call.
4. **Provision.** Creates only `MISSING` accounts, sequentially in configuration-key order (`sortLandingZoneAccountEntries`), stopping on the first failure. Each new account goes through `CreateAccount` with the P1 tags, then `DescribeCreateAccountStatus` until `SUCCEEDED`, then `ACTIVE`. Its name and email are verified, it is moved from the Root to its OU, and its tags are applied. Placement and tags are each confirmed by bounded polling, because Organizations is eventually consistent. After `MoveAccount`, a read that still shows the Root keeps polling, and a read that shows any other OU fails without moving the account again. An `EXISTING_MATCH` account left in the Root by an interrupted run is moved to its OU, and missing or drifted P1 tags are corrected.
5. **Validate (read-only).** A fresh plan must show every account fully reconciled. The action outputs `account-ids` (`<key>=<id>` for every configured account, discovered or created), `ou-ids` (`<ou path>=<ou id>`), and `account-count`. Account IDs and OU IDs are never persisted; every run reads them from the live Organization.
6. Applies the full mandatory P1 tag set from validated configuration (`buildLandingZoneAccountTags`):
   - `owner` (from `Owner / Team`)
   - `owner-email` (from `Account Email`)
   - `environment`
   - `lifecycle`
   - `data-classification`
   - `data-residency = EU`
   - `itsystemcode` (from `Cost Centre`)
   - `domain`: from per-account configuration. Every current Landing Zone account uses the customer-confirmed literal `Cloud Application Platform` (§8.1); future workload accounts take it from per-account order input (§8.2).
7. Never renames, re-addresses, closes, or moves an account out of another OU.
8. Sends every Organizations request, including each page of a listing, through bounded exponential backoff with full jitter (`lib/organization/organizations-retry.ts`, after the AWS Landing Zone Accelerator `throttlingBackOff` pattern). The SDK client makes a single attempt per call, so this is the only retry layer. Permanent errors (access, input, every `ConstraintViolationException`) are never retried. `CreateAccount` and `MoveAccount` are retried only when AWS rejected the request without acting on it. The reconciler sees only validated responses; `tests/organizations-account-adapter.test.ts` tests the adapter directly against a mocked SDK client.

Keep the Domain source decoupled from the provisioning logic, so that a later approved account-ordering source (for example ServiceNow) can replace YAML as the value source without redesigning account provisioning. In this phase, `domain` values are read from configuration through the existing `@ccoe-aws_if-it/ccoe-config-reader` path together with the other mandatory tags. Do not introduce:

- a separate Domain lookup client
- a Lambda or a custom resource
- a secondary tagging framework
- a separate tagging skill

Do not hard-code customer values in TypeScript. Do not branch implementation logic on literal account IDs, customer email addresses, or literal environment names; every value that would otherwise drive the branch is a configuration input. The single approved exception is the Production scope guard `assertLandingZoneAccountScope` (`config/schemas/landing-zone-accounts-schema.ts`). It pins the Production remaining-account inventory to exactly `sharedServices` / `SharedServices` and `network` / `Network`, and it is applied at synth and in the provisioning script.

---

## Environment Deployment Boundary

### Staging

The implementation may be integrated into the existing release workflow (`.github/workflows/deploy.yml` calling `.github/workflows/validate-and-deploy.yml`) and deployed after review.

Expected Staging ordering (extended from the shared-account order already in `validate-and-deploy.yml`):

1. Existing OU stack (`lz-ou-structure`).
2. Existing policy / SCP stack (`lz-organization-policies`).
3. **Shared-account provisioning stack** (`lz-shared-accounts`) — Audit and Log Archive. Emits `AccountIdAudit` and `AccountIdLogArchive` for Path A.
4. Control Tower SCP compatibility.
5. Control Tower initialization (consumes the Path A account IDs) and validation / stabilization.
6. **Remaining Landing Zone accounts** (SharedServices, Network, and the six Verification accounts), reconciled at runtime by the `deploy-landing-zone-accounts` action after Control Tower is stable: plan, provision MISSING accounts only, then validate. No Path A handoff.
7. Output / validation for each step.

### Production

Update the Production configuration and ensure the same code path can synthesize / validate for Production.

Do **not**:

- Invoke Production deployment.
- Create Production accounts.
- Populate fake Production account IDs.
- Modify workflows in a way that causes Production auto-deployment from this change.

Production deployment is gated by the protected `production` GitHub Environment approval on the Production invocation of `validate-and-deploy.yml`, which runs only after Staging succeeds in the same release run. Preserve that behavior. The remaining-accounts provisioning step is gated the same way in Production. Do not add a separate Production workflow, manual dispatch, or enable toggle. Account changes after a release is published ship in a new release branch from `main`; a released branch is closed (see `.apm/skills/generate-landing-zone-ou/SKILL.md`).

---

## Account Attribute Rules

Account creation uses:

- `name`
- unique `email`
- target OU (resolved by ID)

Preserve these metadata fields in configuration:

- `owner`
- `costCentre`
- `securityContact`
- `operationsContact`

Handling depends on the account category defined in this skill:

- Audit / Log Archive: do **not** automatically convert these fields to AWS tags; no tags are applied in this phase.
- Remaining platform and Staging Verification accounts: apply the mandatory P1 tag set using the approved sources: `owner` from workbook `Owner / Team`, `owner-email` from the account email, `itsystemcode` from `Cost Centre`, and `data-residency = EU`. Do **not** automatically generate `CostCentre` / `cost-centre` / `cost-center` AWS tags. Do **not** invent the `domain` value.

Do not create alternate account contacts (`PutAlternateContact`) unless explicitly approved.

---

## Account ID Handling

Treat AWS account IDs as generated outputs.

Do not:

- Invent IDs.
- Use placeholders as final values.
- Hard-code IDs in source.
- Dynamically rewrite YAML during deployment.
- Introduce `Fn::Export` / `Fn::ImportValue` coupling or a CDK cross-stack reference solely to move account IDs between stacks.

Instead:

1. Audit / Log Archive: capture IDs from the `lz-shared-accounts` stack outputs (`AccountIdAudit`, `AccountIdLogArchive`) through `describe-stacks`.
2. Remaining Landing Zone accounts: the `deploy-landing-zone-accounts` action resolves every configured account's ID from AWS Organizations, existing or newly created. It exposes the IDs as the `account-ids` output (`<key>=<id>`) and as the plan table in `$GITHUB_STEP_SUMMARY`.
3. **Path A is specific to Audit / Log Archive.** Make those resolved IDs available to the Control Tower initializer per `.apm/skills/initialize-control-tower/SKILL.md`. There is no Path A handoff for remaining accounts; do not generalize it.
4. **Never persist generated Account IDs or OU IDs** into environment YAML, source, SSM parameters, CloudFormation exports, or another persistent store. The shared-accounts stack may expose plain CloudFormation outputs for the Path A workflow handoff; remaining-account IDs are runtime action outputs.
5. Leave Production IDs unresolved until Production deployment actually occurs.

---

## Minimal Pre-Control-Tower State

Applicable **only** to Audit / Log Archive.

Do not deploy as part of the shared-account phase:

- AWS Config recorder / delivery channel.
- Config aggregator.
- Custom organization CloudTrail overlapping Control Tower.
- Control Tower-equivalent baseline resources.
- Shared-account baseline StackSets.
- IAM Identity Center assignments.
- Account or resource tagging enforcement.

The two shared accounts must remain suitable for later Control Tower API onboarding.

For remaining Landing Zone accounts, Control Tower is already stable and this section does not apply. Those accounts receive the account-level P1 tags defined in this skill; broader resource-level tagging enforcement remains a separate follow-up.

---

## SCP Boundary

Do not modify SCPs during this skill execution.

The later Control Tower compatibility change will address:

- `SCP-ESC-ROOT-003`
- `SCP-ESC-SEC-001`
- `SCP-ESC-SEC-002`
- `SCP-ESC-SEC-003`
- `SCP-ESC-ENC-001`

If account creation is blocked by an SCP, report the exact denial and stop.

---

## Tagging Boundary

Tag application depends on the account category defined in this skill.

For Audit / Log Archive:

- Do **not** create mandatory tags.
- Do **not** infer tags from metadata.
- Do **not** modify `SCP-ESC-WL-004`.
- Do **not** introduce P1 / P2 / P3 enforcement.

For platform and Staging Verification accounts:

- Apply only the customer-confirmed P1 mandatory tag set: `owner`, `owner-email`, `environment`, `lifecycle`, `data-classification`, `data-residency`, `itsystemcode`, `domain`.
- Enforce the allowed-value constraints defined in this skill's account-tagging requirements.
- Do **not** apply P2 / P3 tags.
- Do **not** introduce `CostCentre` / `cost-centre` / `cost-center` or any legacy tag such as `responsible`, `businesscontact`, `supportteam`, `confidentiality`, `integrity`, `availability`, `systeminstallstatus`, `rto`, `rpo`.
- For current Landing Zone accounts, apply the customer-confirmed `domain = Cloud Application Platform` value from configuration. For future workload accounts, source `domain` from per-account provisioning / order input — do **not** globally default it to `Cloud Application Platform`. In both categories, do **not** invent a `domain` value and do **not** derive it from `owner`, `Owner / Team`, `Cost Centre`, `itsystemcode`, account name, or OU. Missing `domain` blocks per-account deployment.
- Do **not** modify `SCP-ESC-WL-004` from this skill (resource-level tagging enforcement is a separate follow-up).

---

## Out-of-Scope Accounts

Do not create as part of this skill:

- Sandbox team / developer accounts.
- Production workload accounts materialized from the `{solution}-{accountType}-{index}` pattern.
- Any account not enumerated by the approved inventory in this skill.

Category-specific reminders:

- Production Audit / Log Archive **code/config readiness** is in scope; their actual creation/deployment requires the protected Production approval.
- The concrete Staging platform, Production platform, and Staging Verification accounts listed in this skill are in scope; Production workload patterns and Sandbox accounts are not.

---

## Validation

Before implementation is considered complete:

### General

- lint
- unit tests where applicable, including reconciler tests that use the in-memory Organizations port
- `cdk synth`
- `cdk diff` (stack-owned accounts only)

### Staging

Confirm diff contains only approved account/config/schema/workflow changes.

Confirm there is no:

- OU recreation/replacement
- SCP modification
- Control Tower initialization
- tagging enforcement
- full account baseline
- additional account creation

### Production

Where supported, synthesize/validate using Production configuration to prove the implementation is reusable.

Do not deploy.

Confirm Production diff/plan does not trigger an actual account request as part of normal Staging execution.

---

## Expected Claude Output

When implementing this skill, Claude must provide:

1. Account category and lifecycle selected.
2. Repository patterns inspected.
3. Files created.
4. Files modified.
5. Configuration changes for Staging and Production, grouped by account category.
6. Zod schema changes, including any mandatory-tag validation added.
7. CDK construct / stack changes, or provisioning script / reconciler changes.
8. OU resolution approach for each category (Security, Infrastructure, Workloads/*).
9. Account ID output mechanism per category (explicit note that Path A remains limited to Audit / Log Archive).
10. Workflow changes.
11. Staging validation results per category.
12. Production synth / config validation results per category.
13. Explicit confirmation that Production was not deployed.
14. Per-account availability/status for every mandatory P1 tag (`owner`, `owner-email`, `environment`, `lifecycle`, `data-classification`, `data-residency`, `itsystemcode`, `domain`) using only a literal value, `CONFIGURATION VALUE REQUIRED — <tag>`, or `CUSTOMER CONFIRMATION REQUIRED — <subject>`. Do not use ambiguous statuses such as "expected", "probably", "likely", "as above", or "staging or dev".
15. Explicit confirmation that:
    - `data-residency = EU` on every remaining account.
    - `itsystemcode` on every remaining account equals its workbook `Cost Centre`.
    - No `CostCentre` / `cost-centre` / `cost-center` AWS tag was introduced.
    - `domain = Cloud Application Platform` on every current Landing Zone account, sourced from CDK configuration (not encoded as a code-level default), and not derived from `owner`, `Owner / Team`, `Cost Centre`, `itsystemcode`, account name, or OU.
    - No P2 / P3 tags were introduced.
    - No ServiceNow client, adapter, or lookup was introduced.

---

## Stop Conditions

Stop and ask / report — do not guess — if:

- The requested account does not fall into a category in this skill.
- The required OU cannot be resolved reliably from the deployed OU hierarchy, or the workbook OU shorthand cannot be confidently mapped to a repository canonical OU path.
- The approved account email differs from configuration or from the workbook.
- An account email is inconsistent with the approved inventory in this skill.
- An account already exists in AWS Organizations but is not represented safely in state / config.
- The current resource choice would cause duplicate `CreateAccount` requests.
- The provisioning plan reports a `CONFLICT`. Resolve it in AWS Organizations or in configuration; never rename, re-address, or move an account automatically.
- Account creation requires modifying SCPs, OUs, Control Tower configuration, or Path A.
- Implementation requires pre-Control-Tower baseline resources.
- A concrete account's `Account Email` is missing or ambiguous. Because `Account Email → owner-email`, the account creation and the derived `owner-email` tag are simultaneously blocked.
- A concrete account's `environment` value has not been explicitly configured in CDK configuration. Do not infer it.
- A concrete account's `lifecycle` value has not been explicitly configured in CDK configuration. Do not default to `active`.
- A concrete account's `data-classification` value has not been explicitly configured in CDK configuration. Do not infer it.
- Any other mandatory P1 value — `owner`, `owner-email`, `data-residency`, `itsystemcode` — would have to be invented, guessed, or defaulted rather than sourced from the approved project mapping (`Owner / Team → owner`, `Account Email → owner-email`, `EU`, `Cost Centre → itsystemcode`).
- The `Cost Centre → itsystemcode` mapping conflicts with a separate authoritative `itsystemcode` field in the workbook.
- A Production workload pattern would have to become a real account.
- Production deployment would be triggered automatically by the proposed workflow change, or Production deployment authorization would have to be assumed.
- Repository configuration conventions conflict with this skill.
- An existing OU would be recreated, replaced, renamed, or moved.
- A concrete account's `domain` value has not been configured, or would have to be derived from `owner`, `Owner / Team`, `Cost Centre`, `itsystemcode`, account name, or OU. For current Landing Zone accounts the configured value must be the customer-confirmed literal `Cloud Application Platform` (§8.1); for future workload accounts the value must come from per-account provisioning / order input (§8.2). Do **not** globally default `domain` to `Cloud Application Platform` for future workload accounts, and do **not** invent a value in either category.
- **Tagging technical limitation.** The repository's approved runtime account-provisioning mechanism cannot apply one or more required mandatory account tags **as designed** (i.e., natively through AWS Organizations account tagging: `CreateAccount` tags, and `TagResource` to complete an existing account). Report the technical limitation, the affected tag(s), and the affected account(s). Do **not** introduce a second tagging mechanism, a custom resource, a Lambda workaround, an AWS CLI mutation, or a post-creation mutation workflow to work around this limitation without explicit approval.

---

## Completion Criteria

Complete only when:

- Each in-scope category uses its single approved mechanism (the `lz-shared-accounts` stack for Audit / Log Archive; the `deploy-landing-zone-accounts` runtime reconciliation for the remaining accounts), with one configuration model and one Zod validator.
- For shared accounts: reusable Audit / Log Archive provisioning supports both environments, Staging can be deployed safely, Production configuration validates/synthesizes without deployment, runtime IDs are surfaced for Path A, and no OU/SCP/tagging/Identity Center/Control Tower work is mixed into account creation.
- For remaining accounts: each concrete account is provisioned (or explicitly held) under the approved configuration; every created account carries the confirmed P1 tags with `data-residency = EU` and `itsystemcode` sourced from `Cost Centre`; no `CostCentre` AWS tag or P2/P3 tag is introduced.
- Existing `@ccoe-aws_if-it/ccoe-config-reader` and Zod patterns are retained.
- Path A remains limited to Audit / Log Archive.
- Existing OU hierarchy, SCP / RCP catalogue, Control Tower configuration, and Identity Center architecture remain unchanged.

---

## Shared-Accounts Deployment Composite Action

Use this section when changing the `deploy-shared-accounts` composite action. It defines the
account-specific action boundary; workflow-level orchestration and Production authorization
remain governed by `.apm/skills/generate-landing-zone-ou/SKILL.md` and the release workflow.

### Scope

Maintain only the mechanics invoked by `validate-and-deploy.yml` that:

- resolve `OuIdSecurity` from the deployed OU stack via
  `aws cloudformation describe-stacks --stack-name lz-ou-structure` and validate it
  against `^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$`;
- run `cdk diff` and `cdk deploy` against `SharedAccountsStack` (stack name
  `lz-shared-accounts`) with `--exclusively` and the resolved `OuIdSecurity` parameter;
- perform the post-deployment shared-accounts validation currently in the workflow:
  stack status is `CREATE_COMPLETE` / `UPDATE_COMPLETE`; the stack contains only
  `AWS::Organizations::Account` resources; exactly two shared accounts are reported
  with valid 12-digit AWS account IDs; both `Log Archive` and `Audit` appear exactly
  once under the Security OU; neither account name is duplicated.

### Required Inputs

- `aws-environment` (`staging` or `production`)
- `account-id` (12-digit management account ID)
- `aws-region` (defaults to `eusc-de-east-1`)

### Outputs

- `audit-account-id` — the 12-digit `AccountIdAudit` value resolved from the deployed
  `lz-shared-accounts` stack outputs
- `log-archive-account-id` — the 12-digit `AccountIdLogArchive` value resolved from the
  same source

The calling workflow passes both outputs directly to the Control Tower initialization
composite action (Path A) per `.apm/skills/initialize-control-tower/SKILL.md`. Validate both IDs
as 12 digits and confirm they differ before either is used downstream.

### Path A Preservation

- The action must not persist the resolved shared-account IDs into `config/staging.yaml`,
  `config/production.yaml`, or any other repository-tracked file.
- The action must not introduce CloudFormation `Fn::Export` / `Fn::ImportValue`
  coupling or a CDK cross-stack reference between the shared-accounts stack and any
  other stack. Values flow from the deployed stack's outputs back into the workflow
  via `aws cloudformation describe-stacks`.

### Environment Gating Stays in the Workflow

- Both environments invoke the action after the OU and organization policy stacks deploy.
- Production runs only after protected `production` GitHub Environment approval, which
  stays at the workflow/job level and must not be embedded in the composite action.
  There is no stack-existence fallback; missing account IDs fail the run.

### Guardrails

- Do not configure a second set of AWS credentials for the same job and do not request
  `id-token: write` at the action level.
- Do not branch on literal environment names; every value that would otherwise drive
  the branch is an input.
- Do not create or move OUs, do not modify SCP/RCP policies, and do not deploy
  additional accounts beyond `Log Archive` and `Audit`.
- Do not deploy any pre-Control-Tower baseline resource forbidden by the shared-account
  minimal-state rules in this skill.

### Testing

- Preserve every existing shared-accounts unit test, CDK assertion test, and static
  template validator without functional change.
- Add or update tests for composite-action logic that is testable in isolation.

### Non-Deployment Rule

- Do not run `cdk deploy` locally.
- Do not trigger the Staging or Production deployment workflow.
- Do not create AWS accounts during code generation or review.

### Stop Conditions

Stop and report if the extraction would:

- require persisting Path A shared-account IDs into repository configuration;
- require introducing cross-stack coupling forbidden by
  the repository-wide CloudFormation/CDK boundaries in `.apm/instructions/landing-zone-global.instructions.md`;
- require modifying an OU, SCP/RCP, or the Control Tower composite action.
