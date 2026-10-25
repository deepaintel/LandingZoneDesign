# Global Cloud Tagging Strategy

Azure - AWS - GCP | Version 1.11 | 2026

**Governance alignment**

This document aligns with the relevant cloud-metadata and tagging-related
requirements of BI_Data Governance 1.0, dated 2026-05-12 and shared by Frej
Nielsen.

This strategy is the cross-cloud implementation standard for cloud resource
tagging and related metadata controls. It should be read as a supporting
implementation document under the broader data governance instruction, not as a
replacement for it.

**Scope**

This document defines the standard for cloud resource tags, source-system
mapping, ownership-related metadata, selected classification and compliance
controls, and enforcement across Azure, AWS, and GCP.

**Boundary**

This document does not define the full enterprise data governance operating
model. Broader requirements related to data quality, metadata management
outside cloud tags, lineage as an enterprise capability, third-party data
governance, and data issue reporting remain governed by BI_Data Governance 1.0
and associated supporting documents.

Unified tagging strategy.

This is the canonical cloud tagging document for this repository. It contains
both the minimum viable tag set and the full extended register so projects do
not have to reconcile multiple sources of truth.

Supporting evidence:
- [tagging/inventory/operational-inventory.md](tagging/inventory/operational-inventory.md) — observed live tag and label usage across current automations
- [tagging/analysis/gap-analysis.md](tagging/analysis/gap-analysis.md) — assessment of which target tags are justified by current estate reality
- [tagging/inventory/ardoq-field-inventory.csv](tagging/inventory/ardoq-field-inventory.csv) — Ardoq/IfNow field inventory used to assess CMDB field coverage

This document also contains the recommended source, field, and population
approach for each tag. Those recommendations are intended to be confirmed per
tag during rollout rather than treated as proof of implemented integration.

This strategy defines a single tag model for Azure, AWS, and GCP using
GCP-compatible key naming throughout: lowercase letters, digits, and hyphens
only. It is designed to support:

- cost attribution
- governance scoring
- security and compliance controls
- operational automation
- architecture visualisation in archlens

Current state: cost attribution uses `IT System Code`. This strategy therefore
uses `IT System Code` as the current field for cost attribution and does not
define a separate `cost-center` cloud tag.

archlens is a consumer of this global standard, not the owner of its
requirements. A tag belongs in the global model only when it serves a real
operational, governance, financial, security, or architecture need across the
estate. archlens may consume that metadata, but it must not be the sole reason
for introducing mandatory tags into the standard.

Most of the information defined here should already exist in the CMDB or other
internal systems. This document defines the required metadata model, not a
requirement to invent entirely new data. Existing authoritative systems should
remain authoritative wherever possible. The implementation task is to populate
and maintain the model consistently across cloud resources.

This strategy is constrained by one rule: **current operational tag and label usage across
live cloud automations is the baseline truth.** The extended schema in this document is
valid only where it either:

- normalises tags already used today across Azure, AWS, and GCP
- adds clear value through a concrete automation, governance, reporting, financial, or architecture consumer

If a target tag has no current use and no identified consumer, the target should change
rather than forcing projects to carry metadata with no real outcome.

Requirements in this document should therefore be justified by estate-wide need,
not by the needs of a single tool. archlens can help prove value for some
fields, especially a small architecture-oriented subset, but the standard must
remain broader than archlens and grounded in real consumers. In practice,
archlens currently uses a small set: `itsystemcode`, `environment`, and
`depends-on`, with `service` consumed where teams provide it and `expose` consumed
only where it is already present for exposure-related behaviour. archlens also manages its own internal labels
(`archlens-exclude`, `archlens-diagram-label`, `archlens-group`) — these are
tool-managed and not part of the team tagging standard. That is evidence for a
narrow consumer need, not for expanding this strategy into a broad manual
tagging burden.

---

## 1. Design principles

1. One global schema across all cloud providers.
2. Keys must be GCP-compatible from day one.
3. Operational baseline comes before target-state completeness.
4. Priority drives enforcement.
5. Mandatory tags must be enforced in IaC first, not only in cloud policy.
6. Fixed-vocabulary governance tags must not allow free text.
7. Tags support both operational governance and architecture intelligence.
8. Source systems such as CMDB, finance, IAM, and ITSM remain authoritative where appropriate.
9. No mandatory tag exists only because one product would find it convenient.

### 1.1 Alignment themes

This strategy supports the following BI_Data Governance 1.0 themes where they
apply to cloud-resource metadata:

- data must be owned and governed through explicit ownership tags, source-system ownership, enforcement, and approved exceptions
- data must be classified through cloud-resource expression of approved sensitivity, residency, recovery, and compliance controls
- data must be described through documented and managed metadata in the tag register and its mapped source systems
- data must be effectively monitored through IaC validation, cloud policy, asset inventory, and governance reporting

This strategy does not redefine the full enterprise governance process for data
quality, enterprise lineage, or issue reporting. It defines how the relevant
outputs of those processes are represented on cloud resources where there is a
real operational or control consumer.

### 1.2 Governance responsibilities

This document uses three responsibility layers:

- enterprise governance accountability: business and governance roles defined by BI_Data Governance 1.0 remain accountable for deciding classification, ownership, and policy requirements
- source-system ownership: systems such as IfNow, Ardoq, finance, ITSM, and security tooling remain authoritative for the values they own
- cloud tag population responsibility: platform engineering and workload delivery teams are responsible for projecting approved values onto cloud resources through IaC, automation, and approved integrations

Within that model:

- Data Owners remain accountable for the business meaning and correctness of the underlying metadata in the authoritative source systems
- Data Domain Owners remain accountable for ensuring that required metadata is maintained consistently across their domain and is fit for downstream cloud use
- platform engineering owns the cross-cloud schema, IaC enforcement model, and provider-policy implementation defined in this strategy
- control owners in security, finance, ITSM, and related functions approve the mappings used where a cloud tag is derived from their governed data

### 1.3 Adoption filter

Every tag in this strategy should fit one of four decisions:

| Decision | Meaning |
|---|---|
| Keep | Already used today, or required immediately by a proven consumer. |
| Normalise | Already used today, but should be standardised to the global key format. |
| Add with evidence | Not used today, but justified by a concrete control or reporting outcome. |
| Remove or defer | No current use and no clear consumer. |

This prevents the strategy from becoming a wish list detached from how the estate is
actually governed.

---

## 2. Priority model

### P1 - Critical

Deny effect. Resource cannot be deployed without this tag.

Requirements:
- required input in every IaC module
- no default value
- validated at plan time
- enforced with cloud policy where supported

### P2 - Required

Audit effect. Resource may deploy, but compliance is reduced and remediation is required.

Requirements:
- validated in IaC where practical
- surfaced in governance reporting
- remediation target within 30 days

### P3 - Recommended

Audit effect. No core compliance penalty, but enables architecture, automation, or governance features.

### P4 - Optional

No enforcement. Team adopts where it provides value for their workload.

---

## 3. Naming rules

All tag keys use lowercase-hyphenated format.

Examples:
- owner
- itsystemcode
- data-classification
- sunset-date

This is intentional. It avoids provider-specific translation logic and keeps the same schema valid across Azure, AWS, and GCP.

Rules:
- keys must start with a lowercase letter
- keys use lowercase letters, digits, and hyphens only
- fixed-vocabulary values should also be lowercase
- free-text values must be normalised where possible
- dates use ISO 8601 format: yyyy-mm-dd

### 3.1 Value validation rules

All tag values must be safe for GCP labels (lowercase, max 63 characters, hyphens allowed, no spaces).

| Value type | Applies to | Rule |
|---|---|---|
| Fixed vocabulary | `environment`, `lifecycle`, `data-classification`, `data-residency`, `tier`, `expose`, `criticality`, `rto`, `rpo`, `managed-by`, `redundancy`, `backup-management` | Exact match to allowed values. Unknown values must be rejected at IaC validation. |
| Identifier (CMDB or team slug) | `itsystemcode`, `owner`, `support-team`, `service` | Lowercase, hyphens only, no spaces, max 63 characters. |
| Email address | `owner-email` | Must be lowercase. Must be a team mailbox, not a personal address. |
| Date | `sunset-date` | ISO 8601 format: `yyyy-mm-dd` only. |
| Path or URL | `iac-repo`, `iac-module` | Lowercase preferred. Use short repo identifiers rather than full URLs to stay within GCP 63-character label value limit. |
| Comma-separated list | `depends-on` | Short lowercase hyphenated names, comma-separated, no spaces. Truncate in GCP if total length exceeds 63 characters and record full value in the source system. |
| Free text | `product-owner` | Lowercase, no special characters. |
| Backup policy value | `backup-policy` | Lowercase, hyphen-safe. Must match an approved value from the backup service model. |

### 3.2 Reserved key prefixes

The following tag and label key prefixes are reserved for platform tooling. Workload teams must not use these prefixes for custom tags:

| Prefix | Owner | Purpose |
|---|---|---|
| `archlens-` | archlens product | Internal collection and display labels managed by archlens. |
| `eslz-` | Platform engineering (CAF policy) | Azure landing zone policy trigger tags. |
| `sa-` | Platform engineering (backup automation) | Storage account backup control tags. |

If a new platform automation needs its own control tags, the owning team must register the prefix here before use.

---

## 4. Complete tag register

Extended candidate register: 23 tags across 5 categories.
Initial recommended rollout set: 9 normalised global tags.

This is the **extended candidate register**, not an instruction to enforce all 23 tags
unchallenged. Tags in this register should be adopted according to the operational
baseline and the adoption filter above.

Columns:
- priority
- tag key
- allowed values
- enforcement
- Azure
- AWS
- GCP
- suggested source
- suggested field(s)
- suggested population mode
- decision note
- purpose

**Note on allowed values:** Fixed-vocabulary allowed values shown in this
register are examples. Values for `owner`, `owner-email`, and other
fixed-vocabulary fields must be defined per organisation from
authoritative source systems (CMDB, finance, IAM). The format and enforcement
model is the standard; the specific values are not.

Suggested source columns are recommendations, not proof of implemented
integration. They show the preferred system of record, the likely field or
relationship to use, and the intended population method for each tag. If a
suggested source is rejected, the owning team must name the alternative source
or explicitly mark the tag as manual or deferred.

Suggested source values: `IfNow`, `Ardoq`, `Finance`, `ITSM`, `Security`,
`IaC`, `Provider API`, `Derived`, `Mixed`

Suggested population mode values: `direct`, `derived`, `deploy-time`,
`external integration`, `provider-derived`, `manual until integrated`

## 4.1 Ownership and accountability

| Priority | Tag key | Allowed values | Enforce | Azure | AWS | GCP | Suggested source | Suggested field(s) | Suggested population mode | Decision note | Purpose |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | owner | team-payments, team-claims, team-platform | Deny | Yes | Yes | Yes | Ardoq | Organisation relationship linked to Application CI | direct | Prefer Ardoq if team ownership is maintained there more reliably than in IfNow. Confirm whether this should represent owning team or support team for outsourced services. | Team responsible for the resource. Used for ownership, incident routing, and reporting. Must match the approved enterprise team model. |
| P1 | owner-email | payments@if.com | Deny | Yes | Yes | Conditional | Ardoq | Organisation / Contact Email | direct | Use a team mailbox, not a named person. Confirm the correct relationship for outsourced or vendor-managed applications. | Contact email for the owning team. Must be lowercase. Used for alerts and reporting. |
| P2 | product-owner | firstname.lastname | Audit | Yes | Yes | Yes | Ardoq | Person linked to Application CI | direct | Accept only if person records are governed well enough for escalation use. Otherwise move this to portfolio tooling and do not imply automation yet. | Business owner for escalation and sign-off. Distinct from technical owner team. |
| P2 | managed-by | terraform, bicep, pulumi, manual | Audit | Yes | Yes | Yes | IaC | Deployment tool / pipeline context, with Hosting Type as fallback signal | deploy-time | Treat IaC as the real source. Use `manual` only where no managed deployment path exists. Do not claim CMDB ownership for this tag. | How the resource was provisioned. `manual` indicates an IaC gap. |
| P3 | iac-repo | repo URL or short repo path | Audit | Yes | Yes | Yes | IaC | Pipeline repository context | deploy-time | Capture from pipeline metadata, not CMDB. Prefer short repository identifiers over long URLs where label limits apply. | IaC source repository for drill-down from governance reports. |
| P3 | iac-module | modules/aks/v3 | Audit | Yes | Yes | Yes | IaC | Pipeline module path and version | deploy-time | Capture from deployment context. This is implementation metadata and should not be modelled as application master data. | IaC module path and version used to deploy the resource. |

## 4.2 Environment and lifecycle

| Priority | Tag key | Allowed values | Enforce | Azure | AWS | GCP | Suggested source | Suggested field(s) | Suggested population mode | Decision note | Purpose |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | environment | prod, staging, dev, sandbox | Deny | Yes | Yes | Yes | IaC | Deployment environment / workspace / pipeline context | deploy-time | This should remain deploy-time metadata, not CMDB-owned, because one application can exist in several environments at once. | Deployment environment. Drives access, backup, governance rules, and filtering. DR resources use the environment of the tier they protect (typically `prod`) and declare recovery tier via the backup-policy tag defined by the backup service model. |
| P1 | lifecycle | active, deprecated, decommissioning, archived | Deny | Yes | Yes | Yes | IfNow | System Install Status | direct | Use this instead of `life_cycle`. Confirm the IfNow vocabulary maps cleanly to the standard values before hard enforcement. CMDB guidance also notes that the CSDM/CMDB project may later replace Install Status with `Life cycle Stage/Status`; if that change lands, this source mapping should move to the new field. | Resource lifecycle state. `deprecated` and `decommissioning` trigger governance attention. |
| P3 | sunset-date | yyyy-mm-dd | Audit | Yes | Yes | Yes | IfNow | Sunset date | direct | Use only if the application lifecycle process already maintains a planned retirement date. Otherwise do not imply that this is presently automated. | Planned decommission date. Required when lifecycle is deprecated. |

## 4.3 Data classification and compliance expression for cloud resources

This section defines how selected classification and compliance requirements are
expressed on cloud resources as tags or labels.

The authoritative enterprise classification model remains BI_Data Governance
1.0 together with the relevant information security and privacy frameworks.
This strategy does not replace dataset-level classification, domain-level
accountability, or broader governance records held outside the cloud platform.

Where dimensions such as domain, data type, criticality, security, privacy,
recovery, or residency are governed in source systems or policy processes, this
document defines only the cloud-resource projection needed for enforcement,
reporting, automation, and architecture use.

| Priority | Tag key | Allowed values | Enforce | Azure | AWS | GCP | Suggested source | Suggested field(s) | Suggested population mode | Decision note | Purpose |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | data-classification | public, internal, confidential, restricted | Deny | Yes | Yes | Yes | IfNow | Confidentiality requirement (1-4) | derived | Sensible suggested mapping if the CIA scale is accepted as the classification source. Security must approve the translation table before strict enforcement. | Data sensitivity classification used for security and compliance controls. |
| P1 | data-residency | eu, nordic, global, no-requirement | Deny | Yes | Yes | Yes | IfNow | Country + SaaS region + SaaS data centre + Global Capability | derived | Accept only if these CMDB fields are actually maintained and sufficient to express residency policy. Otherwise this needs a policy-owned source. | Geographic residency constraint for data. |
| P2 | rto | 15min, 1h, 2h, 4h, 8h, 24h, 48h, 1w | Audit | Yes | Yes | Yes | IfNow | DR assessment / approved RTO | external integration | Authoritative field sourced from the DR assessment in IfNow. It must not be derived from Availability or other proxy fields. | Recovery time objective. |
| P2 | rpo | 15min, 1h, 4h, 8h, 24h, 1w, 1mo | Audit | Yes | Yes | Yes | IfNow | DR assessment / approved RPO | external integration | Authoritative field sourced from the DR assessment in IfNow. It must not be derived from Integrity or other proxy fields. | Recovery point objective. |
| P2 | backup-policy | backup-service-approved lowercase policy value, e.g. rpo-24h-retention-31d-8w-standard | Audit | Yes | Yes | Yes | Backup service | Confirmed value set owned by Rihards Nikitins (SRE) | manual until integrated | Value set confirmed by Rihards Nikitins (SRE), 2026-05-12. No automated population path exists yet. Do not enforce until the integration path is established. See the backup policy reference below for the full approved value set by workload type. | Backup policy value used for backup policy assignment and compliance. `nobackup` means no backup required. This is an implementation-level tag and is separate from the `rpo` tag, which is the architecture-level recovery objective from the DR assessment in IfNow. |
| P3 | backup-management | managed-by-team, managed-by-platform | Audit | Yes | Yes | Yes | Backup service | Backup service operating model | manual until confirmed | Values confirmed by Rihards Nikitins (SRE), 2026-05-12. Rihards has raised the question of whether this tag is needed as a separate key, since management ownership may be sufficiently expressed through the backup-policy value itself. Decision pending with the backup service team. Do not enforce until resolved. | Who manages the backup process for this resource. `managed-by-platform` means the platform backup service owns execution. `managed-by-team` means the team manages their own backups. |
| P3 | redundancy | local, zone-redundant, geo-redundant, global | Audit | Yes | Yes | Yes | IfNow | Availability requirement (1-4) | derived | Candidate tag from the backup service project. Derivation from Availability requirement is a proposed mapping — not yet confirmed. IaC or architecture design may also set a higher level than the CMDB floor. Do not enforce until mapping is agreed. | Infrastructure redundancy level for the resource. |

### Backup policy reference

Provenance note: The backup policy values documented here come directly from Rihards Nikitins (SRE), confirmed 2026-05-12, and reflect the operating model of the backup service. The Cloud Center of Excellence carries `backup-policy`, `backup-management`, and the storage account control keys in the global schema as the agreed cloud representation of that service model. The value set and operating model are owned by the backup service, not by this standard.

**Important distinction:** `rto` and `rpo` are architecture and DR assessment tags sourced from IfNow. They express the recovery objective at the application level and are governed independently of the backup service. They will not change based on backup service decisions. `backup-policy` is the implementation-level tag that expresses the actual backup policy applied by the backup service. The two are related in principle but governed separately: `rto` and `rpo` drive requirements; `backup-policy` reflects the implementation that meets those requirements.

`backup-policy`, `backup-management`, and `redundancy` are candidates from the backup service project. The value model is now confirmed by the backup service owner for `backup-policy`. No automated population path exists yet. Do not enforce until the integration path is established.

**Storage account exception:** Storage accounts host multiple data types and cannot use a single `backup-policy` tag. Use `sa-blob-backup` for Blob storage and `sa-share-backup` for Files. These keys accept the same policy values as `backup-policy`. Both prefixes are reserved under the `sa-` platform prefix (see §3.2).

**Pending decision:** The final choice between `rpo-15min` and `rpo-30min` variants for database policies is pending internal alignment within the SQL hotel team (noted by Rihards Nikitins, 2026-05-12). Both variants are valid policy values and are listed below.

**Databases — MsSQL on Azure/OnPrem VM, Azure SQL PaaS**

Value set confirmed by Rihards Nikitins (SRE), 2026-05-12.

| backup-policy value | RPO | Daily retention | Weekly retention | Monthly retention | Annual retention | Tier |
|---|---|---|---|---|---|---|
| rpo-15min-retention-14d-short | ≤15 min | 14 days | — | — | — | short |
| rpo-30min-retention-14d-short | ≤30 min | 14 days | — | — | — | short |
| rpo-15min-retention-14d-8w-standard | ≤15 min | 14 days | 8 weeks | — | — | standard |
| rpo-30min-retention-14d-8w-standard | ≤30 min | 14 days | 8 weeks | — | — | standard |
| rpo-15min-retention-14d-8w-12m-long | ≤15 min | 14 days | 8 weeks | 12 months | — | long |
| rpo-30min-retention-14d-8w-12m-long | ≤30 min | 14 days | 8 weeks | 12 months | — | long |
| rpo-15min-retention-14d-8w-12m-3y-xlong | ≤15 min | 14 days | 8 weeks | 12 months | 3 years | xlong |
| rpo-30min-retention-14d-8w-12m-3y-xlong | ≤30 min | 14 days | 8 weeks | 12 months | 3 years | xlong |

**Virtual machines, storage accounts, and files — Azure/OnPrem**

Value set confirmed by Rihards Nikitins (SRE), 2026-05-12. For storage accounts use `sa-blob-backup` and `sa-share-backup` keys instead of `backup-policy`.

| backup-policy value | RPO | Daily retention | Weekly retention | Monthly retention | Tier |
|---|---|---|---|---|---|
| rpo-4h-retention-14d-short | ≤4 h | 14 days | — | — | short |
| rpo-4h-retention-31d-8w-standard | ≤4 h | 31 days | 8 weeks | — | standard |
| rpo-4h-retention-31d-8w-6m-long | ≤4 h | 31 days | 8 weeks | 6 months | long |
| rpo-4h-retention-31d-8w-12m-xlong | ≤4 h | 31 days | 8 weeks | 12 months | xlong |
| rpo-24h-retention-14d-short | ≤24 h | 14 days | — | — | short |
| rpo-24h-retention-31d-8w-standard | ≤24 h | 31 days | 8 weeks | — | standard |
| rpo-24h-retention-31d-8w-6m-long | ≤24 h | 31 days | 8 weeks | 6 months | long |
| rpo-24h-retention-31d-8w-12m-xlong | ≤24 h | 31 days | 8 weeks | 12 months | xlong |

**Data warehouse**

Value set confirmed by Rihards Nikitins (SRE), 2026-05-12.

| backup-policy value | RPO | Retention | Tier |
|---|---|---|---|
| rpo-1w-retention-6m-standard | ≤1 week | 6 months | standard |
| rpo-1m-retention-6m-standard | ≤1 month | 6 months | standard |

**No backup**

| backup-policy value | Meaning |
|---|---|
| nobackup | No backup required |

**Alignment rule:** `backup-policy` should be consistent with the `rpo` tag from the DR assessment in IfNow. The backup service implementation must not contradict the declared recovery objective. Note that `backup-policy` is the implementation form of that objective and is governed by the backup service; `rpo` is the architecture-level target and is governed by the DR assessment.

**Governance note:** backup-policy values are owned by the backup service. This document standardises only how those values are represented as tags when that model is in use.

## 4.4 Application and architecture

| Priority | Tag key | Allowed values | Enforce | Azure | AWS | GCP | Suggested source | Suggested field(s) | Suggested population mode | Decision note | Purpose |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P1 | itsystemcode | IT System Code from IfNow CMDB, or agreed normalised equivalent during transition | Deny | Yes | Yes | Yes | IfNow | IT System Code | direct | Use as the canonical join key unless a replacement enterprise identifier is formally agreed. This is also the field currently used for cost attribution, so teams should use this field rather than introducing a separate cost tag. This should remain the one field teams must always be able to declare. | Enterprise system identifier and application grouping key. Required for architecture views, system identity joins, and current internal cost attribution. |
| P4 | service | service slug | No | Yes | Yes | Yes | IaC | Service or component identifier from module or deployment context | deploy-time | Optional. Useful where a team deploys multiple independently identifiable components (e.g. microservices) and wants separate identity below the application CI level. Not required for cloud infrastructure teams working at resource level — Azure resource naming conventions provide sufficient identity at that scope. Keep outside CMDB ownership where used. | Optional service or functional component name within the application. Omit where Azure resource naming already provides sufficient component identity. |
| P2 | tier | compute, data, integration, security, platform, front-end | Audit | Yes | Yes | Yes | IfNow | Application Type + Interface Type | derived | Reasonable suggested derivation, but it needs an agreed mapping table. If the mapping becomes too lossy, allow IaC to override or set it directly. | Architectural tier for visualisation and governance hints. |
| P2 | expose | internet, internal, private | Audit | Yes | Yes | Yes | IfNow | PAP workspace: Internet Inbound Traffic + On-Premise Connectivity | derived | Use the PAP fields mastered through IfNow if they remain the maintained source for exposure intent. If actual runtime posture matters more than intended exposure, use provider or network telemetry instead. | Network exposure model. |
| P2 | depends-on | comma-separated short names | Audit | Yes | Yes | Yes | IaC | Declared dependency list in deployment or architecture contract | deploy-time | This should stay close to the deployed service model. CMDB can describe application relationships, but not the runtime dependency shape needed here. | Runtime dependency hints used for architecture relationships. |

## 4.5 Operations and support

| Priority | Tag key | Allowed values | Enforce | Azure | AWS | GCP | Suggested source | Suggested field(s) | Suggested population mode | Decision note | Purpose |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P2 | criticality | p1, p2, p3, p4 | Audit | Yes | Yes | Yes | IfNow | Availability requirement (1-4) | derived | This is an operational support signal for cloud resources, not a replacement for the enterprise determination of whether data is critical under BI_Data Governance 1.0. Support teams should confirm the resulting service expectations match reality before enforcement. | Operational criticality and support expectations. |
| P2 | support-team | approved team identifier | Audit | Yes | Yes | Yes | Ardoq | Organisation / support relationship | direct | Prefer Ardoq if support ownership is held as a relationship there. If support and ownership diverge, keep this distinct from `owner` and do not collapse the two. | Operational support team, distinct from owner. |

## 4.6 Security posture — note

`security-zone` and `waf-protected` are computed posture facts, not team tagging obligations. `security-zone` has no security-approved source mapping. `waf-protected` is better derived from provider API state than manually maintained as a tag. Neither is included in the team tagging standard. Where security posture metadata is needed for governance reporting, derive it from platform telemetry, provider APIs, or security tooling.

## 4.7 Platform intelligence — archlens note

archlens creates and manages its own internal labels on cloud resources for
collection, display, and layout purposes. These are tool-managed and do not
count towards the team tagging standard. Teams are not required to set them.

The one exception is `archlens-exclude`. This is a team-authored opt-out tag
that suppresses collection of a specific resource. It is a rare edge case and
should only be used intentionally. Set it in IaC where a resource must
permanently be excluded from archlens collection.

For all other archlens-internal labels (`archlens-diagram-label`,
`archlens-group`, and any future archlens-managed keys): these are managed by
archlens and documented in the archlens product documentation. Do not treat
them as a team tagging obligation.

For context on which global tags archlens consumes:

- `itsystemcode`, `environment`, and `service` are baseline deployment identity metadata that archlens consumes, but archlens is not the reason they exist
- `depends-on` is the clearest archlens-specific architecture tag and should be treated as reviewed dependency intent
- `expose` may inform archlens exposure-related behaviour where already present, but it is not an archlens-specific requirement

Where dependency metadata originates from archlens, the preferred operating
model is UI action in archlens, then a reviewed IaC change or PR, then merge,
with the next collection reading the metadata back and confirming it. archlens
should not require engineers to manually edit cloud-resource tags to maintain
archlens-originated dependency metadata.

---

## 5. Minimum viable tag set

If the organisation needs phased rollout, do not start from an abstract shortlist. Start
from the tags already proven in live automation, then normalise them.

### 5.1 Operational baseline set

These are the tag families already evidenced in current Azure and GCP automations and
should be treated as the real minimum baseline:

| Baseline area | Observed live keys or labels | Normalised target |
|---|---|---|
| Application identity | `ItSystemCode`, `ITSystemCode` | `itsystemcode` |
| Ownership and support | `Responsible`, `BusinessContact`, `SupportTeam` | `responsible`, `businesscontact`, `supportteam` |
| Lifecycle and expiry | `TimeStamp`, `timestamp`, `ExpirationDate`, `SystemInstallStatus` | `sunset-date`, `systeminstallstatus` |
| Environment and risk | `Environment`, `Confidentiality`, `Integrity`, `Availability` | `environment`, `confidentiality`, `integrity`, `availability` |
| Backup control | `sa-blob-backup`, `sa-share-backup`, `<policyTagName>-error` | `backup-policy`, `backup-management` plus provider-specific control tags where needed |
| Policy and network triggers | `eslz-storage-purpose`, `eslz-configure-dns`, `eslz-pip-purpose`, `ipam-res-id` | retain as platform control tags or map explicitly where a better global equivalent exists |
| Automation markers | `WeeklyAutogneratedTagsByCloudTeam`, GCP `target-tags` | retain where the automation consumer still depends on them |

### 5.1.1 Weekly auto-generated Azure tags — normalisation decision

The following 8 tags are auto-generated weekly on Azure subscriptions by the existing CMDB subscription tagging automation (`Azure-CMDB-Subscription-Tagging.ps1`):

`ITSystemCode`, `Responsible`, `BusinessContact`, `SupportTeam`, `Confidentiality`, `Integrity`, `Availability`, `SystemInstallStatus`

**Decision: lowercase normalisation of existing key names.** Key names are preserved. Only case is normalised to lowercase. This is the correct approach because GCP and AWS both require lowercase keys, and changing key names would break existing automations that depend on these keys.

| Current auto-generated key | Normalised target |
|---|---|
| `ITSystemCode` | `itsystemcode` |
| `Responsible` | `responsible` |
| `BusinessContact` | `businesscontact` |
| `SupportTeam` | `supportteam` |
| `Confidentiality` | `confidentiality` |
| `Integrity` | `integrity` |
| `Availability` | `availability` |
| `SystemInstallStatus` | `systeminstallstatus` |

The global schema keys in the extended register (`owner`, `owner-email`, `support-team`, `lifecycle`, `data-classification`, `rto`, `rpo`) remain the aspirational long-term standard for new integrations and new tags. They are not achievable by modifying the existing auto-generation script and are not part of the current normalisation rollout.

### 5.2 First normalised global set

The rollout splits into two tracks.

**Track 1 — Case normalise existing tags (immediate)**

These tags are already in use. Only lowercase normalisation is applied. Key names do not change.

- `itsystemcode`
- `responsible`
- `businesscontact`
- `supportteam`
- `confidentiality`
- `integrity`
- `availability`
- `systeminstallstatus`
- `environment`

**Track 2 — New tags to introduce**

These tags do not exist in the current estate. They are new keys introduced through a dedicated integration from IfNow, Ardoq, or the DR assessment. They follow the global schema naming convention and do not replace the auto-generated tags above.

- `rto`
- `rpo`
- `owner`
- `owner-email`
- `support-team`
- `lifecycle`
- `data-classification`

These are the best candidates because they have a clear source and add governance or architecture coverage not already provided by the existing auto-generated tags.

### 5.3 Genuinely new tags

If the question is not "what is in the extended register?" but "what new metadata are
we actually introducing that does not already exist in another source system, provider
state, or the backup service model?", the list is much smaller.

Only these 4 tags are genuinely new metadata proposals in this strategy:

- `managed-by`
- `iac-repo`
- `iac-module`
- `depends-on`

Everything else in the extended candidate register is either:

- already present in an enterprise source system such as IfNow, Ardoq, finance, ITSM, or security tooling
- derived from those source systems
- observed from provider runtime state
- projected from the backup service model

This distinction matters because the tagging strategy is not proposing 23 entirely new
manual metadata obligations. It is proposing a much smaller set of genuinely new tags,
while the rest should be populated from existing sources wherever those sources already
own the truth.

For archlens specifically, concrete current value across the genuinely new
proposals exists only for `depends-on`. `itsystemcode` and
`environment` are not listed here because they are not genuinely new — both
are already observed in the operational baseline. archlens-managed labels are
not part of the team tagging standard and do not appear in this list.
The remaining genuinely new tags in this list must stand on their own
operational or platform justification and should not be justified on archlens
grounds alone.

### 5.4 Source-backed rollout view

Use this view when deciding what should be prioritised first. It separates the
fields that already have a clear owner or feed from fields that still need
translation rules or integration work.

| Field | Preferred source system or owner | Status | Notes |
|---|---|---|---|
| `itsystemcode` | IfNow CMDB | Clear source | Canonical IT System Code. Also the field currently used for cost attribution. Best current join key for global identity and archlens. |
| `environment` | Team IaC / deployment pipeline | Clear source | Deploy-time fact. Should be provided directly by workload teams. |
| `service` | Team IaC / workload topology | Optional — team discretion | Useful for microservice topologies. Not required at infrastructure resource level where resource naming conventions provide identity. |
| `depends-on` | Team IaC / architecture contract | Clear source | Declared dependency intent. Useful for architecture review and dependency mapping where there is a real consumer. |
| `owner`, `owner-email`, `support-team`, `lifecycle` | IfNow CMDB | Clear source, integration dependent | Prefer source-system enrichment over duplicate manual entry. |
| `rto`, `rpo` | IfNow DR assessment | Clear source, integration dependent | Confirmed authoritative fields from the DR assessment in IfNow. Ready to enforce once the integration path is in place. |
| `data-residency` | IfNow CMDB fields (Country, SaaS region, SaaS data centre, Global Capability) | Clear source, mapping confirmation needed | Accept only if the CMDB fields are actively maintained. Do not enforce P1 Deny until the source mapping is confirmed with the data owner. |
| `backup-policy`, `backup-management`, `redundancy` | Backup service project (Rihards Nikitins, SRE) | Candidate — no confirmed population path | Value model defined by the backup service. No automated population path confirmed yet. Do not enforce until integration from DR assessment to backup policy assignment is established. |
| `data-classification`, `criticality`, `expose` | Agreed translation from CMDB, security, network, and provider state | Needs translation rules | Keep out of strict enforcement until the source mapping is agreed. |
| `archlens-*` | archlens product | Tool-managed | archlens manages its own labels. Not a team tagging obligation. `archlens-exclude` is the only team-set key and only used as a deliberate opt-out. See §4.7. |

If a field cannot yet be placed in the table above with a clear source or a
clear consumer, it should stay out of early mandatory rollout.

## 6. GCP compatibility rules

GCP labels are stricter than Azure tags and AWS tags. This strategy is designed to fit within those rules.

### Key constraints

- lowercase only
- digits allowed
- hyphens allowed
- must start with lowercase letter
- maximum 63 characters

All keys in this strategy comply.

### Value constraints

- lowercase is strongly preferred
- values must remain within 63 characters where possible
- date format yyyy-mm-dd is compatible
- long URLs are not reliable as labels in GCP

### Practical impacts

- owner-email must always be lowercased
- iac-repo should use a short repository identifier or path, not a full long URL
- depends-on must use short resource names and may require truncation in GCP if dependency lists are large

Where a full rich value cannot fit safely in GCP labels, store the shortened operational value in the label and keep the rich canonical value in the authoritative source system.

---

## 7. Enforcement model by provider

The primary enforcement point is IaC, not post-deployment audit.

## 7.1 Universal enforcement

All providers:
- P1 tags are required variables in every IaC module
- no default values for P1 tags
- values validated in module logic
- pre-commit checks validate schema where possible
- CI validates tag presence before deployment

This is the most effective control because it prevents drift before cloud APIs are called.

## 7.2 Azure

P1 enforcement:
- Azure Policy initiative at root management group
- Deny effect for mandatory tags

P2 enforcement:
- Audit effect for required tags
- compliance surfaced in governance dashboard

## 7.3 AWS

P1 enforcement:
- AWS Organizations tag policies
- SCP where supported for deny controls
- required-tags checks in AWS Config

P2 enforcement:
- audit through Config and reporting

## 7.4 GCP

P1 enforcement:
- required labels in Terraform or other deployment modules
- organisation policy constraints where supported

P2 enforcement:
- audit through asset inventory and compliance reporting

Special note:
- owner-email may require audit-first treatment in GCP if normalisation cannot be guaranteed at enforcement time

## 7.5 Tag inheritance model

Tags and labels do **not** inherit automatically from parent scopes in any provider. Every resource must be tagged directly.

**Azure**

Resource group tags do not flow to contained resources by default. Azure Policy can be configured to copy or inherit specific tags from the resource group to resources using the `inheritTagFromResourceGroup` effect. Where this policy is in use, IaC modules must still declare all P1 tags as explicit inputs — do not rely on inheritance as the primary enforcement path. Resources deployed outside IaC will not have inherited tags unless the policy has been applied and has reconciled.

**AWS**

Tag inheritance does not exist at the API level. Some services support tag propagation within a service boundary (for example, Auto Scaling groups can propagate tags to launched EC2 instances), but this is service-specific and must not be assumed. All IaC modules must apply tags at resource creation.

**GCP**

Project labels do not propagate to resources. All resources must be labelled directly. GCP also distinguishes between labels (key-value metadata, the equivalent of tags) and tags (network policy targets in VPC firewall rules) — this strategy uses labels throughout; GCP network tags are a separate provider concept and are not governed here.

---

## 8. Governance scoring integration

These tags are not only metadata. They feed directly into platform governance and architecture intelligence.

Example scoring dimensions:

| Dimension | Inputs | Typical use |
|---|---|---|
| Tagging completeness | owner, itsystemcode, environment, data-classification | Base governance coverage |
| Compliance posture | data-residency | Regulatory and policy alignment |
| Naming quality | itsystemcode, service | Architecture and operational consistency |
| Network exposure | expose | Security posture |
| Lifecycle hygiene | lifecycle, sunset-date | Stale resource detection |

Example derived flags:
- restricted data exposed to internet
- deprecated resource still active
- named dependency without aligned private connectivity

---

## 9. Implementation roadmap

### Phase 1 - Baseline capture and normalisation

- inventory live tags and labels used by current automation, policy, and reporting
- identify which are baseline, provider-specific control tags, or legacy variants
- define approved normalisation mappings into the global schema
- remove or defer target-only tags with no confirmed consumer

### Phase 2 - Schema and IaC enforcement

- define canonical tag schema
- update all IaC modules with required P1 inputs
- add lowercase normalisation where needed
- add value validation for fixed-vocabulary tags

### Phase 3 - Cloud policy rollout

- deploy Azure Policy initiative
- deploy AWS tag policy and Config rules
- deploy GCP organisation constraints where appropriate

### Phase 4 - Remediation

- assess existing resources
- prioritise production first
- remediate shared platform second
- remediate dev and sandbox last
- document approved exceptions

### Phase 5 - Platform integration

- feed tags into archlens collectors
- enrich architecture diagrams
- enable governance scoring and derived flags
- report drift between cloud metadata and source systems

---

## 10. Source systems and ownership model

This strategy does not mean every value is manually entered in cloud by hand.

It separates three questions that should not be collapsed into one:

- who is accountable for the business meaning of the data or metadata
- which enterprise system is authoritative for the value
- which engineering path projects the approved value onto cloud resources

In this strategy, governance accountability stays with the roles defined by BI_Data Governance 1.0, source ownership stays with the systems below, and cloud tag population is implemented through IaC, automation, and approved integrations.

Recommended ownership:
- owner, owner-email, support-team: Ardoq relationship model, with underlying team and contact data imported from authoritative enterprise sources where applicable
- itsystemcode, lifecycle, tier, sunset-date: IfNow-backed application metadata
- product-owner: portfolio or delivery management systems
- rto, rpo: IfNow-backed DR assessment
- backup-policy, backup-management, redundancy: owned by the backup service (Rihards Nikitins, SRE). The backup-policy value set is confirmed by the backup service owner (2026-05-12). The need for a separate backup-management tag is under review by the backup service team. The CCoE carries these tags as the agreed cloud representation of that service model.
- expose: IfNow-backed PAP metadata until a different maintained source is agreed
- environment, managed-by, service, iac-repo, iac-module, depends-on: IaC and platform engineering
- criticality: IfNow-derived operational signal
- data-classification, data-residency: security and compliance controls

The implementation goal is consistent projection of these values onto cloud resources, not duplication of authoritative systems.

---

## 11. Compliance, review, and exceptions

Compliance with this strategy should be measured through IaC validation, provider policy controls, asset inventory, governance dashboards, and approved exception tracking. Non-compliance should result in remediation or a formally approved time-bounded exception.

This document should be reviewed at least annually and whenever BI_Data Governance 1.0, the underlying source systems, or the cloud-provider enforcement model changes materially.

Exceptions must be explicit, time-bounded, and approved.

Allowed examples:
- legacy resources pending remediation
- provider-specific technical limitation
- ephemeral test resources
- resources intentionally excluded from archlens views

Every exception should record:
- tag or rule affected
- reason
- owner
- expiry date
- remediation plan

---

## 12. Final recommendations

1. Treat live operational tag usage as the baseline truth before expanding the schema.
2. Normalise current keys first, instead of introducing target-only tags with no consumer.
3. Enforce P1 in IaC only after each tag has a confirmed source and operational purpose.
4. Roll out the 9-tag initial normalised set before considering the full 23-tag extended register.
5. Keep fixed-vocabulary tags strict.
6. Use short, machine-safe values everywhere possible.
7. Treat CMDB, finance, IAM, and ITSM as source systems where appropriate.
8. Use cloud policy as a secondary control, not the primary one.
9. Keep the full strategy in the repo and keep Confluence to summary snapshots only.

---

## Change history

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.11 | 2026-05-12 | GitHub Copilot | Added §3.1 value validation rules (format, casing, length constraints per tag value type). Added §3.2 reserved key prefixes (`archlens-`, `eslz-`, `sa-`). Added §7.5 tag inheritance model clarifying that tags do not inherit automatically on any provider and IaC must set tags at resource level directly. |
| 1.10 | 2026-05-12 | GitHub Copilot | Removed `patch-group`. No automation reads this tag from cloud resources — ITSM drives patching independently. Same rationale as `maintenance-window` and `alert-channel` removed in v1.9. Register reduced to 23 tags across 5 categories. |
| 1.9 | 2026-05-12 | GitHub Copilot | Removed 6 tags with no confirmed team-set population path or no approved source mapping: `waf-protected` (computed posture, not team-set), `encryption` (not proven runtime truth — use platform telemetry for actual posture), `security-zone` (no security-approved source mapping), `compliance` (no agreed derivation logic), `maintenance-window` and `alert-channel` (ITSM owns these; teams should not duplicate). Section 4.6 Security converted to a note. Register reduced to 24 tags across 5 categories. |
| 1.8 | 2026-05-12 | GitHub Copilot | Downgraded `service` from P2 Audit to P3 No-enforce. Reframed as optional — useful for microservice topologies but not required at infrastructure resource level where Azure resource naming provides sufficient identity. Removed `service` from the genuinely new tags list in §5.3 (it has no mandatory consumer). Updated §5.4 status to Optional — team discretion. Softened archlens intro reference from "depends on" to "uses where provided". |
| 1.7 | 2026-05-12 | GitHub Copilot | Removed tags with no live consumer or operational inventory evidence: `cost-centre`, `budget-code`, `billing-model`, `project`, `business-unit`, `created-date`, `review-date`, `architecture-pattern`, `critical-path`, `monitoring`, `vulnerability-scan`, `pen-test-scope`, `auto-shutdown`, `shutdown-schedule`. Removed `business-unit` section. Moved archlens tags out of the counted register into a note section. Replaced chargeback language with cost attribution. Updated all counts, section references, ownership model, scoring, and gap analysis. Register reduced to 30 tags across 6 categories. |

---

Global Cloud Tagging Strategy v1.11
All keys GCP-compatible
Initial recommended rollout: 9 tags
Extended candidate register: 23 tags
Azure - AWS - GCP
