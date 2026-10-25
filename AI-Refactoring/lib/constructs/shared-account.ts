/**
 * Reusable construct wrapping a single AWS Organizations account.
 *
 * `AWS::Organizations::Account` has no L2 construct in `aws-cdk-lib`, so this construct wraps the
 * L1 `CfnAccount` and adds the guard rails the account-provisioning phase depends on:
 *
 *  - `Retain` deletion policy AND update-replace policy on the underlying resource, so that a
 *    misconfigured redeploy, a stack-delete, or a property that CloudFormation classifies as
 *    replacement-only cannot close a real AWS account. CloudFormation orphans the resource from
 *    the stack instead. AWS account closure is a manual, out-of-band operation by design.
 *  - a stable child resource ID (`Resource`), so logical IDs are deterministic for a given key
 *    and repeated deployments do not create duplicate accounts (see account-provisioning rules in
 *    `.apm/skills/generate-account/SKILL.md`);
 *  - typed accessors for the generated `AccountId` / `Arn` / `JoinedTimestamp` attributes so
 *    downstream code references generated values rather than hard-coded IDs.
 *
 * The construct performs no validation - all validation is centralised in the Zod schema at
 * `config/schemas/organization-schema.ts`, matching the OU construct pattern. The construct
 * never creates the Organizations Root, an OU, an alternate account contact, or a policy.
 */

import { aws_organizations as organizations, CfnDeletionPolicy, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface SharedAccountProps {
  /** AWS account display name (1-50 characters). Must be unique among sibling accounts. */
  readonly accountName: string;

  /**
   * Unique AWS account email address. AWS Organizations rejects `CreateAccount` requests whose
   * email address already exists in the Organization.
   */
  readonly email: string;

  /**
   * ID of the parent container: the generated ID of an existing OU. Passed as a
   * CloudFormation `Ref` on a pattern-constrained parameter to keep the accounts stack isolated
   * from the OU stack (no cross-stack `Fn::ImportValue` / `Fn::Export`).
   */
  readonly parentId: string;
}

export class SharedAccount extends Construct {
  /** Display name as configured. */
  public readonly accountName: string;

  /** Registered account email as configured. */
  public readonly email: string;

  /** Generated 12-digit account ID (`Fn::GetAtt <logicalId>.AccountId`). Never hard-coded. */
  public readonly accountId: string;

  /** Generated account ARN (`Fn::GetAtt <logicalId>.Arn`). */
  public readonly accountArn: string;

  /** Generated joined timestamp (`Fn::GetAtt <logicalId>.JoinedTimestamp`). */
  public readonly joinedTimestamp: string;

  private readonly resource: organizations.CfnAccount;

  constructor(scope: Construct, id: string, props: SharedAccountProps) {
    super(scope, id);

    this.resource = new organizations.CfnAccount(this, 'Resource', {
      accountName: props.accountName,
      email: props.email,
      parentIds: [props.parentId]
    });

    // Retain-on-delete: a stack delete or an accidental removal of the CDK entry must never
    // close the AWS account. CloudFormation removes the resource from the stack instead;
    // reclaiming or closing the account remains a deliberate, out-of-band operation.
    this.resource.applyRemovalPolicy(RemovalPolicy.RETAIN);
    // Retain-on-replace: `AccountName`, `Email` and `ParentIds` are all classified by
    // CloudFormation as replacement-required properties. Without this, a rename PR would close
    // the previous account and open a new one. With it, CloudFormation orphans the previous
    // resource from the stack and creates a new one - the previous account survives; a human
    // has to close it.
    this.resource.cfnOptions.updateReplacePolicy = CfnDeletionPolicy.RETAIN;

    this.accountName = props.accountName;
    this.email = props.email;
    this.accountId = this.resource.attrAccountId;
    this.accountArn = this.resource.attrArn;
    this.joinedTimestamp = this.resource.attrJoinedTimestamp;
  }

  /** Escape hatch to the underlying L1 resource, mainly for assertions and future overrides. */
  public get cfnAccount(): organizations.CfnAccount {
    return this.resource;
  }
}
