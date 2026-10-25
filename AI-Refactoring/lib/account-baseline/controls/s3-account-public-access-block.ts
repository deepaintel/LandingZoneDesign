/**
 * Control 1 - S3 account-level Block Public Access (all four settings true).
 *
 * Reads `s3control GetPublicAccessBlock` for the account. When any setting is still false, the
 * account's buckets and access points are inventoried first, because turning a setting on changes
 * existing access immediately:
 *  - `RestrictPublicBuckets` limits a bucket or access point with a PUBLIC policy to AWS service
 *    principals and the owner account, which also removes cross-account access granted by that
 *    policy (AWS S3 user guide, "Blocking public access to your Amazon S3 storage");
 *  - `IgnorePublicAcls` ignores public bucket and object ACLs.
 * Non-public policies (specific accounts, `aws:PrincipalOrgID`, `aws:SourceArn`, fixed service
 * principals) are unaffected, so authorized private cross-account access is preserved.
 *
 * Any public or unverifiable exposure that a missing setting would cut is REQUIRES_APPROVAL, and no
 * write is planned. Object ACLs cannot be verified without listing every object, so a bucket with
 * ACLs enabled (object ownership other than `BucketOwnerEnforced`) and no bucket-level
 * `IgnorePublicAcls` is treated as ambiguous. The single write sets all four settings to true: it
 * can only turn missing protections on, never off. Bucket policies, ACLs and access-point policies
 * are never modified.
 */

import type { MemberAccountPort } from '../ports.js';
import { ALL_S3_PUBLIC_ACCESS_BLOCKS, type S3PublicAccessBlockConfiguration } from '../types.js';
import { defineControl, type BaselineControl } from './control.js';

const PUBLIC_GRANTEE_URIS = [
  'http://acs.amazonaws.com/groups/global/AllUsers',
  'http://acs.amazonaws.com/groups/global/AuthenticatedUsers'
];

const NONE: S3PublicAccessBlockConfiguration = {
  BlockPublicAcls: false,
  IgnorePublicAcls: false,
  BlockPublicPolicy: false,
  RestrictPublicBuckets: false
};

export interface BucketExposure {
  readonly name: string;
  /** Set when the bucket is outside the home Region and could not be inspected. */
  readonly outOfRegion?: string;
  readonly policyIsPublic?: boolean;
  readonly publicAclGrants: readonly string[];
  readonly objectOwnership?: string;
  readonly bucketBlock?: S3PublicAccessBlockConfiguration;
}

export interface AccessPointExposure {
  readonly name: string;
  readonly policyIsPublic?: boolean;
  readonly block?: S3PublicAccessBlockConfiguration;
}

export interface S3Observation {
  /** `undefined` when the account has no Block Public Access configuration (all settings false). */
  readonly account?: S3PublicAccessBlockConfiguration;
  /** False when the account is already compliant and no inventory was needed. */
  readonly inventoried: boolean;
  readonly buckets: readonly BucketExposure[];
  readonly accessPoints: readonly AccessPointExposure[];
}

export function allBlocked(configuration: S3PublicAccessBlockConfiguration | undefined): boolean {
  return (
    configuration !== undefined &&
    configuration.BlockPublicAcls === true &&
    configuration.IgnorePublicAcls === true &&
    configuration.BlockPublicPolicy === true &&
    configuration.RestrictPublicBuckets === true
  );
}

export function describeBlock(configuration: S3PublicAccessBlockConfiguration | undefined): string {
  if (configuration === undefined) return 'not configured (all four settings false)';
  return (
    `BlockPublicAcls=${String(configuration.BlockPublicAcls)}, IgnorePublicAcls=${String(configuration.IgnorePublicAcls)}, ` +
    `BlockPublicPolicy=${String(configuration.BlockPublicPolicy)}, RestrictPublicBuckets=${String(configuration.RestrictPublicBuckets)}`
  );
}

export function readS3Observation(port: MemberAccountPort, region: string): S3Observation {
  const account = port.getAccountPublicAccessBlock();
  if (allBlocked(account)) return { account, inventoried: false, buckets: [], accessPoints: [] };

  const buckets: BucketExposure[] = port.listBuckets().map((bucket) => {
    if (bucket.region !== undefined && bucket.region !== region) {
      return { name: bucket.name, outOfRegion: bucket.region, publicAclGrants: [] };
    }
    const grants = port
      .getBucketAcl(bucket.name)
      .filter((grant) => grant.granteeUri !== undefined && PUBLIC_GRANTEE_URIS.includes(grant.granteeUri))
      .map((grant) => `${grant.granteeUri ?? ''}:${grant.permission ?? ''}`);
    const policyIsPublic = port.getBucketPolicyStatus(bucket.name);
    const objectOwnership = port.getBucketObjectOwnership(bucket.name);
    const bucketBlock = port.getBucketPublicAccessBlock(bucket.name);
    return {
      name: bucket.name,
      publicAclGrants: grants,
      ...(policyIsPublic === undefined ? {} : { policyIsPublic }),
      ...(objectOwnership === undefined ? {} : { objectOwnership }),
      ...(bucketBlock === undefined ? {} : { bucketBlock })
    };
  });
  const accessPoints: AccessPointExposure[] = port.listAccessPoints().map((name) => {
    const policyIsPublic = port.getAccessPointPolicyStatus(name);
    const block = port.getAccessPoint(name).publicAccessBlock;
    return {
      name,
      ...(policyIsPublic === undefined ? {} : { policyIsPublic }),
      ...(block === undefined ? {} : { block })
    };
  });
  return { ...(account === undefined ? {} : { account }), inventoried: true, buckets, accessPoints };
}

/** Exposures a missing account setting would change. Pure. */
export function s3ExposureConflicts(observation: S3Observation, region: string): string[] {
  const current = observation.account ?? NONE;
  const conflicts: string[] = [];
  for (const bucket of observation.buckets) {
    if (bucket.outOfRegion !== undefined) {
      conflicts.push(
        `bucket '${bucket.name}' is in Region ${bucket.outOfRegion} and cannot be assessed from ${region}`
      );
      continue;
    }
    const restricted = current.RestrictPublicBuckets || bucket.bucketBlock?.RestrictPublicBuckets === true;
    const aclsIgnored = current.IgnorePublicAcls || bucket.bucketBlock?.IgnorePublicAcls === true;
    if (bucket.policyIsPublic === true && !restricted) {
      conflicts.push(
        `bucket '${bucket.name}' has a public bucket policy; RestrictPublicBuckets would remove its public and cross-account access`
      );
    }
    if (bucket.publicAclGrants.length > 0 && !aclsIgnored) {
      conflicts.push(`bucket '${bucket.name}' grants public ACL access (${bucket.publicAclGrants.join(', ')})`);
    }
    if (bucket.objectOwnership !== 'BucketOwnerEnforced' && !aclsIgnored) {
      conflicts.push(
        `bucket '${bucket.name}' has ACLs enabled (object ownership ${bucket.objectOwnership ?? 'not set'}); ` +
          'public object ACLs cannot be ruled out, so IgnorePublicAcls could change existing access'
      );
    }
  }
  for (const accessPoint of observation.accessPoints) {
    const restricted = current.RestrictPublicBuckets || accessPoint.block?.RestrictPublicBuckets === true;
    if (accessPoint.policyIsPublic === true && !restricted) {
      conflicts.push(`access point '${accessPoint.name}' has a public policy; RestrictPublicBuckets would restrict it`);
    }
  }
  return conflicts;
}

const control: BaselineControl<S3Observation> = {
  id: 's3-account-public-access-block',
  title: 'S3 account-level Block Public Access',
  settle: { attempts: 12, intervalSeconds: 10 },
  required: () => describeBlock(ALL_S3_PUBLIC_ACCESS_BLOCKS),
  read: (port, context) => readS3Observation(port, context.region),
  classify: (observation, context) => {
    const observed = describeBlock(observation.account);
    if (allBlocked(observation.account)) {
      return { status: 'COMPLIANT', observed, writes: [], reasons: [] };
    }
    const inventory = `${observation.buckets.length} bucket(s) and ${observation.accessPoints.length} access point(s) inspected`;
    const conflicts = s3ExposureConflicts(observation, context.region);
    if (conflicts.length > 0) {
      return { status: 'REQUIRES_APPROVAL', observed: `${observed}; ${inventory}`, writes: [], reasons: conflicts };
    }
    return {
      status: 'NON_COMPLIANT',
      observed: `${observed}; ${inventory}, none public`,
      writes: [{ kind: 'PutAccountPublicAccessBlock', configuration: ALL_S3_PUBLIC_ACCESS_BLOCKS }],
      reasons: ['missing account-level Block Public Access settings will be enabled']
    };
  },
  invariantProblems: (before, after) => {
    // A setting that was on must stay on.
    const problems: string[] = [];
    for (const key of Object.keys(ALL_S3_PUBLIC_ACCESS_BLOCKS) as (keyof S3PublicAccessBlockConfiguration)[]) {
      if (before.account?.[key] === true && after.account?.[key] !== true) {
        problems.push(`S3 account setting ${key} was true and is no longer true`);
      }
    }
    return problems;
  }
};

export const s3AccountPublicAccessBlockControl = defineControl(control);
