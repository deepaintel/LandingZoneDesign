/**
 * Organization Policy stack - AWS Organizations Service Control Policies and Resource Control
 * Policies for the AWS ESC Landing Zone, with their approved Root / OU attachment wiring.
 *
 * This stack creates policies and attachments only. It creates no OU, no account, no StackSet, no
 * IAM, no KMS, no logging, no tagging and no networking resource. The 14-OU hierarchy is owned
 * exclusively by `OuStructureStack` and is neither recreated nor modified here.
 *
 * Stack isolation: this stack does not reference any construct in `OuStructureStack` and carries no
 * CloudFormation Export / Fn::ImportValue link to it. Every OU-scoped target ID arrives through a
 * pattern-constrained CloudFormation parameter at deployment time, resolved by the workflow from the
 * corresponding `OuId*` output of the already-deployed `lz-ou-structure` stack. Either stack can be
 * updated, replaced or torn down independently; ordering is preserved by the deployment workflow, not
 * by a CloudFormation dependency graph.
 *
 * Target resolution:
 *
 *  - Root targets resolve through the `OrganizationRootId` CloudFormation parameter, exactly as in
 *    the OU stack. The parameter is declared per stack because CloudFormation parameters are
 *    stack-scoped; both stacks share the same name, pattern and deployment-time source (the
 *    `organization-root-id` output of the `prepare-organization` composite action), so the deployment
 *    interface is unchanged.
 *  - OU targets resolve through `OuId<PascalCase(key)>` CloudFormation parameters, one per OU declared
 *    in the shared organization configuration. Their values are supplied at deployment time from the
 *    OU stack's matching outputs, so no generated OU ID is ever hard-coded and no cross-stack
 *    CloudFormation reference is created.
 *  - Account targets are rejected outright by the policy constructs. Account-level attachment is
 *    deferred until account creation is complete.
 *
 * The `OrganizationId` parameter is new in this stack and is required by the Resource Control Policy
 * data perimeter (`aws:PrincipalOrgID`). The `prepare-organization` composite action already emits
 * `organization-id`; wiring that output into the deploy command is part of the later deployment
 * increment, since deployment workflows are unchanged here.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { type OrganizationConfig } from '../../config/schemas/organization-schema.js';
import { type GovernanceConfig } from '../../config/schemas/scp-schema.js';
import { type OrganizationsPolicy } from '../constructs/organizations-policy.js';
import { ResourceControlPolicy } from '../constructs/resource-control-policy.js';
import { ServiceControlPolicy } from '../constructs/service-control-policy.js';
import { organizationalUnitConstructId } from './ou-structure-stack.js';
import { resolveActivePolicies } from './policies/index.js';
import {
  policyConstructId,
  ROOT_TARGET_KEY,
  type OrganizationsPolicyDefinition,
  type PolicyContext
} from './policies/types.js';

const ORGANIZATION_ID_PARAMETER_NAME = 'OrganizationId';
const ORGANIZATION_ID_PATTERN = /^o-[0-9a-z]{10,32}$/;
const ORGANIZATION_ROOT_ID_PARAMETER_NAME = 'OrganizationRootId';
const ORGANIZATION_ROOT_ID_PATTERN = /^r-[0-9a-z]{4,32}$/;
const OU_ID_PARAMETER_PREFIX = 'OuId';
const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const POLICY_ID_OUTPUT_PREFIX = 'PolicyId';
const SCP_COUNT_OUTPUT_NAME = 'ServiceControlPolicyCount';
const RCP_COUNT_OUTPUT_NAME = 'ResourceControlPolicyCount';

/** AWS Organizations limits on policies DIRECTLY attached to any single node. */
const MAX_SERVICE_CONTROL_POLICIES_PER_NODE = 10;
const MAX_RESOURCE_CONTROL_POLICIES_PER_NODE = 5;

export interface OrganizationPolicyStackProps extends cdk.StackProps {
  /**
   * Shared organization configuration. Only the OU keys are consumed here, and only to declare one
   * `OuId<PascalCase(key)>` CloudFormation parameter per OU. No construct or token from the OU stack
   * enters this stack, so no cross-stack CloudFormation Export / ImportValue link is created.
   */
  readonly organizationConfig: OrganizationConfig;

  /** Validated governance configuration: exemption principals and the ROOT-004 extension point. */
  readonly governanceConfig: GovernanceConfig;
}

/** Builds the CloudFormation parameter name for a given OU key (e.g. `workloads-hybrid-prod` -> `OuIdWorkloadsHybridProd`). */
export function ouIdParameterName(key: string): string {
  return `${OU_ID_PARAMETER_PREFIX}${organizationalUnitConstructId(key)}`;
}

export class OrganizationPolicyStack extends cdk.Stack {
  /** CloudFormation parameter carrying the existing Organizations Root ID. */
  public readonly organizationRootIdParameter: cdk.CfnParameter;

  /** CloudFormation parameter carrying the existing Organization ID, used by the RCP data perimeter. */
  public readonly organizationIdParameter: cdk.CfnParameter;

  /** CloudFormation parameters carrying existing OU IDs, keyed by configuration OU key. */
  public readonly ouIdParameters: ReadonlyMap<string, cdk.CfnParameter>;

  /** Created policies, addressed by catalogue policy ID. */
  public readonly policies: ReadonlyMap<string, OrganizationsPolicy>;

  /** Resolved attachment plan, for assertions and review. */
  public readonly attachments: ReadonlyMap<string, readonly string[]>;

  constructor(scope: Construct, id: string, props: OrganizationPolicyStackProps) {
    super(scope, id, props);

    this.organizationRootIdParameter = new cdk.CfnParameter(this, ORGANIZATION_ROOT_ID_PARAMETER_NAME, {
      type: 'String',
      description:
        'ID of the EXISTING AWS Organizations Root (for example r-a1b2). Supplied at deployment time from the ' +
        'prepare-organization composite action. The Root is never created by this stack.',
      allowedPattern: ORGANIZATION_ROOT_ID_PATTERN.source,
      constraintDescription: 'must be an existing AWS Organizations Root ID matching r-[0-9a-z]{4,32}'
    });
    // Pin the logical ID so the deployment interface (`--parameters OrganizationRootId=...`) is stable.
    this.organizationRootIdParameter.overrideLogicalId(ORGANIZATION_ROOT_ID_PARAMETER_NAME);

    this.organizationIdParameter = new cdk.CfnParameter(this, ORGANIZATION_ID_PARAMETER_NAME, {
      type: 'String',
      description:
        'ID of the EXISTING AWS Organization (o-<10-32 lowercase alphanumerics>). Supplied at deployment time ' +
        'from the prepare-organization composite action. Used by the Resource Control Policy data perimeter ' +
        'through aws:PrincipalOrgID. The Organization is never created by this stack.',
      allowedPattern: ORGANIZATION_ID_PATTERN.source,
      constraintDescription: 'must be an existing AWS Organization ID matching o-[0-9a-z]{10,32}'
    });
    this.organizationIdParameter.overrideLogicalId(ORGANIZATION_ID_PARAMETER_NAME);

    // One CloudFormation parameter per OU declared in the shared configuration. Values are supplied
    // at deployment time from the OU stack's matching CfnOutput values (`OuIdSecurity`,
    // `OuIdWorkloadsHybridProd`, ...) that the workflow reads through `describe-stacks`. This is what
    // keeps the two stacks isolated: no construct or token from `OuStructureStack` is referenced
    // here, so CDK does not synthesize a cross-stack Fn::Export / Fn::ImportValue pair.
    const ouIdParameters = new Map<string, cdk.CfnParameter>();
    for (const unit of props.organizationConfig.organizationalUnits) {
      const parameterName = ouIdParameterName(unit.key);
      const parameter = new cdk.CfnParameter(this, parameterName, {
        type: 'String',
        description:
          `ID of the EXISTING '${unit.key}' organizational unit. Supplied at deployment time from the ` +
          `${parameterName} output of the already-deployed lz-ou-structure stack. Kept as a parameter ` +
          'rather than a cross-stack ImportValue so either stack can be updated independently.',
        allowedPattern: OU_ID_PATTERN.source,
        constraintDescription: `must be an existing AWS Organizations OU ID matching ${OU_ID_PATTERN.source}`
      });
      parameter.overrideLogicalId(parameterName);
      ouIdParameters.set(unit.key, parameter);
    }
    this.ouIdParameters = ouIdParameters;

    const context: PolicyContext = {
      organizationId: this.organizationIdParameter.valueAsString,
      exemptions: props.governanceConfig.policyExemptions,
      approvedServiceBoundary: props.governanceConfig.approvedServiceBoundary
    };

    // Apply the deployment hold list. A disabled policy keeps its CDK definition but does not
    // synthesize into this stack, so it cannot be attached at deploy time either. Currently empty;
    // WL-004 was on the hold list until the tag-standard reconciliation was applied to its code.
    const activePolicies = resolveActivePolicies({ disabledPolicies: props.governanceConfig.disabledPolicies });

    const policies = new Map<string, OrganizationsPolicy>();
    const attachments = new Map<string, readonly string[]>();

    for (const definition of activePolicies) {
      if (policies.has(definition.policyId)) {
        throw new Error(`Duplicate policy ID '${definition.policyId}' in the approved catalogue.`);
      }

      const targetIds = definition.targetKeys.map((targetKey) => this.resolveTargetId(targetKey));

      const policy = this.createPolicy(definition, context, targetIds);

      policies.set(definition.policyId, policy);
      attachments.set(definition.policyId, definition.targetKeys);
    }

    this.policies = policies;
    this.attachments = attachments;

    assertNodeLimits(activePolicies);

    for (const definition of activePolicies) {
      const policy = policies.get(definition.policyId);
      if (policy === undefined) {
        throw new Error(`Policy '${definition.policyId}' was resolved but not created.`);
      }

      new cdk.CfnOutput(this, `${POLICY_ID_OUTPUT_PREFIX}${policyConstructId(definition.policyId)}`, {
        value: policy.policyId,
        description:
          `${definition.policyType} ${definition.policyId} (catalogue section ${definition.catalogueSection}, ` +
          `${definition.priority}) attached to: ${definition.targetKeys.join(', ')}`
      });
    }

    new cdk.CfnOutput(this, SCP_COUNT_OUTPUT_NAME, {
      value: String(countByType(activePolicies, 'SERVICE_CONTROL_POLICY')),
      description: 'Number of Service Control Policies managed by this stack.'
    });

    new cdk.CfnOutput(this, RCP_COUNT_OUTPUT_NAME, {
      value: String(countByType(activePolicies, 'RESOURCE_CONTROL_POLICY')),
      description: 'Number of Resource Control Policies managed by this stack.'
    });
  }

  private createPolicy(
    definition: OrganizationsPolicyDefinition,
    context: PolicyContext,
    targetIds: readonly string[]
  ): OrganizationsPolicy {
    const constructId = policyConstructId(definition.policyId);
    const props = {
      policyName: definition.policyId,
      description: definition.description,
      document: definition.document(context),
      targetIds
    };

    return definition.policyType === 'SERVICE_CONTROL_POLICY'
      ? new ServiceControlPolicy(this, constructId, props)
      : new ResourceControlPolicy(this, constructId, props);
  }

  /**
   * Resolves an approved target key to a CloudFormation reference. Unknown keys are rejected rather
   * than silently skipped, so a catalogue target that does not exist in the approved OU hierarchy
   * fails the build instead of quietly losing a guardrail.
   */
  private resolveTargetId(targetKey: string): string {
    if (targetKey === ROOT_TARGET_KEY) {
      return this.organizationRootIdParameter.valueAsString;
    }

    const parameter = this.ouIdParameters.get(targetKey);
    if (parameter === undefined) {
      const known = [ROOT_TARGET_KEY, ...this.ouIdParameters.keys()].join(', ');
      throw new Error(
        `Unknown policy attachment target '${targetKey}'. Targets must be '${ROOT_TARGET_KEY}' or an ` +
          `existing organizational unit key. Known targets: ${known}.`
      );
    }

    return parameter.valueAsString;
  }
}

function countByType(definitions: readonly OrganizationsPolicyDefinition[], policyType: string): number {
  return definitions.filter((definition) => definition.policyType === policyType).length;
}

/**
 * Fails synthesis if any single node exceeds its AWS Organizations directly-attached policy cap. The
 * cap applies per node and does not count policies inherited from parent OUs (catalogue section 2.4).
 */
function assertNodeLimits(definitions: readonly OrganizationsPolicyDefinition[]): void {
  const counts = new Map<string, { scp: number; rcp: number }>();

  for (const definition of definitions) {
    for (const targetKey of definition.targetKeys) {
      const current = counts.get(targetKey) ?? { scp: 0, rcp: 0 };
      if (definition.policyType === 'SERVICE_CONTROL_POLICY') {
        current.scp += 1;
      } else {
        current.rcp += 1;
      }
      counts.set(targetKey, current);
    }
  }

  for (const [targetKey, count] of counts) {
    if (count.scp > MAX_SERVICE_CONTROL_POLICIES_PER_NODE) {
      throw new Error(
        `Node '${targetKey}' has ${count.scp} directly attached Service Control Policies, exceeding the ` +
          `AWS Organizations limit of ${MAX_SERVICE_CONTROL_POLICIES_PER_NODE}.`
      );
    }
    if (count.rcp > MAX_RESOURCE_CONTROL_POLICIES_PER_NODE) {
      throw new Error(
        `Node '${targetKey}' has ${count.rcp} directly attached Resource Control Policies, exceeding the ` +
          `AWS Organizations limit of ${MAX_RESOURCE_CONTROL_POLICIES_PER_NODE}.`
      );
    }
  }
}
