/**
 * OU Structure stack - the only functional stack in the current implementation increment.
 *
 * Creates exactly the configured AWS Organizations OU hierarchy and nothing else: no accounts, no
 * service control policies, no StackSets, no IAM, no KMS, no logging, no tagging, no networking.
 *
 * Root handling: the AWS Organizations Root already exists and is never created here. Its ID enters
 * the template through the `OrganizationRootId` CloudFormation parameter, which keeps the real Root
 * ID out of both source control and synthesized templates while still allowing CI to synthesize the
 * stack without any AWS access.
 *
 * Ordering: OUs are created strictly parent-before-child (L1, then L2, then L3, ...). Each child
 * passes its parent's generated `attrId` as `ParentId`, which produces an explicit CloudFormation
 * `Fn::GetAtt` dependency on the parent resource.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { type OrganizationConfig } from '../../config/schemas/organization-schema.js';
import { OrganizationalUnit } from '../constructs/organizational-unit.js';

const ROOT_PARENT_KEY = 'root';
const ROOT_DISPLAY_NAME = 'Root';
const ORGANIZATION_ROOT_ID_PARAMETER_NAME = 'OrganizationRootId';
const ORGANIZATION_ROOT_ID_PATTERN = /^r-[0-9a-z]{4,32}$/;
const OU_ID_OUTPUT_PREFIX = 'OuId';
const OU_COUNT_OUTPUT_NAME = 'OrganizationalUnitCount';

export interface ResolvedOrganizationalUnit {
  readonly key: string;
  readonly name: string;
  readonly parentKey: string | undefined;
  readonly level: number;
  readonly path: string;
  readonly description: string | undefined;
}

export interface OuStructureStackProps extends cdk.StackProps {
  /** Validated configuration for the target environment. */
  readonly organizationConfig: OrganizationConfig;
}

/**
 * Converts a configuration key into a deterministic PascalCase construct ID.
 * `workloads-hybrid-non-prod` -> `WorkloadsHybridNonProd`.
 */
export function organizationalUnitConstructId(key: string): string {
  return key
    .split('-')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
}

export class OuStructureStack extends cdk.Stack {
  /** CloudFormation parameter carrying the existing Organizations Root ID. */
  public readonly organizationRootIdParameter: cdk.CfnParameter;

  /** Created OUs, addressed by configuration key. */
  public readonly organizationalUnits: ReadonlyMap<string, OrganizationalUnit>;

  /** The resolved hierarchy this stack was built from, ordered parent-before-child. */
  public readonly hierarchy: readonly ResolvedOrganizationalUnit[];

  constructor(scope: Construct, id: string, props: OuStructureStackProps) {
    super(scope, id, props);

    const hierarchy = resolveOrganizationHierarchy(props.organizationConfig);

    this.organizationRootIdParameter = new cdk.CfnParameter(this, ORGANIZATION_ROOT_ID_PARAMETER_NAME, {
      type: 'String',
      description:
        'ID of the EXISTING AWS Organizations Root (for example r-a1b2). Supplied at deployment time from an ' +
        'approved GitHub Environment variable. The Root is never created by this stack.',
      allowedPattern: ORGANIZATION_ROOT_ID_PATTERN.source,
      constraintDescription: 'must be an existing AWS Organizations Root ID matching r-[0-9a-z]{4,32}'
    });
    // Pin the logical ID so the deployment interface (`--parameters OrganizationRootId=...`) is stable.
    this.organizationRootIdParameter.overrideLogicalId(ORGANIZATION_ROOT_ID_PARAMETER_NAME);

    const units = new Map<string, OrganizationalUnit>();

    for (const entry of hierarchy) {
      const parentId = this.resolveParentId(units, entry);

      const unit = new OrganizationalUnit(this, organizationalUnitConstructId(entry.key), {
        organizationalUnitName: entry.name,
        parentId
      });

      units.set(entry.key, unit);
    }

    this.organizationalUnits = units;
    this.hierarchy = hierarchy;

    for (const entry of hierarchy) {
      const unit = units.get(entry.key);
      if (unit === undefined) {
        throw new Error(`Organizational unit '${entry.key}' was resolved but not created.`);
      }

      new cdk.CfnOutput(this, `${OU_ID_OUTPUT_PREFIX}${organizationalUnitConstructId(entry.key)}`, {
        value: unit.organizationalUnitId,
        description: `L${entry.level} OU ${entry.path}${entry.description === undefined ? '' : ` - ${entry.description}`}`
      });
    }

    new cdk.CfnOutput(this, OU_COUNT_OUTPUT_NAME, {
      value: String(hierarchy.length),
      description: 'Number of organizational units managed by this stack.'
    });
  }

  /**
   * Returns the parent container ID for an OU: the Root parameter for L1, otherwise the generated ID
   * of the already-created parent OU resource.
   */
  private resolveParentId(created: ReadonlyMap<string, OrganizationalUnit>, entry: ResolvedOrganizationalUnit): string {
    if (entry.parentKey === undefined) {
      return this.organizationRootIdParameter.valueAsString;
    }

    const parent = created.get(entry.parentKey);
    if (parent === undefined) {
      throw new Error(
        `Parent organizational unit '${entry.parentKey}' for '${entry.key}' has not been created yet. ` +
          'The resolved hierarchy must be ordered parent-before-child.'
      );
    }

    return parent.organizationalUnitId;
  }
}

function resolveOrganizationHierarchy(organization: OrganizationConfig): ResolvedOrganizationalUnit[] {
  const unitsByKey = new Map(organization.organizationalUnits.map((unit) => [unit.key, unit]));
  const resolved: ResolvedOrganizationalUnit[] = [];

  for (const unit of organization.organizationalUnits) {
    const chain: string[] = [];
    const visited = new Set<string>();
    let currentKey: string | undefined = unit.key;

    while (currentKey !== undefined && currentKey !== ROOT_PARENT_KEY) {
      if (visited.has(currentKey)) {
        throw new Error(`Circular parent reference detected for organizational unit '${unit.key}'.`);
      }

      visited.add(currentKey);
      chain.push(currentKey);
      const current = unitsByKey.get(currentKey);
      if (current === undefined) {
        throw new Error(`Organizational unit '${unit.key}' references missing parent '${currentKey}'.`);
      }
      currentKey = current.parent;
    }

    const level = chain.length;
    const ancestors = [...chain].reverse();
    resolved.push({
      key: unit.key,
      name: unit.name,
      parentKey: unit.parent === ROOT_PARENT_KEY ? undefined : unit.parent,
      level,
      path: [ROOT_DISPLAY_NAME, ...ancestors.map((key) => unitsByKey.get(key)?.name ?? key)].join('/'),
      description: unit.description
    });
  }

  return resolved.sort((left, right) => left.level - right.level);
}
