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
import { createIdentityCenterSsoClient } from '../../helpers/identity-center-sso-helper.js';

const serviceName = 'scim-sync:get-identity-store-info';
const log: Logger = createLogger(serviceName);
const tracer = new Tracer({ serviceName });
const ssoAdminClient = createIdentityCenterSsoClient(tracer);

async function lambdaFunction(event: LambdaInputEvent): Promise<LambdaOutputEvent> {
  try {
    log.debug('event', { event });

    const metadata = await ssoAdminClient.listInstances();

    if (!metadata || metadata.length === 0) {
      log.error('No IAM Identity Center instance, make sure IAM Identity Center is enabled in your AWS account.');
      throw new Error('No IAM Identity Center instance');
    }

    const instance = metadata[0];
    if (!instance) {
      throw new Error('No IAM Identity Center instance');
    }

    const id = instance.identityStoreId;
    if (!id) {
      log.error(
        'The identifier of the identity store that is connected to the IAM Identity Center instance could not be found.'
      );
      throw new Error('No IdentityStoreId found');
    }

    const arn = instance.instanceArn;
    if (!arn) {
      log.error(
        'The ARN of the IAM Identity Center instance under which the operation will be executed could not be found.'
      );
      throw new Error('No IAM Identity Center InstanceArn found');
    }
    const ids = { instanceId: id, instanceArn: arn };
    return { ...event, output: { ...event.output, identityStoreInfo: ids } };
  } catch (error) {
    log.error('Error in get-identity-store-info', error instanceof Error ? error : String(error));
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
