**AWS European Sovereign Cloud**

**IAM Role-Based Access Model & Identity Federation Strategy**

*Landing Zone IaC Access Governance - Design Phase Deliverable*

*Region: eusc-de-east-1 \| Partition: aws-eusc \| Brandenburg, Germany*

| **Field**                               | **Value**                                                                                                                                                                                                    |
|-----------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Document ID                             | US-1542067 \| ESC-IAM-IDENTITY-DESIGN-v1.0                                                                                                                                                                   |
| Phase                                   | Design Phase - IAM Role-Based Access Model & Identity Federation Strategy · No implementation code                                                                                                           |
| Version                                 | 1.0 - July 2026                                                                                                                                                                                              |
| Platform                                | AWS ESC \| Partition: aws-eusc \| Region: eusc-de-east-1 \| Tooling: AWS IAM Identity Center, corporate IdP federation (SAML 2.0/SCIM), AWS Organizations SCPs, GitHub Actions OIDC                          |
| Classification                          | Confidential - For Internal If Insurance Use Only                                                                                                                                                            |
| Companion Docs                          | ESC SCP Design Catalogue (US-1542064), ESC Security Baseline (US-1542065), ESC KMS & Encryption Strategy (US-1542066), ESC Centralized Logging Strategy (US-1542069), ESC GitOps CI/CD Pipeline (US-1542070) |
| Frameworks Alignment (Design Reference) | BSI C5:2020 \| NIS2 Art.21 \| ISO/IEC 27001:2022 A.5.15–A.5.18, A.8.2, A.8.15–A.8.16 \| NIST SP 800-53 AC / IA / AU controls \| CIS AWS Foundations Benchmark                                                |
| Status                                  | Draft - Pending Stakeholder Review and Approval (WI-1543618)                                                                                                                                                 |

# 

# 

# 

# 

# 

# 

# Table of Contents 

[Table of Contents [2](#section)](#section)

[Introduction [3](#section-6)](#section-6)

[Purpose [4](#purpose)](#purpose)

[Scope [4](#scope)](#scope)

[1. IAM and Identity Design Overview [5](#iam-and-identity-design-overview)](#iam-and-identity-design-overview)

[1.1 Work Package Completion Matrix [6](#work-package-completion-matrix)](#work-package-completion-matrix)

[2. IAM Operating Model [6](#iam-operating-model)](#iam-operating-model)

[2.1 ESC-Specific Identity and Access Facts [6](#esc-specific-identity-and-access-facts)](#esc-specific-identity-and-access-facts)

[2.2 IAM Design Principles [7](#iam-design-principles)](#iam-design-principles)

[3. Role Hierarchy and Landing Zone Personas (WI-1543611) [8](#role-hierarchy-and-landing-zone-personas-wi-1543611)](#role-hierarchy-and-landing-zone-personas-wi-1543611)

[3.1 Landing Zone Access Roles [8](#landing-zone-access-roles)](#landing-zone-access-roles)

[3.2 Role Hierarchy [9](#role-hierarchy)](#role-hierarchy)

[4. Cross-Account Access, Federation & Delegation Model (WI-1543613, WI-1543614) [11](#cross-account-access-federation-delegation-model-wi-1543613-wi-1543614)](#cross-account-access-federation-delegation-model-wi-1543613-wi-1543614)

[4.1 Cross-Account Access Overview [11](#cross-account-access-overview)](#cross-account-access-overview)

[4.1.1 OU and Account Scope [11](#ou-and-account-scope)](#ou-and-account-scope)

[4.1.2 Cross-Account Role Assumption [12](#cross-account-role-assumption)](#cross-account-role-assumption)

[Workload Non-Production Access [12](#workload-non-production-access)](#workload-non-production-access)

[Workload Production Access [12](#workload-production-access)](#workload-production-access)

[Sandbox OU Access [12](#sandbox-ou-access)](#sandbox-ou-access)

[Suspended OU Access [12](#suspended-ou-access)](#suspended-ou-access)

[Network Account Access [13](#network-account-access)](#network-account-access)

[4.2 Staging Cross-Account Access [13](#staging-cross-account-access)](#staging-cross-account-access)

[4.3 Production Cross-Account Access [13](#production-cross-account-access)](#production-cross-account-access)

[4.4 Delegated Administration Model [14](#delegated-administration-model)](#delegated-administration-model)

[4.5 Federated Identity Design [14](#federated-identity-design)](#federated-identity-design)

[4.6 Branch-to-Role Mapping [16](#branch-to-role-mapping)](#branch-to-role-mapping)

[4.7 GitHub OIDC and CDK Deployment Role Chain [16](#github-oidc-and-cdk-deployment-role-chain)](#github-oidc-and-cdk-deployment-role-chain)

[4.8 IAM Rollback, Drift Detection and Audit Correlation [17](#iam-rollback-drift-detection-and-audit-correlation)](#iam-rollback-drift-detection-and-audit-correlation)

[4.9 Permissions Boundaries and Privilege-Escalation Prevention [17](#permissions-boundaries-and-privilege-escalation-prevention)](#permissions-boundaries-and-privilege-escalation-prevention)

[4.10 Identity Lifecycle, Root and Machine Identity Governance [17](#identity-lifecycle-root-and-machine-identity-governance)](#identity-lifecycle-root-and-machine-identity-governance)

[5. Role-to-Permission Matrix (WI-1543612) [18](#role-to-permission-matrix-wi-1543612)](#role-to-permission-matrix-wi-1543612)

[5.1 Landing Zone Role Matrix [18](#landing-zone-role-matrix)](#landing-zone-role-matrix)

[5.1.1 Central Landing Zone and Infrastructure Accounts [18](#central-landing-zone-and-infrastructure-accounts)](#central-landing-zone-and-infrastructure-accounts)

[5.1.2 Sandbox, Suspended, and Workload Account Patterns [19](#sandbox-suspended-and-workload-account-patterns)](#sandbox-suspended-and-workload-account-patterns)

[5.2 Permission Level Definitions [20](#permission-level-definitions)](#permission-level-definitions)

[6. Emergency Break-Glass Access (WI-1543616) [20](#emergency-break-glass-access-wi-1543616)](#emergency-break-glass-access-wi-1543616)

[6.1 Break-Glass Principles [20](#break-glass-principles)](#break-glass-principles)

[6.2 Break-Glass Role [21](#break-glass-role)](#break-glass-role)

[6.3 Break-Glass Usage Scenarios [21](#break-glass-usage-scenarios)](#break-glass-usage-scenarios)

[6.4 Break-Glass Controls [21](#break-glass-controls)](#break-glass-controls)

[6.5 Break-Glass Cross-Account Access Model [22](#break-glass-cross-account-access-model)](#break-glass-cross-account-access-model)

[6.6 Break-Glass Process [23](#break-glass-process)](#break-glass-process)

[7. Least-Privilege and Governance Validation (WI-1543617) [23](#least-privilege-and-governance-validation-wi-1543617)](#least-privilege-and-governance-validation-wi-1543617)

[7.1 Least-Privilege Validation Checklist [23](#least-privilege-validation-checklist)](#least-privilege-validation-checklist)

[7.2 Governance Validation Matrix [25](#governance-validation-matrix)](#governance-validation-matrix)

[7.3 IAM Drift Detection and Reconciliation [28](#iam-drift-detection-and-reconciliation)](#iam-drift-detection-and-reconciliation)

[8. Privileged Access Management and Administrative Access Model (WI-1543615) [29](#privileged-access-management-and-administrative-access-model-wi-1543615)](#privileged-access-management-and-administrative-access-model-wi-1543615)

[8.1 Privileged Access Requirements [29](#privileged-access-requirements)](#privileged-access-requirements)

[8.2 Privileged Access Management Controls [29](#privileged-access-management-controls)](#privileged-access-management-controls)

[8.3 Administrative Access Model [30](#administrative-access-model)](#administrative-access-model)

[9. Stakeholder Review & Approval (WI-1543618) [31](#stakeholder-review-approval-wi-1543618)](#stakeholder-review-approval-wi-1543618)

[9.1 Joint Delivery Responsibilities [31](#joint-delivery-responsibilities)](#joint-delivery-responsibilities)

[9.2 Review Process [31](#review-process)](#review-process)

[9.3 Open Design Decisions for Client Confirmation [32](#open-design-decisions-for-client-confirmation)](#open-design-decisions-for-client-confirmation)

[9.4 Approval Sign-Off [33](#approval-sign-off)](#approval-sign-off)

# 

# 

# Introduction

This document defines the IAM Role-Based Access Model and Identity Federation Strategy for the AWS European Sovereign Cloud (ESC) Landing Zone for If Insurance. The design establishes a secure, governed, and auditable access model for Landing Zone administration, security operations, compliance review, cross-account access, CI/CD deployments, privileged access, and emergency access.

**DOCUMENT OWNERSHIP**. This design document has been prepared and maintained by Hexaware as part of the AWS ESC Landing Zone design-phase deliverables. Implementation of the CDK-based Staging Landing Zone is jointly performed by Hexaware and If Insurance, while formal pull-request, deployment-promotion and Production-release approvals remain with authorized If Insurance reviewers.

This document is aligned with the finalised GitOps CI/CD Pipeline Governance Model (US-1542070):

- feature/\* branches are used for development.

- Merges to develop trigger automatic CDK deployment to the Staging AWS Organization.

- Merges to main trigger deployment to the Production AWS Organization after successful Staging validation and approval by at least one authorized IF Insurance reviewer who is independent of the release creator.

- GitHub Actions uses OIDC-based federation and does not use long-lived AWS access keys.

Deployment evidence links the GitHub PR, commit SHA, Git Tag and applicable ITSM/CAB reference to the GitHub Actions execution and corresponding CloudTrail/CloudFormation activity.

- config/develop.yaml is used for Staging deployments; config/production.yaml is used for Production deployments.

- The Staging AWS Organization contains one test workload account under each workload OU (Online, Hybrid, Corp). Production contains the full approved workload account structure.

| **ESC partition and service-availability note. All IAM resources and trust policies use the aws-eusc partition (ARN prefix: arn:aws-eusc:, STS endpoint: sts.eusc-de-east-1.amazonaws.eu). AWS IAM Identity Center is available and is the approved centralized workforce access service for the ESC Landing Zone. Human access is federated from the If Insurance corporate IdP to IAM Identity Center and granted through groups, Permission Sets, and account assignments. GitHub Actions continues to use OIDC-assumed deployment roles. Security Hub and Inspector are not assumed; security monitoring uses GuardDuty, AWS Config, CloudTrail, and Microsoft Sentinel. Commercial AWS endpoints and ARN prefixes must not be used.** |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## Purpose

- Define the IAM role hierarchy for Landing Zone personas.

- Define cross-account access and delegation model.

- Define federated identity integration requirements and access patterns.

- Define the role-to-permission matrix for Landing Zone accounts and services.

- Define privileged access management and administrative access model.

- Define emergency break-glass access requirements and governance controls.

- Validate the access model against least-privilege and governance requirements.

- Align IAM and access governance with the approved GitOps branching and deployment strategy.

## Scope

This document is limited to the design phase of the Landing Zone IAM and Access Management model. It defines the target access architecture, governance requirements, roles, and access-control principles, and does not include implementation-level configurations such as IAM policy definitions, trust policies, account assignments, or deployment workflow configurations.

**In scope:**

- Landing Zone IAM role model

- Persona-based access model

- Cross-account role assumption model

- Delegated administration model

- Federated identity integration requirements

- GitHub Actions OIDC deployment roles

- Staging and Production access separation

- Privileged access model

- Emergency break-glass access model

- Role-to-permission matrix

- Least-privilege validation

- Access governance and audit requirements

**Out of scope:**

- Application-specific IAM roles

- End-user application access

- Detailed IAM policy JSON definitions and implementation

- Detailed GitHub Actions workflow YAML definitions

- HR identity lifecycle implementation

- Enterprise identity provider implementation details

- Application team access onboarding runbooks

# 1. IAM and Identity Design Overview

This IAM and federation model governs how human users, CI/CD pipelines, administrators, security teams, compliance reviewers, and emergency operators access the AWS ESC Landing Zone. The model is based on:

- Federated workforce identity through the If Insurance corporate IdP integrated with AWS IAM Identity Center.

- Role-based access control for Landing Zone personas.

- Cross-account IAM roles for delegated operations.

- GitHub Actions OIDC for automated CDK deployments.

- Separate deployment roles for Staging and Production AWS Organizations.

- Least-privilege permissions enforced by IAM policies and SCPs.

- Auditable access through CloudTrail across all accounts.

- Controlled privileged (JIT) and break-glass access.

| **RELATIONSHIP TO COMPANION DOCUMENT**S: IaC-managed IAM resources - including Permission Set definitions, IAM policies, deployment roles, OIDC trust policies, permissions boundaries and cross-account role configurations are maintained in the **aws-sc-landing-zone** repository and governed through the GitOps pipeline. Corporate IdP groups, user lifecycle activities and operational IAM Identity Center account assignments may be managed through approved identity-governance, IAM Identity Center or service-management processes. Changes not managed directly through IaC must remain approved, auditable and reconcilable with the documented access model. IaC changes follow feature/\* → develop (Staging deployment and validation) → main (Production deployment after approval by at least one authorized If Insurance reviewer who is independent of the change author or release creator). Additional stakeholder consultation and ITSM/CAB approval apply only where required by change classification, scope or risk. |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

## 1.1 Work Package Completion Matrix

| **Work Item** | **Type**   | **Title**                                                                                | **Addressed In** | **Status**   |
|---------------|------------|------------------------------------------------------------------------------------------|------------------|--------------|
| 1542067       | User Story | Design IAM Role-Based Access Model and Identity Federation Strategy for LZ               | Sections 1-9     | **Complete** |
| 1543611       | Task       | Define the role hierarchy and access model for Landing Zone personas                     | Section 3        | **Complete** |
| 1543612       | Task       | Create the role-to-permission matrix for Landing Zone accounts and services              | Section 5        | **Complete** |
| 1543613       | Task       | Define federated identity integration requirements and access patterns                   | Section 4        | **Complete** |
| 1543614       | Task       | Define cross-account access and delegation model                                         | Section 4        | **Complete** |
| 1543615       | Task       | Define privileged access management and administrative access model                      | Section 8        | **Complete** |
| 1543616       | Task       | Define emergency (break-glass) access requirements and governance controls               | Section 6        | **Complete** |
| 1543617       | Task       | Validate the access model against least-privilege principles and governance requirements | Section 7        | **Complete** |
| 1543618       | Task       | Conduct stakeholder review and obtain approval                                           | Section 9        | **Pending**  |

# 2. IAM Operating Model

## 2.1 ESC-Specific Identity and Access Facts

| **Attribute**                | **Value**                                                          | **Design implication**                                                                                                                                                                                                                                                                                                                                                    |
|------------------------------|--------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| AWS Partition                | aws-eusc                                                           | IAM policies, ARNs, and trust policies must use arn:aws-eusc:.                                                                                                                                                                                                                                                                                                            |
| AWS Region                   | eusc-de-east-1                                                     | Identity and deployment workflows must target the ESC region.                                                                                                                                                                                                                                                                                                             |
| ESC STS Endpoint             | sts.eusc-de-east-1.amazonaws.eu                                    | GitHub Actions OIDC and federated role trust policies must use the ESC STS endpoint.                                                                                                                                                                                                                                                                                      |
| CI/CD Authentication         | GitHub Actions OIDC                                                | No long-lived AWS access keys stored in GitHub Secrets.                                                                                                                                                                                                                                                                                                                   |
| Human Access                 | Corporate IdP federation to AWS IAM Identity Center                | Human users authenticate through the approved corporate IdP and receive short-lived access through IAM Identity Center Permission Sets and account assignments.                                                                                                                                                                                                           |
| IAM Identity Center          | Available and approved for the ESC Landing Zone                    | Provides centralized workforce access governance, group-to-Permission Set mapping, account assignments, MFA/session controls, and periodic access recertification.                                                                                                                                                                                                        |
| Security Monitoring          | GuardDuty, AWS Config, CloudTrail, Microsoft Sentinel              | Security Hub and Inspector are not assumed. Security monitoring uses GuardDuty, AWS Config, CloudTrail, and Microsoft Sentinel.                                                                                                                                                                                                                                           |
| Staging Deployment Branch    | develop                                                            | Merge to develop triggers automatic CDK deployment using config/develop.yaml to the Staging AWS Organization.                                                                                                                                                                                                                                                             |
| Production Deployment Branch | main                                                               | Merge to main, after successful Staging validation and approval by at least one authorized IF Insurance reviewer who is independent of the change author or release creator, triggers CDK deployment using config/production.yaml to the Production AWS Organization. An ITSM/CAB reference is required only where applicable under the agreed change-management process. |
| Staging Configuration        | config/develop.yaml                                                | Used for deployment to the Staging AWS Organization.                                                                                                                                                                                                                                                                                                                      |
| Production Configuration     | config/production.yaml                                             | Used for deployment to Production AWS Organization.                                                                                                                                                                                                                                                                                                                       |
| Staging Organization         | Validation environment — one test workload account per workload OU | Mirrors Production OU structure but contains only one test workload account per workload OU (Online, Hybrid, Corp).                                                                                                                                                                                                                                                       |
| Production Organization      | Live environment — full approved workload account structure        | All approved workload accounts (Non-Prod and Prod) under each workload OU.                                                                                                                                                                                                                                                                                                |

## 2.2 IAM Design Principles

- **Least privilege by default:** Permissions are limited to the minimum required for each persona's function.

- **Role-based access:** Human access is granted through IAM Identity Center Permission Sets mapped to Landing Zone personas, non-human deployment access uses dedicated OIDC-assumed IAM roles.

- **Separation of duties:** Platform, Security, Compliance, Network, Logging, and KMS responsibilities are separated across distinct roles.

- **Environment separation:** Staging and Production AWS Organizations are managed independently with separate account assignments, deployment roles, approval controls, and governance boundaries. Access is granted only through explicitly approved IAM Identity Center Permission Set assignments and role trust relationships. No access is inherited between environments, and any Production access must be explicitly authorized and governed separately from Staging access.

- **No long-lived credentials:** Pipelines use OIDC-based short-lived credentials. Human users receive short-lived IAM Identity Center role sessions**.**

- **Privileged access governance:** Administrative access requires JIT approval, MFA enforcement, and a full audit trail.

- **Break-glass as exception:** Emergency access is tightly controlled, ITSM-ticketed, CloudTrail-monitored, and subject to mandatory retrospective review.

- **Cross-account access is explicit:** Role assumption is limited through explicit trust policies, approved principals, approved accounts, and applicable SCP guardrails. Unapproved principals and role-assumption paths are denied.

- **All access is auditable and traceable:** CloudTrail records IAM role assumptions and AWS API activity across Staging and Production. Deployment and privileged-access evidence must correlate the AWS activity with the originating GitHub PR or approved access/change record, including the commit SHA, Git Tag, workflow run and applicable ITSM/CAB reference.

- **IAM changes are drift-aware:** cdk synth and cdk diff provide template-level comparison; CloudFormation drift detection is used where IAM resource types and properties are supported; and AWS Config, IAM Identity Center exports, service APIs and targeted validation scripts are used for partially supported or unsupported configuration. Material unexplained variance blocks deployment until reviewed and resolved or explicitly approved.

- **ESC correctness enforced:** All IAM policies and trust relationships must use arn:aws-eusc: and eusc-de-east-1.

# 3. Role Hierarchy and Landing Zone Personas (WI-1543611)

## 3.1 Landing Zone Access Roles

The following access roles are defined for the ESC Landing Zone. Each access role maps to one or more AWS IAM Identity Center Permission Sets with a defined account scope and access level.

| **Access Role**                    | **Responsibility**                                                                                                                                                   | **Access type**                 |
|------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------|
| **Cloud Platform Administrator**   | Landing Zone administration, OU and account governance, platform operations across Management, Security, Infrastructure, and approved workload accounts              | Privileged Admin (JIT)          |
| **Cloud Platform Engineer**        | CDK development and deployment support, Staging validation, and approved operational changes across Landing Zone infrastructure and representative workload accounts | Elevated Operational (JIT)      |
| **Security Administrator**         | Security baseline management, security monitoring, and remediation of findings (GuardDuty, AWS Config, CloudTrail, Microsoft Sentinel)                               | Security Admin                  |
| **Compliance / Audit Reviewer**    | Read-only compliance review, audit activities and evidence collection across Management, Security, Infrastructure, Sandbox, and Workload accounts                    | Read Only                       |
| **Network Administrator**          | Management of centralized networking services, including VPCs, Transit Gateway, routing, and connectivity governance in approved shared-network resources            | Network Admin                   |
| **KMS Administrator**              | KMS key lifecycle and key policy governance                                                                                                                          | KMS Admin                       |
| **Logging Administrator**          | Management and validation of centralized logging, CloudTrail, AWS Config, and Log Archive services                                                                   | Logging Admin                   |
| **Workload Account Owner**         | Scoped administration within assigned Non-Production or Production workload accounts under Hybrid, Online, or Corp                                                   | Scoped Admin                    |
| **GitHub Actions Deployment Role** | Automated CDK deployment through the GitOps pipeline using OIDC-based non-human authentication                                                                       | Pipeline Deploy                 |
| **Break-Glass Administrator**      | Emergency access through the Management Account and controlled assumption of emergency roles in member accounts                                                      | Emergency Admin (time- limited) |

**Access Role-to-Permission Set Mapping.** The Workload Account Owner access role is implemented through the *LZ-WorkloadAdmin-PermissionSet*, assigned only to the approved workload account(s). Similarly, the Cloud Platform Administrator and Cloud Platform Engineer access roles map to the *LZ-PlatformAdmin-PermissionSet* and *LZ-PlatformEngineer-PermissionSet* respectively.

## 3.2 Role Hierarchy

The following access constructs are defined for the ESC Landing Zone. Human access roles are mapped to AWS IAM Identity Center Permission Sets and account assignments. Deployment pipeline roles are assumed exclusively through GitHub Actions OIDC. Break-glass access is provided through a dedicated emergency IAM user within the AWS Organization Management Account.

| **Access construct**                    | **Purpose**                                                                    | **Scope**                                                                                                                                                                                                                  |
|-----------------------------------------|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **LZ-PlatformAdmin-PermissionSet**      | Full Landing Zone platform administration and platform governance              | Management, Security Tooling Account, Audit Account, Shared Services Account, and approved workload accounts. Administrative access to Production accounts is JIT-controlled and subject to approved governance processes. |
| **LZ-ComplianceReadOnly-PermissionSet** | Audit evidence collection and compliance review                                | Read-only access across approved Management, Security, Infrastructure, Sandbox, and Workload accounts                                                                                                                      |
| **LZ-PlatformEngineer-PermissionSet**   | Landing Zone implementation, deployment, operational changes, and validation   | Staging infrastructure accounts, representative Staging workload accounts, and approved Production accounts                                                                                                                |
| **LZ-SecurityReadOnly-PermissionSet**   | Read-only security validation and findings review                              | Security Tooling, Audit, Log Archive, and approved workload accounts                                                                                                                                                       |
| **LZ-SecurityAdmin-PermissionSet**      | Security baseline administration and approved findings remediation             | Security Tooling Account, Audit account and approved workload accounts; Production write access is restricted and controlled                                                                                               |
| **LZ-NetworkAdmin-PermissionSet**       | Network governance and centralized network operations                          | Shared Services Account and approved shared-network resources                                                                                                                                                              |
| **LZ-KMSAdmin-PermissionSet**           | KMS key administration and key policy management                               | KMS-owning accounts                                                                                                                                                                                                        |
| **LZ-LoggingAdmin-PermissionSet**       | Centralized logging and monitoring administration                              | Log Archive and associated centralized logging accounts                                                                                                                                                                    |
| **LZ-WorkloadAdmin-PermissionSet**      | Scoped workload account administration                                         | Assigned Hybrid, Online, or Corp workload accounts only; Production access is restricted and JIT-controlled                                                                                                                |
| **LZ-ReadOnly-PermissionSet**           | Read-only troubleshooting, inspection, and operational visibility              | Assigned active accounts; not assigned to Suspended accounts as part of standard operations                                                                                                                                |
| **LZ-GitHubActions-Deploy-Staging**     | Automated CDK deployment to the Staging AWS Organization (OIDC – non-human)    | Staging AWS Organization                                                                                                                                                                                                   |
| **LZ-GitHubActions-Deploy-Production**  | Automated CDK deployment to the Production AWS Organization (OIDC – non-human) | Production AWS Organization                                                                                                                                                                                                |
| **LZ-BreakGlass-Admin**                 | Emergency administrative access                                                | All accounts; emergency use only with approval, monitoring, and post-incident review                                                                                                                                       |

**Naming convention.** Environment-specific access is implemented by assigning the common Permission Sets defined above to approved Staging or Production accounts. Separate environment-suffixed Permission Set names are not created unless a materially different policy is required.

| **GITOPS ALIGNMENT.** IAM Identity Center Permission Set definitions, group-to-Permission Set mappings, account assignments, IAM policy attachments, and OIDC trust policies are maintained in the aws-sc-landing-zone repository under lib/iam/. Changes follow feature/\* → develop (Staging validation) → main (Production deployment after approval by at least one authorized reviewer independent of the release creator). Architecture, Security, Compliance, and Governance stakeholders are consulted during design/change preparation where required by scope and risk; they are not expected to review detailed IaC pull requests unless specifically agreed. |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

# 4. Cross-Account Access, Federation & Delegation Model (WI-1543613, WI-1543614)

## 4.1 Cross-Account Access Overview

Cross-account access is required to manage, operate, deploy, and validate Landing Zone resources across Management, Security, Log Archive, Shared Services, Network, and Workload accounts. Access is logically separated between the Staging and Production AWS Organizations.

Approved principals include federated human identities authenticated through Microsoft Entra ID via AWS IAM Identity Center, delegated administrator accounts, approved GitHub Actions OIDC deployment roles, and the emergency break-glass administrator.

Delegated administrator accounts are designated for approved AWS services such as Amazon GuardDuty, AWS Config, centralized logging, and other Landing Zone governance services approved by ESC. Delegated administrator privileges remain limited to approved service functions and do not provide unrestricted administrative access to member accounts.

Access is governed through IAM Identity Center Permission Set assignments, IAM role trust policies, Service Control Policies (SCPs), and account placement within the AWS Organizations hierarchy.

## 4.1.1 OU and Account Scope

The IAM access model applies across the complete Landing Zone OU and account structure. IAM Identity Center Permission Sets are assigned to AWS accounts, while OU placement determines the applicable SCP boundary. Access is therefore governed by the combination of account assignment, Permission Set policy, role trust controls, and the SCPs attached at Root, OU, and account level.

<table>
<colgroup>
<col style="width: 33%" />
<col style="width: 33%" />
<col style="width: 33%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>OU / Account Pattern</strong></th>
<th><strong>Design Intent</strong></th>
<th><strong>Standard Access Model</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>ESC Root / Management Account</td>
<td>Central Landing Zone governance, AWS Organizations, AWS Control Tower, identity governance, and deployment orchestration</td>
<td>Platform Admin (JIT), Platform Engineer, approved deployment pipeline deployment</td>
</tr>
<tr class="even">
<td>Security OU</td>
<td>Security tooling, audit, logging, AWS Config aggregation, and delegated security administration</td>
<td>Security Admin, Security Read-Only, Logging Admin, Compliance Read-Only</td>
</tr>
<tr class="odd">
<td>Infrastructure OU</td>
<td>Network and Shared Services administration</td>
<td>Network Admin, Platform Engineer, Logging Admin, KMS Admin</td>
</tr>
<tr class="even">
<td>Sandbox OU</td>
<td>Controlled experimentation with cost and service guardrails</td>
<td>Scoped sandbox access; no access to Production or central Landing Zone accounts</td>
</tr>
<tr class="odd">
<td>Suspended OU</td>
<td>Quarantined accounts pending closure or investigation</td>
<td>No standard IAM Identity Center assignment; recovery only through approved emergency process</td>
</tr>
<tr class="even">
<td>Workloads / Hybrid</td>
<td>On-premises connected workload accounts</td>
<td>Scoped workload access subject to inherited controls</td>
</tr>
<tr class="odd">
<td>Workloads / Online</td>
<td>Internet-facing workload accounts</td>
<td>Scoped workload access with additional network governance controls</td>
</tr>
<tr class="even">
<td>Workloads / Corp</td>
<td>Internal corporate workload accounts</td>
<td>Scoped workload access; public endpoint creation restricted</td>
</tr>
<tr class="odd">
<td>Workload Non-Production Accounts</td>
<td>Development, testing, and pre-production validation</td>
<td>Scoped administrative or operator access within inherited guardrails</td>
</tr>
<tr class="even">
<td>Workload Production Accounts</td>
<td>Live production workloads</td>
<td><p>Pipeline-first changes, read-only standing access, JIT elevation or emergency break-glass</p>
<p>write access only</p></td>
</tr>
</tbody>
</table>

## 4.1.2 Cross-Account Role Assumption

Cross-account access shall be performed through approved IAM roles. Role trust policies shall restrict access to authorized IAM Identity Center Permission Sets, approved delegated administrator accounts, approved CI/CD deployment roles, and designated break-glass identities. Wildcard principals are prohibited. External account trust relationships require security review and approval. All cross-account access activities must be logged through AWS CloudTrail and remain subject to applicable SCP controls.

All cross-account access must adhere to the principles of least privilege, segregation of duties, and auditability. Access permissions shall be provisioned through approved IAM Identity Center Permission Sets and reviewed periodically in accordance with organizational access governance requirements.

### Workload Non-Production Access

Workload Non-Production accounts support development, testing, integration, and pre-production validation activities. Authorized workload administrators and application teams may receive scoped administrative or operational access to assigned accounts through AWS IAM Identity Center Permission Sets.

Access remains subject to inherited Workloads OU controls, including mandatory encryption, centralized logging, approved AWS Regions, resource tagging standards, and corporate identity federation requirements. Workload teams are permitted to provision and manage resources required for application delivery provided they remain within established Landing Zone guardrails and applicable SCP restrictions.

### Workload Production Access

Workload Production accounts use a more restrictive model. Changes should be implemented through approved Infrastructure-as-Code deployment pipelines wherever technically feasible.

The following controls apply:

- Standing administrative access is prohibited.

- Human write access is limited to approved Just-in-Time (JIT) elevation or emergency break-glass access.

- Normal operational access is restricted to read-only or narrowly scoped permissions.

- All actions remain subject to SCP-ESC-PROD-001 and inherited Workloads OU controls.

- Production deployments must be traceable through approved change-management and deployment processes.

### Sandbox OU Access

Sandbox accounts provide a controlled environment for experimentation, learning, prototyping, and innovation activities. Access may be granted to approved engineering, platform, and development teams through designated Sandbox Permission Sets.

Sandbox resources remain subject to cost-management controls, service restrictions, approved region requirements, encryption policies, and centralized logging controls. Sandbox access must not grant permissions to Management, Security, Network, Shared Services, or Production accounts.

### Suspended OU Access

Accounts placed within the Suspended OU are considered quarantined and are typically pending closure, investigation, recovery, or remediation activities.

No standard IAM Identity Center Permission Sets are assigned to Suspended OU accounts. Access is removed or restricted through SCP-ESC-SUS-001 wherever technically possible. Any access required for recovery, investigation, or compliance purposes must follow an approved emergency or break-glass process and be fully auditable.

### Network Account Access

The Shared Services Account serves as the centralized account for management of shared networking services across the Landing Zone, including Amazon VPC architecture, AWS Transit Gateway, routing domains, hybrid connectivity, and approved shared network services.

The Network Admin Permission Set receives administrative access only within the Shared Services Account and approved networking resources. Workload accounts may receive read-only or attachment-level permissions where required but cannot independently create or modify centralized networking components. All network changes must follow approved governance and change-management processes.

## 4.2 Staging Cross-Account Access

The Staging AWS Organization mirrors the Production OU hierarchy but contains only one test workload account under each workload OU:

| **Workload OU** | **Staging account model**        |
|-----------------|----------------------------------|
| Online OU       | One Online Test Workload Account |
| Hybrid OU       | One Hybrid Test Workload Account |
| Corp OU         | One Corp Test Workload Account   |

The Staging access model supports validation of: SCP enforcement, IAM role assumption, KMS key access, centralized logging, CloudTrail and AWS Config delivery, security baseline controls, deployment pipelines, and compliance posture prior to Production promotion.

**Staging AWS Organization Access roles:**

| **Role**                            | **Purpose**                                                                                                                                                                                                                                                                           |
|-------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **LZ-GitHubActions-Deploy-Staging** | Assumed by GitHub Actions after a merge to develop; deploys CDK stacks using config/develop.yaml.                                                                                                                                                                                     |
| LZ-PlatformEngineer-PermissionSet   | Assigned to approved Staging accounts for deployment validation, testing, operational troubleshooting, and platform support activities. This is the Staging account assignment of the access construct defined in Section 3.2, not a separate role.                                   |
| LZ-SecurityReadOnly-PermissionSet   | Assigned to approved Staging accounts for read-only security validation of GuardDuty, AWS Config, CloudTrail, centralized logging, and security-baseline evidence. This is the Staging account assignment of the common access construct defined in Section 3.2, not a separate role. |

## 4.3 Production Cross-Account Access

The Production AWS Organization contains the full approved workload account structure. Production access is more restrictive and is permitted only after:

- Staging validation is complete.

- The pull request from develop to main is approved by at least one authorized If Insurance reviewer who is independent of the change author or release creator.

- Production promotion is approved in accordance with the protected-environment and separation-of-duties controls defined in the GitOps governance model.

- Relevant Architecture, Security, Compliance or governance consultation and any applicable ITSM/CAB approval are completed during change preparation, based on the scope and risk of the change.

> Production deployments follow a pipeline-first operating model. Direct human changes to Production resources should be avoided wherever technically feasible and are subject to approved Just-in-Time (JIT) or emergency break-glass access processes.

**Production AWS Organization Access roles:**

| **Role**                               | **Purpose**                                                                                                                                                                                                                    |
|----------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **LZ-GitHubActions-Deploy-Production** | Assumed by GitHub Actions following an independently approved merge to main; deploys CDK stacks using config/production.yaml. The role session carries PR/commit/workflow correlation metadata where supported.                |
| LZ-PlatformAdmin-PermissionSet         | Restricted Landing Zone platform administration in Production (JIT only). Assigned to approved Production accounts through environment-specific IAM Identity Center account assignments.                                       |
| LZ-SecurityAdmin-PermissionSet         | Restricted security administration in Production. Assigned to approved Production accounts through environment-specific IAM Identity Center account assignments.                                                               |
| LZ-ComplianceReadOnly-PermissionSet    | Read-only compliance review and audit evidence collection, and control verification across Production accounts. Assigned to approved Production accounts through environment-specific IAM Identity Center account assignments. |

## 4.4 Delegated Administration Model

Where supported in AWS ESC, delegated administrator accounts are used to centrally manage approved security, governance, logging, and networking services. If a service is not available in AWS ESC, the delegated administration model will be adjusted and documented as an approved exception.

| **Function**      | **Delegated admin account**         | **Purpose**                                                                 |
|-------------------|-------------------------------------|-----------------------------------------------------------------------------|
| Security Services | Security Account                    | Centralised security governance and findings review (GuardDuty, AWS Config) |
| Logging           | Log Archive Account                 | Centralised CloudTrail, Config, and log delivery validation                 |
| KMS               | Security or Shared Services Account | Centralised encryption governance                                           |
| Network           | Shared Services Account             | Shared network and connectivity governance                                  |
| Compliance        | Audit Account                       | Evidence collection and compliance reporting                                |

## 4.5 Federated Identity Design

All human access is federated from the IF Insurance corporate Identity Provider (IdP) to AWS IAM Identity Center. IAM Identity Center provides centralized groups, Permission Sets, account assignments, session controls, and access governance. Staging and Production are separate AWS Organizations and maintain independent IAM Identity Center configurations, account assignments, and group mappings in accordance with the AWS ESC operating model. Both integrate with the same approved corporate IdP and use the same Permission Set catalogue, while group mappings and account assignments are managed separately to preserve Organization and environment isolation.

| **Attribute**                        | **Value**                                                                                                                                                                      | **Design implication**                                                                                                                                                                                                                                                             |
|--------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Identity Provider (IdP)              | If Insurance corporate Identity Provider - SAML 2.0 integration with AWS IAM Identity Center (exact IdP to be confirmed, e.g. Microsoft Entra ID, Okta, PingFederate, or ADFS) | The corporate IdP authenticates users. IAM Identity Center acts as the centralized AWS workforce access layer and maps authenticated users and groups to approved Permission Sets and AWS account assignments.                                                                     |
| IAM Identity Center                  | Available and approved in AWS ESC                                                                                                                                              | IAM Identity Center is the primary workforce access service. Staging and Production maintain independent IAM Identity Center configurations, account assignments, and group mappings while using a common approved Permission Set catalogue and corporate IdP integration pattern. |
| User and group mapping               | Corporate IdP groups map to IAM Identity Center groups; groups are assigned Permission Sets to approved accounts or account sets.                                              | Example: corporate group 'AWS-LZ-PlatformEngineers' → IAM Identity Center group → LZ-PlatformEngineer-PermissionSet → approved Staging/Production account assignments.                                                                                                             |
| MFA enforcement                      | MFA is enforced through the corporate IdP and IAM Identity Center sign-in policy. JIT elevation requires re-authentication.                                                    | MFA context and sign-in policy are validated before privileged Permission Sets are made available. Elevated access remains time-bound and auditable.                                                                                                                               |
| Session duration                     | Standard Permission Set sessions: 1 hour. JIT elevated sessions: up to 1 hour, subject to approved access governance policies and client requirements.                         | Short-lived sessions reduce credential exposure. Session duration and renewal rules are enforced through IAM Identity Center Permission Set settings and the corporate IdP.                                                                                                        |
| ESC partition endpoint               | IAM Identity Center access portal and ESC endpoints; ARN prefix: arn:aws-eusc:                                                                                                 | Users access ESC accounts through the approved IAM Identity Center portal. GitHub Actions uses the approved ESC STS endpoint (sts.eusc-de-east-1.amazonaws.eu) for OIDC-based role assumption.                                                                                     |
| User provisioning and deprovisioning | SCIM provisioning from the corporate IdP to IAM Identity Center is preferred; controlled manual provisioning is the fallback.                                                  | SCIM automates user/group lifecycle and helps ensure timely revocation when users leave or change roles. Final provisioning method requires If Insurance IT confirmation.                                                                                                          |

**Identity Governance Principle**  
All workforce access must be provisioned through AWS IAM Identity Center. Long-term IAM users for human access are prohibited except for approved emergency break-glass accounts. Access provisioning, modification, and removal must be governed through the corporate identity lifecycle management process.

## 4.6 Branch-to-Role Mapping

The following table defines the AWS access construct assumed by the GitHub Actions deployment pipeline for each branch event:

| **Branch / Event**                     | **AWS access construct**                       | **Target**                                               | **Control and outcome**                                                                                                                                                                                                                          |
|----------------------------------------|------------------------------------------------|----------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| feature/\* and pull request validation | No AWS deployment role                         | No AWS deployment                                        | Runs linting, unit tests, security scanning, cdk synth and other static checks. No deployment credentials are issued. Any environment-aware cdk diff or live-state validation is performed through an authorized Staging workflow using OIDC     |
| Merge to develop                       | LZ-GitHubActions-Deploy-Staging                | Staging AWS Organization using config/develop.yaml       | Automatic deployment after approved merge. Staging validation, IAM variance checks and evidence capture are performed                                                                                                                            |
| Approved merge to main                 | LZ-GitHubActions-Deploy-Production             | Production AWS Organization using config/production.yaml | Requires approval by at least one authorized If Insurance reviewer who is independent of the change author or release creator, together with protected Production environment controls. Applicable ITSM/CAB evidence is retained where required. |
| Emergency / break-glass activity       | LZ-BreakGlass-Admin or approved emergency role | Explicitly authorized target account only                | Incident authorization, MFA, time limit, CloudTrail alerting and retrospective Git reconciliation are mandatory.                                                                                                                                 |

## 4.7 GitHub OIDC and CDK Deployment Role Chain

The non-human deployment path is:

**GitHub Actions → GitHub OIDC provider → custom deployment role provisioned by aws-sc-foundation → sts:AssumeRole into the required CDK bootstrap roles → CloudFormation/CDK deployment.**

The **aws-sc-foundation** repository owns the OIDC provider, custom deployment role and CDK bootstrap readiness. The **aws-sc-landing-zone** repository consumes these capabilities and does not create duplicate OIDC providers or bootstrap roles.

The custom deployment role is least privileged and receives only the Organizations, CloudFormation/StackSet, CDK asset, sts:AssumeRole and explicit iam:PassRole permissions required for the approved deployment scope. Human identities cannot assume the pipeline role. The AWS OIDC trust policy is restricted to the approved GitHub organization and repository; branch, pull-request, reviewer and protected GitHub Environment controls are enforced through GitHub governance and workflow configuration.

## 4.8 IAM Rollback, Drift Detection and Audit Correlation

IAM rollback is always implemented as a new forward Git commit that restores the last approved Permission Set, account assignment, IAM policy, permissions boundary, OIDC trust policy or cross-account trust relationship. Git history is not reset or rewritten. The rollback is validated in Staging and promoted through the standard Production workflow. Emergency manual changes are documented, validated and reconciled back into the IaC repository through an approved pull request.

CloudFormation drift detection is used where IAM resources are supported. Because IAM and IAM Identity Center coverage may be partial, supplementary validation uses AWS Config, IAM and IAM Identity Center APIs, Organizations APIs and targeted scripts to compare Permission Sets, inline and managed policy attachments, group mappings, account assignments, role trust policies, OIDC provider configuration, permissions boundaries, cross-account principals and break-glass controls. Material unexplained variance blocks deployment until resolved or explicitly approved and documented.

Deployment evidence links the GitHub PR number, commit SHA, Git Tag, GitHub Actions run ID, OIDC role-session identity, target account/role, and any applicable ITSM/CAB reference to CloudTrail and CloudFormation activity. A recommended session-name pattern is \<repository\>-pr-\<PR-number\>-\<short-commit-sha\>, subject to AWS and GitHub length constraints. This establishes traceability for both the technical action and the approved reason for change.

## 4.9 Permissions Boundaries and Privilege-Escalation Prevention

IAM roles created by workload teams, delegated administrators or automation use an approved permissions boundary where technically applicable. The boundary is an upper limit in addition to SCPs and identity policies; it prevents delegated role creation from exceeding the approved account and OU access model.

Privilege-escalation-sensitive permissions are tightly scoped, including iam:PassRole, iam:CreatePolicyVersion, iam:SetDefaultPolicyVersion, iam:AttachRolePolicy, iam:PutRolePolicy, iam:UpdateAssumeRolePolicy, iam:CreateOpenIDConnectProvider, iam:UpdateOpenIDConnectProviderThumbprint and actions that create, replace or remove permissions boundaries. These actions are limited to approved roles, resource paths and deployment workflows, with explicit deny guardrails where appropriate.

## 4.10 Identity Lifecycle, Root and Machine Identity Governance

Workforce identity lifecycle is governed through the corporate IdP and IAM Identity Center. Joiner, mover, contractor-expiry, dormant-identity, failed-deprovisioning and emergency-removal events must result in timely group and account-assignment updates. Group ownership, failed synchronization and stale assignments are included in periodic access recertification.

Root-user access is separate from break-glass IAM access. Root is not used for routine operations; MFA is enabled, root access keys are not created, account contact details are controlled, root-use events generate alerts, and recovery information and control effectiveness are periodically verified for every Management Account and all member accounts.

Machine identities include GitHub deployment roles, CloudFormation and StackSet roles, AWS Config and CloudTrail service roles, GuardDuty/delegated-administration roles, automation/Lambda roles, log-delivery identities and Sentinel-forwarding roles. They are non-human, least-privileged, scoped to approved services and resources, protected from unauthorized trust or policy changes, and included in periodic review. IAM Access Analyzer and credential/unused-access analysis are used where available in ESC; otherwise, equivalent API-based validation is performed.

# 5. Role-to-Permission Matrix (WI-1543612)

## 5.1 Landing Zone Role Matrix

The tables below map each access construct to the permitted access level across the ESC Landing Zone account types. Access levels are granted through AWS IAM Identity Center Permission Sets, approved deployment roles, or emergency access roles, as applicable. All permissions operate within the upper-bound SCP boundaries defined in US-1542064 and remain subject to applicable Service Control Policies (SCPs), permissions boundaries, IAM role trust policies, and environment-specific account assignments defined within the Landing Zone governance model.

## 5.1.1 Central Landing Zone and Infrastructure Accounts

| **Access construct**                | **Management**     | **Security Tooling / Audit** | **Log Archive**    | **Network**        | **Shared Services**         |
|-------------------------------------|--------------------|------------------------------|--------------------|--------------------|-----------------------------|
| LZ-PlatformAdmin-PermissionSet      | Admin - JIT        | Limited Admin                | Limited Admin      | Admin - JIT        | JIT Admin (Exception Based) |
| LZ-PlatformEngineer-PermissionSet   | Read / Validate    | Read / Validate              | Read / Validate    | Power User         | Power User                  |
| LZ-SecurityAdmin-PermissionSet      | Security Read      | Security Admin               | Security Read      | Security Read      | Security Read               |
| LZ-SecurityReadOnly-PermissionSet   | Security Read      | Security Read                | Security Read      | Security Read      | Security Read               |
| LZ-ComplianceReadOnly-PermissionSet | Read Only          | Read Only                    | Read Only          | Read Only          | Read Only                   |
| LZ-NetworkAdmin-PermissionSet       | Network Read       | No Access                    | No Access          | Network Admin      | Network Admin               |
| LZ-KMSAdmin-PermissionSet           | KMS Read           | KMS Admin                    | KMS Read           | KMS Read           | KMS Admin                   |
| LZ-LoggingAdmin-PermissionSet       | Logging Read       | Logging Read                 | Logging Admin      | Logging Read       | Logging Read                |
| LZ-WorkloadAdmin-PermissionSet      | No Access          | No Access                    | No Access          | No Access          | No Access                   |
| LZ-ReadOnly-PermissionSet           | Read Only          | Read Only                    | Read Only          | Read Only          | Read Only                   |
| LZ-GitHubActions-Deploy-Staging     | Deploy as required | Deploy as required           | Deploy as required | Deploy as required | Deploy as required          |
| LZ-GitHubActions-Deploy-Production  | Deploy as required | Deploy as required           | Deploy as required | Deploy as required | Deploy as required          |
| LZ-BreakGlass-Admin                 | Emergency Admin    | Emergency Admin              | Emergency Admin    | Emergency Admin    | Emergency Admin             |

Note: Network refers to the shared networking function hosted within the Shared Services Account and does not represent a separate AWS account.

## 5.1.2 Sandbox, Suspended, and Workload Account Patterns

| **Access construct**                | **Sandbox**               | **Suspended**           | **Workload Non-Prod**   | **Workload Prod**                       |
|-------------------------------------|---------------------------|-------------------------|-------------------------|-----------------------------------------|
| LZ-PlatformAdmin-PermissionSet      | Limited Admin             | No Access               | Limited Admin - JIT     | JIT Admin (Exception Based)             |
| LZ-PlatformEngineer-PermissionSet   | Limited Operator          | No Access               | Limited Operator        | Read / Validate                         |
| LZ-SecurityAdmin-PermissionSet      | Security Read             | No Access               | Security Read           | Security Read                           |
| LZ-SecurityReadOnly-PermissionSet   | Security Read             | No Access               | Security Read           | Security Read                           |
| LZ-ComplianceReadOnly-PermissionSet | Read Only                 | No Access               | Read Only               | Read Only                               |
| LZ-NetworkAdmin-PermissionSet       | Network Read              | No Access               | Network Read            | Network Read                            |
| LZ-KMSAdmin-PermissionSet           | KMS Read                  | No Access               | KMS Read                | KMS Read                                |
| LZ-LoggingAdmin-PermissionSet       | Logging Read              | No Access               | Logging Read            | Logging Read                            |
| LZ-WorkloadAdmin-PermissionSet      | Assigned only             | No Access               | Scoped Admin            | Restricted Scoped Admin / JIT           |
| LZ-ReadOnly-PermissionSet           | Read Only                 | No standard access      | Read Only               | Read Only                               |
| LZ-GitHubActions-Deploy-Staging     | Deploy if in scope        | No Deploy               | Deploy to test accounts | No Deploy                               |
| LZ-GitHubActions-Deploy-Production  | No Deploy unless approved | No Deploy               | Deploy where approved   | Deploy via approved Production pipeline |
| LZ-BreakGlass-Admin                 | Emergency Admin           | Emergency recovery only | Emergency Admin         | Emergency Admin                         |

**Account Structure and Access Governance**

- Prod and Non-Prod are AWS accounts, not Organizational Units (OUs).

- The same account pattern is repeated across the Hybrid, Online, and Corp Workload OUs.

- Security Tooling Account, Audit Account, and Log Archive Account are dedicated accounts within the Security OU.

- No standard assignments are made to Suspended accounts.

- Production workloads write access is pipeline-first and human elevation is JIT-controlled.

- All access levels shown in this matrix remain subject to applicable SCPs, permissions boundaries, IAM role trust policies, and environment-specific IAM Identity Center account assignments.

## 5.2 Permission Level Definitions

| **Permission level** | **Description**                                                                                                                                |
|----------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| **Admin**            | Full administrative permissions within approved scope.                                                                                         |
| **Limited Admin**    | Administrative access excluding restricted security actions, SCP modifications, permissions boundary changes, and IAM guardrail modifications. |
| **Power User**       | Manage resources but not IAM guardrails, SCPs, or security boundaries.                                                                         |
| **Deploy**           | CDK / CloudFormation deployment permissions for approved stacks only. No interactive console access.                                           |
| **Security Admin**   | Manage security services, findings, and baseline controls (GuardDuty, AWS Config, Sentinel forwarding).                                        |
| **Logging Admin**    | Manage CloudTrail, Config, log delivery, and log archive controls.                                                                             |
| **KMS Admin**        | Manage KMS keys and key policies within approved boundaries.                                                                                   |
| **Network Admin**    | Manage VPC, Transit Gateway, route tables, and security groups within approved scope.                                                          |
| **Read Only**        | View-only access for audit, validation, and troubleshooting. No write actions.                                                                 |
| **Read / Validate**  | Read access plus the ability to run validation checks (e.g. CDK diff, stack status). No infrastructure changes.                                |
| **Limited Operator** | Manage specific operational resources within approved scope and SCP guardrails.                                                                |
| **Scoped Admin**     | Account-specific administration within SCP and IAM guardrails. No cross-OU access.                                                             |
| **Emergency Admin**  | Time-bound privileged access for declared incidents. MFA-enforced, ITSM-ticketed, CloudTrail-monitored, and subject to post-incident review.   |

# 6. Emergency Break-Glass Access (WI-1543616)

## 6.1 Break-Glass Principles

Break-glass access is used only for emergency situations where normal federated or pipeline access is unavailable or insufficient. Break-glass access must be:

- Governed by a pre-approved emergency-access procedure and explicitly authorized for each incident by If Insurance Security or Cloud Platform leadership.

- Protected with MFA.

- Restricted to named emergency administrators (CISO or designated Cloud Platform Lead).

- Logged through CloudTrail.

- Monitored through automatic security alerts.

- Reviewed and documented within 24 hours of use.

- Subject to password rotation, credential disablement, or equivalent credential recovery procedures after use.

## 6.2 Break-Glass Role

| **Role**                | **Purpose**                                                                                                                                        | **Controls**                                                                                                                                                             |
|-------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **LZ-BreakGlass-Admin** | Emergency administrator access to restore Landing Zone operations in the event of a corporate IdP/federation outage or declared critical incident. | MFA-enforced, ITSM approval required, automatic CloudTrail alerting, CloudWatch monitoring and alerting, post-use review, and credential rotation or recovery after use. |

## 6.3 Break-Glass Usage Scenarios

Break-glass access may be used only in scenarios such as:

- Corporate IdP / identity federation outage.

- GitHub Actions deployment failure blocking urgent remediation.

- SCP misconfiguration preventing normal access.

- KMS policy issue causing access failure.

- Security incident requiring immediate containment or recovery actions.

- Critical Landing Zone service outage.

- Loss of administrative access due to misconfiguration of IAM Identity Center, IAM roles, or account assignments.

Break-glass access must not be used for routine administration, standard operational activities, development activities, or to bypass established deployment, approval, or change-management processes.

## 6.4 Break-Glass Controls

<table>
<colgroup>
<col style="width: 24%" />
<col style="width: 33%" />
<col style="width: 41%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Control</strong></th>
<th><strong>Implementation</strong></th>
<th><strong>Enforcement</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Break-glass account type</td>
<td>A dedicated console-only break-glass IAM user is maintained in the Management Account. The user has no direct standing administrative permissions. Its permissions are limited to authentication, approved account-recovery actions where required, and assumption of the LZ-BreakGlass-Admin emergency role</td>
<td>Access keys are not generated. The console password and MFA device are stored separately using the approved vault or PAM process. Administrative permissions are obtained only by assuming the approved emergency role after MFA authentication and incident authorization.</td>
</tr>
<tr class="even">
<td>Authorisation</td>
<td>Break-glass may only be used by the IF Insurance CISO or designated Cloud Platform Lead in the event of an IdP/federation outage, loss of administrative access, or declared critical incident.</td>
<td>Authorisation documented in ITSM before credentials are retrieved. Unauthorised retrieval triggers an immediate security alert.</td>
</tr>
<tr class="odd">
<td>MFA enforcement</td>
<td>MFA device enrolled. Console login without MFA is denied, except only the minimum actions required to complete authentication or remediate the MFA device under an approved recovery procedure.</td>
<td>An explicit deny policy prevents all non-exempt actions when aws:MultiFactorAuthPresent = false. The final IAM policy JSON and exception list will be produced and validated during implementation.</td>
</tr>
<tr class="even">
<td>Time-limited access</td>
<td>The approved break-glass access window is limited to a maximum of 4 hours unless an extension is formally approved and documented through the incident-management process. The console session is terminated, and the password is rotated or disabled immediately after use.</td>
<td>Any cross-account emergency role session uses a maximum duration aligned with the approved access window. The MFA device is returned to its approved secure location when the session ends.</td>
</tr>
<tr class="odd">
<td>Mandatory ITSM ticket</td>
<td>ITSM incident ticket required before credentials are retrieved. Includes: incident description, authorising official, estimated duration, planned actions, and justification for break-glass access.</td>
<td>The ITSM incident number, break-glass username, login time, target accounts, and approved activity window are recorded in the incident ticket. For member-account role assumption, the ticket number is passed as an STS session tag where supported.</td>
</tr>
<tr class="even">
<td>Automatic CloudTrail alerting</td>
<td>Login triggers an immediate CloudWatch alarm and SNS notification to the CISO, Cloud Platform Lead, and Security team.</td>
<td>An Amazon EventBridge rule detects break-glass ConsoleLogin and emergency-role assumption events and sends security notifications within the agreed response time.</td>
</tr>
<tr class="odd">
<td>Retrospective review</td>
<td>Mandatory retrospective within 24 hours. Documents: actions taken, incident status, required Landing Zone changes, and any follow-up corrective actions.</td>
<td>Documented in ITSM. Signed off by CISO. Any LZ changes follow the standard GitOps PR workflow.</td>
</tr>
<tr class="even">
<td>Break-glass in Staging</td>
<td>Separate break-glass IAM user in the Staging AWS Organization Management Account.</td>
<td><p>Same controls as Production.</p>
<p>Staging usage reported to the Cloud Platform Lead within 1 hour and documented through the applicable incident or change-management process.</p></td>
</tr>
<tr class="odd">
<td>Credential Rotation and Validation</td>
<td>Break-glass credentials and MFA recovery procedures are periodically validated and rotated in accordance with organizational security requirements.</td>
<td>Validation evidence retained and reviewed during periodic security governance reviews.</td>
</tr>
</tbody>
</table>

## 6.5 Break-Glass Cross-Account Access Model

A dedicated console-only break-glass IAM user is maintained only in the Management Account of each AWS Organization. Separate break-glass IAM users or credentials are not created in member accounts. The user has no direct standing administrative permissions and assumes the approved LZ-BreakGlass-Admin emergency role in the Management Account or an explicitly authorized member account when emergency administration is required.

## 6.6 Break-Glass Process

The following process must be followed for every break-glass access event without exception:

| **Step** | **Stage**                     | **Detail**                                                                                                                                                                                                                                                                   |
|----------|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1        | Incident declared             | CISO or Cloud Platform Lead declares critical incident. ITSM ticket created with description and authorisation details.                                                                                                                                                      |
| 2        | ITSM ticket created           | Ticket records: authorising official name, start time, estimated duration, accounts to access, planned actions.                                                                                                                                                              |
| 3        | Credentials retrieved         | Break-glass IAM user password retrieved from vault or approved PAM tool. MFA device retrieved. Retrieval logged in ITSM.                                                                                                                                                     |
| 4        | Incident correlation recorded | The ITSM incident number, break-glass username, login timestamp, target accounts, and approved activity window are recorded in the incident ticket. When a member-account emergency role is assumed, the ITSM ticket number is passed as an STS session tag where supported. |
| 5        | Actions performed             | Remediation or recovery actions performed; limited strictly to what is documented in the ITSM ticket.                                                                                                                                                                        |
| 6        | Session terminated            | Console session terminated. Password rotated or disabled immediately by the Cloud Platform Lead. MFA device re-secured.                                                                                                                                                      |
| 7        | CloudTrail review             | CloudTrail events and relevant audit evidence from the session are exported and attached to the ITSM incident ticket.                                                                                                                                                        |
| 8        | Retrospective review          | Within 24 hours: CISO reviews all actions performed during the break-glass session. Any LZ changes raised as standard GitOps PRs. ITSM ticket closed with sign-off.                                                                                                          |

**Break-glass and the GitOps pipeline:** If any Landing Zone infrastructure changes are made during a break-glass session, those changes must be documented and reconciled in the Git repository through the standard GitOps pipeline (**feature branch → develop → Staging validation → main →** **Production**) within 24 hours. Manual changes applied during a break-glass session are not the authoritative state - Git is the single source of truth.

# 7. Least-Privilege and Governance Validation (WI-1543617)

## 7.1 Least-Privilege Validation Checklist

| **Validation area**          | **Requirement**                                                                                                                                                               | **Role scope**                                                     | **Environment separation**                                                                   | **Status**   |
|------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|----------------------------------------------------------------------------------------------|--------------|
| Role scope                   | Each role has only the permissions required for its function                                                                                                                  | All roles scoped per Section 5                                     | N/A                                                                                          | **Complete** |
| Environment separation       | Staging and Production roles are separate                                                                                                                                     | Deploy-Staging vs Deploy-Production                                | Separate roles per environment AWS Organization                                              | **Complete** |
| Branch alignment             | develop deploys only to Staging; main deploys only to Production                                                                                                              | Separate pipeline roles, workflows and GitHub Environment controls | Enforced through GitHub branch protection, workflow configuration and protected environments | **Complete** |
| OIDC trust policy            | AWS OIDC trust is restricted to the approved GitHub organization and repository. Branch, reviewer, and protected-environment controls are enforced through GitHub governance. | Pipeline roles only; no human assumption                           | Repository trust in AWS; branch/environment controls in GitHub                               | **Complete** |
| Break-glass controls         | Emergency access is MFA-protected, monitored, and logged                                                                                                                      | LZ-BreakGlass-Admin only                                           | All accounts - emergency access only                                                         | **Complete** |
| Privileged access            | Administrative roles require approval and auditability                                                                                                                        | Admin roles - JIT only                                             | Production accounts                                                                          | **Complete** |
| Cross-account access         | Role assumption limited to approved accounts and principals                                                                                                                   | All cross-account roles                                            | Staging and Production AWS Organizations                                                     | **Complete** |
| ESC correctness              | ARNs use arn:aws-eusc: and region is eusc-de-east-1                                                                                                                           | All roles and trust policies                                       | Staging and Production AWS Organizations                                                     | **Complete** |
| Audit logging                | Role assumptions and API calls are logged in CloudTrail and correlated to the originating PR, workflow run or approved access/change record.                                  | All roles                                                          | Staging and Production AWS Organizations                                                     | **Complete** |
| Review cadence               | Access model is periodically reviewed and recertified                                                                                                                         | All roles                                                          | Staging and Production AWS Organizations                                                     | **Complete** |
| OU/account coverage          | Access model covers Management, Security, Infrastructure, Sandbox, Suspended, and Workload OUs                                                                                | Permission Sets and account assignments                            | SCP boundaries inherited by OU/account                                                       | **Complete** |
| Prod/Non-Prod separation     | Non-Prod permits scoped administration; Prod is pipeline-first with JIT/emergency write access                                                                                | Workload access constructs                                         | Separate account assignments and SCP-ESC-PROD-001 controls                                   | **Complete** |
| Suspended-account quarantine | No standard Permission Set assignments to Suspended accounts                                                                                                                  | No standard human or pipeline access                               | SCP-ESC-SUS-001 full quarantine                                                              | **Complete** |

##  7.2 Governance Validation Matrix

**Status interpretation:** Controls marked as Complete are fully defined within the target Landing Zone design and do not require additional client decisions. Controls that depend on client-specific tooling, governance processes, implementation choices, organizational ownership, or service availability confirmation are marked as **Defined – Client Confirmation Pending or Defined – Client Confirmation / Implementation Validation Pending** until the relevant decisions are confirmed and validated.

| **Governance requirement**                         | **Access model control**                                                                                                                                                                                                                             | **Framework**                                                | **Coverage**                                                          |
|----------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------|-----------------------------------------------------------------------|
| No human identity holds long-lived AWS credentials | All human access uses short-lived IAM Identity Center role sessions. No IAM user access keys are issued to human identities except the break-glass user, which has no access keys.                                                                   | BSI C5 / NIST IA-5                                           | **Complete**                                                          |
| All access is federated through the corporate IdP  | SAML federation from the IF Insurance corporate IdP to AWS IAM Identity Center, with access granted through approved Permission Sets and account assignments.                                                                                        | ISO/IEC 27001:2022 A.5.15, A.5.16, A.5.18 / NIST IA-2        | **Defined – Client Confirmation Pending**                             |
| MFA enforced for all human access                  | Corporate IdP MFA policy enforced. JIT elevation requires MFA re-authentication.                                                                                                                                                                     | BSI C5 / NIS2 Art.21 / NIST IA-2 and applicable enhancements | **Defined – Client Confirmation Pending**                             |
| Least-privilege access per persona                 | IAM Identity Center Permission Sets and associated IAM policies are scoped to the minimum permissions required for each persona. The role-to-permission matrix is defined in Section 5.                                                              | ISO/IEC 27001:2022 A.5.15, A.5.18, A.8.2 / NIST AC-6         | **Complete**                                                          |
| No standing privileged access to Production        | JIT/PAM elevation model. LZ-PlatformAdmin-PermissionSet is not maintained as a standing Production assignment; access is granted temporarily through the approved process.                                                                           | ISO/IEC 27001:2022 A.8.2 / NIST AC-2                         | **Defined – Client Confirmation / Implementation Validation Pending** |
| Pipeline roles cannot be assumed by humans         | Trust policies restrict assumption to OIDC principal only. Trust policies and applicable SCP guardrails deny human assumption.                                                                                                                       | BSI C5 / NIST AC-3                                           | **Complete**                                                          |
| SCP enforces upper-bound permissions               | SCPs from US-1542064 apply to all accounts. No IAM policy can exceed SCP boundaries.                                                                                                                                                                 | ISO/IEC 27001:2022 A.5.15, A.5.18 / NIST AC-6                | **Complete**                                                          |
| Cross-account access is explicitly controlled      | Trust policies enumerate permitted principals. Explicit trust policies and applicable SCP guardrails deny role assumption from unauthorised sources.                                                                                                 | BSI C5 / NIST AC-17                                          | **Complete**                                                          |
| Break-glass access is audited and time-limited     | Break-glass IAM user with MFA, 4-hour session, ITSM ticket, CloudTrail alert, 24-hour retrospective.                                                                                                                                                 | ISO/IEC 27001:2022 A.8.2, A.8.15 / NIST AC-2                 | **Complete**                                                          |
| All privileged actions are logged                  | CloudTrail across all accounts. Log Archive write-only from sources. Log tampering denied by SCP.                                                                                                                                                    | ISO/IEC 27001:2022 A.8.15, A.8.16 / NIST AU-2                | **Complete**                                                          |
| Access aligned to GitOps pipeline governance       | Federated role and policy changes are deployed through the GitOps pipeline: **PR → Staging validation → independent authorized approval → Production.** Applicable ITSM/CAB references are retained where required by the change classification.     | ISO/IEC 27001:2022 A.8.32 / NIST CM-3                        | **Complete**                                                          |
| Quarterly access review                            | All IAM Identity Center groups, Permission Set assignments, account assignments, and relevant trust policies are reviewed quarterly. Unconfirmed access is revoked.                                                                                  | ISO/IEC 27001:2022 A.5.18 / NIST AC-2                        | **Defined – Client Confirmation Pending**                             |
| Workload developers cannot access LZ accounts      | SCP denies cross-OU access. Developer roles scoped to workload OU only.                                                                                                                                                                              | BSI C5 / NIST AC-6                                           | **Complete**                                                          |
| Production workload access is restricted           | Production changes use the approved CDK pipeline; human write access is JIT or emergency only.                                                                                                                                                       | ISO/IEC 27001:2022 A.5.15, A.5.18, A.8.2 / NIST AC-2, AC-6   | **Complete**                                                          |
| Suspended accounts remain quarantined              | No standard IAM Identity Center assignments; SCP-ESC-SUS-001 denies API activity except approved recovery controls.                                                                                                                                  | ISO/IEC 27001:2022 A.5.18 / NIST AC-2, AC-3                  | **Complete**                                                          |
| Permissions boundaries and delegated role creation | Pipeline-created, workload-created and delegated IAM roles use an approved permissions boundary where technically applicable. The boundary prevents delegated administrators and automation from exceeding the approved account and OU access model. | ISO/IEC 27001:2022 A.5.15, A.8.2 / NIST AC-6                 | **Defined - Client Confirmation / Implementation Validation Pending** |
| Privilege-escalation prevention                    | High-risk IAM actions such as iam:PassRole, policy-version changes, trust-policy updates, identity-provider changes and permissions-boundary modifications are restricted to approved roles, resources and workflows.                                | ISO/IEC 27001:2022 A.8.2 / NIST AC-6, AC-3                   | **Complete**                                                          |
| Root-user governance                               | Root is not used for routine operations; root MFA is enabled, root access keys are prohibited, contact ownership is controlled, and root activity is alerted and periodically verified.                                                              | CIS AWS Foundations / NIST IA-2, AC-6                        | **Defined - Client Confirmation / Implementation Validation Pending** |
| Machine and service identity governance            | Service roles, service-linked roles, StackSet roles, automation roles and monitoring/log-delivery identities are non-human, least-privileged, protected from unauthorized modification and periodically reviewed.                                    | ISO/IEC 27001:2022 A.5.16, A.8.2 / NIST AC-6                 | **Defined - Client Confirmation / Implementation Validation Pending** |
| Identity lifecycle governance                      | Joiner, mover, contractor-expiry, dormant-identity, and failed-deprovisioning controls are owned by the corporate IdP/IAM Identity Center process and validated through periodic recertification.                                                    | ISO/IEC 27001:2022 A.5.16, A.5.18 / NIST AC-2                | **Defined - Client Confirmation / Implementation Validation Pending** |

## 7.3 IAM Drift Detection and Reconciliation

IAM drift detection uses a layered control because CloudFormation drift detection does not cover every IAM, IAM Identity Center, Organizations or trust-policy configuration property. Before deployment, CDK synth and CDK diff identify intended template changes but do not by themselves verify the live runtime state.

For supported resources, CloudFormation stack and StackSet drift checks are run against the affected deployment scope. For partially supported or unsupported resources, validation uses AWS Config, IAM and IAM Identity Center service APIs, exported Permission Set and account-assignment inventories, trust-policy validation, OIDC condition checks, CloudTrail review and targeted scripts.

Material unexplained variance blocks deployment until it is investigated and resolved or explicitly approved. An accepted runtime change must be reconciled into the IaC repository through a new pull request so that Git remains the authoritative desired state. Rollback is performed through a new forward commit that reverses the prior change; Git history is not rewritten.

# 8. Privileged Access Management and Administrative Access Model (WI-1543615)

## 8.1 Privileged Access Requirements

Privileged access must be governed through:

- Approved access request process (ITSM/PAM workflow).

- MFA enforcement — mandatory for all privileged role sessions.

- Role-based assignment — no ad-hoc privilege grants.

- Time-bound elevation — maximum 1 hour per JIT session.

- Separation of duties — users cannot approve their own privileged-access elevation requests or Production deployment PRs.

- CloudTrail audit logging of all privileged actions.

- Periodic access review — quarterly review of IAM Identity Center assignments, privileged role assignments, and relevant trust policies.

- Immediate removal when access is no longer required.

## 8.2 Privileged Access Management Controls

<table>
<colgroup>
<col style="width: 24%" />
<col style="width: 33%" />
<col style="width: 41%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>PAM control</strong></th>
<th><strong>Implementation</strong></th>
<th><strong>Enforcement mechanism</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>No standing privileged access</td>
<td>No human identity has a standing assignment to an administrative Production Permission Set. Elevated access is granted through an approved JIT/PAM process only.</td>
<td>Temporary IAM Identity Center group membership or account assignment is removed automatically at session expiry or at the end of the approved access window, whichever occurs first.</td>
</tr>
<tr class="even">
<td>Just-in-time (JIT) elevation</td>
<td>Platform Engineers submit JIT requests through the ITSM/PAM process. The Cloud Platform Lead approves. The user receives temporary access to LZ-PlatformAdmin-PermissionSet for a maximum of 1 hour, subject to the approved access request.</td>
<td>ITSM/PAM approval controls temporary IAM Identity Center group membership or account assignment. CloudTrail records the resulting role session. Access expires automatically.</td>
</tr>
<tr class="odd">
<td>MFA re-authentication for elevation</td>
<td>The corporate IdP and IAM Identity Center sign-in policy require MFA re-authentication before privileged access is granted.</td>
<td>Only authenticated users in the approved temporary group or assignment can obtain the elevated Permission Set session.</td>
</tr>
<tr class="even">
<td>Separation of duties</td>
<td>Platform Engineers who write and merge IaC code cannot approve their own PRs or self-approve JIT elevation requests.</td>
<td>GitHub branch protection requires at least one other approver. JIT approval requires the Cloud Platform Lead.</td>
</tr>
<tr class="odd">
<td>Privileged action audit trail</td>
<td>All privileged actions are logged in CloudTrail in eusc-de-east-1 and delivered to the Log Archive account. The access request or incident record, user/session identity, relevant GitHub PR where applicable, and CloudTrail events are retained as linked evidence.</td>
<td>CloudTrail logs management events. Session names and tags should carry the approved access/change reference where supported. CloudTrail and centralized logging controls are protected by SCPs, IAM policies and resource policies. Any exceptional emergency action affecting logging requires explicit incident authorization, generates an immediate alert and must be restored and reviewed as part of the incident process.</td>
</tr>
<tr class="even">
<td>Least privilege for pipeline roles</td>
<td>GitOps pipeline roles are scoped to the required AWS Organizations, CloudFormation/StackSet, CDK bootstrap asset, and explicit iam:PassRole/role-assumption actions. They have no console login and cannot be assumed by human identities.</td>
<td>Resource-level restrictions, approved role paths and permissions boundaries are used where supported. Trust-policy, identity-provider, policy-version, and permissions-boundary changes are denied except through approved deployment roles and workflows.</td>
</tr>
<tr class="odd">
<td>Quarterly access review</td>
<td>IAM Identity Center groups, Permission Sets, account assignments, and pipeline trust policies are reviewed quarterly by the Cloud Platform Lead and CISO.</td>
<td><p>Access review outcomes are documented in ITSM or the approved governance tool.</p>
<p>Unconfirmed access is revoked within the agreed remediation period.</p></td>
</tr>
</tbody>
</table>

## 8.3 Administrative Access Model

| **Access type**                    | **Role**                                                                   | **Governance**                                                                                                                                                                                                                                  |
|------------------------------------|----------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Platform administration            | LZ-PlatformAdmin-PermissionSet                                             | Restricted to approved platform administrators. JIT elevation required. Cloud Platform Lead approval.                                                                                                                                           |
| Platform engineering (operational) | LZ-PlatformEngineer-PermissionSet                                          | Restricted to platform engineers. Elevated access to Staging for validation and troubleshooting; read-only or scoped operational access in Production.                                                                                          |
| Security administration            | LZ-SecurityAdmin-PermissionSet                                             | Restricted to security administrators. Scoped to GuardDuty, AWS Config, CloudTrail, and Sentinel.                                                                                                                                               |
| KMS administration                 | LZ-KMSAdmin-PermissionSet                                                  | Requires Security team approval. Scoped to KMS-owning accounts.                                                                                                                                                                                 |
| Logging administration             | LZ-LoggingAdmin-PermissionSet                                              | Requires Platform / Security approval. Scoped to centralized logging services and associated accounts.                                                                                                                                          |
| Network administration             | LZ-NetworkAdmin-PermissionSet                                              | Requires Platform approval. Scoped to networking resources only.                                                                                                                                                                                |
| Pipeline deployment                | LZ-GitHubActions-Deploy-Staging / LZ-GitHubActions-Deploy-Production       | Controlled through the GitOps workflow. OIDC only; no human assumption. Separate roles per Organization. Production promotion requires at least one authorized IF Insurance reviewer who is independent of the change author or release creator |
| Emergency administration           | LZ-BreakGlass-Admin                                                        | Emergency approval (CISO). ITSM ticket mandatory. Time-limited (4 hours). Retrospective review within 24 hours.                                                                                                                                 |
| Sandbox access                     | LZ-WorkloadAdmin-PermissionSet or approved sandbox-specific Permission Set | Scoped to approved Sandbox accounts only; no access to central Landing Zone or Production accounts.                                                                                                                                             |
| Suspended-account recovery         | LZ-BreakGlass-Admin                                                        | No standard access. Recovery only through an approved incident and emergency-access process, where technically permitted by the quarantine SCP.                                                                                                 |

**JIT elevation and the GitOps pipeline:** JIT elevation grants temporary human access through an approved IAM Identity Center Permission Set and account assignment. It does not bypass the GitOps pipeline. All Landing Zone infrastructure changes must still be committed to Git, reviewed via PR, validated in the Staging AWS Organization, and promoted to Production through the develop → main workflow. JIT access is intended for investigation, operational troubleshooting, incident response, and approved manual interventions only.

# 9. Stakeholder Review & Approval (WI-1543618)

## 9.1 Joint Delivery Responsibilities

Hexaware and IF Insurance jointly design, develop, implement, technically review, test, and validate the CDK-based AWS ESC Landing Zone for the Staging environment.

Both organizations actively contribute to cloud architecture, CDK TypeScript development, GitHub Actions implementation, automated and functional testing, troubleshooting, documentation and deployment activities. IF Insurance also provides the existing aws-sc-foundation capabilities, centrally maintained reusable GitHub Actions, and AWS ESC environment access required to support Landing Zone implementation.

Hexaware prepares and maintains the design and governance documentation. Implementation responsibilities for the Staging Landing Zone are shared between Hexaware and If Insurance. Formal pull-request approvals, deployment promotions and Production release approvals are performed by authorized If Insurance reviewers in accordance with the agreed GitOps governance model and separation-of-duties controls.

## 9.2 Review Process

- The design review window is completed before implementation begins, consistent with the companion SCP, KMS, Logging, Security Baseline and GitOps documents.

- Comments are recorded in Azure Boards work item WI-1543618 or annotated directly in this document.

- Any material unresolved design concern from the relevant Security, Compliance, Cloud Governance or Cloud Platform stakeholder blocks design sign-off and the start of implementation. Once development begins, detailed IaC pull requests, Staging deployments, Production promotions and releases are formally reviewed and approved by authorized If Insurance reviewers in accordance with the agreed GitOps governance model and separation-of-duties controls.

## 9.3 Open Design Decisions for Client Confirmation

| **Design decision**                       | **Detail**                                                                                                                                                                                                                                                                                                                                                                        |
|-------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Persona mapping confirmation              | Confirm the Landing Zone personas in Section 3 and their role assignments match the If Insurance team structure.                                                                                                                                                                                                                                                                  |
| Corporate IdP details required            | Confirm the If Insurance corporate Identity Provider, SAML 2.0 integration details, IdP group naming standard, MFA policy, and the owner responsible for IdP-to-IAM Identity Center integration.                                                                                                                                                                                  |
| IAM Identity Center configuration         | IAM Identity Center availability is confirmed. Confirm the instance and corporate IdP integration model for each AWS Organization, including ownership, access portal details, whether SCIM provisioning and group synchronization are configured independently for Staging and Production, and how a common Permission Set catalogue will be governed across both Organizations. |
| JIT tool and process                      | Confirm the ITSM/PAM tool, approvers, maximum session duration, and automatic expiry/revocation mechanism for JIT elevation.                                                                                                                                                                                                                                                      |
| Break-glass vault solution                | Confirm the approved credential storage mechanism (physical vault, PAM tool, or secrets manager outside AWS) for break-glass IAM user credentials.                                                                                                                                                                                                                                |
| Workload account role design              | Workload developer roles (Section 3) are placeholders. Detailed workload permissions are owned by workload teams and must comply with OU SCP boundaries and separation between Non-Production and Production.                                                                                                                                                                     |
| ABAC adoption decision                    | Confirm whether ABAC using IdP-provided session attributes is supported for the current ESC federation approach. Until confirmed, explicit group-to-role mappings are the baseline.                                                                                                                                                                                               |
| Access review cadence                     | Confirm the quarterly access review process, tooling, and responsible parties (Cloud Platform Lead and CISO).                                                                                                                                                                                                                                                                     |
| Sandbox access model                      | Confirm the approved Sandbox user groups, permitted services, and whether a dedicated Sandbox Permission Set is required.                                                                                                                                                                                                                                                         |
| Suspended-account recovery exception      | Confirm whether SCP-ESC-SUS-001 includes a controlled recovery exception and identify the authorized emergency principal and approval process.                                                                                                                                                                                                                                    |
| Production workload JIT model             | Confirm the approved Production workload access window, approvers, operational actions allowed, and whether any roles require standing read-only access.                                                                                                                                                                                                                          |
| Permissions-boundary standard             | Confirm the approved permissions-boundary policy and the role categories to which it applies, including pipeline-created, workload-created and delegated administration roles.                                                                                                                                                                                                    |
| OIDC session-correlation standard         | Confirm the required OIDC role-session naming/tagging pattern carrying repository, PR number, commit SHA, workflow run and applicable change reference.                                                                                                                                                                                                                           |
| Root-user control ownership               | Confirm the owner for root contact details, MFA custody, recovery testing, root-use alerting and periodic verification for every ESC account.                                                                                                                                                                                                                                     |
| Access Analyzer availability and fallback | Confirm IAM Access Analyzer availability in ESC. If unavailable or limited, approve API-based analysis of external principals, unused access and broad trust relationships.                                                                                                                                                                                                       |

## 

## 9.4 Approval Sign-Off

| **Role**                              | **Name** | **Date** | **Signature** |
|---------------------------------------|----------|----------|---------------|
| IF Insurance Cloud Platform Architect |          |          |               |
| IF Insurance CISO / Security Lead     |          |          |               |
| Compliance Officer                    |          |          |               |
