/**
 * Reusable construct wrapping a single AWS Organizations organizational unit.
 *
 * `AWS::Organizations::OrganizationalUnit` has no L2 construct in `aws-cdk-lib`, so this construct
 * wraps the L1 `CfnOrganizationalUnit` and adds the guard rails the Landing Zone depends on:
 *
 *  - display-name validation before synthesis;
 *  - a stable child resource ID (`Resource`), so logical IDs are deterministic for a given key;
 *  - typed accessors for the generated OU ID/ARN so children can reference their parent's
 *    generated resource rather than a hard-coded OU ID.
 *
 * The construct never creates the Organizations Root, an account, or a policy.
 */

import { aws_organizations as organizations } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface OrganizationalUnitProps {
  /** AWS Organizations display name. Must be unique among siblings. */
  readonly organizationalUnitName: string;

  /**
   * ID of the parent container: either the externally supplied Organizations Root ID or the
   * generated ID of a parent OU resource in the same stack.
   */
  readonly parentId: string;
}

export class OrganizationalUnit extends Construct {
  /** Display name as configured. */
  public readonly organizationalUnitName: string;

  /** Generated OU ID (`Fn::GetAtt <logicalId>.Id`). Never hard-coded. */
  public readonly organizationalUnitId: string;

  /** Generated OU ARN (`Fn::GetAtt <logicalId>.Arn`). */
  public readonly organizationalUnitArn: string;

  private readonly resource: organizations.CfnOrganizationalUnit;

  constructor(scope: Construct, id: string, props: OrganizationalUnitProps) {
    super(scope, id);

    this.resource = new organizations.CfnOrganizationalUnit(this, 'Resource', {
      name: props.organizationalUnitName,
      parentId: props.parentId
    });

    this.organizationalUnitName = props.organizationalUnitName;
    this.organizationalUnitId = this.resource.attrId;
    this.organizationalUnitArn = this.resource.attrArn;
  }

  /** Escape hatch to the underlying L1 resource, mainly for assertions and future overrides. */
  public get cfnOrganizationalUnit(): organizations.CfnOrganizationalUnit {
    return this.resource;
  }
}
