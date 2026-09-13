#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { AllowedRepositories } from './git-inspect.js';
export declare function parseRepoArgs(args: readonly string[]): string[];
export declare function createServer(allowed: AllowedRepositories): McpServer;
