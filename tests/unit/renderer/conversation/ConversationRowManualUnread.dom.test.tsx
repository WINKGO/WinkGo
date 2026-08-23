// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: null }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/conversation/utils/conversationAssistantIdentity', () => ({
  resolveConversationLeadingMark: () => ({ kind: 'default' }),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: () => null,
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
}));

vi.mock('@/renderer/utils/ui/siderTooltip', () => ({
  cleanupSiderTooltips: vi.fn(),
  getSiderTooltipProps: () => ({ disabled: true }),
}));

import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';

const conversation = {
  id: 'unread-menu-conversation',
  name: 'Unread source',
  type: 'acp',
  created_at: 1,
  modified_at: 1,
  extra: { backend: 'claude' },
  model: {},
} as TChatConversation;

const makeProps = (overrides: Partial<ConversationRowProps> = {}): ConversationRowProps => ({
  conversation,
  isGenerating: false,
  hasUnread: false,
  isManualUnread: false,
  collapsed: false,
  tooltipEnabled: false,
  batchMode: false,
  checked: false,
  selected: false,
  menuVisible: true,
  onToggleChecked: vi.fn(),
  onConversationClick: vi.fn(),
  onOpenMenu: vi.fn(),
  onMenuVisibleChange: vi.fn(),
  onEditStart: vi.fn(),
  onCreateCronTask: vi.fn(),
  onDelete: vi.fn(),
  onTogglePin: vi.fn(),
  onToggleManualUnread: vi.fn(),
  getJobStatus: () => 'none',
  ...overrides,
});

describe('conversation mark-as-unread menu item', () => {
  it('offers mark as unread for a read conversation', async () => {
    render(<ConversationRow {...makeProps({ isManualUnread: false })} />);

    expect(await screen.findByText('conversation.history.markAsUnread')).toBeInTheDocument();
    expect(screen.queryByText('conversation.history.markAsRead')).not.toBeInTheDocument();
  });

  it('offers mark as read for a manually unread conversation', async () => {
    render(<ConversationRow {...makeProps({ isManualUnread: true })} />);

    expect(await screen.findByText('conversation.history.markAsRead')).toBeInTheDocument();
    expect(screen.queryByText('conversation.history.markAsUnread')).not.toBeInTheDocument();
  });

  it('invokes the manual unread callback', async () => {
    const onToggleManualUnread = vi.fn();
    render(<ConversationRow {...makeProps({ onToggleManualUnread })} />);

    fireEvent.click(await screen.findByText('conversation.history.markAsUnread'));
    await waitFor(() => expect(onToggleManualUnread).toHaveBeenCalledWith(conversation));
  });
});
