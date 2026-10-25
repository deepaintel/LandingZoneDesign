/**
 * Encryption and key-management SCPs - catalogue sections 4.1, 4.2, 4.5 and 4.6.
 *
 * SCP-ESC-WL-002 target ruling: catalogue sections 2.2 and 2.4 place WL-002 on the Workloads OU,
 * while section 2.3 and the individual definition in section 4.2 say Root. The approved ruling for
 * this implementation is the section 2.2 / 2.4 placement (Workloads OU). The conflicting references
 * are recorded as catalogue documentation defects.
 */

import {
  exemptPrincipals,
  mergeConditions,
  policyDocument,
  ROOT_TARGET_KEY,
  statement,
  type PolicyCondition,
  type PolicyContext,
  type OrganizationsPolicyDefinition
} from './types.js';

const WORKLOADS_OU_TARGET_KEY = 'workloads';

/**
 * MFA guard for the KMS key-loss actions, shared by SCP-ESC-WL-001 (section 4.1) and
 * SCP-ESC-ENC-001 (section 4.5), which both document it.
 *
 * Human administrative access remains MFA-controlled. Approved automation principals are exempt
 * because an OIDC-assumed or service-role session never carries MFA context, so without the
 * exemption the approved pipeline could not perform any KMS key lifecycle operation. This follows
 * the approved KMS design section 7.3, which scopes these actions to "explicitly authorized
 * administrative or service roles" and states that "automated or pipeline-initiated deletion must
 * use an explicitly approved service role", and section 5.1.1, which requires key replacement to run
 * "through an approved automation runbook or controlled CI/CD pipeline".
 *
 * The deny is unchanged for every other principal.
 */
function kmsKeyLossCondition(context: PolicyContext): PolicyCondition | undefined {
  return mergeConditions(
    { BoolIfExists: { 'aws:MultiFactorAuthPresent': 'false' } },
    exemptPrincipals([...context.exemptions.kmsAdministratorRoles, ...context.exemptions.pipelineRoles])
  );
}

/**
 * Legacy Elastic Load Balancing TLS security policies, enumerated verbatim in catalogue section 4.2.
 */
const LEGACY_ELB_SECURITY_POLICIES = [
  'ELBSecurityPolicy-2016-08',
  'ELBSecurityPolicy-TLS-1-0-2015-04',
  'ELBSecurityPolicy-2015-05'
];

/**
 * SCP-ESC-WL-001 - Encryption at Rest, CMK Mandatory [HIGH], catalogue section 4.1.
 *
 * IMPLEMENTED FOR CURRENT APPROVED SCOPE - one documented sub-control is withheld.
 *
 * Implemented, all documented by the catalogue:
 *  - S3: deny `PutObject` without the SSE-KMS header (absent header and non-KMS header both denied);
 *  - EBS: deny `CreateVolume` / `RunInstances` when the volume is not encrypted;
 *  - RDS: deny `CreateDBInstance` / `CreateDBCluster` / `RestoreDBInstanceFromDBSnapshot` when
 *    `StorageEncrypted` is false;
 *  - KMS: deny `ScheduleKeyDeletion` / `DisableKey` without MFA present.
 *
 * NOT EXPRESSIBLE BY SCP - ALTERNATIVE CONTROL: "deny PutBucketEncryption without KMS" remains
 * withheld. `s3:PutEncryptionConfiguration` publishes no request-context condition key describing the
 * requested server-side-encryption algorithm, so the documented condition cannot be expressed, and
 * denying the action outright would block the very KMS-backed bucket configuration the control
 * requires. Reconciled against the approved KMS design section 3.2 and Security Baseline section 4.3:
 * neither supplies a condition key, and Security Baseline section 2.1 prescribes "a custom Config
 * rule set" where AWS-managed rules are unavailable in ESC. The control is therefore delivered as an
 * AWS Config rule (managed where available, custom otherwise) plus the CDK S3 construct default. The
 * `PutObject` statements below already deliver the write-time data-protection outcome; the bucket
 * default-encryption check is defence in depth.
 *
 * The KMS MFA guard is intentionally duplicated with SCP-ESC-ENC-001: both catalogue sections 4.1 and
 * 4.5 document it, and the catalogue describes the pair as defence in depth.
 */
export const scpEscWl001: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-WL-001',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Deny unencrypted S3, EBS and RDS resources. Customer-managed KMS CMK mandatory.',
  catalogueSection: '4.1',
  priority: 'HIGH',
  targetKeys: [WORKLOADS_OU_TARGET_KEY],
  partialAgainstDesign: true,
  document: (context) =>
    policyDocument([
      // The CDK asset-publishing role is exempted from the two S3 PutObject statements only. CDK
      // asset upload to the bootstrap bucket does not always set an explicit SSE header, so without
      // this exemption asset publication into a bootstrapped workload account would be denied.
      statement({
        Sid: 'ScpEscWl001DenyS3PutObjectWithoutSseKmsHeader',
        Effect: 'Deny',
        Action: 's3:PutObject',
        Resource: '*',
        Condition: mergeConditions(
          { Null: { 's3:x-amz-server-side-encryption': 'true' } },
          exemptPrincipals(context.exemptions.assetPublishingRoles)
        )
      }),
      statement({
        Sid: 'ScpEscWl001DenyS3PutObjectWithoutKms',
        Effect: 'Deny',
        Action: 's3:PutObject',
        Resource: '*',
        Condition: mergeConditions(
          { StringNotEquals: { 's3:x-amz-server-side-encryption': 'aws:kms' } },
          exemptPrincipals(context.exemptions.assetPublishingRoles)
        )
      }),
      statement({
        Sid: 'ScpEscWl001DenyUnencryptedEbs',
        Effect: 'Deny',
        Action: ['ec2:CreateVolume', 'ec2:RunInstances'],
        Resource: '*',
        Condition: { Bool: { 'ec2:Encrypted': 'false' } }
      }),
      statement({
        Sid: 'ScpEscWl001DenyUnencryptedRds',
        Effect: 'Deny',
        Action: ['rds:CreateDBInstance', 'rds:CreateDBCluster', 'rds:RestoreDBInstanceFromDBSnapshot'],
        Resource: '*',
        Condition: { Bool: { 'rds:StorageEncrypted': 'false' } }
      }),
      statement({
        Sid: 'ScpEscWl001DenyKmsKeyLossWithoutMfa',
        Effect: 'Deny',
        Action: ['kms:ScheduleKeyDeletion', 'kms:DisableKey'],
        Resource: '*',
        Condition: kmsKeyLossCondition(context)
      })
    ])
};

/**
 * SCP-ESC-WL-002 - Enforce TLS 1.2+ In Transit [HIGH], catalogue section 4.2.
 *
 * Both documented sub-controls are expressible and implemented:
 *  - S3 object operations denied unless `aws:SecureTransport` is true;
 *  - ELB `CreateListener` / `ModifyListener` denied when one of the three enumerated legacy TLS
 *    security policies is specified.
 */
export const scpEscWl002: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-WL-002',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Enforce TLS 1.2+ in transit. Deny HTTP access to S3 and legacy TLS policies on ELB.',
  catalogueSection: '4.2',
  priority: 'HIGH',
  targetKeys: [WORKLOADS_OU_TARGET_KEY],
  partialAgainstDesign: false,
  document: () =>
    policyDocument([
      statement({
        Sid: 'ScpEscWl002DenyInsecureS3Transport',
        Effect: 'Deny',
        Action: ['s3:GetObject', 's3:GetObjectVersion', 's3:PutObject', 's3:DeleteObject', 's3:DeleteObjectVersion'],
        Resource: '*',
        Condition: { Bool: { 'aws:SecureTransport': 'false' } }
      }),
      statement({
        Sid: 'ScpEscWl002DenyLegacyElbTlsPolicies',
        Effect: 'Deny',
        Action: ['elasticloadbalancing:CreateListener', 'elasticloadbalancing:ModifyListener'],
        Resource: '*',
        Condition: { StringEquals: { 'elasticloadbalancing:SecurityPolicy': LEGACY_ELB_SECURITY_POLICIES } }
      })
    ])
};

/**
 * SCP-ESC-ENC-001 - KMS CMK Lifecycle Protection [HIGH], catalogue section 4.5.
 *
 * IMPLEMENTED FOR CURRENT APPROVED SCOPE - one documented sub-control is withheld.
 *
 * Implemented, all documented by the catalogue:
 *  - deny `kms:ScheduleKeyDeletion` and `kms:DisableKey` without MFA present;
 *  - deny `kms:DisableKeyRotation`;
 *  - deny `kms:DeleteImportedKeyMaterial`;
 *  - deny `kms:TagResource` / `kms:UntagResource` unless the caller is the CDK pipeline role.
 *
 * NOT EXPRESSIBLE BY SCP - ALTERNATIVE CONTROL ALREADY IMPLEMENTED, NO RESIDUAL GAP: "deny
 * kms:PutKeyPolicy where the new policy would grant access to any principal outside the ESC
 * organization" remains withheld. An SCP condition cannot inspect the contents of a key policy
 * document being submitted, and `aws:PrincipalOrgID` describes the CALLING principal rather than the
 * policy payload, so as written the condition would never fire for in-organization callers.
 *
 * Reconciled against the approved KMS design: section 6.3 states that a key policy granting access
 * to a principal outside the ESC organisation is "blocked at the resource level by RCP-ESC-KMS-001
 * regardless of key policy content", and that a wildcard principal is "flagged immediately by IAM
 * Access Analyzer". Section 7.3 maps "No cross-org key policy sharing" to SCP-ESC-ENC-001 AND
 * RCP-ESC-KMS-001 jointly. RCP-ESC-KMS-001 is implemented in full in this stack, so the control is
 * delivered and no gap remains.
 */
export const scpEscEnc001: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-ENC-001',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'KMS CMK lifecycle protection: deletion, disable, rotation and tagging guards.',
  catalogueSection: '4.5',
  priority: 'HIGH',
  targetKeys: [ROOT_TARGET_KEY],
  partialAgainstDesign: true,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscEnc001DenyKeyLossWithoutMfa',
        Effect: 'Deny',
        Action: ['kms:ScheduleKeyDeletion', 'kms:DisableKey'],
        Resource: '*',
        Condition: kmsKeyLossCondition(context)
      }),
      statement({
        Sid: 'ScpEscEnc001DenyDisableKeyRotation',
        Effect: 'Deny',
        Action: 'kms:DisableKeyRotation',
        Resource: '*'
      }),
      statement({
        Sid: 'ScpEscEnc001DenyDeleteImportedKeyMaterial',
        Effect: 'Deny',
        Action: 'kms:DeleteImportedKeyMaterial',
        Resource: '*'
      }),
      statement({
        Sid: 'ScpEscEnc001DenyKeyTagTampering',
        Effect: 'Deny',
        Action: ['kms:TagResource', 'kms:UntagResource'],
        Resource: '*',
        Condition: exemptPrincipals([
          ...context.exemptions.pipelineRoles,
          ...context.exemptions.controlTowerExecutionRoles
        ])
      })
    ])
};

/**
 * SCP-ESC-ENC-002 - Deny Unencrypted Services, Extended Coverage [HIGH], catalogue section 4.6.
 *
 * IMPLEMENTED FOR CURRENT APPROVED SCOPE - four of the six documented services are withheld.
 *
 * Implemented (the documented condition maps to a real, service-provided IAM condition key):
 *  - Amazon EFS: deny `CreateFileSystem` when `Encrypted` is false;
 *  - Amazon ElastiCache: deny `CreateReplicationGroup` / `CreateServerlessCache` when
 *    `AtRestEncryptionEnabled` is false.
 *
 * NOT EXPRESSIBLE BY SCP - ALTERNATIVE CONTROL: the DynamoDB, Amazon MSK, Amazon SQS and Amazon SNS
 * statements remain withheld. The SCP catalogue table names the resource property to test in each case
 * (`SSESpecification.SSEType`, `EncryptionInTransit.clientBroker`, `KmsMasterKeyId`,
 * `KMSMasterKeyId`) but no IAM condition key, and these four services publish no request-level
 * condition keys for those properties. Section 4.6 asserts that "MSK encryption conditions use kafka:
 * IAM condition keys, confirmed available in the ESC partition" without identifying the key.
 *
 * Reconciled against the approved KMS design section 3.2, which restates the same resource properties
 * and supplies no condition key, and the Security Baseline section 2.1, which confirms the gap and
 * the remedy: "AWS Config ... some managed rules (e.g. certain DynamoDB encryption checks) are not yet
 * supported ... baseline relies on a custom Config rule set". These four services are therefore
 * governed by custom AWS Config rules, not by this SCP. No condition key is guessed here: a fabricated
 * key would synthesize a statement that silently never matches, which is worse than a recorded gap.
 *
 * This SCP remains structured so statements can be added to this SAME policy if AWS later publishes
 * the required condition keys in the aws-eusc partition.
 */
export const scpEscEnc002: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-ENC-002',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Extended encryption coverage for ESC data services. EFS and ElastiCache enforced.',
  catalogueSection: '4.6',
  priority: 'HIGH',
  targetKeys: [WORKLOADS_OU_TARGET_KEY],
  partialAgainstDesign: true,
  document: () =>
    policyDocument([
      statement({
        Sid: 'ScpEscEnc002DenyUnencryptedEfs',
        Effect: 'Deny',
        Action: 'elasticfilesystem:CreateFileSystem',
        Resource: '*',
        Condition: { Bool: { 'elasticfilesystem:Encrypted': 'false' } }
      }),
      statement({
        Sid: 'ScpEscEnc002DenyUnencryptedElastiCache',
        Effect: 'Deny',
        Action: ['elasticache:CreateReplicationGroup', 'elasticache:CreateServerlessCache'],
        Resource: '*',
        Condition: { Bool: { 'elasticache:AtRestEncryptionEnabled': 'false' } }
      })
    ])
};

export const encryptionPolicies: readonly OrganizationsPolicyDefinition[] = [
  scpEscWl001,
  scpEscWl002,
  scpEscEnc001,
  scpEscEnc002
];
