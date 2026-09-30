#!/usr/bin/env tsx
/**
 * Emits the active Landing Zone account manifest for a given environment as JSON on stdout.
 *
 * Governed by `.apm/instructions/landing-zone-account-provisioning.instructions.md` §20
 * ("Configuration is the account inventory source"): the deploy-landing-zone-accounts composite
 * action consumes this manifest so the workflow never carries a hand-maintained duplicate of
 * the account inventory. The manifest is derived entirely from the validated environment
 * configuration (loaded through the existing `@ccoe-aws_if-it/ccoe-config-reader` +
 * `LandingZoneSchema` chain); zero accounts is a valid result and corresponds to the
 * DEPLOYMENT CONFIGURATION PENDING state described in §12.
 *
 * Output shape:
 *   {
 *     "environment": "staging",
 *     "count": <number of active accounts>,
 *     "accounts": [
 *       {
 *         "key": "<camelCase configuration key>",
 *         "constructId": "<PascalCase construct ID>",
 *         "name": "<AWS account name>",
 *         "email": "<AWS account email>",
 *         "ouPath": "<repository canonical OU path>",
 *         "ouParameterName": "OuId<PascalKey>",
 *         "outputName": "AccountId<PascalKey>"
 *       },
 *       ...
 *     ],
 *     "ouParameterNames": ["OuIdSecurity", "OuIdInfrastructure", ...]
 *   }
 *
 * Runs entirely offline against repository configuration - no AWS calls, no deployment.
 */

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { LandingZoneSchema } from '../config/schemas/organization-schema.js';
import {
  landingZoneAccountConstructId,
  ouPathToParameterName
} from '../lib/organization/landing-zone-accounts-stack.js';

const SUPPORTED_ENVIRONMENTS = ['staging', 'production'] as const;
type Environment = (typeof SUPPORTED_ENVIRONMENTS)[number];

interface CliOptions {
  readonly environment: Environment;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let environment: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--environment') {
      environment = argv[index + 1];
      index += 1;
    } else if (arg !== undefined && arg.startsWith('--environment=')) {
      environment = arg.slice('--environment='.length);
    }
  }
  if (environment === undefined) {
    throw new Error('Missing required argument: --environment staging|production');
  }
  if (!(SUPPORTED_ENVIRONMENTS as readonly string[]).includes(environment)) {
    throw new Error(`Unsupported environment '${environment}'. Use one of: ${SUPPORTED_ENVIRONMENTS.join(', ')}.`);
  }
  return { environment: environment as Environment };
}

function main(): void {
  const options = parseCliOptions(process.argv.slice(2));
  const reader = new ConfigReader(options.environment, {
    configDirName: 'config',
    schema: LandingZoneSchema
  });
  const config = reader.getConfig();
  const entries = Object.entries(config.landingZoneAccounts).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );

  const accounts = entries.map(([key, entry]) => {
    const parameterName = ouPathToParameterName(entry.ouPath);
    const constructId = landingZoneAccountConstructId(key);
    return {
      key,
      constructId,
      name: entry.name,
      email: entry.email,
      ouPath: entry.ouPath,
      ouParameterName: parameterName,
      outputName: `AccountId${constructId}`
    };
  });

  const ouParameterNames = Array.from(new Set(accounts.map((account) => account.ouParameterName))).sort();

  process.stdout.write(
    `${JSON.stringify(
      {
        environment: options.environment,
        count: accounts.length,
        accounts,
        ouParameterNames
      },
      null,
      2
    )}\n`
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`list-landing-zone-accounts: ${message}\n`);
  process.exit(1);
}
