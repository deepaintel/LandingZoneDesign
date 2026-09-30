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
import { z } from 'zod';

const serviceName = 'scim-sync:get-account-assignment-status';
const log: Logger = createLogger(serviceName);
const tracer = new Tracer({ serviceName });
const ssoAdminClient = createIdentityCenterSsoClient(tracer);

async function lambdaFunction(event: LambdaInputEvent): Promise<LambdaOutputEvent> {
  try {
    const { status, failureReason } = await ssoAdminClient.getAccountAssignmentStatus(
      event.output.identityStoreInfo.instanceArn,
      event.output.assignmentRequestId
    );
    const assignmentStatus = z.enum(['FAILED', 'IN_PROGRESS', 'SUCCEEDED']).parse(status);
    if (assignmentStatus === 'FAILED') {
      log.error('Account assignment creation failed', { failureReason });
      throw new Error(`Account assignment creation failed: ${failureReason ?? 'no failure reason returned by AWS'}`);
    }

    const outputEvent = {
      ...event,
      status: {
        ...event.status,
        assignmentStatus
      }
    };
    return outputEvent;
  } catch (error) {
    log.error('Error in get-account-assignment-status', error instanceof Error ? error : String(error));
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
