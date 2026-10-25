/**
 * The v1.0 control registry, in `ACCOUNT_BASELINE_CONTROL_IDS` order (plan, apply and report order).
 */

import { ACCOUNT_BASELINE_CONTROL_IDS } from '../../../config/schemas/account-baseline-schema.js';
import type { RegisteredControl } from './control.js';
import { ebsEncryptionByDefaultControl } from './ebs-encryption-by-default.js';
import { ebsSnapshotBlockPublicAccessControl } from './ebs-snapshot-block-public-access.js';
import { ec2ImageBlockPublicAccessControl } from './ec2-image-block-public-access.js';
import { ec2ImdsDefaultsControl } from './ec2-imds-defaults.js';
import { s3AccountPublicAccessBlockControl } from './s3-account-public-access-block.js';

export const BASELINE_CONTROLS: readonly RegisteredControl[] = [
  s3AccountPublicAccessBlockControl,
  ebsEncryptionByDefaultControl,
  ec2ImdsDefaultsControl,
  ebsSnapshotBlockPublicAccessControl,
  ec2ImageBlockPublicAccessControl
];

if (BASELINE_CONTROLS.map((control) => control.id).join(',') !== ACCOUNT_BASELINE_CONTROL_IDS.join(',')) {
  throw new Error('BASELINE_CONTROLS must list exactly ACCOUNT_BASELINE_CONTROL_IDS, in order.');
}

export function controlById(id: string): RegisteredControl {
  const control = BASELINE_CONTROLS.find((candidate) => candidate.id === id);
  if (control === undefined) throw new Error(`unknown account baseline control '${id}'.`);
  return control;
}

export * from './control.js';
export {
  ebsEncryptionByDefaultControl,
  ebsSnapshotBlockPublicAccessControl,
  ec2ImageBlockPublicAccessControl,
  ec2ImdsDefaultsControl,
  s3AccountPublicAccessBlockControl
};
