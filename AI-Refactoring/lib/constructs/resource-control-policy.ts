/**
 * Reusable construct wrapping a single AWS Organizations Resource Control Policy.
 *
 * A thin wrapper around `organizations.CfnPolicy` with `type: RESOURCE_CONTROL_POLICY`. Attachment is
 * expressed through the native `targetIds` property.
 *
 * RCPs are a separate AWS Organizations policy type from SCPs and are never implemented as SCPs: they
 * are resource-based (statements carry an explicit `Principal`) and control access to a resource from
 * ANY source, including principals outside the organization. This construct exists specifically so
 * the distinction is explicit in code and independently testable.
 *
 * DEPLOYMENT PREREQUISITE (not this increment): unlike `SERVICE_CONTROL_POLICY`, the
 * `RESOURCE_CONTROL_POLICY` policy type is not enabled by default on an Organizations Root, and
 * CloudFormation has no resource that enables a policy type. Enabling it belongs in the
 * deployment-time `prepare-organization` composite action, not in CDK application code, per
 * CLAUDE.md section 8. Deployment of these RCPs will fail until that is in place.
 */

import { Construct } from 'constructs';

import { OrganizationsPolicy, type OrganizationsPolicyProps } from './organizations-policy.js';

export const RESOURCE_CONTROL_POLICY_TYPE = 'RESOURCE_CONTROL_POLICY';

export type ResourceControlPolicyProps = OrganizationsPolicyProps;

export class ResourceControlPolicy extends OrganizationsPolicy {
  constructor(scope: Construct, id: string, props: ResourceControlPolicyProps) {
    super(scope, id, RESOURCE_CONTROL_POLICY_TYPE, props);
  }
}
