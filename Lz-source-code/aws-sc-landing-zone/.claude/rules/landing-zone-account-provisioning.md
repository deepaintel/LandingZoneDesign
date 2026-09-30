# Landing Zone Account Provisioning Instructions

## 1. Purpose

This instruction defines the authoritative constraints for provisioning the **remaining approved Landing Zone platform and Staging test accounts** in the AWS European Sovereign Cloud after the Audit and Log Archive shared accounts have been created and AWS Control Tower has been initialized and stabilized.

Governance separation:

- Log Archive and Audit remain governed by `.apm/instructions/shared-account-provisioning.instructions.md`. Their Control Tower Path A lifecycle, generated account-ID handoff, and pre-Control-Tower baseline restrictions are not repeated here and must not be redesigned by this instruction.
- Production workload accounts following the pattern `{solution}-{accountType}-{index}` are **future account-vending scope**. They are not concrete Landing Zone accounts and must not be materialized as `AWS::Organizations::Account` resources by any implementation authored against this instruction.
- The reusable implementation procedure for AWS account provisioning lives in `.apm/skills/generate-account/SKILL.md` and must be reused, not duplicated.

This instruction defines facts, inventory, categorization, tagging decisions, safety constraints, exclusions, and completion criteria. It is **not** an implementation runbook.

---

## 2. Account Categories

Every account discussed by this instruction belongs to exactly one of the following categories. The category selects the governing instruction and the implementation procedure.

### 2.1 Control Tower shared accounts (already implemented)

- Log Archive
- Audit

Governed by `.apm/instructions/shared-account-provisioning.instructions.md`. Do not redesign, re-implement, or move their lifecycle into this instruction. Their Path A account-ID handoff, Control Tower shared-account manifest integration, pre-Control-Tower baseline restrictions, and Security-OU placement remain unchanged.

### 2.2 Landing Zone platform accounts (in scope of this instruction)

Concrete named accounts serving Landing Zone-wide platform functions:

- SecurityTooling (Security OU)
- SharedServices (Infrastructure OU)
- Network (Infrastructure OU)

Each exists in both Staging and Production, with environment-specific email, ownership, and contact values.

### 2.3 Staging test accounts (in scope of this instruction)

CCoE-owned Staging test accounts under the Workloads domain:

- CCoE-Hybrid-Prod-01, CCoE-Hybrid-NonProd-01
- CCoE-Online-Prod-01, CCoE-Online-NonProd-01
- CCoE-Corp-Prod-01, CCoE-Corp-NonProd-01

Staging only. There is no corresponding concrete Production test-account inventory in this phase.

### 2.4 Production workload accounts (future account-vending scope)

Production workbook rows using the pattern `{solution}-{accountType}-{index}` for Hybrid, Online, and Corp domains at both Prod and Non-Prod tiers represent a future account-vending / account-factory capability. They are **not** concrete Landing Zone accounts to be created by this implementation. See §13.

### 2.5 Sandbox accounts

Sandbox team / developer accounts remain out of scope for both the shared-account instruction and this instruction, pending a separate approved sandbox-provisioning design.

---

## 3. Authoritative Account Inventory

All values in §3 are taken from the customer-provided workbook `tagging/AWS_Account_Provisioning_Input_Matrix_with_Tagging.xlsx` — inspected worksheets **"Account Provisioning Inputs"** (account inventory) and **"Tagging Questions"** (tagging clarification responses and P1 must-have tag list). Values must not be silently corrected, normalized, inferred, or invented. Any conflict with repository configuration, existing approved APM guidance, or the workbook must be reported (see §14). Cells marked `CUSTOMER CONFIRMATION REQUIRED` or `CONFIGURATION VALUE REQUIRED` must not be resolved by guessing; the latter must be populated in per-account CDK configuration and validated by Zod before deployment.

Workbook column mapping used below: `Organization` → environment, `OU` → workbook OU shorthand (see §4 for repository mapping), `Account Purpose` → authoritative account name for the shared accounts (see `shared-account-provisioning.instructions.md` §4), `Account Name` (column D) → account name for platform / test / workload rows (for the shared-account rows the column D value is the provisioning-note text after `->` and is documentation only — the clean names `Log Archive` and `Audit` come from column C `Account Purpose`).

### 3.1 Staging platform accounts

| Category | Target OU        | Account Name    | Account Email                                     | Owner / Team | Cost Centre | Security Contact                              | Operations Contact  |
| -------- | ---------------- | --------------- | ------------------------------------------------- | ------------ | ----------- | --------------------------------------------- | ------------------- |
| Platform | Security         | SecurityTooling | `FMITaws-cloud-org-002+SecurityTooling@if.se`     | CCoE         | AISARCH     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu`       |
| Platform | Infrastructure   | SharedServices  | `FMITaws-cloud-org-002+SharedServices@if.se`      | CCoE         | AISARCH     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu`       |
| Platform | Infrastructure   | Network         | `FMITaws-cloud-org-002+Network@if.se`             | Connectivity | AISCCNO     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `network-hub@if.fi` |

### 3.2 Production platform accounts

| Category | Target OU        | Account Name    | Account Email                                     | Owner / Team | Cost Centre | Security Contact       | Operations Contact  |
| -------- | ---------------- | --------------- | ------------------------------------------------- | ------------ | ----------- | ---------------------- | ------------------- |
| Platform | Security         | SecurityTooling | `FMITaws-cloud-org-001+SecurityTooling@if.se`     | CCoE         | AISARCH     | `Cloud-Security@if.eu` | `cloud@if.eu`       |
| Platform | Infrastructure   | SharedServices  | `FMITaws-cloud-org-001+SharedServices@if.se`      | CCoE         | AISARCH     | `Cloud-Security@if.eu` | `cloud@if.eu`       |
| Platform | Infrastructure   | Network         | `FMITaws-cloud-org-001+Network@if.se`             | Connectivity | AISCCNO     | `Cloud-Security@if.eu` | `network-hub@if.fi` |

### 3.3 Staging test accounts (CCoE-owned)

| Category    | Target OU                  | Account Name             | Account Email                                                   | Owner / Team | Cost Centre | Security Contact                              | Operations Contact |
| ----------- | -------------------------- | ------------------------ | --------------------------------------------------------------- | ------------ | ----------- | --------------------------------------------- | ------------------ |
| Staging-Test | Workloads/Hybrid/Prod     | CCoE-Hybrid-Prod-01      | `FMITaws-cloud-org-002+CCoE-Hybrid-Prod-01@if.se`               | CCoE         | AISARCH     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu`      |
| Staging-Test | Workloads/Hybrid/Non-Prod | CCoE-Hybrid-NonProd-01   | **PENDING — see §3.4** (`FMITaws-cloud-org-002+CCoE-Hydrid-NonProd-01@if.se` in workbook) | CCoE         | AISARCH     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu`      |
| Staging-Test | Workloads/Online/Prod     | CCoE-Online-Prod-01      | `FMITaws-cloud-org-002+CCoE-Online-Prod-01@if.se`               | CCoE         | AISARCH     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu`      |
| Staging-Test | Workloads/Online/Non-Prod | CCoE-Online-NonProd-01   | `FMITaws-cloud-org-002+CCoE-Online-NonProd-01@if.se`            | CCoE         | AISARCH     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu`      |
| Staging-Test | Workloads/Corp/Prod       | CCoE-Corp-Prod-01        | `FMITaws-cloud-org-002+CCoE-Corp-Prod-01@if.se`                 | CCoE         | AISARCH     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu`      |
| Staging-Test | Workloads/Corp/Non-Prod   | CCoE-Corp-NonProd-01     | `FMITaws-cloud-org-002+CCoE-Corp-NonProd-01@if.se`              | CCoE         | AISARCH     | `FMITaws-cloud-org-002+SecurityContact@if.se` | `cloud@if.eu`      |

### 3.4 CCoE-Hybrid-NonProd-01 email discrepancy — CUSTOMER CONFIRMATION REQUIRED

The workbook records:

- Account Name: `CCoE-Hybrid-NonProd-01`
- Account Email: `FMITaws-cloud-org-002+CCoE-Hydrid-NonProd-01@if.se` (note the misspelling `Hydrid` in the email local-part, contrasting with the correctly spelled `Hybrid` in the account name)

This mismatch **must not be silently corrected** to `FMITaws-cloud-org-002+CCoE-Hybrid-NonProd-01@if.se` by any implementation authored against this instruction. AWS Organizations account email addresses are unique account identifiers, and CreateAccount rejects duplicates; an unsanctioned correction may collide with a genuine mailbox or fail account creation entirely.

Required action before this account may be provisioned:

1. Request the customer to confirm the authoritative email address (either the workbook's `+CCoE-Hydrid-NonProd-01@if.se` verbatim, or the corrected `+CCoE-Hybrid-NonProd-01@if.se`).
2. Update the workbook / configuration source only after that confirmation.
3. Do not deploy the CCoE-Hybrid-NonProd-01 account until the confirmed email is available.

The other five Staging test accounts (Hybrid-Prod-01, Online-Prod-01, Online-NonProd-01, Corp-Prod-01, Corp-NonProd-01) are not blocked by this discrepancy.

### 3.5 Production workload account patterns — future account-vending scope

The Production workbook additionally describes workload-account patterns of the form:

```
{solution}-{accountType}-{index}
```

for each of Hybrid/Prod, Hybrid/Non-Prod, Online/Prod, Online/Non-Prod, Corp/Prod, Corp/Non-Prod. These are **not** concrete accounts in the current inventory. See §13 for the exclusion rules.

---

## 4. OU Placement

Account placement must reuse the **existing deployed OU hierarchy** declared in `config/default.yaml` under `organization.organizationalUnits` and materialized by `lz-ou-structure`. The following logical OU paths are expected targets:

- `Security`
- `Infrastructure`
- `Workloads/Hybrid/Prod`
- `Workloads/Hybrid/Non-Prod`
- `Workloads/Online/Prod`
- `Workloads/Online/Non-Prod`
- `Workloads/Corp/Prod`
- `Workloads/Corp/Non-Prod`

### 4.1 Workbook-to-repository OU terminology mapping

The workbook's `OU` column uses a shorthand for the Workloads subtree that omits the `Workloads/` prefix. The mapping is:

| Workbook OU value | Repository canonical OU path |
| ----------------- | ---------------------------- |
| `Security`        | `Security`                   |
| `Infrastructure`  | `Infrastructure`             |
| `Hybrid/Prod`     | `Workloads/Hybrid/Prod`      |
| `Hybrid/Non-Prod` | `Workloads/Hybrid/Non-Prod`  |
| `Online/Prod`     | `Workloads/Online/Prod`      |
| `Online/Non-Prod` | `Workloads/Online/Non-Prod`  |
| `Corp/Prod`       | `Workloads/Corp/Prod`        |
| `Corp/Non-Prod`   | `Workloads/Corp/Non-Prod`    |

The repository-canonical form is authoritative for configuration and for OU-ID resolution. The workbook shorthand is preserved here only as documentation of the mapping and must not be silently substituted into configuration.

The implementation must:

- reuse the repository's established OU-ID resolution mechanism (currently the OU stack's `OuId<Key>` outputs consumed via `aws cloudformation describe-stacks --stack-name lz-ou-structure`, delivered as pattern-constrained CloudFormation parameters to the accounts stack, matching the Security-OU pattern already applied in `SharedAccountsStack`);
- not create, recreate, duplicate, rename, or move any existing OU;
- not hard-code or guess OU IDs anywhere in source;
- not introduce `Fn::Export` / `Fn::ImportValue` coupling solely for OU IDs;
- not introduce CDK cross-stack references solely for OU IDs;
- report — rather than resolve by guessing — any mismatch between a workbook-declared target OU and the deployed OU hierarchy.

The OU governance file (`.apm/instructions/landing-zone-ou-governance.instructions.md`) remains the source of truth for OU structure. This instruction consumes that hierarchy; it does not modify it.

---

## 5. Reusable Account-Provisioning Architecture

The remaining accounts must reuse the approved account-provisioning principles already applied for Audit and Log Archive, where technically applicable. Specifically, the implementation must reuse:

- AWS Organizations / CDK (`AWS::Organizations::Account` via the existing L1-wrapper construct pattern).
- `@ccoe-aws_if-it/ccoe-config-reader` for configuration loading.
- The existing Zod validation model (extended, not replaced).
- Environment-specific YAML configuration in `config/staging.yaml` and `config/production.yaml`, with genuinely common values in `config/default.yaml`.
- The existing reusable account construct pattern (`lib/constructs/shared-account.ts` today), including its `RemovalPolicy.RETAIN` and `updateReplacePolicy: RETAIN` guardrails.
- Generated AWS account IDs surfaced as CloudFormation stack outputs.
- Duplicate-account prevention / idempotency (unique account names and unique account emails; stable construct IDs so repeated deployments do not request new accounts).
- Protection against accidental replacement / deletion, so a rename or a misconfigured redeploy orphans the resource from the stack instead of closing the AWS account.
- The existing OU-ID resolution pattern (pattern-constrained CloudFormation parameters populated from OU stack outputs at deploy time).
- The existing GitHub Actions deployment architecture, including protected release branches, protected Production environment, OIDC, and reusable composite actions.

Do **not** introduce a parallel account-provisioning architecture, a second configuration loader, a second validator, or a second environment-selection mechanism.

### 5.1 Control Tower-specific behavior must not be inherited

The following remain specific to Audit / Log Archive and must **not** be applied to the Landing Zone platform or Staging test accounts:

- Path A Control Tower account-ID handoff (workflow-runtime shared-account-ID resolution passed to the Control Tower initializer).
- Control Tower shared-account manifest integration.
- Audit / Log Archive outputs consumed by Control Tower initialization.
- Control Tower initialization dependency ordering.
- The pre-Control-Tower minimal-state restrictions in `shared-account-provisioning.instructions.md` §9 (Config recorders, aggregators, custom CloudTrails, Identity Center assignments, etc. are separate governance decisions post-Control-Tower, not restrictions on remaining-account creation itself).

The remaining accounts are ordinary AWS Organizations accounts created after Control Tower is stable; they carry no Path A obligation.

---

## 6. Client-Confirmed Account Tagging Requirements

The customer has responded to the tagging clarification questions on the workbook's **"Tagging Questions"** worksheet. The mandatory / P1 tag set for the initial account-provisioning phase, confirmed by the workbook Q2 response and by the "Must have tags" list at rows A21–A28, is:

- `owner`
- `owner-email`
- `environment`
- `lifecycle`
- `data-classification`
- `data-residency`
- `itsystemcode`
- `domain`

Only the mandatory / P1 tags are required for the initial account-provisioning phase (workbook Q12: "ONLY P1 TAGS, that is the mandatory tags"). Do not introduce P2 / P3 tags in this phase unless separately approved. Do not introduce legacy tags (`responsible`, `businesscontact`, `supportteam`, `confidentiality`, `integrity`, `availability`, `systeminstallstatus`, `rto`, `rpo`, `CostCentre`); the customer explicitly confirmed (Q11) that only the P1 must-have set applies to this phase.

### 6.1 Tag value rules

The following rules define what each tag's value must be and where it comes from. `CDK configuration` throughout means values loaded via `@ccoe-aws_if-it/ccoe-config-reader` from `config/default.yaml`, `config/staging.yaml`, and `config/production.yaml`, per workbook Q8 ("For now the tags will come from CDK configuration but at a later time we will integrate service now into the flow").

**`owner`.** **Authoritative mapping: `Account Provisioning Inputs.Owner / Team → owner`** (project decision supplementing the workbook Must-have tags row A21, which said only "Use configuration values"). The value stored in the workbook's `Owner / Team` column (F5–F20) for the account is the value of the `owner` tag. Examples from the workbook: `CCoE → owner=CCoE`; `Connectivity → owner=Connectivity`. Use the exact workbook value. Do **not** infer `owner` from account name or OU.

**`owner-email`.** **Authoritative mapping: `Account Provisioning Inputs.Account Email → owner-email`** (project decision supplementing the workbook Must-have tags row A22, which said only "Use configuration values"). The value stored in the workbook's `Account Email` column (E5–E20) for the account is the value of the `owner-email` tag. Example: for SecurityTooling (Staging) the workbook Account Email is `FMITaws-cloud-org-002+SecurityTooling@if.se`, therefore `owner-email = FMITaws-cloud-org-002+SecurityTooling@if.se`. Apply the same rule to every concrete account. `owner-email` is **not** sourced from Operations Contact, Security Contact, or a separately invented owner mailbox.

For `CCoE-Hybrid-NonProd-01` the workbook Account Email currently contains `FMITaws-cloud-org-002+CCoE-Hydrid-NonProd-01@if.se`. Because the Hybrid / Hydrid discrepancy in §3.4 remains unresolved for the Account Email itself, the derived `owner-email` for this specific account inherits the same unresolved status. Do **not** silently correct `Hydrid → Hybrid` in either the Account Email or the derived `owner-email`.

**`environment`.** **Mandatory configuration-driven tag.** Allowed values (customer-approved enumeration from workbook "Tagging Questions" row A23): `prod`, `staging`, `dev`, `sandbox`. Workbook Q9 confirms values "should be configuration in CDK for now". The concrete value must be explicitly supplied in per-account CDK configuration and validated against the approved enumeration by Zod. The implementation must **fail safely** at configuration load if the value is missing. Do **not** dynamically infer the value in CDK from account name, OU path, AWS Organization, or any other metadata. The workbook `Organization` column (`Staging` / `Production`) is deployment-environment scope metadata, not an `environment` P1 tag value. Do **not** infer `*-Prod-* → prod` or `*-NonProd-* → staging / dev` from the account name or OU. Note the following semantic point specifically for the six CCoE Staging test accounts (`CCoE-Hybrid-Prod-01`, `CCoE-Hybrid-NonProd-01`, `CCoE-Online-Prod-01`, `CCoE-Online-NonProd-01`, `CCoE-Corp-Prod-01`, `CCoE-Corp-NonProd-01`): the `Prod` / `NonProd` fragment in the account name and OU does **not** determine the `environment` tag; the account configuration must contain the explicit value.

**`lifecycle`.** **Mandatory configuration-driven tag.** Allowed values (customer-approved enumeration from workbook "Tagging Questions" row A24): `active`, `deprecated`, `decommissioning`, `archived`. The concrete value must be explicitly supplied in per-account CDK configuration and validated against the approved enumeration by Zod. The implementation must **fail safely** at configuration load if the value is missing. Do **not** hard-code or dynamically default `lifecycle = active` in CDK / application code. If the project later explicitly configures `active` for a given account, that is an input configuration value, not an inferred CDK default.

**`data-classification`.** **Mandatory configuration-driven tag.** Allowed values (customer-approved enumeration from workbook "Tagging Questions" row A25): `public`, `internal`, `confidential`, `restricted`. Workbook Q1 identifies `data-classification` as one of the tags applied at the AWS account level, and Q11 confirms it applies at both account and resource level. The concrete value must be explicitly supplied in per-account CDK configuration and validated against the approved enumeration by Zod. The implementation must **fail safely** at configuration load if the value is missing. Do **not** assume `internal`, `confidential`, or any other classification based on account name, OU, environment, workload, or any other metadata.

**`data-residency`.** Customer-approved fixed value: `EU`. Workbook Must-have tags row A26 states "data-residency (Hardcoded to EU)". Document `data-residency = EU` for every concrete account. This is the only P1 tag whose value is authoritatively fixed by the workbook.

**`itsystemcode`.** Mandatory. For the current Landing Zone account-provisioning phase the value is sourced from the account's `Cost Centre` column in the workbook. Approved mapping: **Cost Centre → itsystemcode** (workbook Q6: "the system codes are specified in the account provisioning inputs"; workbook Q4: itsystemcode YES for workload accounts). See §7.

**`domain`.** **Mandatory configuration-driven tag.** For the current Landing Zone / Cloud Application Platform base setup (every concrete account created or managed by this instruction — current platform accounts and CCoE Landing Zone validation / test accounts), the customer has confirmed the authoritative value:

```
domain = Cloud Application Platform
```

The value must be represented through per-account CDK configuration (loaded via `@ccoe-aws_if-it/ccoe-config-reader` from `config/default.yaml` / `config/staging.yaml` / `config/production.yaml`), not encoded as a universal code-level default in TypeScript. The subsequent implementation must require a non-empty configured `domain` value for every concrete account being provisioned and validate it through the existing Zod pattern; missing configuration must fail validation before deployment. See §8.

Domain is a **separate** concept from `owner`, `owner-email`, `Cost Centre`, `itsystemcode`, account name, and OU, and must not be derived from any of them. "Application Area" and "Domain" refer to the same business concept in this account-tagging context.

For **future workload accounts** (out of scope of this instruction — see §13), the `domain` value is not globally defaulted to `Cloud Application Platform`; it will be supplied per account through the account-ordering / account-vending flow and, in a later phase, may be sourced from ServiceNow or another approved account-ordering system. ServiceNow integration is not part of the current phase.

### 6.1a Cost attribution consequence

Workbook Q10 records: "Cost should use the combination of itsystemcode and domain". This confirms that cost attribution is performed by combining the existing mandatory tags `itsystemcode` and `domain` in reporting / cost-allocation queries and **does not introduce any additional AWS tag**. In particular, it does not introduce a `CostCentre`, `cost-centre`, or `cost-center` AWS tag. See §7.

### 6.2 Target-state tag model

Only the customer-defined must-have / P1 tag set above is included. The following legacy or additional tags must **not** be introduced automatically by this phase:

- `responsible`
- `businesscontact`
- `supportteam`
- `confidentiality`, `integrity`, `availability`
- `systeminstallstatus`
- `rto`, `rpo`
- `CostCentre`, `cost-centre`, `cost-center`

Any of these that appears in the eventual implementation must be justified by a separately approved requirement.

### 6.3 Tag configuration source

Tag values come from CDK configuration (`config/default.yaml`, `config/staging.yaml`, `config/production.yaml`) consumed via `@ccoe-aws_if-it/ccoe-config-reader` and validated by the existing Zod schema. ServiceNow integration is a future target and is **not** part of this phase. Do not introduce a second tag configuration mechanism.

### 6.4 Tag validation requirements

The subsequent implementation is expected to validate the mandatory tag model at configuration load time:

- `owner` present.
- `owner-email` present and syntactically valid (RFC-5322-shaped, reusing the existing `ACCOUNT_EMAIL_PATTERN` guard).
- `environment` ∈ { `prod`, `staging`, `dev`, `sandbox` }.
- `lifecycle` ∈ { `active`, `deprecated`, `decommissioning`, `archived` }.
- `data-classification` ∈ { `public`, `internal`, `confidential`, `restricted` }.
- `data-residency` = `EU` (fixed literal).
- `itsystemcode` present, sourced from the corresponding workbook Cost Centre value under the approved Cost Centre → itsystemcode mapping.
- `domain` present and non-empty per account. For current Landing Zone accounts (see §8.1) the configured value is the customer-confirmed literal `Cloud Application Platform`. For future workload accounts (§8.2) the value comes from the per-account provisioning / order input. Do **not** derive `domain` from `owner`, `Owner / Team`, `Cost Centre`, `itsystemcode`, account name, or OU.

These are requirements for the subsequent implementation to satisfy. This APM-only step does not modify the Zod schema.

### 6.5 Account-level vs resource-level tagging boundary

The customer confirmed that classification-related tags apply at both account and resource level. This instruction is scoped to **account provisioning** and therefore defines the **account-level** mandatory tagging requirements needed for account creation.

Do **not** expand this change into a full resource-tagging implementation across Landing Zone resources. Resource-level tagging / enforcement (including SCP-based `RequestTag` denies and mandatory-tag policies) belongs to the appropriate Landing Zone tagging governance / design, tracked as a separate follow-up.

---

## 7. Cost Centre → itsystemcode Mapping

The workbook records `Cost Centre` as an account input for every concrete account. For the current account-tagging model, the approved mapping is:

```
Cost Centre  →  itsystemcode
```

Consequences:

- The AWS account tag **must** be `itsystemcode`, populated from the account's Cost Centre value.
- A separate `CostCentre`, `cost-centre`, or `cost-center` AWS tag must **not** be introduced merely because Cost Centre exists as a workbook column.
- The original Cost Centre value should be preserved as business / account metadata in configuration (matching the existing shared-account metadata pattern for `costCentre`), but the AWS tag key is `itsystemcode`.
- Do **not** invent or derive another `itsystemcode` value.
- The customer has confirmed that one system code may be associated with one or multiple AWS accounts, and multiple applications belonging to the same system code may share an account. Therefore uniqueness of `itsystemcode` per account is **not** required and must not be enforced.

### 7.1 Resulting itsystemcode per concrete account

Verified against the workbook `Cost Centre` column (G5–G20) in the "Account Provisioning Inputs" worksheet. Any discrepancy discovered against the actual workbook must be reported, not corrected silently.

| Environment | Account                    | Cost Centre | itsystemcode |
| ----------- | -------------------------- | ----------- | ------------ |
| Staging     | SecurityTooling            | AISARCH     | AISARCH      |
| Staging     | SharedServices             | AISARCH     | AISARCH      |
| Staging     | Network                    | AISCCNO     | AISCCNO      |
| Staging     | CCoE-Hybrid-Prod-01        | AISARCH     | AISARCH      |
| Staging     | CCoE-Hybrid-NonProd-01     | AISARCH     | AISARCH      |
| Staging     | CCoE-Online-Prod-01        | AISARCH     | AISARCH      |
| Staging     | CCoE-Online-NonProd-01     | AISARCH     | AISARCH      |
| Staging     | CCoE-Corp-Prod-01          | AISARCH     | AISARCH      |
| Staging     | CCoE-Corp-NonProd-01       | AISARCH     | AISARCH      |
| Production  | SecurityTooling            | AISARCH     | AISARCH      |
| Production  | SharedServices             | AISARCH     | AISARCH      |
| Production  | Network                    | AISCCNO     | AISCCNO      |

### 7.2 Per-account mandatory / P1 tag status matrix

Each cell uses exactly one of the following unambiguous statuses. No ambiguous words ("expected", "probably", "likely", "as above") appear.

- Literal value — the authoritative fixed value or the value derived from an approved workbook mapping / customer decision (as defined in §6, §7, and §8).
- `CONFIGURATION VALUE REQUIRED — <tag>` — the tag is a **mandatory configuration-driven** P1 tag with a customer-approved allowed-value enumeration; the concrete per-account value must be populated in CDK configuration and validated by Zod before deployment. Missing value fails validation and blocks account creation for that account. Values must not be inferred from account name, OU, AWS Organization, or other metadata.
- `CUSTOMER CONFIRMATION REQUIRED — <subject>` — the customer must confirm an existing value / mapping / spelling before the affected artifact is deployed.

| Account (Env)                                | owner        | owner-email                                                                                                       | environment                              | lifecycle                              | data-classification                              | data-residency | itsystemcode | domain                                                                    |
| -------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------- | ------------------------------------------------ | -------------- | ------------ | ------------------------------------------------------------------------- |
| SecurityTooling (Staging)                    | CCoE         | `FMITaws-cloud-org-002+SecurityTooling@if.se`                                                                     | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISARCH      | Cloud Application Platform        |
| SharedServices (Staging)                     | CCoE         | `FMITaws-cloud-org-002+SharedServices@if.se`                                                                      | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISARCH      | Cloud Application Platform        |
| Network (Staging)                            | Connectivity | `FMITaws-cloud-org-002+Network@if.se`                                                                             | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISCCNO      | Cloud Application Platform        |
| CCoE-Hybrid-Prod-01 (Staging)                | CCoE         | `FMITaws-cloud-org-002+CCoE-Hybrid-Prod-01@if.se`                                                                 | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISARCH      | Cloud Application Platform        |
| CCoE-Hybrid-NonProd-01 (Staging)             | CCoE         | CUSTOMER CONFIRMATION REQUIRED — inherits §3.4 (workbook value `FMITaws-cloud-org-002+CCoE-Hydrid-NonProd-01@if.se`) | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISARCH      | Cloud Application Platform        |
| CCoE-Online-Prod-01 (Staging)                | CCoE         | `FMITaws-cloud-org-002+CCoE-Online-Prod-01@if.se`                                                                 | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISARCH      | Cloud Application Platform        |
| CCoE-Online-NonProd-01 (Staging)             | CCoE         | `FMITaws-cloud-org-002+CCoE-Online-NonProd-01@if.se`                                                              | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISARCH      | Cloud Application Platform        |
| CCoE-Corp-Prod-01 (Staging)                  | CCoE         | `FMITaws-cloud-org-002+CCoE-Corp-Prod-01@if.se`                                                                   | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISARCH      | Cloud Application Platform        |
| CCoE-Corp-NonProd-01 (Staging)               | CCoE         | `FMITaws-cloud-org-002+CCoE-Corp-NonProd-01@if.se`                                                                | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISARCH      | Cloud Application Platform        |
| SecurityTooling (Production)                 | CCoE         | `FMITaws-cloud-org-001+SecurityTooling@if.se`                                                                     | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISARCH      | Cloud Application Platform        |
| SharedServices (Production)                  | CCoE         | `FMITaws-cloud-org-001+SharedServices@if.se`                                                                      | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISARCH      | Cloud Application Platform        |
| Network (Production)                         | Connectivity | `FMITaws-cloud-org-001+Network@if.se`                                                                             | CONFIGURATION VALUE REQUIRED — environment | CONFIGURATION VALUE REQUIRED — lifecycle | CONFIGURATION VALUE REQUIRED — data-classification    | EU             | AISCCNO      | Cloud Application Platform        |

`CCoE-Hybrid-NonProd-01` remains blocked from AWS account creation because the workbook `Account Email` itself is unresolved per §3.4 (`Hydrid` misspelling in `E11`). Since `Account Email → owner-email` is the authoritative mapping, the derived `owner-email` for this account inherits the same unresolved status; the email cell above therefore reads `CUSTOMER CONFIRMATION REQUIRED — inherits §3.4`. Do **not** silently correct `Hydrid → Hybrid` in either the Account Email or the derived `owner-email`.

The `domain` column carries the customer-confirmed value `Cloud Application Platform` for every current Landing Zone account (see §8). Every `CONFIGURATION VALUE REQUIRED — <tag>` entry (environment / lifecycle / data-classification) still blocks AWS account creation for the affected account per §14 — the tag model and its allowed values are defined, but the concrete per-account value must be populated in CDK configuration and validated by Zod before deployment.

---

## 8. Domain Tag — Customer-Confirmed Rule

The `domain` tag is part of the mandatory / P1 tag set. The customer has confirmed the authoritative rule as follows. This rule supersedes every earlier "pending customer confirmation" and "approved post-creation completion" treatment of `domain`; every previous Domain-Pending Account-Creation Exception is withdrawn.

### 8.1 Current Landing Zone / Cloud Application Platform base setup

For every concrete account created or managed by this instruction — that is, the current platform accounts (`SecurityTooling`, `SharedServices`, `Network` in both Staging and Production) and the CCoE Landing Zone validation / test accounts (`CCoE-Hybrid-Prod-01`, `CCoE-Hybrid-NonProd-01`, `CCoE-Online-Prod-01`, `CCoE-Online-NonProd-01`, `CCoE-Corp-Prod-01`, `CCoE-Corp-NonProd-01`) — the confirmed value is:

```
domain = Cloud Application Platform
```

Implementation rules:

- The value must be represented per account through the existing CDK / YAML configuration (`config/default.yaml`, `config/staging.yaml`, `config/production.yaml`), loaded via `@ccoe-aws_if-it/ccoe-config-reader`. Because the value happens to be identical for every current Landing Zone account, it may live in `config/default.yaml` if that is consistent with the repository's shared / default configuration pattern; it must **not** be encoded as a universal code-level default inside TypeScript.
- The subsequent implementation must require a **non-empty** configured `domain` value for every concrete account being provisioned. Missing configuration must fail Zod validation before deployment. `domain` is a normal account-creation-blocking input; it is no longer a post-creation exception.
- Do **not** derive `domain` from `owner`, `Owner / Team`, `owner-email`, `Cost Centre`, `itsystemcode`, account name, or OU. `domain` is a separate concept.
- "Application Area" and "Domain" refer to the same business concept in this account-tagging context.
- The `Cost Centre → itsystemcode` mapping in §7 is unchanged and independent of Domain.

### 8.2 Future workload accounts (out of scope of this instruction)

For future workload accounts (patterns of the form `{solution}-{accountType}-{index}` — see §13):

- `domain` remains configurable per account and is **not** globally defaulted to `Cloud Application Platform`.
- The value must come from the account provisioning / order input for that specific workload account.
- In a subsequent phase the input source may be ServiceNow or another approved account-ordering system.
- Do **not** derive `domain` from `owner`, `Owner / Team`, `owner-email`, `Cost Centre`, `itsystemcode`, account name, or OU for workload accounts either.

### 8.3 ServiceNow (deferred)

ServiceNow integration is **not** implemented in the current phase. The subsequent implementation must keep the Domain source decoupled from the CDK application logic so that ServiceNow (or another approved account-ordering source) can replace YAML as the value source later **without** redesigning account provisioning. Do not introduce a ServiceNow client, adapter, or lookup in this phase.

---

## 9. Account Contacts / Business Metadata Distinction

Distinguish customer-provided account / business metadata from mandatory AWS account **tags**.

- **Owner / Team.** Preserve customer-provided value as business metadata **and** use it as the authoritative source for the `owner` AWS tag per the approved project mapping `Owner / Team → owner` (see §6.1). Examples from the workbook: `CCoE → owner=CCoE`; `Connectivity → owner=Connectivity`. Do **not** infer `owner` from account name or OU.
- **Cost Centre.** Preserve customer-provided value as business metadata. For current account tagging, the value is the source for `itsystemcode` per §7. Do **not** additionally create a `CostCentre` AWS tag; cost attribution instead combines the existing mandatory `itsystemcode` and `domain` tags (workbook Q10 — see §6.1a).
- **Security Contact.** Preserve as customer-provided account / business metadata. Do **not** automatically convert to a mandatory AWS tag.
- **Operations Contact.** Preserve as customer-provided account / business metadata. Do **not** automatically map to `owner-email` or any other AWS tag.
- **Owner Email (`owner-email` tag).** Mandatory AWS tag. Value **is** the workbook `Account Email` for the account per the approved project mapping `Account Email → owner-email` (see §6.1). The AWS account email is used both to create the account (as the `AWS::Organizations::Account` `Email` property) and, separately, as the value of the `owner-email` tag. Do **not** infer `owner-email` from Security Contact or Operations Contact.
- **Account Email vs owner-email — CCoE-Hybrid-NonProd-01.** Because the same workbook value drives both the account creation (Email property) and the `owner-email` tag, the §3.4 Hydrid / Hybrid discrepancy simultaneously affects both. This account remains blocked from creation until the customer confirms the authoritative Account Email; there is no way to proceed with account creation while holding the derived `owner-email` back separately.

These metadata fields (Security Contact, Operations Contact) are **not** direct `AWS::Organizations::Account` creation properties. Do **not** automatically configure AWS alternate account contacts (`AWS::AccountContact` / `PutAlternateContact`) as part of this phase unless separately approved.

---

## 10. Configuration Model

Account-specific values must live in repository configuration. Prefer extending the existing accounts configuration model rather than introducing a second model.

- Environment-specific values (per-account emails, environment-specific security contacts, etc.) belong in `config/staging.yaml` and `config/production.yaml`.
- Common values may be placed in `config/default.yaml` **only** when genuinely common and consistent with repository conventions. Example candidate: `data-residency = EU`.
- Do **not** hard-code customer-specific account values in TypeScript.
- Do **not** hard-code Production account IDs.
- Do **not** invent AWS account IDs (see §12).

The subsequent implementation should validate at configuration load:

- Account category / type is a known category.
- `name` is a valid AWS account name.
- `email` is syntactically valid and unique across the environment.
- `ouPath` maps to an existing OU in the deployed hierarchy.
- No duplicate account names within the environment.
- No duplicate account emails within the environment.
- Environment is `staging` or `production`.
- Mandatory P1 tag model is present and value-constrained per §6.4.
- Generated account IDs, where applicable, are surfaced as outputs and not required as configuration inputs.

Detailed schema shape belongs to the subsequent implementation and to `.apm/skills/generate-account/SKILL.md`. This APM-only step does not modify `config/**` or `config/schemas/**`.

---

## 11. Deployment Scope Boundary

For this APM update:

- Staging platform accounts (SecurityTooling, SharedServices, Network) — documented; deployment authorized later after Control Tower stabilization.
- Staging test accounts (CCoE-* × 6) — documented; deployment authorized later, subject to §3.4 for CCoE-Hybrid-NonProd-01.
- Production platform accounts (SecurityTooling, SharedServices, Network) — documented; deployment remains gated behind the protected Production environment and separate Production authorization (see `landing-zone-ou-governance.instructions.md` §3 and the `PRODUCTION_DEPLOYMENT_ENABLED` gate on `production-deploy.yml`).
- Production workload account patterns — future account-vending scope, not documented as concrete accounts (see §13).

The APM change itself must not:

- deploy anything;
- create AWS accounts;
- trigger any GitHub Actions workflow;
- run `apm install`;
- assume Production deployment authorization.

---

## 12. Account ID Handling

AWS account IDs are generated outputs.

- Do **not** invent account IDs.
- Do **not** use fake IDs, placeholders, or examples as final values.
- Do **not** hard-code generated IDs in TypeScript.
- Do **not** require unresolved Production IDs for schema validation (generated-ID fields must be optional / not-yet-resolved until creation occurs).
- Do **not** dynamically rewrite YAML during deployment merely to persist IDs.
- Do **not** introduce CloudFormation `Fn::Export` / `Fn::ImportValue` coupling solely to move account IDs between stacks.

Reuse the repository's established output / resolution mechanism (stack outputs, `describe-stacks`, workflow step outputs) already used for Audit and Log Archive. Note that the Audit / Log Archive Path A pattern — workflow-runtime resolution of shared-account IDs handed directly to the Control Tower initializer — is **specific to those accounts** and must not be generalized to the remaining accounts, which have no equivalent downstream consumer.

If repository convention persists resolved IDs into environment YAML through a separately reviewed Git change, that applies here as well; Staging IDs may be added to `config/staging.yaml` after successful creation, Production IDs remain unset until Production creation is separately authorized.

---

## 13. Production Workload Accounts — Future Account-Vending Scope

The Production workbook contains workload-account patterns of the form:

```
{solution}-{accountType}-{index}
```

for each of:

- Hybrid / Prod
- Hybrid / Non-Prod
- Online / Prod
- Online / Non-Prod
- Corp / Prod
- Corp / Non-Prod

These are **not** concrete Landing Zone accounts to be created by this implementation. They represent a future workload account-vending / account-factory capability. Therefore, in any implementation authored against this instruction:

- **Do not** materialize them as `AWS::Organizations::Account` resources.
- **Do not** invent solution names.
- **Do not** invent AWS account names.
- **Do not** invent account emails.
- **Do not** create deployable placeholder configuration entries.
- **Do not** include them in the current concrete-account deployment inventory.

Document them only as **FUTURE ACCOUNT-VENDING SCOPE**. The design of that account-vending capability is a separate follow-up governance activity.

---

## 14. Safety Constraints and Stop Conditions

STOP and report — rather than resolve by assumption — if any of the following holds. Do not silently correct, normalize, infer, or invent customer-provided values.

- A workbook value conflicts with repository configuration.
- A workbook value conflicts with an approved APM decision.
- An account name is ambiguous.
- An account email is ambiguous.
- An email appears inconsistent, **including the CCoE-Hybrid-NonProd-01 / `+CCoE-Hydrid-NonProd-01@if.se` discrepancy in §3.4**.
- A target OU cannot be mapped confidently to the deployed OU hierarchy (including the workbook shorthand → repository canonical path mapping in §4.1).
- The repository OU hierarchy differs from the workbook expectation.
- An account already exists in AWS Organizations but is not represented safely in state / configuration.
- Provisioning a concrete account would cause duplicate `CreateAccount` requests.
- Provisioning would recreate, replace, rename, or move an existing OU.
- Provisioning would require SCP / RCP modification.
- Provisioning would require changing Control Tower configuration or Path A.
- Provisioning would require an unapproved account baseline (Config recorder, custom CloudTrail, Identity Center assignments, etc.) as a prerequisite.
- **Account Email is missing or ambiguous** for a concrete account, including the specific `CCoE-Hybrid-NonProd-01` Hydrid / Hybrid case in §3.4. Because `Account Email → owner-email`, an unresolved Account Email simultaneously blocks the `Email` property and the `owner-email` tag for that account.
- A concrete account's `environment` value has not been explicitly configured in CDK configuration (allowed enumeration alone is not a concrete value; see §6.1). Do not infer the value from account name, OU, AWS Organization, or other metadata.
- A concrete account's `lifecycle` value has not been explicitly configured in CDK configuration. Do not default to `active`.
- A concrete account's `data-classification` value has not been explicitly configured in CDK configuration. Do not infer classification from account name, OU, environment, or workload.
- Any other mandatory P1 value — `owner`, `owner-email`, `data-residency`, `itsystemcode` — would have to be invented, guessed, or defaulted rather than sourced from the approved project mapping (`Owner / Team → owner`, `Account Email → owner-email`, `EU`, `Cost Centre → itsystemcode`).
- The `Cost Centre → itsystemcode` mapping conflicts with an authoritative separate `itsystemcode` field in the workbook.
- A Production workload pattern would have to become a real account.
- Production deployment authorization would have to be assumed.
- Repository architecture conflicts with reuse of the existing account-provisioning mechanism.
- A concrete account's `domain` value has not been configured, or would have to be derived from `owner`, `Owner / Team`, `Cost Centre`, `itsystemcode`, account name, or OU. For current Landing Zone accounts the configured value must be the customer-confirmed literal `Cloud Application Platform` (§8.1); for future workload accounts the value must come from the per-account provisioning / order input (§8.2). Do **not** globally default `domain` to `Cloud Application Platform` for future workload accounts, and do **not** invent a value in either category.
- The repository's approved AWS Organizations / CDK account-provisioning mechanism cannot apply one or more of the required mandatory account tags **as designed** (i.e., natively through `AWS::Organizations::Account` tagging). Report the technical limitation, the affected tag(s), and the affected account(s). Do **not** introduce a second tagging mechanism, a custom resource, a Lambda workaround, a CLI mutation, or a post-creation mutation workflow to work around such a limitation without explicit approval.

---

## 15. Exclusions Summary

For clarity, the following remain **explicitly out of scope** of this instruction:

- Audit and Log Archive lifecycle (governed by `shared-account-provisioning.instructions.md`).
- Control Tower initialization or reconfiguration.
- SCP / RCP creation, modification, or removal.
- OU creation, modification, or movement.
- IAM Identity Center group mappings, permission-set assignments, or account-to-group mappings (see §16).
- ServiceNow integration.
- Resource-level tagging enforcement across Landing Zone resources (see §6.5).
- Production workload account materialization (see §13).
- Sandbox account provisioning (see §2.5).
- P2 / P3 tags beyond the customer-confirmed P1 set.
- Automated alternate account contact configuration.

---

## 16. IAM Identity Center Boundary

The workbook identifies IAM Identity Center mapping as **post-account-creation** work. Therefore:

- Do **not** create Identity Center group mappings as part of account provisioning.
- Do **not** invent groups, permission sets, or assignments.
- Do **not** block APM design or account provisioning on Identity Center mappings.

Identity Center group mappings and account assignments are documented as a subsequent activity, governed separately by `.apm/instructions/landing-zone-identity-center-governance.instructions.md`.

---

## 17. Deployment Sequencing

The high-level Landing Zone account-provisioning lifecycle is:

1. Existing AWS Organization / OU / SCP foundation (already deployed).
2. Audit + Log Archive provisioning (`shared-account-provisioning.instructions.md`).
3. Control Tower SCP compatibility (`control-tower-scp-compatibility.instructions.md`).
4. Control Tower initialization (`control-tower-initialization.instructions.md`).
5. Control Tower validation / stabilization.
6. Remaining approved Landing Zone account provisioning (**this instruction**).
7. Account / OU / tag validation.
8. Later IAM Identity Center group and account mappings.
9. Future ServiceNow-driven metadata / tag integration.
10. Future Production workload account-vending capability.

The already-approved Control Tower implementation must not be modified or redesigned by this instruction.

---

## 18. Instruction vs Skill Boundary

This file contains **facts, inventory, categorization, tagging decisions, safety constraints, exclusions, and completion criteria** for the remaining approved Landing Zone accounts.

The reusable implementation procedure — repository inspection, governing-instruction selection, configuration extension, schema extension, reusable CDK account generation, OU-ID resolution, duplicate prevention, account-ID handling, deletion / replacement protection, mandatory account-tag application, tag validation, workflow integration, deployment safety, expected implementation report, and stop conditions — lives in `.apm/skills/generate-account/SKILL.md`.

Do not turn this instruction into a deployment runbook. Do not duplicate large sections of the skill verbatim.

---

## 19. Do Not Change Existing Architecture Unnecessarily

This APM update does **not** authorize redesign of any of the following. Any change to these must be a separately approved change under the relevant existing instruction:

- OU hierarchy (`landing-zone-ou-governance.instructions.md`).
- SCP / RCP catalogue (`landing-zone-scp-governance.instructions.md`).
- Control Tower initialization (`control-tower-initialization.instructions.md`).
- Control Tower manifest, retention configuration, or encryption configuration.
- GitHub branching strategy (`landing-zone-ou-governance.instructions.md` §3).
- Protected Production Environment or OIDC architecture.
- Path A (Audit / Log Archive account-ID handoff) as documented in `shared-account-provisioning.instructions.md` §18 and `control-tower-initialization.instructions.md` §6.
- Existing reusable composite actions.
- IAM Identity Center architecture (`landing-zone-identity-center-governance.instructions.md`).

The goal of this instruction is to establish governance for the next account-provisioning phase, not to revisit foundations.

---

## 20. Completion Criteria

This instruction is considered fully applied — for the current phase — when:

- The reusable account-provisioning mechanism supports the remaining Landing Zone platform and Staging test accounts using the existing architecture (§5).
- Each concrete account in §3 has been deployed under an authoritative and confirmed configuration, or explicitly held pending an unresolved item (for example the CCoE-Hybrid-NonProd-01 Account Email in §3.4).
- CCoE-Hybrid-NonProd-01 is deployed only against a customer-confirmed authoritative Account Email (§3.4). The same value is used as the `owner-email` tag per §9.
- Every deployed account carries the full P1 tag set at creation time, sourced under the approved mappings: `owner` (from workbook `Owner / Team`), `owner-email` (from workbook `Account Email`), `environment`, `lifecycle`, `data-classification`, `data-residency = EU`, `itsystemcode` (from workbook `Cost Centre`), and `domain` (from per-account CDK configuration; the customer-confirmed literal `Cloud Application Platform` for every current Landing Zone account per §8.1).
- No P2 / P3 tags, no `CostCentre` / `cost-centre` / `cost-center` AWS tag, and no other legacy tag have been introduced.
- `data-residency = EU` on every account.
- `itsystemcode` on every account matches the workbook Cost Centre value under the mapping in §7.
- Audit and Log Archive remain untouched, still governed by the shared-account instruction and its Path A implementation.
- Production workload account patterns remain unmaterialized future account-vending scope (§13).
- The existing OU hierarchy, SCP / RCP catalogue, Control Tower configuration, Identity Center architecture, and workflow architecture remain unchanged.
- Sandbox provisioning, Identity Center group and account mappings, ServiceNow integration, and resource-level tagging enforcement remain deferred to their respective follow-ups.
