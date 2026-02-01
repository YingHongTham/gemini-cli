/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { SlashCommand, CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { Content } from '@google/genai';
import { AuthType, INITIAL_HISTORY_LENGTH, type GeminiClient } from '@google/gemini-cli-core';

import * as fsPromises from 'node:fs/promises';
import * as fs from 'node:fs';
import { chatGitCommand } from './chatGitCommand.js';
import type { Stats } from 'node:fs';
import type { HistoryItemWithoutId } from '../types.js';
import path from 'node:path';
import { simpleGit, SimpleGit } from 'simple-git';

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
  readdir: vi.fn().mockResolvedValue([] as string[]),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock simple-git
const mockGit = {
  checkIsRepo: vi.fn(),
  status: vi.fn(),
  add: vi.fn(() => mockGit), // Make it chainable
  commit: vi.fn(() => mockGit), // Make it chainable
  revparse: vi.fn(),
  checkout: vi.fn(),
} as unknown as SimpleGit;

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGit),
}));

const chatGitLogFile = '.gemini/chatGitTags.json'; // Assuming this path based on the source code

describe('chatGitCommand', () => {
  const mockFsPromises = vi.mocked(fsPromises);
  const mockFs = vi.mocked(fs);
  const mockSimpleGit = vi.mocked(simpleGit);

  let mockContext: CommandContext;
  let mockGetChat: ReturnType<typeof vi.fn>;
  let mockSaveCheckpoint: ReturnType<typeof vi.fn>;
  let mockLoadCheckpoint: ReturnType<typeof vi.fn>;
  let mockDeleteCheckpoint: ReturnType<typeof vi.fn>;
  let mockCheckpointExists: ReturnType<typeof vi.fn>;
  let mockGetHistory: ReturnType<typeof vi.fn>;

  const getSubCommand = (
    name: 'list' | 'save' | 'resume' | 'delete',
  ): SlashCommand => {
    const subCommand = chatGitCommand.subCommands?.find(
      (cmd) => cmd.name === name,
    );
    if (!subCommand) {
      throw new Error(`/chat-git ${name} command not found.`);
    }
    return subCommand;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetHistory = vi.fn().mockReturnValue([]);
    mockGetChat = vi.fn().mockReturnValue({
      getHistory: mockGetHistory,
    });
    mockSaveCheckpoint = vi.fn().mockResolvedValue(undefined);
    mockLoadCheckpoint = vi.fn().mockResolvedValue({ history: [] });
    mockDeleteCheckpoint = vi.fn().mockResolvedValue(true);
    mockCheckpointExists = vi.fn().mockResolvedValue(false);

    mockContext = createMockCommandContext({
      services: {
        config: {
          getProjectRoot: () => '/project/root',
          getGeminiClient: () =>
            ({
              getChat: mockGetChat,
            }) as unknown as GeminiClient,
          storage: {
            getProjectTempDir: () => '/project/root/.gemini/tmp/mockhash',
          },
          getContentGeneratorConfig: () => ({
            authType: AuthType.LOGIN_WITH_GOOGLE,
          }),
        },
        logger: {
          saveCheckpoint: mockSaveCheckpoint,
          loadCheckpoint: mockLoadCheckpoint,
          deleteCheckpoint: mockDeleteCheckpoint,
          checkpointExists: mockCheckpointExists,
          initialize: vi.fn().mockResolvedValue(undefined),
        },
      },
    });

    // Default mock for simple-git
    mockGit.checkIsRepo.mockResolvedValue(true);
    mockGit.status.mockResolvedValue({ isClean: () => true });
    mockGit.revparse.mockResolvedValue('test-commit-hash');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have the correct main command definition', () => {
    expect(chatGitCommand.name).toBe('chat-git');
    expect(chatGitCommand.description).toBe(
      'Manage conversation history together with git commits',
    );
    expect(chatGitCommand.subCommands).toHaveLength(4);
  });

  describe('list subcommand', () => {
    let listCommand: SlashCommand;

    beforeEach(() => {
      listCommand = getSubCommand('list');
    });

    it('should return an empty list if chatGitLogFile does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      await listCommand.action?.(mockContext, '');
      expect(mockContext.ui.addItem).toHaveBeenCalledWith({
        type: 'chat_list',
        chats: [],
      });
    });

    it('should list chat-git tags and sort them by mtime (ascending by default)', async () => {
      const date1 = new Date('2026-01-01T10:00:00.000Z');
      const date2 = new Date('2026-01-01T11:00:00.000Z');
      const mockChatGitLog = [
        { tag: 'test1', commitHash: 'abc' },
        { tag: 'test2', commitHash: 'def' },
      ];
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify(mockChatGitLog));
      mockFsPromises.stat.mockImplementation(async (path: string) => {
        if (path.includes('test1')) {
          return { mtime: date1 } as Stats;
        }
        return { mtime: date2 } as Stats;
      });

      await listCommand.action?.(mockContext, '');

      expect(mockContext.ui.addItem).toHaveBeenCalledWith({
        type: 'chat_list',
        chats: [
          { name: 'test1', mtime: date1.toISOString() },
          { name: 'test2', mtime: date2.toISOString() },
        ],
      });
    });

    it(`should return an empty list if there's an error reading chatGitLogFile`, async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });

      await listCommand.action?.(mockContext, '');
      expect(mockContext.ui.addItem).toHaveBeenCalledWith({
        type: 'chat_list',
        chats: [],
      });
    });
  });

  describe('save subcommand', () => {
    let saveCommand: SlashCommand;
    const tag = 'my-tag';

    beforeEach(() => {
      saveCommand = getSubCommand('save');
      // Default: chatGitLogFile exists, but empty or no matching tag
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([]));
    });

    it('should return an error if tag is missing', async () => {
      const result = await saveCommand.action?.(mockContext, '  ');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat save <tag>',
      });
    });

    it('should return an error if current directory is not a git repo', async () => {
      mockGit.checkIsRepo.mockResolvedValue(false);
      const result = await saveCommand.action?.(mockContext, tag);
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Current working directory is not git repo. Unable to proceed with chat-git.',
      });
    });

    it('should return an error if checkIsRepo fails', async () => {
      mockGit.checkIsRepo.mockRejectedValue(new Error('Git error'));
      const result = await saveCommand.action?.(mockContext, tag);
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Current working directory is not git repo or checkIsRepo failed. Unable to proceed with chat-git.',
      });
    });

    it('should return confirm_action if checkpoint already exists', async () => {
      mockCheckpointExists.mockResolvedValue(true);
      mockContext.invocation = {
        raw: `/chat-git save ${tag}`,
        name: 'save',
        args: tag,
      };

      const result = await saveCommand.action?.(mockContext, tag);

      expect(mockCheckpointExists).toHaveBeenCalledWith(tag);
      expect(mockSaveCheckpoint).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        type: 'confirm_action',
        originalInvocation: { raw: `/chat-git save ${tag}` },
      });
      expect(result).toHaveProperty('prompt');
    });

    it('should save the conversation if overwrite is confirmed', async () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'context for our chat' }] },
        { role: 'user', parts: [{ text: 'hello' }] },
      ];
      mockGetHistory.mockReturnValue(history);
      mockContext.overwriteConfirmed = true;

      // Mock isClean to return false so a commit is made
      mockGit.status.mockResolvedValue({ isClean: () => false });

      const result = await saveCommand.action?.(mockContext, tag);

      expect(mockCheckpointExists).not.toHaveBeenCalled(); // Should skip existence check
      expect(mockGit.add).toHaveBeenCalledWith('./*');
      expect(mockGit.commit).toHaveBeenCalledWith(
        `commit made with chat-git tag ${tag}`,
        { '--no-verify': null },
      );
      expect(mockGit.revparse).toHaveBeenCalledWith(['HEAD']);
      expect(mockSaveCheckpoint).toHaveBeenCalledWith(
        { history, authType: AuthType.LOGIN_WITH_GOOGLE },
        tag,
      );
      expect(mockFs.writeFileSync).toHaveBeenCalled();
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content:
          `Conversation checkpoint saved with tag: ${tag} and git commit hash test-commit-hash.`,
      });
    });

    it('should not commit if git repo is clean', async () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'context for our chat' }] },
        { role: 'user', parts: [{ text: 'hello' }] },
      ];
      mockGetHistory.mockReturnValue(history);
      mockContext.overwriteConfirmed = false; // No overwrite needed

      // Mock isClean to return true
      mockGit.status.mockResolvedValue({ isClean: () => true });

      await saveCommand.action?.(mockContext, tag);

      expect(mockGit.add).not.toHaveBeenCalled();
      expect(mockGit.commit).not.toHaveBeenCalled();
      expect(mockGit.revparse).toHaveBeenCalledWith(['HEAD']); // Still calls revparse to get current HEAD
    });

    it('should return an error if git operations fail during save', async () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'context for our chat' }] },
        { role: 'user', parts: [{ text: 'hello' }] },
      ];
      mockGetHistory.mockReturnValue(history);
      mockGit.status.mockResolvedValue({ isClean: () => false }); // Force commit
      mockGit.commit.mockRejectedValue(new Error('Commit failed'));

      const result = await saveCommand.action?.(mockContext, tag);

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Failed git add or commit, Error: Commit failed',
      });
    });

    it('should return an error if chatGitLogFile read/write fails', async () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'context for our chat' }] },
        { role: 'user', parts: [{ text: 'hello' }] },
      ];
      mockGetHistory.mockReturnValue(history);
      mockFs.writeFileSync.mockImplementation(() => {
        throw new Error('Write file failed');
      });

      const result = await saveCommand.action?.(mockContext, tag);

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `Reading or writing to ${chatGitLogFile} failed Error: Write file failed`,
      });
    });

    it('should inform if conversation history is empty or only contains system context', async () => {
      mockGetHistory.mockReturnValue([]);
      let result = await saveCommand.action?.(mockContext, tag);
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to save.',
      });

      mockGetHistory.mockReturnValue([{
        role: 'user',
        parts: [{ text: 'context for our chat' }],
      }]);
      result = await saveCommand.action?.(mockContext, tag);
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to save.',
      });

      mockGetHistory.mockReturnValue([
        { role: 'user', parts: [{ text: 'context for our chat' }] },
        { role: 'model', parts: [{ text: 'Got it. Thanks for the context!' }] },
        { role: 'user', parts: [{ text: 'Hello, how are you?' }] },
      ]);
      result = await saveCommand.action?.(mockContext, tag);
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `Conversation checkpoint saved with tag: ${tag} and git commit hash test-commit-hash.`,
      });
    });

    it('should overwrite chatGitLogEntry if tag reused', async () => {
      const history: Content[] = [
        { role: 'user', parts: [{ text: 'context for our chat' }] },
        { role: 'user', parts: [{ text: 'hello' }] },
      ];
      mockGetHistory.mockReturnValue(history);
      mockContext.overwriteConfirmed = false;
      mockGit.status.mockResolvedValue({ isClean: () => false });
      mockGit.revparse.mockResolvedValue('new-commit-hash');

      const existingLog = JSON.stringify([
        { tag: 'my-tag', commitHash: 'old-commit-hash' },
      ]);
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(existingLog);

      await saveCommand.action?.(mockContext, tag);

      const expectedLog = JSON.stringify([
        { tag: 'my-tag', commitHash: 'new-commit-hash' },
      ]);
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        chatGitLogFile,
        expectedLog,
        'utf-8',
      );
    });
  });

  describe('resume subcommand', () => {
    const goodTag = 'good-tag';
    const badTag = 'bad-tag';
    const goodCommitHash = '1234567890abcdef';

    let resumeCommand: SlashCommand;
    beforeEach(() => {
      resumeCommand = getSubCommand('resume');

      // Default mock chatGitLogFile
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([
        { tag: goodTag, commitHash: goodCommitHash },
      ]));
    });

    it('should return an error if tag is missing', async () => {
      const result = await resumeCommand.action?.(mockContext, '');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat-git resume <tag>',
      });
    });

    it('should inform if checkpoint is not found', async () => {
      mockLoadCheckpoint.mockResolvedValue({ history: [] }); // Simulate checkpoint not found

      const result = await resumeCommand.action?.(mockContext, goodTag);

      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `No saved checkpoint found with tag: ${goodTag}.`,
      });
    });

    it('should return an error if no git commit associated with tag', async () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify([
        { tag: 'other-tag', commitHash: 'another-hash' },
      ]));
      mockLoadCheckpoint.mockResolvedValue({
        history: [{ role: 'user', parts: [{ text: 'test' }] }],
        authType: AuthType.LOGIN_WITH_GOOGLE,
      });

      const result = await resumeCommand.action?.(mockContext, goodTag);

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `No git commit associated with tag: ${goodTag}.`,
      });
    });

    it('should return an error if chatGitLogFile read fails', async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });
      mockLoadCheckpoint.mockResolvedValue({
        history: [{ role: 'user', parts: [{ text: 'test' }] }],
        authType: AuthType.LOGIN_WITH_GOOGLE,
      });

      const result = await resumeCommand.action?.(mockContext, goodTag);

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `Error reading from chat-git log file ${chatGitLogFile}, Error: Read error`,
      });
    });

    it('should block resuming a conversation with mismatched authType', async () => {
      const conversation: Content[] = [
        { role: 'user', parts: [{ text: 'system setup' }] },
        { role: 'user', parts: [{ text: 'hello gemini' }] },
        { role: 'model', parts: [{ text: 'hello world' }] },
      ];
      mockLoadCheckpoint.mockResolvedValue({
        history: conversation,
        authType: AuthType.USE_GEMINI,
      });

      const result = await resumeCommand.action?.(mockContext, goodTag);

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          `Cannot resume chat. It was saved with a different authentication method (${AuthType.USE_GEMINI}) than the current one (${AuthType.LOGIN_WITH_GOOGLE}).`,
      });
    });

    it('should return an error if current directory is not a git repo', async () => {
      mockGit.checkIsRepo.mockResolvedValue(false);
      mockLoadCheckpoint.mockResolvedValue({
        history: [{ role: 'user', parts: [{ text: 'test' }] }],
        authType: AuthType.LOGIN_WITH_GOOGLE,
      });

      const result = await resumeCommand.action?.(mockContext, goodTag);

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content:
          'Current working directory is not git repo. Unable to proceed with chat-git.',
      });
    });

    it('should return an error if git repo is not clean', async () => {
      mockGit.status.mockResolvedValue({ isClean: () => false });
      mockLoadCheckpoint.mockResolvedValue({
        history: [{ role: 'user', parts: [{ text: 'test' }] }],
        authType: AuthType.LOGIN_WITH_GOOGLE,
      });

      const result = await resumeCommand.action?.(mockContext, goodTag);

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Git repo is not clean, unable to checkout.',
      });
    });

    it('should return an error if git checkout fails', async () => {
      mockGit.checkout.mockRejectedValue(new Error('Checkout failed'));
      mockLoadCheckpoint.mockResolvedValue({
        history: [{ role: 'user', parts: [{ text: 'test' }] }],
        authType: AuthType.LOGIN_WITH_GOOGLE,
      });

      const result = await resumeCommand.action?.(mockContext, goodTag);

      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `Failed git checkout ${goodCommitHash}, Error: Checkout failed`,
      });
    });

    it('should resume a conversation with matching authType and checkout git commit', async () => {
      const conversation: Content[] = [
        { role: 'user', parts: [{ text: 'context' }] }, // Initial history
        { role: 'user', parts: [{ text: 'hello gemini' }] },
        { role: 'model', parts: [{ text: 'hello world' }] },
      ];
      mockLoadCheckpoint.mockResolvedValue({
        history: conversation,
        authType: AuthType.LOGIN_WITH_GOOGLE,
      });

      const result = await resumeCommand.action?.(mockContext, goodTag);

      expect(mockGit.checkout).toHaveBeenCalledWith(goodCommitHash);
      expect(result).toEqual({
        type: 'load_history',
        history: [
          { type: 'user', text: 'hello gemini' },
          { type: 'gemini', text: 'hello world' },
        ] as HistoryItemWithoutId[],
        clientHistory: conversation,
      });
    });

    it('should resume a legacy conversation without authType and checkout git commit', async () => {
      const conversation: Content[] = [
        { role: 'user', parts: [{ text: 'context' }] }, // Initial history
        { role: 'user', parts: [{ text: 'hello gemini' }] },
        { role: 'model', parts: [{ text: 'hello world' }] },
      ];
      mockLoadCheckpoint.mockResolvedValue({ history: conversation }); // No authType

      const result = await resumeCommand.action?.(mockContext, goodTag);

      expect(mockGit.checkout).toHaveBeenCalledWith(goodCommitHash);
      expect(result).toEqual({
        type: 'load_history',
        history: [
          { type: 'user', text: 'hello gemini' },
          { type: 'gemini', text: 'hello world' },
        ] as HistoryItemWithoutId[],
        clientHistory: conversation,
      });
    });

    describe('completion', () => {
      it('should provide completion suggestions based on chatGitLogFile', async () => {
        const date1 = new Date('2026-01-01T10:00:00.000Z');
        const date2 = new Date('2026-01-01T11:00:00.000Z');
        const mockChatGitLog = [
          { tag: 'alpha', commitHash: 'hashA' },
          { tag: 'beta', commitHash: 'hashB' },
        ];
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockChatGitLog));
        // Mock stat calls for the checkpoints that would be checked by getSavedChatGitTags
        mockFsPromises.stat.mockImplementation(async (path: string) => {
            if (path.includes('alpha')) {
              return { mtime: date1 } as Stats;
            }
            return { mtime: date2 } as Stats;
          });

        const result = await resumeCommand.completion?.(mockContext, 'b');

        expect(result).toEqual(['beta']);
      });

      it('should suggest filenames sorted by modified time (newest first)', async () => {
        const date1 = new Date('2026-01-01T10:00:00.000Z');
        const date2 = new Date('2026-01-01T11:00:00.000Z');
        const mockChatGitLog = [
          { tag: 'test1', commitHash: 'hash1' },
          { tag: 'test2', commitHash: 'hash2' },
        ];
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockChatGitLog));
        // Mock stat calls for the checkpoints that would be checked by getSavedChatGitTags
        mockFsPromises.stat.mockImplementation(async (path: string) => {
            if (path.includes('test1')) {
              return { mtime: date1 } as Stats;
            }
            return { mtime: date2 } as Stats;
          });

        const result = await resumeCommand.completion?.(mockContext, '');
        expect(result).toEqual(['test2', 'test1']);
      });
    });
  });

  describe('delete subcommand', () => {
    let deleteCommand: SlashCommand;
    const tag = 'my-tag';
    const commitHash = '12345';

    beforeEach(() => {
      deleteCommand = getSubCommand('delete');
      // Default mock chatGitLogFile
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(JSON.stringify([
        { tag: tag, commitHash: commitHash },
      ]));
    });

    it('should return an error if tag is missing', async () => {
      const result = await deleteCommand.action?.(mockContext, ' ');
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat-git delete <tag>',
      });
    });

    it('should return an error if tag is not associated with git snapshot', async () => {
      mockFs.readFileSync.mockReturnValue(JSON.stringify([
        { tag: 'other-tag', commitHash: 'abc' },
      ]));
      const result = await deleteCommand.action?.(mockContext, tag);
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `Tag not associated with git snapshot, ${tag}`,
      });
    });

    it('should return an error if chatGitLogFile read/write fails', async () => {
      mockFs.readFileSync.mockImplementation(() => {
        throw new Error('Read error');
      });
      const result = await deleteCommand.action?.(mockContext, tag);
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `Reading or writing to ${chatGitLogFile} failed, Error: Read error`,
      });
    });

    it('should return an error if checkpoint is not found', async () => {
      mockDeleteCheckpoint.mockResolvedValue(false);
      const result = await deleteCommand.action?.(mockContext, tag);
      expect(result).toEqual({
        type: 'message',
        messageType: 'error',
        content: `Error: No checkpoint found with tag '${tag}'.`,
      });
    });

    it('should delete the conversation checkpoint and update chatGitLogFile', async () => {
      const initialChatGitLog = [
        { tag: 'my-tag', commitHash: '123' },
        { tag: 'another-tag', commitHash: '456' },
      ];
      mockFs.readFileSync.mockReturnValue(JSON.stringify(initialChatGitLog));

      const result = await deleteCommand.action?.(mockContext, tag);

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        chatGitLogFile,
        JSON.stringify([{ tag: 'another-tag', commitHash: '456' }]),
        'utf-8',
      );
      expect(mockDeleteCheckpoint).toHaveBeenCalledWith(tag);
      expect(result).toEqual({
        type: 'message',
        messageType: 'info',
        content: `Conversation checkpoint '${tag}' has been deleted.`,
      });
    });

    describe('completion', () => {
      it('should provide completion suggestions based on chatGitLogFile', async () => {
        const date1 = new Date('2026-01-01T10:00:00.000Z');
        const date2 = new Date('2026-01-01T11:00:00.000Z');
        const mockChatGitLog = [
          { tag: 'alpha', commitHash: 'hashA' },
          { tag: 'beta', commitHash: 'hashB' },
        ];
        mockFs.existsSync.mockReturnValue(true);
        mockFs.readFileSync.mockReturnValue(JSON.stringify(mockChatGitLog));
        // Mock stat calls for the checkpoints that would be checked by getSavedChatGitTags
        mockFsPromises.stat.mockImplementation(async (path: string) => {
            if (path.includes('alpha')) {
              return { mtime: date1 } as Stats;
            }
            return { mtime: date2 } as Stats;
          });

        const result = await deleteCommand.completion?.(mockContext, 'a');

        expect(result).toEqual(['alpha']);
      });
    });
  });
});