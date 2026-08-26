/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({ getImageBase64: vi.fn(() => Promise.resolve<string | null>(null)) }));
vi.mock('@/common', () => ({
  ipcBridge: { fs: { getImageBase64: { invoke: hoisted.getImageBase64 } } },
}));

import LocalImageView from '@renderer/components/media/LocalImageView';
import { ConversationProvider } from '@/renderer/hooks/context/ConversationContext';

afterEach(() => {
  cleanup();
  hoisted.getImageBase64.mockClear();
});

describe('LocalImageView conversation workspace', () => {
  it('resolves a relative image against the active conversation workspace', async () => {
    render(
      <ConversationProvider value={{ conversation_id: 'conv-1', workspace: '/workspace/demo', type: 'acp' }}>
        <LocalImageView src='./chart.png' alt='chart' />
      </ConversationProvider>
    );
    await waitFor(() =>
      expect(hoisted.getImageBase64).toHaveBeenCalledWith({
        path: '/workspace/demo/chart.png',
        workspace: '/workspace/demo',
      })
    );
  });

  it('preserves the old safe fallback outside a conversation', async () => {
    render(<LocalImageView src='./chart.png' alt='chart' />);
    await waitFor(() =>
      expect(hoisted.getImageBase64).toHaveBeenCalledWith({ path: './chart.png', workspace: undefined })
    );
  });
});
