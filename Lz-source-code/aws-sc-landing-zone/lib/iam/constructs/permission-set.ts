import * as sso from 'aws-cdk-lib/aws-sso';
import { Fn } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import type { PermissionSetDefinition } from '../../../config/schemas/identity-center-schema.js';

export interface PermissionSetProps {
  readonly instanceArn: string;
  readonly definition: PermissionSetDefinition;
}

export class PermissionSet extends Construct {
  public readonly resource: sso.CfnPermissionSet;

  public constructor(scope: Construct, id: string, props: PermissionSetProps) {
    super(scope, id);

    this.resource = new sso.CfnPermissionSet(this, 'Resource', {
      instanceArn: props.instanceArn,
      name: props.definition.name,
      description: props.definition.purpose,
      sessionDuration: props.definition.sessionDuration,
      managedPolicies: props.definition.managedPolicies.map((policyName) =>
        Fn.sub('arn:${AWS::Partition}:iam::aws:policy/${PolicyName}', { PolicyName: policyName })
      )
    });
  }
}
