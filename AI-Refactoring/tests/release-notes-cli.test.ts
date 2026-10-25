import { describe, expect, it, vi } from 'vitest';

import { createGitHubApi } from '../lib/release/github-api.js';
import { loadPublishedReleaseTags, parseCliOptions } from '../scripts/release-notes.js';

describe('release-notes CLI arguments', () => {
  it('parses a publish invocation', () => {
    const options = parseCliOptions([
      'publish',
      '--release-tag',
      'release-v0.0.3',
      '--commit-sha',
      'abc123',
      '--output-file',
      'notes.md',
      '--fetch-history'
    ]);
    expect(options).toMatchObject({
      mode: 'publish',
      releaseTag: 'release-v0.0.3',
      commitSha: 'abc123',
      outputFile: 'notes.md',
      fetchHistory: true,
      github: false
    });
  });

  it('parses a preview of a tag that does not exist yet', () => {
    const options = parseCliOptions(['preview', '--release-tag', 'release-v0.0.3', '--target-ref', 'main', '--github']);
    expect(options).toMatchObject({ mode: 'preview', targetRef: 'main', github: true, outputFile: undefined });
  });

  it('requires a release tag, a known mode and complete publish arguments', () => {
    expect(() => parseCliOptions([])).toThrow(/Usage/);
    expect(() => parseCliOptions(['deploy', '--release-tag', 'x'])).toThrow(/Usage/);
    expect(() => parseCliOptions(['preview'])).toThrow(/--release-tag is required/);
    expect(() => parseCliOptions(['publish', '--release-tag', 'release-v0.0.3'])).toThrow(
      /--commit-sha and --output-file/
    );
  });

  it('rejects unknown flags, missing values and publish-only misuse', () => {
    expect(() => parseCliOptions(['preview', '--release-tag', 'x', '--bogus'])).toThrow(/Unknown argument/);
    expect(() => parseCliOptions(['preview', '--release-tag'])).toThrow(/needs a value/);
    expect(() =>
      parseCliOptions(['preview', '--release-tag', 'x', '--commit-sha', 'a', '--target-ref', 'main'])
    ).toThrow(/either --commit-sha or --target-ref/);
    expect(() =>
      parseCliOptions([
        'publish',
        '--release-tag',
        'x',
        '--commit-sha',
        'a',
        '--output-file',
        'o',
        '--generated-notes-file',
        'g'
      ])
    ).toThrow(/publish does not accept/);
  });
});

function response(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function api(fetchImpl: typeof fetch) {
  return createGitHubApi({
    apiUrl: 'https://ghe.example.invalid/api/v3/',
    repository: 'org/repo',
    token: 'token-value',
    fetchImpl,
    retryDelayMs: 0
  });
}

describe('GitHub API adapter', () => {
  it('asks GitHub to generate notes for the tag relative to the previous tag', async () => {
    const fetchImpl = vi.fn(async () => response(200, { name: 'release-v0.0.3', body: '## What’s Changed' }));
    const body = await api(fetchImpl as unknown as typeof fetch).generateNotes({
      tagName: 'release-v0.0.3',
      previousTagName: 'release-v0.0.2'
    });
    expect(body).toBe('## What’s Changed');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ghe.example.invalid/api/v3/repos/org/repo/releases/generate-notes');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ tag_name: 'release-v0.0.3', previous_tag_name: 'release-v0.0.2' });
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-value');
  });

  it('omits the previous tag for a first release', async () => {
    const fetchImpl = vi.fn(async () => response(200, { body: 'notes' }));
    await api(fetchImpl as unknown as typeof fetch).generateNotes({ tagName: 'release-v0.0.1' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ tag_name: 'release-v0.0.1' });
  });

  it('fails when GitHub returns no notes', async () => {
    const fetchImpl = vi.fn(async () => response(200, { name: 'x' }));
    await expect(api(fetchImpl as unknown as typeof fetch).generateNotes({ tagName: 't' })).rejects.toThrow(
      /did not return generated release notes/
    );
  });

  it('retries a server error and gives up after three attempts', async () => {
    const flaky = vi
      .fn()
      .mockResolvedValueOnce(response(502))
      .mockResolvedValueOnce(response(200, { body: 'ok' }));
    await expect(api(flaky as unknown as typeof fetch).generateNotes({ tagName: 't' })).resolves.toBe('ok');
    expect(flaky).toHaveBeenCalledTimes(2);

    const down = vi.fn(async () => response(503));
    await expect(api(down as unknown as typeof fetch).generateNotes({ tagName: 't' })).rejects.toThrow(
      /after 3 attempts/
    );
    expect(down).toHaveBeenCalledTimes(3);
  });

  it('reads the PR numbers associated with a commit, treating an unknown commit as none', async () => {
    const found = vi.fn(async () => response(200, [{ number: 86 }, { number: 85 }, { title: 'no number' }]));
    await expect(api(found as unknown as typeof fetch).pullNumbersForCommit('abc')).resolves.toEqual([86, 85]);
    const missing = vi.fn(async () => response(404, { message: 'Not Found' }));
    await expect(api(missing as unknown as typeof fetch).pullNumbersForCommit('abc')).resolves.toEqual([]);
    const denied = vi.fn(async () => response(403, { message: 'Forbidden' }));
    await expect(api(denied as unknown as typeof fetch).pullNumbersForCommit('abc')).rejects.toThrow(/HTTP 403/);
  });

  it('lists published releases and skips drafts', async () => {
    const fetchImpl = vi.fn(async () =>
      response(200, [
        { tag_name: 'release-v0.0.2', draft: false },
        { tag_name: 'release-v0.0.3', draft: true },
        { tag_name: 'release-v0.0.1' }
      ])
    );
    await expect(api(fetchImpl as unknown as typeof fetch).listPublishedReleaseTags()).resolves.toEqual([
      'release-v0.0.2',
      'release-v0.0.1'
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('published releases as a history cross-check', () => {
  const failing = {
    listPublishedReleaseTags: async (): Promise<string[]> => {
      throw new Error('HTTP 403');
    }
  };

  it('stops a publish run when the published releases cannot be read', async () => {
    await expect(loadPublishedReleaseTags(failing, 'publish')).rejects.toThrow(
      /Cannot verify the release history.*HTTP 403.*No release was published/
    );
  });

  it('only warns in a preview, which creates nothing', async () => {
    await expect(loadPublishedReleaseTags(failing, 'preview')).resolves.toBeUndefined();
  });

  it('returns the published tags, or nothing when there is no API', async () => {
    await expect(
      loadPublishedReleaseTags({ listPublishedReleaseTags: async () => ['release-v0.0.1'] }, 'publish')
    ).resolves.toEqual(['release-v0.0.1']);
    await expect(loadPublishedReleaseTags(undefined, 'publish')).resolves.toBeUndefined();
  });
});
