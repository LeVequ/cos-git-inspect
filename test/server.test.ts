import { describe, expect, it } from 'vitest';
import type { AllowedRepositories } from '../src/cos-git-inspect.js';
import { createServer, parseRepoArgs } from '../src/server.js';

describe('parseRepoArgs', () => {
  it('accepts repeatable repository arguments', () => {
    expect(parseRepoArgs(['--repo', 'C:\\one', '--repo=C:\\two'])).toEqual(['C:\\one', 'C:\\two']);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseRepoArgs(['--unsafe'])).toThrow('Unknown argument');
  });
});

describe('createServer', () => {
  it('registers only namespaced public tools', () => {
    const allowed = {} as AllowedRepositories;
    const server = createServer(allowed);

    const registeredTools = Object.keys(
      (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools,
    );

    expect(registeredTools.sort()).toEqual(['cos_git_diff', 'cos_git_status']);
  });
});
