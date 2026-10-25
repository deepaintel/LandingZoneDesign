/**
 * Resource Control Policies - catalogue sections 4.3 and 4.4.
 *
 * RCPs are a distinct AWS Organizations policy type from SCPs and are NEVER implemented as SCPs. They
 * are resource-based, so every statement carries an explicit `Principal`, and they enforce the data
 * perimeter from the resource side: an RCP applies to access from ANY source, including principals
 * outside the organization that an over-permissive resource policy would otherwise admit.
 *
 * Both RCPs target the Organizations Root, consistent between catalogue section 2.3 and their
 * individual definitions. Section 2.2 is an SCP inheritance table and does not list RCPs.
 */

import {
  mergeConditions,
  policyDocument,
  ROOT_TARGET_KEY,
  statement,
  type PolicyCondition,
  type PolicyContext,
  type OrganizationsPolicyDefinition
} from './types.js';

/**
 * KMS key operations protected by RCP-ESC-KMS-001, enumerated in catalogue section 4.4.
 *
 * `kms:ReEncrypt*` is the derived form of the catalogue's `kms:ReEncrypt`: AWS exposes the operation
 * as the two actions `ReEncryptFrom` and `ReEncryptTo`, both matched by the documented single entry.
 */
const PROTECTED_KMS_OPERATIONS = [
  'kms:Decrypt',
  'kms:GenerateDataKey',
  'kms:GenerateDataKeyWithoutPlaintext',
  'kms:CreateGrant',
  'kms:ReEncrypt*',
  'kms:DescribeKey'
];

/**
 * The shared data-perimeter condition.
 *
 * `aws:PrincipalOrgID` resolves from the deployment-time `OrganizationId` parameter and identifies the
 * AWS ESC organization - a completely separate organization from any commercial AWS organization, as
 * catalogue section 4.3 notes.
 *
 * DERIVED (approved): `BoolIfExists aws:PrincipalIsAWSService: false` is not documented in the
 * catalogue but is required for correctness. Without it, an RCP that denies every principal outside
 * the organization also denies AWS service principals, which would break service-to-resource access
 * such as CloudTrail log delivery to S3 and AWS Config writes - the very audit integrity the
 * catalogue's own SEC controls depend on. This guard narrows the deny to non-service principals only
 * and does not admit any external customer principal.
 */
function outsideOrganizationCondition(context: PolicyContext): PolicyCondition | undefined {
  return mergeConditions(
    { StringNotEqualsIfExists: { 'aws:PrincipalOrgID': context.organizationId } },
    { BoolIfExists: { 'aws:PrincipalIsAWSService': 'false' } }
  );
}

/**
 * RCP-ESC-S3-001 - S3 Data Perimeter [HIGH], catalogue section 4.3.
 *
 * Blocks any principal outside the ESC organization from accessing any S3 bucket in any account,
 * regardless of how an individual bucket policy is configured.
 */
export const rcpEscS3001: OrganizationsPolicyDefinition = {
  policyId: 'RCP-ESC-S3-001',
  policyType: 'RESOURCE_CONTROL_POLICY',
  description: 'Block all external principals from AWS ESC S3 resources. Resource-side data perimeter.',
  catalogueSection: '4.3',
  priority: 'HIGH',
  targetKeys: [ROOT_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'RcpEscS3001DenyExternalPrincipalAccess',
        Effect: 'Deny',
        Principal: '*',
        Action: 's3:*',
        Resource: '*',
        Condition: outsideOrganizationCondition(context)
      })
    ])
};

/**
 * RCP-ESC-KMS-001 - KMS Key Data Perimeter [HIGH], catalogue section 4.4.
 *
 * Blocks any external principal from performing key operations on ESC CMKs, even if a key policy
 * mistakenly grants external access. Catalogue section 4.5 describes this RCP as the resource-level
 * half of a defence-in-depth pair with SCP-ESC-ENC-001.
 */
export const rcpEscKms001: OrganizationsPolicyDefinition = {
  policyId: 'RCP-ESC-KMS-001',
  policyType: 'RESOURCE_CONTROL_POLICY',
  description: 'Block external principals from AWS ESC KMS key operations. Resource-side key perimeter.',
  catalogueSection: '4.4',
  priority: 'HIGH',
  targetKeys: [ROOT_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'RcpEscKms001DenyExternalKeyOperations',
        Effect: 'Deny',
        Principal: '*',
        Action: PROTECTED_KMS_OPERATIONS,
        Resource: '*',
        Condition: outsideOrganizationCondition(context)
      })
    ])
};

export const resourceControlPolicies: readonly OrganizationsPolicyDefinition[] = [rcpEscS3001, rcpEscKms001];
