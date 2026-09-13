#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/server';
import { AllowedRepositories } from './cos-git-inspect.js';
export declare function parseRepoArgs(args: readonly string[]): string[];
export declare function createServer(allowed: AllowedRepositories): McpServer;
