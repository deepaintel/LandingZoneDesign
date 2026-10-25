/**
 * Common Account Security Baseline v1.0 - explicit capability checks.
 *
 * Two layers, both fail closed:
 *  1. LOCAL: every AWS CLI command and request member a control relies on must exist in the runner's
 *     AWS CLI service model (`aws <service> <command> --generate-cli-skeleton input`, no AWS call).
 *     A missing command or member makes the control UNSUPPORTED in every account.
 *  2. LIVE: the first read of each control in each account is the live EUSC capability probe. An
 *     `UnsupportedOperation` / `InvalidAction` style response makes it UNSUPPORTED (see
 *     `UNSUPPORTED_ERROR_CODES`); EC2 writes are additionally authorization-probed with `DryRun`.
 * Availability is never inferred from the commercial partition, and an unavailable capability never
 * switches the baseline to a weaker control or another mechanism.
 */

import type { AccountBaselineControlId } from './types.js';

export interface CliRequirement {
  readonly service: string;
  readonly command: string;
  readonly members: readonly string[];
}

/** Every CLI command each control uses, with the request members it sends. */
export const CLI_REQUIREMENTS: Readonly<Record<AccountBaselineControlId, readonly CliRequirement[]>> = {
  's3-account-public-access-block': [
    { service: 's3control', command: 'get-public-access-block', members: ['AccountId'] },
    {
      service: 's3control',
      command: 'put-public-access-block',
      members: ['AccountId', 'PublicAccessBlockConfiguration']
    },
    { service: 's3control', command: 'list-access-points', members: ['AccountId'] },
    { service: 's3control', command: 'get-access-point', members: ['AccountId', 'Name'] },
    { service: 's3control', command: 'get-access-point-policy-status', members: ['AccountId', 'Name'] },
    { service: 's3api', command: 'list-buckets', members: [] },
    { service: 's3api', command: 'get-bucket-policy-status', members: ['Bucket'] },
    { service: 's3api', command: 'get-bucket-acl', members: ['Bucket'] },
    { service: 's3api', command: 'get-bucket-ownership-controls', members: ['Bucket'] },
    { service: 's3api', command: 'get-public-access-block', members: ['Bucket'] }
  ],
  'ebs-encryption-by-default': [
    { service: 'ec2', command: 'get-ebs-encryption-by-default', members: [] },
    { service: 'ec2', command: 'get-ebs-default-kms-key-id', members: [] },
    { service: 'ec2', command: 'enable-ebs-encryption-by-default', members: ['DryRun'] },
    { service: 'kms', command: 'describe-key', members: ['KeyId'] },
    { service: 'kms', command: 'list-aliases', members: ['KeyId'] }
  ],
  'ec2-imds-defaults': [
    { service: 'ec2', command: 'get-instance-metadata-defaults', members: [] },
    {
      service: 'ec2',
      command: 'modify-instance-metadata-defaults',
      members: ['HttpTokens', 'HttpPutResponseHopLimit', 'DryRun']
    }
  ],
  'ebs-snapshot-block-public-access': [
    { service: 'ec2', command: 'get-snapshot-block-public-access-state', members: [] },
    { service: 'ec2', command: 'enable-snapshot-block-public-access', members: ['State', 'DryRun'] },
    { service: 'ec2', command: 'describe-snapshots', members: ['OwnerIds', 'RestorableByUserIds'] }
  ],
  'ec2-image-block-public-access': [
    { service: 'ec2', command: 'get-image-block-public-access-state', members: [] },
    { service: 'ec2', command: 'enable-image-block-public-access', members: ['ImageBlockPublicAccessState', 'DryRun'] },
    { service: 'ec2', command: 'describe-images', members: ['Owners', 'Filters'] }
  ]
};

/**
 * Pure: problems per control from the generated skeletons. `skeletons` maps `service command` to the
 * parsed skeleton, or to an Error when the CLI rejected the command.
 */
export function cliCapabilityProblems(
  skeletons: ReadonlyMap<string, unknown>
): Map<AccountBaselineControlId, string[]> {
  const problems = new Map<AccountBaselineControlId, string[]>();
  for (const [control, requirements] of Object.entries(CLI_REQUIREMENTS) as [
    AccountBaselineControlId,
    readonly CliRequirement[]
  ][]) {
    const list: string[] = [];
    for (const requirement of requirements) {
      const name = `${requirement.service} ${requirement.command}`;
      const skeleton = skeletons.get(name);
      if (skeleton === undefined || skeleton instanceof Error) {
        list.push(
          `AWS CLI on the runner does not support '${name}'${skeleton instanceof Error ? `: ${skeleton.message}` : ''}`
        );
        continue;
      }
      if (skeleton === null || typeof skeleton !== 'object') {
        list.push(`AWS CLI returned no request skeleton for '${name}'`);
        continue;
      }
      for (const member of requirement.members) {
        if (!(member in (skeleton as Record<string, unknown>))) {
          list.push(`AWS CLI '${name}' has no '${member}' request member`);
        }
      }
    }
    if (list.length > 0) problems.set(control, list);
  }
  return problems;
}
