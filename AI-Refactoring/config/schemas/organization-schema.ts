import { z } from 'zod';

import { accountBaselineSchema, isExcludedOuPath } from './account-baseline-schema.js';
import { accountsSchema } from './shared-accounts-schema.js';
import { controlTowerSchema } from './control-tower-schema.js';
import { IdentityCenterSchema } from './identity-center-schema.js';
import { landingZoneAccountsSchema } from './landing-zone-accounts-schema.js';
import { governanceSchema } from './scp-schema.js';

/**
 * AWS Organizations OU hierarchy schema.
 *
 * Scope: OU structure only. Every other domain lives in its own schema file:
 *   - `scp-schema.ts`              - governance policies, exemptions, disabled-policy holds
 *   - `shared-accounts-schema.ts`  - Audit / Log Archive account entries
 *   - `identity-center-schema.ts`  - IAM Identity Center Permission Sets
 *   - `control-tower-schema.ts`    - Landing Zone 4.0 configuration
 *   - `account-baseline-schema.ts` - Common Account Security Baseline v1.0
 * This file composes them into the root `LandingZoneSchema` but owns no non-OU validation rules.
 */

const ESC_PARTITION = 'aws-eusc';
const ESC_REGION = 'eusc-de-east-1';
const EXPECTED_OU_COUNT = 14;
const MAX_OU_DEPTH = 5;
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const OU_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const OU_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 +=,.@_-]{0,127}$/;

const organizationalUnitInputSchema = z
  .object({
    name: z.string().min(1, 'must not be empty'),
    description: z.string().optional()
  })
  .strict();

/** Stable OU key for a hierarchy path: `['Workloads', 'Corp', 'Non-Prod']` -> `workloads-corp-non-prod`. */
export function keyForPath(path: readonly string[]): string {
  return path
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const organizationSchema = z
  .object({
    organizationalUnits: z.array(organizationalUnitInputSchema).length(EXPECTED_OU_COUNT)
  })
  .strict()
  .superRefine((organization, context) => {
    const paths = new Map<string, number>();

    organization.organizationalUnits.forEach((unit, index) => {
      const segments = unit.name.split('/').map((segment) => segment.trim());
      const path = ['organizationalUnits', index, 'name'] as (string | number)[];

      if (segments.some((segment) => segment.length === 0)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: 'must not contain empty path segments'
        });
      }

      if (segments.some((segment) => !OU_NAME_PATTERN.test(segment))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: 'each path segment must be a valid AWS Organizations OU name'
        });
      }

      const normalizedPath = segments.join('/');
      const previousIndex = paths.get(normalizedPath);
      if (previousIndex !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: `duplicate OU path (already declared at index ${previousIndex})`
        });
      } else {
        paths.set(normalizedPath, index);
      }

      const key = keyForPath(segments);
      if (!OU_KEY_PATTERN.test(key)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path,
          message: 'must produce a valid lowercase kebab-case OU key'
        });
      }
    });

    const siblingNames = new Map<string, string>();
    organization.organizationalUnits.forEach((unit, index) => {
      const segments = unit.name.split('/').map((segment) => segment.trim());
      const parentPath = segments.slice(0, -1).join('/');
      const leafName = segments.at(-1) ?? '';
      const siblingScope = `${parentPath}::${leafName.toLowerCase()}`;
      const existingKey = siblingNames.get(siblingScope);

      if (existingKey !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organizationalUnits', index, 'name'],
          message: `duplicates sibling OU name '${leafName}' declared by '${existingKey}'`
        });
      } else {
        siblingNames.set(siblingScope, unit.name);
      }
    });

    organization.organizationalUnits.forEach((unit, index) => {
      const depth = unit.name.split('/').length;
      if (depth > MAX_OU_DEPTH) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['organizationalUnits', index, 'name'],
          message: `hierarchy depth ${depth} exceeds the maximum supported depth of ${MAX_OU_DEPTH}`
        });
      }
    });
  })
  .transform((organization) => ({
    organizationalUnits: organization.organizationalUnits.map((unit) => {
      const segments = unit.name.split('/').map((segment) => segment.trim());
      const pathKeys = segments.map((_, index) => keyForPath(segments.slice(0, index + 1)));
      return {
        key: pathKeys.at(-1) ?? '',
        name: segments.at(-1) ?? '',
        parent: pathKeys.length === 1 ? 'root' : (pathKeys.at(-2) ?? 'root'),
        ...(unit.description === undefined ? {} : { description: unit.description })
      };
    })
  }));

/**
 * Root Landing Zone configuration.
 *
 * Composes the domain schemas (`organizationSchema`, `IdentityCenterSchema`, `governanceSchema`,
 * `accountsSchema`, `controlTowerSchema`) into the shape validated by
 * `ConfigReader('...', { schema: LandingZoneSchema })`. Domain-specific validation rules live in
 * their own schema files; this composite only fixes the top-level shape and locks the ESC
 * partition/region and the 12-digit management-account ID literal.
 */
export const LandingZoneSchema = z
  .object({
    aws: z
      .object({
        partition: z.literal(ESC_PARTITION),
        region: z.literal(ESC_REGION),
        accountId: z.string().regex(AWS_ACCOUNT_ID_PATTERN, 'must be a 12-digit AWS account ID')
      })
      .strict(),
    organization: organizationSchema,
    identityCenter: IdentityCenterSchema,
    governance: governanceSchema,
    accounts: accountsSchema,
    /**
     * Remaining Landing Zone member accounts: SharedServices and Network in both environments
     * (common values in config/default.yaml, environment values in config/<env>.yaml) plus
     * the six Staging-only CCoE Verification accounts (config/staging.yaml). Governed by
     * `.apm/skills/generate-account/SKILL.md`.
     */
    landingZoneAccounts: landingZoneAccountsSchema,
    controlTower: controlTowerSchema,
    /**
     * Common Account Security Baseline v1.0, governed by
     * `.apm/skills/common-account-baseline/SKILL.md`. Control targets and exclusions in
     * config/default.yaml; `expectedEnforcedAccountCount` in each config/<env>.yaml.
     */
    accountBaseline: accountBaselineSchema
  })
  .strict()
  .superRefine((config, context) => {
    // Account baseline scope: every configured Landing Zone account is an enforcement target, so
    // none may sit under an excluded OU root or reuse a shared (excluded) account's email, and the
    // per-environment expectation must match the configured inventory exactly.
    const baselineTargets = Object.entries(config.landingZoneAccounts);
    if (baselineTargets.length !== config.accountBaseline.expectedEnforcedAccountCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accountBaseline', 'expectedEnforcedAccountCount'],
        message:
          `expects ${config.accountBaseline.expectedEnforcedAccountCount} enforced accounts, but ` +
          `${baselineTargets.length} eligible accounts are configured in landingZoneAccounts`
      });
    }
    const excludedEmails = new Set(
      [config.accounts.audit.email, config.accounts.logArchive.email].map((e) => e.toLowerCase())
    );
    for (const [key, account] of baselineTargets) {
      if (isExcludedOuPath(account.ouPath)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['landingZoneAccounts', key, 'ouPath'],
          message: `'${account.ouPath}' is excluded from the account baseline; accounts there cannot be enforcement targets`
        });
      }
      if (excludedEmails.has(account.email.toLowerCase())) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['landingZoneAccounts', key, 'email'],
          message: 'reuses the email of an excluded shared account (Audit or Log Archive)'
        });
      }
    }

    // Control Tower enrollment rollout order (Staging and Production): every listed OU must exist in the
    // configured hierarchy, and every OU that holds a configured Landing Zone account must be
    // listed, so no configured account is left outside Control Tower governance.
    const rolloutOrder = config.controlTower.enrollment?.rolloutOrder;
    if (rolloutOrder === undefined) {
      return;
    }
    const knownKeys = new Set(config.organization.organizationalUnits.map((unit) => unit.key));
    rolloutOrder.forEach((ouPath, index) => {
      if (!knownKeys.has(keyForPath(ouPath.split('/')))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['controlTower', 'enrollment', 'rolloutOrder', index],
          message: `'${ouPath}' is not an OU in organization.organizationalUnits`
        });
      }
    });
    const listed = new Set(rolloutOrder);
    for (const [key, account] of Object.entries(config.landingZoneAccounts)) {
      if (!listed.has(account.ouPath)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['controlTower', 'enrollment', 'rolloutOrder'],
          message: `OU '${account.ouPath}' of configured account '${key}' is missing from the rollout order`
        });
      }
    }
  });

export type LandingZoneConfig = z.infer<typeof LandingZoneSchema>;
export type OrganizationConfig = z.infer<typeof organizationSchema>;
