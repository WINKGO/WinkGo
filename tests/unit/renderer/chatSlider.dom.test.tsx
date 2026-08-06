/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TChatConversation } from '@/common/config/storage';

// Project Explorer is hosted by Layout. ChatSlider now owns only the legacy
// per-conversation workspace panel, so stub that panel to test the routing gate.
vi.mock('@/renderer/pages/conversation/Workspace', () => ({
  default: ({ conversation_id, workspace }: { conversation_id: string; workspace: string }) => (
    <div data-testid='workspace'>
      {conversation_id}:{workspace}
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/components/ConversationTitleMinimap', () => ({
  default: () => (
    <button type='button' aria-label='搜索会话'>
      search
    </button>
  ),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({ openPreview: vi.fn() }),
}));

import ChatSlider from '@/renderer/pages/conversation/components/ChatSlider';
import ChatTitleEditor from '@/renderer/pages/conversation/components/ChatTitleEditor';

const conv = (over: Record<string, unknown>): TChatConversation => over as unknown as TChatConversation;

afterEach(() => cleanup());

describe('ChatSlider workspace routing', () => {
  it('renders the ACP workspace panel independently of the Layout-level project Explorer', () => {
    render(
      <ChatSlider conversation={conv({ id: 'c1', type: 'acp', project_id: 'proj-9', extra: { workspace: '/ws' } })} />
    );
    expect(screen.getByTestId('workspace')).toHaveTextContent('c1:/ws');
  });

  it('keeps the workspace panel available while project_id backfill is pending', () => {
    render(<ChatSlider conversation={conv({ id: 'c1', type: 'acp', extra: { workspace: '/ws/legacy' } })} />);
    expect(screen.getByTestId('workspace')).toHaveTextContent('c1:/ws/legacy');
  });

  it('renders the Codex workspace panel', () => {
    render(
      <ChatSlider conversation={conv({ id: 'c1', type: 'codex', project_id: 'proj-x', extra: { workspace: '/ws' } })} />
    );
    expect(screen.getByTestId('workspace')).toHaveTextContent('c1:/ws');
  });

  it('renders an empty sider for a pure-chat conversation without a workspace', () => {
    render(<ChatSlider conversation={conv({ id: 'c1', type: 'acp', extra: {} })} />);
    expect(screen.queryByTestId('workspace')).not.toBeInTheDocument();
  });
});

describe('ChatTitleEditor message-search action', () => {
  const renderTitle = (editingTitle = false) =>
    render(
      <ChatTitleEditor
        editingTitle={editingTitle}
        titleDraft='A very long conversation title that must yield space to the search action'
        setTitleDraft={vi.fn()}
        setEditingTitle={vi.fn()}
        renameLoading={false}
        canRenameTitle
        submitTitleRename={vi.fn().mockResolvedValue(undefined)}
        titleAreaMaxWidth={320}
        title='A very long conversation title that must yield space to the search action'
        conversation_id='conversation-1'
      />
    );

  it('reserves stable width for the search action when the title is long', () => {
    renderTitle();

    const action = screen.getByTestId('conversation-title-actions');
    expect(action).toHaveClass('w-40px');
    expect(action).not.toHaveClass('w-0');
    expect(screen.getByRole('button', { name: '搜索会话' })).toBeVisible();
  });

  it('hides the search action while editing the title', () => {
    renderTitle(true);

    expect(screen.queryByTestId('conversation-title-actions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '搜索会话' })).not.toBeInTheDocument();
  });
});
