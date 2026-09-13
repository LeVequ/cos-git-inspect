import { describe, expect, it } from 'vitest';
import { parseRepoArgs } from '../src/server.js';

describe('parseRepoArgs', () => {
  it('accepts repeatable repository arguments', () => {
    expect(parseRepoArgs(['--repo', 'C:\\one', '--repo=C:\\two'])).toEqual(['C:\\one', 'C:\\two']);
  });

  it('rejects unknown arguments', () => {
    expect(() => parseRepoArgs(['--unsafe'])).toThrow('Unknown argument');
  });
});
