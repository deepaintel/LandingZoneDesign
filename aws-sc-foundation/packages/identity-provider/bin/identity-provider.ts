#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { pathToFileURL } from 'node:url';
import { IdentityProviderStack } from '../lib/identity-provider-stack.js';
import { parseRepos } from '../lib/parse-repos.js';

export function createIdentityProviderStack(app: cdk.App): IdentityProviderStack {
  const account = process.env.CDK_DEFAULT_ACCOUNT;
  const region = process.env.CDK_DEFAULT_REGION;
  const githubRepos = parseRepos(process.env.GITHUB_REPOS, app.node.tryGetContext('githubRepos'));
  const githubOrg = process.env.GITHUB_ORG ?? app.node.tryGetContext('githubOrg');
  const githubOidcIssuerUrl = process.env.GITHUB_OIDC_ISSUER_URL ?? app.node.tryGetContext('githubOidcIssuerUrl');

  return new IdentityProviderStack(app, 'IdentityProviderStack', {
    env: account || region ? { account, region } : undefined,
    githubOrg,
    githubRepos,
    githubOidcIssuerUrl
  });
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  const app = new cdk.App();
  createIdentityProviderStack(app);
}
