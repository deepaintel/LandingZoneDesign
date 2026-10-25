**AWS European Sovereign Cloud**

**KMS & Encryption Strategy Design Catalogue**

*Landing Zone Data Protection and Compliance - Design Phase Deliverable*

*Region: eusc-de-east-1 \| Partition: aws-eusc \| Brandenburg, Germany*

| **Document ID**    | ESC-KMS-DESIGN-v1.1                                                                                                       |
|--------------------|---------------------------------------------------------------------------------------------------------------------------|
| **Phase**          | Design Phase – KMS & Encryption Catalogue (No implementation code)                                                        |
| **Version**        | 1.0 - June 2026                                                                                                           |
| **Platform**       | AWS ESC \| Partition: aws-eusc \| Region: eusc-de-east-1                                                                  |
| **Implementation** | AWS CDK (TypeScript) for KMS key resources (CMKs, key policies, grants, aliases) - to be executed in implementation phase |
| **Classification** | Confidential - For Internal IF Insurance Use Only                                                                         |
| **Companion Doc**  | ESC SCP Design Catalogue (US-1542064) — SCP-ESC-ENC-001/002 cross-referenced                                              |
| **Frameworks**     | BSI C5:2020 \| GDPR Art.32 \| NIS2 Art.21 \| ISO 27001:2022 \| NIST 800-53                                                |
| **Status**         | Draft - Pending Stakeholder Review and Approval (WI-1543493)                                                              |

# Table of Contents

[Introduction [3](#introduction)](#introduction)

[Purpose [3](#purpose)](#purpose)

[Scope [3](#scope)](#scope)

[1. KMS Strategy Design Overview [4](#kms-strategy-design-overview)](#kms-strategy-design-overview)

[1.1 Work Package Completion Matrix [4](#work-package-completion-matrix)](#work-package-completion-matrix)

[2. KMS Architecture & Key Ownership Model (WI-1543463) [5](#kms-architecture-key-ownership-model-wi-1543463)](#kms-architecture-key-ownership-model-wi-1543463)

[2.1 ESC-Specific KMS Facts [5](#esc-specific-kms-facts)](#esc-specific-kms-facts)

[2.2 Key Ownership Model [5](#key-ownership-model)](#key-ownership-model)

[2.3 KMS Architecture (Logical Layers) [6](#kms-architecture-logical-layers)](#kms-architecture-logical-layers)

[3. Customer-Managed Key (CMK) Usage Standards (WI-1543464) [7](#customer-managed-key-cmk-usage-standards-wi-1543464)](#customer-managed-key-cmk-usage-standards-wi-1543464)

[3.1 Mandatory CMK Usage by Data Classification [7](#mandatory-cmk-usage-by-data-classification)](#mandatory-cmk-usage-by-data-classification)

[3.2 CMK Standards by AWS Service [7](#cmk-standards-by-aws-service)](#cmk-standards-by-aws-service)

[3.3 Encryption in Transit Standards [8](#encryption-in-transit-standards)](#encryption-in-transit-standards)

[4. Key Hierarchy & Key Segregation Requirements (WI-1543465) [9](#key-hierarchy-key-segregation-requirements-wi-1543465)](#key-hierarchy-key-segregation-requirements-wi-1543465)

[4.1 Segregation Principles [9](#segregation-principles)](#segregation-principles)

[4.2 Three-Tier Key Hierarchy [9](#three-tier-key-hierarchy)](#three-tier-key-hierarchy)

[4.3 Segregation Mapping to OU Structure [9](#segregation-mapping-to-ou-structure)](#segregation-mapping-to-ou-structure)

[5. Key Rotation & Lifecycle Management Standards (WI-1543466) [11](#key-rotation-lifecycle-management-standards-wi-1543466)](#key-rotation-lifecycle-management-standards-wi-1543466)

[5.1 Rotation Standards [11](#rotation-standards)](#rotation-standards)

[5.2 Key Lifecycle States [11](#key-lifecycle-states)](#key-lifecycle-states)

[5.3 Pre-Deletion Checklist (Mandatory) [12](#pre-deletion-checklist-mandatory)](#pre-deletion-checklist-mandatory)

[6. Cross-Account Key Access Requirements (WI-1543467) [13](#cross-account-key-access-requirements-wi-1543467)](#cross-account-key-access-requirements-wi-1543467)

[6.1 Default Posture: Deny Cross-Account Access [13](#default-posture-deny-cross-account-access)](#default-posture-deny-cross-account-access)

[6.2 Approved Cross-Account Access Patterns [13](#approved-cross-account-access-patterns)](#approved-cross-account-access-patterns)

[6.3 Cross-Account Access - What Is Never Permitted [14](#cross-account-access---what-is-never-permitted)](#cross-account-access---what-is-never-permitted)

[7. Encryption Governance & Audit Requirements (WI-1543468) [15](#encryption-governance-audit-requirements-wi-1543468)](#encryption-governance-audit-requirements-wi-1543468)

[7.1 Audit Logging Requirements [15](#audit-logging-requirements)](#audit-logging-requirements)

[7.2 Governance Roles & Responsibilities [15](#governance-roles-responsibilities)](#governance-roles-responsibilities)

[7.3 Relationship to SCP Enforcement [16](#relationship-to-scp-enforcement)](#relationship-to-scp-enforcement)

[8. Encryption Strategy Validation Against Compliance Requirements (WI-1543469) [17](#encryption-strategy-validation-against-compliance-requirements-wi-1543469)](#encryption-strategy-validation-against-compliance-requirements-wi-1543469)

[9. Stakeholder Review & Approval (WI-1543493) [18](#stakeholder-review-approval-wi-1543493)](#stakeholder-review-approval-wi-1543493)

[9.1 Review Process [18](#review-process)](#review-process)

[9.2 Key Review Points for Client [18](#key-review-points-for-client)](#key-review-points-for-client)

[9.3 Approval Sign-Off (WI-1543493) [18](#approval-sign-off-wi-1543493)](#approval-sign-off-wi-1543493)

# Introduction

This document outlines the KMS (Key Management Service) and Encryption Strategy designed for the AWS Landing Zone implemented for If Insurance within the AWS European Sovereign Cloud (ESC).

It provides a comprehensive view of the key architecture, ownership model, rotation standards, cross-account access governance, and audit requirements designed to protect customer data, policyholder records, and underwriting systems hosted in the ESC Landing Zone.

## Purpose

This document has been prepared by the Cloud Platform Engineering team to provide If Insurance's Cloud Governance Board, Information Security, and Compliance functions with a complete and reviewable encryption strategy prior to implementation.

The key objectives of this document are to:

Provide stakeholders with full visibility of the encryption architecture and key management controls that safeguard customer data, policyholder records, and underwriting systems within the ESC Landing Zone

Establish a single reference mapping each encryption control to business requirements and applicable regulatory or contractual obligations, supporting audit and assurance processes

Serve as the formal basis for stakeholder review and design approval in alignment with If Insurance's cloud governance framework, prior to implementation of any KMS key or encryption control in a live AWS environment

## Scope

This document is limited to the design phase of the KMS and Encryption Strategy for the ESC Landing Zone. It defines what encryption architecture, and key governance standards will be implemented and why, and does not include implementation-level details.

**In scope:**

The KMS architecture and key ownership model across the Landing Zone, including the three-tier key hierarchy

Customer-managed key (CMK) usage standards mapped to data classification and AWS service

Key segregation requirements aligned to the OU and account structure

Key rotation and lifecycle management standards, including the mandatory pre-deletion checklist

Cross-account key access requirements and approval governance

Encryption governance and audit requirements, including the mapping to enforcing SCPs

A compliance validation matrix demonstrating alignment with GDPR, NIS2, BSI C5, ISO 27001, and NIST 800-53

**Out of Scope:**

AWS CDK (TypeScript) implementation code and technical configurations for key creation

Deployment scripts and step-by-step build instructions

The companion SCP and RCP Design Catalogue (US-1542064), which is delivered separately and cross-referenced where relevant

# 1. KMS Strategy Design Overview

This document defines the complete KMS (Key Management Service) and Encryption Strategy for the AWS European Sovereign Cloud (ESC) Landing Zone at eusc-de-east-1. It follows the same design-phase approach used for the SCP Strategy document (US-1542064): it describes WHAT will be implemented - key architecture, ownership model, rotation standards, access governance - not HOW it will be coded. CDK implementation details belong to the implementation phase.

**Relationship to SCP Strategy:** This KMS strategy and the SCP strategy (US-1542064) are tightly coupled. The preventive guardrails SCP-ESC-ENC-001 (KMS CMK lifecycle protection) and SCP-ESC-ENC-002 (deny unencrypted services) enforce the standards defined in this document at the policy level. This document defines the STANDARD, the SCPs enforce it.

## 1.1 Work Package Completion Matrix

| **Work Item** | **Type**       | **Title**                                                                          | **Addressed In**                          | **Status**   |
|---------------|----------------|------------------------------------------------------------------------------------|-------------------------------------------|--------------|
| **1542066**   | **User Story** | Define KMS and Encryption Strategy for Landing Zone Data Protection and Compliance | Sections 2-8 (full catalogue)             | **Complete** |
| **1543463**   | **Task**       | Design the Landing Zone KMS architecture and key ownership model                   | Section 2 - KMS Architecture              | **Complete** |
| **1543464**   | **Task**       | Define customer-managed key usage standards across Landing Zone services           | Section 3 - CMK Usage Standards           | **Complete** |
| **1543465**   | **Task**       | Define key hierarchy and key segregation requirements                              | Section 4 - Key Hierarchy & Segregation   | **Complete** |
| **1543466**   | **Task**       | Define key rotation and lifecycle management standards                             | Section 5 - Rotation & Lifecycle          | **Complete** |
| **1543467**   | **Task**       | Define cross-account key access requirements                                       | Section 6 - Cross-Account Key Access      | **Complete** |
| **1543468**   | **Task**       | Define encryption governance and audit requirements                                | Section 7 - Governance & Audit            | **Complete** |
| **1543469**   | **Task**       | Validate the encryption strategy against compliance requirements                   | Section 8 - Compliance Validation Matrix  | **Complete** |
| **1543493**   | **Task**       | Conduct stakeholder review and obtain approval                                     | Section 9 - Stakeholder Review & Sign-off | **Pending**  |

# 2. KMS Architecture & Key Ownership Model (WI-1543463)

## 2.1 ESC-Specific KMS Facts

**IMPORTANT:** AWS KMS in the European Sovereign Cloud operates entirely within the aws-eusc partition. CMKs created in eusc-de-east-1 cannot be shared with, replicated to, or used by any commercial AWS account or region. Key material physically and logically never leaves the ESC sovereign boundary.

| **Attribute**            | **Value**                               | **Design Implication**                                                                                                                                                                                          |
|--------------------------|-----------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| KMS Service              | **Available in eusc-de-east-1**         | Fully native KMS - no degraded functionality vs commercial AWS                                                                                                                                                  |
| Key ARN prefix           | **arn:aws-eusc:kms:eusc-de-east-1:...** | All key policies, grants, and SCP conditions must use this prefix                                                                                                                                               |
| Multi-Region Keys        | **NOT supported across partitions**     | AWS KMS Multi-Region Keys are supported only within the aws-eusc partition. As of this design version, eusc-de-east-1 is the primary sovereign region in scope and no cross-partition replication is permitted. |
| AWS managed keys         | **Available (aws/s3, aws/ebs, etc.)**   | Permitted for non-regulated data only - CMK mandatory for in-scope data (Section 3)                                                                                                                             |
| Key rotation             | **Automatic annual rotation supported** | Enabled by default standard; disablement denied by SCP-ESC-ENC-001                                                                                                                                              |
| CloudHSM                 | **Available in eusc-de-east-1**         | Available for workloads requiring dedicated HSM / BYOK custom key store                                                                                                                                         |
| External key store (XKS) | **Available**                           | Supports customer-controlled external key managers for highest sovereignty tier                                                                                                                                 |

## 2.2 Key Ownership Model

The KMS architecture follows a federated ownership model: each account type owns and manages the CMKs for the data it is accountable for, while the Security OU centrally audits all key usage across the organisation. This avoids both extremes - a single mega-key creating a blast-radius risk, and ungoverned per-developer keys creating audit blind spots.

Key administration permissions shall be separated from key usage permissions. Roles responsible for creating, managing, or modifying KMS key policies must not routinely possess permissions to decrypt protected business data using the same keys. This separation supports least-privilege access and reduces the risk of unauthorized data access.

| **Account / OU**                           | **Key Owner Role**                            | **Key Types Owned**                                                                     | **Audit Responsibility**                                            |
|--------------------------------------------|-----------------------------------------------|-----------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| **Security OU - Audit account**            | Security/Compliance Team                      | Org-wide audit key (for Log Archive WORM bucket)                                        | Self - independent of Platform team                                 |
| **Security OU - Log Archive acct**         | Security/Compliance Team                      | Log encryption CMK (CloudTrail, Config delivery)                                        | Audit account (cross-account review)                                |
| **Infrastructure OU - Shared Svcs**        | Cloud Platform Team                           | Certificate private key encryption CMK                                                  | Security OU Audit account                                           |
| **Infrastructure OU - Network**            | Cloud Platform Team                           | VPN/Direct Connect credential encryption CMK                                            | Security OU Audit account                                           |
| **Workloads - per account**                | Application/Workload Team                     | Application data CMK (S3, RDS, DynamoDB, EBS)                                           | Security OU Audit account (quarterly)                               |
| **Prod OU (L3, under Hybrid/Online/Corp)** | Application/Workload Team + Platform sign-off | Production data CMK (stricter policy)                                                   | Security OU Audit account (monthly)                                 |
| **Sandbox OU**                             | Individual developers                         | AWS managed keys by default; temporary CMKs permitted for testing with defined lifespan | Not required;temporary CMKs governed by automated lifecyle controls |

## 2.3 KMS Architecture (Logical Layers)

Conceptually, the ESC KMS architecture has three layers: (1) a central Audit account holding the org-wide audit and break-glass keys, (2) per-account CMKs owned by each workload or shared-service account, and (3) AWS managed keys for non-regulated, low-sensitivity data only. Cross-account key grants flow from Layer 2 keys to specific consuming roles - never broad account-level access (see Section 6).

- **Layer 1 - Central Audit Keys:** held in the Security OU Audit account. Used exclusively for org-wide audit log encryption and break-glass emergency access wrapping. Access restricted to the CISO role and the automated audit pipeline role.

- **Layer 2 - Per-Account Workload CMKs:** one or more CMKs per workload account, scoped to a specific service or data classification (see Section 4 - Key Hierarchy). Owned and rotated by the workload team, audited centrally.

- **Layer 3 - AWS Managed Keys**: permitted only for Sandbox OU and non-regulated Internal-classification data in the Non-Prod OU. Never permitted for Confidential, Restricted, or Secret classification data (see Section 3).

# 3. Customer-Managed Key (CMK) Usage Standards (WI-1543464)

## 3.1 Mandatory CMK Usage by Data Classification

CMK usage is mandatory based on the Data Classification tag enforced by **SCP-ESC-WL-004** (see companion SCP document). The table below defines exactly when a CMK is required versus when an AWS managed key is acceptable.

| **Data Classification** | **Key Requirement**                                                                                                                                    | **Applies To**                                                            | **Rationale**                                                                                            |
|-------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| **Public**              | **AWS managed key acceptable**                                                                                                                         | Static assets, public documentation                                       | No confidentiality requirement - managed key is sufficient and reduces operational overhead              |
| **Internal**            | **CMK recommended, AWS managed key tolerated in Non-Prod**                                                                                             | Internal tooling data, non-customer business data                         | Some sensitivity but not regulated - CMK preferred for audit trail granularity                           |
| **Confidential**        | **CMK mandatory**                                                                                                                                      | Customer business data, internal financial data                           | GDPR-adjacent or commercially sensitive - requires customer-controlled key with full audit trail         |
| **Restricted**          | **CMK mandatory + key policy restricted to specific roles**                                                                                            | Personal data (GDPR Art.4), health data, financial records                | Regulated personal data - requires fine-grained access control and complete CloudTrail key usage logging |
| **Secret**              | **CMK mandatory + dedicated key (1:1 with data set). CloudHSM or XKS required only where regulatory, contractual, or sovereignty requirements apply.** | Government-classified, national security adjacent, cryptographic material | Highest sensitivity - requires dedicated key, hardware-backed key store, and minimal blast radius        |

## 3.2 CMK Standards by AWS Service

| **Service**                | **Encryption Standard**                                                                                                                      | **Enforced By**                              | **Notes**                                                                                        |
|----------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------|--------------------------------------------------------------------------------------------------|
| **Amazon S3**              | SSE-KMS with CMK; bucket key enabled to reduce KMS request cost                                                                              | **SCP-ESC-WL-001**                           | Bucket Keys reduce KMS API calls by up to 99% - recommended for high-throughput buckets          |
| **Amazon EBS**             | CMK encryption on all volumes including snapshots                                                                                            | **SCP-ESC-WL-001**                           | Default EBS encryption enabled at the account level via account settings                         |
| **Amazon RDS**             | CMK encryption (StorageEncrypted=true); cannot be added after creation                                                                       | **SCP-ESC-WL-001**                           | Encryption MUST be enabled at instance creation - migration required for legacy unencrypted DBs  |
| **Amazon DynamoDB**        | CMK via SSESpecification (SSEType=KMS)                                                                                                       | **SCP-ESC-ENC-002**                          | DynamoDB CMK encryption has a small latency overhead - acceptable trade-off for Restricted+ data |
| **Amazon ElastiCache**     | CMK encryption at rest and TLS in transit                                                                                                    | **SCP-ESC-ENC-002**                          | Required for all Restricted and Secret classification workloads                                  |
| **Amazon MSK**             | CMK at-rest + TLS in-transit (no PLAINTEXT)                                                                                                  | **SCP-ESC-ENC-002**                          | Apply CMK at cluster creation - cannot be changed without cluster recreation                     |
| **Amazon SQS / SNS**       | CMK via KmsMasterKeyId attribute                                                                                                             | **SCP-ESC-ENC-002**                          | Use a shared messaging CMK per account rather than per-queue to limit key sprawl                 |
| **Amazon EFS**             | CMK at file-system creation                                                                                                                  | **SCP-ESC-ENC-002**                          | Cannot be changed after creation - plan file system architecture accordingly                     |
| **AWS Secrets Manager**    | CMK for secret encryption (not the default aws/secretsmanager key for Restricted+)                                                           | **SCP-ESC-WL-004 (tagging) + this standard** | Default managed key acceptable for Internal classification secrets only                          |
| **AWS Backup**             | Backup vaults SHALL use CMK encryption. Backup copies across accounts must retain encryption using approved CMKs in the destination account. | **SCP-ESC-ENC-002**                          | Ensures backup data is protected independently from source workloads.                            |
| **Amazon CloudWatch Logs** | CMK for log group encryption                                                                                                                 | **SCP-ESC-SEC-002 (companion)**              | Required for any log group capturing Restricted or Secret classification application logs        |

## 3.3 Encryption in Transit Standards

All data classified as Confidential, Restricted, or Secret SHALL be encrypted in transit using TLS 1.2 or higher.

Examples include:

- HTTPS for web applications and APIs

- TLS for database connectivity

- TLS for inter-service communication

- VPN/IPSec or Direct Connect MACsec where applicable

Use of unencrypted protocols (HTTP, Telnet, FTP, plaintext database connections) is prohibited unless approved through the security exception process.

# 4. Key Hierarchy & Key Segregation Requirements (WI-1543465)

## 4.1 Segregation Principles

- **No key reuse across environments:** Prod and Non-Prod data must never be encrypted with the same CMK, even within the same Workloads sub-OU (Hybrid, Online, or Corp). This prevents a Non-Prod compromise from exposing Prod data.

- **No key reuse across OUs:** A CMK created in the Online OU must not be used to encrypt data in the Corp OU or Hybrid OU, even if both are Prod. Each sub-OU's workloads maintain independent key material.

- **No key reuse across data classifications:** A single CMK must not protect both Confidential and Secret classification data. Secret-classification data always uses a dedicated 1:1 key (see Section 3.1).

- **Service-level segregation within an account:** Where justified by security, regulatory, or operational requirements, separate CMKs may be used for individual services (for example, S3, RDS, and EBS). Otherwise, a shared CMK within the same account and environment may be used to reduce key management complexity. The level of segregation should balance blast-radius reduction against the operational overhead of managing additional keys, grants, and policies.

## 4.2 Three-Tier Key Hierarchy

| **Tier**   | **Key Type**              | **Scope**                                                                                      | **Example Naming Convention**                                  |
|------------|---------------------------|------------------------------------------------------------------------------------------------|----------------------------------------------------------------|
| **Tier 1** | **Org Audit Key**         | Security OU Audit account only. Encrypts org-wide audit artifacts and break-glass credentials. | esc-audit-org-key                                              |
| **Tier 2** | **Account Service Keys**  | One per service per account (S3, RDS, EBS, DynamoDB etc.) within a Workload account.           | esc-{account-alias}-{service}-key e.g. esc-onlineprod01-s3-key |
| **Tier 3** | **Dedicated Secret Keys** | 1:1 with a specific Secret-classification data set. Never reused for any other data.           | esc-{account-alias}-secret-{dataset}-key                       |

## 4.3 Segregation Mapping to OU Structure

This mapping aligns directly with the OU structure defined in the companion SCP document (Section 2, US-1542064).

| **OU**                                  | **Key Segregation Rule**                                               | **Design Rationale**                                                                          |
|-----------------------------------------|------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| **Security OU**                         | Tier 1 Org Audit Key, isolated                                         | Audit integrity must never depend on or be reachable from workload key material               |
| **Infrastructure OU**                   | Tier 2 keys per shared service (Cert Manager, Network)                 | Network and shared-service credentials segregated from application data keys                  |
| **Sandbox OU**                          | No CMK ownership - AWS managed keys only                               | Developers should not create ungoverned CMKs; prevents key sprawl and orphaned keys           |
| **Workloads/Online**                    | Tier 2 keys per account per service, segregated from Hybrid and Corp   | Internet-facing workloads isolated from internal workload key material                        |
| **Workloads/Hybrid**                    | Tier 2 keys per account per service, segregated from Online and Corp   | On-premises-connected workloads isolated - reduces blast radius of a network-layer compromise |
| **Workloads/Corp**                      | Tier 2 keys per account per service, segregated from Online and Hybrid | Internal corporate workloads isolated from internet-facing and hybrid risk surfaces           |
| **Prod OU (Within Hybrid/Online/Corp)** | Never shares a key with the matching Non-Prod OU                       | Enforces the no-cross-environment-reuse principle from Section 4.1                            |

# 5. Key Rotation & Lifecycle Management Standards (WI-1543466)

## 5.1 Rotation Standards

| **Key Tier**                   | **Rotation Method**                                                                                                                                                                                                                                                                                                                                                  | **Frequency**                                                                                                                                                                                       | **Validation**                                                                                                                                                                                                                                                                         |
|--------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Tier 1 - Org Audit Key**     | AWS automatic annual rotation                                                                                                                                                                                                                                                                                                                                        | **Every 365 days (AWS-managed schedule)**                                                                                                                                                           | Verified via SCP-ESC-ENC-001 deny on DisableKeyRotation                                                                                                                                                                                                                                |
| **Tier 2 - Service Keys**      | AWS automatic annual rotation (standard)                                                                                                                                                                                                                                                                                                                             | **Every 365 days**                                                                                                                                                                                  | Verified via SCP-ESC-ENC-001; Config rule cmk-backing-key-rotation-enabled                                                                                                                                                                                                             |
| **Tier 2 - Prod Service Keys** | AWS automatic annual rotation + manual rotation option                                                                                                                                                                                                                                                                                                               | **Every 365 days automatic; manual rotation on suspected compromise**                                                                                                                               | Same as above + incident response runbook trigger                                                                                                                                                                                                                                      |
| **Tier 3 – Dedicated Keys**    | AWS KMS automatic rotation will be used for eligible symmetric customer-managed keys wherever supported. Where automatic rotation is not supported, or where an incident-response decision requires replacement with a new key, manual key replacement and alias reassignment will be performed through an approved automation runbook or controlled CI/CD pipeline. | **Automatic rotation every 180 days, where mandated by the approved cryptographic policy. An immediate out-of-cycle rotation must be initiated following a confirmed or suspected key compromise.** | Rotation configuration, key policy, permissions, tags, monitoring controls, encryption and decryption tests, CloudTrail events, application validation, and change-management evidence will be verified in accordance with the execution and rollback process defined in Section 5.1.1 |

Suspected compromise of a key, key administrator account, privileged IAM role, or CloudTrail-detected anomalous key activity shall trigger an immediate security investigation and out-of-cycle key rotation in accordance with the incident response process.

## 5.1.1 Tier 3 Key Rotation Execution and Rollback Process

For eligible symmetric customer-managed AWS KMS keys, automatic rotation will be used wherever supported. Manual key replacement and alias reassignment will be required only where automatic rotation is not supported or where an incident-response decision requires replacement with a new KMS key.

Manual rotation will not be performed as a routine console-based activity. It will be executed through an approved automation runbook or controlled CI/CD pipeline in accordance with the organization’s change-management and security approval processes.

### Rotation Process

The intended rotation process is as follows:

1.  Raise and obtain approval for a change request through the organization’s approved change-management process.

2.  Create the replacement KMS key using the approved infrastructure-as-code pipeline or automation runbook.

3.  Apply and validate the required key policy, administrative permissions, service permissions, tags, monitoring controls, logging configuration, and compliance settings.

4.  Perform encryption and decryption validation using the replacement key before updating the production alias.

5.  Update the existing KMS alias to reference the replacement key through the approved automation process.

6.  Validate the consuming applications and services after the alias update, including encryption, decryption, service connectivity, application functionality, and monitoring.

7.  Retain the previous KMS key in an enabled state for an agreed validation and observation period.

8.  Disable the previous key only after successful validation, confirmation that rollback is no longer required, and completion of the necessary approvals.

9.  Schedule deletion of the previous key only after the approved retention period has elapsed, all dependencies have been confirmed, and the required Security/CISO and change-management approvals have been obtained.

### Rollback Process

If an issue is identified after the alias has been updated, the alias will be reassigned to the previous KMS key through the same approved automation runbook or controlled pipeline.

The previous key must remain enabled and must not be disabled or scheduled for deletion during the validation and observation period. After the alias has been restored, application and service validation will be repeated to confirm that normal operations have been recovered.

Rollback evidence, including the change record, approval records, pipeline or automation execution logs, CloudTrail events, validation results, incident references, and final outcome, will be retained in accordance with the organization’s audit, security, and change-management requirements.

Manual console execution may be used only under an approved break-glass procedure. Such activity must be performed using an authorized administrative role with MFA and must be fully recorded through AWS CloudTrail and the associated incident or change-management record.

## 

## 5.2 Key Lifecycle States

Every CMK in the ESC Landing Zone moves through a defined lifecycle. Deletion is the most dangerous state transition and is gated by the strictest controls.

| **Lifecycle State**  | **Description**                                                                               | **Who Can Trigger**                         | **Guardrail**                                                             |
|----------------------|-----------------------------------------------------------------------------------------------|---------------------------------------------|---------------------------------------------------------------------------|
| **Creation**         | New CMK created with key policy and alias following naming convention (Section 4.2)           | Workload team via CDK pipeline              | SCP-ESC-WL-004 requires DataClassification tag at creation                |
| **Active**           | Key in normal use - encrypting and decrypting data                                            | N/A - automatic state                       | SCP-ESC-ENC-001 protects against unauthorized policy changes              |
| **Rotation**         | Annual automatic rotation or manual rotation event                                            | AWS (automatic) or Key Owner (manual)       | SCP-ESC-ENC-001 denies DisableKeyRotation                                 |
| **Disabled**         | Key temporarily disabled - all crypto operations blocked                                      | Key Owner with CISO approval only           | SCP-ESC-ENC-001 denies DisableKey without MFA; requires exception process |
| **Pending Deletion** | 7-30 day waiting period before permanent deletion (AWS default safeguard)                     | Key Owner with CISO + Compliance approval   | SCP-ESC-ENC-001 denies ScheduleKeyDeletion without MFA                    |
| **Deleted**          | Permanently destroyed - irreversible. All data encrypted with this key becomes unrecoverable. | AWS (after pending deletion window expires) | Pre-deletion checklist mandatory (Section 5.3)                            |

## 5.3 Pre-Deletion Checklist (Mandatory)

Key deletion is irreversible. Before any CMK enters Pending Deletion, the following checklist must be completed and signed off by the Key Owner and CISO.

- Confirm no active resources reference this key (S3 buckets, EBS volumes, RDS instances, DynamoDB tables) via AWS Config aggregator query

- Confirm all data encrypted with this key has been re-encrypted with a replacement key, OR confirm the data itself is being permanently deleted in the same change

- Confirm no AWS Backup recovery points depend on this key for restoration

- Set the maximum AWS-permitted waiting period (30 days) rather than the minimum (7 days) for an additional safety margin

- Document the deletion in the Key Rotation Log with business justification, approver names, and date

- Notify the Security OU Audit account team so the deletion is reflected in the next quarterly key inventory review

# 6. Cross-Account Key Access Requirements (WI-1543467)

## 6.1 Default Posture: Deny Cross-Account Access

**Default Deny Principle for CMK Access:** By default, Customer Managed Keys (CMKs) are not accessible across accounts. Any cross-account access must be explicitly authorized through a documented key grant and approved business justification. Broad key policy wildcards that permit unrestricted cross-account access are prohibited to ensure least-privilege access and maintain strong security controls.

This default-deny posture is enforced jointly by the CMK's own key policy (resource-based) and RCP-ESC-KMS-001 (the KMS data perimeter Resource Control Policy defined in the companion SCP document, Section 4.4), which blocks any principal outside the ESC Organisation regardless of what an individual key policy might otherwise allow.

## 6.2 Approved Cross-Account Access Patterns

| **Pattern**                                  | **Use Case**                                                                         | **Mechanism**                                                                                                                                                                                                                                                       | **Approval Required**                                        |
|----------------------------------------------|--------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------|
| **Security OU read access to Workload CMKs** | Audit account needs to verify encryption compliance across workload accounts         | Key policy grants kms:DescribeKey and kms:GetKeyPolicy (read-only, never Decrypt) to Audit account role                                                                                                                                                             | **Standard - Cloud Platform Lead**                           |
| **Log Archive account decrypt access**       | Centralised CloudTrail/Config logs from all accounts must be readable by Log Archive | Key policy on Tier 1 Org Audit Key grants kms:Decrypt to Log Archive service role only                                                                                                                                                                              | **Standard - pre-approved as part of Landing Zone baseline** |
| **Backup account restore access**            | AWS Backup cross-account copy requires decrypt access to source CMK during restore   | AWS Backup managed cross-account IAM role with scoped kms:Decrypt grant, time-limited to restore operation                                                                                                                                                          | **Standard - automatic via AWS Backup vault policy**         |
| **Disaster recovery key access**             | DR account needs to decrypt replicated data in a failover scenario                   | Pre-provisioned key grant to DR account role, monitored but not used unless failover invoked                                                                                                                                                                        | **Security - CISO approval, reviewed quarterly**             |
| **Third-party vendor decrypt access**        | External vendor integration requires temporary decrypt capability                    | Third-party vendor decrypt access shall only be permitted where contractual, regulatory, and sovereignty reviews have been completed. Access must be time-bound, fully logged, and restricted to principals operating within the approved ESC sovereignty boundary. | **Sovereignty - CISO + Legal + Governance Board**            |

## 6.3 Cross-Account Access - What Is Never Permitted

- A CMK key policy granting kms:\* (all actions) to a cross-account principal - grants must always be scoped to the minimum required actions (typically Decrypt and DescribeKey only).

- A CMK key policy granting access to a principal outside the ESC Organisation - blocked at the resource level by RCP-ESC-KMS-001 regardless of key policy content.

- A CMK key policy using a wildcard Principal - this is an organisation-wide prohibited pattern, flagged immediately by IAM Access Analyzer.

- Sharing a single CMK across Prod and Non-Prod environments via cross-account grant - violates the segregation principle in Section 4.1, no exceptions.

# 7. Encryption Governance & Audit Requirements (WI-1543468)

## 7.1 Audit Logging Requirements

| **Audit Requirement**                 | **Mechanism**                                                                                                      | **Retention / Review**                                                                 |
|---------------------------------------|--------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| **Every key usage event logged**      | CloudTrail captures all kms:Decrypt, kms:GenerateDataKey, kms:Encrypt API calls org-wide                           | Logs retained in Log Archive S3 with Object Lock (WORM) for minimum 7 years per BSI C5 |
| **Every key management event logged** | CloudTrail captures kms:CreateKey, kms:ScheduleKeyDeletion, kms:PutKeyPolicy, kms:DisableKey                       | Same retention; these events trigger immediate Security Hub finding                    |
| **Quarterly key inventory review**    | AWS Config aggregator query across all accounts listing every CMK, its tags, policy, and rotation status           | Reviewed by Cloud Governance Board; discrepancies escalated to Key Owner               |
| **Annual key access recertification** | Each Key Owner re-confirms every cross-account grant and IAM principal with access to their CMKs is still required | Documented sign-off retained in the Key Rotation Log                                   |
| **Real-time anomaly detection**       | GuardDuty and Security Hub flag unusual KMS API patterns (e.g. mass Decrypt calls, off-hours key policy changes)   | Findings routed to the NIS2 72-hour incident notification pipeline (companion SCP doc) |

## 7.2 Governance Roles & Responsibilities

Break-glass access to Tier 1 Audit Keys shall require dual authorization, MFA enforcement, emergency justification recording, and post-event review by the Security and Compliance teams. All break-glass access events must be logged and retained in accordance with the audit logging requirements defined in Section 7.1.

| **Role**                      | **Responsibility**                                                                                      | **Cadence**                                    |
|-------------------------------|---------------------------------------------------------------------------------------------------------|------------------------------------------------|
| **Key Owner (Workload Team)** | Day-to-day key management for owned CMKs: rotation verification, access review, tagging compliance      | Continuous; formal review monthly              |
| **Cloud Platform Team**       | Maintains the KMS architecture, CDK constructs for key creation, and the approved key naming convention | Continuous; architecture review quarterly      |
| **Security OU / Audit Team**  | Independent audit of all key usage and policies org-wide; investigates anomalies                        | Continuous monitoring; formal report quarterly |
| **CISO**                      | Approves all key disablement, deletion, and cross-account access exceptions                             | Per-request, target 3 business days            |
| **Compliance Officer**        | Validates encryption strategy against GDPR, BSI C5, NIS2 on an ongoing basis                            | Quarterly, and on regulatory change            |
| **Cloud Governance Board**    | Reviews quarterly key inventory, approves strategy changes, resolves escalations                        | Quarterly governance meeting                   |

## 7.3 Relationship to SCP Enforcement

This governance model is enforced technically by the preventive guardrails defined in the companion SCP Strategy document (US-1542064). The mapping below shows exactly which SCP enforces which governance requirement.

| **Governance Requirement (this document)**                                                                                                                                                                                                                                                                                                                                                                                             | **Technical Enforcement**                                                                                                                                                                                                                                                                                                                                                                | **Reference**                   |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------|
| KMS key deletion requires documented Security/CISO authorization through the approved change-management process. Manual key deletion performed by an administrator must use an authorized administrative role with MFA, where applicable. Automated or pipeline-initiated deletion must use an explicitly approved service role and may proceed only after the required change-management and security approvals have been completed.l | **SCP-ESC-ENC-001 restricts KMS key deletion actions, including scheduling key deletion, to explicitly authorized administrative or service roles. The SCP provides technical access control but does not enforce business approvals. Security/CISO authorization and change approval are enforced through the organization’s approved change-management workflow, such as ServiceNow.** | Companion doc Section 4.5       |
| No key disablement without MFA                                                                                                                                                                                                                                                                                                                                                                                                         | **SCP-ESC-ENC-001**                                                                                                                                                                                                                                                                                                                                                                      | Companion doc Section 4.5       |
| No key rotation disablement                                                                                                                                                                                                                                                                                                                                                                                                            | **SCP-ESC-ENC-001**                                                                                                                                                                                                                                                                                                                                                                      | Companion doc Section 4.5       |
| No cross-org key policy sharing                                                                                                                                                                                                                                                                                                                                                                                                        | **SCP-ESC-ENC-001 + RCP-ESC-KMS-001**                                                                                                                                                                                                                                                                                                                                                    | Companion doc Sections 4.4, 4.5 |
| Mandatory CMK on S3/EBS/RDS                                                                                                                                                                                                                                                                                                                                                                                                            | **SCP-ESC-WL-001**                                                                                                                                                                                                                                                                                                                                                                       | Companion doc Section 4.1       |
| Mandatory CMK on DynamoDB/MSK/SQS/SNS/EFS/ElastiCache                                                                                                                                                                                                                                                                                                                                                                                  | **SCP-ESC-ENC-002**                                                                                                                                                                                                                                                                                                                                                                      | Companion doc Section 4.6       |
| Mandatory DataClassification tag (drives CMK requirement)                                                                                                                                                                                                                                                                                                                                                                              | **SCP-ESC-WL-004**                                                                                                                                                                                                                                                                                                                                                                       | Companion doc Section 6.1       |

# 8. Encryption Strategy Validation Against Compliance Requirements (WI-1543469)

This matrix validates that the KMS and encryption strategy satisfies every applicable regulatory and framework requirement. This is a design-phase validation - actual technical test execution will be performed in the implementation phase, using the same verification approach as the companion SCP document.

| **Compliance Requirement**                                           | **Framework Reference**         | **Addressed By**                                                 | **Design Coverage** |
|----------------------------------------------------------------------|---------------------------------|------------------------------------------------------------------|---------------------|
| Personal data encrypted using state-of-the-art methods               | **GDPR Art.32(1)(a)**           | Section 3.1 - CMK mandatory for Restricted/Secret                | **Complete**        |
| Confidentiality, integrity, availability ensured on an ongoing basis | **GDPR Art.32(1)(b)**           | Sections 5.1, 5.2 - rotation and lifecycle                       | **Complete**        |
| Ability to restore availability after a security incident            | **GDPR Art.32(1)(c)**           | Section 5.3 - pre-deletion checklist; AWS Backup integration     | **Complete**        |
| Regular testing and evaluation of security measures                  | **GDPR Art.32(1)(d)**           | Section 7.1 - quarterly key inventory and annual recertification | **Complete**        |
| Cryptography and encryption policy (organisational measure)          | **NIS2 Art.21(i)**              | This entire document                                             | **Complete**        |
| Human resources security and access control                          | **NIS2 Art.21(j)**              | Section 6 - cross-account access governance                      | **Complete**        |
| Risk analysis and information security policies                      | **NIS2 Art.21(a)**              | Sections 2, 4 - architecture and segregation                     | **Complete**        |
| Encryption key management (technical and organisational measure)     | **BSI C5 - CRY-01 to CRY-04**   | Sections 4, 5 - hierarchy, segregation, rotation                 | **Complete**        |
| Logging and monitoring of cryptographic operations                   | **BSI C5 - CRY-04, LOG-01**     | Section 7.1 - audit logging requirements                         | **Complete**        |
| Sovereignty - key material remains within approved boundary          | **EUCS Substantial+ / ESC-SRF** | Section 2.1 - ESC-specific KMS facts; partition isolation        | **Complete**        |
| Independent review of access rights                                  | **ISO 27001:2022 - A.9.2.5**    | Section 7.2 - annual recertification by Key Owner                | **Complete**        |

# 9. Stakeholder Review & Approval (WI-1543493)

## 9.1 Review Process

- This document is distributed to all stakeholders listed in Section 9.2 for a 5-business-day review window, consistent with the process used for the companion SCP Strategy document.

- Comments are submitted via ITSM ticket WI-1543493 or annotated directly in this document.

- A review meeting is held on Day 6 to resolve open comments before sign-off.

- Any unresolved comment from the Security, Compliance, or Data Protection Officer stakeholder blocks sign-off.

## 9.2 Key Review Points for Client

| **Review Point**                               | **Design Decision**                                                                                                                                                                                          |
|------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Scope of this document                         | Design phase only - defines the KMS architecture, key ownership, rotation, cross-account access, and governance standards. SCP enforcement detail lives in the companion SCP Strategy document (US-1542064). |
| Relationship to SCP document                   | This document defines the STANDARD. SCP-ESC-ENC-001 and SCP-ESC-ENC-002 (companion doc, Sections 4.5-4.6) are the technical guardrails that enforce this standard automatically.                             |
| Three-tier key hierarchy                       | Org Audit Key (Tier 1), per-account Service Keys (Tier 2), and dedicated Secret Keys (Tier 3) provide defence-in-depth without excessive key sprawl.                                                         |
| No cross-environment key reuse                 | Prod and Non-Prod never share a CMK, even within the same OU - limits blast radius of a Non-Prod compromise.                                                                                                 |
| ESC partition isolation                        | CMKs in eusc-de-east-1 cannot be shared with or replicated to commercial AWS - enforced by both this design and RCP-ESC-KMS-001.                                                                             |
| Cross-account access is exception, not default | Default-deny posture; every cross-account grant is documented, scoped to minimum actions, and time-boxed where used for external vendors.                                                                    |
| Sandbox has no CMK ownership                   | Developers in Sandbox OU use AWS managed keys only - prevents ungoverned key sprawl while still meeting Basic assurance requirements.                                                                        |
| Secret-tier data uses CloudHSM/XKS             | For the highest sensitivity tier, a dedicated hardware-backed key store option is available and recommended for government-classified or national-security-adjacent workloads.                               |

## 9.3 Approval Sign-Off (WI-1543493)

| **Role**                     | **Name** | **Date** | **Signature** |
|------------------------------|----------|----------|---------------|
| **Cloud Platform Architect** |          |          |               |
| **CISO / Security Lead**     |          |          |               |
| **Compliance Officer**       |          |          |               |
