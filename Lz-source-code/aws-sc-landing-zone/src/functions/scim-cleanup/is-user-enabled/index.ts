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

const serviceName = 'scim-cleanup:is-user-enabled';
const log: Logger = createLogger(serviceName);
const tracer = new Tracer({ serviceName });
const identityStoreClient = createIdentityStoreClient(tracer);

async function lambdaFunction(event: LambdaInputEvent): Promise<LambdaOutputEvent> {
  try {
    const memberships = await identityStoreClient.listGroupMembershipsForMember(
      event.output.instanceId,
      event.output.userId
    );
    log.debug(`group memberships for user ${event.output.userId}`, { count: memberships.length });

    return {
      ...event,
      output: {
        ...event.output,
        enabled: memberships.length > 0
      }
    };
  } catch (error) {
    log.error('Error in is-user-enabled', error instanceof Error ? error : String(error));
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
