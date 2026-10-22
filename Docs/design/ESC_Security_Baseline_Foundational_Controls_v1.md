**AWS European Sovereign Cloud**

**Security Baseline & Foundational Controls**

*Landing Zone Foundational Security - Design Phase Deliverable*

*Region: eusc-de-east-1 \| Partition: aws-eusc \| Brandenburg, Germany*

| **Document ID**                             | US-1542065 \| ESC-SEC-BASELINE-v1.0                                                                                                                 |
|---------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| **Phase**                                   | Design Phase - Security Baseline & Foundational Controls Catalogue (No implementation code)                                                         |
| **Version**                                 | 1.0 - June 2026                                                                                                                                     |
| **Platform**                                | AWS ESC \| Partition: aws-eusc \| Region: eusc-de-east-1                                                                                            |
| **Classification**                          | Confidential - For Internal If Insurance Use Only                                                                                                   |
| **Companion Docs**                          | ESC SCP Design Catalogue (US-1542064), ESC KMS & Encryption Strategy (US-1542066), ESC Centralized Logging Strategy (US-1542069) - cross-referenced |
| **Frameworks Alignment (Design Reference)** | BSI C5:2020 \| GDPR Art.32 \| NIS2 Art.21 \| ISO 27001:2022 \| NIST SP 800-53 (informative)                                                         |
| **Status**                                  | Draft - Pending Stakeholder Review and Approval (WI-1543462)                                                                                        |

# Table of Contents 

[Introduction [3](#introduction)](#introduction)

[Purpose [3](#purpose)](#purpose)

[Scope [3](#scope)](#scope)

[1. Security Baseline Design Overview [4](#security-baseline-design-overview)](#security-baseline-design-overview)

[1.1 Work Package Completion Matrix [4](#work-package-completion-matrix)](#work-package-completion-matrix)

[2. Sovereignty, Security & Compliance Control Requirements (WI-1543459) [5](#sovereignty-security-compliance-control-requirements-wi-1543459)](#sovereignty-security-compliance-control-requirements-wi-1543459)

[2.1 ESC-Specific Baseline Facts [5](#esc-specific-baseline-facts)](#esc-specific-baseline-facts)

[2.2 Compliance Control Requirements by Driver [6](#compliance-control-requirements-by-driver)](#compliance-control-requirements-by-driver)

[3. Baseline Security Services (WI-1543456) [7](#baseline-security-services-wi-1543456)](#baseline-security-services-wi-1543456)

[3.1 Mandatory Services on Every Landing Zone Account [7](#mandatory-services-on-every-landing-zone-account)](#mandatory-services-on-every-landing-zone-account)

[3.2 Account Provisioning Checklist (Baseline Gate) [8](#section)](#section)

[4. Account Security Configuration Standards (WI-1543457) [9](#account-security-configuration-standards-wi-1543457)](#account-security-configuration-standards-wi-1543457)

[4.1 Identity & Access Baseline [9](#identity-access-baseline)](#identity-access-baseline)

[4.2 Network Baseline [9](#network-baseline)](#network-baseline)

[4.3 Storage & Data Baseline [10](#storage-data-baseline)](#storage-data-baseline)

[5. Security Monitoring & Audit Requirements (WI-1543458) [10](#security-monitoring-audit-requirements-wi-1543458)](#security-monitoring-audit-requirements-wi-1543458)

[5.1 Baseline Monitoring Requirements [10](#baseline-monitoring-requirements)](#baseline-monitoring-requirements)

[5.2 Audit Requirements [10](#audit-requirements)](#audit-requirements)

[6. Landing Zone Security Control Matrix (WI-1543460) [11](#landing-zone-security-control-matrix-wi-1543460)](#landing-zone-security-control-matrix-wi-1543460)

[7. Baseline Validation Matrix (WI-1543461) [12](#baseline-validation-matrix-wi-1543461)](#baseline-validation-matrix-wi-1543461)

[8. Stakeholder Review & Approval (WI-1543462) [13](#stakeholder-review-approval-wi-1543462)](#stakeholder-review-approval-wi-1543462)

[8.1 Review Process [13](#review-process)](#review-process)

[8.2 Key Review Points for Client [13](#key-review-points-for-client)](#key-review-points-for-client)

[8.3 Approval Sign-Off [14](#approval-sign-off)](#approval-sign-off)

# Introduction

This document defines the Security Baseline and Foundational Controls for the AWS Landing Zone implemented for If Insurance within the AWS European Sovereign Cloud (ESC). It establishes the prerequisite account-level security configuration, baseline security services, and foundational hardening standards that every account in the Landing Zone must satisfy - forming the foundation that the SCP guardrails (companion document, US-1542064) and centralized logging controls (companion document, US-1542069) are then layered on top of.

## Purpose

This document has been prepared by the Cloud Engineering team of Hexaware to provide If Insurance's Cloud Governance Board, Information Security, and Compliance functions with a complete and reviewable security baseline prior to implementation.

The key objectives of this document are to:

- Define the minimum security configuration every AWS account in the Landing Zone must have before it is considered production-ready, independent of any workload-specific SCPs layered on top

- Establish a single reference mapping each baseline control to business requirements and applicable regulatory or contractual obligations

- Serve as the formal basis for stakeholder review and design approval in alignment with If Insurance's cloud governance framework, prior to provisioning any account in the ESC Landing Zone

## Scope

This document is limited to the design phase of the security baseline for the ESC Landing Zone. It defines what foundational controls will be implemented and why, and does not include implementation-level details.

**In scope:**

- Sovereignty, security, and compliance control requirements applicable specifically to the ESC partition

- Security monitoring and audit requirements at the baseline service level (distinct from the detailed logging architecture in the companion Logging document)

- Baseline security services required on every Landing Zone account (GuardDuty, Config, Security Hub CSPM, IAM Identity Center)

- Account security configuration standards - MFA, password policy, root account hardening, default VPC handling

- The Landing Zone security control matrix mapping every baseline control to its owning service and validation method

**Out of Scope:**

- AWS CDK (TypeScript) implementation code and technical configurations

- Deployment scripts and step-by-step build instructions

- Preventive guardrail (SCP/RCP) design - covered in the companion SCP Design Catalogue (US-1542064)

- Encryption and key management strategy - covered in the companion KMS & Encryption Strategy (US-1542066)

- Centralized logging architecture and retention - covered in the companion Centralized Logging Strategy (US-1542069)

# 1. Security Baseline Design Overview

This section defines the complete security baseline and foundational controls catalogue for the AWS European Sovereign Cloud (ESC) Landing Zone at eusc-de-east-1. This is a design-phase deliverable that describes what will be implemented, not how.

Each baseline requirement is defined with its purpose, applicability, priority, framework mapping, and validation method. The AWS CDK (TypeScript) implementation details and deployment steps are explicitly out of scope and will be addressed during the implementation phase.

**Relationship to Companion Documents:** This document defines the foundational baseline that every account must meet. The companion SCP document then layers preventive guardrails on top of this baseline, and the companion Logging document defines the detailed log architecture built on the baseline security services established here (GuardDuty, Config, Security Hub CSPM).

## 1.1 Work Package Completion Matrix

| **Work Item** | **Type**       | **Title**                                                                           | **Addressed In**                                          | **Status**   |
|---------------|----------------|-------------------------------------------------------------------------------------|-----------------------------------------------------------|--------------|
| **1542065**   | **User Story** | Define Security Baseline and Foundational Controls for AWS EUSC LZ                  | Sections 2–7 (full baseline)                              | **Complete** |
| **1543459**   | **Task**       | Define sovereignty, security and compliance control requirements applicable to EUSC | Section 2 - Sovereignty & Compliance Control Requirements | **Complete** |
| **1543456**   | **Task**       | Define baseline security services required for Landing Zone accounts                | Section 3 - Baseline Security Services                    | **Complete** |
| **1543457**   | **Task**       | Define account security configuration standards                                     | Section 4 - Account Security Configuration Standards      | **Complete** |
| **1543458**   | **Task**       | Define security monitoring and audit requirements                                   | Section 5 - Security Monitoring & Audit Requirements      | **Complete** |
| **1543460**   | **Task**       | Create the Landing Zone security control matrix                                     | Section 6 - Security Control Matrix                       | **Complete** |
| **1543461**   | **Task**       | Validate the security baseline against governance requirements                      | Section 7 - Baseline Validation Matrix                    | **Complete** |
| **1543462**   | **Task**       | Conduct stakeholder review and obtain approval                                      | Section 8 - Stakeholder Review & Sign-off                 | **Pending**  |

# 2. Sovereignty, Security & Compliance Control Requirements (WI-1543459)

## 2.1 ESC-Specific Baseline Facts

The security baseline defined in this document is scoped to the aws-eusc partition at eusc-de-east-1 and accounts for ESC-specific service availability gaps that do not exist in commercial AWS. Several baseline services common in commercial AWS Landing Zones are either limited, delayed, or unavailable in ESC - this section documents those gaps explicitly so the baseline reflects what is achievable today.

| **Service / Capability**           | **ESC Status**                                                                                                    | **Baseline Implication**                                                                                                                                                                                           |
|------------------------------------|-------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| GuardDuty                          | **Available, but limited - no Organization-level management; missing some newer detection capabilities**          | Must be enabled individually in each account rather than centrally through delegated administration; the baseline includes a per-account enablement check.                                                         |
| AWS Config                         | **Available, but with gaps - some managed rules (e.g. certain DynamoDB encryption checks) are not yet supported** | Baseline relies on a custom Config rule set rather than 100% AWS-managed rules where gaps exist                                                                                                                    |
| Security Hub (core)                | **Targeted Q1 2027 - not yet available**                                                                          | AWS Security Hub CSPM (see below) serves as the current-state baseline capability; native AWS Security Hub finding aggregation is a planned future-state enhancement.                                              |
| Security Hub CSPM                  | **Available now**                                                                                                 | Included in the baseline as the current security posture management mechanism (see companion Logging doc, Section 2.1)                                                                                             |
| Amazon Inspector                   | **NOT available**                                                                                                 | Baseline relies on SSM Patch Manager as a compensating control for vulnerability and patch management (see Section 3.1)                                                                                            |
| IAM Identity Center                | **Available**                                                                                                     | Baseline mandates SSO via IAM Identity Center as the sole human access mechanism - no standing IAM users (see Section 4.1)                                                                                         |
| S3 Block Public Access             | **Available, but NOT enabled by default (unlike commercial AWS)**                                                 | Baseline mandates explicit account-level and bucket-level enablement at account creation - cannot be assumed                                                                                                       |
| Shield Advanced / Firewall Manager | **NOT available**                                                                                                 | Baseline relies on standard Shield (always-on, included) and per-account WAF configuration instead of centralized Firewall Manager                                                                                 |
| Availability Zones                 | **2 AZs currently in eusc-de-east-1 (vs. 3+ typical elsewhere)**                                                  | Baseline resilience standards are designed around the currently available 2-AZ architecture and are documented as a constraint to be re-evaluated if additional Availability Zones become available in the future. |

## 2.2 Compliance Control Requirements by Driver

| **Driver**                       | **Requirement**                                                                         | **Baseline Response**                                                                                                                         |
|----------------------------------|-----------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| **GDPR Art.32**                  | Appropriate technical and organisational security measures                              | MFA enforcement, encryption baseline (cross-ref KMS doc), account isolation, access logging (Section 4, 5)                                    |
| **NIS2 Art.21**                  | Risk management measures including access control and incident detection                | GuardDuty + Security Hub CSPM baseline enablement, account security configuration standards (Section 3, 4)                                    |
| **BSI C5:2020**                  | Identity and access management; cryptography; logging and monitoring control objectives | IAM Identity Center SSO mandate, baseline service enablement, security control matrix (Section 4, 6)                                          |
| **ISO 27001:2022 Annex A**       | Access control (A.9), cryptography (A.10), operations security (A.12)                   | Account configuration standards align to Annex A control objectives (Section 4)                                                               |
| **NIST SP 800-53 (informative)** | AC, IA, SI control families                                                             | Baseline controls align with relevant NIST SP 800-53 control families as an informative security reference - see Section 7 Validation Matrix. |

# 3. Baseline Security Services (WI-1543456)

## 3.1 Mandatory Services on Every Landing Zone Account

Every account provisioned in the ESC Landing Zone, regardless of OU placement, must have the following baseline security services enabled before any workload is deployed. These are distinct from and prerequisite to the SCP guardrails defined in the companion SCP document, which restrict what actions can be taken, these services instead provide visibility and detection.

| **Service**                       | **Purpose**                                                                                              | **Enablement**                                                                     | **Applies To**                       |
|-----------------------------------|----------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------|--------------------------------------|
| **Amazon GuardDuty**              | Threat detection - malicious activity, unusual API calls, compromised credentials                        | Per-account (no Org-level management in ESC)                                       | All accounts, all OUs, no exceptions |
| **AWS Config**                    | Configuration recording and compliance rule evaluation                                                   | Org-wide recorder with custom rule set (gap-filling for unsupported managed rules) | All accounts, all OUs, no exceptions |
| **AWS Security Hub CSPM**         | Cloud security posture management - misconfiguration detection across services                           | Per-account, current-state equivalent to full Security Hub                         | All accounts, all OUs, no exceptions |
| **AWS CloudTrail**                | Management and data event logging (detailed in companion Logging doc)                                    | Organization trail, configured once                                                | All accounts, all OUs, no exceptions |
| **IAM Identity Center**           | Centralized SSO - the sole mechanism for human access                                                    | Org-wide, configured once at Management account                                    | All accounts, all OUs, no exceptions |
| **AWS Systems Manager (SSM)**     | Patch management compensating control (Inspector not available); also enables break-glass session access | Per-account, Patch Manager baseline configured                                     | All accounts, all OUs, no exceptions |
| **AWS KMS (account default key)** | Baseline encryption capability (full strategy in companion KMS doc)                                      | Per-account, customer-managed key created at provisioning                          | All accounts, all OUs, no exceptions |

## 

## 3.2 Account Provisioning Checklist (Baseline Gate)

No account is considered Landing Zone-ready, and no workload may be deployed into it, until every item below is confirmed. This functions as the gate between account creation and account use.

| **\#** | **Checklist Item**                                                                                            | **Validation Method**                                           |
|--------|---------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| **1**  | Account created within the correct OU per the companion SCP document's OU hierarchy (Section 2.2)             | AWS Organizations console / CDK pipeline confirmation           |
| **2**  | GuardDuty enabled and actively detecting (per-account, since Org-level management is unavailable)             | AWS Config rule: GuardDuty-enabled-centralized (custom variant) |
| **3**  | AWS Config recorder enabled and delivering to the centralized aggregator (companion SCP doc, SCP-ESC-SEC-003) | Config recorder status check                                    |
| **4**  | Security Hub CSPM enabled and reporting findings                                                              | Security Hub CSPM dashboard confirmation                        |
| **5**  | Account joined to the Organization CloudTrail (no separate trail created)                                     | CloudTrail console / Organizations trail member list            |
| **6**  | IAM Identity Center permission sets assigned; no standing IAM users created (enforced by SCP-ESC-WL-003)      | IAM Identity Center assignment review                           |
| **7**  | Root user MFA enabled and root access keys confirmed absent (Section 4.1)                                     | IAM credential report                                           |
| **8**  | S3 Block Public Access enabled at the account level (NOT default in ESC - must be explicit)                   | S3 account public access block setting                          |
| **9**  | Default VPC removed or explicitly justified and documented if retained                                        | VPC inventory review                                            |
| **10** | Account-default KMS CMK created and tagged per the companion KMS document's naming convention                 | KMS key inventory check                                         |
| **11** | SSM Patch Manager baseline configured (Inspector compensating control)                                        | SSM compliance dashboard                                        |
| **12** | Mandatory tags applied to the account itself (Owner, Environment, CostCentre, DataClassification)             | AWS Organizations account tag review                            |

# 4. Account Security Configuration Standards (WI-1543457)

## 4.1 Identity & Access Baseline

| **Standard**                       | **Requirement**                                                                                                                                                                                                                                            |
|------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Root user                          | MFA mandatory on every account's root user (hardware or virtual MFA device). Root access keys must not exist - if found during the provisioning checklist, they are deleted immediately. Root login is reserved for documented break-glass scenarios only. |
| Human access                       | IAM Identity Center (SSO) is the sole mechanism for human access to any account. No IAM users are created for individuals and this is enforced at the policy level by SCP-ESC-WL-003 in the companion SCP document.                                        |
| MFA for human users                | MFA mandatory for every IAM Identity Center user at sign-in. No exceptions, including for the Cloud Platform Team or break-glass roles.                                                                                                                    |
| Service accounts / roles           | Machine-to-machine access uses IAM roles with short-lived credentials (Assume Role / STS), never long-lived access keys. The CDK pipeline role is the only standing service identity with elevated privileges.                                             |
| Password policy (where applicable) | For any identity provider-side password policy (outside AWS IAM, since IAM users are not used): minimum 14 characters, complexity required, no password reuse within 12 generations, 90-day rotation for non-MFA-protected service accounts only.          |
| Break-glass access                 | A documented, time-boxed emergency access role exists per account, requiring MFA and generating an automatic Security Hub CSPM finding + CloudTrail entry on use. Follows the same exception process as the companion SCP document, Section 7.             |

## 4.2 Network Baseline

| **Standard**    | **Requirement**                                                                                                                                                                                                                                                   |
|-----------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Default VPC     | The default VPC created automatically in every new account is removed unless an explicit, documented business justification is recorded. Workload VPCs are provisioned deliberately via the CDK pipeline, centralized to the Network account per SCP-ESC-INF-001. |
| Security groups | No security group permits unrestricted inbound access (0.0.0.0/0) on any port other than 443 for explicitly justified internet-facing services. Default security groups are not used for workload resources.                                                      |
| Public subnets  | Workload resources are not placed directly in public subnets. Internet-facing access flows through an ALB in a public subnet, with workload resources in private subnets consistent with the Online OU pattern in the companion SCP document.                     |
| VPC Flow Logs   | Enabled on every VPC at creation detailed requirements are defined in the companion Logging document, Section 3.1.                                                                                                                                                |

## 4.3 Storage & Data Baseline

| **Standard**           | **Requirement**                                                                                                                                                                                                         |
|------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| S3 Block Public Access | Enabled explicitly at the account level for every account. This is NOT the ESC default (unlike commercial AWS, where it is enabled by default) and must be confirmed during account provisioning (Section 3.2, Item 8). |
| Encryption at rest     | Full requirements defined in the companion KMS & Encryption Strategy document; this baseline confirms a customer-managed KMS key exists on every account at provisioning.                                               |
| EBS default encryption | Enabled at the account level so every new EBS volume is encrypted by default, independent of the SCP-level enforcement in the companion SCP document.                                                                   |

# 5. Security Monitoring & Audit Requirements (WI-1543458)

This section defines baseline-level monitoring requirements. Detailed log architecture, retention, and immutability are covered in the companion Centralized Logging Strategy document (US-1542069). This section focuses specifically on what monitoring must exist as part of the account baseline itself.

## 5.1 Baseline Monitoring Requirements

| **Requirement**                      | **Description**                                                                                                           | **Reference**                      |
|--------------------------------------|---------------------------------------------------------------------------------------------------------------------------|------------------------------------|
| **Threat detection active**          | GuardDuty enabled and actively generating findings on every account from the moment of provisioning                       | Section 3.1                        |
| **Configuration compliance tracked** | AWS Config recording every supported resource type, evaluated against the custom rule set                                 | Section 3.1                        |
| **Posture findings visible**         | Security Hub CSPM findings reviewed as part of the account's ongoing operational cadence                                  | Section 3.1                        |
| **All API activity logged**          | Account is a member of the Organization CloudTrail - no separate or missing trail                                         | Companion Logging doc, Section 2.2 |
| **Alerts reach the security team**   | High-severity GuardDuty/Security Hub CSPM findings forwarded to Microsoft Sentinel as alerts only (raw data stays in ESC) | Companion Logging doc, Section 2.4 |
| **Patch compliance tracked**         | SSM Patch Manager compliance status reviewed regularly as the Inspector compensating control                              | Section 3.1                        |

## 5.2 Audit Requirements

- Every baseline control in this document is independently verifiable, no control relies solely on self-attestation by the account owner

- The Account Provisioning Checklist (Section 3.2) is captured and retained as evidence for each account, consistent with the audit log retention standards in the companion Logging document

- **Quarterly baseline drift review:** Cloud Platform Team confirms every existing account still satisfies the 12-point checklist, flagging any account that has drifted (e.g. GuardDuty disabled, Config recorder stopped)

- Any baseline control gap discovered outside the quarterly review (e.g. via a Security Hub CSPM finding) is treated as a P2 incident and remediated within 5 business days

# 6. Landing Zone Security Control Matrix (WI-1543460)

This matrix consolidates every baseline control defined in this document into a single reference, mapping each to its priority, owning service, and the SCP (if any) that enforces it at the policy level.

| **Control**                                   | **Priority** | **Owning Service**    | **Enforced By (if applicable)**                                              |
|-----------------------------------------------|--------------|-----------------------|------------------------------------------------------------------------------|
| **Root MFA enforced**                         | **CRITICAL** | IAM                   | SCP-ESC-ROOT-002 (companion SCP doc)                                         |
| **No root access keys**                       | **CRITICAL** | IAM                   | SCP-ESC-ROOT-002 (companion SCP doc)                                         |
| **No standing IAM users**                     | **HIGH**     | IAM Identity Center   | SCP-ESC-WL-003 (companion SCP doc)                                           |
| **MFA for all human SSO users**               | **CRITICAL** | IAM Identity Center   | IdP-level policy (outside SCP scope)                                         |
| **GuardDuty active per account**              | **HIGH**     | GuardDuty             | SCP-ESC-SEC-001 (companion SCP doc - protects from disablement)              |
| **Config recorder active**                    | **HIGH**     | AWS Config            | SCP-ESC-SEC-001 (companion SCP doc)                                          |
| **Security Hub CSPM active**                  | **HIGH**     | Security Hub CSPM     | SCP-ESC-SEC-001 (companion SCP doc)                                          |
| **Organization CloudTrail membership**        | **CRITICAL** | CloudTrail            | SCP-ESC-SEC-001 (companion SCP doc)                                          |
| **S3 Block Public Access enabled**            | **CRITICAL** | S3 (account setting)  | Not currently SCP-enforced - baseline checklist item only                    |
| **Default VPC removed/justified**             | **MEDIUM**   | VPC                   | SCP-ESC-INF-001 (companion SCP doc - centralises VPC creation going forward) |
| **EBS default encryption enabled**            | **HIGH**     | EBS (account setting) | SCP-ESC-WL-001 (companion SCP doc - denies unencrypted volumes)              |
| **Account-default KMS CMK exists**            | **HIGH**     | KMS                   | Companion KMS document, Section 2                                            |
| **SSM Patch Manager baseline configured**     | **MEDIUM**   | SSM                   | Not SCP-enforced - baseline checklist item only                              |
| **No public security group rules beyond 443** | **HIGH**     | EC2 / VPC             | Not currently SCP-enforced - baseline checklist item only                    |
| **Mandatory account tags applied**            | **MEDIUM**   | AWS Organizations     | SCP-ESC-WL-004 (companion SCP doc - enforces at resource level)              |

# 7. Baseline Validation Matrix (WI-1543461)

This matrix validates that the security baseline addresses every foundational governance requirement. This is a design-phase validation, actual test execution against eusc-de-east-1 endpoints will be performed during the implementation phase.

| **Governance Requirement**                           | **Addressed By**                                     | **Framework Reference**                  | **Design Coverage** |
|------------------------------------------------------|------------------------------------------------------|------------------------------------------|---------------------|
| Root user cannot be used for standing access         | Section 4.1 - Root user standard                     | **NIST SP 800-53 AC-2**                  | **Complete**        |
| All human access requires MFA                        | Section 4.1 - MFA for all human SSO users            | **GDPR Art.32 / NIST SP 800-53 IA-5**    | **Complete**        |
| No long-lived static credentials                     | Section 4.1 - No standing IAM users                  | **NIST SP 800-53 IA-5**                  | **Complete**        |
| Threat detection active on every account             | Section 3.1 - GuardDuty mandatory                    | **NIS2 Art.21 / NIST SP 800-3 SI-4**     | **Complete**        |
| Configuration compliance continuously assessed       | Section 3.1 - AWS Config mandatory                   | **BSI C5 / NIST SP 800-53 CM-2**         | **Complete**        |
| Security posture visible across the estate           | Section 3.1 - Security Hub CSPM mandatory            | **NIS2 Art.21 / NIST SP 800-53 RA-5**    | **Complete**        |
| No account provisioned without baseline verification | Section 3.2 - Account Provisioning Checklist         | **BSI C5 / ISO 27001 A.5**               | **Complete**        |
| Public data exposure prevented by default            | Section 4.3 - S3 Block Public Access                 | **GDPR Art.32 / NIST SP 800-53 AC-3**    | **Complete**        |
| Network perimeter centrally controlled               | Section 4.2 - Default VPC removal, centralization    | **NIS2 Art.21(e) / NIST SP 800-53 SC-7** | **Complete**        |
| Vulnerability/patch management compensating control  | Section 3.1, 5.1 - SSM Patch Manager (Inspector gap) | **NIST SP 800-53 RA-5**                  | **Complete**        |
| Baseline drift detected and remediated               | Section 5.2 - Quarterly review + P2 incident process | **BSI C5 / ISO 27001 A.5**               | **Complete**        |

# 8. Stakeholder Review & Approval (WI-1543462)

## 8.1 Review Process

- This document is distributed to all stakeholders for a 5-business-day review window, consistent with the process used for the companion SCP, KMS, and Logging documents.

- A review meeting is held on Day 6 to resolve open comments before sign-off.

- Any unresolved comment from the Security, Compliance, or Data Protection Officer stakeholder blocks sign-off.

## 8.2 Key Review Points for Client

| **Review Point**                             | **Design Decision**                                                                                                                                                                                                                                                                                                                                                 |
|----------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Scope of this document                       | Design phase only — defines the mandatory account-level security baseline. CDK code and deployment steps are part of the implementation phase. This is the prerequisite foundation for the companion SCP, KMS, and Logging documents, not a replacement for any of them.                                                                                            |
| Three known ESC service gaps                 | Amazon Inspector is not available (SSM Patch Manager compensating control); native AWS Security Hub finding-aggregation is targeted for Q1 2027 (AWS Security Hub CSPM is the current-state baseline capability); Shield Advanced and Firewall Manager are not available (Standard AWS Shield protections and per-account AWS WAF configurations are used instead). |
| S3 Block Public Access is NOT default in ESC | Unlike commercial AWS, this setting must be explicitly enabled for each account. This requirement is captured as Checklist Item 8 in Section 3.2 to ensure it is consistently verified during account provisioning.                                                                                                                                                 |
| GuardDuty has no Org-level management in ESC | GuardDuty must be enabled individually for each account rather than centrally through delegated administration. The Account Provisioning Checklist exists specifically to ensure this requirement is not missed during account provisioning.                                                                                                                        |
| IAM Identity Center assumed available        | This baseline assumes IAM Identity Center is available and used as the sole SSO mechanism, consistent with the companion SCP and KMS documents' assumptions.                                                                                                                                                                                                        |
| Three controls not yet SCP-enforced          | S3 Block Public Access, SSM Patch Manager baseline, and security group hygiene currently rely on the provisioning checklist and quarterly review rather than policy-level enforcement - flagged in Section 6 as candidates for future SCP coverage.                                                                                                                 |
| Single-region, 2-AZ constraint               | eusc-de-east-1 currently provides 2 Availability Zones (compared to 3 or more in many commercial AWS Regions). Baseline resilience standards are designed around the currently available 2-AZ architecture and will be re-evaluated if additional Availability Zones become available in the future.                                                                |

## 

## 8.3 Approval Sign-Off

| **Role**                     | **Name** | **Date** | **Signature** |
|------------------------------|----------|----------|---------------|
| **Cloud Platform Architect** |          |          |               |
| **CISO / Security Lead**     |          |          |               |
| **Compliance Officer**       |          |          |               |
