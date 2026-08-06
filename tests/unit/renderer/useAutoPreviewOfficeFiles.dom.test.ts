// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ipcBridge } from '@/common';
import { BackendHttpError } from '@/common/adapter/httpBridge';
import { useAutoPreviewOfficeFiles } from '@/renderer/hooks/file/useAutoPreviewOfficeFiles';

const { warningSpy } = vi.hoisted(() => ({ warningSpy: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listWorkspaceFiles: { invoke: vi.fn() },
    },
    workspaceOfficeWatch: {
      start: { invoke: vi.fn() },
      stop: { invoke: vi.fn() },
      fileAdded: { on: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/hooks/system/useAutoPreviewOfficeFilesEnabled', () => ({
  useAutoPreviewOfficeFilesEnabled: () => true,
}));

vi.mock('@arco-design/web-react', () => ({
  Message: { warning: warningSpy },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/pages/conversation/Preview', () => ({
  usePreviewContext: () => ({
    findPreviewTab: vi.fn(),
    openPreview: vi.fn(),
  }),
}));

describe('useAutoPreviewOfficeFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    warningSpy.mockReset();
    vi.mocked(ipcBridge.workspaceOfficeWatch.start.invoke).mockResolvedValue(undefined);
    vi.mocked(ipcBridge.workspaceOfficeWatch.stop.invoke).mockResolvedValue(undefined);
    vi.mocked(ipcBridge.workspaceOfficeWatch.fileAdded.on).mockReturnValue(() => {});
    vi.mocked(ipcBridge.fs.listWorkspaceFiles.invoke).mockResolvedValue([]);
  });

  it('lists workspace files by workspace root', async () => {
    renderHook(() => useAutoPreviewOfficeFiles({ conversation_id: 'conversation-1', workspace: '/Volumes/project' }));

    await waitFor(() => {
      expect(ipcBridge.fs.listWorkspaceFiles.invoke).toHaveBeenCalledWith({
        root: '/Volumes/project',
      });
    });
  });

  it('warns once and stays running when live file watching is unavailable', async () => {
    vi.mocked(ipcBridge.workspaceOfficeWatch.start.invoke).mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/api/fs/office-watch/start',
        status: 503,
        body: { code: 'FILE_WATCH_UNAVAILABLE', details: { errno: 24 } },
      })
    );

    const first = renderHook(() =>
      useAutoPreviewOfficeFiles({ conversation_id: 'conversation-1', workspace: '/Volumes/project' })
    );
    first.unmount();
    renderHook(() => useAutoPreviewOfficeFiles({ conversation_id: 'conversation-2', workspace: '/Volumes/project' }));

    await waitFor(() => {
      expect(warningSpy).toHaveBeenCalledTimes(1);
    });
    expect(warningSpy).toHaveBeenCalledWith('conversation.officePreview.fileWatchUnavailable');
  });

  it('does not show the watcher warning for unrelated backend failures', async () => {
    vi.mocked(ipcBridge.workspaceOfficeWatch.start.invoke).mockRejectedValue(
      new BackendHttpError({
        method: 'POST',
        path: '/api/fs/office-watch/start',
        status: 500,
        body: { code: 'INTERNAL' },
      })
    );

    renderHook(() => useAutoPreviewOfficeFiles({ conversation_id: 'conversation-1', workspace: '/Volumes/project' }));

    await waitFor(() => {
      expect(ipcBridge.workspaceOfficeWatch.start.invoke).toHaveBeenCalledTimes(1);
    });
    expect(warningSpy).not.toHaveBeenCalled();
  });
});
