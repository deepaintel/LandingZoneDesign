/**
 * Identity, privileged-access and production change-control SCPs - catalogue sections 5.1 to 5.4.
 *
 * SCP-ESC-WL-003 target ruling: catalogue sections 2.2 and 2.4 place WL-003 on the Workloads OU,
 * while section 2.3 and the individual definition in section 5.1 say Root. The approved ruling for
 * this implementation is the section 2.2 / 2.4 placement (Workloads OU). The conflicting references
 * are recorded as catalogue documentation defects.
 */

import {
  exemptPrincipals,
  mergeConditions,
  policyDocument,
  statement,
  type OrganizationsPolicyDefinition
} from './types.js';

const WORKLOADS_OU_TARGET_KEY = 'workloads';

/** The three L3 Prod OUs, one per workload domain family (catalogue sections 2.2 and 5.4). */
const PROD_OU_TARGET_KEYS = ['workloads-hybrid-prod', 'workloads-online-prod', 'workloads-corp-prod'];

/**
 * Public S3 canned ACL values. Catalogue section 5.4 says "any public ACL value" without enumerating
 * them; these are the two canned ACLs that grant access to anonymous public users. `authenticated-read`
 * is deliberately excluded - it grants to all authenticated AWS principals rather than to the public,
 * and adding it would broaden the documented control.
 */
const PUBLIC_S3_CANNED_ACLS = ['public-read', 'public-read-write'];

/** Approved SSM maintenance-window tag values, documented verbatim in catalogue section 5.4. */
const APPROVED_MAINTENANCE_WINDOW_TAG_VALUES = ['approved', 'emergency'];

/**
 * SCP-ESC-WL-003 - Deny IAM Users; Enforce SSO-Only Access [HIGH], catalogue section 5.1.
 *
 * The four denied actions and both exemptions (CDK pipeline role, IAM Identity Center service-linked
 * role) are documented explicitly.
 *
 * DESIGN DEPENDENCY (catalogue sections 5.1 and 10.2): IAM Identity Center must be deployed and
 * confirmed operational before this SCP is enforced. That is a deployment-sequencing constraint, not
 * a code constraint - no deployment happens in this increment.
 */
export const scpEscWl003: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-WL-003',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Deny IAM user and static access key creation. Enforce IAM Identity Center SSO-only access.',
  catalogueSection: '5.1',
  priority: 'HIGH',
  targetKeys: [WORKLOADS_OU_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscWl003DenyIamUsersAndStaticCredentials',
        Effect: 'Deny',
        Action: ['iam:CreateUser', 'iam:CreateLoginProfile', 'iam:CreateAccessKey', 'iam:UpdateAccessKey'],
        Resource: '*',
        Condition: exemptPrincipals([
          ...context.exemptions.pipelineRoles,
          ...context.exemptions.identityCenterServiceRoles
        ])
      })
    ])
};

/**
 * SCP-ESC-IAM-001 - Deny Privilege Escalation [HIGH], catalogue section 5.2.
 *
 * Statement 1 implements the four actions and both exemptions documented explicitly by the SCP
 * catalogue (CDK pipeline role, break-glass role).
 *
 * Statement 2 is a RECONCILED SCOPE EXTENSION beyond SCP catalogue section 5.2, resolved from the
 * approved IAM design. Section 4.9 enumerates the privilege-escalation-sensitive permissions and
 * requires "explicit deny guardrails where appropriate"; section 8.2 states that "trust-policy,
 * identity-provider, policy-version, and permissions-boundary changes are denied except through
 * approved deployment roles and workflows"; section 7.2 records the same requirement as a governance
 * control. The identity-provider and permissions-boundary actions are implemented here.
 *
 * `iam:PassRole` is deliberately EXCLUDED. IAM design section 4.9 requires it to be limited to
 * "approved roles, resource paths and deployment workflows", and those resource paths are not yet
 * defined; a blanket deny would block every legitimate instance profile and service role.
 *
 * `iam:UpdateAssumeRolePolicy` is implemented in SCP-ESC-IAM-002 instead, where the external-trust
 * control lives, so it is not duplicated here.
 */
export const scpEscIam001: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-IAM-001',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Deny privilege escalation through IAM policy, identity-provider or boundary changes.',
  catalogueSection: '5.2',
  priority: 'HIGH',
  targetKeys: [WORKLOADS_OU_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscIam001DenyPrivilegeEscalation',
        Effect: 'Deny',
        Action: ['iam:AttachRolePolicy', 'iam:PutRolePolicy', 'iam:CreatePolicyVersion', 'iam:SetDefaultPolicyVersion'],
        Resource: '*',
        Condition: exemptPrincipals([...context.exemptions.pipelineRoles, ...context.exemptions.breakGlassRoles])
      }),
      statement({
        Sid: 'ScpEscIam001DenyIdentityGuardrailChanges',
        Effect: 'Deny',
        Action: [
          'iam:CreateOpenIDConnectProvider',
          'iam:UpdateOpenIDConnectProviderThumbprint',
          'iam:PutRolePermissionsBoundary',
          'iam:DeleteRolePermissionsBoundary',
          'iam:PutUserPermissionsBoundary',
          'iam:DeleteUserPermissionsBoundary'
        ],
        Resource: '*',
        Condition: exemptPrincipals([...context.exemptions.pipelineRoles, ...context.exemptions.breakGlassRoles])
      })
    ])
};

/**
 * SCP-ESC-IAM-002 - Deny External Cross-Account Trust [HIGH], catalogue section 5.3.
 *
 * IMPLEMENTED FOR CURRENT APPROVED SCOPE - STILL PARTIAL against the full external-trust design.
 *
 * Implemented:
 *  - deny `ram:CreateResourceShare` when the share allows external principals. The catalogue writes
 *    the property as `AllowExternalPrincipals=true`; the corresponding AWS RAM IAM condition key is
 *    `ram:AllowsExternalPrincipals`, which is the derived part;
 *  - deny `iam:UpdateAssumeRolePolicy` except for approved deployment and break-glass principals.
 *    This is the SCP-expressible portion of the external-trust control and is resolved from the
 *    approved IAM design section 8.2 ("trust-policy ... changes are denied except through approved
 *    deployment roles and workflows") and section 4.9, which lists the action explicitly. It prevents
 *    an existing role's trust policy from being repointed at an external principal.
 *
 * NOT EXPRESSIBLE BY SCP - ALTERNATIVE CONTROL: creating a NEW role whose trust policy already names
 * an external principal is still not enforceable here. `iam:CreateRole` publishes no condition key
 * that inspects the submitted `AssumeRolePolicyDocument`, and denying role creation outright would
 * broaden the control far beyond the approved design.
 *
 * Reconciled against the approved IAM design, which assigns the remaining control to mechanisms
 * outside the SCP layer:
 *  - permissions boundaries as an upper bound "in addition to SCPs and identity policies" for roles
 *    created by workload teams, delegated administrators and automation (section 4.9);
 *  - IaC-authored trust policies that enumerate permitted principals, with wildcard principals
 *    prohibited and external account trust requiring security review and approval (section 4.1.2);
 *  - IAM Access Analyzer external-principal analysis, with approved API-based analysis as the ESC
 *    fallback (sections 4.10 and 9.3).
 *
 * This policy therefore stays marked partial until those controls are implemented and confirmed.
 */
export const scpEscIam002: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-IAM-002',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Deny external AWS RAM shares and unapproved IAM trust-policy modification.',
  catalogueSection: '5.3',
  priority: 'HIGH',
  targetKeys: [WORKLOADS_OU_TARGET_KEY],
  partialAgainstDesign: true,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscIam002DenyExternalResourceShares',
        Effect: 'Deny',
        Action: 'ram:CreateResourceShare',
        Resource: '*',
        Condition: { Bool: { 'ram:AllowsExternalPrincipals': 'true' } }
      }),
      statement({
        Sid: 'ScpEscIam002DenyTrustPolicyModification',
        Effect: 'Deny',
        Action: 'iam:UpdateAssumeRolePolicy',
        Resource: '*',
        Condition: exemptPrincipals([...context.exemptions.pipelineRoles, ...context.exemptions.breakGlassRoles])
      })
    ])
};

/**
 * SCP-ESC-PROD-001 - Production Privileged Access Restrictions [HIGH], catalogue section 5.4.
 *
 * Three combined controls, all documented:
 *  - CloudFormation stack deletion protection, exempting the approved CDK pipeline role;
 *  - denial of public S3 canned ACLs;
 *  - SSM Session Manager restricted to instances tagged `MaintenanceWindow=approved|emergency`, with
 *    the break-glass emergency role as the only permanent exemption.
 *
 * Attached to all three L3 Prod OUs from a single policy resource - no redundant child attachments.
 */
export const scpEscProd001: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-PROD-001',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Production change control: deny stack deletion, public S3 ACLs and unrestricted SSM access.',
  catalogueSection: '5.4',
  priority: 'HIGH',
  targetKeys: PROD_OU_TARGET_KEYS,
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscProd001ProtectProductionStacks',
        Effect: 'Deny',
        Action: ['cloudformation:DeleteStack', 'cloudformation:UpdateTerminationProtection'],
        Resource: '*',
        Condition: exemptPrincipals(context.exemptions.pipelineRoles)
      }),
      statement({
        Sid: 'ScpEscProd001DenyPublicS3Acls',
        Effect: 'Deny',
        Action: ['s3:PutBucketAcl', 's3:PutObjectAcl'],
        Resource: '*',
        Condition: { StringEquals: { 's3:x-amz-acl': PUBLIC_S3_CANNED_ACLS } }
      }),
      statement({
        Sid: 'ScpEscProd001RestrictSessionManager',
        Effect: 'Deny',
        Action: ['ssm:StartSession', 'ssm:ResumeSession'],
        Resource: '*',
        Condition: mergeConditions(
          {
            StringNotEquals: {
              'ssm:resourceTag/MaintenanceWindow': APPROVED_MAINTENANCE_WINDOW_TAG_VALUES
            }
          },
          exemptPrincipals(context.exemptions.breakGlassRoles)
        )
      })
    ])
};

export const identityPolicies: readonly OrganizationsPolicyDefinition[] = [
  scpEscWl003,
  scpEscIam001,
  scpEscIam002,
  scpEscProd001
];
