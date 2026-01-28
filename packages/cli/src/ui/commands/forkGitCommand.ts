/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import type {
  //CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import { decodeTagName, INITIAL_HISTORY_LENGTH } from '@google/gemini-cli-core';
//import { useCallback } from 'react';
//import { exec } from 'child_process';
import { execSync } from 'node:child_process';

//async function getGitCommitId(context: CommandContext): Promise<string> {
//  const [fullCommitHash, setFullCommitHash] = useState<string | null>(null);
//  const getLatestCommitHash = useCallback(() => {
//    exec('git rev-parse HEAD', (err, stdout, stderr) => {
//      if (err) {
//        setFullCommitHash(null);
//        throw new Error(
//          `Git Error (exec): ${err.message}`,
//        );
//      }
//      if (stderr) {
//        setFullCommitHash(null);
//        throw new Error(
//          `Git Stderr: ${stderr}`,
//        );
//      }
//      const hash = stdout.trim();
//      return hash;
//      //setFullCommitHash(hash);
//      // Pass the raw hash to 'processCommitHash'
//    });
//  }, []); // useCallback ensures this function instance is stable
//  await
//  return
//  //const result = await context.services.toolManager.runTool(
//  //  'run_shell_command',
//  //  {
//  //    command: 'git rev-parse HEAD',
//  //  },
//  //);
//  if (result.stdout) {
//    return result.stdout.trim();
//  }
//  return '';
//}

export const forkGitCommand: SlashCommand = {
  name: 'fork-git',
  description:
    'Save the current conversation as a checkpoint and create a git snapshot. Usage: /fork-git <tag>',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context, args): Promise<SlashCommandActionReturn | void> => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /fork-git <tag>',
      };
    }

    const { logger, config } = context.services;
    await logger.initialize();

    if (!context.overwriteConfirmed) {
      const exists = await logger.checkpointExists(tag);
      if (exists) {
        return {
          type: 'confirm_action',
          prompt: React.createElement(
            Text,
            null,
            'A checkpoint with the tag ',
            React.createElement(Text, { color: theme.text.accent }, tag),
            ' already exists. Do you want to overwrite it?',
          ),
          originalInvocation: {
            raw: context.invocation?.raw || `/fork-git ${tag}`,
          },
        };
      }
    }

    const chat = config?.getGeminiClient()?.getChat();
    if (!chat) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No chat client available to save conversation.',
      };
    }

    const history = chat.getHistory();
    if (history.length > INITIAL_HISTORY_LENGTH) {
      const authType = config?.getContentGeneratorConfig()?.authType;
      //const commitId = await getGitCommitId(context);
      let commitId;
      try {
        commitId = execSync('git rev-parse HEAD').toString().trim();
      } catch (error) {
        commitId = `Error: ${(error as Error).message}`;
      }

      //await logger.saveCheckpoint({ history, authType, commitId }, tag);
      await logger.saveCheckpoint({ history, authType }, tag);
      return {
        type: 'message',
        messageType: 'info',
        content: `Conversation checkpoint saved with tag: ${decodeTagName(
          tag,
        )} and commitId: ${commitId}.`,
      };
    } else {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to save.',
      };
    }
  },
};
