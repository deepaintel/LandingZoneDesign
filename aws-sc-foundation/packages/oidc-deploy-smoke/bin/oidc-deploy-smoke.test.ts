import { afterEach, describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { createOidcDeploySmokeStack } from './oidc-deploy-smoke.js';

function clearStackEnv(): void {
  delete process.env.CDK_DEFAULT_ACCOUNT;
  delete process.env.CDK_DEFAULT_REGION;
}

afterEach(() => {
  clearStackEnv();
});

describe('oidc-deploy-smoke bin entrypoint', () => {
  it('synthesizes the generated stack', ({ expect }) => {
    const app = new cdk.App();
    const stack = createOidcDeploySmokeStack(app);
    const template = Template.fromStack(stack);

    template.hasOutput('StackName', {
      Value: 'OidcDeploySmokeStack'
    });
    expect(stack.stackName).toBe('OidcDeploySmokeStack');
  });

  it('passes through account and region from environment variables', ({ expect }) => {
    process.env.CDK_DEFAULT_ACCOUNT = '111111111111';
    process.env.CDK_DEFAULT_REGION = 'eu-west-1';

    const app = new cdk.App();
    const stack = createOidcDeploySmokeStack(app);

    expect(stack.account).toBe('111111111111');
    expect(stack.region).toBe('eu-west-1');
  });
});
