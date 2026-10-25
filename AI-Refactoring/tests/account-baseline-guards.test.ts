import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Static guards for the Common Account Security Baseline v1.0: the baseline code can express only
 * the six allow-listed enable-only writes, no destructive or IAM/KMS/StackSet operation, and CI never
 * runs it.
 */

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const BASELINE_SOURCES = [
  ...files('lib/account-baseline'),
  'scripts/account-baseline-runtime.ts',
  'scripts/reconcile-account-baseline.ts',
  '.github/actions/reconcile-account-baseline/action.yml'
];
const runtime = readFileSync('scripts/account-baseline-runtime.ts', 'utf8');

/** CLI operations the baseline must never perform. */
const PROHIBITED_COMMANDS = [
  'disable-ebs-encryption-by-default',
  'modify-ebs-default-kms-key-id',
  'reset-ebs-default-kms-key-id',
  'delete-public-access-block',
  'disable-snapshot-block-public-access',
  'disable-image-block-public-access',
  'put-bucket-policy',
  'delete-bucket-policy',
  'put-bucket-acl',
  'put-object-acl',
  'put-access-point-policy',
  'modify-image-attribute',
  'modify-snapshot-attribute',
  'modify-instance-metadata-options',
  'create-launch-template-version',
  'update-auto-scaling-group',
  'create-key',
  'create-role',
  'put-role-policy',
  'attach-role-policy',
  'update-assume-role-policy',
  'create-function',
  'create-stack-set',
  'create-stack-instances',
  'create-policy',
  'attach-policy',
  'enable-aws-service-access',
  'register-delegated-administrator',
  'put-configuration-recorder',
  'put-config-rule',
  'update-trail'
];

describe('prohibited operations', () => {
  it.each(BASELINE_SOURCES)('%s contains no prohibited or destructive operation', (file) => {
    const text = readFileSync(file, 'utf8');
    for (const command of PROHIBITED_COMMANDS) {
      expect(
        text.includes(`'${command}'`) || new RegExp(`\\s${command}(\\s|$)`, 'm').test(text),
        `${file}: ${command}`
      ).toBe(false);
    }
  });

  it('the runtime adapter calls exactly the five allow-listed write commands', () => {
    const mutating = [
      ...runtime.matchAll(/'((?:put|enable|modify|disable|delete|reset|create|update|attach)-[a-z-]+)'/g)
    ].map((match) => match[1]);
    expect([...new Set(mutating)].sort()).toEqual(
      [
        'enable-ebs-encryption-by-default',
        'enable-image-block-public-access',
        'enable-snapshot-block-public-access',
        'modify-instance-metadata-defaults',
        'put-public-access-block'
      ].sort()
    );
  });

  it('writes only the approved literal targets', () => {
    expect(runtime).toContain("['--http-tokens', 'required']");
    expect(runtime).toContain("['--http-put-response-hop-limit', '2']");
    expect(runtime).toContain("['--state', 'block-all-sharing']");
    expect(runtime).not.toMatch(/'--state', 'block-new-sharing'/);
    expect(runtime).toContain("['--image-block-public-access-state', 'block-new-sharing']");
    expect(runtime).toContain(
      'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'
    );
    expect(runtime).not.toMatch(/=false/);
    expect(runtime).not.toMatch(/'optional'|'no-preference'|'unblocked'|'--http-tokens-enforced'/);
  });

  it('reaches member accounts only through the established OrganizationAccountAccessRole', () => {
    expect(readFileSync('lib/account-baseline/plan.ts', 'utf8')).toContain(
      "export const MEMBER_ACCESS_ROLE_NAME = 'OrganizationAccountAccessRole';"
    );
    expect(runtime).toContain('role/${MEMBER_ACCESS_ROLE_NAME}');
    expect(runtime).not.toMatch(/AWSControlTowerExecution/);
  });
});

describe('CI never runs the account baseline', () => {
  it('ci.yml has no account baseline entry point and requests no deployment credentials', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).not.toContain(['reconcile', 'account-baseline'].join(':'));
    expect(ci).not.toContain('reconcile-account-baseline.ts');
    expect(ci).not.toMatch(/^\s+id-token:\s*write/m);
  });
});
