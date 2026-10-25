/**
 * The approved AWS Organizations policy catalogue, assembled for the organization policy stack.
 *
 * Derived from `ESC_SCP_Design_Catalogue_v2`, which documents 22 policies: 20 Service Control
 * Policies and 2 Resource Control Policies.
 *
 * Implemented here: 19 SCPs and 2 RCPs. SCP-ESC-NET-001 is withheld - see `withheldPolicies`.
 */

import { encryptionPolicies } from './encryption-policies.js';
import { identityPolicies } from './identity-policies.js';
import { resourceControlPolicies } from './resource-control-policies.js';
import { rootPolicies } from './root-policies.js';
import { securityPolicies } from './security-policies.js';
import { workloadPolicies } from './workload-policies.js';
import { type OrganizationsPolicyDefinition } from './types.js';

/** Number of SCPs in the catalogue inventory (section 2.3). */
export const CATALOGUE_SERVICE_CONTROL_POLICY_COUNT = 20;

/** Number of RCPs in the catalogue inventory (section 2.3). */
export const CATALOGUE_RESOURCE_CONTROL_POLICY_COUNT = 2;

export interface WithheldPolicy {
  readonly policyId: string;
  readonly catalogueSection: string;
  readonly status: string;
  readonly reason: string;
  /** Controls that deliver this requirement outside the SCP layer. */
  readonly alternativeControls: readonly string[];
}

/**
 * Policies present in the approved catalogue that this stack does NOT synthesize, and why.
 *
 * A withheld policy is not a silently dropped control. It is a control whose documented enforcement
 * cannot be expressed as an AWS Organizations policy, so it is delivered by a named alternative
 * control instead. Emitting a guessed condition key would synthesize a statement that silently never
 * matches, which is strictly worse than a recorded gap. Per CLAUDE.md section 5 and scp-phase.md
 * section 12, the affected policy stops and is reported.
 */
export const withheldPolicies: readonly WithheldPolicy[] = [
  {
    policyId: 'SCP-ESC-NET-001',
    catalogueSection: '6.3',
    status: 'NOT EXPRESSIBLE / NOT CURRENTLY SCP-ENFORCED',
    reason:
      'Withheld by design, not for want of information. Neither documented sub-control is expressible as an SCP: ' +
      '(1) "requires a WAF Web ACL association tag on all internet-facing ALBs" names neither the tag key nor its ' +
      'expected value in any approved design document, and there is no condition key for Web ACL association; ' +
      '(2) the public-RDS denial is documented as rds:PubliclyAccessible=true, but AWS RDS publishes no such ' +
      'request-level IAM condition key, so the statement would synthesize and never match. Reconciled against the ' +
      'approved Security Baseline, which section 2.1 records that Shield Advanced and Firewall Manager - the ' +
      'centralized WAF enforcement services - are NOT available in ESC and that the baseline "relies on ... ' +
      'per-account WAF configuration instead", and whose section 6 control matrix explicitly classifies the ' +
      'equivalent public-access controls (S3 Block Public Access, no public security-group rules beyond 443) as ' +
      '"Not currently SCP-enforced - baseline checklist item only". The approved Centralized Logging design ' +
      'section 3.1.1 likewise treats AWS WAF and ALB access logs as service-specific rather than baseline ' +
      'controls. No speculative SCP is created.',
    alternativeControls: [
      'AWS Config rule wafv2-associated-with-alb, where the managed rule is available in eusc-de-east-1',
      'AWS Config rule rds-instance-public-access-check, where the managed rule is available in eusc-de-east-1',
      'Custom AWS Config rules where managed rules are unavailable in AWS ESC (Security Baseline section 2.1)',
      'CDK Application Load Balancer construct requiring a WAF Web ACL association at synthesis time'
    ]
  }
];

/** Every policy this stack synthesizes, in catalogue order. */
export const approvedPolicies: readonly OrganizationsPolicyDefinition[] = [
  ...rootPolicies,
  ...securityPolicies,
  ...encryptionPolicies,
  ...identityPolicies,
  ...workloadPolicies,
  ...resourceControlPolicies
];

export const approvedServiceControlPolicies: readonly OrganizationsPolicyDefinition[] = approvedPolicies.filter(
  (policy) => policy.policyType === 'SERVICE_CONTROL_POLICY'
);

export const approvedResourceControlPolicies: readonly OrganizationsPolicyDefinition[] = approvedPolicies.filter(
  (policy) => policy.policyType === 'RESOURCE_CONTROL_POLICY'
);

/**
 * Governance input required to resolve the ACTIVE policy set for a deployment.
 *
 * Kept minimal on purpose so both the CDK stack and the offline template validator can call
 * `resolveActivePolicies` without needing the full `GovernanceConfig` shape. `disabledPolicies` is
 * the deployment hold list (currently used only for SCP-ESC-WL-004, pending tag-standard
 * reconciliation); every entry must match an approved catalogue policy ID.
 */
export interface PolicyEnforcementInput {
  readonly disabledPolicies: readonly string[];
}

/**
 * Returns the policies that will actually synthesize into the organization policy stack, after
 * applying the deployment hold list. Throws if `disabledPolicies` names a policy that is not in the
 * approved catalogue - a typo there would silently synthesize a policy the operator intended to
 * hold, which is the exact failure mode this filter exists to prevent.
 */
export function resolveActivePolicies(enforcement: PolicyEnforcementInput): readonly OrganizationsPolicyDefinition[] {
  const approvedIds = new Set(approvedPolicies.map((policy) => policy.policyId));
  const unknown = enforcement.disabledPolicies.filter((id) => !approvedIds.has(id));
  if (unknown.length > 0) {
    throw new Error(
      `governance.disabledPolicies references unknown catalogue policies: ${unknown.join(', ')}. ` +
        'Every entry must match an approved catalogue policy ID.'
    );
  }

  const disabled = new Set(enforcement.disabledPolicies);
  return approvedPolicies.filter((policy) => !disabled.has(policy.policyId));
}

export * from './types.js';
export {
  encryptionPolicies,
  identityPolicies,
  resourceControlPolicies,
  rootPolicies,
  securityPolicies,
  workloadPolicies
};
