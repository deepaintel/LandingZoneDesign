import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { createIdentityProviderStack } from './identity-provider.js';

function clearIdentityEnv(): void {
  delete process.env.GITHUB_ORG;
  delete process.env.GITHUB_REPOS;
  delete process.env.GITHUB_OIDC_ISSUER_URL;
  delete process.env.CDK_DEFAULT_ACCOUNT;
  delete process.env.CDK_DEFAULT_REGION;
}

beforeEach(() => {
  clearIdentityEnv();
});

afterEach(() => {
  clearIdentityEnv();
});

describe('identity-provider bin entrypoint', () => {
  it('synthesizes stack with org and repos from environment variables', () => {
    process.env.GITHUB_ORG = 'env-org';
    process.env.GITHUB_REPOS = 'repo-a,repo-b';
    process.env.GITHUB_OIDC_ISSUER_URL = 'token.actions.if-it.ghe.com';

    const app = new cdk.App();
    const stack = createIdentityProviderStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Condition: {
              StringLike: {
                'token.actions.if-it.ghe.com:sub': ['repo:env-org/repo-a:*', 'repo:env-org/repo-b:*']
              }
            }
          }
        ]
      }
    });
  });

  it('falls back to CDK context when environment variables are absent', () => {
    const app = new cdk.App({
      context: {
        githubOrg: 'ctx-org',
        githubRepos: ['ctx-repo'],
        githubOidcIssuerUrl: 'token.actions.if-it.ghe.com'
      }
    });

    const stack = createIdentityProviderStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Condition: {
              StringLike: {
                'token.actions.if-it.ghe.com:sub': ['repo:ctx-org/ctx-repo:*']
              }
            }
          }
        ]
      }
    });
  });

  it('uses custom OIDC issuer URL from environment variables', () => {
    process.env.GITHUB_ORG = 'env-org';
    process.env.GITHUB_REPOS = 'repo-a';
    process.env.GITHUB_OIDC_ISSUER_URL = 'token.actions.if-it.ghe.com';

    const app = new cdk.App();
    const stack = createIdentityProviderStack(app);
    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Condition: {
              StringEquals: {
                'token.actions.if-it.ghe.com:aud': 'sts.amazonaws.com'
              },
              StringLike: {
                'token.actions.if-it.ghe.com:sub': ['repo:env-org/repo-a:*']
              }
            }
          }
        ]
      }
    });
  });
});
