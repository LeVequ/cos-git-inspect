import { type GitRunOptions } from './git-process.js';
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
export declare class AllowedRepositories {
    private readonly roots;
    private constructor();
    static create(repoArgs: readonly string[]): Promise<AllowedRepositories>;
    requireAllowed(repoPath: string): Promise<string>;
    list(): string[];
}
export declare function parsePorcelainStatus(output: Buffer | string, repoPath: string): GitStatusResult;
export declare function getGitStatus(allowed: AllowedRepositories, repoPath: string, runOptions?: GitRunOptions): Promise<GitStatusResult>;
export declare function getGitDiff(allowed: AllowedRepositories, repoPath: string, staged?: boolean, requestedPaths?: readonly string[], runOptions?: GitRunOptions): Promise<GitDiffResult>;
