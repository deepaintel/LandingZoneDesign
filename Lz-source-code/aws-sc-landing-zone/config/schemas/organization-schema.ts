import { z } from 'zod';

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

function keyForPath(path: readonly string[]): string {
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
     * Landing Zone platform + CCoE validation accounts (SecurityTooling, SharedServices,
     * Network, and the six CCoE Landing Zone test accounts). Governed by
     * `.apm/instructions/landing-zone-account-provisioning.instructions.md`. Optional and
     * defaulting to an empty record so an environment YAML that has no active Landing Zone
     * account inventory (for example while mandatory customer business values remain pending
     * per §12 of that instruction, and for Production which is out of scope in this iteration)
     * still validates and synthesizes.
     */
    landingZoneAccounts: landingZoneAccountsSchema.optional().default({}),
    controlTower: controlTowerSchema
  })
  .strict();

export type LandingZoneConfig = z.infer<typeof LandingZoneSchema>;
export type OrganizationConfig = z.infer<typeof organizationSchema>;
