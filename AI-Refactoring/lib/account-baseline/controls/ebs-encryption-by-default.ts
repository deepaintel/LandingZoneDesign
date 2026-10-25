/**
 * Control 2 - EBS encryption by default in the home Region, default KMS key preserved.
 *
 * Reads `GetEbsEncryptionByDefault` and `GetEbsDefaultKmsKeyId`. The default key is validated but
 * NEVER changed: `EnableEbsEncryptionByDefault` does not modify the default key, and
 * `ModifyEbsDefaultKmsKeyId` / `ResetEbsDefaultKmsKeyId` / `DisableEbsEncryptionByDefault` are not
 * representable writes. Existing volumes, snapshots and instances are unaffected (EC2 API reference,
 * EnableEbsEncryptionByDefault).
 *
 * Key validation:
 *  - `alias/aws/ebs` is the AWS managed key and is accepted without a KMS call;
 *  - any other identifier is described with `kms:DescribeKey`. An AWS managed key carrying the
 *    `alias/aws/ebs` alias counts as the AWS managed key; anything else is a customer managed key;
 *  - only keys listed in `approvedDefaultKmsKeys` are approved. v1.0 approves `alias/aws/ebs` only;
 *  - a key that is not `Enabled`, or not symmetric, is REQUIRES_APPROVAL; an identifier that is not
 *    an `aws-eusc` KMS key in the home Region is ERROR; an unreadable key (AccessDenied, NotFound) is
 *    ERROR through the control framework.
 *
 * Enabling happens only while the setting is disabled AND the configured key is approved.
 */

import { AWS_MANAGED_EBS_KEY_ALIAS } from '../../../config/schemas/account-baseline-schema.js';
import type { KmsKeyDetails } from '../ports.js';
import { defineControl, type BaselineControl, type ClassifiedState, type ControlContext } from './control.js';

export type EbsDefaultKey =
  | { readonly kind: 'aws-managed-alias' }
  | { readonly kind: 'described'; readonly details: KmsKeyDetails }
  | { readonly kind: 'unrecognized' };

export interface EbsObservation {
  readonly enabled: boolean;
  readonly kmsKeyId: string;
  readonly key: EbsDefaultKey;
}

/** KMS key identifiers this control will describe: a home-Region aws-eusc ARN, an alias or a key ID. */
export function isRecognizedKmsKeyId(keyId: string, region: string): boolean {
  const escapedRegion = region.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    new RegExp(`^arn:aws-eusc:kms:${escapedRegion}:[0-9]{12}:(key/[A-Za-z0-9-]+|alias/[A-Za-z0-9/_-]+)$`).test(keyId) ||
    /^alias\/[A-Za-z0-9/_-]+$/.test(keyId) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(keyId)
  );
}

function keyLabel(observation: EbsObservation): string {
  switch (observation.key.kind) {
    case 'aws-managed-alias':
      return `${AWS_MANAGED_EBS_KEY_ALIAS} (AWS managed)`;
    case 'described':
      return `${observation.kmsKeyId} (${observation.key.details.keyManager} managed, ${observation.key.details.keyState})`;
    case 'unrecognized':
      return `${observation.kmsKeyId} (unrecognized)`;
  }
}

function isAwsManagedEbsKey(observation: EbsObservation): boolean {
  if (observation.key.kind === 'aws-managed-alias') return true;
  return (
    observation.key.kind === 'described' &&
    observation.key.details.keyManager === 'AWS' &&
    observation.key.details.aliases.includes(AWS_MANAGED_EBS_KEY_ALIAS)
  );
}

export function classifyEbs(observation: EbsObservation, context: ControlContext): ClassifiedState {
  const observed = `EbsEncryptionByDefault=${String(observation.enabled)}; default KMS key ${keyLabel(observation)}`;
  const approved = context.controls.ebsEncryptionByDefault.approvedDefaultKmsKeys as readonly string[];

  if (observation.key.kind === 'unrecognized') {
    return {
      status: 'ERROR',
      observed,
      writes: [],
      reasons: [
        `default EBS KMS key '${observation.kmsKeyId}' is not a recognized aws-eusc KMS key in ${context.region}`
      ]
    };
  }
  if (observation.key.kind === 'described') {
    const details = observation.key.details;
    if (details.keyState !== 'Enabled') {
      return {
        status: 'REQUIRES_APPROVAL',
        observed,
        writes: [],
        reasons: [
          `default EBS KMS key ${details.arn} is ${details.keyState}; EC2 launches with encrypted volumes would fail`
        ]
      };
    }
    if (details.keySpec !== undefined && details.keySpec !== 'SYMMETRIC_DEFAULT') {
      return {
        status: 'REQUIRES_APPROVAL',
        observed,
        writes: [],
        reasons: [`default EBS KMS key ${details.arn} is ${details.keySpec}; EBS requires a symmetric key`]
      };
    }
  }

  const keyApproved = isAwsManagedEbsKey(observation)
    ? approved.includes(AWS_MANAGED_EBS_KEY_ALIAS)
    : observation.key.kind === 'described' &&
      (approved.includes(observation.key.details.arn) || approved.includes(observation.kmsKeyId));

  if (!keyApproved) {
    return {
      status: 'REQUIRES_APPROVAL',
      observed,
      writes: [],
      reasons: [
        `default EBS KMS key ${keyLabel(observation)} is not an approved default key ` +
          `(approved: ${approved.join(', ')}); the key is preserved and nothing is changed`
      ]
    };
  }
  if (observation.enabled) return { status: 'COMPLIANT', observed, writes: [], reasons: [] };
  return {
    status: 'NON_COMPLIANT',
    observed,
    writes: [{ kind: 'EnableEbsEncryptionByDefault' }],
    reasons: ['encryption by default will be enabled; the default KMS key stays unchanged']
  };
}

const control: BaselineControl<EbsObservation> = {
  id: 'ebs-encryption-by-default',
  title: 'EBS encryption by default',
  settle: { attempts: 12, intervalSeconds: 5 },
  required: (context) =>
    `EbsEncryptionByDefault=true; default KMS key unchanged and approved (${context.controls.ebsEncryptionByDefault.approvedDefaultKmsKeys.join(', ')})`,
  read: (port, context) => {
    const enabled = port.getEbsEncryptionByDefault();
    const kmsKeyId = port.getEbsDefaultKmsKeyId();
    if (kmsKeyId === AWS_MANAGED_EBS_KEY_ALIAS) return { enabled, kmsKeyId, key: { kind: 'aws-managed-alias' } };
    if (!isRecognizedKmsKeyId(kmsKeyId, context.region)) return { enabled, kmsKeyId, key: { kind: 'unrecognized' } };
    return { enabled, kmsKeyId, key: { kind: 'described', details: port.describeKmsKey(kmsKeyId) } };
  },
  classify: classifyEbs,
  invariantProblems: (before, after) =>
    before.kmsKeyId === after.kmsKeyId
      ? []
      : [`default EBS KMS key changed from '${before.kmsKeyId}' to '${after.kmsKeyId}'`]
};

export const ebsEncryptionByDefaultControl = defineControl(control);
