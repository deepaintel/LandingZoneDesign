**AWS European Sovereign Cloud**

**Centralized Logging, Retention & Immutability Strategy**

*Landing Zone Audit Compliance - Design Phase Deliverable*

*Region: eusc-de-east-1 \| Partition: aws-eusc \| Brandenburg, Germany*

| **Document ID**                             | US-1542069 \| ESC-LOG-DESIGN-v1.0                                                                       |
|---------------------------------------------|---------------------------------------------------------------------------------------------------------|
| **Phase**                                   | Design Phase – Centralized Logging and Retention Catalogue (No implementation code)                     |
| **Version**                                 | 1.0 - June 2026                                                                                         |
| **Platform**                                | AWS ESC \| Partition: aws-eusc \| Region: eusc-de-east-1                                                |
| **Classification**                          | Confidential - For Internal If Insurance Use Only                                                       |
| **Companion Docs**                          | ESC SCP Design Catalogue (US-1542064) and ESC KMS & Encryption Strategy (US-1542066) - cross-referenced |
| **Frameworks Alignment (Design Reference)** | BSI C5:2020 \| GDPR Art.5(1)(e), Art.30 \| NIS2 Art.21 \| ISO 27001:2022 \| NIST 800-53 (informative)   |
| **Status**                                  | Draft - Pending Stakeholder Review and Approval (WI-1543667)                                            |

# Table of Contents

[Table of Contents [2](#table-of-contents)](#table-of-contents)

[Introduction [2](#introduction)](#introduction)

[Purpose [2](#purpose)](#purpose)

[Scope [2](#scope)](#scope)

[1. Logging Strategy Design Overview [2](#logging-strategy-design-overview)](#logging-strategy-design-overview)

[1.1 Work Package Completion Matrix [3](#work-package-completion-matrix)](#work-package-completion-matrix)

[2. Centralized Log Storage Architecture (WI-1543642) [3](#centralized-log-storage-architecture-wi-1543642)](#centralized-log-storage-architecture-wi-1543642)

[2.1 ESC-Specific Logging Facts [4](#esc-specific-logging-facts)](#esc-specific-logging-facts)

[2.2 Centralized Log Storage Model [4](#centralized-log-storage-model)](#centralized-log-storage-model)

[2.3 Cross-Reference to Companion Documents [5](#cross-reference-to-companion-documents)](#cross-reference-to-companion-documents)

[2.4 Security Monitoring Architecture: CSPM, Sentinel, and the Path to Security Hub [6](#security-monitoring-architecture-cspm-sentinel-and-the-path-to-security-hub)](#security-monitoring-architecture-cspm-sentinel-and-the-path-to-security-hub)

[3. Landing Zone Audit Logging Requirements (WI-1543640) [6](#landing-zone-audit-logging-requirements-wi-1543640)](#landing-zone-audit-logging-requirements-wi-1543640)

[3.1 In-Scope Log Sources [7](#in-scope-log-sources)](#in-scope-log-sources)

[3.1.1 Service-Specific Logging Considerations [7](#service-specific-logging-considerations)](#service-specific-logging-considerations)

[3.2 Logging Coverage by Account Type [8](#logging-coverage-by-account-type)](#logging-coverage-by-account-type)

[4. Log Lifecycle Management (WI-1543651) [9](#log-lifecycle-management-wi-1543651)](#log-lifecycle-management-wi-1543651)

[4.1 Lifecycle Stages [10](#lifecycle-stages)](#lifecycle-stages)

[4.2 Lifecycle Diagram (Narrative) [10](#lifecycle-diagram-narrative)](#lifecycle-diagram-narrative)

[5. Log Retention & Archival Requirements (WI-1543641) [10](#log-retention-archival-requirements-wi-1543641)](#log-retention-archival-requirements-wi-1543641)

[5.1 Retention Periods by Log Type [11](#retention-periods-by-log-type)](#retention-periods-by-log-type)

[5.2 Archival Mechanics [11](#archival-mechanics)](#archival-mechanics)

[5.3 Retention Exceptions [12](#retention-exceptions)](#retention-exceptions)

[6. Log Protection & Immutability (WI-1543650) [12](#log-protection-immutability-wi-1543650)](#log-protection-immutability-wi-1543650)

[6.1 Immutability Mechanism [13](#immutability-mechanism)](#immutability-mechanism)

[6.2 Tamper Detection [13](#tamper-detection)](#tamper-detection)

[6.3 Access Model for the Log Archive Account [13](#access-model-for-the-log-archive-account)](#access-model-for-the-log-archive-account)

[7. Stakeholder Review & Approval (WI-1543667) [14](#stakeholder-review-approval-wi-1543667)](#stakeholder-review-approval-wi-1543667)

[7.1 Review Process [14](#review-process)](#review-process)

[7.2 Key Review Points for Client [14](#key-review-points-for-client)](#key-review-points-for-client)

[7.3 Approval Sign-Off [14](#approval-sign-off)](#approval-sign-off)

# Introduction

This document outlines the Centralized Logging, Retention, and Immutability Strategy for the AWS Landing Zone implemented for If Insurance within the AWS European Sovereign Cloud (ESC). It provides a comprehensive view of how audit, security, and operational logs are collected, centralized, retained, and protected against tampering across the Landing Zone, in support of regulatory audit compliance.

## Purpose

This document has been prepared by the Cloud Engineering team of Hexaware to provide If Insurance's Cloud Governance Board, Information Security, and Compliance functions with a complete and reviewable logging and retention strategy prior to implementation.

The key objectives of this document are to:

- Provide stakeholders with full visibility of how logs are centralized, retained, and protected across the ESC Landing Zone, supporting incident investigation and regulatory audit requests

- Establish a single reference mapping each logging and retention control to business requirements and applicable regulatory or contractual obligations

- Serve as the formal basis for stakeholder review and design approval in alignment with If Insurance's cloud governance framework, prior to implementation of any logging pipeline in a live AWS environment

## Scope

This document is limited to the design phase of the centralized logging, retention, and immutability strategy for the ESC Landing Zone. It defines what will be implemented and why, and does not include implementation-level details.

**In scope:**

- Centralized log storage architecture and the account/OU structure that supports it

- Landing Zone audit logging requirements - which events, services, and accounts are in scope for logging

- Log lifecycle management - how logs move through their lifecycle from ingestion to expiry

- Log retention and archival requirements, including retention periods by log type and regulatory driver

- Log protection and immutability requirements - how logs are protected from deletion or tampering once written

**Out of Scope:**

- AWS CDK (TypeScript) implementation code and technical configurations

- Deployment scripts and step-by-step build instructions

- Validation of this strategy against specific compliance frameworks - covered in a separate, subsequent compliance validation deliverable

- Detailed Microsoft Sentinel configuration (rule tuning, playbooks, workbook design) - Sentinel has been confirmed as the SIEM solution (Section 2.4) but its internal configuration is an application-layer decision outside Landing Zone scope.

# 1. Logging Strategy Design Overview

This section defines the complete centralized logging, retention, and immutability strategy for the AWS European Sovereign Cloud (ESC) Landing Zone at eusc-de-east-1. This is a design-phase deliverable that describes what will be implemented, not how.

Each requirement is defined with its purpose, target account/OU, priority, framework mapping, and control logic description. The AWS CDK (TypeScript) implementation details and deployment steps are explicitly out of scope and will be addressed during the implementation phase.

## 1.1 Work Package Completion Matrix

| **Work Item** | **Type**       | **Title**                                                                             | **Addressed In**                                 | **Status**   |
|---------------|----------------|---------------------------------------------------------------------------------------|--------------------------------------------------|--------------|
| **1542069**   | **User Story** | Define Centralized Logging, Retention, and Immutability Strategy for Audit Compliance | Sections 2–7 (full strategy)                     | **Complete** |
| **1543642**   | **Task**       | Define centralized log storage requirements                                           | Section 2 - Centralized Log Storage Architecture | **Complete** |
| **1543640**   | **Task**       | Define Landing Zone log audit logging requirements                                    | Section 3 - Audit Logging Requirements           | **Complete** |
| **1543651**   | **Task**       | Define log lifecycle management requirements                                          | Section 4 - Log Lifecycle Management             | **Complete** |
| **1543641**   | **Task**       | Define log retention and archival requirements                                        | Section 5 - Retention & Archival Requirements    | **Complete** |
| **1543650**   | **Task**       | Define log protection and retention requirements                                      | Section 6 - Log Protection & Immutability        | **Complete** |
| **1543666**   | **Task**       | Document the centralized logging strategy                                             | This document (Sections 1–7)                     | **Complete** |
| **1543667**   | **Task**       | Conduct stakeholder review and obtain approval                                        | Section 7 - Stakeholder Review & Sign-off        | **Pending**  |

# 2. Centralized Log Storage Architecture (WI-1543642) 

## 2.1 ESC-Specific Logging Facts

All logging infrastructure in this design operates entirely within the aws-eusc partition at eusc-de-east-1. Log data, metadata, and the centralized Log Archive account never leave the ESC sovereign boundary. CloudWatch and CloudTrail are available in ESC from launch, this design uses both alongside centralized S3 storage.

| **Attribute**         | **Value**                                                      | **Design Implication**                                                                                                                                                                                                                                                                                                                   |
|-----------------------|----------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Log Archive account   | **Dedicated account within Security OU**                       | All org-wide logs centralize here - isolated from workload and platform accounts                                                                                                                                                                                                                                                         |
| CloudTrail            | **Organization trail, available in ESC**                       | Single org-wide trail captures management and data events across all member accounts                                                                                                                                                                                                                                                     |
| CloudWatch Logs       | **Available in ESC**                                           | Application and service logs centralized via cross-account log subscription                                                                                                                                                                                                                                                              |
| AWS Config            | **Available in ESC**                                           | Configuration history and snapshots delivered to centralized S3, aggregated org-wide                                                                                                                                                                                                                                                     |
| S3 Object Lock        | **Available in ESC**                                           | Provides the WORM (Write Once Read Many) immutability mechanism for the Log Archive bucket                                                                                                                                                                                                                                               |
| CloudFront            | **NOT currently available in AWS ESC (at the time of design)** | CDN -layer access logging is therefore not included within the current Landing Zone logging scope. If CloudFront becomes available in AWS ESC, the logging design will be reviewed and updated to incorporate CloudFront access logs and any related monitoring, retention, and governance requirements as part of a future enhancement. |
| AWS Security Hub CSPM | **Active now (current state)**                                 | Provides AWS security posture management and findings visibility within ESC. Additional native AWS Security Hub aggregation capabilities are expected to become available in a future ESC release (targeted Q1 2027).                                                                                                                    |
| Microsoft Sentinel    | **Confirmed as SIEM solution (workshop decision)**             | Receives security ALERTS only - raw logs are never forwarded; all log data remains within the ESC sovereign boundary (see Section 2.4)                                                                                                                                                                                                   |

## 2.2 Centralized Log Storage Model

All logs across the Landing Zone converge into a single, dedicated Log Archive account within the Security OU - the same account already established for SCP-ESC-SEC-001/002/003 protection in the companion SCP document. This avoids creating a second, competing log storage location and keeps a single source of truth for audit purposes.

<table>
<colgroup>
<col style="width: 25%" />
<col style="width: 28%" />
<col style="width: 45%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Log Source</strong></th>
<th><strong>Centralization Mechanism</strong></th>
<th><strong>Destination</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><strong>CloudTrail (management + data events)</strong></td>
<td>Organization trail, configured once at the Management account</td>
<td>S3 bucket in Log Archive account, partitioned by account/region/date</td>
</tr>
<tr class="even">
<td><strong>AWS Config (configuration items, snapshots)</strong></td>
<td>Config Aggregator in Log Archive account (protected by SCP-ESC-SEC-003)</td>
<td>S3 bucket in Log Archive account; aggregator provides org-wide queryable view</td>
</tr>
<tr class="odd">
<td><strong>VPC Flow Logs</strong></td>
<td><p>Selective VPC</p>
<p>Plow Log enablement based on security, operational, compliance, and cost requirements. Not enabled by default for all VPCs.</p></td>
<td>CloudWatch Logs in the source account, with centralized log collection to the Log Archive account where applicable.</td>
</tr>
<tr class="even">
<td><strong>Application &amp; service logs (Amazon CloudWatch Logs)</strong></td>
<td>Logs are Collected and retained within the originating workload account. Based on approved operational, security, regulatory, compliance, and retention requirements, selected log groups or log events may be forwarded using cross-account CloudWatch Logs centralization, subscription filters, or an approved enterprise logging integration.</td>
<td>Retained in the originating workload account for operational monitoring, alerting, and troubleshooting. Approved security-relevant, compliance-relevant, or long-term retention logs may additionally be forwarded to an approved centralized monitoring platform, SIEM, or Log Archive destination, as defined by the client logging policy</td>
</tr>
<tr class="odd">
<td><strong>GuardDuty findings</strong></td>
<td>Delegated administrator + org-wide GuardDuty detector</td>
<td><p>Findings are currently integrated with AWS Security Hub CSPM and will stream to the native AWS Security Hub finding-aggregation service once available in ESC (targeted Q1 2027).</p>
<p>High-severity alerts forwarded to Microsoft Sentinel, raw findings remain in Log Archive S3.</p></td>
</tr>
<tr class="even">
<td><strong>Security Hub findings</strong></td>
<td>[FUTURE STATE - Q1 2027] Delegated administrator, org-wide aggregation, once Security Hub becomes available in ESC.</td>
<td>Not yet applicable - AWS Security Hub CSPM provides the current-state security posture management capability. Native AWS Security Hub finding aggregation will be adopted when available in ESC (targeted Q1 2027).</td>
</tr>
</tbody>
</table>

Application teams remain responsible for ensuring that workload, platform, and business application logs are emitted to approved CloudWatch Log Groups in accordance with If Insurance logging standards. The Landing Zone provides the centralized log collection and cross-account delivery mechanism but does not prescribe application-specific log content, formats, retention requirements beyond those defined in this document, or service-specific monitoring requirements. All application logs designated for centralized retention must be forwarded to the Log Archive account through approved CloudWatch Logs subscription mechanisms.

**Design Principle:** *The Log Archive account has no operational workloads and no direct human login - access is via the CDK pipeline role and a small set of break-glass roles only. This minimizes the attack surface of the most sensitive account in the Landing Zone.*

## 2.3 Cross-Reference to Companion Documents

This logging strategy is tightly coupled to controls already defined in the companion SCP and KMS documents. Rather than duplicating that content, this section cross-references the relevant controls.

| **Logging Requirement**                                                                                                                                                                                                                                             | **Enforced By**                               | **Reference**                  |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------|--------------------------------|
| CloudTrail/Config/GuardDuty/Security Hub cannot be stopped or deleted; AWS Security Hub CSPM protected as the current security posture mechanism (the core Security Hub finding-aggregation service will be added to this control once available, targeted Q1 2027) | **SCP-ESC-SEC-001**                           | Companion SCP doc, Section 3.5 |
| Log Archive S3 Object Lock (WORM) cannot be removed                                                                                                                                                                                                                 | **SCP-ESC-SEC-002**                           | Companion SCP doc, Section 3.6 |
| Config Aggregator cannot be deleted or tampered with                                                                                                                                                                                                                | **SCP-ESC-SEC-003**                           | Companion SCP doc, Section 3.7 |
| Log data at rest encrypted with customer-managed key                                                                                                                                                                                                                | **SCP-ESC-WL-001 / KMS Tier 1 Org Audit Key** | Companion KMS doc, Section 2.3 |
| CloudWatch Logs encrypted for Restricted/Secret classification logs                                                                                                                                                                                                 | **KMS CMK Standards (CloudWatch Logs row)**   | Companion KMS doc, Section 3.2 |

## 2.4 Security Monitoring Architecture: CSPM, Sentinel, and the Path to Security Hub

Per the security architecture workshop, logs are kept in-cloud within the ESC partition at all times, only security alerts are forwarded to Microsoft Sentinel for centralized monitoring and correlation. This preserves the sovereignty guarantees established elsewhere in this Landing Zone (see companion SCP document, Section 3.1, SCP-ESC-ROOT-001) - raw log data, which may contain regulated customer information, never crosses the ESC partition boundary. Only the much smaller volume of security alerts - which describe a finding (e.g. “suspicious API call detected”) without including the underlying log content is transmitted to Sentinel.

AWS Security Hub CSPM is currently available in AWS European Sovereign Cloud and serves as the Landing Zone's primary cloud security posture management capability, providing security findings visibility and compliance monitoring across AWS resources. The broader AWS Security Hub capability set, including additional centralized finding aggregation features, is not yet available within ESC and is expected to become available in Q1 2027. This document therefore references AWS Security Hub CSPM as the current-state service and AWS Security Hub as the planned future-state enhancement.

**Data Flow: What Stays In-Cloud vs. What Is Forwarded to Sentinel**

| **Data Type**                                                                       | **Stays In ESC (eusc-de-east-1)**                          | **Forwarded to Microsoft Sentinel**                                                  |
|-------------------------------------------------------------------------------------|------------------------------------------------------------|--------------------------------------------------------------------------------------|
| Raw log data (CloudTrail, Config, VPC Flow Logs, CloudWatch Logs, application logs) | YES - permanently, per the retention schedule in Section 5 | NO - never leaves the ESC sovereign boundary                                         |
| GuardDuty / Security Hub CSPM                                                       | YES - archived in Log Archive S3                           | Summarized alert only - finding type, severity, affected resource ID, timestamp      |
| Underlying resource configuration or data content                                   | YES - remains in AWS Config / source service               | NO - Sentinel receives metadata about the alert only, not the resource's actual data |

**KEY SOVEREIGNTY POINT:** This architecture means If Insurance's regulated data (raw logs) never crosses the ESC sovereign boundary. Only summarized, non-raw security alerts - which describe a finding, not the underlying customer data - are transmitted to Microsoft Sentinel for SIEM correlation. This satisfies both the operational need for centralized security monitoring and the data residency commitments made elsewhere in this Landing Zone.

# 3. Landing Zone Audit Logging Requirements (WI-1543640)

## 3.1 In-Scope Log Sources

Audit logging in this Landing Zone covers every account and every layer of the stack - management plane, data plane, network, identity, and application - to ensure no blind spots exist for incident investigation or regulatory audit requests.

| **Layer**             | **Log Source**                                                                                                                     | **Captures**                                                                                                             | **Applies To**                                               |
|-----------------------|------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------|
| **Management plane**  | CloudTrail (management events)                                                                                                     | Every API call made against any AWS service - who, what, when, from where                                                | All accounts, org-wide                                       |
| **Data plane**        | CloudTrail (data events) - S3 object-level, Lambda invocations                                                                     | Object-level access to S3 buckets carrying Restricted/Secret data; Lambda function invocations                           | Workloads OU accounts (Restricted+ classification resources) |
| **Network**           | VPC Flow Logs                                                                                                                      | Accepted and rejected network traffic at the ENI level                                                                   | All VPCs across Infrastructure and Workloads OUs             |
| **Configuration**     | AWS Config                                                                                                                         | Configuration state and change history for every recorded resource type                                                  | All accounts, org-wide                                       |
| **Identity & access** | CloudTrail + IAM Identity Center sign-in logs                                                                                      | Every authentication event, permission set assignment, and SSO session                                                   | All accounts, org-wide                                       |
| **Security findings** | GuardDuty + AWS Security Hub CSPM (current). Security Hub finding-aggregation to be added once available in ESC (targeted Q1 2027) | Threat detection findings and aggregated security posture; alerts only forwarded to Microsoft Sentinel (see Section 2.4) | All accounts, org-wide                                       |
| **Application**       | CloudWatch Logs (application/service log groups)                                                                                   | Application-level logs from EC2, Lambda, ECS, EKS, RDS                                                                   | Workloads OU accounts                                        |

## 3.1.1 Service-Specific Logging Considerations

In addition to the Landing Zone baseline logging sources defined above, certain AWS services may require service-specific logging depending on workload architecture, security requirements, compliance obligations, and service adoption. Examples include:

- Route 53 Resolver query logs

- AWS WAF logs

- Application Load Balancer (ALB) and Network Load Balancer (NLB) access logs

- AWS Network Firewall logs

- Transit Gateway Flow Logs

- VPN connection logs

- Amazon EKS control plane logs

- Amazon RDS/Aurora database logs

- AWS Systems Manager Session Manager logs

- AWS Backup audit and operational logs

- Amazon API Gateway access and execution logs

These logs are not mandated as Landing Zone baseline controls and should be enabled based on workload-specific requirements. Logging, retention, monitoring, and centralization requirements for such services may be defined through a future Service Logging Catalogue and associated governance standards.

## 3.2 Logging Coverage by Account Type

| **Account / OU**        | **Logging Requirement**                                                                                                                                                                                                                       | **Priority** |
|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| Management account      | Organization CloudTrail configured here, root-level activity must be fully logged given its elevated privilege                                                                                                                                | **CRITICAL** |
| Security OU             | Receives all centralized logs, logging on the Log Archive and Audit accounts themselves must also be enabled to detect tampering attempts                                                                                                     | **CRITICAL** |
| Infrastructure OU       | VPC Flow Logs mandatory on every VPC; Network account activity logged at data-plane level given its centralization role (SCP-ESC-INF-001)                                                                                                     | **HIGH**     |
| Workloads / Hybrid (L2) | Management-plane logging mandatory (inherited from Workloads OU). On-premises connected workloads - VPN/Direct Connect activity logged at the Network account.                                                                                | **HIGH**     |
| Workloads / Online (L2) | Management-plane logging mandatory (inherited from Workloads OU). Internet-facing workloads - ALB and WAF logs additionally required (SCP-ESC-NET-001)                                                                                        | **HIGH**     |
| Workloads / Corp (L2)   | Management-plane logging mandatory (inherited from Workloads OU). Internal corporate workloads - no public endpoint logging required.                                                                                                         | **HIGH**     |
| Hybrid / Prod (L3)      | Full data-plane + management-plane logging; data event logging on S3/Lambda mandatory for Restricted/Secret classification resources.                                                                                                         | **CRITICAL** |
| Hybrid / Non-Prod (L3)  | Management-plane logging mandatory, data-plane logging recommended but not mandatory for Internal/Confidential classification only                                                                                                            | **HIGH**     |
| Online / Prod (L3)      | Full data-plane + management-plane logging; data event logging on S3/Lambda mandatory for Restricted/Secret classification resources.                                                                                                         | **CRITICAL** |
| Online / Non-Prod (L3)  | Management-plane logging mandatory; data-plane logging recommended but not mandatory for Internal/Confidential classification only.                                                                                                           | **HIGH**     |
| Sandbox OU              | Management-plane logging mandatory (cannot be disabled per SCP-ESC-SEC-001); data-plane logging not required given no production data is permitted                                                                                            | **MEDIUM**   |
| Suspended OU            | Logging remains active until account closure to preserve the audit trail up to the point of suspension. Existing SCP protections and centralized log delivery requirements remain enforced while the account resides within the Suspended OU. | **HIGH**     |

# 4. Log Lifecycle Management (WI-1543651)

Every log, from creation to final disposition, moves through a defined lifecycle. This ensures logs are available when needed for investigation and are not retained indefinitely beyond their regulatory or operational requirement.

## 4.1 Lifecycle Stages

| **Stage**                        | **Description**                                                                                                                                                                                                               | **Who/What Triggers It**                                                     | **Guardrail**                                                                                |
|----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|
| **Generation**                   | Log event is generated at the source (API call, network packet, application write)                                                                                                                                            | Automatic - AWS service or application                                       | Cannot be selectively suppressed once a log source is enabled                                |
| **Ingestion**                    | Log is captured by the source-side mechanism (CloudTrail, VPC Flow Logs, CloudWatch agent)                                                                                                                                    | Automatic, near-real-time                                                    | SCP-ESC-SEC-001 prevents disabling the capture mechanism                                     |
| **Centralization**               | Log is forwarded/delivered to the centralized Log Archive account                                                                                                                                                             | Automatic via org trail, subscription filter, or aggregator                  | Cross-account delivery role scoped to write-only, no read/delete                             |
| **Hot (Fast-access) storage**    | Recent logs (0–90 days) remain in fast, readily-searchable storage (CloudWatch Logs / S3 Standard) for quick querying during active investigations                                                                            | Lifecycle policy, automatic                                                  | Encrypted with CMK per KMS strategy (companion doc)                                          |
| **Warm/cold storage transition** | Logs older than 90 days move from fast, readily searchable storage (**S3 Standard**) to progressively cheaper, slower-to-retrieve storage (**S3 Infrequent Access, then S3 Glacier**), per the retention schedule (Section 5) | S3 Lifecycle Policy, automatic                                               | Transition rules are part of the CDK-managed bucket configuration - not manually editable    |
| **Immutable retention**          | Logs are placed under S3 Object Lock (WORM) for their full regulatory retention period                                                                                                                                        | Automatic at write time for Log Archive bucket                               | SCP-ESC-SEC-002 prevents Object Lock removal                                                 |
| **Expiry**                       | Logs reaching the end of their retention period are eligible for deletion                                                                                                                                                     | S3 Lifecycle expiration rule, automatic, after Object Lock retention expires | Cannot occur before the Object Lock retention period elapses, regardless of lifecycle policy |

## 4.2 Lifecycle Diagram (Narrative)

The log lifecycle within this Landing Zone follows a single continuous path: generated at the source, ingested by the appropriate AWS logging mechanism, centralized to the Log Archive account, kept in fast-access hot storage for active investigations, transitioned to progressively cheaper cold storage as it ages, held immutably under Object Lock for its full regulatory retention period regardless of storage tier, and finally expired only once both the lifecycle policy and the Object Lock retention period have been satisfied. No stage can be skipped, and no log can be expired early - the Object Lock retention period is the hard floor beneath the lifecycle policy.

# 5. Log Retention & Archival Requirements (WI-1543641)

## 5.1 Retention Periods by Log Type

Retention periods are driven by the more conservative of: (a) the regulatory minimum applicable to the log type, and (b) If Insurance's internal audit and investigation needs. Where BSI C5 and GDPR suggest different minimums, the longer period is applied.

| **Log Type**                                     | **Retention Period** | **Storage Tier Schedule**                                                                                                                                                                                               |
|--------------------------------------------------|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **CloudTrail (management events)**               | **5 years**          | Quickly searchable for 90 days (**S3 Standard**), then progressively moved to cheaper, slower storage through year 1 (**S3 Infrequent Access**), then to long-term archive for the rest of the 5 years (**S3 Glacier**) |
| **CloudTrail (data events, Restricted/Secret)**  | **5 years**          | Quickly searchable for 30 days (**S3 Standard**), then progressively moved to cheaper, slower storage through year 1 (**S3 Infrequent Access**), then to long-term archive for the rest of the 5 years (**S3 Glacier**) |
| **AWS Config history & snapshots**               | **5 years**          | Quickly searchable for 90 days (**S3 Standard**), then progressively moved to cheaper, slower storage through year 1 (**S3 Infrequent Access**), then to long-term archive for the rest of the 5 years (**S3 Glacier**) |
| **VPC Flow Logs**                                | **1 year**           | Quickly searchable for 30 days (S3 Standard), then moved to cheaper, slower storage for the remaining period (S3 Infrequent Access)                                                                                     |
| **GuardDuty / Security Hub CSPM findings**       | **3 years**          | Quickly searchable for 90 days (**S3 Standard**), then moved to cheaper, slower storage for the remaining period (**S3 Infrequent Access**)                                                                             |
| **Application logs (CloudWatch Logs, Prod)**     | **1 year**           | Quickly searchable for 30 days (**S3 Standard**), then moved to long-term archive for the remaining period (**S3 Glacier**)                                                                                             |
| **Application logs (CloudWatch Logs, Non-Prod)** | **90 days**          | Quickly searchable for 30 days (S3 Standard), then moved to lower-cost storage for the **remaining 60 days** before being deleted at the end of the 90-day retention period                                             |
| **IAM Identity Center sign-in logs**             | **5 years**          | Quickly searchable for 90 days (**S3 Standard**), then progressively moved to cheaper, slower storage through year 1 (**S3 Infrequent Access**), then to long-term archive for the rest of the 5 years (**S3 Glacier**) |

The retention periods defined in this section represent Landing Zone baseline requirements based on current audit, operational, and regulatory considerations. Legal, Compliance, and Data Protection stakeholders remain responsible for validating these retention periods against applicable insurance-sector obligations, national record-keeping requirements, and future regulatory changes. Where a legal or regulatory requirement exceeds the baseline retention period, the longer retention period shall apply.

## 5.2 Archival Mechanics

- S3 Lifecycle Policies, defined per bucket via CDK, automate the transition between storage tiers - no manual intervention required at any stage.

- The long-term archive tier used for the coldest, oldest logs typically has retrieval times of approximately 3-5 hours, depending on archive tier selection and retrieval volume. This is acceptable for audit and investigation use cases that are not time critical.

- Cross-region replication is NOT used for archival, since ESC currently operates from a single region (eusc-de-east-1) and cross-partition replication to commercial AWS is not possible.

- AWS European Sovereign Cloud currently operates as a single-region environment (eusc-de-east-1). As a result, regional disaster recovery for centralized log archives cannot rely on native cross-region replication. Log durability is provided by Amazon S3 service durability guarantees and immutability controls. This residual risk is accepted as an AWS ESC platform constraint and shall be re-evaluated during future Landing Zone reviews if additional ESC regions become available.

- **Audit Retrieval Objective:** Archived logs should be retrievable within one business day of an approved audit, compliance, legal, or security investigation request. Retrieval priority and timelines may be accelerated for active security incidents or regulatory investigations.

- Each archived log retains its original encryption (customer-managed KMS CMK) through every storage tier transition - archival never re-encrypts with a weaker mechanism.

## 5.3 Retention Exceptions

Retention periods may be extended (never shortened) under the following circumstances, following the same exception governance model defined in the companion SCP document (Section 7):

- Active litigation hold - logs relevant to ongoing legal proceedings are retained until the hold is lifted, regardless of the standard retention period

- Regulatory investigation - logs requested by a supervisory authority are retained for the duration of the investigation plus any applicable appeal period

- Active security incident - logs related to an ongoing or recently closed security incident are retained for a minimum of 2 years post-closure to support forensic re-analysis if needed

# 6. Log Protection & Immutability (WI-1543650)

## 6.1 Immutability Mechanism

All centrally stored logs in the Log Archive account are protected using Amazon S3 Object Lock in Compliance mode - the strictest available mode, which prevents deletion or modification by any principal, including the AWS account root user, for the duration of the retention period.

| **Protection Layer**                 | **Mechanism**                                | **What It Prevents**                                                                                                                                                                                                                                                                                                                       |
|--------------------------------------|----------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **S3 Object Lock (Compliance mode)** | WORM enforcement at the storage layer        | Deletion or overwrite of any log object or object version, by anyone, including root, until the retention period expires                                                                                                                                                                                                                   |
| **SCP-ESC-SEC-002**                  | Identity-layer guardrail (companion SCP doc) | Removal or weakening of the Object Lock configuration itself, even by an account with otherwise broad permissions                                                                                                                                                                                                                          |
| **SCP-ESC-SEC-001**                  | Identity-layer guardrail (companion SCP doc) | Stopping, deleting, or modifying the CloudTrail trail, Config recorder, or GuardDuty detector that produce these logs in the first place. AWS Security Hub CSPM is protected as the current-state security posture service, with native AWS Security Hub aggregation controls to be incorporated once available in ESC (targeted Q1 2027). |
| **SCP-ESC-SEC-003**                  | Identity-layer guardrail (companion SCP doc) | Deletion of the Config Aggregator or removal of source-account authorizations, which would create a gap in the centralized compliance view                                                                                                                                                                                                 |
| **KMS CMK encryption**               | Cryptographic protection (companion KMS doc) | Reading log contents without authorized key access, even if storage-layer controls were somehow bypassed                                                                                                                                                                                                                                   |
| **Cross-account write-only role**    | IAM permission boundary                      | The Log Archive account's own administrators from reading or exporting logs outside approved investigation workflows                                                                                                                                                                                                                       |

## 6.2 Tamper Detection

- An AWS Config rule continuously monitors the Log Archive bucket's Object Lock configuration. Any detected drift triggers an immediate alert through AWS Security Hub CSPM. This control will route through native AWS Security Hub aggregation capabilities once available in ESC (targeted Q1 2027).

- CloudTrail logs every API call against the Log Archive account itself, creating a self-referential audit trail of who accessed the audit trail

- A monthly automated integrity verification process validates the completeness and consistency of centralized log delivery from all source accounts. Any unexpected gaps, delivery failures, or anomalies identified during verification are investigated in accordance with the incident management process. The specific implementation mechanism will be defined during the implementation phase.

## 6.3 Access Model for the Log Archive Account

Consistent with the Design Principle stated in Section 2.2, the Log Archive account has no standing human access:

- Day-to-day writes occur only via the automated, cross-account delivery roles used by CloudTrail, Config, and the CloudWatch Logs subscription - none of which have delete permissions

- Read access for investigation purposes is granted via a time-boxed, logged break-glass role, following the same exception approval process as the companion SCP document (Section 7)

- No engineer, including Cloud Platform Team members, has standing console access to the Log Archive account under normal operating conditions

# 7. Stakeholder Review & Approval (WI-1543667)

## 7.1 Review Process

- This document is distributed to all stakeholders for a 5-business-day review window, consistent with the process used for the companion SCP and KMS documents.

- A review meeting is held on Day 6 to resolve open comments before sign-off.

- Any unresolved comment from the Security, Compliance, or Data Protection Officer stakeholder blocks sign-off.

## 7.2 Key Review Points for Client

| **Review Point**                          | **Design Decision**                                                                                                                                                                                                                                                           |
|-------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Scope of this document                    | Design phase only — defines the logging architecture, retention schedule, and immutability controls. Compliance validation against specific frameworks is a separate, subsequent deliverable per client direction.                                                            |
| Single centralized Log Archive account    | All logs across every account converge to one dedicated, no-standing-access account within the Security OU — the same account already protected by SCP-ESC-SEC-001/002/003.                                                                                                   |
| 5-year retention on audit-critical logs   | CloudTrail, Config, and IAM Identity Center sign-in logs are retained for 5 years as the Landing Zone baseline. Legal and Compliance functions are responsible for validating this period against applicable national record-keeping obligations and regulatory requirements. |
| Compliance-mode Object Lock               | The strictest available WORM mode is used – logs cannot be deleted even by the account root user during the retention period.                                                                                                                                                 |
| Single-region archival constraint         | ESC currently has one region; archival resilience relies on S3's 11-nines durability rather than cross-region replication. Flagged as a constraint to revisit if a second ESC region becomes available.                                                                       |
| No standing human access to Log Archive   | All access is automated (delivery roles) or time-boxed break-glass, following the same exception process as the SCP document.                                                                                                                                                 |
| Tightly coupled to companion SCP/KMS docs | This document does not duplicate SCP or KMS content — it cross-references SCP-ESC-SEC-001/002/003 and the KMS Tier 1 Org Audit Key directly (Section 2.3).                                                                                                                    |

## 7.3 Approval Sign-Off

| **Role**                     | **Name** | **Date** | **Signature** |
|------------------------------|----------|----------|---------------|
| **Cloud Platform Architect** |          |          |               |
| **CISO / Security Lead**     |          |          |               |
| **Compliance Officer**       |          |          |               |
