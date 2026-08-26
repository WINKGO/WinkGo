/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

const CONVERSATION_ID = 'folder-chip-conversation';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) },
      listWorkspaceFiles: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/renderer/hooks/chat/useInputFocusRing', () => ({
  useInputFocusRing: () => ({
    activeBorderColor: 'var(--color-primary-6)',
    inactiveBorderColor: 'var(--color-border-2)',
    activeShadow: 'none',
  }),
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({ conversation_id: CONVERSATION_ID, type: 'acp' }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({ useLayoutContext: () => ({ isMobile: false }) }));
vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    setSendBoxHandler: vi.fn(),
    domSnippets: [],
    removeDomSnippet: vi.fn(),
    clearDomSnippets: vi.fn(),
  }),
}));
vi.mock('@/renderer/pages/conversation/Messages/hooks', () => ({ useMessageList: () => [] }));
vi.mock('@/renderer/hooks/file/useConversationExport', () => ({
  useConversationExport: () => ({
    isOpen: false,
    showMenu: false,
    step: 'menu',
    filename: '',
    pathPreview: '',
    menuItems: [],
    activeIndex: 0,
    loading: false,
    openExportFlow: vi.fn(),
    closeExportFlow: vi.fn(),
    handleKeyDown: vi.fn(),
    onSelectMenuItem: vi.fn(),
    setActiveIndex: vi.fn(),
    setFilename: vi.fn(),
    submitFilename: vi.fn(),
  }),
}));
vi.mock('@/renderer/components/chat/BtwOverlay/useBtwCommand', () => ({
  useBtwCommand: () => ({
    answer: '',
    question: '',
    isLoading: false,
    isOpen: false,
    ask: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock('@/renderer/hooks/file/useDragUpload', () => ({
  useDragUpload: () => ({ isFileDragging: false, dragHandlers: {} }),
}));
vi.mock('@/renderer/hooks/file/usePasteService', () => ({
  usePasteService: () => ({ onPaste: vi.fn(), onFocus: vi.fn() }),
}));
vi.mock('@/renderer/hooks/file/useUploadState', () => ({ useUploadState: () => ({ isUploading: false }) }));
vi.mock('@/renderer/hooks/file/useAbortUploadsOnConversationChange', () => ({
  useAbortUploadsOnConversationChange: vi.fn(),
}));
vi.mock('@/renderer/hooks/system/useLiveTranscriptInsertion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/hooks/system/useLiveTranscriptInsertion')>();
  return { ...actual, useLiveTranscriptInsertion: () => ({ handleLiveTranscript: vi.fn() }) };
});
vi.mock('@/renderer/components/chat/BtwOverlay', () => ({ default: () => null }));
vi.mock('@/renderer/components/chat/SpeechInputButton', () => ({ default: () => null }));
vi.mock('@/renderer/components/media/UploadProgressBar', () => ({ default: () => null }));

import SendBox from '@/renderer/components/chat/SendBox';
import { projectFileRef } from '@/common/types/chatFile';
import { emitter, useAddEventListener } from '@/renderer/utils/emitter';
import { mergeFileSelectionItems, type FileSelectionItem } from '@/renderer/utils/file/fileSelection';
import type { FileOrFolderItem } from '@/renderer/utils/file/fileTypes';

const Harness: React.FC = () => {
  const [items, setItems] = useState<FileSelectionItem[]>([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useAddEventListener(
    'acp.selected.file',
    (next: FileSelectionItem[], tid: string | undefined) => {
      if (tid === undefined || tid === CONVERSATION_ID) setItems(next);
    },
    []
  );
  useAddEventListener(
    'acp.selected.file.append',
    (additions: FileSelectionItem[], tid: string | undefined) => {
      if (tid !== undefined && tid !== CONVERSATION_ID) return;
      const merged = mergeFileSelectionItems(itemsRef.current, additions);
      if (merged !== itemsRef.current) setItems(merged as FileSelectionItem[]);
    },
    []
  );

  return (
    <SendBox
      value=''
      onChange={vi.fn()}
      onSend={vi.fn().mockResolvedValue(undefined)}
      selectedWorkspaceItems={items}
      onSelectedWorkspaceItemsChange={(next) => emitter.emit('acp.selected.file', next, CONVERSATION_ID)}
    />
  );
};

const folderItem = (peId: string, rel: string, name: string): FileOrFolderItem => ({
  path: rel,
  name,
  isFile: false,
  relativePath: rel || undefined,
  chatRef: projectFileRef(peId, rel),
});

const appendToChat = async (item: FileOrFolderItem): Promise<void> => {
  await act(async () => emitter.emit('acp.selected.file.append', [item], CONVERSATION_ID));
};

const chipCount = (): number => document.querySelectorAll('.arco-tag-close-btn').length;

describe('SendBox folder attachments', () => {
  it('renders a chip for a subdirectory', async () => {
    render(<Harness />);
    await appendToChat(folderItem('peA', 'crates', 'crates'));
    await waitFor(() => expect(screen.getByText('crates')).toBeInTheDocument());
    expect(chipCount()).toBe(1);
  });

  it('renders a chip for a project root whose relative path is empty', async () => {
    render(<Harness />);
    await appendToChat(folderItem('peZed', '', 'zed'));
    await waitFor(() => expect(screen.getByText('zed')).toBeInTheDocument());
    expect(chipCount()).toBe(1);
  });

  it('keeps distinct project roots instead of colliding on the empty path', async () => {
    render(<Harness />);
    await appendToChat(folderItem('peZed', '', 'zed'));
    await appendToChat(folderItem('peOpenclaw', '', 'openclaw'));
    await waitFor(() => expect(screen.getByText('zed')).toBeInTheDocument());
    expect(screen.getByText('openclaw')).toBeInTheDocument();
    expect(chipCount()).toBe(2);
  });

  it('does not render a folder-shaped item without a resolvable chat reference', async () => {
    render(<Harness />);
    await appendToChat({ path: 'ghost', name: 'ghost', isFile: false });
    expect(screen.queryByText('ghost')).not.toBeInTheDocument();
    expect(chipCount()).toBe(0);
  });

  it('removes only the selected root chip', async () => {
    render(<Harness />);
    await appendToChat(folderItem('peZed', '', 'zed'));
    await appendToChat(folderItem('peOpenclaw', '', 'openclaw'));
    await waitFor(() => expect(chipCount()).toBe(2));

    const zedTag = screen.getByText('zed').closest('.arco-tag') as HTMLElement;
    await act(async () => fireEvent.click(zedTag.querySelector('.arco-tag-close-btn') as HTMLElement));

    await waitFor(() => expect(screen.queryByText('zed')).not.toBeInTheDocument());
    expect(screen.getByText('openclaw')).toBeInTheDocument();
    expect(chipCount()).toBe(1);
  });
});
