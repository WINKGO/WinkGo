// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { mutate } from 'swr';
import {
  clearConversationMemoryCache,
  getConversationOrNull,
  peekConversationCache,
  primeConversationCache,
  refreshConversationCache,
} from '@/renderer/pages/conversation/utils/conversationCache';

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      get: {
        invoke: vi.fn(),
      },
    },
  },
}));

vi.mock('swr', () => ({
  mutate: vi.fn(),
}));

const mockConversation = {
  id: 'conv-1',
  name: 'Test conversation',
  type: 'acp',
  status: 'finished',
  extra: {},
} as TChatConversation;

describe('conversationCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearConversationMemoryCache();
  });

  describe('getConversationOrNull', () => {
    it('returns null when the backend reports a missing conversation', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/missing',
        status: 404,
        body: {
          success: false,
          error: 'Not found: Conversation missing not found',
          code: 'NOT_FOUND',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(getConversationOrNull('missing')).resolves.toBeNull();
    });

    it('returns the conversation when the backend lookup succeeds', async () => {
      vi.mocked(ipcBridge.conversation.get.invoke).mockResolvedValue(mockConversation);

      await expect(getConversationOrNull('conv-1')).resolves.toBe(mockConversation);
      expect(peekConversationCache('conv-1')).toBe(mockConversation);
    });

    it('returns a primed conversation without another backend round trip', async () => {
      primeConversationCache(mockConversation);

      await expect(getConversationOrNull('conv-1')).resolves.toBe(mockConversation);
      expect(ipcBridge.conversation.get.invoke).not.toHaveBeenCalled();
    });

    it('rethrows non-404 backend errors so database failures remain visible', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/conv-1',
        status: 500,
        body: {
          success: false,
          error: 'Internal error: Database error: no such table: conversations',
          code: 'INTERNAL_ERROR',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(getConversationOrNull('conv-1')).rejects.toBe(error);
    });
  });

  describe('refreshConversationCache', () => {
    it('bypasses the memory cache and refreshes SWR with current backend data', async () => {
      primeConversationCache(mockConversation);
      const refreshedConversation = { ...mockConversation, name: 'Refreshed' };
      vi.mocked(ipcBridge.conversation.get.invoke).mockResolvedValue(refreshedConversation);

      await refreshConversationCache('conv-1');

      expect(ipcBridge.conversation.get.invoke).toHaveBeenCalledWith({ id: 'conv-1' });
      expect(peekConversationCache('conv-1')).toBe(refreshedConversation);
      expect(mutate).toHaveBeenCalledWith('conversation/conv-1', refreshedConversation, false);
    });

    it('skips cache mutation when the conversation is missing', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/missing',
        status: 404,
        body: {
          success: false,
          error: 'Not found: Conversation missing not found',
          code: 'NOT_FOUND',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(refreshConversationCache('missing')).resolves.toBeUndefined();

      expect(mutate).not.toHaveBeenCalled();
    });

    it('rethrows non-404 backend errors instead of hiding them', async () => {
      const error = new BackendHttpError({
        method: 'GET',
        path: '/api/conversations/conv-1',
        status: 500,
        body: {
          success: false,
          error: 'Internal error: Database error: no such table: conversations',
          code: 'INTERNAL_ERROR',
        },
      });
      vi.mocked(ipcBridge.conversation.get.invoke).mockRejectedValue(error);

      await expect(refreshConversationCache('conv-1')).rejects.toBe(error);

      expect(mutate).not.toHaveBeenCalled();
    });
  });
});
