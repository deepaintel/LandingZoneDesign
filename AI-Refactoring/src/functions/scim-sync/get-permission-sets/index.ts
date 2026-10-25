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

const serviceName = 'scim-sync:get-permission-sets';
const log: Logger = createLogger(serviceName);
const tracer = new Tracer({ serviceName });
const ssoAdminClient = createIdentityCenterSsoClient(tracer);

async function lambdaFunction(event: LambdaInputEvent): Promise<LambdaOutputEvent> {
  try {
    log.debug('event', { event });

    const allPermissionSetArns = await ssoAdminClient.listPermissionSetArns(event.output.identityStoreInfo.instanceArn);
    log.debug(`allPermissionSetArns: ${allPermissionSetArns}`);

    const permissionSetResponse: Record<string, string> = {};
    const results = await Promise.all(
      allPermissionSetArns.map((permissionSetArn) =>
        ssoAdminClient.describePermissionSet(event.output.identityStoreInfo.instanceArn, permissionSetArn)
      )
    );
    results.forEach((result) => {
      const permissionSetName = result.name;
      const permissionSetArn = result.arn;
      if (!permissionSetName || !permissionSetArn) {
        throw new Error('AWS IAM Identity Center returned an incomplete permission set');
      }

      permissionSetResponse[permissionSetName] = permissionSetArn;
    });
    log.debug('permissionSetResponse', { permissionSetResponse });

    return {
      ...event,
      output: {
        ...event.output,
        allPermissionSets: permissionSetResponse
      }
    };
  } catch (error) {
    log.error('Error in get-permission-sets', error instanceof Error ? error : String(error));
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
