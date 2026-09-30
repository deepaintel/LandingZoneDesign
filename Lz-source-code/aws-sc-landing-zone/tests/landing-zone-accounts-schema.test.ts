import { describe, expect, it } from 'vitest';

import {
  DATA_CLASSIFICATION_VALUES,
  ENVIRONMENT_VALUES,
  LANDING_ZONE_OU_PATHS,
  LIFECYCLE_VALUES,
  landingZoneAccountsSchema
} from '../config/schemas/landing-zone-accounts-schema.js';

const CLOUD_APPLICATION_PLATFORM = 'Cloud Application Platform';

function validAccount(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    name: 'SecurityTooling',
    email: 'FMITaws-cloud-org-002+SecurityTooling@if.se',
    ouPath: 'Security',
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
  it('accepts an empty collection (DEPLOYMENT CONFIGURATION PENDING state)', () => {
    const result = landingZoneAccountsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a valid single-account configuration', () => {
    const result = landingZoneAccountsSchema.safeParse({ securityTooling: validAccount() });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid account name', () => {
    const result = landingZoneAccountsSchema.safeParse({
      securityTooling: validAccount({ name: ' bad name ' })
    });
    expect(result.success).toBe(false);
  });

  it('rejects a syntactically invalid email address', () => {
    const result = landingZoneAccountsSchema.safeParse({
      securityTooling: validAccount({ email: 'not-an-email' })
    });
    expect(result.success).toBe(false);
  });

  it('rejects an OU path outside the approved Landing Zone set', () => {
    const result = landingZoneAccountsSchema.safeParse({
      securityTooling: validAccount({ ouPath: 'Sandbox' })
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
      securityTooling: validAccount({
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
      securityTooling: validAccount({
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
      securityTooling: validAccount({
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
      securityTooling: validAccount({
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
      securityTooling: validAccount({
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
      securityTooling: validAccount({
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
        name: 'MachineLearning-Prod-01',
        email: 'FMITaws-cloud-org-001+MachineLearning-Prod-01@if.se',
        ouPath: 'Workloads/Hybrid/Prod',
        tags: {
          environment: 'prod',
          lifecycle: 'active',
          dataClassification: 'confidential',
          dataResidency: 'EU',
          domain: 'MachineLearning'
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
