import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Workflow wiring of release-notes verification: the publish step verifies notes before it creates a
 * release, runs only after tagging, never changes the tag or the branch, and the preview workflow
 * is read-only. The CI deployment-authority check enforces the same contract on every push.
 */

interface Step {
  readonly name?: string;
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}

interface Job {
  readonly needs?: string | string[];
  readonly permissions?: Record<string, string>;
  readonly steps?: Step[];
}

const load = <T>(file: string): T => parse(readFileSync(file, 'utf8')) as T;

const action = load<{ runs: { steps: Step[] } }>('.github/actions/publish-github-release/action.yml');
const deploy = load<{ jobs: Record<string, Job> }>('.github/workflows/deploy.yml');
const preview = load<{
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, Job>;
}>('.github/workflows/preview-release-notes.yml');

const script = action.runs.steps.map((step) => step.run ?? '').join('\n');

describe('publish-github-release action', () => {
  it('verifies the notes with the repository script before it creates a release', () => {
    const verify = script.indexOf('scripts/release-notes.ts publish');
    const create = script.indexOf('-X POST "${api}/releases"');
    expect(verify).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(verify);
    expect(script).toContain('--fetch-history');
  });

  it('publishes the verified body instead of asking GitHub to generate it', () => {
    expect(script).toContain('generate_release_notes: false');
    expect(script).not.toContain('generate_release_notes: true');
    expect(script).toContain('--rawfile body');
  });

  it('keeps the tag check, the idempotent existing-release path and the no-tag-creation rule', () => {
    expect(script).toContain('/git/ref/tags/');
    expect(script).toContain('already exists; not recreating it');
    expect(script).toContain('A draft release already exists');
    expect(script).toContain('set -euo pipefail');
  });

  it('never moves a tag or touches a branch or the deployment', () => {
    expect(script).not.toMatch(/git (tag|push)\b/);
    expect(script).not.toContain('-X DELETE');
    expect(script).not.toContain('-X PATCH');
  });
});

describe('publish-release job in deploy.yml', () => {
  const job = deploy.jobs['publish-release'];
  const steps = job?.steps ?? [];

  it('runs after tagging with only the permissions it needs', () => {
    expect(job?.needs).toBe('tag-release');
    expect(job?.permissions).toEqual({ contents: 'write', 'pull-requests': 'read', packages: 'read' });
  });

  it('prepares the workspace before the publish step and never configures AWS', () => {
    const workspace = steps.findIndex((step) => step.uses === './.github/actions/setup-workspace');
    const publish = steps.findIndex((step) => step.uses === './.github/actions/publish-github-release');
    expect(workspace).toBeGreaterThanOrEqual(0);
    expect(publish).toBeGreaterThan(workspace);
    expect(steps.some((step) => String(step.uses).includes('aws-credentials'))).toBe(false);
  });

  it('leaves the order of tagging, publishing and branch retirement unchanged', () => {
    expect(deploy.jobs['tag-release']?.needs).toEqual(['verify-release-branch', 'deploy-to-production']);
    expect([deploy.jobs['retire-release-branch']?.needs].flat()).toContain('publish-release');
  });
});

describe('preview-release-notes workflow', () => {
  const job = preview.jobs['preview'];
  const steps = job?.steps ?? [];

  it('is manually triggered and read-only', () => {
    expect(Object.keys(preview.on ?? {})).toEqual(['workflow_dispatch']);
    expect(preview.permissions).toEqual({ contents: 'read' });
    expect(Object.values(job?.permissions ?? {})).not.toContain('write');
    expect(job?.permissions?.['id-token']).toBeUndefined();
  });

  it('runs the preview mode only and none of the release mechanics', () => {
    const commands = steps.map((step) => step.run ?? '').join('\n');
    expect(commands).toContain('scripts/release-notes.ts preview');
    expect(commands).not.toContain('release-notes.ts publish');
    for (const forbidden of ['aws-credentials', 'tag-release', 'publish-github-release', 'retire-release-branch']) {
      expect(steps.some((step) => String(step.uses).includes(forbidden))).toBe(false);
    }
  });
});
