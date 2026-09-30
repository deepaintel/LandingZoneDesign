/**
 * Landing Zone Accounts stack - creates the remaining approved Landing Zone accounts
 * (SecurityTooling, SharedServices, Network, and the CCoE Landing Zone validation / test
 * accounts) with the customer-confirmed mandatory P1 tag set applied at creation.
 *
 * Governance: `.apm/instructions/landing-zone-account-provisioning.instructions.md` and
 * `.apm/skills/generate-account/SKILL.md`. This stack creates accounts (and their tags) and
 * nothing else: no OU, no policy, no StackSet, no IAM, no KMS, no Config recorder, no
 * CloudTrail, no networking, no IAM Identity Center. It is intentionally SEPARATE from
 * `SharedAccountsStack` (Audit / Log Archive) - Path A remains scoped to that stack per
 * `.apm/instructions/shared-account-provisioning.instructions.md` §18, and Log Archive / Audit
 * tagging remains deferred by §11 of that instruction.
 *
 * Stack isolation: this stack does not reference any construct in `OuStructureStack`,
 * `OrganizationPolicyStack`, or `SharedAccountsStack`, and carries no CloudFormation Export /
 * Fn::ImportValue link to any of them. Every referenced OU ID enters as a pattern-constrained
 * `OuId<PascalKey>` CloudFormation parameter resolved at deployment time by the
 * `deploy-landing-zone-accounts` composite action from the OU stack's matching outputs. Same
 * mechanism the OU / policy / shared-accounts stacks already use.
 *
 * Account ID handling: AWS account IDs are generated outputs, not inputs. The stack emits one
 * `AccountId<PascalKey>` `CfnOutput` per instantiated account plus `LandingZoneAccountCount`.
 * No `exportName`; no cross-stack coupling. Path A does not apply to these accounts - there is
 * no Control Tower runtime handoff for them.
 *
 * Blocked accounts: an account whose Account Email is unresolved (currently
 * `CCoE-Hybrid-NonProd-01` per `landing-zone-account-provisioning.instructions.md` §3.4) must
 * not appear in the active configuration until the customer confirms the email. Once
 * confirmed, adding the account entry to configuration is sufficient - no code change is
 * required in this stack.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import type {
  LandingZoneAccountConfig,
  LandingZoneAccountsConfig
} from '../../config/schemas/landing-zone-accounts-schema.js';
import { SharedAccount } from '../constructs/shared-account.js';

const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const ACCOUNT_ID_OUTPUT_PREFIX = 'AccountId';
const ACCOUNT_COUNT_OUTPUT_NAME = 'LandingZoneAccountCount';

export interface LandingZoneAccountsStackProps extends cdk.StackProps {
  /** Validated active Landing Zone account collection for the target environment. May be empty. */
  readonly landingZoneAccountsConfig: LandingZoneAccountsConfig;
}

/**
 * Derives the CloudFormation parameter name for an OU path, using the same lowercase-kebab →
 * PascalCase mapping that `lib/organization/ou-structure-stack.ts` applies when it emits its
 * `OuId<PascalKey>` outputs. Kept in one place so any future change to the OU-key convention
 * stays symmetrical between producer and consumer.
 *
 *   `Security`                    → `OuIdSecurity`
 *   `Infrastructure`              → `OuIdInfrastructure`
 *   `Workloads/Hybrid/Prod`       → `OuIdWorkloadsHybridProd`
 *   `Workloads/Hybrid/Non-Prod`   → `OuIdWorkloadsHybridNonProd`
 */
export function ouPathToParameterName(ouPath: string): string {
  const key = ouPath
    .split('/')
    .map((segment) => segment.trim())
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const pascal = key
    .split('-')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');
  if (pascal.length === 0) {
    throw new Error(`Cannot derive OuId parameter name from empty OU path '${ouPath}'.`);
  }
  return `OuId${pascal}`;
}

/**
 * Converts a camelCase account configuration key into a deterministic PascalCase construct ID.
 * `securityTooling` → `SecurityTooling`, `ccoeHybridProd01` → `CcoeHybridProd01`. Matches the
 * shared-account convention in `lib/organization/shared-accounts-stack.ts` so deploy artifacts
 * read consistently (`AccountIdSecurityTooling`, `AccountIdCcoeHybridProd01`, ...).
 */
export function landingZoneAccountConstructId(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Builds the P1 tag list applied to an account per
 * `landing-zone-account-provisioning.instructions.md` §6 and §9. Tag keys use the
 * customer-approved lowercase-hyphen form. `owner`, `owner-email`, and `itsystemcode` are
 * derived from the account's `owner`, `email`, and `costCentre` respectively (workbook
 * mapping); the remaining five values come from the account's validated `tags` block.
 */
export function buildLandingZoneAccountTags(entry: LandingZoneAccountConfig): cdk.CfnTag[] {
  return [
    { key: 'owner', value: entry.owner },
    { key: 'owner-email', value: entry.email },
    { key: 'environment', value: entry.tags.environment },
    { key: 'lifecycle', value: entry.tags.lifecycle },
    { key: 'data-classification', value: entry.tags.dataClassification },
    { key: 'data-residency', value: entry.tags.dataResidency },
    { key: 'itsystemcode', value: entry.costCentre },
    { key: 'domain', value: entry.tags.domain }
  ];
}

export class LandingZoneAccountsStack extends cdk.Stack {
  /** OuId parameters declared by this stack, keyed by parameter name. */
  public readonly ouIdParameters: ReadonlyMap<string, cdk.CfnParameter>;

  /** Created accounts, addressed by configuration key. */
  public readonly accounts: ReadonlyMap<string, SharedAccount>;

  constructor(scope: Construct, id: string, props: LandingZoneAccountsStackProps) {
    super(scope, id, props);

    const entries = Object.entries(props.landingZoneAccountsConfig).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey)
    );

    // Discover exactly the OU parameters this deployment needs. Only OUs referenced by an
    // active account become CloudFormation parameters; unused OUs stay out of the template so
    // an incomplete configuration surface never asks for OU IDs it will not consume.
    const ouIdParameters = new Map<string, cdk.CfnParameter>();
    for (const [, entry] of entries) {
      const parameterName = ouPathToParameterName(entry.ouPath);
      if (ouIdParameters.has(parameterName)) {
        continue;
      }
      const parameter = new cdk.CfnParameter(this, parameterName, {
        type: 'String',
        description:
          `ID of the EXISTING '${entry.ouPath}' organizational unit (for example ou-a1b2-abcd1234). Supplied at ` +
          `deployment time from the ${parameterName} output of the already-deployed lz-ou-structure stack. Kept ` +
          'as a parameter rather than a cross-stack ImportValue so either stack can be updated independently.',
        allowedPattern: OU_ID_PATTERN.source,
        constraintDescription: `must be an existing AWS Organizations OU ID matching ${OU_ID_PATTERN.source}`
      });
      // Pin the logical ID so the deployment interface (`--parameters OuId<Key>=...`) is stable
      // and matches the OU stack's output name.
      parameter.overrideLogicalId(parameterName);
      ouIdParameters.set(parameterName, parameter);
    }
    this.ouIdParameters = ouIdParameters;

    const accounts = new Map<string, SharedAccount>();
    for (const [key, entry] of entries) {
      const parameterName = ouPathToParameterName(entry.ouPath);
      const parameter = ouIdParameters.get(parameterName);
      if (parameter === undefined) {
        throw new Error(`OuId parameter '${parameterName}' for account '${key}' was resolved but not created.`);
      }

      const account = new SharedAccount(this, landingZoneAccountConstructId(key), {
        accountName: entry.name,
        email: entry.email,
        parentId: parameter.valueAsString,
        tags: buildLandingZoneAccountTags(entry)
      });
      accounts.set(key, account);
    }
    this.accounts = accounts;

    // Outputs. One `AccountId<PascalKey>` per instantiated account plus the actual count. No
    // `Fn::Export` block on any output (matching the OU / shared-accounts stack convention).
    // The indexed access below is guarded to satisfy `noUncheckedIndexedAccess`; the account
    // was created from the same `entries` iteration above, so the invariant always holds and
    // the throw is a defensive rail for future refactors.
    for (const [key, account] of accounts) {
      const entry = props.landingZoneAccountsConfig[key];
      if (entry === undefined) {
        throw new Error(`Configured account '${key}' was created but is missing from the input configuration.`);
      }
      new cdk.CfnOutput(this, `${ACCOUNT_ID_OUTPUT_PREFIX}${landingZoneAccountConstructId(key)}`, {
        value: account.accountId,
        description: `Generated 12-digit AWS account ID for the '${entry.name}' account (${key}) under the '${entry.ouPath}' OU.`
      });
    }

    new cdk.CfnOutput(this, ACCOUNT_COUNT_OUTPUT_NAME, {
      value: String(accounts.size),
      description: 'Number of Landing Zone accounts managed by this stack in the active environment configuration.'
    });
  }
}
