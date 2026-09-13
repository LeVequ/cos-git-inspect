import { execFile } from 'node:child_process';
import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  AllowedRepositories,
  getGitDiff,
  getGitStatus,
  parsePorcelainStatus,
} from '../src/cos-git-inspect.js';

const execFileAsync = promisify(execFile);

async function git(repo: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', repo, ...args], { windowsHide: true });
}

async function fixture(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'cos-git-inspect-'));
  await git(repo, 'init', '--quiet');
  await git(repo, 'config', 'user.name', 'Test User');
  await git(repo, 'config', 'user.email', 'test@example.invalid');
  await writeFile(path.join(repo, 'tracked.txt'), 'one\n');
  await git(repo, 'add', 'tracked.txt');
  await git(repo, 'commit', '--quiet', '-m', 'initial');
  return realpath(repo);
}

describe('parsePorcelainStatus', () => {
  it('parses branch counts, changes, renames, conflicts, and untracked files', () => {
    const raw = Buffer.from(
      '# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0' +
        '1 M. N... 100644 100644 100644 abc123 def456 staged.txt\0' +
        '1 .M N... 100644 100644 100644 abc123 abc123 unstaged.txt\0' +
        '2 R. N... 100644 100644 100644 abc123 def456 R100 new.txt\0old.txt\0' +
        'u UU N... 100644 100644 100644 100644 aaa111 bbb222 ccc333 conflict.txt\0' +
        '? new file.txt\0',
    );
    expect(parsePorcelainStatus(raw, '/repo')).toEqual({
      repoPath: '/repo',
      branch: {
        head: 'main',
        upstream: 'origin/main',
        ahead: 2,
        behind: 1,
        detached: false,
        initial: false,
      },
      staged: [{ code: 'M', path: 'staged.txt' }, { code: 'R', path: 'new.txt', originalPath: 'old.txt' }],
      unstaged: [{ code: 'M', path: 'unstaged.txt' }],
      untracked: ['new file.txt'],
      conflicts: [{ code: 'UU', path: 'conflict.txt' }],
    });
  });
});

describe('Git inspection', () => {
  it('reports staged, unstaged, and untracked changes', async () => {
    const repo = await fixture();
    const allowed = await AllowedRepositories.create([repo]);
    await writeFile(path.join(repo, 'tracked.txt'), 'one\ntwo\n');
    await git(repo, 'add', 'tracked.txt');
    await writeFile(path.join(repo, 'tracked.txt'), 'one\ntwo\nthree\n');
    await writeFile(path.join(repo, 'untracked.txt'), 'new\n');

    const status = await getGitStatus(allowed, repo);
    expect(status.staged).toEqual([{ code: 'M', path: 'tracked.txt' }]);
    expect(status.unstaged).toEqual([{ code: 'M', path: 'tracked.txt' }]);
    expect(status.untracked).toEqual(['untracked.txt']);
  });

  it('separates staged and unstaged patches and filters paths', async () => {
    const repo = await fixture();
    const allowed = await AllowedRepositories.create([repo]);
    await writeFile(path.join(repo, 'tracked.txt'), 'one\nstaged\n');
    await git(repo, 'add', 'tracked.txt');
    await writeFile(path.join(repo, 'tracked.txt'), 'one\nstaged\nunstaged\n');

    const staged = await getGitDiff(allowed, repo, true, ['tracked.txt']);
    const unstaged = await getGitDiff(allowed, repo, false, ['tracked.txt']);
    expect(staged.patch).toContain('+staged');
    expect(staged.patch).not.toContain('+unstaged');
    expect(unstaged.patch).toContain('+unstaged');
  });

  it('rejects repositories outside the startup allowlist and escaping paths', async () => {
    const allowedRepo = await fixture();
    const deniedRepo = await fixture();
    const allowed = await AllowedRepositories.create([allowedRepo]);
    await expect(getGitStatus(allowed, deniedRepo)).rejects.toThrow('not allowed');
    await expect(getGitDiff(allowed, allowedRepo, false, ['../outside.txt'])).rejects.toThrow("must not contain '..'");
    await expect(getGitDiff(allowed, allowedRepo, false, ['src/../tracked.txt'])).rejects.toThrow(
      "must not contain '..'",
    );
  });

  it('marks bounded diffs as truncated', async () => {
    const repo = await fixture();
    const allowed = await AllowedRepositories.create([repo]);
    await writeFile(path.join(repo, 'tracked.txt'), `one\n${'large line\n'.repeat(500)}`);
    const diff = await getGitDiff(allowed, repo, false, undefined, { stdoutLimit: 256 });
    expect(diff.truncated).toBe(true);
    expect(diff.capturedBytes).toBe(256);
  });
});
