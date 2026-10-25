import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createFunctionHandler } from '../../middy-middleware.js';
import {
  type LambdaInputEvent,
  type LambdaOutputEvent,
  lambdaInputEventSchema,
  lambdaOutputEventSchema
} from './schema.js';
import { createLogger } from '../../logger-factory.js';
import {
  createIdentityCenterSsoClient,
  type AccountAssignmentRequest
} from '../../helpers/identity-center-sso-helper.js';

const serviceName = 'scim-sync:create-account-assignment';
const log: Logger = createLogger(serviceName);
const tracer = new Tracer({ serviceName });
const ssoAdminClient = createIdentityCenterSsoClient(tracer);

async function lambdaFunction(event: LambdaInputEvent): Promise<LambdaOutputEvent> {
  try {
    const group = event.output.allGroups.pop();
    log.debug('Processing group:', { group });

    if (!group) {
      log.debug('No more groups to process, setting assignmentsDone to true');
      return {
        ...event,
        output: event.output,
        status: { assignmentsDone: true }
      };
    } else {
      const permissionSetArn = event.output.allPermissionSets[group.permissionSetName];
      if (!permissionSetArn) {
        throw new Error(`No Permission Set ARN found for ${group.permissionSetName}`);
      }
      const input: AccountAssignmentRequest = {
        InstanceArn: event.output.identityStoreInfo.instanceArn,
        TargetId: group.accountId,
        TargetType: 'AWS_ACCOUNT',
        PermissionSetArn: permissionSetArn,
        PrincipalType: 'GROUP',
        PrincipalId: group.groupId
      };
      const requestId = await ssoAdminClient.createAccountAssignment(input);
      if (!requestId) {
        log.error('No request id received, this should not happen');
        throw new Error('No request id received, this should not happen');
      }
      return {
        ...event,
        output: { ...event.output, assignmentRequestId: requestId },
        status: { assignmentsDone: false }
      };
    }
  } catch (error) {
    log.error('Error in create-account-assignment', error instanceof Error ? error : String(error));
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
