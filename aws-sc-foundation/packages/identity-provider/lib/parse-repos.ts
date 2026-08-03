/**
 * Resolves the list of GitHub repositories from an environment variable or CDK context value.
 *
 * - Environment variable: comma-separated string, e.g. `repo-a,repo-b`
 * - CDK context: a JSON array or a single string
 */
export function parseRepos(envRepos: string | undefined, contextRepos: unknown): string[] {
  const source: unknown = envRepos && envRepos.trim().length > 0 ? envRepos.split(',') : contextRepos;
  const rawValues = Array.isArray(source) ? source : [source];

  const repos = rawValues
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (repos.length === 0) {
    throw new Error('Missing GitHub repositories. Set GITHUB_REPOS or provide githubRepos context.');
  }

  return repos;
}
