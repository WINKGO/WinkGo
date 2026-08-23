// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import React, { type ReactNode } from 'react';
import { ipcBridge } from '@/common';
import { PreviewProvider, usePreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';

vi.mock('@/common', () => ({
  ipcBridge: {
    fileStream: {
      contentUpdate: { on: vi.fn(() => vi.fn()) },
    },
    preview: {
      open: { on: vi.fn(() => vi.fn()) },
    },
    fs: {
      writeFile: { invoke: vi.fn() },
      getFileMetadata: { invoke: vi.fn() },
      readFile: { invoke: vi.fn() },
      getImageBase64: { invoke: vi.fn() },
      writeContent: { invoke: vi.fn() },
      getContentMetadata: {
        invoke: vi.fn().mockResolvedValue({
          name: 'main.ts',
          path: '',
          size: 1,
          mimeType: 'text/typescript',
          lastModified: 1700000000000,
        }),
      },
      readContent: { invoke: vi.fn().mockResolvedValue('external') },
    },
  },
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en' },
  }),
}));

describe('PreviewContext', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <PreviewProvider>{children}</PreviewProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('initializes with closed state', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.tabs).toEqual([]);
    expect(result.current.activeTabId).toBe(null);
  });

  it('opens preview and creates tab', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('# Hello', 'markdown', { title: 'test.md' });
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].content).toBe('# Hello');
    expect(result.current.tabs[0].content_type).toBe('markdown');
  });

  it('closes preview and clears all tabs', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('content', 'code');
    });
    act(() => {
      result.current.closePreview();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.tabs).toEqual([]);
  });

  it('collapses a browser without clearing it and restores the same page from the browser launcher', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openBrowserTab('https://www.bilibili.com/search?keyword=WINK%20GO');
    });

    const originalTabId = result.current.activeTabId;
    expect(result.current.tabs).toHaveLength(1);

    act(() => {
      result.current.hidePreview();
    });
    expect(result.current.isOpen).toBe(false);
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.tabs[0].content).toContain('bilibili.com/search');

    act(() => {
      result.current.openBrowserTab();
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe(originalTabId);
    expect(result.current.activeTab?.content).toContain('bilibili.com/search');
  });

  it('provides all context API methods', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    expect(typeof result.current.openPreview).toBe('function');
    expect(typeof result.current.hidePreview).toBe('function');
    expect(typeof result.current.closePreview).toBe('function');
    expect(typeof result.current.updateContent).toBe('function');
    expect(typeof result.current.findPreviewTab).toBe('function');
    expect(typeof result.current.reloadContent).toBe('function');
  });

  it('updates content and marks tab as dirty', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    act(() => {
      result.current.openPreview('original', 'code');
    });
    expect(result.current.activeTab?.isDirty).toBe(false);
    act(() => {
      result.current.updateContent('modified');
    });
    expect(result.current.activeTab?.content).toBe('modified');
    expect(result.current.activeTab?.isDirty).toBe(true);
  });

  it('deduplicates previews by stable file reference instead of display path', () => {
    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    const fileRef = { kind: 'project' as const, pe_id: 'project-1', relative_path: 'src/main.ts' };

    act(() => {
      result.current.openPreview('first', 'code', { title: 'main.ts', fileRef });
    });
    act(() => {
      result.current.openPreview('second', 'code', { title: 'renamed-display.ts', fileRef });
    });

    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTab?.content).toBe('second');
  });

  it('restores unsaved content as dirty after switching away and back to a preview scope', () => {
    const first = renderHook(() => usePreviewContext(), { wrapper });
    act(() => first.result.current.closePreviewIfScopeChanged('project-1'));
    act(() => first.result.current.openPreview('saved', 'code', { title: 'main.ts' }));
    act(() => first.result.current.updateContent('unsaved edit'));
    expect(first.result.current.activeTab?.content).toBe('unsaved edit');
    expect(first.result.current.activeTab?.isDirty).toBe(true);
    act(() => first.result.current.closePreviewIfScopeChanged('project-2'));
    const persisted = JSON.parse(localStorage.getItem('winkgo_preview:project-1') || '{}');
    expect(persisted.tabs?.[0]?.content).toBe('unsaved edit');
    expect(persisted.tabs?.[0]?.isDirty).toBe(true);
    first.unmount();

    const second = renderHook(() => usePreviewContext(), { wrapper });
    act(() => second.result.current.closePreviewIfScopeChanged('project-1'));

    expect(second.result.current.activeTab?.content).toBe('unsaved edit');
    expect(second.result.current.activeTab?.originalContent).toBe('saved');
    expect(second.result.current.activeTab?.isDirty).toBe(true);
    second.unmount();
  });

  it('reloads the latest disk content and uses its version for the next save', async () => {
    const writeContent = vi.mocked(ipcBridge.fs.writeContent.invoke);
    const readContent = vi.mocked(ipcBridge.fs.readContent.invoke);
    writeContent.mockResolvedValue(true);
    readContent.mockResolvedValue('latest on disk');

    const { result } = renderHook(() => usePreviewContext(), { wrapper });
    const fileRef = { kind: 'project' as const, pe_id: 'project-1', relative_path: 'src/main.ts' };
    act(() => result.current.openPreview('old content', 'code', { title: 'main.ts', fileRef }));
    act(() => result.current.updateContent('local edit'));

    await act(async () => {
      expect(await result.current.reloadContent()).toBe(true);
    });

    expect(result.current.activeTab?.content).toBe('latest on disk');
    expect(result.current.activeTab?.isDirty).toBe(false);

    act(() => result.current.updateContent('edit after reload'));
    await act(async () => {
      expect(await result.current.saveContent()).toBe(true);
    });

    expect(writeContent).toHaveBeenCalledWith({
      file: fileRef,
      data: 'edit after reload',
      ifMatch: 1700000000000,
    });
  });
});
