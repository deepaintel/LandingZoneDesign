/**
 * Reusable construct wrapping a single AWS Organizations Service Control Policy.
 *
 * A thin wrapper around `organizations.CfnPolicy` with `type: SERVICE_CONTROL_POLICY`. Attachment is
 * expressed through the native `targetIds` property - no `AWS::Organizations::PolicyAttachment`
 * resource type, no Lambda custom resource, no SDK or CLI attachment, no manual post-deployment step.
 *
 * Kept deliberately distinct from `ResourceControlPolicy` so an RCP can never be synthesized as an SCP.
 */

import { Construct } from 'constructs';

import { OrganizationsPolicy, type OrganizationsPolicyProps } from './organizations-policy.js';

export const SERVICE_CONTROL_POLICY_TYPE = 'SERVICE_CONTROL_POLICY';

export type ServiceControlPolicyProps = OrganizationsPolicyProps;

export class ServiceControlPolicy extends OrganizationsPolicy {
  constructor(scope: Construct, id: string, props: ServiceControlPolicyProps) {
    super(scope, id, SERVICE_CONTROL_POLICY_TYPE, props);
  }
}
