import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OidcDeploySmokeStack } from './oidc-deploy-smoke-stack.js';

function makeTemplate(): Template {
  const app = new cdk.App();
  const stack = new OidcDeploySmokeStack(app, 'TestStack');
  return Template.fromStack(stack);
}

describe('OidcDeploySmokeStack', () => {
  it('synthesizes the stack name output', () => {
    const template = makeTemplate();

    template.hasOutput('StackName', {
      Value: 'TestStack'
    });
  });

  it('contains a deployable Lambda resource', ({ expect }) => {
    const template = makeTemplate();

    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.resourceCountIs('AWS::IAM::Role', 1);
    expect(template.toJSON().Resources).toBeDefined();
  });
});
