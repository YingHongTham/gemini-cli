/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { CommandContext } from './types.js';
import { forkGitCommand } from './forkGitCommand.js';
import { AuthType } from '@google/gemini-cli-core';

describe('fork-git command', () => {
  let mockContext: CommandContext;
  let mockSaveCheckpoint: ReturnType<typeof vi.fn>;
  let mockRunTool: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSaveCheckpoint = vi.fn().mockResolvedValue(undefined);
    mockRunTool = vi.fn().mockResolvedValue({
      stdout: 'mock-commit-id',
    });
    mockContext = {
      services: {
        config: {
          getGeminiClient: vi.fn().mockReturnValue({
            getChat: vi.fn().mockReturnValue({
              getHistory: vi.fn().mockReturnValue([
                {
                  role: 'user',
                  parts: [{ text: 'some user message' }],
                },
                {
                  role: 'model',
                  parts: [{ text: 'some model response' }],
                },
              ]),
            }),
          }),
          getContentGeneratorConfig: vi.fn().mockReturnValue({
            authType: AuthType.LOGIN_WITH_GOOGLE,
          }),
        },
        logger: {
          initialize: vi.fn().mockResolvedValue(undefined),
          checkpointExists: vi.fn().mockResolvedValue(false),
          saveCheckpoint: mockSaveCheckpoint,
        },
        toolManager: {
          runTool: mockRunTool,
        },
      },
      ui: {
        addItem: vi.fn(),
      },
      overwriteConfirmed: false,
    } as unknown as CommandContext;
  });

  it('should save the conversation and git commit', async () => {
    const tag = 'my-checkpoint';
    const result = await forkGitCommand?.action?.(mockContext, tag);
    expect(mockRunTool).toHaveBeenCalledWith('run_shell_command', {
      command: 'git rev-parse HEAD',
    });
    expect(mockSaveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        commitId: 'mock-commit-id',
      }),
      tag,
    );
    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: `Conversation checkpoint saved with tag: ${tag} and commitId: mock-commit-id.`,
    });
  });
});
