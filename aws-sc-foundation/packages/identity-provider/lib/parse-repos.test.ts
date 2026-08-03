import { describe, it, expect } from 'vitest';
import { parseRepos } from '../lib/parse-repos.js';

describe('parseRepos', () => {
  it('splits a comma-separated env var into an array', () => {
    expect(parseRepos('repo-a,repo-b,repo-c', undefined)).toEqual(['repo-a', 'repo-b', 'repo-c']);
  });

  it('wraps a single env var value in an array', () => {
    expect(parseRepos('repo-a', undefined)).toEqual(['repo-a']);
  });

  it('uses a context array when no env var is set', () => {
    expect(parseRepos(undefined, ['repo-a', 'repo-b'])).toEqual(['repo-a', 'repo-b']);
  });

  it('wraps a context string in an array', () => {
    expect(parseRepos(undefined, 'repo-a')).toEqual(['repo-a']);
  });

  it('trims whitespace from comma-separated values', () => {
    expect(parseRepos('repo-a, repo-b , repo-c', undefined)).toEqual(['repo-a', 'repo-b', 'repo-c']);
  });

  it('throws when both env var and context are missing', () => {
    expect(() => parseRepos(undefined, undefined)).toThrow(
      'Missing GitHub repositories. Set GITHUB_REPOS or provide githubRepos context.'
    );
  });

  it('throws when env var contains only blanks', () => {
    expect(() => parseRepos(' ,  , ', undefined)).toThrow(
      'Missing GitHub repositories. Set GITHUB_REPOS or provide githubRepos context.'
    );
  });
});
