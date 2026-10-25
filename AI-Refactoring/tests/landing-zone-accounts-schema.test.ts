import { describe, expect, it } from 'vitest';

import {
  assertLandingZoneAccountScope,
  DATA_CLASSIFICATION_VALUES,
  ENVIRONMENT_VALUES,
  LANDING_ZONE_OU_PATHS,
  LIFECYCLE_VALUES,
  landingZoneAccountsSchema,
  PRODUCTION_LANDING_ZONE_ACCOUNTS,
  type LandingZoneAccountsConfig
} from '../config/schemas/landing-zone-accounts-schema.js';

const CLOUD_APPLICATION_PLATFORM = 'Cloud Application Platform';

function validAccount(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    name: 'SharedServices',
    email: 'FMITaws-cloud-org-002+SharedServices@if.se',
    ouPath: 'Infrastructure',
    owner: 'CCoE',
    costCentre: 'AISARCH',
    securityContact: 'FMITaws-cloud-org-002+SecurityContact@if.se',
    operationsContact: 'cloud@if.eu',
    tags: {
      environment: 'staging',
      lifecycle: 'active',
      dataClassification: 'internal',
      dataResidency: 'EU',
      domain: CLOUD_APPLICATION_PLATFORM
    },
    ...overrides
  };
}

describe('landingZoneAccountsSchema', () => {
  it('accepts a valid single-account configuration', () => {
    const result = landingZoneAccountsSchema.safeParse({ sharedServices: validAccount() });
    expect(result.success).toBe(true);
  });

  it('rejects a remaining account targeting the Security OU (reserved for Audit and Log Archive)', () => {
    const result = landingZoneAccountsSchema.safeParse({
      sharedServices: validAccount({ ouPath: 'Security' })
    });
    expect(result.success).toBe(false);
    expect(LANDING_ZONE_OU_PATHS).not.toContain('Security');
  });

  it('rejects an invalid account name', () => {
    const result = landingZoneAccountsSchema.safeParse({
      sharedServices: validAccount({ name: ' bad name ' })
    });
    expect(result.success).toBe(false);
  });

  it('rejects a syntactically invalid email address', () => {
    const result = landingZoneAccountsSchema.safeParse({
      sharedServices: validAccount({ email: 'not-an-email' })
    });
    expect(result.success).toBe(false);
  });

  it('rejects an OU path outside the approved Landing Zone set', () => {
    const result = landingZoneAccountsSchema.safeParse({
      sharedServices: validAccount({ ouPath: 'Sandbox' })
    });
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate account name across the collection', () => {
    const result = landingZoneAccountsSchema.safeParse({
      alpha: validAccount({ name: 'SharedServices', email: 'FMITaws-cloud-org-002+SharedServices-a@if.se' }),
      beta: validAccount({ name: 'SharedServices', email: 'FMITaws-cloud-org-002+SharedServices-b@if.se' })
    });
    expect(result.success).toBe(false);
  });

  it('rejects a duplicate account email across the collection', () => {
    const result = landingZoneAccountsSchema.safeParse({
      alpha: validAccount({ name: 'Network', email: 'FMITaws-cloud-org-002+Network@if.se' }),
      beta: validAccount({ name: 'SharedServices', email: 'FMITaws-cloud-org-002+Network@if.se' })
    });
    expect(result.success).toBe(false);
  });

  it('rejects an environment value outside the customer-approved enumeration', () => {
    const result = landingZoneAccountsSchema.safeParse({
      sharedServices: validAccount({
        tags: {
          environment: 'preprod',
          lifecycle: 'active',
          dataClassification: 'internal',
          dataResidency: 'EU',
          domain: CLOUD_APPLICATION_PLATFORM
        }
      })
    });
    expect(result.success).toBe(false);
  });

  it('rejects a lifecycle value outside the customer-approved enumeration', () => {
    const result = landingZoneAccountsSchema.safeParse({
      sharedServices: validAccount({
        tags: {
          environment: 'staging',
          lifecycle: 'paused',
          dataClassification: 'internal',
          dataResidency: 'EU',
          domain: CLOUD_APPLICATION_PLATFORM
        }
      })
    });
    expect(result.success).toBe(false);
  });

  it('rejects a data-classification value outside the customer-approved enumeration', () => {
    const result = landingZoneAccountsSchema.safeParse({
      sharedServices: validAccount({
        tags: {
          environment: 'staging',
          lifecycle: 'active',
          dataClassification: 'top-secret',
          dataResidency: 'EU',
          domain: CLOUD_APPLICATION_PLATFORM
        }
      })
    });
    expect(result.success).toBe(false);
  });

  it('rejects dataResidency values other than EU', () => {
    const result = landingZoneAccountsSchema.safeParse({
      sharedServices: validAccount({
        tags: {
          environment: 'staging',
          lifecycle: 'active',
          dataClassification: 'internal',
          dataResidency: 'US',
          domain: CLOUD_APPLICATION_PLATFORM
        }
      })
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing domain value', () => {
    const result = landingZoneAccountsSchema.safeParse({
      sharedServices: validAccount({
        tags: {
          environment: 'staging',
          lifecycle: 'active',
          dataClassification: 'internal',
          dataResidency: 'EU'
        }
      })
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty domain string', () => {
    const result = landingZoneAccountsSchema.safeParse({
      sharedServices: validAccount({
        tags: {
          environment: 'staging',
          lifecycle: 'active',
          dataClassification: 'internal',
          dataResidency: 'EU',
          domain: ''
        }
      })
    });
    expect(result.success).toBe(false);
  });

  it('accepts a non-Cloud-Application-Platform domain to prove future workload configurability', () => {
    const result = landingZoneAccountsSchema.safeParse({
      futureWorkload: validAccount({
        name: 'ExampleWorkload-Prod-01',
        email: 'FMITaws-cloud-org-001+ExampleWorkload-Prod-01@if.se',
        ouPath: 'Workloads/Hybrid/Prod',
        tags: {
          environment: 'prod',
          lifecycle: 'active',
          dataClassification: 'confidential',
          dataResidency: 'EU',
          domain: 'Example Domain'
        }
      })
    });
    expect(result.success).toBe(true);
  });

  it('exposes the customer-approved enumerations for reuse', () => {
    expect(ENVIRONMENT_VALUES).toEqual(['prod', 'staging', 'dev', 'sandbox']);
    expect(LIFECYCLE_VALUES).toEqual(['active', 'deprecated', 'decommissioning', 'archived']);
    expect(DATA_CLASSIFICATION_VALUES).toEqual(['public', 'internal', 'confidential', 'restricted']);
    expect(LANDING_ZONE_OU_PATHS).toContain('Workloads/Corp/Non-Prod');
  });
});

describe('assertLandingZoneAccountScope', () => {
  function parsed(accounts: Record<string, unknown>): LandingZoneAccountsConfig {
    return landingZoneAccountsSchema.parse(accounts);
  }

  const productionPlatform = {
    sharedServices: validAccount({ email: 'FMITaws-cloud-org-001+SharedServices@if.se' }),
    network: validAccount({
      name: 'Network',
      email: 'FMITaws-cloud-org-001+Network@if.se',
      owner: 'Connectivity',
      costCentre: 'AISCCNO'
    })
  };

  it('pins the Production inventory to exactly SharedServices and Network', () => {
    expect(PRODUCTION_LANDING_ZONE_ACCOUNTS).toEqual({ sharedServices: 'SharedServices', network: 'Network' });
  });

  it('accepts exactly SharedServices and Network in Production', () => {
    expect(() => assertLandingZoneAccountScope('production', parsed(productionPlatform))).not.toThrow();
  });

  it('rejects a Verification account in Production', () => {
    const accounts = parsed({
      ...productionPlatform,
      ccoeHybridVerificationProd01: validAccount({
        name: 'CcoeHybridVerification-Prod-01',
        email: 'FMITaws-cloud-org-001+CcoeHybridVerification-Prod-01@if.se',
        ouPath: 'Workloads/Hybrid/Prod'
      })
    });
    expect(() => assertLandingZoneAccountScope('production', accounts)).toThrow(/ccoeHybridVerificationProd01/);
  });

  it('rejects an additional Infrastructure account in Production', () => {
    const accounts = parsed({
      ...productionPlatform,
      extraPlatform: validAccount({ name: 'ExtraPlatform', email: 'FMITaws-cloud-org-001+ExtraPlatform@if.se' })
    });
    expect(() => assertLandingZoneAccountScope('production', accounts)).toThrow(/extraPlatform/);
  });

  it('rejects a Production inventory missing an approved account', () => {
    const accounts = parsed({ sharedServices: productionPlatform.sharedServices });
    expect(() => assertLandingZoneAccountScope('production', accounts)).toThrow(/'network' is missing/);
  });

  it('rejects an approved Production key carrying a different account name', () => {
    const accounts = parsed({
      ...productionPlatform,
      network: validAccount({ name: 'Audit', email: 'FMITaws-cloud-org-001+Audit@if.se' })
    });
    expect(() => assertLandingZoneAccountScope('production', accounts)).toThrow(/must be named 'Network'/);
  });

  it('rejects an empty Production inventory', () => {
    expect(() => assertLandingZoneAccountScope('production', parsed({}))).toThrow(/is missing/);
  });

  it('leaves the Staging inventory to configuration and the schema', () => {
    const accounts = parsed({
      ...productionPlatform,
      ccoeCorpVerificationNonProd01: validAccount({
        name: 'CcoeCorpVerification-NonProd-01',
        email: 'FMITaws-cloud-org-002+CcoeCorpVerification-NonProd-01@if.se',
        ouPath: 'Workloads/Corp/Non-Prod'
      })
    });
    expect(() => assertLandingZoneAccountScope('staging', accounts)).not.toThrow();
  });

  it('rejects an unsupported environment', () => {
    expect(() => assertLandingZoneAccountScope('dev', parsed(productionPlatform))).toThrow(/Unsupported environment/);
  });
});
