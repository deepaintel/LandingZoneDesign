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

const serviceName = 'scim-cleanup:delete-user';
const log: Logger = createLogger(serviceName);
const tracer = new Tracer({ serviceName });
const identityStoreClient = createIdentityStoreClient(tracer);

async function lambdaFunction(event: LambdaInputEvent): Promise<LambdaOutputEvent> {
  try {
    log.info(`Deleting user ${event.output.userId}`);
    await identityStoreClient.deleteUser(event.output.instanceId, event.output.userId);
    log.info(`User with userId ${event.output.userId} deleted`);

    return {
      ...event,
      output: {
        ...event.output,
        successfullyDeleted: true
      }
    };
  } catch (error) {
    log.error('Error in delete-user', error instanceof Error ? error : String(error));
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
