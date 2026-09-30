/**
 * Security-monitoring and audit-integrity SCPs - catalogue sections 3.5 to 3.7.
 *
 * Target placement: Organizations Root for SEC-001, Security OU for SEC-002 and SEC-003.
 *
 * SCP-ESC-SEC-001 target ruling (SUPERSEDES the earlier Security-OU ruling): SEC-001 is attached to
 * the Organizations Root. The earlier ruling followed SCP catalogue sections 2.2 and 2.4, but the
 * approved Centralized Logging & Retention design requires these protections to remain effective
 * outside the Security OU - its section 3.2 states that Sandbox OU management-plane logging "cannot
 * be disabled per SCP-ESC-SEC-001" and that Suspended OU accounts keep "existing SCP protections".
 * A Security-OU-only attachment cannot satisfy either requirement. This also aligns SEC-001 with
 * SCP catalogue section 2.3 and its own definition in section 3.5, both of which say Root.
 *
 * WL-002 and WL-003 are unaffected by this ruling and remain attached to the Workloads OU.
 */

import {
  exemptPrincipals,
  policyDocument,
  ROOT_TARGET_KEY,
  statement,
  type OrganizationsPolicyDefinition
} from './types.js';

const SECURITY_OU_TARGET_KEY = 'security';

/**
 * SCP-ESC-SEC-001 - Protect All Security Monitoring Services [CRITICAL], catalogue section 3.5.
 *
 * Actions are derived from the catalogue's documented protections per service:
 *  - CloudTrail: "cannot be stopped, deleted, or modified";
 *  - Config: "recorder and delivery channel - cannot be stopped or deleted";
 *  - GuardDuty: "detector - cannot be deleted or disassociated";
 *  - Security Hub: "cannot be disabled or members removed".
 *
 * Amazon Inspector v2 and Amazon Macie are deliberately absent: the catalogue records both as
 * unavailable in eusc-de-east-1, with compensating controls handled outside the SCP framework.
 *
 * The Security Hub statements are retained. The approved Centralized Logging design (sections 2.1,
 * 2.3) and Security Baseline (section 6) both record AWS Security Hub CSPM as active in ESC and
 * protected by this SCP, while the IAM design section 2.1 states Security Hub "is not assumed".
 * Two of the three approved references support retaining the statements; the conflict is recorded
 * rather than silently resolved.
 *
 * The original design records no exemption. Two scoped Control Tower compatibility exemptions are
 * added below per `.apm/instructions/control-tower-scp-compatibility.instructions.md` §7.2, on the
 * two sub-statements whose lifecycle actions Control Tower Landing Zone 4.0 actually calls:
 *  - `ScpEscSec001ProtectCloudTrail` exempts `AWSServiceRoleForAWSControlTower` because the
 *    management-account CT service-linked role owns the optional Control Tower-managed
 *    organization trail (`aws-controltower-BaselineCloudTrail`) lifecycle. If the customer chooses
 *    the bring-your-own-trail path, no CT principal calls `UpdateTrail` and the exemption is
 *    inert but safe.
 *  - `ScpEscSec001ProtectConfigRecorder` exempts `AWSControlTowerExecution` because the AWS Config
 *    recorder and delivery channel are member-account resources; the Control Tower baseline
 *    calls `config:StopConfigurationRecorder`, `DeleteConfigurationRecorder` and
 *    `DeleteDeliveryChannel` from inside each governed account (including Audit and Log Archive)
 *    as this execution role.
 *
 * `ScpEscSec001ProtectGuardDuty` and `ScpEscSec001ProtectSecurityHub` are DELIBERATELY UNCHANGED
 * per the compatibility instruction's rule against weakening unrelated controls; Control Tower does
 * not require destructive lifecycle on those services during initialization.
 */
export const scpEscSec001: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-SEC-001',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Protect CloudTrail, Config, GuardDuty and Security Hub from deletion or disablement.',
  catalogueSection: '3.5',
  priority: 'CRITICAL',
  targetKeys: [ROOT_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscSec001ProtectCloudTrail',
        Effect: 'Deny',
        Action: ['cloudtrail:StopLogging', 'cloudtrail:DeleteTrail', 'cloudtrail:UpdateTrail'],
        Resource: '*',
        Condition: exemptPrincipals(context.exemptions.controlTowerServiceLinkedRoles)
      }),
      statement({
        Sid: 'ScpEscSec001ProtectConfigRecorder',
        Effect: 'Deny',
        Action: [
          'config:StopConfigurationRecorder',
          'config:DeleteConfigurationRecorder',
          'config:DeleteDeliveryChannel'
        ],
        Resource: '*',
        Condition: exemptPrincipals(context.exemptions.controlTowerExecutionRoles)
      }),
      statement({
        Sid: 'ScpEscSec001ProtectGuardDuty',
        Effect: 'Deny',
        Action: [
          'guardduty:DeleteDetector',
          'guardduty:DisassociateFromMasterAccount',
          'guardduty:DisassociateMembers'
        ],
        Resource: '*'
      }),
      statement({
        Sid: 'ScpEscSec001ProtectSecurityHub',
        Effect: 'Deny',
        Action: [
          'securityhub:DisableSecurityHub',
          'securityhub:DeleteMembers',
          'securityhub:DisassociateFromMasterAccount',
          'securityhub:DisassociateMembers'
        ],
        Resource: '*'
      })
    ])
};

/**
 * SCP-ESC-SEC-002 - Protect Log Archive WORM Immutability [HIGH], catalogue section 3.6.
 *
 * Actions are derived from "prevents deletion of any object, object version, or the Object Lock
 * configuration itself" plus the immutability requirement that audit logs cannot be modified or
 * deleted by anyone including administrators.
 *
 * DERIVATION GAP (resource scope): the catalogue names "Log Archive buckets" but supplies no bucket
 * name, ARN, or naming convention, and the Control Tower Log Archive bucket has not been created
 * yet. The statement therefore uses `Resource: "*"`, scoped in practice by attachment to the
 * Security OU. A resource-scoping refinement is deferred to a follow-up compatibility change under
 * `.apm/instructions/control-tower-scp-compatibility.instructions.md` §7.3 once Control Tower has
 * created the `aws-controltower-logs-<log-archive-account-id>-<home-region>` bucket and its ARN is
 * observable. No bucket ARN or naming convention is invented here.
 *
 * CONTROL TOWER COMPATIBILITY (§7.3, principal-scoped): AWS Control Tower Landing Zone 4.0
 * rewrites the Log Archive bucket policy under `AWSControlTowerExecution` in the Log Archive
 * account during landing-zone setup and each landing-zone update, which triggers
 * `s3:DeleteBucketPolicy`. The remaining actions in the deny list (Object Lock configuration,
 * object retention, object legal hold, bypass governance retention, delete object / object
 * version, delete bucket) are not part of the LZ 4.0 baseline, but the principal exemption covers
 * the full statement so that a future minor LZ change does not silently re-break setup. Every
 * non-`AWSControlTowerExecution` principal remains denied on every S3 bucket in every Security-OU
 * account.
 */
export const scpEscSec002: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-SEC-002',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Protect S3 Object Lock (WORM) immutability on Log Archive buckets.',
  catalogueSection: '3.6',
  priority: 'HIGH',
  targetKeys: [SECURITY_OU_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscSec002ProtectObjectLockImmutability',
        Effect: 'Deny',
        Action: [
          's3:DeleteObject',
          's3:DeleteObjectVersion',
          's3:PutBucketObjectLockConfiguration',
          's3:PutObjectRetention',
          's3:PutObjectLegalHold',
          's3:BypassGovernanceRetention',
          's3:DeleteBucket',
          's3:DeleteBucketPolicy'
        ],
        Resource: '*',
        Condition: exemptPrincipals(context.exemptions.controlTowerExecutionRoles)
      })
    ])
};

/**
 * SCP-ESC-SEC-003 - Protect Config Aggregator [HIGH], catalogue section 3.7.
 *
 * The catalogue enumerates the three denied actions explicitly and states the single exemption
 * ("except for the CDK pipeline role").
 *
 * CONTROL TOWER COMPATIBILITY (`.apm/instructions/control-tower-scp-compatibility.instructions.md`
 * §7.4): AWS Control Tower Landing Zone 4.0 creates and manages the organization-wide Config
 * aggregator inside the Audit account under `AWSControlTowerExecution`. That principal is added
 * alongside the existing pipeline-role exemption; every other principal remains denied. The
 * `AWSControlTowerConfigAggregatorRoleForOrganizations` role is what AWS Config assumes to READ
 * aggregated data from source accounts - it does not call `PutConfigurationAggregator` and is
 * therefore intentionally NOT added.
 */
export const scpEscSec003: OrganizationsPolicyDefinition = {
  policyId: 'SCP-ESC-SEC-003',
  policyType: 'SERVICE_CONTROL_POLICY',
  description: 'Protect the AWS Config Aggregator from deletion or unauthorised modification.',
  catalogueSection: '3.7',
  priority: 'HIGH',
  targetKeys: [SECURITY_OU_TARGET_KEY],
  partialAgainstDesign: false,
  document: (context) =>
    policyDocument([
      statement({
        Sid: 'ScpEscSec003ProtectConfigAggregator',
        Effect: 'Deny',
        Action: [
          'config:DeleteConfigurationAggregator',
          'config:DeleteAggregationAuthorization',
          'config:PutConfigurationAggregator'
        ],
        Resource: '*',
        Condition: exemptPrincipals([
          ...context.exemptions.pipelineRoles,
          ...context.exemptions.controlTowerExecutionRoles
        ])
      })
    ])
};

export const securityPolicies: readonly OrganizationsPolicyDefinition[] = [scpEscSec001, scpEscSec002, scpEscSec003];
