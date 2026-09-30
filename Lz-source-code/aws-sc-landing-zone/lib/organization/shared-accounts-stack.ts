/**
 * Shared Accounts stack - creates the AWS Control Tower shared accounts (Audit and Log Archive)
 * under the existing Security OU.
 *
 * Governance: `.apm/instructions/shared-account-provisioning.instructions.md` and
 * `.apm/skills/generate-account/SKILL.md`. This stack creates accounts and nothing else: no OU,
 * no policy, no StackSet, no IAM, no KMS, no Config recorder, no CloudTrail, no tagging, no
 * networking, no IAM Identity Center. The two accounts remain minimally configured so the
 * later Control Tower API onboarding phase can adopt them without pre-launch conflicts
 * (see instruction §9).
 *
 * Stack isolation: this stack does not reference any construct in `OuStructureStack` or
 * `OrganizationPolicyStack` and carries no CloudFormation Export / Fn::ImportValue link to them.
 * The Security OU ID arrives through a pattern-constrained `OuIdSecurity` CloudFormation
 * parameter at deployment time, resolved by the workflow from the OU stack's matching
 * `OuIdSecurity` output. Same pattern already applied to `OrganizationRootId` (from
 * `prepare-organization`) and to every `OuId*` parameter consumed by the policy stack.
 *
 * Account ID handling: AWS account IDs are generated outputs, not inputs. The stack emits one
 * `AccountId<Key>` `CfnOutput` per account (plain `CfnOutput`, no `exportName`, matching the OU
 * stack convention). The deployment workflow reads those outputs via `describe-stacks` and
 * surfaces them to `$GITHUB_STEP_SUMMARY`. No account ID is ever hard-coded in source, invented
 * as a placeholder, or dynamically written back into the YAML during deployment.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import {
  sharedAccountKeys,
  type AccountsConfig,
  type SharedAccountKey
} from '../../config/schemas/shared-accounts-schema.js';
import { SharedAccount } from '../constructs/shared-account.js';

const OU_ID_SECURITY_PARAMETER_NAME = 'OuIdSecurity';
const OU_ID_PATTERN = /^ou-[0-9a-z]{4,32}-[0-9a-z]{8,32}$/;
const ACCOUNT_ID_OUTPUT_PREFIX = 'AccountId';
const ACCOUNT_COUNT_OUTPUT_NAME = 'SharedAccountCount';

export interface SharedAccountsStackProps extends cdk.StackProps {
  /** Validated accounts configuration for the target environment. */
  readonly accountsConfig: AccountsConfig;
}

/**
 * Converts a shared-account configuration key into a deterministic PascalCase construct ID.
 * `logArchive` -> `LogArchive`, `audit` -> `Audit`. Kept aligned with the OU construct-ID
 * derivation so deploy artifacts read consistently (`AccountIdLogArchive`, `AccountIdAudit`).
 */
export function sharedAccountConstructId(key: SharedAccountKey): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export class SharedAccountsStack extends cdk.Stack {
  /** CloudFormation parameter carrying the existing Security OU ID. */
  public readonly ouIdSecurityParameter: cdk.CfnParameter;

  /** Created accounts, addressed by configuration key. */
  public readonly accounts: ReadonlyMap<SharedAccountKey, SharedAccount>;

  constructor(scope: Construct, id: string, props: SharedAccountsStackProps) {
    super(scope, id, props);

    this.ouIdSecurityParameter = new cdk.CfnParameter(this, OU_ID_SECURITY_PARAMETER_NAME, {
      type: 'String',
      description:
        'ID of the EXISTING Security organizational unit (for example ou-a1b2-abcd1234). Supplied at ' +
        'deployment time from the OuIdSecurity output of the already-deployed lz-ou-structure stack. Kept ' +
        'as a parameter rather than a cross-stack ImportValue so either stack can be updated independently.',
      allowedPattern: OU_ID_PATTERN.source,
      constraintDescription: `must be an existing AWS Organizations OU ID matching ${OU_ID_PATTERN.source}`
    });
    // Pin the logical ID so the deployment interface (`--parameters OuIdSecurity=...`) is stable
    // and matches the `OuIdSecurity` output name emitted by the OU Structure stack.
    this.ouIdSecurityParameter.overrideLogicalId(OU_ID_SECURITY_PARAMETER_NAME);

    const parentId = this.ouIdSecurityParameter.valueAsString;
    const accounts = new Map<SharedAccountKey, SharedAccount>();

    for (const key of sharedAccountKeys) {
      const entry = props.accountsConfig[key];
      const account = new SharedAccount(this, sharedAccountConstructId(key), {
        accountName: entry.name,
        email: entry.email,
        parentId
      });
      accounts.set(key, account);
    }

    this.accounts = accounts;

    for (const key of sharedAccountKeys) {
      const account = accounts.get(key);
      if (account === undefined) {
        throw new Error(`Shared account '${key}' was resolved but not created.`);
      }
      const entry = props.accountsConfig[key];

      new cdk.CfnOutput(this, `${ACCOUNT_ID_OUTPUT_PREFIX}${sharedAccountConstructId(key)}`, {
        value: account.accountId,
        description: `Generated 12-digit AWS account ID for the '${entry.name}' account (${key}) under the Security OU.`
      });
    }

    new cdk.CfnOutput(this, ACCOUNT_COUNT_OUTPUT_NAME, {
      value: String(sharedAccountKeys.length),
      description: 'Number of shared Control Tower onboarding accounts managed by this stack.'
    });
  }
}
