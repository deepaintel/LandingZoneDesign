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
import { createOrganizationsClient, getAccounts } from '../../helpers/organization-helper.js';

const serviceName = 'scim-sync:get-all-account-ids';
const log: Logger = createLogger(serviceName);
const tracer = new Tracer({ serviceName });
const organizationsClient = createOrganizationsClient(tracer);

async function lambdaFunction(event: LambdaInputEvent): Promise<LambdaOutputEvent> {
  try {
    log.debug('event', { event });

    const allAccounts = await getAccounts(organizationsClient);
    const allActiveAccounts = allAccounts.filter((account) => account.State === 'ACTIVE');
    const allAccountIds = allActiveAccounts.map((account) => {
      if (account.Id === undefined) {
        throw new Error('AWS Organizations returned an active account without an ID');
      }

      return account.Id;
    });
    log.debug('allAccountIds', { allAccountIds });
    return { ...event, output: { allAccountIds } };
  } catch (error) {
    log.error('Error in get-all-account-ids', error instanceof Error ? error : String(error));
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
