import { spawn } from 'node:child_process';

export const DEFAULT_TIMEOUT_MS = 10_000;
export const STATUS_STDOUT_LIMIT = 2 * 1024 * 1024;
export const DIFF_STDOUT_LIMIT = 1024 * 1024;
const STDERR_LIMIT = 64 * 1024;

export interface GitRunOptions {
  timeoutMs?: number;
  stdoutLimit?: number;
  truncateStdout?: boolean;
}

export interface GitRunResult {
  stdout: Buffer;
  stderr: string;
  truncated: boolean;
}

export class GitCommandError extends Error {
  constructor(message: string, readonly code?: number | null) {
    super(message);
    this.name = 'GitCommandError';
  }
}

export async function runGit(
  repoPath: string,
  commandArgs: readonly string[],
  options: GitRunOptions = {},
): Promise<GitRunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stdoutLimit = options.stdoutLimit ?? STATUS_STDOUT_LIMIT;
  const truncateStdout = options.truncateStdout ?? false;

  return new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      [
        '--no-optional-locks',
        '--literal-pathspecs',
        '-c',
        'color.ui=false',
        '-c',
        'core.pager=cat',
        '-c',
        'diff.external=',
        '-c',
        'diff.trustExitCode=false',
        '-C',
        repoPath,
        ...commandArgs,
      ],
      {
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_PAGER: 'cat',
          GIT_TERMINAL_PROMPT: '0',
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let limitExceeded = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    timer.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= stdoutLimit) {
        if (truncateStdout) {
          truncated = true;
        } else {
          limitExceeded = true;
        }
        child.kill();
        return;
      }
      const remaining = stdoutLimit - stdoutBytes;
      if (chunk.length <= remaining) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
        return;
      }

      stdoutChunks.push(chunk.subarray(0, remaining));
      stdoutBytes += remaining;
      if (truncateStdout) {
        truncated = true;
      } else {
        limitExceeded = true;
      }
      child.kill();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= STDERR_LIMIT) return;
      const remaining = STDERR_LIMIT - stderrBytes;
      stderrChunks.push(chunk.subarray(0, remaining));
      stderrBytes += Math.min(chunk.length, remaining);
    });

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new GitCommandError(`Unable to start Git: ${error.message}`));
    });

    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (timedOut) {
        reject(new GitCommandError(`Git timed out after ${timeoutMs} ms.`));
        return;
      }
      if (limitExceeded) {
        reject(new GitCommandError(`Git output exceeded the ${stdoutLimit}-byte limit.`));
        return;
      }
      if (code !== 0 && !truncated) {
        const detail = stderr ? ` ${stderr}` : '';
        reject(new GitCommandError(`Git exited with code ${code}.${detail}`, code));
        return;
      }
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr, truncated });
    });
  });
}
