/**
 * Minimal GitHub REST adapter for release-note generation. Every call here is a read except
 * `generateNotes`, which POSTs to the generate-notes endpoint: that call returns text and creates
 * nothing. Publishing the Release stays in the composite action.
 */

export interface GitHubApiOptions {
  readonly apiUrl: string;
  /** `owner/repo` */
  readonly repository: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  /** Milliseconds to wait between attempts; tests set this to zero. */
  readonly retryDelayMs?: number;
}

export interface GenerateNotesRequest {
  readonly tagName: string;
  readonly targetCommitish?: string;
  readonly previousTagName?: string;
}

export interface GitHubApi {
  generateNotes(request: GenerateNotesRequest): Promise<string>;
  pullNumbersForCommit(sha: string): Promise<number[]>;
  listPublishedReleaseTags(): Promise<string[]>;
}

const ATTEMPTS = 3;
const RELEASE_PAGES = 5;

export function createGitHubApi(options: GitHubApiOptions): GitHubApi {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = `${options.apiUrl.replace(/\/+$/, '')}/repos/${options.repository}`;
  const delay = options.retryDelayMs ?? 1000;

  async function request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      try {
        const response = await fetchImpl(`${base}${path}`, {
          method: init.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${options.token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json'
          },
          body: init.body === undefined ? undefined : JSON.stringify(init.body)
        });
        if (response.status < 500) {
          return response;
        }
        lastError = new Error(`GitHub API ${init.method ?? 'GET'} ${path} returned HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      if (attempt < ATTEMPTS && delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay * attempt));
      }
    }
    throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed after ${ATTEMPTS} attempts`, {
      cause: lastError
    });
  }

  async function json(
    path: string,
    init?: { method?: string; body?: unknown }
  ): Promise<{ status: number; data: unknown }> {
    const response = await request(path, init);
    return {
      status: response.status,
      data: response.status === 204 ? undefined : await response.json().catch(() => undefined)
    };
  }

  return {
    async generateNotes({ tagName, targetCommitish, previousTagName }) {
      const { status, data } = await json('/releases/generate-notes', {
        method: 'POST',
        body: {
          tag_name: tagName,
          ...(targetCommitish ? { target_commitish: targetCommitish } : {}),
          ...(previousTagName ? { previous_tag_name: previousTagName } : {})
        }
      });
      const body = (data as { body?: unknown } | undefined)?.body;
      if (status !== 200 || typeof body !== 'string') {
        throw new Error(`GitHub did not return generated release notes for ${tagName} (HTTP ${status})`);
      }
      return body;
    },

    async pullNumbersForCommit(sha) {
      const { status, data } = await json(`/commits/${sha}/pulls?per_page=100`);
      if (status === 404 || status === 422) {
        return [];
      }
      if (status !== 200 || !Array.isArray(data)) {
        throw new Error(`Unable to read the pull requests of commit ${sha} (HTTP ${status})`);
      }
      return data.flatMap((pull: unknown) => {
        const number = (pull as { number?: unknown }).number;
        return typeof number === 'number' ? [number] : [];
      });
    },

    async listPublishedReleaseTags() {
      const tags: string[] = [];
      for (let page = 1; page <= RELEASE_PAGES; page += 1) {
        const { status, data } = await json(`/releases?per_page=100&page=${page}`);
        if (status !== 200 || !Array.isArray(data)) {
          throw new Error(`Unable to list GitHub Releases (HTTP ${status})`);
        }
        for (const release of data as { tag_name?: unknown; draft?: unknown }[]) {
          if (typeof release.tag_name === 'string' && release.draft !== true) {
            tags.push(release.tag_name);
          }
        }
        if (data.length < 100) {
          break;
        }
      }
      return tags;
    }
  };
}
