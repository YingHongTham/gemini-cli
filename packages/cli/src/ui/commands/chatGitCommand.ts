/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'node:fs/promises';
import { existsSync } from 'node:fs';
import React from 'react';
import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import {
  decodeTagName,
  type MessageActionReturn,
  INITIAL_HISTORY_LENGTH,
} from '@google/gemini-cli-core';
import path from 'node:path';
import type {
  HistoryItemWithoutId,
  HistoryItemChatList,
  ChatDetail,
} from '../types.js';
import { MessageType } from '../types.js';
import { exportHistoryToFile } from '../utils/historyExportUtils.js';
import { convertToRestPayload } from '@google/gemini-cli-core';
import { simpleGit } from 'simple-git';

// TODO chnage to something not hard-coded
const tmpDir = '~/.gemini/tmp/21937cce77e17d9cc3656b8e088756efd1af063cdd5ce8d4484a0fe0f98c9c2c/';

const getSavedChatGitTags = async (
  context: CommandContext,
  mtSortDesc: boolean,
): Promise<ChatDetail[]> => {
  const cfg = context.services.config;
  const geminiDir = cfg?.storage?.getProjectTempDir();
  if (!geminiDir) {
    return [];
  }
  try {
    const file_head = 'chatGit-';
    const file_tail = '.json';
    const files = await fsPromises.readdir(geminiDir);
    const chatDetails: ChatDetail[] = [];

    for (const file of files) {
      if (file.startsWith(file_head) && file.endsWith(file_tail)) {
        const filePath = path.join(geminiDir, file);
        const stats = await fsPromises.stat(filePath);
        const tagName = file.slice(file_head.length, -file_tail.length);
        chatDetails.push({
          name: decodeTagName(tagName),
          mtime: stats.mtime.toISOString(),
        });
      }
    }

    chatDetails.sort((a, b) =>
      mtSortDesc
        ? b.mtime.localeCompare(a.mtime)
        : a.mtime.localeCompare(b.mtime),
    );

    return chatDetails;
  } catch (_err) {
    return [];
  }
};

const listCommand: SlashCommand = {
  name: 'list',
  description: 'List tags of conversations checkpointed by chat-git',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context): Promise<void> => {
    const chatDetails = await getSavedChatGitTags(context, false);

    const item: HistoryItemChatList = {
      type: MessageType.CHAT_LIST,
      chats: chatDetails,
    };

    context.ui.addItem(item);
  },
};

const saveCommand: SlashCommand = {
  name: 'save',
  description:
    'Save the current conversation as a checkpoint and commit current state to git. Usage: /chat-git save <tag>',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context, args): Promise<SlashCommandActionReturn | void> => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat save <tag>',
      };
    }

    const { logger, config } = context.services;
    await logger.initialize();

    const repo = simpleGit(process.cwd());
    try {
      const isRepoDefined = await repo.checkIsRepo();
      if (!isRepoDefined) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Current working directory is not git repo. Unable to proceed with chat-git.',
        };
      }
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Current working directory is not git repo or checkIsRepo failed. Unable to proceed with chat-git.',
      };
    }

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
            raw: context.invocation?.raw || `/chat-git save ${tag}`,
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
    if (history.length <= INITIAL_HISTORY_LENGTH) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to save.',
      };
    }


    let commitHash;
    try {
      //const gitStatus = await repo.status(['--porcelain']);
      //if (!gitStatus.isClean()) {
      //  if (!context.overwriteConfirmed) {
      //    return {
      //      type: 'confirm_action',
      //      prompt: React.createElement(
      //        Text,
      //        null,
      //        'Repo not clean, add all and commit all changes?',
      //      ),
      //      originalInvocation: {
      //        raw: context.invocation?.raw || `/chat-git save ${tag}`,
      //      },
      //    };
      //  }
      //}
      const gitStatus = await repo.status(['--porcelain']);
      if (!gitStatus.isClean()) {
        await repo
          .add('./*')
          .addTag(`chat-git-${tag}`)
          .commit(`commit made with chat-git tag ${tag}`, { '--no-verify':null });
      }
      commitHash = await repo.revparse(['HEAD']);
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Git branch, checkout, add, or commit failed, ${error}`,
      };
    }

    const authType = config?.getContentGeneratorConfig()?.authType;
    await logger.saveCheckpoint({ history, authType }, tag);
    const chatGitLogEntry = {
      //sessionId: logger.sessionId,
      //timeStamp: logger.timestamp,
      commitHash: commitHash,
      tag: tag,
    };
    //const cfg = context.services.config;
    const geminiDir = tmpDir; // TODO tmpDir is currently hard coded
    const chatGitLogFile = path.join(geminiDir, "chat-git-log.jsonl");
    if (!existsSync(chatGitLogFile)) {
      fsPromises.writeFile(chatGitLogFile, JSON.stringify(chatGitLogEntry));
    } else {
      fsPromises.appendFile(chatGitLogFile, JSON.stringify(chatGitLogEntry));
    }
    return {
      type: 'message',
      messageType: 'info',
      content: `Conversation checkpoint saved with tag: ${decodeTagName(
        tag,
      )}.`,
    };
  },
};

const resumeCommand: SlashCommand = {
  name: 'resume',
  altNames: ['load'],
  description:
    'Resume a conversation and snapshot from a checkpoint. Usage: /chat-git resume <tag>',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, args) => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat resume <tag>',
      };
    }

    const { logger, config } = context.services;
    await logger.initialize();
    const checkpoint = await logger.loadCheckpoint(tag);
    const conversation = checkpoint.history;

    if (conversation.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content: `No saved checkpoint found with tag: ${decodeTagName(tag)}.`,
      };
    }

    const currentAuthType = config?.getContentGeneratorConfig()?.authType;
    if (
      checkpoint.authType &&
      currentAuthType &&
      checkpoint.authType !== currentAuthType
    ) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Cannot resume chat. It was saved with a different authentication method (${checkpoint.authType}) than the current one (${currentAuthType}).`,
      };
    }

    const rolemap: { [key: string]: MessageType } = {
      user: MessageType.USER,
      model: MessageType.GEMINI,
    };

    const uiHistory: HistoryItemWithoutId[] = [];

    for (const item of conversation.slice(INITIAL_HISTORY_LENGTH)) {
      const text =
        item.parts
          ?.filter((m) => !!m.text)
          .map((m) => m.text)
          .join('') || '';
      if (!text) {
        continue;
      }

      uiHistory.push({
        type: (item.role && rolemap[item.role]) || MessageType.GEMINI,
        text,
      } as HistoryItemWithoutId);
    }
    return {
      type: 'load_history',
      history: uiHistory,
      clientHistory: conversation,
    };
  },
  completion: async (context, partialArg) => {
    const chatDetails = await getSavedChatGitTags(context, true);
    return chatDetails
      .map((chat) => chat.name)
      .filter((name) => name.startsWith(partialArg));
  },
};

const deleteCommand: SlashCommand = {
  name: 'delete',
  description: 'Delete a conversation checkpoint. Usage: /chat delete <tag>',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, args): Promise<MessageActionReturn> => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat delete <tag>',
      };
    }

    const { logger } = context.services;
    await logger.initialize();
    const deleted = await logger.deleteCheckpoint(tag);

    if (deleted) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Conversation checkpoint '${decodeTagName(tag)}' has been deleted.`,
      };
    } else {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error: No checkpoint found with tag '${decodeTagName(tag)}'.`,
      };
    }
  },
  completion: async (context, partialArg) => {
    const chatDetails = await getSavedChatGitTags(context, true);
    return chatDetails
      .map((chat) => chat.name)
      .filter((name) => name.startsWith(partialArg));
  },
};

const shareCommand: SlashCommand = {
  name: 'share',
  description:
    'Share the current conversation to a markdown or json file. Usage: /chat share <file>',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context, args): Promise<MessageActionReturn> => {
    let filePathArg = args.trim();
    if (!filePathArg) {
      filePathArg = `gemini-conversation-${Date.now()}.json`;
    }

    const filePath = path.resolve(filePathArg);
    const extension = path.extname(filePath);
    if (extension !== '.md' && extension !== '.json') {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Invalid file format. Only .md and .json are supported.',
      };
    }

    const chat = context.services.config?.getGeminiClient()?.getChat();
    if (!chat) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No chat client available to share conversation.',
      };
    }

    const history = chat.getHistory();

    // An empty conversation has a hidden message that sets up the context for
    // the chat. Thus, to check whether a conversation has been started, we
    // can't check for length 0.
    if (history.length <= INITIAL_HISTORY_LENGTH) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to share.',
      };
    }

    try {
      await exportHistoryToFile({ history, filePath });
      return {
        type: 'message',
        messageType: 'info',
        content: `Conversation shared to ${filePath}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        type: 'message',
        messageType: 'error',
        content: `Error sharing conversation: ${errorMessage}`,
      };
    }
  },
};

export const debugCommand: SlashCommand = {
  name: 'debug',
  description: 'Export the most recent API request as a JSON payload',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context): Promise<MessageActionReturn> => {
    const req = context.services.config?.getLatestApiRequest();
    if (!req) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No recent API request found to export.',
      };
    }

    const restPayload = convertToRestPayload(req);
    const filename = `gcli-request-${Date.now()}.json`;
    const filePath = path.join(process.cwd(), filename);

    try {
      await fsPromises.writeFile(
        filePath,
        JSON.stringify(restPayload, null, 2),
      );
      return {
        type: 'message',
        messageType: 'info',
        content: `Debug API request saved to ${filename}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        type: 'message',
        messageType: 'error',
        content: `Error saving debug request: ${errorMessage}`,
      };
    }
  },
};

export const chatGitCommand: SlashCommand = {
  name: 'chat-git',
  description: 'Manage conversation history together with git commits',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [
    listCommand,
    saveCommand,
    resumeCommand,
    deleteCommand,
    shareCommand,
  ],
};
