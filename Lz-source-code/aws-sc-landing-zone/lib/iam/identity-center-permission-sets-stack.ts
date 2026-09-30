import * as cdk from 'aws-cdk-lib';
import { Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import { type PermissionSetDefinition, type PermissionSetName } from '../../config/schemas/identity-center-schema.js';
import type {
  AccountAssignmentDefinition,
  GroupPermissionMapping
} from '../../config/schemas/identity-center-schema.js';
import { AccountAssignment } from './constructs/account-assignment.js';
import { PermissionSet } from './constructs/permission-set.js';

export interface IdentityCenterPermissionSetsStackProps extends cdk.StackProps {
  readonly instanceArn?: string;
  readonly permissionSets?: readonly PermissionSetDefinition[];
  readonly groupMappings?: readonly GroupPermissionMapping[];
  readonly accountAssignments?: readonly AccountAssignmentDefinition[];
  readonly principalIdsByGroupName?: Readonly<Record<string, string>>;
}

export class IdentityCenterPermissionSetsStack extends Stack {
  public readonly permissionSets = new Map<PermissionSetName, PermissionSet>();
  public readonly accountAssignments: AccountAssignment[] = [];

  public constructor(scope: Construct, id: string, props: IdentityCenterPermissionSetsStackProps) {
    super(scope, id, props);

    const instanceArn =
      props.instanceArn ??
      new cdk.CfnParameter(this, 'IdentityCenterInstanceArn', {
        description: 'ARN of the existing IAM Identity Center instance for this AWS Organization.'
      }).valueAsString;

    if (props.permissionSets === undefined) {
      throw new Error('Identity Center Permission Set definitions must be supplied from configuration.');
    }

    for (const definition of props.permissionSets) {
      const constructId = definition.name.replace(/[^A-Za-z0-9]/g, '');
      const permissionSet = new PermissionSet(this, constructId, {
        instanceArn,
        definition
      });

      this.permissionSets.set(definition.name, permissionSet);
    }

    for (const assignment of props.accountAssignments ?? []) {
      const permissionSet = this.permissionSets.get(assignment.permissionSetName);
      const principalId = props.principalIdsByGroupName?.[assignment.groupName];

      if (permissionSet === undefined || principalId === undefined) {
        throw new Error(
          `Account assignment for '${assignment.groupName}' requires a configured Permission Set and runtime group ID.`
        );
      }

      const constructId = `${assignment.groupName}-${assignment.permissionSetName}-${assignment.accountId}`.replace(
        /[^A-Za-z0-9]/g,
        ''
      );
      const accountAssignment = new AccountAssignment(this, constructId, {
        instanceArn,
        permissionSetArn: permissionSet.resource.attrPermissionSetArn,
        principalId,
        targetAccountId: assignment.accountId
      });

      this.accountAssignments.push(accountAssignment);
    }
  }
}
