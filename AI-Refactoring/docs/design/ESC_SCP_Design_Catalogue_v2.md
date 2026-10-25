**AWS European Sovereign Cloud**

**Service Control Policy (SCP) Design Catalogue**

*Landing Zone Governance - Design Phase Document*

*Region: eusc-de-east-1 \| Partition: aws-eusc \| Brandenburg, Germany*

|                    |                                                                                                               |
|--------------------|---------------------------------------------------------------------------------------------------------------|
| **Document ID**    | ESC-SCP-DESIGN-v1.0                                                                                           |
| **Phase**          | Design Phase - SCP Catalogue (No implementation code)                                                         |
| **Version**        | 1.0 - June 2026                                                                                               |
| **Platform**       | AWS ESC \| Partition: aws-eusc \| Region: eusc-de-east-1                                                      |
| **Implementation** | AWS CDK (TypeScript) - to be executed in implementation phase                                                 |
| **Frameworks**     | BSI C5:2020 \| GDPR Art.32 \| NIS2 Art.21 \| ISO 27001:2022 \| NIST 800-53                                    |
| **Work Items**     | US-1542064, 1542292, 1542293, 1542294, 1542296, 1542297, 1542298, 1542301, 1542302, 1542303, 1542305, 1542306 |
| **Status**         | Draft - Pending Stakeholder Review (WI-1542305) and Design Sign-off (WI-1542306)                              |

# Table of Contents 

[Introduction [4](#introduction)](#introduction)

[Purpose [4](#purpose)](#purpose)

[Scope [4](#scope)](#scope)

[1. Preventive Guardrails Design Overview [5](#preventive-guardrails-design-overview)](#preventive-guardrails-design-overview)

[1.1 Work Package Completion Matrix [5](#work-package-completion-matrix)](#work-package-completion-matrix)

[2. SCP Hierarchy & OU Inheritance Model (WI-1542292) [6](#scp-hierarchy-ou-inheritance-model-wi-1542292)](#scp-hierarchy-ou-inheritance-model-wi-1542292)

[2.1 ESC-Specific Partition Facts [6](#esc-specific-partition-facts)](#esc-specific-partition-facts)

[2.2 OU Hierarchy & SCP Inheritance [6](#ou-hierarchy-scp-inheritance)](#ou-hierarchy-scp-inheritance)

[2.3 Complete SCP Inventory - 22 Policies [7](#complete-scp-inventory---22-policies)](#complete-scp-inventory---22-policies)

[2.4 SCP Limit Consideration [9](#scp-limit-consideration)](#scp-limit-consideration)

[Worked Example [9](#worked-example)](#worked-example)

[3. Sovereignty & Security Monitoring SCPs (WI-1542293, WI-1542297) [9](#sovereignty-security-monitoring-scps-wi-1542293-wi-1542297)](#sovereignty-security-monitoring-scps-wi-1542293-wi-1542297)

[3.1 SCP-ESC-ROOT-001 - Deny Non-ESC Regions \[CRITICAL\] [9](#scp-esc-root-001---deny-non-esc-regions-critical)](#scp-esc-root-001---deny-non-esc-regions-critical)

[3.2 SCP-ESC-ROOT-002 - Eliminate Root User API Access \[CRITICAL\] [10](#scp-esc-root-002---eliminate-root-user-api-access-critical)](#scp-esc-root-002---eliminate-root-user-api-access-critical)

[3.3 SCP-ESC-ROOT-003 - Protect SCP Governance \[CRITICAL\] [10](#scp-esc-root-003---protect-scp-governance-critical)](#scp-esc-root-003---protect-scp-governance-critical)

[3.4 SCP-ESC-ROOT-004 - Approved Service Boundary \[HIGH\] [10](#scp-esc-root-004---approved-service-boundary-high)](#scp-esc-root-004---approved-service-boundary-high)

[3.5 SCP-ESC-SEC-001 - Protect All Security Monitoring Services \[CRITICAL\] [11](#scp-esc-sec-001---protect-all-security-monitoring-services-critical)](#scp-esc-sec-001---protect-all-security-monitoring-services-critical)

[3.6 SCP-ESC-SEC-002 - Protect Log Archive WORM Immutability \[HIGH\] [11](#scp-esc-sec-002---protect-log-archive-worm-immutability-high)](#scp-esc-sec-002---protect-log-archive-worm-immutability-high)

[3.7 SCP-ESC-SEC-003 — Protect Config Aggregator \[HIGH\] [11](#scp-esc-sec-003-protect-config-aggregator-high)](#scp-esc-sec-003-protect-config-aggregator-high)

[4. Encryption & Key Management SCPs (WI-1542294) [12](#encryption-key-management-scps-wi-1542294)](#encryption-key-management-scps-wi-1542294)

[4.1 SCP-ESC-WL-001 - Encryption at Rest - CMK Mandatory \[HIGH\] [12](#scp-esc-wl-001---encryption-at-rest---cmk-mandatory-high)](#scp-esc-wl-001---encryption-at-rest---cmk-mandatory-high)

[4.2 SCP-ESC-WL-002 - Enforce TLS 1.2+ In Transit \[HIGH\] [12](#scp-esc-wl-002---enforce-tls-1.2-in-transit-high)](#scp-esc-wl-002---enforce-tls-1.2-in-transit-high)

[4.3 RCP-ESC-S3-001 - S3 Data Perimeter \[HIGH\] [13](#rcp-esc-s3-001---s3-data-perimeter-high)](#rcp-esc-s3-001---s3-data-perimeter-high)

[4.4 RCP-ESC-KMS-001 - KMS Key Data Perimeter \[HIGH\] [13](#rcp-esc-kms-001---kms-key-data-perimeter-high)](#rcp-esc-kms-001---kms-key-data-perimeter-high)

[5. Identity, Access Management & Privileged Access SCPs (WI-1542296) [15](#identity-access-management-privileged-access-scps-wi-1542296)](#identity-access-management-privileged-access-scps-wi-1542296)

[5.1 SCP-ESC-WL-003 - Deny IAM Users; Enforce SSO-Only Access \[HIGH\] [15](#scp-esc-wl-003---deny-iam-users-enforce-sso-only-access-high)](#scp-esc-wl-003---deny-iam-users-enforce-sso-only-access-high)

[5.2 SCP-ESC-IAM-001 - Deny Privilege Escalation \[HIGH\] [15](#scp-esc-iam-001---deny-privilege-escalation-high)](#scp-esc-iam-001---deny-privilege-escalation-high)

[5.3 SCP-ESC-IAM-002 - Deny External Cross-Account Trust \[HIGH\] [15](#scp-esc-iam-002---deny-external-cross-account-trust-high)](#scp-esc-iam-002---deny-external-cross-account-trust-high)

[5.4 SCP-ESC-PROD-001 - Production Privileged Access Restrictions \[HIGH\] [16](#scp-esc-prod-001---production-privileged-access-restrictions-high)](#scp-esc-prod-001---production-privileged-access-restrictions-high)

[6. Workload, Network & Cost SCPs (WI-1542298) [16](#workload-network-cost-scps-wi-1542298)](#workload-network-cost-scps-wi-1542298)

[6.1 SCP-ESC-WL-004 - Mandatory Tagging on All Taggable Resources \[MEDIUM\] [16](#scp-esc-wl-004---mandatory-tagging-on-all-taggable-resources-medium)](#scp-esc-wl-004---mandatory-tagging-on-all-taggable-resources-medium)

[6.2 SCP-ESC-INF-001 - Centralize Network Management \[HIGH\] [17](#scp-esc-inf-001---centralize-network-management-high)](#scp-esc-inf-001---centralize-network-management-high)

[6.3 SCP-ESC-NET-001 - WAF on Internet-Facing ALBs \[MEDIUM\] [17](#scp-esc-net-001---waf-on-internet-facing-albs-medium)](#scp-esc-net-001---waf-on-internet-facing-albs-medium)

[6.4 SCP-ESC-SBX-001 - Sandbox Cost Guardrails \[MEDIUM\] [17](#scp-esc-sbx-001---sandbox-cost-guardrails-medium)](#scp-esc-sbx-001---sandbox-cost-guardrails-medium)

[6.5 SCP-ESC-SUS-001 - Suspended Account Quarantine \[CRITICAL\] [17](#scp-esc-sus-001---suspended-account-quarantine-critical)](#scp-esc-sus-001---suspended-account-quarantine-critical)

[7. Exception Handling & Governance Approval (WI-1542301) [19](#exception-handling-governance-approval-wi-1542301)](#exception-handling-governance-approval-wi-1542301)

[7.1 Exception Categories & Approvers [19](#exception-categories-approvers)](#exception-categories-approvers)

[7.2 Exception Workflow [19](#exception-workflow)](#exception-workflow)

[8. SCP Lifecycle Management (WI-1542302) [20](#scp-lifecycle-management-wi-1542302)](#scp-lifecycle-management-wi-1542302)

[8.1 GitOps Change Pipeline [20](#gitops-change-pipeline)](#gitops-change-pipeline)

[8.2 Review Cadence [21](#review-cadence)](#review-cadence)

[9. SCP Design Validation Matrix (WI-1542303) [22](#scp-design-validation-matrix-wi-1542303)](#scp-design-validation-matrix-wi-1542303)

[10. Stakeholder Review & Design Sign-Off (WI-1542305, WI-1542306) [24](#stakeholder-review-design-sign-off-wi-1542305-wi-1542306)](#stakeholder-review-design-sign-off-wi-1542305-wi-1542306)

[10.1 Review Process (WI-1542305) [24](#review-process-wi-1542305)](#review-process-wi-1542305)

[10.2 Key Review Points for Client [24](#key-review-points-for-client)](#key-review-points-for-client)

[10.3 Design Approval Sign-Off (WI-1542306) [25](#design-approval-sign-off-wi-1542306)](#design-approval-sign-off-wi-1542306)

# Introduction

This document outlines the Service Control Policy (SCP) and Resource Control Policy (RCP) design strategy for the AWS Landing Zone implemented for If Insurance within the AWS European Sovereign Cloud (ESC).  
It provides a comprehensive view of governance controls and guardrails designed to ensure security, regulatory compliance, and operational consistency across the Landing Zone.

# Purpose 

This document has been prepared by the Cloud Platform Engineering team to provide If Insurance's Cloud Governance Board, Information Security, and Compliance functions with a complete and reviewable catalogue of preventive guardrails proposed for the Landing Zone prior to implementation.

The key objectives of this document are to:

- Provide stakeholders with full visibility of governance controls that safeguard customer data, policyholder records, and underwriting systems within the ESC Landing Zone

- Establish a single reference mapping each control to business requirements and applicable regulatory or contractual obligations, supporting audit and assurance processes

- Serve as the formal basis for stakeholder review and design approval in alignment with If Insurance’s cloud governance framework, prior to deployment of any SCP in a live AWS environment

# Scope

This document is limited to the design phase of the SCP and RCP strategy for the ESC Landing Zone. It defines what preventive guardrails will be implemented and why and does not include implementation-level details.

**In scope:**

- The complete catalogue of 20 Service Control Policies (SCPs) and 2 Resource Control Policies (RCPs), including their purpose, target Organizational Units (OUs), priority, and regulatory or framework mapping

- The OU hierarchy and SCP inheritance model

- The exception handling and governance approval process for deviations from standard guardrails

- The lifecycle management process, including review cadence and change control mechanisms

- A validation matrix demonstrating alignment with Landing Zone governance requirements

**Out of Scope:**

- AWS CDK (TypeScript) implementation code and technical configurations

- Deployment scripts and step-by-step build instructions

- Execution-level implementation details, which are part of the implementation phase deliverables

# 1. Preventive Guardrails Design Overview

This section defines the complete catalogue of Service Control Policies (SCPs) and Resource Control Policies (RCPs) to be implemented in the AWS European Sovereign Cloud (ESC) Landing Zone at eusc-de-east-1. This is a design-phase deliverable that describes what will be implemented, not how.

Each SCP is defined with its purpose, target Organizational Unit (OU), priority, framework mapping, and policy logic description. The AWS CDK (TypeScript) implementation details and deployment steps are explicitly out of scope and will be addressed during the implementation phase.

## 1.1 Work Package Completion Matrix

|                                                                                        |                                             |              |
|----------------------------------------------------------------------------------------|---------------------------------------------|--------------|
| **Work Item**                                                                          | **Reference Section in DOC**                | **Status**   |
| Define SCP Strategy and Preventive Guardrails for Landing Zone Governance (User Story) | Sections 2–7 (full catalogue)               | **Complete** |
| Define the SCP hierarchy and inheritance model across Organizational Units             | Section 2 - Hierarchy Model                 | **Complete** |
| Design sovereignty guardrails - prevent deployment outside approved EUSC regions       | Section 3 - SCP-ESC-ROOT-001                | **Complete** |
| Design preventive guardrails for encryption and key management requirements            | Section 4 - SCP-ESC-WL-001/002, ENC-001/002 | **Complete** |
| Design preventive guardrails for identity, access management, and privileged access    | Section 5 - SCP-ESC-WL-003, IAM-001/002     | **Complete** |
| Design preventive guardrails for logging, auditability, and security monitoring        | Section 3 - SCP-ESC-SEC-001/002/003         | **Complete** |
| Define SCP mappings to OUs based on account purpose and risk profile                   | Section 2.2 - SCP-to-OU Mapping Table       | **Complete** |
| Define exception handling and governance approval processes for policy deviations      | Section 6 - Exception Process               | **Complete** |
| Define SCP lifecycle management, review, and update procedures                         | Section 7 - Lifecycle & Cadence             | **Complete** |
| Validate SCP design against Landing Zone governance requirements                       | Section 8 - Design Validation Matrix        | **Complete** |
| Conduct stakeholder review of SCP strategy and guardrail framework                     | Section 9 - Stakeholder Review              | **Pending**  |
| Obtain design approval and governance sign-off                                         | Section 9 - Sign-off Table                  | **Pending**  |

# 2. SCP Hierarchy & OU Inheritance Model (WI-1542292)

## 2.1 ESC-Specific Partition Facts

**IMPORTANT:** The AWS European Sovereign Cloud uses partition aws-eusc and region eusc-de-east-1. All ARNs use the prefix arn:aws-eusc: (not arn:aws:). Standard AWS EU regions such as eu-central-1 are a separate partition and cannot be used in this Landing Zone.

|               |                                |                                                                      |
|---------------|--------------------------------|----------------------------------------------------------------------|
| **Attribute** | **Value**                      | **Design Implication**                                               |
| Partition     | **aws-eusc**                   | All ARNs, endpoints, and console URLs differ from commercial AWS     |
| Region        | **eusc-de-east-1**             | Only approved region for all workload deployment                     |
| ARN prefix    | **arn:aws-eusc:**              | Every SCP condition referencing a principal ARN must use this prefix |
| Console URL   | console.amazonaws-eusc.eu      | Separate login portal from commercial AWS console                    |
| AFT / CfCT    | **NOT available in ESC**       | SCPs deployed via AWS CDK using Organizations APIs                   |
| CT LZ + SSO   | **NOT integrated at CT level** | IAM Identity Center configured independently from Control Tower      |

## 2.2 OU Hierarchy & SCP Inheritance

SCPs follow a top-down inheritance model within AWS Organizations. A policy attached at a higher level restricts all child OUs and accounts. The effective permissions of any principal are the intersection of all SCPs in the inheritance chain. An explicit Deny in any SCP in the chain overrides all other policies.

|           |                                                                |                                                                                     |                                                                                                                                                                                                                                                                                                                   |
|-----------|----------------------------------------------------------------|-------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Level** | **OU / Account**                                               | **SCPs Assigned**                                                                   | **Design Intent**                                                                                                                                                                                                                                                                                                 |
| **L0**    | **ESC Root OU**                                                | SCP-ESC-ROOT-001 SCP-ESC-ROOT-002 SCP-ESC-ROOT-003 SCP-ESC-ROOT 004 SCP-ESC-ENC-001 | Absolute, non-overridable guardrails. Region lock to eusc-de-east-1. Root user elimination. Governance protection. Approved service list. Applied to every account in the organization.                                                                                                                           |
| **L1**    | **Security OU**                                                | SCP-ESC-SEC-001 SCP-ESC-SEC-002 SCP-ESC-SEC-003                                     | Protect audit tooling: CloudTrail, Config, GuardDuty, Security Hub. Protect Log Archive S3 Object Lock (WORM). Protect Config Aggregator (new control, Section 3.7). Inspector and Macie excluded - not available in ESC.                                                                                         |
| **L1**    | **Infrastructure OU**                                          | SCP-ESC-INF-001                                                                     | Centralise VPC and Transit Gateway management to the Network account. Prevent spoke accounts from creating their own internet gateways, VPCs or VPC peering connections.                                                                                                                                          |
| **L1**    | **Sandbox OU**                                                 | SCP-ESC-SBX-001                                                                     | Cost guardrails - critical in ESC (no Free Tier, ~15-17% premium). Block expensive GPU instances, NAT Gateways, and unauthorised Reserved Instance purchases. No mandatory tagging requirement (exempt by design)                                                                                                 |
| **L1**    | **Suspended OU**                                               | SCP-ESC-SUS-001                                                                     | Full quarantine - deny ALL API actions. Applied to accounts awaiting permanent closure.                                                                                                                                                                                                                           |
| **L1**    | **Workloads OU**                                               | SCP-ESC-WL-001 SCP-ESC-WL-002 SCP-ESC-WL-003 SCP-ESC-WL-004 SCP-ESC-ENC-002         | Baseline for all workload accounts: encryption at rest, TLS in transit, SSO-only identity, and mandatory tags on all taggable resources. Applies to Hybrid, Online, and Corp sub-OUs.                                                                                                                             |
| **L2**    | **Workloads / Hybrid**                                         | (SCP-ESC-WL-001 to 004 (inherited)                                                  | On-premises connected workloads. Separate Direct Connect or VPN required - no cross-partition networking to commercial AWS.                                                                                                                                                                                       |
| **L2**    | **Workloads / Online**                                         | (inherits Workloads OU SCPs) + SCP-ESC-NET-001                                      | Internet-facing workloads. WAF mandatory on all public ALBs. CloudFront not yet available in ESC - ALB serves as edge layer.                                                                                                                                                                                      |
| **L2**    | **Workloads / Corp**                                           | SCP-ESC-WL-001 to 004 (inherited)                                                   | Internal corporate workloads. No public endpoints permitted.                                                                                                                                                                                                                                                      |
| **L3**    | **Hybrid / Prod \| Online / Prod \| Corp / Prod**              | (inherits Workloads OU SCPs) + SCP-ESC-PROD-001                                     | Prod is an Organizational Unit at L3, nested under each of Hybrid, Online, and Corp - one Prod OU per sub-OU family, NOT an account. Strictest controls. Stack deletion denied, SSM direct access restricted to maintenance windows, public S3 ACLs denied. Only the approved CDK pipeline role can make changes. |
| **L3**    | **Hybrid / Non-prod \| Online / Non- Prod \| Corp / Non-Prod** | (inherits Workloads OU SCPs only)                                                   | Non-Prod is an Organizational Unit at L3, nested under each of Hybrid, Online, and Corp. Dev and staging workloads. Relaxed change controls, sovereignty, encryption, and identity guardrails remain fully enforced. Mandatory tagging applies (see Section 6.1).                                                 |

## 2.3 Complete SCP Inventory - 22 Policies

|                      |          |               |                                                                                        |                      |
|----------------------|----------|---------------|----------------------------------------------------------------------------------------|----------------------|
| **SCP / RCP ID**     | **Type** | **Target OU** | **Control Summary**                                                                    | **Work Item(s)**     |
| **SCP-ESC-ROOT-001** | **SCP**  | Root          | Deny all API calls outside eusc-de-east-1                                              | WI-1542293           |
| **SCP-ESC-ROOT-002** | **SCP**  | Root          | Deny all root user API actions                                                         | WI-1542296           |
| **SCP-ESC-ROOT-003** | **SCP**  | Root          | Deny SCP/RCP governance tampering by member accounts                                   | WI-1542292 / 1542293 |
| **SCP-ESC-ROOT-004** | **SCP**  | Root          | Deny use of services not on the approved ESC service list (incl, LightSail, Beanstalk) | WI-1542293           |
| **SCP-ESC-SEC-001**  | **SCP**  | Root          | Protect CloudTrail, Config, GuardDuty, Security Hub from deletion                      | WI-1542297           |
| **SCP-ESC-SEC-002**  | **SCP**  | Security OU   | Protect S3 Object Lock (WORM) on Log Archive buckets                                   | WI-1542297           |
| **SCP-ESC-SEC-003**  | **SCP**  | Security OU   | Protect Config Aggregator from deletion                                                | WI-1542297           |
| **SCP-ESC-ENC-001**  | **SCP**  | Root          | KMS CMK lifecycle protection (deletion/disable/rotation/policy guards)                 | WI-1542294           |
| **SCP-ESC-ENC-002**  | **SCP**  | Workloads OU  | Deny unencrypted DynamoDB/MSK/SQS/SNS/EFS/ElastiCache                                  | WI-1542294           |
| **SCP-ESC-INF-001**  | **SCP**  | Infra OU      | Centralise VPC/TGW to Network account; deny rogue IGWs, VPC creation, and peering      | WI-1542298           |
| **SCP-ESC-WL-001**   | **SCP**  | Workloads OU  | Deny unencrypted S3/EBS/RDS - CMK mandatory                                            | WI-1542294           |
| **SCP-ESC-WL-002**   | **SCP**  | Root          | Enforce TLS 1.2+ on S3 and ELB; deny HTTP access                                       | WI-1542294           |
| **SCP-ESC-WL-003**   | **SCP**  | Root          | Deny IAM user/key creation; enforce SSO-only access                                    | WI-1542296           |
| **SCP-ESC-WL-004**   | **SCP**  | Workloads OU  | Mandatory tags on ALL taggable resources: (Prod/Staging/Dev); Sandbox exempt           | WI-1542298           |
| **SCP-ESC-IAM-001**  | **SCP**  | Workloads OU  | Deny privilege escalation via IAM policy attach/create                                 | WI-1542296           |
| **SCP-ESC-IAM-002**  | **SCP**  | Workloads OU  | Deny external cross-account trust policies (supply chain)                              | WI-1542296 / 1542293 |
| **SCP-ESC-NET-001**  | **SCP**  | Online OU     | Require WAF on internet-facing ALBs; deny public RDS                                   | WI-1542298           |
| **SCP-ESC-PROD-001** | **SCP**  | Prod OU       | Deny stack deletion, public S3 ACLs, unrestricted SSM access                           | WI-1542297 / 1542298 |
| **SCP-ESC-SBX-001**  | **SCP**  | Sandbox OU    | Cost guardrails: no GPU instances, NAT GWs, RI purchases                               | WI-1542298           |
| **SCP-ESC-SUS-001**  | **SCP**  | Suspended OU  | Deny ALL actions - full quarantine                                                     | WI-1542298           |
| **RCP-ESC-S3-001**   | **RCP**  | Root          | Block all external principals from ESC S3 (data perimeter)                             | WI-1542293 / 1542294 |
| **RCP-ESC-KMS-001**  | **RCP**  | Root          | Block external principals from ESC KMS decrypt/generate                                | WI-1542294           |

## 2.4 SCP Limit Consideration

AWS Organizations enforces a limit of a maximum of 10 Service Control Policies directly attached to any single node - root, OU, or account. This limit applies independently to each node and does NOT include policies inherited from parent OUs above it in the hierarchy.

## Worked Example

Take any AWS account sitting inside the Online / Prod OU (for example, a production customer-portal account). That account has no SCPs directly attached to itself in this design - instead, it inherits every policy attached to each OU above it in the chain:

| **Level** | **OU**                             | **SCPs Directly Attached Here**                 | **Count** |
|-----------|------------------------------------|-------------------------------------------------|-----------|
| **L0**    | **Root**                           | ROOT-001, ROOT-002, ROOT-003, ROOT-004, ENC-001 | **5**     |
| **L1**    | **Workloads**                      | WL-001, WL-002, WL-003, WL-004, ENC-002         | **5**     |
| **L2**    | **Online**                         | NET-001                                         | **1**     |
| **L3**    | **Prod**                           | PROD-001                                        | **1**     |
|           | **Total inherited by the account** |                                                 | **12**    |

**The key point:** the account ends up governed by 12 SCPs in total - more than the 10-per-node limit - and this is completely fine. The 10-policy cap only restricts how many SCPs can be directly attached to a single node. It does not cap how many policies an account can be subject to once you add up everything inherited from every OU above it.

In this design, no single node ever exceeds its own cap: Root has 5 directly attached, Workloads has 5 directly attached - both comfortably under the limit of 10, leaving room to add more controls later at either level without needing to restructure the OU hierarchy.

# 3. Sovereignty & Security Monitoring SCPs (WI-1542293, WI-1542297)

## 3.1 SCP-ESC-ROOT-001 - Deny Non-ESC Regions \[CRITICAL\]

|                        |              |                                                          |                                    |
|------------------------|--------------|----------------------------------------------------------|------------------------------------|
| **Attach To**          | **Priority** | **Framework**                                            | **Work Item**                      |
| Root OU - ALL accounts | **CRITICAL** | BSI C5 / GDPR Art.44 / NIS2 Art.21(e) / NIST 800-53 SC-7 | WI-1542293 - Sovereignty guardrail |

**Purpose:** This is the single most important control in the ESC Landing Zone. It denies any API call to any region other than eusc-de-east-1, ensuring all workloads remain within the EU sovereign boundary. Global services (IAM, STS, Route53, Organizations, Support, Budgets, SSO) are exempted because they operate globally by design without storing data in a specific region.

**Exemptions:** The CDK pipeline role and the AWS Organizations service-linked role are excluded from this deny so that automated governance workflows can function.

**ESC-specific note:** The region value must be eusc-de-east-1. Principal ARNs must use the arn:aws-eusc: prefix. This SCP has ZERO exceptions - no workload may deploy outside this region under any circumstances.

## 3.2 SCP-ESC-ROOT-002 - Eliminate Root User API Access \[CRITICAL\]

|                        |              |                                            |                                        |
|------------------------|--------------|--------------------------------------------|----------------------------------------|
| **Attach To**          | **Priority** | **Framework**                              | **Work Item**                          |
| Root OU - ALL accounts | **CRITICAL** | NIS2 Art.21(j) / BSI C5 / NIST 800-53 AC-6 | WI-1542296 - Privileged access control |

**Purpose:** Denies all API actions performed using root user credentials across every account in the ESC organization. Root is the most privileged identity in any AWS account. By denying all root API calls at the SCP level, even if root credentials are compromised, they cannot be used.

**ESC-specific note:** The principal ARN condition uses arn:aws-eusc:iam::\*:root — not arn:aws:iam::\*:root. Also prevents creation of root access keys and root login profiles.

## 3.3 SCP-ESC-ROOT-003 - Protect SCP Governance \[CRITICAL\]

|                        |              |                                                  |                        |
|------------------------|--------------|--------------------------------------------------|------------------------|
| **Attach To**          | **Priority** | **Framework**                                    | **Work Item**          |
| Root OU - ALL accounts | **CRITICAL** | BSI C5 / Governance integrity / NIST 800-53 CM-5 | WI-1542292, WI-1542293 |

**Purpose:** Prevents any member account from creating, modifying, deleting, attaching, or detaching SCPs and RCPs. Only the management account CDK pipeline role can alter governance policies. This protects the entire guardrail framework from being bypassed by an insider or compromised account.

## 3.4 SCP-ESC-ROOT-004 - Approved Service Boundary \[HIGH\]

|                        |              |                                               |                                  |
|------------------------|--------------|-----------------------------------------------|----------------------------------|
| **Attach To**          | **Priority** | **Framework**                                 | **Work Item**                    |
| Root OU - ALL accounts | **HIGH**     | BSI C5 / EUCS Substantial+ / NIST 800-53 CM-7 | WI-1542293 - Service sovereignty |

**Purpose:** Restricts use to services explicitly available and approved for the ESC partition. Denies API calls to services not included on the approved ESC service catalogue. Note: Inspector v2 and Macie are NOT available in eusc-de-east-1 and therefore not in the approved list. The approved list is reviewed quarterly as AWS adds new services to ESC.

**Customer-Directed Denial: ***In addition to the approved service catalogue above, If Insurance has explicitly directed that **Amazon Lightsail and Amazon Elastic Beanstalk** be added to the denied services list and blocked at resource creation, regardless of their general availability status in the ESC partition. This SCP enforces that direction by denying lightsail:Create\* and Elastic Beanstalk resource creation API actions organization-wide.*

## 3.5 SCP-ESC-SEC-001 - Protect All Security Monitoring Services \[CRITICAL\]

|                        |              |                                           |                                     |
|------------------------|--------------|-------------------------------------------|-------------------------------------|
| **Attach To**          | **Priority** | **Framework**                             | **Work Item**                       |
| Root OU - ALL accounts | **CRITICAL** | NIS2 Art.21(b) / BSI C5 /NIST 800-53 AU-9 | WI-1542297 — Logging & auditability |

**Purpose:** Prevents deletion, stopping, or disabling of the core security monitoring services. This is the audit integrity guardrail - no member account can switch off the observability toolchain.

**Services protected:** AWS CloudTrail (org-wide trail - cannot be stopped, deleted, or modified); AWS Config (recorder and delivery channel - cannot be stopped or deleted); Amazon GuardDuty (detector - cannot be deleted or disassociated); AWS Security Hub (cannot be disabled or members removed).

**ESC-specific note:** Inspector v2 is excluded from this SCP because they are NOT available in eusc-de-east-1. Compensating controls for these gaps are documented in Section 8.

## 3.6 SCP-ESC-SEC-002 - Protect Log Archive WORM Immutability \[HIGH\]

|               |              |                                                   |                                  |
|---------------|--------------|---------------------------------------------------|----------------------------------|
| **Attach To** | **Priority** | **Framework**                                     | **Work Item**                    |
| Security OU   | **HIGH**     | BSI C5 / GDPR Art.32(b) / NIS2 / NIST 800-53 AU-9 | WI-1542297 - Audit log integrity |

**Purpose:** Protects the S3 Object Lock (WORM — Write Once Read Many) configuration on Log Archive buckets. Prevents deletion of any object, object version, or the Object Lock configuration itself. Audit logs must be immutable - once written they cannot be modified or deleted by anyone, including administrators.

## 3.7 SCP-ESC-SEC-003 — Protect Config Aggregator \[HIGH\]

| **Attach To** | **Priority** | **Framework**                                    | **Work Item**                       |
|---------------|--------------|--------------------------------------------------|-------------------------------------|
| Security OU   | **HIGH**     | NIS2 Art.21(b) / BSI C5 / NIST 800-53 AU-9, CM-3 | WI-1542297 — Logging & auditability |

**Purpose:** AWS Config Aggregator collects configuration and compliance data from every account into a single, central view - typically created in the Security OU's Audit account. If the aggregator or its aggregation authorizations are deleted, the organisation loses its ability to assess compliance posture across all accounts simultaneously. This control protects that aggregator from deletion or tampering by any principal other than the approved CDK pipeline role.

Actions denied (except for the CDK pipeline role):

1.  config:DeleteConfigurationAggregator - prevents deletion of the aggregator resource itself

2.  config:DeleteAggregationAuthorization - prevents source accounts from being deauthorized from sending data to the aggregator

3.  config:PutConfigurationAggregator - prevents unauthorised modification of the aggregator's account/region source list

**ESC-specific note:** As with other AWS Organizations-managed governance services in ESC, the Config Aggregator is deployed and protected via direct AWS Organizations and Config APIs through the CDK pipeline, since AWS Control Tower's built-in aggregator management is not available in ESC.

# 4. Encryption & Key Management SCPs (WI-1542294)

## 4.1 SCP-ESC-WL-001 - Encryption at Rest - CMK Mandatory \[HIGH\]

|               |              |                                                              |                                          |
|---------------|--------------|--------------------------------------------------------------|------------------------------------------|
| **Attach To** | **Priority** | **Framework**                                                | **Work Item**                            |
| Workloads OU  | **HIGH**     | GDPR Art.32(a) / BSI C5 / NIS2 Art.21(i) / NIST 800-53 SC-28 | WI-1542294 - Encryption & key management |

**Purpose:** Mandates customer-managed KMS CMKs (not AWS-managed SSE-S3 keys) for all data at rest across workload accounts. This ensures the organization retains control of all key material, which never leaves eusc-de-east-1.

**Services covered:**

- Amazon S3 - deny PutObject without SSE-KMS header; deny PutBucketEncryption without KMS

- Amazon EBS - deny CreateVolume and RunInstances if volume not encrypted

- Amazon RDS - deny CreateDBInstance, CreateDBCluster, and RestoreDBInstanceFromDBSnapshot if StorageEncrypted is false

- AWS KMS - deny ScheduleKeyDeletion and DisableKey without MFA present

## 4.2 SCP-ESC-WL-002 - Enforce TLS 1.2+ In Transit \[HIGH\]

|                        |              |                                                             |                                    |
|------------------------|--------------|-------------------------------------------------------------|------------------------------------|
| **Attach To**          | **Priority** | **Framework**                                               | **Work Item**                      |
| Root OU - ALL accounts | **HIGH**     | GDPR Art.32(a) / BSI C5 / NIS2 Art.21(i) / NIST 800-53 SC-8 | WI-1542294 - Encryption in transit |

**Purpose:** Enforces encryption in transit by blocking HTTP access to S3 and deprecated TLS policy versions on Elastic Load Balancers.

**Services covered:**

- Amazon S3 — deny all object operations (GetObject, PutObject, DeleteObject and variants) unless aws:SecureTransport is true

- Elastic Load Balancing — deny CreateListener and ModifyListener if a legacy TLS security policy is specified (ELBSecurityPolicy-2016-08, ELBSecurityPolicy-TLS-1-0-2015-04, ELBSecurityPolicy-2015-05)

**ESC-specific note:** CloudFront is not yet available in eusc-de-east-1. Application Load Balancer serves as the internet-facing edge layer. This SCP ensures TLS 1.2 minimum on all ALB listeners.

## 4.3 RCP-ESC-S3-001 - S3 Data Perimeter \[HIGH\]

|                        |              |                                         |                        |
|------------------------|--------------|-----------------------------------------|------------------------|
| **Attach To**          | **Priority** | **Framework**                           | **Work Item**          |
| Root OU - ALL accounts | **RCP**      | GDPR Art.44 / BSI C5 / NIST 800-53 SC-7 | WI-1542293, WI-1542294 |

**Purpose:** Resource Control Policy that enforces the data perimeter at the resource side. Blocks any principal outside the ESC Organization from accessing any S3 bucket in any account - regardless of how the individual bucket policy is configured. This closes the gap that SCPs alone cannot address (SCPs only control identities WITHIN the org; RCPs control who can access the resource from ANY source).

**ESC-specific note:** RCP controls via AWS Control Tower are NOT available in ESC. This RCP is deployed directly via AWS Organizations APIs. The condition references the ESC Organization ID (\${ESC_ORG_ID}) - a completely separate org from any commercial AWS Organization.

## 4.4 RCP-ESC-KMS-001 - KMS Key Data Perimeter \[HIGH\]

|                        |              |                                          |                                        |
|------------------------|--------------|------------------------------------------|----------------------------------------|
| **Attach To**          | **Priority** | **Framework**                            | **Work Item**                          |
| Root OU - ALL accounts | **RCP**      | GDPR Art.32 / BSI C5 / NIST 800-53 SC-12 | WI-1542294 - Key management protection |

**Purpose:** Blocks any external principal (outside the ESC Organization) from performing key operations on ESC KMS CMKs. Prevents data encrypted with ESC keys from being decrypted by any entity outside the sovereign boundary - even if a CMK key policy mistakenly grants external access.

**Operations protected:** kms:Decrypt, kms:GenerateDataKey, kms:GenerateDataKeyWithoutPlaintext, kms:CreateGrant, kms:ReEncrypt, kms:DescribeKey.

**4.5 SCP-ESC-ENC-001 - KMS CMK Lifecycle Protection \[HIGH\]**

| **Attach To**          | **Priority** | **Framework**                                             | **Work Item**                   |
|------------------------|--------------|-----------------------------------------------------------|---------------------------------|
| Root OU - ALL accounts | **HIGH**     | GDPR Art.32 / BSI C5 / NIS2 Art.21(i) / NIST 800-53 SC-12 | WI-1542294 - KMS key management |

**Purpose:** Customer-managed KMS CMKs (Customer Master Keys) are the root of the encryption architecture in eusc-de-east-1. This SCP protects the entire lifecycle of every CMK - preventing scheduled deletion, disablement, external key policy changes, and key rotation being turned off. Key material never leaves the ESC partition.

**Controls enforced:**

- Deny kms:ScheduleKeyDeletion without MFA present - prevents accidental or malicious permanent key deletion which would make all encrypted data permanently unrecoverable.

- Deny kms:DisableKey without MFA present - prevents a CMK being disabled, which blocks all encryption/decryption operations using that key.

- Deny kms:PutKeyPolicy where the new policy would grant access to any principal outside the ESC organization (aws:PrincipalOrgID condition) - prevents CMKs from being shared with external accounts.

- Deny kms:DisableKeyRotation - automatic annual key rotation must remain enabled on all ESC CMKs. Manual rotation via kms:CreateKey with a new key alias is permitted.

- Deny kms:DeleteImportedKeyMaterial — protects CMKs that use imported key material (BYOK) from having their key material permanently deleted.

- Deny kms:TagResource and kms:UntagResource on CMKs unless the requesting role is the CDK pipeline role - prevents governance metadata tampering.

**ESC-specific note:** KMS CMKs in eusc-de-east-1 are partition-scoped. They cannot be shared with or used by commercial AWS accounts. The RCP-ESC-KMS-001 (Section 4.4) enforces this at the resource level. This SCP (ENC-001) enforces it at the identity level - defence in depth.

**Critical dependency**: If a CMK is deleted or disabled and there is no backup, all data encrypted with that key becomes permanently inaccessible. This SCP is therefore CRITICAL for data availability as well as security. Ensure an AWS Backup vault with KMS-independent metadata is configured before this SCP is enforced.

**4.6 SCP-ESC-ENC-002 - Deny Unencrypted Services (Extended Coverage) \[HIGH\]**

| **Attach To**               | **Priority** | **Framework**                                                | **Work Item**                             |
|-----------------------------|--------------|--------------------------------------------------------------|-------------------------------------------|
| Workloads OU - all accounts | **HIGH**     | GDPR Art.32(a) / BSI C5 / NIS2 Art.21(i) / NIST 800-53 SC-28 | WI-1542294 - Extended encryption coverage |

**Purpose:** SCP-ESC-WL-001 (Section 4.1) covers S3, EBS, and RDS. This policy (ENC-002) extends mandatory encryption coverage to the remaining ESC-available data services: Amazon DynamoDB, Amazon MSK (Kafka), Amazon SQS, Amazon SNS, and Amazon EFS. Together WL-001 and ENC-002 ensure no data service in any workload account can store or transmit data without CMK encryption.

**Services and controls:**

<table style="width:100%;">
<colgroup>
<col style="width: 16%" />
<col style="width: 28%" />
<col style="width: 25%" />
<col style="width: 30%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Service</strong></th>
<th><strong>Action Denied</strong></th>
<th><strong>Condition</strong></th>
<th><strong>Rationale</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Amazon DynamoDB</td>
<td>dynamodb:CreateTable</td>
<td>SSESpecification.SSEType not KMS</td>
<td>DynamoDB tables must use CMK-backed SSE — not AWS-owned keys</td>
</tr>
<tr class="even">
<td>Amazon MSK (Kafka)</td>
<td>kafka:CreateCluster,<br />
kafka:CreateClusterV2</td>
<td>EncryptionInTransit.clientBroker = PLAINTEXT or TLS_PLAINTEXT</td>
<td>All Kafka data in transit must be TLS-only. At-rest encryption enforced via CMK.</td>
</tr>
<tr class="odd">
<td>Amazon SQS</td>
<td>sqs:CreateQueue</td>
<td>Attribute KmsMasterKeyId is null/empty</td>
<td>SQS queues must be encrypted with a CMK — not SQS-managed encryption</td>
</tr>
<tr class="even">
<td>Amazon SNS</td>
<td>sns:CreateTopic</td>
<td>Attribute KMSMasterKeyId is null/empty</td>
<td>SNS topics carrying regulated data must be CMK-encrypted</td>
</tr>
<tr class="odd">
<td>Amazon EFS</td>
<td>elasticfilesystem:CreateFileSystem</td>
<td>Encrypted = false</td>
<td>EFS file systems must be encrypted at rest with a CMK</td>
</tr>
<tr class="even">
<td>Amazon ElastiCache</td>
<td>elasticache:CreateReplicationGroup<br />
elasticache:CreateServerlessCache</td>
<td>AtRestEncryptionEnabled = false</td>
<td>Redis cache clusters must encrypt data at rest and in transit</td>
</tr>
</tbody>
</table>

**ESC-specific note:** Amazon MSK is available in eusc-de-east-1 but note that MSK Serverless is not yet available in ESC. This SCP targets MSK Provisioned cluster creation. MSK encryption conditions use kafka: IAM condition keys, confirmed available in the ESC partition.

**★ ENC-001 + ENC-002 + WL-001 = complete encryption baseline:** *Together SCP-ESC-WL-001 (S3/EBS/RDS), SCP-ESC-ENC-001 (KMS CMK lifecycle), and SCP-ESC-ENC-002 (DynamoDB/MSK/SQS/SNS/EFS/ElastiCache) ensure 100% coverage of ESC-available data storage and messaging services. No workload account can create an unencrypted data resource.*

# 5. Identity, Access Management & Privileged Access SCPs (WI-1542296)

## 5.1 SCP-ESC-WL-003 - Deny IAM Users; Enforce SSO-Only Access \[HIGH\]

|                        |              |                                            |                               |
|------------------------|--------------|--------------------------------------------|-------------------------------|
| **Attach To**          | **Priority** | **Framework**                              | **Work Item**                 |
| Root OU - ALL accounts | **HIGH**     | NIS2 Art.21(j) / BSI C5 / NIST 800-53 IA-5 | WI-1542296 - Identity control |

**Purpose:** Prevents creation of long-lived IAM users and static access keys. All human access must flow through IAM Identity Center (SSO), which has been available in ESC since March 31, 2026. Static credentials are the most common breach vector in cloud environments - this SCP eliminates them entirely.

**Actions denied:** iam:CreateUser, iam:CreateLoginProfile, iam:CreateAccessKey, iam:UpdateAccessKey.

**Exemptions:** The CDK pipeline role and the IAM Identity Center service-linked role are excluded so that SSO configuration and automated deployments can function.

**Design dependency:** IAM Identity Center must be deployed and configured before this SCP is enforced. Verify SSO is operational and all users have permission sets assigned before activating.

## 5.2 SCP-ESC-IAM-001 - Deny Privilege Escalation \[HIGH\]

|               |              |                                            |                                |
|---------------|--------------|--------------------------------------------|--------------------------------|
| **Attach To** | **Priority** | **Framework**                              | **Work Item**                  |
| Workloads OU  | **HIGH**     | NIS2 Art.21(j) / BSI C5 / NIST 800-53 AC-6 | WI-1542296 - Privileged access |

**Purpose:** Prevents any non-pipeline role from escalating their own permissions by attaching additional policies, creating new policy versions, or modifying role policies. This stops a compromised developer role from granting itself administrative privileges.

**Actions denied:** iam:AttachRolePolicy, iam:PutRolePolicy, iam:CreatePolicyVersion, iam:SetDefaultPolicyVersion.

**Exemptions:** The CDK pipeline role and the AdministratorRole (break-glass) are excluded.

## 5.3 SCP-ESC-IAM-002 - Deny External Cross-Account Trust \[HIGH\]

|               |              |                                                         |                                          |
|---------------|--------------|---------------------------------------------------------|------------------------------------------|
| **Attach To** | **Priority** | **Framework**                                           | **Work Item**                            |
| Workloads OU  | **HIGH**     | NIS2 Art.21(d) Supply chain / BSI C5 / NIST 800-53 SR-3 | WI-1542296 - Supply chain access control |

**Purpose:** Prevents workload accounts from creating IAM roles that trust external AWS accounts outside the ESC Organization. Addresses NIS2 Article 21(d) supply chain security - third-party vendors cannot be granted access to ESC workloads without going through the approved governance process.

Also denies AWS RAM cross-account resource shares to principals outside the ESC Organization (ram:CreateResourceShare with AllowExternalPrincipals=true).

## 5.4 SCP-ESC-PROD-001 - Production Privileged Access Restrictions \[HIGH\]

|                                        |              |                                               |                                              |
|----------------------------------------|--------------|-----------------------------------------------|----------------------------------------------|
| **Attach To**                          | **Priority** | **Framework**                                 | **Work Item**                                |
| PROD OU (L3, under Hybrid/Online/Corp) | **HIGH**     | NIS2 Art.21(c)(j) / BSI C5 / NIST 800-53 CM-3 | WI-1542297, WI-1542298 - Prod change control |

**Purpose:** Three combined controls that protect the production environment from accidental or unauthorised changes:

- CloudFormation stack deletion protection - deny DeleteStack and UpdateTerminationProtection for all roles except the approved CDK pipeline role

- Public S3 ACL prevention - deny PutBucketAcl and PutObjectAcl with any public ACL value in production accounts

- SSM Session Manager restriction - deny StartSession and ResumeSession in production accounts unless the target EC2 instance carries a MaintenanceWindow=approved or MaintenanceWindow=emergency tag. The break-glass emergency role is the only permanent exemption.

# 6. Workload, Network & Cost SCPs (WI-1542298)

## 6.1 SCP-ESC-WL-004 - Mandatory Tagging on All Taggable Resources \[MEDIUM\]

|                                                    |              |                                                |                                         |
|----------------------------------------------------|--------------|------------------------------------------------|-----------------------------------------|
| **Attach To**                                      | **Priority** | **Framework**                                  | **Work Item**                           |
| Workloads OU (Prod, Staging, Dev – Sandbox exempt) | **MEDIUM**   | GDPR Art.30 / BSI C5 / EUCS / NIST 800-53 CM-8 | WI-1542298 - OU mapping by risk profile |

**Purpose:** In the ESC context, data classification is a regulatory obligation under GDPR Article 30 (Records of Processing Activities). This SCP denies creation of any taggable resource unless the four mandatory tags are provided at creation time: DataClassification, Owner, Environment, and CostCentre.

Mandatory tagging now applies to every taggable resource type already brought into scope elsewhere in this design - not just EC2, S3, and RDS. This includes:

- **Compute & Storage:** EC2 instances, EBS volumes, S3 buckets, RDS instances/clusters

- **Encrypted data services (from ENC-002 scope):** DynamoDB tables, MSK clusters, SQS queues, SNS topics, EFS file systems, ElastiCache replication groups

- **Compute & key resources:** Lambda functions, KMS keys

**Valid DataClassification values:** Public, Internal, Confidential, Restricted, Secret. Any other value (including missing) causes the API call to be denied. Also prevents removal of these tags from existing resources - once assigned, data classification tags are immutable.

**Sandbox Exemption:** Sandbox OU accounts are explicitly exempt from this mandatory tagging requirement. Sandbox is an ungoverned, cost-capped exploration environment that must never hold production or classified data (see Section 6.4, SBX-001) - imposing data classification tagging there would add governance overhead without a corresponding data protection benefit.

## 6.2 SCP-ESC-INF-001 - Centralize Network Management \[HIGH\]

|                   |              |                                            |                                           |
|-------------------|--------------|--------------------------------------------|-------------------------------------------|
| **Attach To**     | **Priority** | **Framework**                              | **Work Item**                             |
| Infrastructure OU | **HIGH**     | NIS2 Art.21(e) / BSI C5 / NIST 800-53 SC-7 | WI-1542298 - Network account risk profile |

**Purpose:** Prevents workload accounts from creating their own internet gateways or VPC peering connections to external parties. All VPC creation and Transit Gateway management is centralised to the Network account within the Infrastructure OU. This ensures the network perimeter is controlled centrally and not fragmented across accounts.

**Actions denied (except for Network account CDK role):** ec2:CreateVpc, ec2:CreateInternetGateway, ec2:AttachInternetGateway, ec2:AcceptVpcPeeringConnection with external principals.

## 6.3 SCP-ESC-NET-001 - WAF on Internet-Facing ALBs \[MEDIUM\]

|                     |              |                                            |                                     |
|---------------------|--------------|--------------------------------------------|-------------------------------------|
| **Attach To**       | **Priority** | **Framework**                              | **Work Item**                       |
| Workloads/Online OU | **MEDIUM**   | NIS2 Art.21(e) / BSI C5 / NIST 800-53 SC-7 | WI-1542298 - Online OU risk profile |

**Purpose:** Requires a WAF Web ACL association tag on all internet-facing Application Load Balancers created in the Online OU. Prevents deployment of unprotected public-facing endpoints. Also denies creation of publicly accessible RDS instances (rds:PubliclyAccessible=true).

**ESC-specific note:** CloudFront and Firewall Manager are not yet available in eusc-de-east-1. WAF is available and ALB is the primary internet edge layer. This SCP compensates for the absence of Firewall Manager's centralized WAF enforcement.

## 6.4 SCP-ESC-SBX-001 - Sandbox Cost Guardrails \[MEDIUM\]

|               |              |                       |                                           |
|---------------|--------------|-----------------------|-------------------------------------------|
| **Attach To** | **Priority** | **Framework**         | **Work Item**                             |
| Sandbox OU    | **MEDIUM**   | FinOps / Cost Control | WI-1542298 - Sandbox account risk profile |

**Purpose:** Controls cost in sandbox accounts. This SCP is MORE critical in ESC than in commercial AWS because there is NO Free Tier in eusc-de-east-1 and the platform carries an approximate 15-17% cost premium over comparable EU regions.

**Controls:**

- Deny ec2:RunInstances for expensive instance families: \*.24xlarge, \*.32xlarge, \*.48xlarge, \*.metal, p3.\*, p4.\*, p5.\*, g5.\*, trn1.\*, inf2.\*

- Deny ec2:CreateNatGateway - high hourly cost, not needed in sandbox environments

- Deny ec2:PurchaseReservedInstancesOffering, savingsplans:CreateSavingsPlan, rds:PurchaseReservedDBInstancesOffering - except for the approved FinOps role

## 6.5 SCP-ESC-SUS-001 - Suspended Account Quarantine \[CRITICAL\]

|               |              |                                                 |                                             |
|---------------|--------------|-------------------------------------------------|---------------------------------------------|
| **Attach To** | **Priority** | **Framework**                                   | **Work Item**                               |
| Suspended OU  | **CRITICAL** | Security / Account lifecycle / NIST 800-53 AC-2 | WI-1542298 - Suspended account risk profile |

**Purpose:** Applies a full quarantine to accounts that are awaiting permanent closure. Denies ALL API actions (Action: \*) with no exemptions. An account moved to the Suspended OU is completely locked - no service can be accessed, no data can be extracted, and no configuration can be changed until the account is permanently closed.

# 7. Exception Handling & Governance Approval (WI-1542301)

No SCP framework is complete without a documented, auditable exception process. All exceptions to the ESC SCP guardrails must follow this workflow. Exceptions are time-bounded and automatically expire.

## 7.1 Exception Categories & Approvers

|              |                                                         |                                       |                                        |
|--------------|---------------------------------------------------------|---------------------------------------|----------------------------------------|
| **Category** | **Example**                                             | **Approver**                          | **Maximum Duration**                   |
| Standard     | Sandbox needs larger instance for performance test      | Cloud Platform Lead                   | 30 days                                |
| Security     | Temporary CloudTrail stop during audit tool migration   | CISO + Cloud Platform Lead            | 72 hours - continuously monitored      |
| Sovereignty  | External CI/CD system requires cross-account access     | CISO + Legal + Cloud Governance Board | Duration of project - quarterly review |
| Regulatory   | Encryption exception for legacy system during migration | Compliance Officer + CISO             | Until migration is complete            |

ABSOLUTE RULE **SCP-ESC-ROOT-001** (sovereignty lock to eusc-de-east-1) has ZERO exceptions. Any request to deploy workloads outside eusc-de-east-1 is automatically rejected and escalated to the Cloud Governance Board as a governance incident. This policy is the foundation of the EU sovereignty commitment.

## 7.2 Exception Workflow

Exception SCPs are deployed at ACCOUNT level (Step 4 below), never at OU level, so exceptions never leak to sibling accounts in the same OU.

|          |               |                                                                                                                                                                                                                                                             |                                                        |
|----------|---------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| **Step** | **Stage**     | **Action**                                                                                                                                                                                                                                                  | **Outcome**                                            |
| **1**    | **Request**   | Engineer submits ITSM ticket using the Governance Exception template. Documents business justification, affected SCP IDs, target OU/account, requested duration, and risk assessment.                                                                       | Ticket created and assigned to Cloud Platform Team     |
| **2**    | **Triage**    | Cloud Platform Team reviews within 1 business day. Classifies exception type. Rejects immediately if ROOT-001 is involved.                                                                                                                                  | Exception classified or immediately rejected           |
| **3**    | **Review**    | Relevant approvers (per table above) review within 3 business days. Sovereignty exceptions require Cloud Governance Board quorum.                                                                                                                           | Approved or rejected with documented reason            |
| **4**    | **Implement** | Cloud Platform Team deploys a time-bounded exception SCP at ACCOUNT level (not OU level) via CDK, scoped to the single requesting account only – this is how account-specific exemptions are achieved without affecting aby sibling account in the same OU. | Scoped temporary SCP deployed to specific account only |
| **5**    | **Monitor**   | Lambda function creates a CloudWatch Alarm for the exception duration. Security Hub finding generated automatically. CISO receives daily briefing while exception is active.                                                                                | Continuous monitoring and alerting active              |
| **6**    | **Expire**    | Lambda automatically removes the exception SCP on the configured expiry date. Confirmation email sent to requestor and CISO. Re-approval required for any extension.                                                                                        | Exception SCP automatically removed                    |
| **7**    | **Audit**     | All exceptions are logged in the Governance Exception Register (maintained in SharePoint/Confluence). Cloud Governance Board reviews the register at every quarterly governance meeting.                                                                    | Full audit trail in Governance Exception Register      |

# 8. SCP Lifecycle Management (WI-1542302)

SCPs are treated as Infrastructure-as-Code (IaC) and managed through a GitOps pipeline using AWS CDK (TypeScript). Every change is a peer-reviewed Git commit - fully auditable and compliant with BSI C5 change management requirements. The lifecycle process below is a design-phase description; CDK deployment details are in scope for the implementation phase.

## 8.1 GitOps Change Pipeline

|        |                       |                                                                                                                                                                                                         |                                                                                                 |
|--------|-----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| **\#** | **Stage**             | **Description**                                                                                                                                                                                         | **ESC-Specific Requirement**                                                                    |
| **1**  | **Branch**            | Engineer creates a feature branch in the SCP Git repository using the convention: feature/SCP-ESC-{DOMAIN}-{NNN}-description                                                                            | Branch naming must include SCP-ESC prefix to distinguish from commercial AWS SCP work           |
| **2**  | **Lint & Validate**   | Pre-commit hooks run JSON schema validation and OPA policy check. CDK unit tests validate correct region (eusc-de-east-1), ARN prefix (arn:aws-eusc:), and confirm no Inspector actions are referenced. | Automated test fails if arn:aws: prefix is detected or non-ESC region is referenced             |
| **3**  | **Peer Review**       | Pull request requires 2 approvals: 1 from Cloud Platform team and 1 from Security team. Reviewer checklist explicitly confirms ESC partition correctness.                                               | Reviewer must confirm eusc-de-east-1 and arn:aws-eusc: throughout all policy statements         |
| **4**  | **Sandbox Soak**      | CDK deploys SCP to ESC Sandbox OU. 48-hour observation period. Integration tests run against eusc-de-east-1 endpoints to confirm expected deny/allow behaviour.                                         | Tests must use ESC credentials - not commercial AWS credentials. Test endpoint: eusc-de-east-1. |
| **5**  | **Impact Analysis**   | CDK diff command previews changes. AWS IAM Access Analyzer org-wide scan detects any unintended new denials on legitimate permissions.                                                                  | Run IAM Access Analyzer against ESC org (separate from commercial AWS org)                      |
| **6**  | **Production Deploy** | CDK deploys to target OU in ESC org. CloudTrail captures the event in eusc-de-east-1.                                                                                                                   | Verify CloudTrail entry in ESC Log Archive (separate from commercial CloudTrail)                |
| **7**  | **Notification**      | Stakeholder notification sent with change summary and link to CloudTrail event.                                                                                                                         | Link to ESC CloudTrail console (console.amazonaws-eusc.eu) — not commercial AWS console         |

## 8.2 Review Cadence

|                           |                                                                                                                                                               |                                       |
|---------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------|
| **Frequency**             | **Review Activity**                                                                                                                                           | **Owner**                             |
| Weekly                    | Automated drift detection - any SCP not in the Git repository triggers a P1 alert                                                                             | CI/CD pipeline (automated)            |
| Monthly                   | Exception register review. Expire overdue temporary exceptions. Config compliance dashboard review.                                                           | Cloud Platform Team                   |
| Quarterly                 | Full SCP coverage review against ESC service catalogue. Check for new services added to eusc-de-east-1 and update SCP-ESC-ROOT-004 approved list accordingly. | Cloud Governance Board                |
| Bi-annual                 | Independent penetration test of Landing Zone guardrails in ESC. Test attempts to bypass sovereignty, encryption, and identity SCPs.                           | External Security Partner + CISO      |
| Annually                  | Full framework review against updated BSI C5, NIS2 national transpositions, GDPR guidance, and ISO 27001:2022 requirements.                                   | Governance Board + Legal + Compliance |
| Ad-hoc: Service additions | When AWS adds new services to eusc-de-east-1 — assess each service against approved service list. Update SCP-ESC-ROOT-004 via GitOps pipeline.                | Platform Architect                    |
| Ad-hoc: Incident          | Post-incident SCP review — did any guardrail fail or have a gap? Add or tighten the relevant SCP via the GitOps pipeline.                                     | Security Team + Platform Team         |

# 9. SCP Design Validation Matrix (WI-1542303)

This matrix validates that the SCP design addresses every Landing Zone governance requirement and framework control. This is a design-phase validation - actual test execution against eusc-de-east-1 endpoints will be performed during the implementation phase.

|                                                                                  |                                    |                                                          |                                                                                                           |
|----------------------------------------------------------------------------------|------------------------------------|----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|
| **Governance Requirement**                                                       | **Enforcing SCP / RCP**            | **Framework Reference**                                  | **Design Coverage**                                                                                       |
| All workloads must remain in eusc-de-east-1                                      | **SCP-ESC-ROOT-001**               | GDPR Art.44 / BSI C5 / NIST 800-53 SC-7                  | Fully covered - deny all regions except eusc-de-east-1                                                    |
| Root user API access is prohibited                                               | **SCP-ESC-ROOT-002**               | NIS2 Art.21(j) / NIST 800-53 AC-6                        | Fully covered - deny all actions by root principal                                                        |
| SCP governance cannot be modified by member accounts                             | **SCP-ESC-ROOT-003**               | BSI C5 / Governance / NIST 800-53 CM-5                   | Fully covered - deny all policy modification actions                                                      |
| Only approved AWS services may be used (incl. Beanstalk/Lightsail denial)        | **SCP-ESC-ROOT-004**               | EUCS Substantial+ / BSI C5 / NIST 800-53 CM-7            | Fully covered - deny non-approved service calls                                                           |
| CloudTrail cannot be stopped or deleted                                          | **SCP-ESC-SEC-001**                | NIS2 Art.21(b) / BSI C5 / NIST 800-53 AU-9               | Fully covered - all trail actions denied                                                                  |
| Config Aggregator protected from deletion/tampering                              | **SCP-ESC-SEC-003**                | NIS2 Art.21(b) / NIST 800-53 AU-9                        | Fully covered - recorder and delivery channel protected                                                   |
| GuardDuty cannot be disabled                                                     | **SCP-ESC-SEC-001**                | NIS2 Art.21(b) / NIST 800-53 AU-9                        | Fully covered - detector delete and disassociate denied                                                   |
| Audit logs are immutable (WORM)                                                  | **SCP-ESC-SEC-002**                | GDPR Art.32(b) / BSI C5 / NIST 800-53 AU-9               | Fully covered - Object Lock protected on Log Archive S3                                                   |
| All data at rest encrypted with CMK                                              | **SCP-ESC-WL-001**                 | GDPR Art.32(a) / NIS2 21(i) / NIST 800-53 SC-28          | Fully covered - S3, EBS, RDS encrypted with KMS CMK                                                       |
| KMS CMK lifecycle protected (no deletion/disable without MFA; rotation enforced) | **SCP-ESC-ENC-001**                | GDPR Art.32(a) / BSI C5 / NIS2 21(i) / NIST 800-53 SC-12 | Fully covered - ScheduleKeyDeletion, DisableKey, DisableKeyRotation denied without MFA                    |
| Extended services (DynamoDB, MSK, SQS, SNS, EFS, ElastiCache) encrypted with CMK | **SCP-ESC-ENC-002**                | GDPR Art.32(a) / BSI C5 / NIS2 21(i) / NIST 800-53 SC-28 | Fully covered - CreateTable, CreateCluster, CreateQueue, CreateTopic, CreateFileSystem denied without CMK |
| All data in transit uses TLS 1.2 minimum                                         | **SCP-ESC-WL-002**                 | GDPR Art.32(a) / NIS2 21(i) / NIST 800-53 SC-8           | Fully covered - HTTP denied, legacy TLS policies blocked                                                  |
| No IAM users or static credentials permitted                                     | **SCP-ESC-WL-003**                 | NIS2 Art.21(j) / BSI C5 / NIST 800-53 IA-5               | Fully covered - CreateUser and CreateAccessKey denied                                                     |
| No privilege escalation via IAM                                                  | **SCP-ESC-IAM-001**                | NIS2 Art.21(j) / NIST 800-53 AC-6                        | Fully covered - AttachRolePolicy and PutRolePolicy denied                                                 |
| No external cross-account trust                                                  | **SCP-ESC-IAM-002**                | NIS2 Art.21(d) Supply chain / NIST 800-53 SR-3           | Fully covered - external trust denied, RAM share blocked                                                  |
| External principals cannot access S3 data                                        | **RCP-ESC-S3-001**                 | GDPR Art.44 / BSI C5 / NIST 800-53 SC-7                  | Fully covered - data perimeter via RCP at root level                                                      |
| External principals cannot decrypt KMS keys                                      | **RCP-ESC-KMS-001**                | GDPR Art.32 / BSI C5 / NIST 800-53 SC-12                 | Fully covered - KMS operations denied to external principals                                              |
| Production stacks cannot be deleted by non-pipeline roles (PROD OU)              | **SCP-ESC-PROD-001**               | NIS2 Art.21(c) BC/DR / NIST 800-53 CM-3                  | Fully covered - DeleteStack denied outside pipeline role                                                  |
| No public S3 ACLs in production                                                  | **SCP-ESC-PROD-001**               | GDPR Art.32 / BSI C5 / NIST 800-53 CM-3                  | Fully covered - public ACL values denied in Prod Account                                                  |
| SSM direct access restricted in production                                       | **SCP-ESC-PROD-001**               | NIS2 Art.21(j) / BSI C5 / NIST 800-53 CM-3               | Fully covered -StartSession requires maintenance window tag                                               |
| All taggable resources carry mandatory tags (Prod/Staging/Dev; Sandbox exempt)   | **SCP-ESC-WL-004**                 | GDPR Art.30 / NIST 800-53 CM-8                           | Fully covered - resource creation denied without tags                                                     |
| VPC creation and network management centralised to Network account               | **SCP-ESC-INF-001**                | NIS2 Art.21(e) / BSI C5 / NIST 800-53 SC-7               | Fully covered - IGW creation denied in spoke accounts                                                     |
| Internet-facing ALBs must have WAF protection                                    | **SCP-ESC-NET-001**                | NIS2 Art.21(e) / NIST 800-53 SC-7                        | Fully covered - ALB creation without WAF tag denied                                                       |
| Sandbox cost guardrails enforced (no Free Tier in ESC)                           | **SCP-ESC-SBX-001**                | FinOps / Cost governance                                 | Fully covered - expensive instances, NAT GWs denied                                                       |
| Suspended accounts are fully quarantined                                         | **SCP-ESC-SUS-001**                | Security / Account lifecycle                             | Fully covered - deny ALL actions in Suspended OU                                                          |
| Inspector v2 vulnerability management                                            | NOT via SCP - compensating control | NIS2 Art.21(f) / NIST 800-53 AC-2                        | GAP: Inspector not in ESC. Compensating: SSM Patch Manager                                                |

# 10. Stakeholder Review & Design Sign-Off (WI-1542305, WI-1542306)

## 10.1 Review Process (WI-1542305)

- This document is distributed to all stakeholders listed in Section 10.2 for a 5-business-day review window.

- A review meeting is held on Day 6 to resolve open comments before sign-off.

- Any unresolved comments from the Security or Compliance stakeholder blocks sign-off.

## 10.2 Key Review Points for Client

21 policies total / 19 SCPs and 2 RCPs to “22 Policies total / 20 SCPs and 2 RCPs” to reflect the addition of SEC-003.

|                             |                                                                                                                                                                                                                                                                                                                                                                                                       |
|-----------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Review Point**            | **Design Decision**                                                                                                                                                                                                                                                                                                                                                                                   |
| Scope of this document      | Design phase only - defines WHAT SCPs will be implemented. CDK code and deployment steps are in the implementation phase document.                                                                                                                                                                                                                                                                    |
| 22 policies total           | **20** SCPs and **2** RCPs. Updated from 21 (19+2) following the addition of SCP-ESC-SEC-003 (Config Aggregator protection). Each addresses a specific governance requirement mapped to one or more work items under US-1542064.                                                                                                                                                                      |
| ESC partition specifics     | All SCPs use arn:aws-eusc: ARN prefix and eusc-de-east-1 region. These are verified correct per official docs.aws.eu documentation. Using arn:aws: would cause silent SCP failures.                                                                                                                                                                                                                   |
| AFT/CfCT not available      | AWS Control Tower AFT and CfCT are NOT available in ESC (confirmed by official AWS ESC User Guide). CDK is the correct and approved IaC approach.                                                                                                                                                                                                                                                     |
| 2 known service gaps        | Inspector v2 and Macie are not available in eusc-de-east-1. Compensating controls (SSM Patch Manager and CloudTrail S3 data events) are documented in Section 9.                                                                                                                                                                                                                                      |
| RCPs deployed independently | RCP controls via Control Tower are NOT available in ESC. RCP-ESC-S3-001 and RCP-ESC-KMS-001 are deployed directly via AWS Organizations APIs from CDK.                                                                                                                                                                                                                                                |
| IAM Identity Center (SSO)   | Available in ESC from March 31, 2026. Control Tower Landing Zone does NOT auto-configure SSO in ESC - configured independently. SCP-ESC-WL-003 must be activated AFTER SSO is confirmed operational.                                                                                                                                                                                                  |
| No Free Tier - cost impact  | ESC carries ~15-17% cost premium and has no Free Tier. SCP-ESC-SBX-001 (cost guardrails in Sandbox OU) is therefore more critical in ESC than in commercial AWS.                                                                                                                                                                                                                                      |
| NIST 800-53 alignment       | NIST SP 800-53 is a US federal control catalogue (FISMA/FedRAMP) and is not a mandatory EU regulatory requirement for this Landing Zone. Several SCPs already satisfy recognised NIST 800-53 control families (e.g. AC, AU, CM, SC, IA, SR) - Refer the Framework column in each SCP definition and in the Validation Matrix (Section 9). No additional SCPs were required to achieve this alignment. |

## 

## 10.3 Design Approval Sign-Off (WI-1542306)

|                              |          |          |               |
|------------------------------|----------|----------|---------------|
| **Role**                     | **Name** | **Date** | **Signature** |
| **Cloud Platform Architect** |          |          |               |
| **CISO / Security Lead**     |          |          |               |
| **Compliance Officer**       |          |          |               |
