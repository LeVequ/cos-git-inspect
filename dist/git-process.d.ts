export declare const DEFAULT_TIMEOUT_MS = 10000;
export declare const STATUS_STDOUT_LIMIT: number;
export declare const DIFF_STDOUT_LIMIT: number;
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
export declare class GitCommandError extends Error {
    readonly code?: number | null | undefined;
    constructor(message: string, code?: number | null | undefined);
}
export declare function runGit(repoPath: string, commandArgs: readonly string[], options?: GitRunOptions): Promise<GitRunResult>;
