import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createFunctionHandler } from '../../middy-middleware.js';
import { createLogger } from '../../logger-factory.js';
import { createIdentityStoreClient } from '../../helpers/identity-store-helper.js';
import {
  type LambdaInputEvent,
  type LambdaOutputEvent,
  lambdaInputEventSchema,
  lambdaOutputEventSchema
} from './schema.js';

const serviceName = 'scim-cleanup:get-all-user-ids';
const log: Logger = createLogger(serviceName);
const tracer = new Tracer({ serviceName });
const identityStoreClient = createIdentityStoreClient(tracer);

async function lambdaFunction(event: LambdaInputEvent): Promise<LambdaOutputEvent> {
  try {
    if (!event.correlationId) {
      throw new Error('correlationId is required to fan out per-user workflow items');
    }
    const correlationId = event.correlationId;
    const instanceId = event.output.identityStoreInfo.instanceId;
    const users = await identityStoreClient.listUsers(instanceId);

    const userIds = users.flatMap((user) =>
      user.UserId
        ? [
            {
              correlationId,
              output: {
                instanceId,
                userId: user.UserId
              }
            }
          ]
        : []
    );
    log.debug('userIds', { count: userIds.length });

    return {
      ...event,
      output: {
        userIds,
        identityStoreInfo: { instanceId }
      }
    };
  } catch (error) {
    log.error('Error fetching all users from IAM identity store', error instanceof Error ? error : String(error));
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
