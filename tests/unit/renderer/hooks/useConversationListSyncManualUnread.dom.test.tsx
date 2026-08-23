// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/utils/emitter', () => ({ addEventListener: vi.fn() }));
vi.mock('@/common', () => ({
  ipcBridge: {
    database: { getUserConversations: { invoke: vi.fn().mockResolvedValue({ items: [] }) } },
    application: { writeRendererLog: { invoke: vi.fn().mockResolvedValue(undefined) } },
    conversation: {
      listChanged: { on: vi.fn() },
      responseStream: { on: vi.fn() },
      turnCompleted: { on: vi.fn() },
    },
  },
}));

import { useConversationListSync } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';

const STORAGE_KEY = 'conversation-manual-unread-ids';

describe('manual unread persistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.clearAllMocks());

  it('persists marked conversations', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => result.current.markManualUnread('conv-1'));
    expect(result.current.isManualUnread('conv-1')).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['conv-1']));
  });

  it('clears a manually unread conversation', () => {
    const { result } = renderHook(() => useConversationListSync());

    act(() => {
      result.current.markManualUnread('conv-1');
      result.current.markManualUnread('conv-2');
    });
    act(() => result.current.clearManualUnread('conv-1'));

    expect(result.current.isManualUnread('conv-1')).toBe(false);
    expect(result.current.isManualUnread('conv-2')).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(['conv-2']));
  });
});
