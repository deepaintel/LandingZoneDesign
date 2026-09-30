import { z } from 'zod';

/**
 * Shared-account (Audit / Log Archive) configuration schema.
 *
 * Governed by `.apm/instructions/shared-account-provisioning.instructions.md`. This file owns the
 * declarative shape of the two mandatory shared accounts created by
 * `AWS::Organizations::Account`. Runtime-generated account IDs are DELIBERATELY absent: they are
 * resolved from `SharedAccountsStack` outputs at deployment time (Path A) and passed explicitly to
 * downstream consumers. Persisting the generated IDs into environment YAML is disallowed.
 */

/**
 * AWS Organizations account name: 1..50 characters, no leading/trailing whitespace.
 * The upstream API also permits punctuation; we keep the range printable-ASCII to catch typos.
 */
const ACCOUNT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 +=,.@_'-]{0,48}[A-Za-z0-9]$/;

/**
 * Basic RFC-5322-shaped email guard. The upstream `CreateAccount` API rejects malformed addresses
 * and CloudFormation returns them as stack errors; catching them at Zod time keeps that failure
 * out of the deployment path.
 */
const ACCOUNT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Approved shared-account keys for this phase. */
const SHARED_ACCOUNT_KEYS = ['logArchive', 'audit'] as const;

/**
 * Shared-account entry (Audit / Log Archive).
 *
 * `name`, `email`, and `ouPath` are the only fields consumed by `AWS::Organizations::Account`
 * creation in this phase. `owner`, `costCentre`, `securityContact` and `operationsContact` are
 * business/account metadata preserved for later use (tagging, alternate account contacts) per
 * `.apm/instructions/shared-account-provisioning.instructions.md` §6.
 */
const sharedAccountSchema = z
  .object({
    name: z.string().regex(ACCOUNT_NAME_PATTERN, 'must be a valid AWS account name (1-50 printable characters)'),
    email: z.string().regex(ACCOUNT_EMAIL_PATTERN, 'must be a syntactically valid email address'),
    /**
     * Target OU path. Locked to `Security` in this phase - the account-provisioning skill approves
     * only the Security OU as a placement target. Widening this literal is a deliberate future
     * change gated by a new approved instruction.
     */
    ouPath: z.literal('Security'),
    owner: z.string().min(1, 'must not be empty'),
    costCentre: z.string().min(1, 'must not be empty'),
    securityContact: z.string().regex(ACCOUNT_EMAIL_PATTERN, 'must be a syntactically valid email address'),
    operationsContact: z.string().regex(ACCOUNT_EMAIL_PATTERN, 'must be a syntactically valid email address')
  })
  .strict();

/**
 * Approved shared-account block. Exactly two keys, both required: `logArchive` and `audit`.
 * The `superRefine` guarantees the two AWS account emails differ; AWS Organizations rejects a
 * `CreateAccount` request whose email address already exists in the Organization.
 */
export const accountsSchema = z
  .object({
    logArchive: sharedAccountSchema,
    audit: sharedAccountSchema
  })
  .strict()
  .superRefine((accounts, context) => {
    const seen = new Map<string, string>();
    for (const key of SHARED_ACCOUNT_KEYS) {
      const email = accounts[key].email.toLowerCase();
      const previous = seen.get(email);
      if (previous !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key, 'email'],
          message: `duplicates the email address already used by '${previous}'`
        });
      } else {
        seen.set(email, key);
      }
    }
  });

export type AccountsConfig = z.infer<typeof accountsSchema>;
export type SharedAccountConfig = z.infer<typeof sharedAccountSchema>;
export type SharedAccountKey = (typeof SHARED_ACCOUNT_KEYS)[number];
export const sharedAccountKeys: readonly SharedAccountKey[] = SHARED_ACCOUNT_KEYS;
