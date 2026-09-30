import { z } from 'zod';

/** IAM role name, or role path relative to `role/`. Wildcards are permitted; ARNs are not. */
const ROLE_REFERENCE_PATTERN = /^[A-Za-z0-9+=,.@_*-]+(?:\/[A-Za-z0-9+=,.@_*-]+)*$/;
const SERVICE_PREFIX_PATTERN = /^[a-z0-9-]+$/;
const MAX_EXEMPTION_ROLES = 32;
/** Catalogue policy IDs are `SCP-ESC-*` or `RCP-ESC-*` (upper case, digits, hyphens). */
const POLICY_ID_PATTERN = /^(SCP|RCP)-ESC-[A-Z0-9-]+$/;
const MAX_DISABLED_POLICIES = 32;

/**
 * Governance metadata consumed by the AWS Organizations policy catalogue.
 *
 * The approved SCP design catalogue documents policy EXEMPTIONS in prose ("the CDK pipeline role",
 * "the AdministratorRole (break-glass)", "the approved FinOps role") without ever supplying a role
 * name or ARN. Those names are therefore configuration rather than literals in policy code: they are
 * reviewable, environment-overridable, and can be corrected through a normal GitOps change without
 * touching a single policy document.
 *
 * Entries are IAM role NAMES or role PATHS relative to `role/` - never full ARNs and never account
 * IDs. The policy layer expands each entry to `arn:aws-eusc:iam::*:role/<entry>`, keeping the account
 * segment a wildcard so no AWS account identifier enters source control.
 */
const roleReferenceSchema = z
  .string()
  .min(1, 'must not be empty')
  .max(256)
  .regex(ROLE_REFERENCE_PATTERN, 'must be an IAM role name or role path (optionally containing * wildcards)');

const roleReferenceListSchema = z.array(roleReferenceSchema).max(MAX_EXEMPTION_ROLES);

const policyExemptionsSchema = z
  .object({
    /** Deployment principals that must keep working once the guardrails are enforced. */
    pipelineRoles: roleReferenceListSchema.min(1, 'at least one pipeline role exemption is required'),
    /**
     * CDK asset-publishing roles, applied only where a guardrail would otherwise deny CDK asset
     * publication (SCP-ESC-WL-001 S3 PutObject). Kept separate from `pipelineRoles` on purpose.
     */
    assetPublishingRoles: roleReferenceListSchema,
    /** Break-glass administrator role (SCP-ESC-IAM-001, SCP-ESC-PROD-001). */
    breakGlassRoles: roleReferenceListSchema,
    /** Approved FinOps role permitted to purchase reservations (SCP-ESC-SBX-001). */
    finOpsRoles: roleReferenceListSchema,
    /** KMS administrator roles exempt from the MFA condition (SCP-ESC-WL-001, SCP-ESC-ENC-001). */
    kmsAdministratorRoles: roleReferenceListSchema,
    /** Network administration roles (SCP-ESC-INF-001). */
    networkAdministratorRoles: roleReferenceListSchema,
    /** IAM Identity Center service-linked role (SCP-ESC-WL-003). */
    identityCenterServiceRoles: roleReferenceListSchema,
    /** AWS Organizations service-linked role (SCP-ESC-ROOT-001). */
    organizationsServiceRoles: roleReferenceListSchema,
    /**
     * AWS Control Tower service-linked role in the management account
     * (`AWSServiceRoleForAWSControlTower`). Threaded into SCP-ESC-ROOT-003 (Organizations policy
     * lifecycle) and SCP-ESC-SEC-001 `ScpEscSec001ProtectCloudTrail` (org-trail lifecycle) per the
     * approved Control Tower compatibility instruction.
     */
    controlTowerServiceLinkedRoles: roleReferenceListSchema,
    /**
     * AWS Control Tower member-account execution role (`AWSControlTowerExecution`). Threaded into
     * SCP-ESC-SEC-001 `ScpEscSec001ProtectConfigRecorder`, SCP-ESC-SEC-002 and SCP-ESC-SEC-003 per
     * the approved Control Tower compatibility instruction.
     */
    controlTowerExecutionRoles: roleReferenceListSchema
  })
  .strict();

/**
 * Extension point for SCP-ESC-ROOT-004. The approved ESC service catalogue is not contained in the
 * design document, so this list is empty and the approved-service-boundary statement is omitted.
 * Populating it activates that statement inside the EXISTING ROOT-004 policy - no new SCP required.
 */
const approvedServiceBoundarySchema = z
  .object({
    services: z.array(z.string().regex(SERVICE_PREFIX_PATTERN, 'must be a lowercase AWS service prefix')).max(256)
  })
  .strict();

/**
 * Deployment hold list.
 *
 * Every entry must match an existing approved catalogue policy ID (`SCP-ESC-*` / `RCP-ESC-*`).
 * A disabled policy is NOT synthesized into the organization policy stack and is NOT attached at
 * deploy time, but its CDK code stays intact so the design is preserved and can be re-enabled by
 * removing its entry here. Held policies are those whose deployment is deliberately gated on an
 * external precondition; the list is currently empty.
 */
const disabledPoliciesSchema = z
  .array(z.string().regex(POLICY_ID_PATTERN, 'must be a catalogue policy ID (SCP-ESC-* or RCP-ESC-*)'))
  .max(MAX_DISABLED_POLICIES);

export const governanceSchema = z
  .object({
    policyExemptions: policyExemptionsSchema,
    approvedServiceBoundary: approvedServiceBoundarySchema,
    disabledPolicies: disabledPoliciesSchema
  })
  .strict();

export type GovernanceConfig = z.infer<typeof governanceSchema>;
