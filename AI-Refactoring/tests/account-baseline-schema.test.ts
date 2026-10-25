import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import {
  ACCOUNT_BASELINE_CONTROL_IDS,
  accountBaselineSchema,
  assertAccountBaselineEnvironment,
  isExcludedOuPath
} from '../config/schemas/account-baseline-schema.js';
import { LandingZoneSchema } from '../config/schemas/organization-schema.js';

/**
 * Configuration contract of the Common Account Security Baseline v1.0: literal targets, fixed
 * exclusions, an explicit per-environment expectation and no exceptions.
 */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function load(environment: 'staging' | 'production', configRoot?: string) {
  return new ConfigReader(environment, {
    ...(configRoot === undefined ? {} : { configRoot }),
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();
}

/** Loads `environment` after `mutate` changed the parsed YAML of `file` in a temporary copy of config/. */
function loadMutated(
  environment: 'staging' | 'production',
  file: string,
  mutate: (document: Record<string, unknown>) => void
) {
  const root = mkdtempSync(join(tmpdir(), 'lz-baseline-'));
  roots.push(root);
  cpSync('config', join(root, 'config'), { recursive: true });
  const path = join(root, 'config', file);
  const document = parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  mutate(document);
  writeFileSync(path, stringify(document), 'utf8');
  return () => load(environment, root);
}

function baseline(document: Record<string, unknown>): Record<string, unknown> {
  return document['accountBaseline'] as Record<string, unknown>;
}

function controls(document: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return baseline(document)['controls'] as Record<string, Record<string, unknown>>;
}

function setControl(document: Record<string, unknown>, name: string, member: string, value: unknown): void {
  const control = controls(document)[name];
  if (control === undefined) throw new Error(`no control ${name}`);
  control[member] = value;
}

describe('approved configuration', () => {
  it('Staging expects 8 enforced accounts and Production 2, matching the configured inventory', () => {
    const staging = load('staging');
    const production = load('production');
    expect(staging.accountBaseline.expectedEnforcedAccountCount).toBe(8);
    expect(Object.keys(staging.landingZoneAccounts)).toHaveLength(8);
    expect(production.accountBaseline.expectedEnforcedAccountCount).toBe(2);
    expect(Object.keys(production.landingZoneAccounts).sort()).toEqual(['network', 'sharedServices']);
  });

  it('shares one set of control targets and exclusions across both environments', () => {
    const staging = load('staging').accountBaseline;
    const production = load('production').accountBaseline;
    expect(staging.controls).toEqual(production.controls);
    expect(staging.excludedAccountRoles).toEqual(['management', 'audit', 'logArchive']);
    expect(staging.excludedOuRoots).toEqual(['Security', 'Suspended']);
    expect(staging.exceptions).toEqual([]);
    expect(staging.controls.ebsEncryptionByDefault.approvedDefaultKmsKeys).toEqual(['alias/aws/ebs']);
  });

  it('declares the expectation only per environment, never in default.yaml', () => {
    const raw = parse(readFileSync('config/default.yaml', 'utf8')) as { accountBaseline: Record<string, unknown> };
    expect(raw.accountBaseline['expectedEnforcedAccountCount']).toBeUndefined();
    expect(ACCOUNT_BASELINE_CONTROL_IDS).toHaveLength(5);
  });
});

describe('rejected configuration', () => {
  it.each([
    [
      'a weaker snapshot target',
      (d: Record<string, unknown>) => setControl(d, 'ebsSnapshotBlockPublicAccess', 'state', 'block-new-sharing')
    ],
    [
      'optional IMDS tokens',
      (d: Record<string, unknown>) => setControl(d, 'ec2ImdsDefaults', 'httpTokens', 'optional')
    ],
    [
      'a different hop limit',
      (d: Record<string, unknown>) => setControl(d, 'ec2ImdsDefaults', 'httpPutResponseHopLimit', 1)
    ],
    [
      'a disabled control',
      (d: Record<string, unknown>) => setControl(d, 'ec2ImageBlockPublicAccess', 'enabled', false)
    ],
    [
      'a false S3 setting',
      (d: Record<string, unknown>) => setControl(d, 's3AccountPublicAccessBlock', 'restrictPublicBuckets', false)
    ],
    [
      'a customer managed default KMS key',
      (d: Record<string, unknown>) =>
        setControl(d, 'ebsEncryptionByDefault', 'approvedDefaultKmsKeys', [
          'alias/aws/ebs',
          'arn:aws-eusc:kms:eusc-de-east-1:200000000001:key/abc'
        ])
    ],
    [
      'a removed account exclusion',
      (d: Record<string, unknown>) => (baseline(d)['excludedAccountRoles'] = ['management', 'audit'])
    ],
    ['a removed OU exclusion', (d: Record<string, unknown>) => (baseline(d)['excludedOuRoots'] = ['Security'])],
    [
      'an exception entry',
      (d: Record<string, unknown>) =>
        (baseline(d)['exceptions'] = [
          {
            id: 'ABX-0001',
            environment: 'staging',
            accountKey: 'sharedServices',
            control: 's3-account-public-access-block',
            approver: 'IF Security',
            reason: 'proposed future exception',
            expiresOn: '2027-01-01'
          }
        ])
    ],
    ['an unknown control', (d: Record<string, unknown>) => (controls(d)['guardDuty'] = { enabled: true })]
  ])('rejects %s', (_label, mutate) => {
    expect(loadMutated('staging', 'default.yaml', mutate)).toThrow();
  });

  it('rejects an expectation that does not match the configured inventory', () => {
    expect(
      loadMutated('staging', 'staging.yaml', (document) => (baseline(document)['expectedEnforcedAccountCount'] = 7))
    ).toThrow(/expects 7 enforced accounts, but 8 eligible accounts are configured/);
  });

  it('rejects a missing per-environment expectation', () => {
    expect(loadMutated('production', 'production.yaml', (document) => delete document['accountBaseline'])).toThrow();
  });

  it('rejects a Landing Zone account that reuses an excluded shared account email', () => {
    expect(
      loadMutated('production', 'production.yaml', (document) => {
        const accounts = document['landingZoneAccounts'] as Record<string, Record<string, unknown>>;
        const network = accounts['network'];
        if (network === undefined) throw new Error('no network account');
        network['email'] = 'FMITaws-cloud-org-001+Audit@if.se';
      })
    ).toThrow(/excluded shared account/);
  });
});

describe('helpers', () => {
  it('recognizes excluded OU paths', () => {
    expect(isExcludedOuPath('Security')).toBe(true);
    expect(isExcludedOuPath('Suspended')).toBe(true);
    expect(isExcludedOuPath('Workloads/Corp/Prod')).toBe(false);
    expect(isExcludedOuPath('Infrastructure')).toBe(false);
  });

  it('accepts only staging and production', () => {
    expect(assertAccountBaselineEnvironment('staging')).toBe('staging');
    expect(() => assertAccountBaselineEnvironment('dev')).toThrow(/refusing environment 'dev'/);
  });

  it('rejects any extra member of the baseline block', () => {
    const valid = load('staging').accountBaseline;
    expect(accountBaselineSchema.safeParse({ ...valid, mode: 'skip' }).success).toBe(false);
  });
});
