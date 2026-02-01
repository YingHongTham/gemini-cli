/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'node:fs/promises';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
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
import { simpleGit } from 'simple-git';

// TODO chnage to something not hard-coded
const projectGeminiDir = '.gemini';
const chatGitLogFile = path.join(projectGeminiDir, 'chatGitTags.json');

const getSavedChatGitTags = async (
  context: CommandContext,
  mtSortDesc: boolean,
): Promise<ChatDetail[]> => {
  let chatGitLogStr;
  if (!existsSync(chatGitLogFile)) {
    return [];
  }
  try {
    chatGitLogStr = readFileSync(chatGitLogFile, 'utf-8');
  } catch (err) {
    // TODO ideally log the read error, as file may actually exist
    return [];
  }
  const chatGitLog = JSON.parse(chatGitLogStr);

  const cfg = context.services.config;
  const geminiDir = cfg?.storage?.getProjectTempDir();
  if (!geminiDir) {
    return [];
  }
  try {
    const file_head = 'checkpoint-';
    const file_tail = '.json';
    //const files = await fsPromises.readdir(geminiDir);
    const chatDetails: ChatDetail[] = [];

    for (const entry of chatGitLog) {
      const filePath = path.join(geminiDir, file_head + entry.tag + file_tail);
      const stats = await fsPromises.stat(filePath);
      chatDetails.push({
        name: decodeTagName(entry.tag),
        mtime: stats.mtime.toISOString(),
      });
    }

    chatDetails.sort((a, b) =>
      mtSortDesc
        ? b.mtime.localeCompare(a.mtime)
        : a.mtime.localeCompare(b.mtime),
    );

    return chatDetails;
  } catch (_err) {
    return [];
    //return [{ name : `${_err}`, mtime : '' }];
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
      const gitStatus = await repo.status(['--porcelain']);
      if (!gitStatus.isClean()) {
        await repo
          .add('./*')
          //.addTag(`chat-git-${tag}`) // problems with overwrite, maybe unnecessary
          .commit(`commit made with chat-git tag ${tag}`, { '--no-verify':null });
      }
      commitHash = await repo.revparse(['HEAD']);
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed git add or commit, ${error}`,
      };
    }

    const authType = config?.getContentGeneratorConfig()?.authType;
    await logger.saveCheckpoint({ history, authType }, tag);
    const chatGitLogEntry = {
      //sessionId: logger.sessionId, // would be nice to add
      //timeStamp: logger.timestamp, // but these are private attributes
      commitHash: commitHash,
      tag: tag,
    };
    try {
      if (!existsSync(chatGitLogFile)) {
        const chatGitLog = [chatGitLogEntry];
        writeFileSync(chatGitLogFile, JSON.stringify(chatGitLog), 'utf-8');
      } else {
          const chatGitLog = JSON.parse(readFileSync(chatGitLogFile, 'utf-8'));
          // overwrite entry if tag reused
          const tagReused = chatGitLog.find((entry : { commitHash : string; tag : string }) => {
            if (entry.tag != tag) return false;
            entry.commitHash = commitHash;
            return true;
          });
          if (!tagReused) chatGitLog.push(chatGitLogEntry);
          writeFileSync(chatGitLogFile, JSON.stringify(chatGitLog), 'utf-8');
      }
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Reading or writing to ${chatGitLogFile} failed ${error}`,
      };
    }
    return {
      type: 'message',
      messageType: 'info',
      content: `Conversation checkpoint saved with tag: ${decodeTagName(
        tag,
      )} and git commit hash ${commitHash}.`,
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
        content: 'Missing tag. Usage: /chat-git resume <tag>',
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

    let chatGitLogStr, commitHash;
    try {
      chatGitLogStr = readFileSync(chatGitLogFile, 'utf-8');
      const chatGitLog = JSON.parse(chatGitLogStr);
      const tagFound = chatGitLog.find((entry : { commitHash : string; tag : string }) => {
        if (entry.tag == tag) {
          commitHash = entry.commitHash;
          return true;
        }
        return false;
      });
      if (!tagFound) {
        return {
          type: 'message',
          messageType: 'error',
          content: `No git commit associated with tag: ${decodeTagName(tag)}.`,
        };
      }
    } catch (err) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error reading from chat-git log file ${chatGitLogFile}, ${err}`,
      };
    };

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

    // check git stuff, all other checks done, perform git checkout here
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
    try {
      const gitStatus = await repo.status(['--porcelain']);
      if (!gitStatus.isClean()) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Git repo is not clean, unable to checkout.',
        };
      }
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed checking git repo status, ${error}`,
      };
    }
    try {
      await repo.checkout(commitHash);
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed git checkout ${commitHash}, ${error}`,
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
  description: 'Delete a conversation checkpoint (git snapshot remains). Usage: /chat-git delete <tag>',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, args): Promise<MessageActionReturn> => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat-git delete <tag>',
      };
    }

    // delete entry from chatGitLogFile first, as it's still possible to recover
    // the chat with given tag will still be there
    try {
      const chatGitLog = JSON.parse(readFileSync(chatGitLogFile, 'utf-8'));
      const tagIndex = chatGitLog.findIndex((entry : { commitHash : string; tag : string }) => {
        return entry.tag == tag;
      });
      if (!tagIndex) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Tag not associated with git snapshot, ${tag}`,
        };
      }
      chatGitLog.splice(tagIndex, 1);
      writeFileSync(chatGitLogFile, JSON.stringify(chatGitLog), 'utf-8');
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Reading or writing to ${chatGitLogFile} failed, ${error}`,
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
  ],
};
