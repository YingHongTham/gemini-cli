/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Helper to run git commands and return stdout/stderr.
 */
const runGit = async (
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> => {
  const command = `git ${args.join(' ')}`;
  return execAsync(command, { cwd });
};

// --- Subcommands ---

const statusCommand: SlashCommand = {
  name: 'status',
  altNames: ['st'],
  description: 'Show working tree status',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (_context): Promise<SlashCommandActionReturn> => {
    try {
      const { stdout } = await runGit(['status', '--short']);
      return {
        type: 'message',
        messageType: 'info',
        content: stdout || 'Working tree clean',
      };
    } catch (err) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Git error: ${(err as Error).message}`,
      };
    }
  },
};

const branchCommand: SlashCommand = {
  name: 'branch',
  altNames: ['br'],
  description: 'List branches',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (_context): Promise<SlashCommandActionReturn> => {
    try {
      const { stdout } = await runGit(['branch', '-vv']);
      return {
        type: 'message',
        messageType: 'info',
        content: stdout || 'No branches found',
      };
    } catch (err) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Git error: ${(err as Error).message}`,
      };
    }
  },
};

const logCommand: SlashCommand = {
  name: 'log',
  description: 'Show recent commits. Usage: /git log [count]',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (_context, args): Promise<SlashCommandActionReturn> => {
    try {
      const count = parseInt(args.trim(), 10) || 10;
      const { stdout } = await runGit([
        'log',
        '--oneline',
        '--graph',
        `-n${count}`,
      ]);
      return {
        type: 'message',
        messageType: 'info',
        content: stdout || 'No commits found',
      };
    } catch (err) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Git error: ${(err as Error).message}`,
      };
    }
  },
};

const diffCommand: SlashCommand = {
  name: 'diff',
  description: 'Show unstaged changes. Usage: /git diff [file]',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (_context, args): Promise<SlashCommandActionReturn> => {
    try {
      const file = args.trim();
      const gitArgs = file ? ['diff', '--stat', file] : ['diff', '--stat'];
      const { stdout } = await runGit(gitArgs);
      return {
        type: 'message',
        messageType: 'info',
        content: stdout || 'No changes',
      };
    } catch (err) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Git error: ${(err as Error).message}`,
      };
    }
  },
};

// --- Worktree subcommands ---

const worktreeListCommand: SlashCommand = {
  name: 'list',
  altNames: ['ls'],
  description: 'List all worktrees',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (_context): Promise<SlashCommandActionReturn> => {
    try {
      const { stdout } = await runGit(['worktree', 'list']);
      return {
        type: 'message',
        messageType: 'info',
        content: stdout || 'No worktrees found',
      };
    } catch (err) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Git error: ${(err as Error).message}`,
      };
    }
  },
};

const worktreeAddCommand: SlashCommand = {
  name: 'add',
  description:
    'Add a new worktree. Usage: /git worktree add <path> [branch] [-b]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (_context, args): Promise<SlashCommandActionReturn> => {
    const parts = args.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) {
      return {
        type: 'message',
        messageType: 'error',
        content:
          'Usage: /git worktree add <path> [branch]\n       /git worktree add <path> -b <new-branch>',
      };
    }

    try {
      const gitArgs = ['worktree', 'add', ...parts];
      const { stdout, stderr } = await runGit(gitArgs);
      const output = stdout || stderr;
      return {
        type: 'message',
        messageType: 'info',
        content: output || `Worktree created at ${parts[0]}`,
      };
    } catch (err) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Git error: ${(err as Error).message}`,
      };
    }
  },
  completion: async (_context, partialArg) => {
    // Suggest existing branches for completion
    try {
      const { stdout } = await runGit([
        'branch',
        '--format=%(refname:short)',
        '-a',
      ]);
      const branches = stdout
        .split('\n')
        .map((b) => b.trim())
        .filter((b) => b && b.startsWith(partialArg));
      return branches;
    } catch {
      return [];
    }
  },
};

const worktreeRemoveCommand: SlashCommand = {
  name: 'remove',
  altNames: ['rm'],
  description: 'Remove a worktree. Usage: /git worktree remove <path>',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (_context, args): Promise<SlashCommandActionReturn> => {
    const worktreePath = args.trim();
    if (!worktreePath) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /git worktree remove <path>',
      };
    }

    try {
      const { stdout, stderr } = await runGit([
        'worktree',
        'remove',
        worktreePath,
      ]);
      const output = stdout || stderr;
      return {
        type: 'message',
        messageType: 'info',
        content: output || `Worktree at ${worktreePath} removed`,
      };
    } catch (err) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Git error: ${(err as Error).message}`,
      };
    }
  },
  completion: async (_context, partialArg) => {
    // Suggest existing worktree paths for completion
    try {
      const { stdout } = await runGit(['worktree', 'list', '--porcelain']);
      const paths: string[] = [];
      for (const line of stdout.split('\n')) {
        if (line.startsWith('worktree ')) {
          const path = line.substring('worktree '.length);
          if (path.startsWith(partialArg)) {
            paths.push(path);
          }
        }
      }
      return paths;
    } catch {
      return [];
    }
  },
};

const worktreePruneCommand: SlashCommand = {
  name: 'prune',
  description: 'Prune stale worktree information',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (_context): Promise<SlashCommandActionReturn> => {
    try {
      const { stdout, stderr } = await runGit(['worktree', 'prune', '-v']);
      const output = stdout || stderr;
      return {
        type: 'message',
        messageType: 'info',
        content: output || 'No stale worktrees to prune',
      };
    } catch (err) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Git error: ${(err as Error).message}`,
      };
    }
  },
};

const worktreeCommand: SlashCommand = {
  name: 'worktree',
  altNames: ['wt'],
  description: 'Manage git worktrees',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [
    worktreeListCommand,
    worktreeAddCommand,
    worktreeRemoveCommand,
    worktreePruneCommand,
  ],
};

// --- Main git command ---

export const gitCommand: SlashCommand = {
  name: 'git',
  altNames: ['g'],
  description: 'Git version control commands',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [
    statusCommand,
    branchCommand,
    logCommand,
    diffCommand,
    worktreeCommand,
  ],
};
