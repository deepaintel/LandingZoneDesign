#!/usr/bin/env node
/**
 * CDK application entry point for `aws-sc-landing-zone`.
 *
 * The same CDK app serves Staging and Production, but each environment is synthesized from
 * its own merged configuration using `-c environment=staging|production` (or
 * `LANDING_ZONE_ENVIRONMENT`).
 *
 * Current implementation increment: the AWS Organizations OU hierarchy, the approved Service
 * Control Policy / Resource Control Policy code and its Root / OU attachment wiring, IAM Identity
 * Center Permission Sets, the Control Tower shared onboarding accounts (Audit and Log Archive)
 * under the existing Security OU, and Control Tower prerequisite roles. The protected release
 * workflow deploys the approved stack sequence in both environments after their respective
 * GitHub Environment gates. The `deploy-landing-zone-accounts` composite action reconciles the
 * remaining Landing Zone accounts with AWS Organizations at runtime. See
 * `.apm/skills/generate-account/SKILL.md` for account scope and provisioning rules.
 */

import * as cdk from 'aws-cdk-lib';
import { pathToFileURL } from 'node:url';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { assertLandingZoneAccountScope } from '../config/schemas/landing-zone-accounts-schema.js';
import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import type { LandingZoneConfig } from '../config/schemas/organization-schema.js';
import { ControlTowerRolesStack } from '../lib/control-tower/control-tower-roles-stack.js';
import { IdentityCenterPermissionSetsStack } from '../lib/iam/identity-center-permission-sets-stack.js';
import { ScimCleanupStack } from '../lib/iam/scim-cleanup-stack.js';
import { ScimSyncStack } from '../lib/iam/scim-sync-stack.js';
import { OrganizationPolicyStack } from '../lib/organization/organization-policy-stack.js';
import { OuStructureStack } from '../lib/organization/ou-structure-stack.js';
import { SharedAccountsStack } from '../lib/organization/shared-accounts-stack.js';

/** Construct ID of the OU Structure stack. Used for targeted deployment (`cdk deploy OuStructureStack`). */
export const OU_STRUCTURE_STACK_ID = 'OuStructureStack';
export const IDENTITY_CENTER_PERMISSION_SETS_STACK_ID = 'IdentityCenterPermissionSetsStack';
export const SCIM_SYNC_STACK_ID = 'ScimSyncStack';
export const SCIM_CLEANUP_STACK_ID = 'ScimCleanupStack';

/**
 * Construct ID of the Organization Policy stack. The release workflow deploys it after the
 * OU stack, passing resolved OU IDs as CloudFormation parameters.
 */
export const ORGANIZATION_POLICY_STACK_ID = 'OrganizationPolicyStack';

/**
 * Construct ID of the Shared Accounts stack (Audit and Log Archive).
 *
 * Both environments deploy this stack under their protected GitHub Environment gates.
 * The resulting account IDs are passed to Control Tower initialization at runtime.
 */
export const SHARED_ACCOUNTS_STACK_ID = 'SharedAccountsStack';

/**
 * Construct ID of the Control Tower prerequisite roles stack.
 *
 * Creates the three management-account IAM roles required by the AWS Control Tower
 * `CreateLandingZone` API path (`AWSControlTowerAdmin`, `AWSControlTowerCloudTrailRole`,
 * `AWSControlTowerStackSetRole`). Deployed after shared accounts and before initialization.
 */
export const CONTROL_TOWER_ROLES_STACK_ID = 'ControlTowerRolesStack';

function resolveEnvironmentName(app: cdk.App): 'staging' | 'production' {
  const environment =
    (app.node.tryGetContext('environment') as string | undefined) ?? process.env.LANDING_ZONE_ENVIRONMENT;

  if (environment === undefined) {
    throw new Error(
      'Missing environment context: use -c environment=staging|production or set LANDING_ZONE_ENVIRONMENT.'
    );
  }

  if (!['staging', 'production'].includes(environment)) {
    throw new Error(`Unsupported environment '${environment}'. Use one of: staging, production.`);
  }

  return environment as 'staging' | 'production';
}

export interface LandingZoneApp {
  readonly config: LandingZoneConfig;
  readonly ouStructureStack: OuStructureStack;
  readonly identityCenterPermissionSetsStack: IdentityCenterPermissionSetsStack;
  readonly scimSyncStack: ScimSyncStack;
  readonly scimCleanupStack: ScimCleanupStack;
  readonly organizationPolicyStack: OrganizationPolicyStack;
  readonly sharedAccountsStack: SharedAccountsStack;
  readonly controlTowerRolesStack: ControlTowerRolesStack;
}

export function createLandingZoneApp(app: cdk.App): LandingZoneApp {
  const environment = resolveEnvironmentName(app);

  const reader = new ConfigReader(environment, { configDirName: 'config', schema: LandingZoneSchema });
  const mergedConfig = reader.getConfig();

  const env = {
    account: mergedConfig.aws.accountId,
    region: mergedConfig.aws.region
  };

  const ouStructureStack = new OuStructureStack(app, OU_STRUCTURE_STACK_ID, {
    stackName: 'lz-ou-structure',
    description: `AWS ESC Landing Zone - AWS Organizations OU structure for the ${environment} environment`,
    env,
    organizationConfig: mergedConfig.organization
  });

  const identityCenterPermissionSetsStack = new IdentityCenterPermissionSetsStack(
    app,
    IDENTITY_CENTER_PERMISSION_SETS_STACK_ID,
    {
      stackName: 'lz-identity-center-permission-sets',
      description: `AWS ESC Landing Zone - IAM Identity Center Permission Sets for the ${environment} environment`,
      env: {
        account: mergedConfig.aws.accountId,
        region: mergedConfig.aws.region
      },
      permissionSets: mergedConfig.identityCenter.permissionSets,
      groupMappings: mergedConfig.identityCenter.groupMappings,
      accountAssignments: mergedConfig.identityCenter.accountAssignments
    }
  );

  const scimSyncStack = new ScimSyncStack(app, SCIM_SYNC_STACK_ID, {
    stackName: 'lz-scim-sync',
    description: `AWS ESC Landing Zone - IAM Identity Center SCIM synchronization for the ${environment} environment`,
    env,
    environmentName: environment,
    timeBetweenActivatingScimSyncFlow: mergedConfig.identityCenter.scim.checkForScimSync,
    timeBetweenCheckingForAssignmentStatus: mergedConfig.identityCenter.scim.queryAccountAssignmentStatus
  });

  const scimCleanupStack = new ScimCleanupStack(app, SCIM_CLEANUP_STACK_ID, {
    stackName: 'lz-scim-cleanup',
    description: `AWS ESC Landing Zone - IAM Identity Center SCIM cleanup for the ${environment} environment`,
    env,
    timeBetweenActivatingScimCleanupFlow: mergedConfig.identityCenter.scimCleanup.checkForScimCleanup
  });

  // Policy definitions live in lib/organization/policies/, never in this entry point. The two stacks
  // are DELIBERATELY isolated: the policy stack takes the Root ID and every OU ID as pattern-
  // constrained CloudFormation parameters instead of referencing the OU stack's constructs, so CDK
  // emits no cross-stack Fn::Export / Fn::ImportValue link between them. Deployment ordering (OU
  // stack first, then policy stack with OU outputs threaded through as parameters) is preserved by
  // the workflow, not by a CDK-level addDependency. This lets either stack be updated, replaced or
  // torn down independently.
  const organizationPolicyStack = new OrganizationPolicyStack(app, ORGANIZATION_POLICY_STACK_ID, {
    stackName: 'lz-organization-policies',
    description:
      `AWS ESC Landing Zone - AWS Organizations service and resource control policies for the ${environment} ` +
      'environment',
    env,
    organizationConfig: mergedConfig.organization,
    governanceConfig: mergedConfig.governance
  });

  // Shared Control Tower onboarding accounts (Audit / Log Archive). Isolated from the OU stack
  // the same way the policy stack is: it takes the Security OU ID as a pattern-constrained
  // CloudFormation parameter (`OuIdSecurity`) resolved at deploy time from the OU stack's matching
  // output, and never references the OU stack's constructs. No CDK-level addDependency; ordering
  // is enforced by the workflow (OU stack first, then this stack with OuIdSecurity threaded
  // through as a --parameters value). Both environments deploy it after the OU stack.
  const sharedAccountsStack = new SharedAccountsStack(app, SHARED_ACCOUNTS_STACK_ID, {
    stackName: 'lz-shared-accounts',
    description:
      `AWS ESC Landing Zone - Control Tower shared accounts (Audit and Log Archive) for the ${environment} ` +
      'environment',
    env,
    accountsConfig: mergedConfig.accounts
  });

  // Control Tower management-account prerequisite roles required by the CreateLandingZone API
  // path (AWSControlTowerAdmin, AWSControlTowerCloudTrailRole, AWSControlTowerStackSetRole).
  // Deployed before Control Tower initialization; skipped on subsequent runs where the roles
  // already exist. See `.apm/skills/initialize-control-tower/SKILL.md` for the API-path
  // exception to the general "do not pre-create Control Tower roles" rule.
  const controlTowerRolesStack = new ControlTowerRolesStack(app, CONTROL_TOWER_ROLES_STACK_ID, {
    stackName: 'lz-control-tower-roles',
    description:
      `AWS ESC Landing Zone - Control Tower management-account prerequisite roles for the ${environment} ` +
      'environment',
    env
  });

  // The remaining Landing Zone accounts are reconciled at runtime by the
  // `deploy-landing-zone-accounts` composite action. The scope guard also runs here so synth
  // (and therefore CI) fails if Production holds anything other than SharedServices and Network.
  assertLandingZoneAccountScope(environment, mergedConfig.landingZoneAccounts);

  return {
    config: mergedConfig,
    ouStructureStack,
    identityCenterPermissionSetsStack,
    scimSyncStack,
    scimCleanupStack,
    organizationPolicyStack,
    sharedAccountsStack,
    controlTowerRolesStack
  };
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  const app = new cdk.App();
  createLandingZoneApp(app);
}
