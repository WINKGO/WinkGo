// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { useWinkGoAgentMessage } from '@/renderer/pages/conversation/platforms/winkgo_agent/useWinkGoAgentMessage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { resetConversationTurnClockForTests } from '@/renderer/pages/conversation/utils/conversationTurnClock';

const { responseStreamOnMock, responseStreamHandlerRef } = vi.hoisted(() => ({
  responseStreamOnMock: vi.fn(),
  responseStreamHandlerRef: {
    current: undefined as ((message: IResponseMessage) => void) | undefined,
  },
}));

vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({
  useMergeLiveMessage: () => vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationCache', () => ({
  getConversationOrNull: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: {
      responseStream: {
        on: responseStreamOnMock.mockImplementation((handler: (message: IResponseMessage) => void) => {
          responseStreamHandlerRef.current = handler;
          return vi.fn();
        }),
      },
      update: { invoke: vi.fn().mockResolvedValue(undefined) },
    },
  },
}));

describe('useWinkGoAgentMessage turn clock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetConversationTurnClockForTests();
    responseStreamHandlerRef.current = undefined;
  });

  it('preserves elapsed time when switching away and back to a running conversation', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const { result, rerender } = renderHook(({ id }) => useWinkGoAgentMessage(id), {
      initialProps: { id: 'conv-1' },
    });
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => result.current.setWaitingResponse(true));
    await waitFor(() => expect(result.current.turnStartedAtMs).toBe(100_000));

    vi.mocked(getConversationOrNull).mockImplementation((id: string) =>
      Promise.resolve(id === 'conv-1' ? ({ runtime: { is_processing: true } } as never) : null)
    );
    nowSpy.mockReturnValue(200_000);
    rerender({ id: 'conv-2' });
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));
    expect(result.current.turnStartedAtMs).toBeNull();

    rerender({ id: 'conv-1' });
    await waitFor(() => expect(result.current.running).toBe(true));
    expect(result.current.turnStartedAtMs).toBe(100_000);
    nowSpy.mockRestore();
  });

  it('clears elapsed time after the turn finishes', async () => {
    vi.mocked(getConversationOrNull).mockResolvedValue(null);
    const { result } = renderHook(() => useWinkGoAgentMessage('conv-1'));
    await waitFor(() => expect(result.current.hasHydratedRunningState).toBe(true));

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(100_000);
    act(() => result.current.setWaitingResponse(true));
    await waitFor(() => expect(result.current.turnStartedAtMs).toBe(100_000));

    act(() => {
      responseStreamHandlerRef.current?.({
        type: 'finish',
        data: null,
        conversation_id: 'conv-1',
      } as unknown as IResponseMessage);
    });
    await waitFor(() => expect(result.current.turnStartedAtMs).toBeNull());
    nowSpy.mockRestore();
  });
});
