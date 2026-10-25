/**
 * Control 5 - AMI Block Public Access: `block-new-sharing` in the home Region.
 *
 * Reads `GetImageBlockPublicAccessState` and lists the account's public AMIs
 * (`DescribeImages --owners self --filters Name=is-public,Values=true`).
 *
 * `block-new-sharing` (the only enabled state) blocks NEW public sharing; AMIs that are already
 * public stay public, and sharing with specific accounts, organizations or OUs is not public
 * sharing (EC2 user guide, "Block public access to your AMIs"). AWS itself leaves the setting
 * disabled by default for accounts that have public AMIs. Therefore:
 *  - public AMIs exist: REQUIRES_APPROVAL in every state; existing launch permissions are never
 *    modified;
 *  - `block-new-sharing` and no public AMIs: COMPLIANT;
 *  - `unblocked` and no public AMIs: one
 *    `EnableImageBlockPublicAccess --image-block-public-access-state block-new-sharing`. The setting
 *    can take up to 10 minutes to apply, so the settle budget polls for 12 minutes;
 *  - managed by a declarative policy, or an unexpected state: REQUIRES_APPROVAL.
 */

import { defineControl, type BaselineControl, type ClassifiedState } from './control.js';

export interface ImageObservation {
  readonly state: string;
  readonly managedBy?: string;
  readonly publicImageIds: readonly string[];
}

function listIds(ids: readonly string[]): string {
  return ids.length <= 10 ? ids.join(', ') : `${ids.slice(0, 10).join(', ')} and ${ids.length - 10} more`;
}

export function classifyImage(observation: ImageObservation): ClassifiedState {
  const observed =
    `State=${observation.state}, ManagedBy=${observation.managedBy ?? 'account'}; ` +
    `${observation.publicImageIds.length} public AMI(s)`;
  if (observation.publicImageIds.length > 0) {
    return {
      status: 'REQUIRES_APPROVAL',
      observed,
      writes: [],
      reasons: [
        `public AMIs exist (${listIds(observation.publicImageIds)}); existing launch permissions are not modified ` +
          'and the account needs an approved decision'
      ]
    };
  }
  if (observation.state === 'block-new-sharing') return { status: 'COMPLIANT', observed, writes: [], reasons: [] };
  if (observation.state !== 'unblocked') {
    return {
      status: 'REQUIRES_APPROVAL',
      observed,
      writes: [],
      reasons: [`unexpected AMI BPA state '${observation.state}'`]
    };
  }
  if ((observation.managedBy ?? 'account') !== 'account') {
    return {
      status: 'REQUIRES_APPROVAL',
      observed,
      writes: [],
      reasons: [`AMI Block Public Access is managed by '${observation.managedBy ?? ''}'; it is never overridden`]
    };
  }
  return {
    status: 'NON_COMPLIANT',
    observed,
    writes: [{ kind: 'EnableImageBlockPublicAccess', state: 'block-new-sharing' }],
    reasons: ['no public AMIs; block-new-sharing will be enabled']
  };
}

const control: BaselineControl<ImageObservation> = {
  id: 'ec2-image-block-public-access',
  title: 'AMI Block Public Access',
  settle: { attempts: 24, intervalSeconds: 30 },
  required: (context) => `State=${context.controls.ec2ImageBlockPublicAccess.state}`,
  read: (port) => {
    const state = port.getImageBlockPublicAccessState();
    return {
      state: state.state,
      ...(state.managedBy === undefined ? {} : { managedBy: state.managedBy }),
      publicImageIds: [...port.listPublicImageIds()]
    };
  },
  classify: (observation) => classifyImage(observation),
  invariantProblems: (before, after) =>
    before.state === 'block-new-sharing' && after.state !== 'block-new-sharing'
      ? [`AMI Block Public Access was block-new-sharing and is now '${after.state}'`]
      : []
};

export const ec2ImageBlockPublicAccessControl = defineControl(control);
