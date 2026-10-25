import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createFunctionHandler } from '../../middy-middleware.js';
import { createLogger } from '../../logger-factory.js';
import { createIdentityStoreClient, type IdentityStoreGroup } from '../../helpers/identity-store-helper.js';
import {
  type LambdaInputEvent,
  type LambdaOutputEvent,
  lambdaInputEventSchema,
  lambdaOutputEventSchema
} from './schema.js';
import { GroupResponse } from '../types.js';
import { createOrganizationsClient } from '../../helpers/organization-helper.js';
import { APPROVED_PERMISSION_SET_NAMES } from '../../../../config/schemas/identity-center-schema.js';
import {
  isGroupForEnvironment,
  parseGroupName,
  resolveAccountIdsForScope,
  type ScimEnvironment
} from './scope-resolver.js';

const serviceName = 'scim-sync:get-all-identity-store-groups';
const log: Logger = createLogger(serviceName);
const tracer = new Tracer({ serviceName });
const organizationsClient = createOrganizationsClient(tracer);
const identityStoreClient = createIdentityStoreClient(tracer);
const permissionSetNames = new Set<string>(APPROVED_PERMISSION_SET_NAMES);
const environmentValue = (process.env.SCIM_ENVIRONMENT ?? '').toLowerCase();
if (environmentValue !== 'staging' && environmentValue !== 'production') {
  throw new Error("SCIM_ENVIRONMENT must be either 'staging' or 'production'");
}
const environment: ScimEnvironment = environmentValue;

async function lambdaFunction(event: LambdaInputEvent): Promise<LambdaOutputEvent> {
  try {
    const allGroups: IdentityStoreGroup[] = await identityStoreClient.listGroups(
      event.output.identityStoreInfo.instanceId
    );

    const groupResponseArr: GroupResponse[] = [];
    for (const group of allGroups) {
      const displayName = group.DisplayName;
      const groupId = group.GroupId;
      if (!displayName || !groupId) {
        log.error(`Identity Center group is missing a display name or ID. Skipping group.`);
        continue;
      }
      const parsedGroup = parseGroupName(displayName);
      if (!parsedGroup) {
        log.error(`Invalid Entra group name [${displayName}]. Skipping group.`);
        continue;
      }

      const { organizationToken, scope, permissionSetName, description } = parsedGroup;
      if (!isGroupForEnvironment(organizationToken, environment)) {
        log.warn(`Entra group [${displayName}] targets environment [${organizationToken}]. Skipping group.`);
        continue;
      }
      if (!permissionSetNames.has(permissionSetName)) {
        log.error(`Unknown Permission Set [${permissionSetName}] in group [${displayName}]. Skipping group.`);
        continue;
      }

      const accountIds = await resolveAccountIdsForScope(scope, organizationsClient);
      if (accountIds.length === 0) {
        log.warn(`Entra group [${displayName}] resolved to no active accounts. Skipping group.`);
        continue;
      }
      for (const accountId of accountIds) {
        if (event.output.allAccountIds.includes(accountId)) {
          groupResponseArr.push({ accountId, permissionSetName, groupId, description });
        }
      }
    }

    return {
      ...event,
      output: {
        ...event.output,
        allGroups: groupResponseArr
      }
    };
  } catch (error) {
    log.error('Error in get-all-identity-store-groups', error instanceof Error ? error : String(error));
    throw error;
  }
}

export const handler = createFunctionHandler(
  lambdaFunction,
  lambdaInputEventSchema,
  lambdaOutputEventSchema,
  log,
  tracer
);
