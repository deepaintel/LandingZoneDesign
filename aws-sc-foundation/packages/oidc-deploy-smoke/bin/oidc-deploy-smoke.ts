#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { pathToFileURL } from 'node:url';
import { OidcDeploySmokeStack } from '../lib/oidc-deploy-smoke-stack.js';

export function createOidcDeploySmokeStack(app: cdk.App): OidcDeploySmokeStack {
  const account = process.env.CDK_DEFAULT_ACCOUNT;
  const region = process.env.CDK_DEFAULT_REGION;

  return new OidcDeploySmokeStack(app, 'OidcDeploySmokeStack', {
    env: account || region ? { account, region } : undefined
  });
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  const app = new cdk.App();
  createOidcDeploySmokeStack(app);
}
