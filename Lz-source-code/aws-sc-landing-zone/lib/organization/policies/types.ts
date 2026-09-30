/**
 * Shared vocabulary for the approved AWS Organizations policy catalogue.
 *
 * IMPORTANT - provenance of every policy document in this directory:
 *
 * `ESC_SCP_Design_Catalogue_v2` is a DESIGN catalogue. It documents control intent, policy IDs,
 * target placement, priorities, framework alignment, and selected actions/conditions/exemptions.
 * It does NOT contain implementation-ready policy JSON for any of its 22 policies.
 *
 * Every document produced by the modules in this directory is therefore DERIVED from the
 * catalogue's documented design intent: the minimum AWS Organizations policy structure needed to
 * implement the documented control, and nothing more. No statement broadens or weakens a documented
 * control, and no undocumented control is added. Where the catalogue documents a control that has
 * no expressible AWS IAM condition key - or names a condition whose key the catalogue does not
 * identify - that statement is WITHHELD and marked with a `DERIVATION GAP` comment rather than
 * guessed at, per CLAUDE.md section 5 and scp-phase.md section 12.
 *
 * Framework mappings recorded here (BSI C5, GDPR, NIS2, ISO 27001, EUCS, NIST SP 800-53) are
 * control-alignment references only. Nothing here asserts certification or formal compliance.
 */

/** AWS European Sovereign Cloud partition. Never `aws`. */
export const ESC_PARTITION = 'aws-eusc';

/** The only approved AWS ESC Region. */
export const ESC_REGION = 'eusc-de-east-1';

/**
 * ARN prefix for an IAM role exemption principal. The account segment is deliberately a wildcard:
 * exemptions are expressed by role name/path so that no AWS account ID ever enters source control.
 */
export const ESC_IAM_ROLE_ARN_PREFIX = `arn:${ESC_PARTITION}:iam::*:role/`;

/** ARN of the account root user, as documented verbatim in catalogue section 3.2. */
export const ESC_ROOT_USER_ARN = `arn:${ESC_PARTITION}:iam::*:root`;

/** IAM/SCP/RCP policy language version. */
export const POLICY_DOCUMENT_VERSION = '2012-10-17';

/** Target key that resolves to the existing Organizations Root rather than a generated OU. */
export const ROOT_TARGET_KEY = 'root';

export type PolicyEffect = 'Allow' | 'Deny';

export type PolicyType = 'SERVICE_CONTROL_POLICY' | 'RESOURCE_CONTROL_POLICY';

export type PolicyPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM';

export type PolicyConditionValue = string | readonly string[];

export type PolicyCondition = Readonly<Record<string, Readonly<Record<string, PolicyConditionValue>>>>;

export interface PolicyStatement {
  /** Deterministic statement ID derived from the catalogue policy ID and the control it implements. */
  readonly Sid: string;
  readonly Effect: PolicyEffect;
  /** Present on Resource Control Policies only - RCPs are resource-based and require a Principal. */
  readonly Principal?: '*';
  readonly Action?: PolicyConditionValue;
  readonly NotAction?: PolicyConditionValue;
  readonly Resource: PolicyConditionValue;
  readonly Condition?: PolicyCondition;
}

export interface PolicyDocument {
  readonly Version: typeof POLICY_DOCUMENT_VERSION;
  readonly Statement: readonly PolicyStatement[];
}

/** Role names or role paths (relative to `role/`) used to build exemption principal ARNs. */
export interface PolicyExemptionRoles {
  readonly pipelineRoles: readonly string[];
  /**
   * CDK asset-publishing roles. Applied ONLY where a guardrail would otherwise deny CDK asset
   * publication - currently the SCP-ESC-WL-001 S3 `PutObject` statements. Deliberately kept separate
   * from `pipelineRoles` so an asset-upload identity is not exempted from unrelated guardrails.
   */
  readonly assetPublishingRoles: readonly string[];
  readonly breakGlassRoles: readonly string[];
  readonly finOpsRoles: readonly string[];
  readonly kmsAdministratorRoles: readonly string[];
  readonly networkAdministratorRoles: readonly string[];
  readonly identityCenterServiceRoles: readonly string[];
  readonly organizationsServiceRoles: readonly string[];
  /**
   * AWS Control Tower service-linked role principals (`AWSServiceRoleForAWSControlTower`). Used by
   * SCP-ESC-ROOT-003 for Organizations policy lifecycle and by the CloudTrail sub-statement of
   * SCP-ESC-SEC-001 for the optional Control Tower-managed org-trail lifecycle. Applied per
   * statement, not broadcast to unrelated policies.
   */
  readonly controlTowerServiceLinkedRoles: readonly string[];
  /**
   * AWS Control Tower member-account execution role principals (`AWSControlTowerExecution`). Used
   * by the Config-recorder sub-statement of SCP-ESC-SEC-001, by SCP-ESC-SEC-002 for Log Archive
   * bucket-policy lifecycle, and by SCP-ESC-SEC-003 for the Audit-account Config aggregator
   * lifecycle. Applied per statement, not broadcast to unrelated policies.
   */
  readonly controlTowerExecutionRoles: readonly string[];
}

/**
 * Extension point for SCP-ESC-ROOT-004. While `services` is empty the approved-service-boundary
 * statement is omitted and ROOT-004 enforces only its documented customer-directed denials. Adding
 * service prefixes here activates the boundary statement inside the SAME SCP - no new SCP is needed.
 */
export interface ApprovedServiceBoundary {
  readonly services: readonly string[];
}

/** Everything a policy document factory may need that is not known until synthesis time. */
export interface PolicyContext {
  /**
   * Organization ID token from the `OrganizationId` CloudFormation parameter. Resolved at deployment
   * time; never a literal in source control.
   */
  readonly organizationId: string;
  readonly exemptions: PolicyExemptionRoles;
  readonly approvedServiceBoundary: ApprovedServiceBoundary;
}

export interface OrganizationsPolicyDefinition {
  /** Catalogue policy ID, used verbatim as the AWS Organizations policy name. */
  readonly policyId: string;
  readonly policyType: PolicyType;
  /** Control summary, taken from the catalogue inventory (section 2.3). */
  readonly description: string;
  /** Catalogue section that defines this policy, for traceability during review. */
  readonly catalogueSection: string;
  readonly priority: PolicyPriority;
  /**
   * Approved attachment targets: `root`, or configuration keys of existing OU resources. Resolved by
   * the stack against the OU stack's generated resources - never a literal OU ID.
   */
  readonly targetKeys: readonly string[];
  /**
   * `true` when the policy implements only part of its documented design intent because the
   * remainder is not safely derivable from the catalogue. Every such policy carries `DERIVATION GAP`
   * comments identifying exactly what was withheld.
   */
  readonly partialAgainstDesign: boolean;
  readonly document: (context: PolicyContext) => PolicyDocument;
}

/** Builds fully qualified AWS ESC IAM role ARNs for exemption conditions. */
export function escRoleArns(roles: readonly string[]): string[] {
  return roles.map((role) => `${ESC_IAM_ROLE_ARN_PREFIX}${role}`);
}

/**
 * Builds the `StringNotLike aws:PrincipalArn` condition used by every documented role exemption.
 *
 * Returns `undefined` when no exemption principal is configured, so the caller omits the condition
 * entirely rather than emitting an empty value list. Omitting an exemption makes a policy stricter
 * than the approved design, so callers that depend on a documented exemption must keep at least one
 * role configured.
 */
export function exemptPrincipals(roles: readonly string[]): PolicyCondition | undefined {
  const arns = escRoleArns(roles);
  return arns.length === 0 ? undefined : { StringNotLike: { 'aws:PrincipalArn': arns } };
}

/** Merges condition blocks, skipping `undefined` ones. Operators must not overlap between inputs. */
export function mergeConditions(...conditions: readonly (PolicyCondition | undefined)[]): PolicyCondition | undefined {
  const merged: Record<string, Record<string, PolicyConditionValue>> = {};

  for (const condition of conditions) {
    if (condition === undefined) {
      continue;
    }

    for (const [operator, entries] of Object.entries(condition)) {
      const existing = merged[operator];
      merged[operator] = existing === undefined ? { ...entries } : { ...existing, ...entries };
    }
  }

  return Object.keys(merged).length === 0 ? undefined : merged;
}

/**
 * Assembles a statement, dropping the `Condition` key entirely when there is no condition so that
 * the serialized policy never carries an empty condition block.
 */
export function statement(input: PolicyStatement): PolicyStatement {
  const result: Record<string, unknown> = {
    Sid: input.Sid,
    Effect: input.Effect
  };

  if (input.Principal !== undefined) {
    result.Principal = input.Principal;
  }
  if (input.Action !== undefined) {
    result.Action = input.Action;
  }
  if (input.NotAction !== undefined) {
    result.NotAction = input.NotAction;
  }
  result.Resource = input.Resource;
  if (input.Condition !== undefined) {
    result.Condition = input.Condition;
  }

  return result as unknown as PolicyStatement;
}

/** Wraps statements into a policy document. */
export function policyDocument(statements: readonly PolicyStatement[]): PolicyDocument {
  return { Version: POLICY_DOCUMENT_VERSION, Statement: statements };
}

/**
 * Converts a catalogue policy ID into a deterministic PascalCase construct ID.
 * `SCP-ESC-ROOT-001` -> `ScpEscRoot001`.
 */
export function policyConstructId(policyId: string): string {
  return policyId
    .split('-')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join('');
}
