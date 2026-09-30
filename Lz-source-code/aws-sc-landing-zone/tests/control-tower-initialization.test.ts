import { describe, expect, it } from 'vitest';

import { classifyOperationStatus, pollOperationUntilTerminal } from '../scripts/initialize-control-tower.js';
import {
  canonicaliseManifestForComparison,
  compareManifests,
  formatDiscoveryCounts,
  isControlTowerLoggingBucket
} from '../scripts/postinit-control-tower.js';
import { assertScpCompatibilityMarkers, validateSharedAccountId } from '../scripts/preinit-control-tower.js';

describe('classifyOperationStatus', () => {
  it('recognises SUCCEEDED and IN_PROGRESS as themselves', () => {
    expect(classifyOperationStatus({ operationDetails: { status: 'SUCCEEDED' } })).toBe('SUCCEEDED');
    expect(classifyOperationStatus({ operationDetails: { status: 'IN_PROGRESS' } })).toBe('IN_PROGRESS');
  });

  it('treats any other status (including unknown) as FAILED - unknown is never success', () => {
    expect(classifyOperationStatus({ operationDetails: { status: 'FAILED' } })).toBe('FAILED');
    expect(classifyOperationStatus({ operationDetails: { status: 'CANCELLED' } })).toBe('FAILED');
    expect(classifyOperationStatus({ operationDetails: {} })).toBe('FAILED');
    expect(classifyOperationStatus({})).toBe('FAILED');
  });
});

describe('pollOperationUntilTerminal', () => {
  it('returns the first terminal status the fetch reports', async () => {
    let call = 0;
    const outcome = await pollOperationUntilTerminal('op-1', 0.001, 1, () => {
      call += 1;
      return { operationDetails: { status: call === 1 ? 'IN_PROGRESS' : 'SUCCEEDED' } };
    });
    expect(outcome.status).toBe('SUCCEEDED');
    expect(call).toBe(2);
  });

  it('classifies a FAILED response as FAILED and stops polling', async () => {
    const outcome = await pollOperationUntilTerminal('op-2', 0.001, 1, () => ({
      operationDetails: { status: 'FAILED', statusMessage: 'nope' }
    }));
    expect(outcome.status).toBe('FAILED');
    expect(outcome.response.operationDetails?.statusMessage).toBe('nope');
  });
});

describe('canonicaliseManifestForComparison', () => {
  it('sorts keys and strips AWS metadata', () => {
    const raw = {
      backup: { enabled: false },
      centralizedLogging: { enabled: true, accountId: '000000000001', createdTime: '2024-01-01' },
      identifier: 'lz-123',
      driftStatus: { status: 'IN_SYNC' },
      governedRegions: ['eusc-de-east-1']
    };
    const canonical = canonicaliseManifestForComparison(raw) as Record<string, unknown>;
    expect(Object.keys(canonical)).toEqual(['backup', 'centralizedLogging', 'governedRegions']);
    expect(canonical['centralizedLogging']).toEqual({ accountId: '000000000001', enabled: true });
  });
});

describe('compareManifests', () => {
  it('returns an empty list when material fields match despite metadata noise', () => {
    const expected = {
      governedRegions: ['eusc-de-east-1'],
      centralizedLogging: { accountId: '111', enabled: true },
      config: { accountId: '222', enabled: true },
      securityRoles: { accountId: '222', enabled: true },
      accessManagement: { enabled: true },
      backup: { enabled: false }
    };
    const deployed = {
      ...expected,
      identifier: 'lz-arn',
      driftStatus: { status: 'IN_SYNC' },
      createdTime: '2024-06-01'
    };
    expect(compareManifests(expected, deployed)).toEqual([]);
  });

  it('flags a material difference in accountId', () => {
    const expected = { config: { accountId: '111', enabled: true } };
    const deployed = { config: { accountId: '222', enabled: true } };
    expect(compareManifests(expected, deployed)).toHaveLength(1);
  });
});

describe('isControlTowerLoggingBucket', () => {
  const LZ_ARN = 'arn:aws-eusc:controltower:eusc-de-east-1:123456789012:landingzone/LZ-EXAMPLE';

  it('accepts a bucket carrying the Control Tower LandingZoneArn tag matching the current LZ', () => {
    expect(isControlTowerLoggingBucket([{ Key: 'aws:controltower:LandingZoneArn', Value: LZ_ARN }], LZ_ARN)).toBe(true);
  });

  it('accepts a bucket owned by an AWSControlTowerBP-* CloudFormation StackSet', () => {
    expect(
      isControlTowerLoggingBucket(
        [{ Key: 'aws:cloudformation:stack-name', Value: 'AWSControlTowerBP-BASELINE-LOGGING' }],
        LZ_ARN
      )
    ).toBe(true);
  });

  it('accepts a bucket owned by an AWSControlTowerStackSet-* CloudFormation StackSet', () => {
    expect(
      isControlTowerLoggingBucket(
        [{ Key: 'aws:cloudformation:stack-name', Value: 'AWSControlTowerStackSet-CORE' }],
        LZ_ARN
      )
    ).toBe(true);
  });

  it('rejects a bucket tagged with a DIFFERENT Landing Zone ARN', () => {
    expect(
      isControlTowerLoggingBucket(
        [
          {
            Key: 'aws:controltower:LandingZoneArn',
            Value: 'arn:aws-eusc:controltower:eusc-de-east-1:999999999999:landingzone/OTHER'
          }
        ],
        LZ_ARN
      )
    ).toBe(false);
  });

  it('rejects a bucket owned by an unrelated CloudFormation StackSet', () => {
    expect(
      isControlTowerLoggingBucket([{ Key: 'aws:cloudformation:stack-name', Value: 'MyAppStackSet-01' }], LZ_ARN)
    ).toBe(false);
  });

  it('rejects a bucket with no relevant tags (never emits false positives on name-neutral discovery)', () => {
    expect(isControlTowerLoggingBucket([{ Key: 'Environment', Value: 'prod' }], LZ_ARN)).toBe(false);
    expect(isControlTowerLoggingBucket([], LZ_ARN)).toBe(false);
  });
});

describe('formatDiscoveryCounts', () => {
  it('renders every counter for operator diagnostics — regression guard against silent empty output', () => {
    expect(
      formatDiscoveryCounts({ bucketsListed: 7, bucketsTagged: 2, bucketsWithNoTags: 4, bucketsWithErrors: 1 })
    ).toBe('buckets listed=7, tagged=2, no-tags=4, errors=1');
  });
});

describe('validateSharedAccountId', () => {
  it('accepts a 12-digit value', () => {
    expect(() => validateSharedAccountId('audit', '123456789012')).not.toThrow();
  });
  it('rejects malformed values', () => {
    expect(() => validateSharedAccountId('audit', 'abc')).toThrow(/12-digit/);
    expect(() => validateSharedAccountId('audit', '12345')).toThrow(/12-digit/);
  });
});

describe('assertScpCompatibilityMarkers', () => {
  it('accepts a template containing the required principal fragments', () => {
    const template = {
      Resources: {
        A: {
          Type: 'AWS::Organizations::Policy',
          Properties: {
            Name: 'SCP-ESC-SEC-001',
            Content: 'contains AWSServiceRoleForAWSControlTower somewhere'
          }
        }
      }
    };
    expect(() =>
      assertScpCompatibilityMarkers(template, [
        { policyId: 'SCP-ESC-SEC-001', requiredExemptionPrincipalFragment: 'AWSServiceRoleForAWSControlTower' }
      ])
    ).not.toThrow();
  });

  it('rejects a template missing the required fragment', () => {
    const template = {
      Resources: {
        A: {
          Type: 'AWS::Organizations::Policy',
          Properties: { Name: 'SCP-ESC-SEC-001', Content: 'no exemption principal here' }
        }
      }
    };
    expect(() =>
      assertScpCompatibilityMarkers(template, [
        { policyId: 'SCP-ESC-SEC-001', requiredExemptionPrincipalFragment: 'AWSServiceRoleForAWSControlTower' }
      ])
    ).toThrow(/does not contain the required exemption principal fragment/);
  });

  it('rejects a template missing the named policy entirely', () => {
    const template = { Resources: {} };
    expect(() =>
      assertScpCompatibilityMarkers(template, [
        { policyId: 'SCP-ESC-SEC-001', requiredExemptionPrincipalFragment: 'AWSServiceRoleForAWSControlTower' }
      ])
    ).toThrow(/not found in the deployed template/);
  });
});
