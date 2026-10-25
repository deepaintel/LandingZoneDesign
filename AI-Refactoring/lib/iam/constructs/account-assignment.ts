import * as sso from 'aws-cdk-lib/aws-sso';
import { Construct } from 'constructs';

export interface AccountAssignmentProps {
  readonly instanceArn: string;
  readonly permissionSetArn: string;
  readonly principalId: string;
  readonly targetAccountId: string;
}

export class AccountAssignment extends Construct {
  public readonly resource: sso.CfnAssignment;

  public constructor(scope: Construct, id: string, props: AccountAssignmentProps) {
    super(scope, id);

    this.resource = new sso.CfnAssignment(this, 'Resource', {
      instanceArn: props.instanceArn,
      permissionSetArn: props.permissionSetArn,
      principalId: props.principalId,
      principalType: 'GROUP',
      targetId: props.targetAccountId,
      targetType: 'AWS_ACCOUNT'
    });
  }
}
