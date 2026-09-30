import { z } from 'zod';

/**
 * Landing Zone account provisioning schema (SecurityTooling, SharedServices, Network, and CCoE
 * Landing Zone validation / test accounts).
 *
 * Governed by `.apm/instructions/landing-zone-account-provisioning.instructions.md`. This file
 * owns the declarative shape of the reusable Landing Zone account model plus the mandatory P1
 * account-tag validation from §6. It is intentionally separate from
 * `config/schemas/shared-accounts-schema.ts`, which remains the authoritative schema for the
 * Audit / Log Archive Control Tower shared accounts governed by
 * `.apm/instructions/shared-account-provisioning.instructions.md`.
 *
 * The schema is generic: it does not hard-code any concrete account name, OU, key, or tag
 * value. Concrete accounts are selected by the active environment configuration
 * (`config/staging.yaml`). The composite record schema at the bottom is intentionally
 * `z.record(...)`, allowing zero or more accounts under any camelCase key.
 *
 * Runtime-generated account IDs are DELIBERATELY absent: they are resolved from the
 * `AccountId<Key>` outputs of `LandingZoneAccountsStack` at deployment time.
 */

/**
 * AWS Organizations account name: 1..50 characters, no leading/trailing whitespace. Same guard
 * used by `shared-accounts-schema.ts`; duplicated here to keep the two schemas independent.
 */
const ACCOUNT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 +=,.@_'-]{0,48}[A-Za-z0-9]$/;

/**
 * Basic RFC-5322-shaped email guard. Same guard used by `shared-accounts-schema.ts`.
 */
const ACCOUNT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Configuration key naming convention: camelCase (must start with a lowercase letter). Chosen
 * so the deterministic PascalCase construct ID mapping in
 * `lib/organization/landing-zone-accounts-stack.ts` produces stable CloudFormation logical IDs.
 */
const ACCOUNT_KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;

/**
 * Approved Landing Zone OU paths for the current phase. Matches the deployed OU hierarchy in
 * `config/default.yaml` and the workbook → repository OU mapping in
 * `landing-zone-account-provisioning.instructions.md` §4.1. Widening this literal set is a
 * deliberate future change gated by a new approved instruction.
 */
export const LANDING_ZONE_OU_PATHS = [
  'Security',
  'Infrastructure',
  'Workloads/Hybrid/Prod',
  'Workloads/Hybrid/Non-Prod',
  'Workloads/Online/Prod',
  'Workloads/Online/Non-Prod',
  'Workloads/Corp/Prod',
  'Workloads/Corp/Non-Prod'
] as const;

/** Customer-approved P1 enumeration for the `environment` tag (workbook Must-have tags row A23). */
export const ENVIRONMENT_VALUES = ['prod', 'staging', 'dev', 'sandbox'] as const;

/** Customer-approved P1 enumeration for the `lifecycle` tag (workbook Must-have tags row A24). */
export const LIFECYCLE_VALUES = ['active', 'deprecated', 'decommissioning', 'archived'] as const;

/**
 * Customer-approved P1 enumeration for the `data-classification` tag (workbook Must-have tags
 * row A25).
 */
export const DATA_CLASSIFICATION_VALUES = ['public', 'internal', 'confidential', 'restricted'] as const;

/**
 * Mandatory P1 tag inputs held per account. Every field is required; every enumeration is
 * validated. `dataResidency` is fixed to `EU` (workbook Must-have tags row A26 - "Hardcoded to
 * EU"). `domain` is required and non-empty but is intentionally NOT constrained to any literal:
 * the current Landing Zone configuration supplies `Cloud Application Platform` per
 * `landing-zone-account-provisioning.instructions.md` §8.1, and future workload accounts will
 * supply their own value through the account-ordering flow (§8.2) without requiring a schema
 * change or a code-level default.
 *
 * `owner`, `owner-email`, and `itsystemcode` are NOT modelled here - they are derived at synth
 * time in `LandingZoneAccountsStack` from `owner`, `email`, and `costCentre` respectively per
 * §9 mapping. Duplicating them as separate configuration inputs would create a divergence
 * risk.
 */
const landingZoneAccountTagsSchema = z
  .object({
    environment: z.enum(ENVIRONMENT_VALUES, {
      errorMap: () => ({ message: `must be one of: ${ENVIRONMENT_VALUES.join(', ')}` })
    }),
    lifecycle: z.enum(LIFECYCLE_VALUES, {
      errorMap: () => ({ message: `must be one of: ${LIFECYCLE_VALUES.join(', ')}` })
    }),
    dataClassification: z.enum(DATA_CLASSIFICATION_VALUES, {
      errorMap: () => ({ message: `must be one of: ${DATA_CLASSIFICATION_VALUES.join(', ')}` })
    }),
    dataResidency: z.literal('EU', {
      errorMap: () => ({ message: "must be the customer-approved fixed value 'EU'" })
    }),
    domain: z.string().min(1, 'must be a non-empty configured Domain value')
  })
  .strict();

/**
 * Per-account entry. `owner`, `costCentre`, `securityContact`, and `operationsContact` are
 * customer-provided account / business metadata (workbook Owner / Team, Cost Centre, Security
 * Contact, Operations Contact). `owner` and `costCentre` additionally drive the `owner` and
 * `itsystemcode` tag values per the approved mapping in
 * `landing-zone-account-provisioning.instructions.md` §6.1.
 */
const landingZoneAccountEntrySchema = z
  .object({
    name: z.string().regex(ACCOUNT_NAME_PATTERN, 'must be a valid AWS account name (1-50 printable characters)'),
    email: z.string().regex(ACCOUNT_EMAIL_PATTERN, 'must be a syntactically valid email address'),
    ouPath: z.enum(LANDING_ZONE_OU_PATHS, {
      errorMap: () => ({
        message: `must be one of the approved Landing Zone OU paths: ${LANDING_ZONE_OU_PATHS.join(', ')}`
      })
    }),
    owner: z.string().min(1, 'must not be empty'),
    costCentre: z.string().min(1, 'must not be empty'),
    securityContact: z.string().regex(ACCOUNT_EMAIL_PATTERN, 'must be a syntactically valid email address'),
    operationsContact: z.string().regex(ACCOUNT_EMAIL_PATTERN, 'must be a syntactically valid email address'),
    tags: landingZoneAccountTagsSchema
  })
  .strict();

/**
 * Composite Landing Zone account collection. Keys are camelCase identifiers chosen by the
 * configuration author (for example `securityTooling`, `network`, `ccoeHybridProd01`). The
 * `superRefine` guarantees the collection contains no duplicate account name and no duplicate
 * account email (case-insensitive) across the ACTIVE configuration. Zero configured accounts is
 * valid - it corresponds to the current DEPLOYMENT CONFIGURATION PENDING state and lets the
 * repository build / test / synthesize without depending on customer-supplied business values
 * for environment / lifecycle / data-classification.
 */
export const landingZoneAccountsSchema = z
  .record(z.string().regex(ACCOUNT_KEY_PATTERN, 'must be a camelCase identifier'), landingZoneAccountEntrySchema)
  .superRefine((accounts, ctx) => {
    const namesSeen = new Map<string, string>();
    const emailsSeen = new Map<string, string>();
    for (const [key, entry] of Object.entries(accounts)) {
      const nameKey = entry.name.toLowerCase();
      const previousName = namesSeen.get(nameKey);
      if (previousName !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key, 'name'],
          message: `duplicates the account name already used by '${previousName}'`
        });
      } else {
        namesSeen.set(nameKey, key);
      }

      const emailKey = entry.email.toLowerCase();
      const previousEmail = emailsSeen.get(emailKey);
      if (previousEmail !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key, 'email'],
          message: `duplicates the email address already used by '${previousEmail}'`
        });
      } else {
        emailsSeen.set(emailKey, key);
      }
    }
  });

export type LandingZoneAccountConfig = z.infer<typeof landingZoneAccountEntrySchema>;
export type LandingZoneAccountsConfig = z.infer<typeof landingZoneAccountsSchema>;
export type LandingZoneAccountTagsConfig = z.infer<typeof landingZoneAccountTagsSchema>;
export type LandingZoneOuPath = (typeof LANDING_ZONE_OU_PATHS)[number];
export type EnvironmentValue = (typeof ENVIRONMENT_VALUES)[number];
export type LifecycleValue = (typeof LIFECYCLE_VALUES)[number];
export type DataClassificationValue = (typeof DATA_CLASSIFICATION_VALUES)[number];
