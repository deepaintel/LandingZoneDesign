import { describe, expect, it } from 'vitest';

import {
  BASELINE_CONTROLS,
  ebsEncryptionByDefaultControl,
  ebsSnapshotBlockPublicAccessControl,
  ec2ImageBlockPublicAccessControl,
  ec2ImdsDefaultsControl,
  s3AccountPublicAccessBlockControl,
  type ControlContext,
  type RegisteredControl
} from '../lib/account-baseline/controls/index.js';
import { ACCOUNT_BASELINE_CONTROL_IDS } from '../config/schemas/account-baseline-schema.js';
import { AwsCallError, awsErrorCode, classifyAwsFailure } from '../lib/account-baseline/types.js';
import {
  AWS_EBS_KEY_ARN,
  compliantState,
  CUSTOMER_KEY_ARN,
  defaultState,
  FakeMemberAccount,
  loadConfig,
  type FakeAccountState
} from './account-baseline-fakes.js';

/**
 * Planning and classification of each Common Account Security Baseline control against in-memory
 * accounts. Assessment is read-only: no test here may record a write.
 */

const config = loadConfig('staging');
const ACCOUNT = '200000000100';
const context: ControlContext = {
  partition: config.aws.partition,
  region: config.aws.region,
  accountId: ACCOUNT,
  controls: config.accountBaseline.controls
};

function assess(control: RegisteredControl, mutate: (state: FakeAccountState) => void = () => undefined) {
  const state = defaultState();
  mutate(state);
  const account = new FakeMemberAccount(ACCOUNT, state);
  const result = control.assess(account, context);
  expect(account.writes).toEqual([]);
  return { ...result.assessment, account };
}

const OPEN = {
  BlockPublicAcls: false,
  IgnorePublicAcls: false,
  BlockPublicPolicy: false,
  RestrictPublicBuckets: false
};

describe('control registry', () => {
  it('lists exactly the five v1.0 controls in order', () => {
    expect(BASELINE_CONTROLS.map((control) => control.id)).toEqual([...ACCOUNT_BASELINE_CONTROL_IDS]);
  });

  it('every control reads COMPLIANT on a fully compliant account and plans no write', () => {
    for (const control of BASELINE_CONTROLS) {
      const result = control.assess(new FakeMemberAccount(ACCOUNT, compliantState()), context).assessment;
      expect(result.status, control.id).toBe('COMPLIANT');
      expect(result.writes, control.id).toEqual([]);
    }
  });

  it('every control plans a safe enable-only write on a default account', () => {
    for (const control of BASELINE_CONTROLS) {
      const result = control.assess(new FakeMemberAccount(ACCOUNT, defaultState()), context).assessment;
      expect(result.status, control.id).toBe('NON_COMPLIANT');
      expect(result.writes.length, control.id).toBeGreaterThan(0);
    }
  });

  it('maps an unsupported API response to UNSUPPORTED and AccessDenied / timeouts to ERROR, for every control', () => {
    const readers: Record<string, keyof FakeMemberAccount> = {
      's3-account-public-access-block': 'getAccountPublicAccessBlock',
      'ebs-encryption-by-default': 'getEbsEncryptionByDefault',
      'ec2-imds-defaults': 'getInstanceMetadataDefaults',
      'ebs-snapshot-block-public-access': 'getSnapshotBlockPublicAccessState',
      'ec2-image-block-public-access': 'getImageBlockPublicAccessState'
    };
    for (const control of BASELINE_CONTROLS) {
      const reader = readers[control.id] as keyof FakeMemberAccount;
      for (const [error, status] of [
        [new AwsCallError('op', 'UnsupportedOperation', 'unsupported', 'not available in this Region'), 'UNSUPPORTED'],
        [new AwsCallError('op', 'InvalidAction', 'unsupported', 'unknown action'), 'UNSUPPORTED'],
        [new AwsCallError('op', 'AccessDenied', 'access-denied', 'denied by SCP'), 'ERROR'],
        [new AwsCallError('op', undefined, 'timeout', 'Read timeout'), 'ERROR'],
        [new Error('malformed response'), 'ERROR']
      ] as const) {
        const account = new FakeMemberAccount(ACCOUNT, defaultState());
        account.failures.set(reader as never, error as AwsCallError);
        const result = control.assess(account, context).assessment;
        expect(result.status, `${control.id} ${error.message}`).toBe(status);
        expect(result.writes).toEqual([]);
        expect(result.reasons.join(' ')).toContain(error.message);
      }
    }
  });
});

describe('AWS error classification', () => {
  it('extracts codes from AWS CLI stderr and classifies them', () => {
    const stderr =
      'An error occurred (UnsupportedOperation) when calling the GetInstanceMetadataDefaults operation: nope';
    expect(awsErrorCode(stderr)).toBe('UnsupportedOperation');
    expect(classifyAwsFailure('UnsupportedOperation', stderr)).toBe('unsupported');
    expect(classifyAwsFailure('UnauthorizedOperation', '')).toBe('access-denied');
    expect(classifyAwsFailure('RequestLimitExceeded', '')).toBe('throttled');
    expect(classifyAwsFailure(undefined, 'aws: error: argument operation: Invalid choice')).toBe('unsupported');
    expect(classifyAwsFailure(undefined, 'Read timeout on endpoint URL')).toBe('timeout');
  });
});

describe('Control 1 - S3 account-level Block Public Access', () => {
  it('is COMPLIANT with all four settings and does not inventory buckets', () => {
    const result = assess(s3AccountPublicAccessBlockControl, (state) => {
      state.s3 = compliantState().s3;
      state.buckets = [{ name: 'public', policyIsPublic: true }];
    });
    expect(result.status).toBe('COMPLIANT');
  });

  it('enables only missing settings: one put with all four true, never false', () => {
    const result = assess(s3AccountPublicAccessBlockControl, (state) => {
      state.s3 = { ...OPEN, BlockPublicAcls: true };
    });
    expect(result.status).toBe('NON_COMPLIANT');
    expect(result.writes).toEqual([
      {
        kind: 'PutAccountPublicAccessBlock',
        configuration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true
        }
      }
    ]);
  });

  it('treats "not configured" as all settings false', () => {
    expect(assess(s3AccountPublicAccessBlockControl).status).toBe('NON_COMPLIANT');
  });

  it('blocks a public bucket policy that RestrictPublicBuckets would cut (including its cross-account access)', () => {
    const result = assess(s3AccountPublicAccessBlockControl, (state) => {
      state.buckets = [{ name: 'shared-logs', policyIsPublic: true, objectOwnership: 'BucketOwnerEnforced' }];
    });
    expect(result.status).toBe('REQUIRES_APPROVAL');
    expect(result.writes).toEqual([]);
    expect(result.reasons.join(' ')).toMatch(/shared-logs.*public bucket policy.*cross-account/);
  });

  it('accepts a non-public cross-account bucket policy', () => {
    const result = assess(s3AccountPublicAccessBlockControl, (state) => {
      state.buckets = [{ name: 'org-shared', policyIsPublic: false, objectOwnership: 'BucketOwnerEnforced' }];
    });
    expect(result.status).toBe('NON_COMPLIANT');
  });

  it('accepts a public policy that a bucket-level RestrictPublicBuckets already neutralizes', () => {
    const result = assess(s3AccountPublicAccessBlockControl, (state) => {
      state.buckets = [
        {
          name: 'already-restricted',
          policyIsPublic: true,
          objectOwnership: 'BucketOwnerEnforced',
          block: { ...OPEN, RestrictPublicBuckets: true }
        }
      ];
    });
    expect(result.status).toBe('NON_COMPLIANT');
  });

  it('blocks public ACL grants and ACL-enabled buckets whose object ACLs cannot be verified', () => {
    const acl = assess(s3AccountPublicAccessBlockControl, (state) => {
      state.buckets = [
        {
          name: 'acl-public',
          objectOwnership: 'BucketOwnerPreferred',
          grants: [{ granteeUri: 'http://acs.amazonaws.com/groups/global/AllUsers', permission: 'READ' }]
        }
      ];
    });
    expect(acl.status).toBe('REQUIRES_APPROVAL');
    expect(acl.reasons.join(' ')).toMatch(/public ACL/);
    const ambiguous = assess(s3AccountPublicAccessBlockControl, (state) => {
      state.buckets = [{ name: 'legacy', grants: [] }];
    });
    expect(ambiguous.status).toBe('REQUIRES_APPROVAL');
    expect(ambiguous.reasons.join(' ')).toMatch(/ACLs enabled/);
  });

  it('blocks public access points and buckets outside the home Region', () => {
    expect(
      assess(s3AccountPublicAccessBlockControl, (state) => {
        state.accessPoints = [{ name: 'ap-public', policyIsPublic: true }];
      }).status
    ).toBe('REQUIRES_APPROVAL');
    expect(
      assess(s3AccountPublicAccessBlockControl, (state) => {
        state.buckets = [{ name: 'elsewhere', region: 'other-region-1' }];
      }).reasons.join(' ')
    ).toMatch(/cannot be assessed/);
  });

  it('reports a setting that was on and is now off as an invariant violation', () => {
    expect(
      s3AccountPublicAccessBlockControl.invariantProblems(
        { account: compliantState().s3, inventoried: false, buckets: [], accessPoints: [] },
        { account: { ...OPEN, BlockPublicAcls: true }, inventoried: true, buckets: [], accessPoints: [] }
      )
    ).toHaveLength(3);
  });
});

describe('Control 2 - EBS encryption by default', () => {
  it('enables encryption with the AWS managed alias without calling KMS', () => {
    const result = assess(ebsEncryptionByDefaultControl);
    expect(result.status).toBe('NON_COMPLIANT');
    expect(result.writes).toEqual([{ kind: 'EnableEbsEncryptionByDefault' }]);
  });

  it('is COMPLIANT when enabled with the AWS managed key', () => {
    expect(assess(ebsEncryptionByDefaultControl, (state) => (state.ebsEnabled = true)).status).toBe('COMPLIANT');
  });

  it('recognizes the AWS managed aws/ebs key returned as an ARN', () => {
    const result = assess(ebsEncryptionByDefaultControl, (state) => {
      state.ebsKeyId = AWS_EBS_KEY_ARN;
      state.keys[AWS_EBS_KEY_ARN] = {
        arn: AWS_EBS_KEY_ARN,
        keyManager: 'AWS',
        keyState: 'Enabled',
        aliases: ['alias/aws/ebs']
      };
    });
    expect(result.status).toBe('NON_COMPLIANT');
  });

  it('preserves an unapproved customer managed key: REQUIRES_APPROVAL, no write, enabled or not', () => {
    for (const enabled of [true, false]) {
      const result = assess(ebsEncryptionByDefaultControl, (state) => {
        state.ebsEnabled = enabled;
        state.ebsKeyId = CUSTOMER_KEY_ARN;
        state.keys[CUSTOMER_KEY_ARN] = {
          arn: CUSTOMER_KEY_ARN,
          keyManager: 'CUSTOMER',
          keyState: 'Enabled',
          aliases: []
        };
      });
      expect(result.status).toBe('REQUIRES_APPROVAL');
      expect(result.writes).toEqual([]);
      expect(result.reasons.join(' ')).toMatch(/preserved/);
    }
  });

  it('blocks a disabled or pending-deletion key and a non-symmetric key', () => {
    for (const keyState of ['Disabled', 'PendingDeletion']) {
      const result = assess(ebsEncryptionByDefaultControl, (state) => {
        state.ebsKeyId = CUSTOMER_KEY_ARN;
        state.keys[CUSTOMER_KEY_ARN] = { arn: CUSTOMER_KEY_ARN, keyManager: 'CUSTOMER', keyState, aliases: [] };
      });
      expect(result.status).toBe('REQUIRES_APPROVAL');
    }
    const asymmetric = assess(ebsEncryptionByDefaultControl, (state) => {
      state.ebsKeyId = CUSTOMER_KEY_ARN;
      state.keys[CUSTOMER_KEY_ARN] = {
        arn: CUSTOMER_KEY_ARN,
        keyManager: 'CUSTOMER',
        keyState: 'Enabled',
        keySpec: 'RSA_2048',
        aliases: []
      };
    });
    expect(asymmetric.status).toBe('REQUIRES_APPROVAL');
  });

  it('is ERROR for an inaccessible or unrecognized key', () => {
    const missing = assess(ebsEncryptionByDefaultControl, (state) => (state.ebsKeyId = CUSTOMER_KEY_ARN));
    expect(missing.status).toBe('ERROR');
    const foreign = assess(
      ebsEncryptionByDefaultControl,
      (state) => (state.ebsKeyId = 'arn:aws-eusc:kms:elsewhere-1:200000000001:key/abc')
    );
    expect(foreign.status).toBe('ERROR');
    expect(foreign.reasons.join(' ')).toMatch(/not a recognized/);
    const state = defaultState();
    state.ebsKeyId = CUSTOMER_KEY_ARN;
    const account = new FakeMemberAccount(ACCOUNT, state);
    account.failures.set(
      'describeKmsKey',
      new AwsCallError(
        'kms describe-key',
        'AccessDeniedException',
        'access-denied',
        'not authorized to describe the key'
      )
    );
    const denied = ebsEncryptionByDefaultControl.assess(account, context).assessment;
    expect(denied.status).toBe('ERROR');
    expect(denied.reasons.join(' ')).toMatch(/AccessDeniedException/);
    expect(account.writes).toEqual([]);
  });

  it('detects any change of the default KMS key between two observations', () => {
    expect(
      ebsEncryptionByDefaultControl.invariantProblems(
        { enabled: false, kmsKeyId: 'alias/aws/ebs', key: { kind: 'aws-managed-alias' } },
        { enabled: true, kmsKeyId: CUSTOMER_KEY_ARN, key: { kind: 'unrecognized' } }
      )
    ).toEqual([`default EBS KMS key changed from 'alias/aws/ebs' to '${CUSTOMER_KEY_ARN}'`]);
  });
});

describe('Control 3 - EC2 IMDSv2 account defaults', () => {
  it('sets each unset field with its own call', () => {
    const result = assess(ec2ImdsDefaultsControl);
    expect(result.writes).toEqual([
      { kind: 'ModifyInstanceMetadataDefaults', field: 'HttpTokens', value: 'required' },
      { kind: 'ModifyInstanceMetadataDefaults', field: 'HttpPutResponseHopLimit', value: 2 }
    ]);
  });

  it('updates only the field that is still unset and preserves the other', () => {
    const tokensOnly = assess(ec2ImdsDefaultsControl, (state) => (state.imds = { HttpPutResponseHopLimit: 2 }));
    expect(tokensOnly.writes).toEqual([
      { kind: 'ModifyInstanceMetadataDefaults', field: 'HttpTokens', value: 'required' }
    ]);
    const hopOnly = assess(
      ec2ImdsDefaultsControl,
      (state) => (state.imds = { HttpTokens: 'required', HttpPutResponseHopLimit: -1 })
    );
    expect(hopOnly.writes).toEqual([
      { kind: 'ModifyInstanceMetadataDefaults', field: 'HttpPutResponseHopLimit', value: 2 }
    ]);
    const noPreference = assess(ec2ImdsDefaultsControl, (state) => (state.imds = { HttpTokens: 'no-preference' }));
    expect(noPreference.writes).toHaveLength(2);
  });

  it('never overwrites an explicit conflicting setting', () => {
    for (const imds of [
      { HttpTokens: 'optional' },
      { HttpPutResponseHopLimit: 1 },
      { HttpTokens: 'optional', HttpPutResponseHopLimit: 3 }
    ]) {
      const result = assess(ec2ImdsDefaultsControl, (state) => (state.imds = imds));
      expect(result.status).toBe('REQUIRES_APPROVAL');
      expect(result.writes).toEqual([]);
    }
  });

  it('never writes settings managed by a declarative policy', () => {
    const compliant = assess(ec2ImdsDefaultsControl, (state) => {
      state.imds = { HttpTokens: 'required', HttpPutResponseHopLimit: 2, ManagedBy: 'declarative-policy' };
    });
    expect(compliant.status).toBe('COMPLIANT');
    const differs = assess(ec2ImdsDefaultsControl, (state) => (state.imds = { ManagedBy: 'declarative-policy' }));
    expect(differs.status).toBe('REQUIRES_APPROVAL');
    expect(differs.writes).toEqual([]);
  });

  it('flags fields it does not own changing, and owned explicit fields changing', () => {
    expect(
      ec2ImdsDefaultsControl.invariantProblems({ HttpEndpoint: 'enabled' }, { HttpEndpoint: 'disabled' })
    ).toHaveLength(1);
    expect(
      ec2ImdsDefaultsControl.invariantProblems({ HttpTokens: 'required' }, { HttpTokens: 'optional' })
    ).toHaveLength(1);
    expect(
      ec2ImdsDefaultsControl.invariantProblems({}, { HttpTokens: 'required', HttpPutResponseHopLimit: 2 })
    ).toEqual([]);
  });
});

describe('Control 4 - EBS snapshot Block Public Access', () => {
  it('enables block-all-sharing when no snapshot is public', () => {
    for (const current of ['unblocked', 'block-new-sharing']) {
      const result = assess(ebsSnapshotBlockPublicAccessControl, (state) => (state.snapshot = { state: current }));
      expect(result.writes).toEqual([{ kind: 'EnableSnapshotBlockPublicAccess', state: 'block-all-sharing' }]);
    }
  });

  it('blocks on public snapshots and never falls back to block-new-sharing', () => {
    const result = assess(
      ebsSnapshotBlockPublicAccessControl,
      (state) => (state.publicSnapshots = ['snap-0123456789abcdef0'])
    );
    expect(result.status).toBe('REQUIRES_APPROVAL');
    expect(result.writes).toEqual([]);
  });

  it('keeps block-all-sharing, never downgrades, and treats public-flagged snapshots as already private', () => {
    const result = assess(ebsSnapshotBlockPublicAccessControl, (state) => {
      state.snapshot = { state: 'block-all-sharing' };
      state.publicSnapshots = ['snap-0123456789abcdef0'];
    });
    expect(result.status).toBe('COMPLIANT');
    expect(
      ebsSnapshotBlockPublicAccessControl.invariantProblems(
        { state: 'block-all-sharing', publicSnapshotIds: [] },
        { state: 'block-new-sharing', publicSnapshotIds: [] }
      )
    ).toHaveLength(1);
  });

  it('blocks unexpected states and declarative-policy management', () => {
    expect(assess(ebsSnapshotBlockPublicAccessControl, (state) => (state.snapshot = { state: 'mystery' })).status).toBe(
      'REQUIRES_APPROVAL'
    );
    expect(
      assess(
        ebsSnapshotBlockPublicAccessControl,
        (state) => (state.snapshot = { state: 'unblocked', managedBy: 'declarative-policy' })
      ).status
    ).toBe('REQUIRES_APPROVAL');
  });
});

describe('Control 5 - AMI Block Public Access', () => {
  it('enables block-new-sharing when no AMI is public', () => {
    expect(assess(ec2ImageBlockPublicAccessControl).writes).toEqual([
      { kind: 'EnableImageBlockPublicAccess', state: 'block-new-sharing' }
    ]);
  });

  it('blocks on public AMIs in every state and never touches launch permissions', () => {
    for (const current of ['unblocked', 'block-new-sharing']) {
      const result = assess(ec2ImageBlockPublicAccessControl, (state) => {
        state.image = { state: current };
        state.publicImages = ['ami-0123456789abcdef0'];
      });
      expect(result.status).toBe('REQUIRES_APPROVAL');
      expect(result.writes).toEqual([]);
    }
  });

  it('blocks unexpected states and declarative-policy management', () => {
    expect(
      assess(ec2ImageBlockPublicAccessControl, (state) => (state.image = { state: 'block-all-sharing' })).status
    ).toBe('REQUIRES_APPROVAL');
    expect(
      assess(
        ec2ImageBlockPublicAccessControl,
        (state) => (state.image = { state: 'unblocked', managedBy: 'declarative-policy' })
      ).status
    ).toBe('REQUIRES_APPROVAL');
  });
});
