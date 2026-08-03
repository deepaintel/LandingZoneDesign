import * as cdk from 'aws-cdk-lib';
import { aws_iam as iam } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface IdentityProviderStackProps extends cdk.StackProps {
  githubOrg: string;
  githubRepos: string[];
  githubOidcIssuerUrl: string;
}

function normalizeOidcIssuerUrl(value: string): string {
  const withProtocol = value.startsWith('https://') ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/g, '');
}

function oidcClaimPrefixFromIssuerUrl(issuerUrl: string): string {
  return issuerUrl.replace(/^https:\/\//, '');
}

function oidcAudienceForRegion(region?: string): string {
  if (region?.startsWith('eusc-')) {
    return `sts.${region}.amazonaws.eu`;
  }

  return 'sts.amazonaws.com';
}

export class IdentityProviderStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: IdentityProviderStackProps) {
    super(scope, id, props);

    if (!props.githubOrg?.trim()) {
      throw new Error('Missing GitHub organization. Set GITHUB_ORG or provide githubOrg context.');
    }

    if (!Array.isArray(props.githubRepos) || props.githubRepos.length === 0) {
      throw new Error('At least one GitHub repository must be provided.');
    }

    if (!props.githubOidcIssuerUrl?.trim()) {
      throw new Error(
        'Missing GitHub OIDC issuer URL. Set GITHUB_OIDC_ISSUER_URL or provide githubOidcIssuerUrl context.'
      );
    }

    const githubOidcIssuerUrl = normalizeOidcIssuerUrl(props.githubOidcIssuerUrl);
    const oidcClaimPrefix = oidcClaimPrefixFromIssuerUrl(githubOidcIssuerUrl);
    const oidcAudience = oidcAudienceForRegion(props.env?.region);

    const githubOidcProvider = new iam.OpenIdConnectProvider(this, 'GithubOidcProvider', {
      url: githubOidcIssuerUrl,
      clientIds: [oidcAudience]
    });

    const role = new iam.Role(this, 'GithubActionsRole', {
      roleName: 'github-actions-role',
      description: 'Federated role for GitHub Actions OIDC authentication',
      assumedBy: new iam.WebIdentityPrincipal(githubOidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          [`${oidcClaimPrefix}:aud`]: oidcAudience
        },
        StringLike: {
          [`${oidcClaimPrefix}:sub`]: props.githubRepos.map((repo) => `repo:${props.githubOrg}/${repo}:*`)
        }
      })
    });

    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'));

    new cdk.CfnOutput(this, 'GithubOIDCProviderArn', {
      value: githubOidcProvider.openIdConnectProviderArn
    });

    new cdk.CfnOutput(this, 'GithubActionsRoleArn', {
      value: role.roleArn
    });
  }
}
