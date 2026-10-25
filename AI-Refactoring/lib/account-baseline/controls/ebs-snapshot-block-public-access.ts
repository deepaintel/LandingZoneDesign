/**
 * Control 4 - EBS snapshot Block Public Access: `block-all-sharing` in the home Region.
 *
 * Reads `GetSnapshotBlockPublicAccessState` and lists the account's snapshots that are restorable
 * by everyone (`DescribeSnapshots --owner-ids self --restorable-by-user-ids all`).
 *
 * `block-all-sharing` makes already-public snapshots private, while `block-new-sharing` leaves them
 * public; private sharing with specific accounts is not affected by either (EBS user guide, "Block
 * public access for snapshots"). Therefore:
 *  - `block-all-sharing`: COMPLIANT (never downgraded);
 *  - any other state with public snapshots: REQUIRES_APPROVAL, no change. There is NO silent
 *    fallback to `block-new-sharing`;
 *  - `unblocked` / `block-new-sharing` with no public snapshots: one
 *    `EnableSnapshotBlockPublicAccess --state block-all-sharing`;
 *  - managed by a declarative policy, or an unexpected state: REQUIRES_APPROVAL.
 */

import { defineControl, type BaselineControl, type ClassifiedState } from './control.js';

export interface SnapshotObservation {
  readonly state: string;
  readonly managedBy?: string;
  readonly publicSnapshotIds: readonly string[];
}

const KNOWN_WEAKER_STATES = ['unblocked', 'block-new-sharing'];

function listIds(ids: readonly string[]): string {
  return ids.length <= 10 ? ids.join(', ') : `${ids.slice(0, 10).join(', ')} and ${ids.length - 10} more`;
}

export function classifySnapshot(observation: SnapshotObservation): ClassifiedState {
  const observed =
    `State=${observation.state}, ManagedBy=${observation.managedBy ?? 'account'}; ` +
    `${observation.publicSnapshotIds.length} public snapshot(s)`;
  if (observation.state === 'block-all-sharing') return { status: 'COMPLIANT', observed, writes: [], reasons: [] };
  if (!KNOWN_WEAKER_STATES.includes(observation.state)) {
    return {
      status: 'REQUIRES_APPROVAL',
      observed,
      writes: [],
      reasons: [`unexpected snapshot BPA state '${observation.state}'`]
    };
  }
  if ((observation.managedBy ?? 'account') !== 'account') {
    return {
      status: 'REQUIRES_APPROVAL',
      observed,
      writes: [],
      reasons: [`snapshot Block Public Access is managed by '${observation.managedBy ?? ''}'; it is never overridden`]
    };
  }
  if (observation.publicSnapshotIds.length > 0) {
    return {
      status: 'REQUIRES_APPROVAL',
      observed,
      writes: [],
      reasons: [
        `public snapshots exist (${listIds(observation.publicSnapshotIds)}); block-all-sharing would make them private, ` +
          'so nothing is changed without approval'
      ]
    };
  }
  return {
    status: 'NON_COMPLIANT',
    observed,
    writes: [{ kind: 'EnableSnapshotBlockPublicAccess', state: 'block-all-sharing' }],
    reasons: ['no public snapshots; block-all-sharing will be enabled']
  };
}

const control: BaselineControl<SnapshotObservation> = {
  id: 'ebs-snapshot-block-public-access',
  title: 'EBS snapshot Block Public Access',
  settle: { attempts: 12, intervalSeconds: 10 },
  required: (context) => `State=${context.controls.ebsSnapshotBlockPublicAccess.state}`,
  read: (port) => {
    const state = port.getSnapshotBlockPublicAccessState();
    return {
      state: state.state,
      ...(state.managedBy === undefined ? {} : { managedBy: state.managedBy }),
      publicSnapshotIds: [...port.listPublicSnapshotIds()]
    };
  },
  classify: (observation) => classifySnapshot(observation),
  invariantProblems: (before, after) =>
    before.state === 'block-all-sharing' && after.state !== 'block-all-sharing'
      ? [`snapshot Block Public Access was block-all-sharing and is now '${after.state}'`]
      : []
};

export const ebsSnapshotBlockPublicAccessControl = defineControl(control);
