import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  DIFF_STDOUT_LIMIT,
  STATUS_STDOUT_LIMIT,
  runGit,
  type GitRunOptions,
} from './git-process.js';

export type ChangeCode = 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | string;

export interface FileChange {
  code: ChangeCode;
  path: string;
  originalPath?: string;
}

export interface BranchStatus {
  head: string | null;
  upstream?: string;
  ahead: number;
  behind: number;
  detached: boolean;
  initial: boolean;
}

export interface GitStatusResult {
  repoPath: string;
  branch: BranchStatus;
  staged: FileChange[];
  unstaged: FileChange[];
  untracked: string[];
  conflicts: FileChange[];
}

export interface GitDiffResult {
  repoPath: string;
  staged: boolean;
  paths: string[];
  patch: string;
  truncated: boolean;
  capturedBytes: number;
  byteLimit: number;
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function comparable(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized;
}

async function canonicalDirectory(value: string): Promise<string> {
  if (!value.trim()) throw new Error('Repository path must not be empty.');
  const resolved = path.resolve(value);
  const canonical = await realpath(resolved).catch(() => {
    throw new Error(`Repository path does not exist: ${resolved}`);
  });
  const info = await stat(canonical);
  if (!info.isDirectory()) throw new Error(`Repository path is not a directory: ${canonical}`);
  return canonical;
}

export class AllowedRepositories {
  private constructor(private readonly roots: ReadonlyMap<string, string>) {}

  static async create(repoArgs: readonly string[]): Promise<AllowedRepositories> {
    if (repoArgs.length === 0) {
      throw new Error('At least one allowed repository is required. Pass --repo <absolute-path>.');
    }

    const roots = new Map<string, string>();
    for (const value of repoArgs) {
      if (!path.isAbsolute(value)) {
        throw new Error(`Allowed repository paths must be absolute: ${value}`);
      }
      const canonical = await canonicalDirectory(value);
      const topLevel = await runGit(canonical, ['rev-parse', '--show-toplevel'], {
        stdoutLimit: 64 * 1024,
      }).catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Not a Git repository: ${canonical}. ${detail}`);
      });
      const canonicalTopLevel = await canonicalDirectory(topLevel.stdout.toString('utf8').trim());
      if (comparable(canonicalTopLevel) !== comparable(canonical)) {
        throw new Error(
          `Allowed repository must name its top-level directory: ${canonical} (top level is ${canonicalTopLevel}).`,
        );
      }
      roots.set(comparable(canonical), canonical);
    }
    return new AllowedRepositories(roots);
  }

  async requireAllowed(repoPath: string): Promise<string> {
    if (!path.isAbsolute(repoPath)) {
      throw new Error('repo_path must be an absolute path.');
    }
    const canonical = await canonicalDirectory(repoPath);
    const allowed = this.roots.get(comparable(canonical));
    if (!allowed) throw new Error(`Repository is not allowed: ${canonical}`);
    return allowed;
  }

  list(): string[] {
    return [...this.roots.values()];
  }
}

export function parsePorcelainStatus(output: Buffer | string, repoPath: string): GitStatusResult {
  const records = (Buffer.isBuffer(output) ? output.toString('utf8') : output).split('\0');
  if (records.at(-1) === '') records.pop();

  let branch: BranchStatus = {
    head: null,
    ahead: 0,
    behind: 0,
    detached: false,
    initial: false,
  };
  const staged: FileChange[] = [];
  const unstaged: FileChange[] = [];
  const untracked: string[] = [];
  const conflicts: FileChange[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.startsWith('# branch.oid ')) {
      branch.initial = record.slice('# branch.oid '.length) === '(initial)';
      continue;
    }
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length);
      branch.detached = head === '(detached)';
      branch.head = branch.detached ? null : head;
      continue;
    }
    if (record.startsWith('# branch.upstream ')) {
      branch.upstream = record.slice('# branch.upstream '.length);
      continue;
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (!match) throw new Error('Git returned an invalid branch count record.');
      branch.ahead = Number(match[1]);
      branch.behind = Number(match[2]);
      continue;
    }

    if (record.startsWith('? ')) {
      untracked.push(record.slice(2));
      continue;
    }
    if (record.startsWith('! ')) continue;

    const kind = record[0];
    const minimumFields = kind === '1' ? 9 : kind === '2' ? 10 : kind === 'u' ? 11 : 0;
    const fields = minimumFields > 0 ? record.split(' ', minimumFields) : [];
    if (fields.length !== minimumFields) {
      throw new Error('Git returned an invalid porcelain v2 status record.');
    }

    const xy = fields[1];
    const x = xy[0];
    const y = xy[1];
    const code = `${x}${y}`;
    const fixedPrefix = fields.slice(0, minimumFields - 1).join(' ');
    const currentPath = record.slice(fixedPrefix.length + 1);
    let originalPath: string | undefined;
    if (kind === '2') {
      originalPath = records[index + 1];
      if (originalPath === undefined) throw new Error('Git returned an incomplete rename record.');
      index += 1;
    }
    const change = (changeCode: string): FileChange => ({
      code: changeCode,
      path: currentPath,
      ...(originalPath === undefined ? {} : { originalPath }),
    });

    if (code === '??') {
      untracked.push(currentPath);
    } else if (kind === 'u' || CONFLICT_CODES.has(code)) {
      conflicts.push(change(code));
    } else {
      if (x !== '.' && x !== ' ' && x !== '!' && x !== '?') staged.push(change(x));
      if (y !== '.' && y !== ' ' && y !== '!' && y !== '?') unstaged.push(change(y));
    }
  }

  return { repoPath, branch, staged, unstaged, untracked, conflicts };
}

export async function getGitStatus(
  allowed: AllowedRepositories,
  repoPath: string,
  runOptions: GitRunOptions = {},
): Promise<GitStatusResult> {
  const repo = await allowed.requireAllowed(repoPath);
  const result = await runGit(
    repo,
    ['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'],
    { stdoutLimit: STATUS_STDOUT_LIMIT, ...runOptions },
  );
  return parsePorcelainStatus(result.stdout, repo);
}

function normalizePaths(repoPath: string, requestedPaths: readonly string[] | undefined): string[] {
  if (!requestedPaths) return [];
  if (requestedPaths.length > 256) throw new Error('Diff paths cannot contain more than 256 entries.');
  const normalized: string[] = [];
  let argumentBytes = 0;
  for (const requested of requestedPaths) {
    if (!requested || requested.includes('\0')) throw new Error('Diff paths must be non-empty.');
    if (path.isAbsolute(requested)) throw new Error(`Diff paths must be repository-relative: ${requested}`);
    if (requested.split(/[\\/]/).includes('..')) {
      throw new Error(`Diff paths must not contain '..' segments: ${requested}`);
    }
    const absolute = path.resolve(repoPath, requested);
    const relative = path.relative(repoPath, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Diff path escapes the repository: ${requested}`);
    }
    const value = relative || '.';
    argumentBytes += Buffer.byteLength(value) + 1;
    if (argumentBytes > 64 * 1024) throw new Error('Diff paths exceed the command-line size limit.');
    normalized.push(value);
  }
  return normalized;
}

export async function getGitDiff(
  allowed: AllowedRepositories,
  repoPath: string,
  staged = false,
  requestedPaths?: readonly string[],
  runOptions: GitRunOptions = {},
): Promise<GitDiffResult> {
  const repo = await allowed.requireAllowed(repoPath);
  const paths = normalizePaths(repo, requestedPaths);
  const args = [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
    ...(staged ? ['--cached'] : []),
    ...(paths.length > 0 ? ['--', ...paths] : []),
  ];
  const result = await runGit(repo, args, {
    stdoutLimit: DIFF_STDOUT_LIMIT,
    truncateStdout: true,
    ...runOptions,
  });
  return {
    repoPath: repo,
    staged,
    paths,
    patch: result.stdout.toString('utf8'),
    truncated: result.truncated,
    capturedBytes: result.stdout.length,
    byteLimit: runOptions.stdoutLimit ?? DIFF_STDOUT_LIMIT,
  };
}
