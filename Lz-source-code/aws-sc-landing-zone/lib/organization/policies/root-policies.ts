/**
 * Root-attached sovereignty and governance SCPs - catalogue sections 3.1 to 3.4.
 *
 * Target placement (Root) is consistent across catalogue sections 2.2, 2.3, 2.4 and each individual
 * definition. Documents are derived from design intent; see `types.ts` for the provenance rule.
 */

import {
  ESC_REGION,
  ESC_ROOT_USER_ARN,
  exemptPrincipals,
  mergeConditions,
  policyDocument,
  ROOT_TARGET_KEY,
  statement,
  type OrganizationsPolicyDefinition
} from './types.js';

/**
 * Global services exempted from the Region lock, exactly as enumerated in catalogue section 3.1
 * ("IAM, STS, Route53, Organizations, Support, Budgets, SSO"). The service prefixes are the derived
 * part; the service set itself is documented. No additional prefix is added.
 */
const GLOBAL_SERVICE_PREFIXES = ['iam:*', 'sts:*', 'route53:*', 'organizations:*', 'support:*', 'budgets:*', 'sso:*'];

/**
 * SCP-ESC-ROOT-001 - Deny Non-ESC Regions [CRITICAL], catalogue section 3.1.
 *
 * The catalogue's single most important control: no API call may target any Region other than
 * `eusc-de-east-1`. Zero exceptions are permitted for workloads (catalogue section 7.1).
 */
export const scpEscRoot001: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-ROOT-001',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Deny all API calls outside eusc-de-east-1. AWS ESC sovereignty lock.',
  catalogueSection: '3.1',
  priority: 'CRITICAL',
  targetKeys: [ROOT_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscRoot001DenyNonEscRegions',
        Effect: 'Deny',
        NotAction: GLOBAL_SERVICE_PREFIXES,
        Resource: '*',
        Condition: mergeConditions(
          { StringNotEquals: { 'aws:RequestedRegion': ESC_REGION } },
          // Documented exemptions: the CDK pipeline role and the AWS Organizations service-linked role.
          exemptPrincipals([...context.exemptions.pipelineRoles, ...context.exemptions.organizationsServiceRoles])
        )
      })
    ])
};

/**
 * SCP-ESC-ROOT-002 - Eliminate Root User API Access [CRITICAL], catalogue section 3.2.
 *
 * The principal ARN is documented verbatim in the catalogue as `arn:aws-eusc:iam::*:root`. Denying
 * every action performed by the account root user also covers the catalogue's explicit note about
 * root access keys and root login profiles, since those are root-only API operations.
 */
export const scpEscRoot002: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-ROOT-002',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Deny all root user API actions across every account in the AWS ESC organization.',
  catalogueSection: '3.2',
  priority: 'CRITICAL',
  targetKeys: [ROOT_TARGET_KEY],
  partialAgainstDesign: false,
  document: () =>
    policyDocument([
      statement({
        Sid: 'ScpEscRoot002DenyRootUserActions',
        Effect: 'Deny',
        Action: '*',
        Resource: '*',
        Condition: { StringLike: { 'aws:PrincipalArn': ESC_ROOT_USER_ARN } }
      })
    ])
};

/**
 * SCP-ESC-ROOT-003 - Protect SCP Governance [CRITICAL], catalogue section 3.3.
 *
 * Actions implement exactly the five verbs the catalogue documents: "creating, modifying, deleting,
 * attaching, or detaching SCPs and RCPs".
 *
 * NOTE FOR REVIEW: `organizations:DisablePolicyType` is not documented by the catalogue and is
 * therefore NOT denied here, even though disabling a policy type is a direct route to bypassing the
 * guardrail framework. Adding it would be an undocumented control. Recommended as a catalogue
 * enhancement rather than an unapproved code addition.
 *
 * CONTROL TOWER COMPATIBILITY (governed by
 * `.apm/instructions/control-tower-scp-compatibility.instructions.md` §7.1): the AWS Control Tower
 * service-linked role `AWSServiceRoleForAWSControlTower` is the API caller for
 * `organizations:CreatePolicy`, `AttachPolicy`, `DetachPolicy`, `UpdatePolicy` and `DeletePolicy`
 * when Control Tower creates or attaches its `aws-guardrails-*` preventive controls. It is added
 * ALONGSIDE the existing pipeline-role exemption; the deny is unchanged for every other principal.
 */
export const scpEscRoot003: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-ROOT-003',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Deny SCP/RCP governance tampering by member accounts.',
  catalogueSection: '3.3',
  priority: 'CRITICAL',
  targetKeys: [ROOT_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscRoot003DenyPolicyGovernanceChanges',
        Effect: 'Deny',
        Action: [
          'organizations:CreatePolicy',
          'organizations:UpdatePolicy',
          'organizations:DeletePolicy',
          'organizations:AttachPolicy',
          'organizations:DetachPolicy'
        ],
        Resource: '*',
        Condition: exemptPrincipals([
          ...context.exemptions.pipelineRoles,
          ...context.exemptions.controlTowerServiceLinkedRoles
        ])
      })
    ])
};

/**
 * SCP-ESC-ROOT-004 - Approved Service Boundary [HIGH], catalogue section 3.4.
 *
 * IMPLEMENTED FOR CURRENT APPROVED SCOPE - NOT COMPLETE AGAINST THE FULL FUTURE APPROVED-SERVICE-
 * BOUNDARY DESIGN.
 *
 * The catalogue documents two distinct things:
 *
 *  1. a customer-directed denial of Amazon Lightsail and Amazon Elastic Beanstalk resource creation,
 *     implemented below with a single category-wildcard per service (`lightsail:Create*` and
 *     `elasticbeanstalk:Create*`); and
 *  2. a boundary that denies "services not included on the approved ESC service catalogue" - but the
 *     approved service catalogue itself is NOT contained anywhere in the design document.
 *
 * Both services use `service:Create*` because the catalogue documents the intent as a CATEGORY
 * ("Elastic Beanstalk resource creation API actions"), not as an enumerated list, and there is no
 * exception carve-out for any individual `Create...` verb. The wildcard therefore matches the
 * documented intent, keeps the two services consistent in shape, and automatically covers any new
 * `Create...` action AWS adds later. Enumerating specific verbs would (a) be inconsistent with
 * Lightsail, (b) drift silently when AWS extends the API, and (c) misrepresent the catalogue's
 * category-scoped design as verb-scoped.
 *
 * DERIVATION GAP: the approved-service list is deliberately not inferred. Instead, this SCP carries a
 * second statement that activates as soon as `governance.approvedServiceBoundary.services` is
 * populated in configuration. The future boundary therefore lands through a normal GitOps change to
 * this same SCP - no new SCP, no new attachment, no restructuring.
 */
export const scpEscRoot004: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-ROOT-004',
  policyType: 'SERVICE_CONTROL_POLICY',
  description:
    'Deny customer-directed denied services (Lightsail, Elastic Beanstalk). Approved-service boundary pending.',
  catalogueSection: '3.4',
  priority: 'HIGH',
  targetKeys: [ROOT_TARGET_KEY],
  partialAgainstDesign: true,
  document: (context) => {
    const statements = [
      statement({
        Sid: 'ScpEscRoot004DenyCustomerDirectedServices',
        Effect: 'Deny',
        Action: ['lightsail:Create*', 'elasticbeanstalk:Create*'],
        Resource: '*'
      })
    ];

    // Extension point. Empty by design until the approved ESC service catalogue is confirmed.
    if (context.approvedServiceBoundary.services.length > 0) {
      statements.push(
        statement({
          Sid: 'ScpEscRoot004ApprovedServiceBoundary',
          Effect: 'Deny',
          NotAction: context.approvedServiceBoundary.services.map((service) => `${service}:*`),
          Resource: '*',
          Condition: exemptPrincipals(context.exemptions.pipelineRoles)
        })
      );
    }

    return policyDocument(statements);
  }
};

export const rootPolicies: readonly OrganizationsPolicyDefinition[] = [
  scpEscRoot001,
  scpEscRoot002,
  scpEscRoot003,
  scpEscRoot004
];
