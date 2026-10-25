import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { ConfigReader } from '@ccoe-aws_if-it/ccoe-config-reader';

import { assertLandingZoneAccountScope } from '../config/schemas/landing-zone-accounts-schema.js';
import { LandingZoneSchema, type LandingZoneConfig } from '../config/schemas/organization-schema.js';

/**
 * Configuration ownership and isolation for the remaining Landing Zone accounts:
 *   config/default.yaml    - values common to SharedServices and Network in BOTH environments
 *   config/staging.yaml    - Staging values for SharedServices / Network + the six Verification accounts
 *   config/production.yaml - Production values for SharedServices / Network only
 * ccoe-config-reader merges default.yaml with the selected environment file only.
 */

const VERIFICATION_ACCOUNTS = {
  ccoeHybridVerificationProd01: ['CcoeHybridVerification-Prod-01', 'Workloads/Hybrid/Prod'],
  ccoeHybridVerificationNonProd01: ['CcoeHybridVerification-NonProd-01', 'Workloads/Hybrid/Non-Prod'],
  ccoeOnlineVerificationProd01: ['CcoeOnlineVerification-Prod-01', 'Workloads/Online/Prod'],
  ccoeOnlineVerificationNonProd01: ['CcoeOnlineVerification-NonProd-01', 'Workloads/Online/Non-Prod'],
  ccoeCorpVerificationProd01: ['CcoeCorpVerification-Prod-01', 'Workloads/Corp/Prod'],
  ccoeCorpVerificationNonProd01: ['CcoeCorpVerification-NonProd-01', 'Workloads/Corp/Non-Prod']
} as const;

type RawAccounts = Record<string, Record<string, unknown> & { tags?: Record<string, unknown> }>;

function rawLandingZoneAccounts(file: string): RawAccounts {
  const document = parse(readFileSync(join('config', file), 'utf8')) as { landingZoneAccounts?: RawAccounts };
  return document.landingZoneAccounts ?? {};
}

function load(environment: 'staging' | 'production', configRoot?: string): LandingZoneConfig {
  return new ConfigReader(environment, {
    ...(configRoot === undefined ? {} : { configRoot }),
    configDirName: 'config',
    schema: LandingZoneSchema
  }).getConfig();
}

const temporaryRoots: string[] = [];

/** Copies config/ into a temporary root so a test can alter one file without touching the repository. */
function copyConfig(): string {
  const root = mkdtempSync(join(tmpdir(), 'lz-config-'));
  temporaryRoots.push(root);
  cpSync('config', join(root, 'config'), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('config/default.yaml landingZoneAccounts', () => {
  const accounts = rawLandingZoneAccounts('default.yaml');

  it('holds only the accounts shared by both environments: SharedServices and Network', () => {
    expect(Object.keys(accounts).sort()).toEqual(['network', 'sharedServices']);
  });

  it('holds only environment-invariant values', () => {
    for (const [key, entry] of Object.entries(accounts)) {
      expect(Object.keys(entry).sort(), key).toEqual([
        'costCentre',
        'name',
        'operationsContact',
        'ouPath',
        'owner',
        'tags'
      ]);
      expect(Object.keys(entry.tags ?? {}).sort(), `${key} tags`).toEqual(['dataResidency', 'domain']);
    }
  });
});

describe('environment configuration files', () => {
  it('declares the six Verification accounts in config/staging.yaml only', () => {
    const staging = rawLandingZoneAccounts('staging.yaml');
    expect(Object.keys(staging).sort()).toEqual(
      ['sharedServices', 'network', ...Object.keys(VERIFICATION_ACCOUNTS)].sort()
    );
    for (const file of ['default.yaml', 'production.yaml']) {
      for (const [key, entry] of Object.entries(rawLandingZoneAccounts(file))) {
        expect(`${key} ${String(entry['name'] ?? '')} ${String(entry['email'] ?? '')}`, file).not.toMatch(
          /Verification/i
        );
      }
    }
  });

  it('declares only SharedServices and Network overrides in config/production.yaml', () => {
    expect(Object.keys(rawLandingZoneAccounts('production.yaml')).sort()).toEqual(['network', 'sharedServices']);
  });
});

describe('merged Staging inventory', () => {
  const accounts = load('staging').landingZoneAccounts;

  it('is exactly SharedServices, Network, and the six Verification accounts', () => {
    expect(Object.keys(accounts).sort()).toEqual(
      ['sharedServices', 'network', ...Object.keys(VERIFICATION_ACCOUNTS)].sort()
    );
  });

  it('maps each Verification account to its name, Verification email, and Workloads leaf OU', () => {
    for (const [key, [name, ouPath]] of Object.entries(VERIFICATION_ACCOUNTS)) {
      const account = accounts[key];
      expect(account?.name, key).toBe(name);
      expect(account?.email, key).toBe(`FMITaws-cloud-org-002+${name}@if.se`);
      expect(account?.email, key).toContain('Verification');
      expect(account?.ouPath, key).toBe(ouPath);
      expect(account?.owner, key).toBe('CCoE');
      expect(account?.costCentre, key).toBe('AISARCH');
      expect(account?.securityContact, key).toBe('FMITaws-cloud-org-002+SecurityContact@if.se');
      expect(account?.operationsContact, key).toBe('cloud@if.eu');
      expect(account?.tags, key).toEqual({
        environment: ouPath.endsWith('/Prod') ? 'prod' : 'staging',
        lifecycle: 'active',
        dataClassification: 'internal',
        dataResidency: 'EU',
        domain: 'Cloud Application Platform'
      });
    }
  });

  it('merges the common SharedServices / Network values with the Staging values', () => {
    expect(accounts.sharedServices).toEqual({
      name: 'SharedServices',
      email: 'FMITaws-cloud-org-002+SharedServices@if.se',
      ouPath: 'Infrastructure',
      owner: 'CCoE',
      costCentre: 'AISARCH',
      securityContact: 'FMITaws-cloud-org-002+SecurityContact@if.se',
      operationsContact: 'cloud@if.eu',
      tags: {
        environment: 'prod',
        lifecycle: 'active',
        dataClassification: 'internal',
        dataResidency: 'EU',
        domain: 'Cloud Application Platform'
      }
    });
    expect(accounts.network).toEqual({
      name: 'Network',
      email: 'FMITaws-cloud-org-002+Network@if.se',
      ouPath: 'Infrastructure',
      owner: 'Connectivity',
      costCentre: 'AISCCNO',
      securityContact: 'FMITaws-cloud-org-002+SecurityContact@if.se',
      operationsContact: 'network-hub@if.fi',
      tags: {
        environment: 'prod',
        lifecycle: 'active',
        dataClassification: 'internal',
        dataResidency: 'EU',
        domain: 'Cloud Application Platform'
      }
    });
  });
});

describe('merged Production inventory', () => {
  const accounts = load('production').landingZoneAccounts;

  it('is exactly SharedServices and Network and passes the Production scope guard', () => {
    expect(Object.keys(accounts).sort()).toEqual(['network', 'sharedServices']);
    expect(() => assertLandingZoneAccountScope('production', accounts)).not.toThrow();
  });

  it('resolves the approved Production SharedServices and Network values', () => {
    const tags = {
      environment: 'prod',
      lifecycle: 'active',
      dataClassification: 'internal',
      dataResidency: 'EU',
      domain: 'Cloud Application Platform'
    };
    expect(accounts.sharedServices).toEqual({
      name: 'SharedServices',
      email: 'FMITaws-cloud-org-001+SharedServices@if.se',
      ouPath: 'Infrastructure',
      owner: 'CCoE',
      costCentre: 'AISARCH',
      securityContact: 'Cloud-Security@if.eu',
      operationsContact: 'cloud@if.eu',
      tags
    });
    expect(accounts.network).toEqual({
      name: 'Network',
      email: 'FMITaws-cloud-org-001+Network@if.se',
      ouPath: 'Infrastructure',
      owner: 'Connectivity',
      costCentre: 'AISCCNO',
      securityContact: 'Cloud-Security@if.eu',
      operationsContact: 'network-hub@if.fi',
      tags
    });
  });
});

describe('configuration isolation', () => {
  it('never reads config/staging.yaml when loading Production', () => {
    const root = copyConfig();
    // A Staging file that is not even valid YAML would break any reader that touched it.
    writeFileSync(join(root, 'config', 'staging.yaml'), 'landingZoneAccounts: [unclosed\n');
    expect(load('production', root).landingZoneAccounts).toEqual(load('production').landingZoneAccounts);
  });

  it('fails instead of falling back to default values when Production supplies none', () => {
    const root = copyConfig();
    const production = parse(readFileSync(join(root, 'config', 'production.yaml'), 'utf8')) as Record<string, unknown>;
    delete production['landingZoneAccounts'];
    writeFileSync(join(root, 'config', 'production.yaml'), JSON.stringify(production));
    expect(() => load('production', root)).toThrow(/email|securityContact|environment/);
  });

  it('fails when the Production file is missing entirely', () => {
    const root = copyConfig();
    rmSync(join(root, 'config', 'production.yaml'));
    expect(() => load('production', root)).toThrow();
  });

  it('rejects any additional Production account at the scope guard', () => {
    const root = copyConfig();
    const file = join(root, 'config', 'production.yaml');
    const production = parse(readFileSync(file, 'utf8')) as {
      landingZoneAccounts: RawAccounts;
      accountBaseline: { expectedEnforcedAccountCount: number };
    };
    // The account baseline expectation is raised with the inventory, so loading succeeds and the
    // Production scope guard is what rejects the additional account.
    production.accountBaseline.expectedEnforcedAccountCount = 3;
    production.landingZoneAccounts['ccoeHybridVerificationProd01'] = {
      name: 'CcoeHybridVerification-Prod-01',
      email: 'FMITaws-cloud-org-001+CcoeHybridVerification-Prod-01@if.se',
      ouPath: 'Workloads/Hybrid/Prod',
      owner: 'CCoE',
      costCentre: 'AISARCH',
      securityContact: 'Cloud-Security@if.eu',
      operationsContact: 'cloud@if.eu',
      tags: {
        environment: 'prod',
        lifecycle: 'active',
        dataClassification: 'internal',
        dataResidency: 'EU',
        domain: 'Cloud Application Platform'
      }
    };
    writeFileSync(file, JSON.stringify(production));
    const accounts = load('production', root).landingZoneAccounts;
    expect(() => assertLandingZoneAccountScope('production', accounts)).toThrow(/ccoeHybridVerificationProd01/);
  });
});
