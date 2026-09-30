import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { createFunctionHandler } from '../../middy-middleware.js';
import { createLogger } from '../../logger-factory.js';
import { createIdentityCenterSsoClient } from '../../helpers/identity-center-sso-helper.js';
import {
  type LambdaInputEvent,
  type LambdaOutputEvent,
  lambdaInputEventSchema,
  lambdaOutputEventSchema
} from './schema.js';

const serviceName = 'scim-cleanup:get-identity-store-id';
const log: Logger = createLogger(serviceName);
const tracer = new Tracer({ serviceName });
const ssoAdminClient = createIdentityCenterSsoClient(tracer);

async function lambdaFunction(event: LambdaInputEvent): Promise<LambdaOutputEvent> {
  try {
    const instances = await ssoAdminClient.listInstances();

    if (instances.length === 0) {
      log.error('No IAM Identity Center instance, make sure IAM Identity Center is enabled in your AWS account.');
      throw new Error('No IAM Identity Center instance');
    }

    const id = instances[0]?.identityStoreId;
    if (!id) {
      log.error(
        'The identifier of the identity store that is connected to the IAM Identity Center instance could not be found.'
      );
      throw new Error('No IdentityStoreId found');
    }

    return {
      ...event,
      output: { identityStoreInfo: { instanceId: id } }
    };
  } catch (error) {
    log.error('Error in get-identity-store-id', error instanceof Error ? error : String(error));
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
