/**
 * Shared base for the two AWS Organizations policy constructs.
 *
 * `AWS::Organizations::Policy` has no L2 construct in `aws-cdk-lib`, so this wraps the L1
 * `CfnPolicy` and adds the guard rails the Landing Zone depends on:
 *
 *  - pre-synthesis validation of the policy name, document and target list;
 *  - a stable child resource ID (`Resource`), so logical IDs are deterministic for a given policy ID;
 *  - rejection of AWS account IDs in `targetIds`, so an account-level attachment can never be
 *    introduced by accident while account-level attachment remains deferred;
 *  - token-safe serialization of the policy document.
 *
 * The construct performs no AWS discovery and no deployment logic. It never creates the Organizations
 * Root, an OU, or an account.
 */

import { aws_organizations as organizations } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { type PolicyDocument, type PolicyType } from '../organization/policies/types.js';

/** AWS Organizations rejects policy names longer than this. */
const MAX_POLICY_NAME_LENGTH = 128;

/**
 * AWS Organizations document size limits, per policy type. See
 * https://docs.aws.amazon.com/organizations/latest/userguide/orgs_reference_limits.html#min-max-values
 * ("Maximum size of a policy document"). SCP: 10,240 characters. RCP: 5,120 characters.
 */
const MAX_POLICY_DOCUMENT_SIZE: Readonly<Record<PolicyType, number>> = {
  SERVICE_CONTROL_POLICY: 10240,
  RESOURCE_CONTROL_POLICY: 5120
};

const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;

export interface OrganizationsPolicyProps {
  /** AWS Organizations policy name. The catalogue policy ID is used verbatim. */
  readonly policyName: string;

  /** Human-readable control summary from the approved catalogue. */
  readonly description: string;

  /** Approved policy document, derived from the catalogue's documented design intent. */
  readonly document: PolicyDocument;

  /**
   * Resolved attachment targets: the Organizations Root ID from the deployment-time parameter, or
   * generated OU IDs from existing OU resources. Never a literal OU ID and never an account ID.
   */
  readonly targetIds: readonly string[];
}

export abstract class OrganizationsPolicy extends Construct {
  /** AWS Organizations policy name as configured. */
  public readonly policyName: string;

  /** Generated policy ID (`Fn::GetAtt <logicalId>.Id`). */
  public readonly policyId: string;

  /** The policy type this construct emits. */
  public readonly policyType: PolicyType;

  private readonly resource: organizations.CfnPolicy;

  protected constructor(scope: Construct, id: string, policyType: PolicyType, props: OrganizationsPolicyProps) {
    super(scope, id);

    validatePolicyName(props.policyName);
    validateTargetIds(props.policyName, props.targetIds);
    validateDocument(props.policyName, policyType, props.document);

    // `content` is a CloudFormation Json-typed property, so `CfnPolicy` requires the policy DOCUMENT
    // OBJECT and rejects a pre-serialized JSON string. Passing the object also lets a deployment-time
    // parameter embedded in the document - the Organization ID used by the RCP data perimeter -
    // render as a nested `{ "Ref": "OrganizationId" }` intrinsic that CloudFormation resolves.
    this.resource = new organizations.CfnPolicy(this, 'Resource', {
      name: props.policyName,
      description: props.description,
      type: policyType,
      content: props.document,
      targetIds: [...props.targetIds]
    });

    this.policyName = props.policyName;
    this.policyType = policyType;
    this.policyId = this.resource.attrId;
  }

  /** Escape hatch to the underlying L1 resource, mainly for assertions and future overrides. */
  public get cfnPolicy(): organizations.CfnPolicy {
    return this.resource;
  }
}

function validatePolicyName(policyName: string): void {
  if (policyName.trim().length === 0) {
    throw new Error('An AWS Organizations policy name must not be empty.');
  }

  if (policyName.length > MAX_POLICY_NAME_LENGTH) {
    throw new Error(
      `Policy name '${policyName}' is ${policyName.length} characters, exceeding the AWS Organizations ` +
        `limit of ${MAX_POLICY_NAME_LENGTH}.`
    );
  }
}

function validateTargetIds(policyName: string, targetIds: readonly string[]): void {
  if (targetIds.length === 0) {
    throw new Error(
      `Policy '${policyName}' has no attachment target. Every approved policy must attach to the ` +
        'Organizations Root or at least one organizational unit.'
    );
  }

  for (const targetId of targetIds) {
    if (AWS_ACCOUNT_ID_PATTERN.test(targetId)) {
      throw new Error(
        `Policy '${policyName}' targets '${targetId}', which is an AWS account ID. Account-level ` +
          'attachment is deferred until account creation is complete and must not be synthesized.'
      );
    }
  }

  const duplicates = targetIds.filter((targetId, index) => targetIds.indexOf(targetId) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Policy '${policyName}' declares duplicate attachment targets.`);
  }
}

function validateDocument(policyName: string, policyType: PolicyType, document: PolicyDocument): void {
  if (document.Statement.length === 0) {
    throw new Error(`Policy '${policyName}' has no statements. An empty policy enforces nothing.`);
  }

  // AWS Organizations applies its limit to the SERIALIZED document, which CloudFormation produces at
  // deployment time from the object below. The size is therefore measured here against a direct
  // serialization. For a document that embeds the Organization ID parameter this is an approximation -
  // the token placeholder stands in for the resolved value - but it is accurate enough to catch a
  // policy growing past the limit while it is being written. SCPs and RCPs have different limits
  // (10,240 and 5,120 characters respectively), so the limit is looked up per policy type.
  const limit = MAX_POLICY_DOCUMENT_SIZE[policyType];
  const size = JSON.stringify(document).length;
  if (size > limit) {
    throw new Error(
      `Policy '${policyName}' serializes to approximately ${size} characters, exceeding the AWS ` +
        `Organizations ${policyType} limit of ${limit}.`
    );
  }
}
