import { describe, it } from 'vitest';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { IdentityProviderStack } from '../lib/identity-provider-stack.js';

const DEFAULT_ISSUER_URL = 'https://token.actions.if-it.ghe.com';
const DEFAULT_REGION = 'eusc-de-east-1';

function makeStack(props: {
  githubOrg: string;
  githubRepos: string[];
  githubOidcIssuerUrl?: string;
  env?: cdk.Environment;
}): Template {
  const app = new cdk.App();
  const stack = new IdentityProviderStack(app, 'TestStack', {
    ...props,
    env: props.env ?? { region: DEFAULT_REGION },
    githubOidcIssuerUrl: props.githubOidcIssuerUrl ?? DEFAULT_ISSUER_URL
  });
  return Template.fromStack(stack);
}

describe('IdentityProviderStack', () => {
  describe('OIDC provider', () => {
    it('creates an OIDC provider with the configured URL and audience', () => {
      const template = makeStack({ githubOrg: 'my-org', githubRepos: ['repo-a'] });
      template.hasResourceProperties('Custom::AWSCDKOpenIdConnectProvider', {
        Url: 'https://token.actions.if-it.ghe.com',
        ClientIDList: ['sts.eusc-de-east-1.amazonaws.eu']
      });
    });

    it('supports a custom OIDC issuer URL for GHE', () => {
      const template = makeStack({
        githubOrg: 'my-org',
        githubRepos: ['repo-a'],
        githubOidcIssuerUrl: 'https://token.actions.if-it.ghe.com'
      });
      template.hasResourceProperties('Custom::AWSCDKOpenIdConnectProvider', {
        Url: 'https://token.actions.if-it.ghe.com',
        ClientIDList: ['sts.eusc-de-east-1.amazonaws.eu']
      });
    });
  });

  describe('IAM role', () => {
    it('creates the role with the expected name and description', () => {
      const template = makeStack({ githubOrg: 'my-org', githubRepos: ['repo-a'] });
      template.hasResourceProperties('AWS::IAM::Role', {
        RoleName: 'github-actions-role',
        Description: 'Federated role for GitHub Actions OIDC authentication'
      });
    });

    it('attaches administrator access to the role', () => {
      const template = makeStack({ githubOrg: 'my-org', githubRepos: ['repo-a'] });
      template.hasResourceProperties('AWS::IAM::Role', {
        ManagedPolicyArns: [
          {
            'Fn::Join': ['', ['arn:', { Ref: 'AWS::Partition' }, ':iam::aws:policy/AdministratorAccess']]
          }
        ]
      });
    });

    it('restricts the trust policy to the given org and single repo', () => {
      const template = makeStack({ githubOrg: 'my-org', githubRepos: ['repo-a'] });
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Action: 'sts:AssumeRoleWithWebIdentity',
              Condition: {
                StringEquals: {
                  'token.actions.if-it.ghe.com:aud': 'sts.eusc-de-east-1.amazonaws.eu'
                },
                StringLike: {
                  'token.actions.if-it.ghe.com:sub': ['repo:my-org/repo-a:*']
                }
              }
            }
          ]
        }
      });
    });

    it('restricts the trust policy to multiple repos', () => {
      const template = makeStack({ githubOrg: 'my-org', githubRepos: ['repo-a', 'repo-b'] });
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Condition: {
                StringLike: {
                  'token.actions.if-it.ghe.com:sub': ['repo:my-org/repo-a:*', 'repo:my-org/repo-b:*']
                }
              }
            }
          ]
        }
      });
    });

    it('uses the custom issuer in trust policy condition keys', () => {
      const template = makeStack({
        githubOrg: 'my-org',
        githubRepos: ['repo-a'],
        githubOidcIssuerUrl: 'token.actions.if-it.ghe.com'
      });
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: [
            {
              Condition: {
                StringEquals: {
                  'token.actions.if-it.ghe.com:aud': 'sts.eusc-de-east-1.amazonaws.eu'
                },
                StringLike: {
                  'token.actions.if-it.ghe.com:sub': ['repo:my-org/repo-a:*']
                }
              }
            }
          ]
        }
      });
    });
  });

  describe('outputs', () => {
    it('exports the OIDC provider ARN', () => {
      const template = makeStack({ githubOrg: 'my-org', githubRepos: ['repo-a'] });
      template.hasOutput('GithubOIDCProviderArn', {});
    });

    it('exports the GitHub Actions role ARN', () => {
      const template = makeStack({ githubOrg: 'my-org', githubRepos: ['repo-a'] });
      template.hasOutput('GithubActionsRoleArn', {});
    });
  });
});
