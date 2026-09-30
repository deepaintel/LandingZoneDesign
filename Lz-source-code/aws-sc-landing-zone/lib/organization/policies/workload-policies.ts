/**
 * Workload, network and cost SCPs - catalogue sections 6.1 to 6.5.
 *
 * SCP-ESC-NET-001 (catalogue section 6.3) is intentionally ABSENT from this module. See
 * `withheldPolicies` in `./index.ts` for the recorded reason.
 */

import {
  exemptPrincipals,
  policyDocument,
  statement,
  type OrganizationsPolicyDefinition,
  type PolicyStatement
} from './types.js';

const INFRASTRUCTURE_OU_TARGET_KEY = 'infrastructure';
const SANDBOX_OU_TARGET_KEY = 'sandbox';
const SUSPENDED_OU_TARGET_KEY = 'suspended';
const WORKLOADS_OU_TARGET_KEY = 'workloads';

/**
 * The seven mandatory tag keys, ALIGNED WITH THE ENTERPRISE `global-cloud-tagging-strategy.md` v1.8
 * (sections 4.1, 4.2, 4.3, 4.5) which lists these as P1 with `Deny` enforcement.
 *
 * RECONCILIATION DECISION: earlier revisions of this SCP used the PascalCase 4-key set documented in
 * `ESC_SCP_Design_Catalogue_v2` section 6.1 (`DataClassification`, `Owner`, `Environment`,
 * `CostCentre`). AWS tag keys are case-sensitive, so enforcing catalogue casing against workload IaC
 * emitting the enterprise lowercase keys would have denied every taggable resource creation. The
 * enterprise strategy is now the source of truth for tag keys and values because it (a) applies
 * across every cloud platform including AWS ESC, (b) carries the deny-effect enforcement decision at
 * the enterprise governance level, and (c) is the standard workload IaC already implements. The SCP
 * catalogue's PascalCase list and its inclusion of `Secret` / `CostCentre` are recorded as catalogue
 * documentation defects for the next design revision.
 */
const MANDATORY_TAG_KEYS = [
  'owner',
  'owner-email',
  'environment',
  'lifecycle',
  'data-classification',
  'data-residency',
  'itsystemcode'
];

/** Allowed `data-classification` values (`global-cloud-tagging-strategy.md` §4.3). `Secret` is not in
 * the enterprise vocabulary and is intentionally absent. */
const DATA_CLASSIFICATION_VALUES = ['public', 'internal', 'confidential', 'restricted'];

/** Allowed `environment` values (`global-cloud-tagging-strategy.md` §4.2). */
const ENVIRONMENT_VALUES = ['prod', 'staging', 'dev', 'sandbox'];

/** Allowed `lifecycle` values (`global-cloud-tagging-strategy.md` §4.2). */
const LIFECYCLE_VALUES = ['active', 'deprecated', 'decommissioning', 'archived'];

/** Allowed `data-residency` values (`global-cloud-tagging-strategy.md` §4.3). */
const DATA_RESIDENCY_VALUES = ['eu', 'nordic', 'global', 'no-requirement'];

/**
 * Value-constrained tag keys, keyed by mandatory tag name. Presence is checked for every mandatory
 * key above; value is additionally constrained here only for the four keys that carry a fixed
 * vocabulary in the enterprise strategy. `owner`, `owner-email` and `itsystemcode` are presence-only
 * because their values are per-organisation (owner CI, mailbox, application code respectively).
 */
const VALUE_CONSTRAINED_TAGS: readonly { readonly key: string; readonly values: readonly string[] }[] = [
  { key: 'data-classification', values: DATA_CLASSIFICATION_VALUES },
  { key: 'environment', values: ENVIRONMENT_VALUES },
  { key: 'lifecycle', values: LIFECYCLE_VALUES },
  { key: 'data-residency', values: DATA_RESIDENCY_VALUES }
];

/** Converts a tag key like `data-classification` to a CamelCase suffix used in statement Sids. */
function tagKeySid(tagKey: string): string {
  return tagKey
    .split('-')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

/**
 * Creation actions for every taggable resource type the catalogue brings into scope in section 6.1:
 * EC2 instances, EBS volumes, S3 buckets, RDS instances/clusters, DynamoDB tables, MSK clusters, SQS
 * queues, SNS topics, EFS file systems, ElastiCache replication groups, Lambda functions and KMS keys.
 * The resource list is documented; the specific creation verbs are derived.
 */
const TAGGABLE_RESOURCE_CREATION_ACTIONS = [
  'ec2:RunInstances',
  'ec2:CreateVolume',
  's3:CreateBucket',
  'rds:CreateDBInstance',
  'rds:CreateDBCluster',
  'dynamodb:CreateTable',
  'kafka:CreateCluster',
  'kafka:CreateClusterV2',
  'sqs:CreateQueue',
  'sns:CreateTopic',
  'elasticfilesystem:CreateFileSystem',
  'elasticache:CreateReplicationGroup',
  'elasticache:CreateServerlessCache',
  'lambda:CreateFunction',
  'kms:CreateKey'
];

/**
 * Tag-removal actions matching the same resource scope, used to implement the documented immutability
 * requirement ("also prevents removal of these tags from existing resources").
 *
 * DERIVATION GAP (narrow): `s3:PutBucketTagging` is excluded. S3 bucket tag removal happens by
 * overwriting the whole tag set rather than through a dedicated untag action, and the request context
 * does not carry `aws:TagKeys` for the keys being dropped, so tag removal on S3 buckets cannot be
 * detected by this statement. Every other resource type in scope is covered.
 */
const TAG_REMOVAL_ACTIONS = [
  'ec2:DeleteTags',
  'rds:RemoveTagsFromResource',
  'dynamodb:UntagResource',
  'kafka:UntagResource',
  'sqs:UntagQueue',
  'sns:UntagResource',
  'elasticfilesystem:UntagResource',
  'elasticache:RemoveTagsFromResource',
  'lambda:UntagResource',
  'kms:UntagResource'
];

/**
 * Expensive EC2 instance families denied in the Sandbox OU, enumerated verbatim in catalogue
 * section 6.4.
 */
const SANDBOX_DENIED_INSTANCE_TYPES = [
  '*.24xlarge',
  '*.32xlarge',
  '*.48xlarge',
  '*.metal',
  'p3.*',
  'p4.*',
  'p5.*',
  'g5.*',
  'trn1.*',
  'inf2.*'
];

/**
 * SCP-ESC-WL-004 - Mandatory Tagging on All Taggable Resources [MEDIUM], catalogue section 6.1,
 * reconciled with the enterprise `global-cloud-tagging-strategy.md` v1.8.
 *
 * Enforces the seven P1 Deny-effect keys from the enterprise strategy on every taggable resource
 * creation in the Workloads OU. Four of those keys additionally have their values constrained to the
 * fixed vocabularies published in the enterprise strategy (§4.2, §4.3). Tag REMOVAL for any of the
 * seven keys is denied on every resource type in scope.
 *
 * One statement per PRESENCE check, because SCP condition blocks combine with AND semantics: a single
 * `Null` block listing all seven keys would only deny requests missing ALL seven, whereas the
 * documented control denies a request missing ANY of them.
 *
 * The Sandbox exemption documented in catalogue section 6.1 needs no policy logic: the Sandbox OU is
 * a sibling of Workloads and never inherits this SCP.
 *
 * The section 6.1 header phrase "Prod, Staging, Dev" does not correspond to OU names in the approved
 * 14-OU hierarchy (which uses Prod / Non-Prod) and is read as descriptive. The target remains the
 * Workloads OU, consistent across catalogue sections 2.2, 2.3, 2.4 and 6.1.
 *
 * DERIVATION GAP (narrow, carried forward): `s3:PutBucketTagging` is excluded from the tag-removal
 * statement. S3 tag removal happens by overwriting the whole tag set rather than through a dedicated
 * untag action, and the request context does not carry `aws:TagKeys` for the keys being dropped, so
 * tag removal on S3 buckets cannot be detected here. Every other resource type in scope is covered.
 */
export const scpEscWl004: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-WL-004',
  policyType: 'SERVICE_CONTROL_POLICY',
  description:
    'Require the enterprise P1 mandatory tags on all taggable resources (owner, owner-email, ' +
    'environment, lifecycle, data-classification, data-residency, itsystemcode).',
  catalogueSection: '6.1',
  priority: 'MEDIUM',
  targetKeys: [WORKLOADS_OU_TARGET_KEY],
  partialAgainstDesign: false,
  document: () => {
    // Statement 1..7: presence check for each mandatory tag key.
    const statements: PolicyStatement[] = MANDATORY_TAG_KEYS.map((tagKey) =>
      statement({
        Sid: `ScpEscWl004Require${tagKeySid(tagKey)}Tag`,
        Effect: 'Deny',
        Action: TAGGABLE_RESOURCE_CREATION_ACTIONS,
        Resource: '*',
        Condition: { Null: { [`aws:RequestTag/${tagKey}`]: 'true' } }
      })
    );

    // Statement 8..11: fixed-vocabulary value constraints for each enum-typed key.
    for (const { key, values } of VALUE_CONSTRAINED_TAGS) {
      statements.push(
        statement({
          Sid: `ScpEscWl004Restrict${tagKeySid(key)}Values`,
          Effect: 'Deny',
          Action: TAGGABLE_RESOURCE_CREATION_ACTIONS,
          Resource: '*',
          Condition: { StringNotEquals: { [`aws:RequestTag/${key}`]: values } }
        })
      );
    }

    // Statement 12: block tag removal for any of the seven mandatory keys.
    statements.push(
      statement({
        Sid: 'ScpEscWl004DenyMandatoryTagRemoval',
        Effect: 'Deny',
        Action: TAG_REMOVAL_ACTIONS,
        Resource: '*',
        Condition: { 'ForAnyValue:StringEquals': { 'aws:TagKeys': MANDATORY_TAG_KEYS } }
      })
    );

    return policyDocument(statements);
  }
};

/**
 * SCP-ESC-INF-001 - Centralize Network Management [HIGH], catalogue section 6.2.
 *
 * COMPLETE against the currently documented design.
 *
 * Denies `ec2:CreateVpc`, `ec2:CreateInternetGateway`, `ec2:AttachInternetGateway` and
 * `ec2:AcceptVpcPeeringConnection` except for the approved network administration and CDK pipeline
 * roles.
 *
 * VPC peering resolution: the peering action was previously withheld because section 6.2 qualifies it
 * as "with external principals" and no IAM condition key identifies whether a requester is outside the
 * organization, so an unqualified deny looked like a broadening of the control. Reconciled against
 * SCP catalogue section 2.2, whose Infrastructure OU design intent is unqualified - "Prevent spoke
 * accounts from creating their own internet gateways, VPCs or VPC peering connections" - and the
 * approved Security Baseline section 4.2, which states VPCs are "centralized to the Network account
 * per SCP-ESC-INF-001". The network-administrator exemption is what keeps an unqualified deny correct:
 * legitimate central peering continues to work, while spoke accounts cannot accept peering at all.
 *
 * `ec2:CreateVpcPeeringConnection` is deliberately NOT added: no approved design document names it.
 *
 * Exemption principals resolved from the approved IAM design sections 3.2 and 4.1.2:
 * LZ-NetworkAdmin-PermissionSet governs centralized networking in the Shared Services Account. Note
 * that IAM design section 5.1.1 states networking is a function of the Shared Services Account and not
 * a separate AWS account, while the KMS, Logging and Security Baseline designs all refer to a
 * "Network account"; that conflict is recorded and does not affect this policy, whose exemption is
 * expressed by role rather than by account.
 */
export const scpEscInf001: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-INF-001',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Centralise VPC, internet gateway and VPC peering management to the network function.',
  catalogueSection: '6.2',
  priority: 'HIGH',
  targetKeys: [INFRASTRUCTURE_OU_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscInf001CentraliseNetworkManagement',
        Effect: 'Deny',
        Action: [
          'ec2:CreateVpc',
          'ec2:CreateInternetGateway',
          'ec2:AttachInternetGateway',
          'ec2:AcceptVpcPeeringConnection'
        ],
        Resource: '*',
        Condition: exemptPrincipals([
          ...context.exemptions.networkAdministratorRoles,
          ...context.exemptions.pipelineRoles
        ])
      })
    ])
};

/**
 * SCP-ESC-SBX-001 - Sandbox Cost Guardrails [MEDIUM], catalogue section 6.4.
 *
 * All three controls are documented explicitly, including the instance-family list and the FinOps role
 * exemption on reservation purchases.
 */
export const scpEscSbx001: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-SBX-001',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Sandbox cost guardrails: deny expensive instance families, NAT gateways and reservations.',
  catalogueSection: '6.4',
  priority: 'MEDIUM',
  targetKeys: [SANDBOX_OU_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscSbx001DenyExpensiveInstanceFamilies',
        Effect: 'Deny',
        Action: 'ec2:RunInstances',
        Resource: '*',
        Condition: { StringLike: { 'ec2:InstanceType': SANDBOX_DENIED_INSTANCE_TYPES } }
      }),
      statement({
        Sid: 'ScpEscSbx001DenyNatGateways',
        Effect: 'Deny',
        Action: 'ec2:CreateNatGateway',
        Resource: '*'
      }),
      statement({
        Sid: 'ScpEscSbx001DenyReservationPurchases',
        Effect: 'Deny',
        Action: [
          'ec2:PurchaseReservedInstancesOffering',
          'savingsplans:CreateSavingsPlan',
          'rds:PurchaseReservedDBInstancesOffering'
        ],
        Resource: '*',
        Condition: exemptPrincipals(context.exemptions.finOpsRoles)
      })
    ])
};

/**
 * SCP-ESC-SUS-001 - Suspended Account Quarantine [CRITICAL], catalogue section 6.5.
 *
 * Documented as a full quarantine: "Denies ALL API actions (Action: *) with no exemptions". No
 * condition and no exemption are added, exactly as designed.
 */
export const scpEscSus001: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-SUS-001',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Full quarantine for suspended accounts. Deny all API actions with no exemptions.',
  catalogueSection: '6.5',
  priority: 'CRITICAL',
  targetKeys: [SUSPENDED_OU_TARGET_KEY],
  partialAgainstDesign: false,
  document: () =>
    policyDocument([
      statement({
        Sid: 'ScpEscSus001FullQuarantine',
        Effect: 'Deny',
        Action: '*',
        Resource: '*'
      })
    ])
};

export const workloadPolicies: readonly OrganizationsPolicyDefinition[] = [
  scpEscWl004,
  scpEscInf001,
  scpEscSbx001,
  scpEscSus001
];
