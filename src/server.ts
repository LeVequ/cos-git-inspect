#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { AllowedRepositories, getGitDiff, getGitStatus } from './cos-git-inspect.js';

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

function usage(): string {
  return 'Usage: cos-git-inspect --repo <absolute-path> [--repo <absolute-path> ...]';
}

export function parseRepoArgs(args: readonly string[]): string[] {
  const repos: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (arg === '--repo') {
      const value = args[index + 1];
      if (!value) throw new Error(`--repo requires a path. ${usage()}`);
      repos.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--repo=')) {
      const value = arg.slice('--repo='.length);
      if (!value) throw new Error(`--repo requires a path. ${usage()}`);
      repos.push(value);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}. ${usage()}`);
  }
  return repos;
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: message }],
  };
}

export function createServer(allowed: AllowedRepositories): McpServer {
  const server = new McpServer({ name: 'cos_git_inspect', version: '0.1.0' });

  server.registerTool(
    'cos_git_status',
    {
      title: 'Git status',
      description:
        'Return branch, staged, unstaged, untracked, and conflict status for an explicitly allowed Git repository.',
      inputSchema: {
        repo_path: z.string().min(1).describe('Absolute path of a repository allowed at server startup.'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ repo_path }) => {
      try {
        const status = await getGitStatus(allowed, repo_path);
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
          structuredContent: status,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    'cos_git_diff',
    {
      title: 'Git diff',
      description:
        'Return a bounded unified patch for unstaged changes, or staged changes when staged is true.',
      inputSchema: {
        repo_path: z.string().min(1).describe('Absolute path of a repository allowed at server startup.'),
        staged: z.boolean().optional().default(false).describe('Inspect staged changes instead of unstaged changes.'),
        paths: z
          .array(z.string().min(1))
          .max(256)
          .optional()
          .describe('Optional repository-relative paths to include.'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ repo_path, staged, paths }) => {
      try {
        const diff = await getGitDiff(allowed, repo_path, staged, paths);
        const prefix = diff.truncated
          ? `[cos_git_diff truncated at ${diff.byteLimit} bytes]\n`
          : '';
        return {
          content: [{ type: 'text', text: `${prefix}${diff.patch}` }],
          structuredContent: diff,
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

async function main(): Promise<void> {
  const repos = parseRepoArgs(process.argv.slice(2));
  const allowed = await AllowedRepositories.create(repos);
  serveStdio(() => createServer(allowed), {
    legacy: 'serve',
    onerror: (error) => console.error(`cos_git_inspect transport: ${error.message}`),
  });
  console.error(`cos_git_inspect ready for ${allowed.list().length} allowed repository(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`cos_git_inspect: ${message}`);
    process.exitCode = 1;
  });
}
