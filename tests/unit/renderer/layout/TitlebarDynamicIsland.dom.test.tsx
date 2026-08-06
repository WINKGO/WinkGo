/**
 * @license
 * Copyright 2025 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IConversationTurnCompletedEvent,
  ICronJob,
  IResponseMessage,
  WinkGoCapturedNotification,
  WinkGoMailMessage,
  WinkGoMailStatus,
  WinkGoMediaSnapshot,
  WinkGoQuickApp,
  WinkGoXiaozhiActivity,
  WinkGoXiaozhiSnapshot,
} from '@/common/adapter/ipcBridge';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  listJobs: vi.fn<() => Promise<ICronJob[]>>(),
  onJobCreated: vi.fn(() => () => {}),
  onJobUpdated: vi.fn(() => () => {}),
  onJobRemoved: vi.fn(() => () => {}),
  responseHandler: undefined as ((message: IResponseMessage) => void) | undefined,
  turnHandler: undefined as ((event: IConversationTurnCompletedEvent) => void) | undefined,
  fileCommandHandler: undefined as
    | ((event: { type: 'openShelf' | 'newCategory' | 'openFormat' | 'openApps' }) => void)
    | undefined,
  showNotification: vi.fn(() => Promise.resolve()),
  showOpen: vi.fn<() => Promise<string[] | undefined>>(),
  getDefaultFolder: vi.fn(() => Promise.resolve('C:\\WINK GO Inbox')),
  organizeFiles: vi.fn(),
  undoFiles: vi.fn(),
  showItemInFolder: vi.fn(() => Promise.resolve()),
  openFile: vi.fn(() => Promise.resolve('')),
  selectQuickApps: vi.fn<() => Promise<WinkGoQuickApp[]>>(),
  refreshQuickApps: vi.fn<(input: { paths: string[] }) => Promise<WinkGoQuickApp[]>>(),
  launchQuickApp: vi.fn(),
  detectFormatEngines: vi.fn(() =>
    Promise.resolve({
      ffmpegAvailable: true,
      ffmpegPath: 'C:\\ffmpeg.exe',
      officeAvailable: true,
      officePath: 'C:\\soffice.exe',
      officeEngine: 'LibreOffice',
      ncmAvailable: true,
    })
  ),
  getDefaultFormatOutputFolder: vi.fn(() => Promise.resolve('C:\\WINK GO Output')),
  selectFormatFiles: vi.fn(() => Promise.resolve([])),
  chooseFormatOutputFolder: vi.fn(() => Promise.resolve(undefined)),
  startFormatConversion: vi.fn(),
  configureWindowsRuntime: vi.fn(),
  getWindowsRuntimeState: vi.fn(),
  controlMedia: vi.fn(),
  getLyrics: vi.fn(),
  requestNotificationAccess: vi.fn(),
  setFileDragActive: vi.fn(),
  setIslandSize: vi.fn(),
  nativeDropHandler: undefined as
    | ((
        event:
          | { kind: 'enter'; names: string[]; position: [number, number] }
          | { kind: 'over'; position: [number, number] }
          | { kind: 'leave' }
          | { kind: 'drop'; paths: string[]; position: [number, number] }
      ) => void)
    | undefined,
  mediaHandler: undefined as ((snapshot: WinkGoMediaSnapshot | null) => void) | undefined,
  notificationHandler: undefined as ((notification: WinkGoCapturedNotification) => void) | undefined,
  mailNotificationHandler: undefined as ((notification: WinkGoCapturedNotification) => void) | undefined,
  mailStatusHandler: undefined as ((status: WinkGoMailStatus) => void) | undefined,
  getMailStatus: vi.fn<() => Promise<WinkGoMailStatus>>(),
  listMailMessages: vi.fn<(input: { limit?: number }) => Promise<WinkGoMailMessage[]>>(),
  checkMailNow: vi.fn<() => Promise<WinkGoMailStatus>>(),
  previewMail: vi.fn(),
  downloadMail: vi.fn(),
  xiaozhiHandler: undefined as ((snapshot: WinkGoXiaozhiSnapshot) => void) | undefined,
  xiaozhiActivityHandler: undefined as ((activity: WinkGoXiaozhiActivity) => void) | undefined,
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number; time?: string }) =>
      key === 'common.winkGoWorkspace.activeTasks'
        ? `${params?.count ?? 0} active`
        : key === 'common.winkGoWorkspace.ready'
          ? 'WINK GO is ready'
          : key === 'common.winkGoWorkspace.activityRunning'
            ? 'Running'
            : key === 'common.winkGoWorkspace.focusRunning'
              ? `Focus · ${params?.time}`
              : key,
    i18n: { language: 'en-US', resolvedLanguage: 'en-US' },
  }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    cron: {
      listJobs: { invoke: () => mocks.listJobs() },
      onJobCreated: { on: mocks.onJobCreated },
      onJobUpdated: { on: mocks.onJobUpdated },
      onJobRemoved: { on: mocks.onJobRemoved },
    },
    conversation: {
      responseStream: {
        on: (handler: (message: IResponseMessage) => void) => {
          mocks.responseHandler = handler;
          return () => {
            mocks.responseHandler = undefined;
          };
        },
      },
      turnCompleted: {
        on: (handler: (event: IConversationTurnCompletedEvent) => void) => {
          mocks.turnHandler = handler;
          return () => {
            mocks.turnHandler = undefined;
          };
        },
      },
    },
    notification: {
      show: { invoke: mocks.showNotification },
    },
    dialog: {
      showOpen: { invoke: mocks.showOpen },
    },
    shell: {
      openFile: { invoke: mocks.openFile },
    },
    winkGoFiles: {
      getDefaultFolder: { invoke: mocks.getDefaultFolder },
      organize: { invoke: mocks.organizeFiles },
      undo: { invoke: mocks.undoFiles },
      showItemInFolder: { invoke: mocks.showItemInFolder },
      selectQuickApps: { invoke: mocks.selectQuickApps },
      refreshQuickApps: { invoke: mocks.refreshQuickApps },
      launchQuickApp: { invoke: mocks.launchQuickApp },
      activateShortcuts: { invoke: vi.fn(() => Promise.resolve({})) },
      command: {
        on: (handler: (event: { type: 'openShelf' | 'newCategory' | 'openFormat' | 'openApps' }) => void) => {
          mocks.fileCommandHandler = handler;
          return () => {
            mocks.fileCommandHandler = undefined;
          };
        },
      },
    },
    winkGoFormat: {
      detectEngines: { invoke: mocks.detectFormatEngines },
      getDefaultOutputFolder: { invoke: mocks.getDefaultFormatOutputFolder },
      selectFiles: { invoke: mocks.selectFormatFiles },
      chooseOutputFolder: { invoke: mocks.chooseFormatOutputFolder },
      startConversion: { invoke: mocks.startFormatConversion },
      progress: {
        on: vi.fn(() => () => {}),
      },
    },
    winkGoWindows: {
      configure: { invoke: mocks.configureWindowsRuntime },
      getState: { invoke: mocks.getWindowsRuntimeState },
      controlMedia: { invoke: mocks.controlMedia },
      getLyrics: { invoke: mocks.getLyrics },
      requestNotificationAccess: { invoke: mocks.requestNotificationAccess },
      mediaChanged: {
        on: (handler: (snapshot: WinkGoMediaSnapshot | null) => void) => {
          mocks.mediaHandler = handler;
          return () => {
            mocks.mediaHandler = undefined;
          };
        },
      },
      notificationReceived: {
        on: (handler: (notification: WinkGoCapturedNotification) => void) => {
          mocks.notificationHandler = handler;
          return () => {
            mocks.notificationHandler = undefined;
          };
        },
      },
    },
    winkGoMail: {
      getStatus: { invoke: mocks.getMailStatus },
      listMessages: { invoke: mocks.listMailMessages },
      checkNow: { invoke: mocks.checkMailNow },
      previewMessage: { invoke: mocks.previewMail },
      downloadMessage: { invoke: mocks.downloadMail },
      statusChanged: {
        on: (handler: (status: WinkGoMailStatus) => void) => {
          mocks.mailStatusHandler = handler;
          return () => {
            mocks.mailStatusHandler = undefined;
          };
        },
      },
      messageReceived: {
        on: (handler: (notification: WinkGoCapturedNotification) => void) => {
          mocks.mailNotificationHandler = handler;
          return () => {
            mocks.mailNotificationHandler = undefined;
          };
        },
      },
    },
    winkGoXiaozhi: {
      statusChanged: {
        on: (handler: (snapshot: WinkGoXiaozhiSnapshot) => void) => {
          mocks.xiaozhiHandler = handler;
          return () => {
            mocks.xiaozhiHandler = undefined;
          };
        },
      },
      activityChanged: {
        on: (handler: (activity: WinkGoXiaozhiActivity) => void) => {
          mocks.xiaozhiActivityHandler = handler;
          return () => {
            mocks.xiaozhiActivityHandler = undefined;
          };
        },
      },
    },
  },
}));

import TitlebarDynamicIsland, {
  calculateFloatingIslandHeight,
} from '@renderer/components/layout/Titlebar/TitlebarDynamicIsland';

const activeJob: ICronJob = {
  id: 'job-1',
  name: 'Daily summary',
  enabled: true,
  schedule: { kind: 'every', everyMs: 60_000, description: 'Every minute' },
  target: { payload: { kind: 'message', text: 'Summarize' } },
  metadata: {
    conversation_id: 'conversation-1',
    agent_type: 'winkgo',
    created_by: 'user',
    created_at: 1,
    updated_at: 1,
  },
  state: {
    run_count: 0,
    retry_count: 0,
    max_retries: 0,
    queue_enabled: false,
  },
};

const createEchoMediaSnapshot = (title: string, coverUrl: string, updatedAt: number): WinkGoMediaSnapshot => ({
  appId: 'EchoMusic.exe',
  title,
  artist: 'Artist',
  albumTitle: '',
  isPlaying: true,
  canPlayPause: true,
  canGoNext: true,
  canGoPrevious: true,
  coverUrl,
  updatedAt,
});

describe('TitlebarDynamicIsland', () => {
  it('expands a floating window to the real panel bottom without exceeding the desktop limit', () => {
    expect(calculateFloatingIslandHeight(115, 178.2)).toBe(187);
    expect(calculateFloatingIslandHeight(190, 120)).toBe(190);
    expect(calculateFloatingIslandHeight(190, 800)).toBe(500);
  });

  beforeEach(() => {
    mocks.navigate.mockClear();
    mocks.listJobs.mockReset();
    mocks.onJobCreated.mockClear();
    mocks.onJobUpdated.mockClear();
    mocks.onJobRemoved.mockClear();
    mocks.responseHandler = undefined;
    mocks.turnHandler = undefined;
    mocks.fileCommandHandler = undefined;
    mocks.xiaozhiHandler = undefined;
    mocks.showNotification.mockClear();
    mocks.showOpen.mockReset();
    mocks.getDefaultFolder.mockClear();
    mocks.organizeFiles.mockReset();
    mocks.undoFiles.mockReset();
    mocks.showItemInFolder.mockClear();
    mocks.openFile.mockClear();
    mocks.selectQuickApps.mockReset();
    mocks.refreshQuickApps.mockReset();
    mocks.launchQuickApp.mockReset();
    mocks.detectFormatEngines.mockClear();
    mocks.getDefaultFormatOutputFolder.mockClear();
    mocks.selectFormatFiles.mockClear();
    mocks.chooseFormatOutputFolder.mockClear();
    mocks.startFormatConversion.mockReset();
    mocks.configureWindowsRuntime.mockReset();
    mocks.getWindowsRuntimeState.mockReset();
    mocks.controlMedia.mockReset();
    mocks.getLyrics.mockReset();
    mocks.requestNotificationAccess.mockReset();
    mocks.setFileDragActive.mockReset();
    mocks.setIslandSize.mockReset();
    mocks.nativeDropHandler = undefined;
    mocks.mediaHandler = undefined;
    mocks.notificationHandler = undefined;
    mocks.mailNotificationHandler = undefined;
    mocks.mailStatusHandler = undefined;
    mocks.getMailStatus.mockReset();
    mocks.listMailMessages.mockReset();
    mocks.checkMailNow.mockReset();
    mocks.previewMail.mockReset();
    mocks.downloadMail.mockReset();
    mocks.listJobs.mockResolvedValue([]);
    mocks.showOpen.mockResolvedValue(undefined);
    mocks.organizeFiles.mockResolvedValue({
      destinationRoot: 'C:\\WINK GO Inbox',
      operations: [],
      failures: [],
      skipped: [],
    });
    mocks.undoFiles.mockResolvedValue({ restored: [], failures: [] });
    mocks.selectQuickApps.mockResolvedValue([]);
    mocks.refreshQuickApps.mockResolvedValue([]);
    mocks.launchQuickApp.mockResolvedValue({ launched: true });
    mocks.startFormatConversion.mockResolvedValue({ items: [], error: null });
    mocks.configureWindowsRuntime.mockResolvedValue({
      available: true,
      mediaEnabled: true,
      notificationEnabled: true,
      notificationAccess: 'Allowed',
      media: null,
      notification: null,
    });
    mocks.getWindowsRuntimeState.mockResolvedValue({
      available: true,
      mediaEnabled: true,
      notificationEnabled: true,
      notificationAccess: 'Allowed',
      media: null,
      notification: null,
    });
    mocks.controlMedia.mockResolvedValue({ controlled: true });
    mocks.getLyrics.mockImplementation((request: { appId: string; title: string; artist: string }) =>
      Promise.resolve({
        status: 'ok',
        trackKey: `${request.appId}\u0000${request.title}\u0000${request.artist}`.toLocaleLowerCase(),
        source: 'qqmusic',
        lines: [
          { timeMs: 0, text: 'First lyric' },
          { timeMs: 10_000, text: 'Second lyric', translation: 'Translated lyric' },
        ],
        fetchedAt: Date.now(),
      })
    );
    mocks.requestNotificationAccess.mockResolvedValue({ status: 'Allowed' });
    mocks.getMailStatus.mockResolvedValue({
      account: null,
      state: 'disabled',
      unreadCount: 0,
    });
    mocks.listMailMessages.mockResolvedValue([]);
    mocks.checkMailNow.mockResolvedValue({
      account: null,
      state: 'disabled',
      unreadCount: 0,
    });
    mocks.downloadMail.mockResolvedValue({
      ok: true,
      directory: 'C:\\Downloads\\WINK GO 邮件\\user@example.com\\mail',
      bodyPath: 'C:\\Downloads\\WINK GO 邮件\\user@example.com\\mail\\正文.txt',
      attachments: ['C:\\Downloads\\WINK GO 邮件\\user@example.com\\mail\\report.pdf'],
    });
    mocks.previewMail.mockResolvedValue({
      ok: true,
      body: '这是邮件的完整正文。',
      attachmentNames: ['report.pdf'],
    });
    mocks.setFileDragActive.mockResolvedValue(true);
    mocks.setIslandSize.mockResolvedValue(true);
    Object.assign(window.electronAPI || {}, {
      desktopIsland: {
        applySettings: vi.fn(() => Promise.resolve(true)),
        navigateMain: vi.fn(() => Promise.resolve(true)),
        ready: vi.fn(() => Promise.resolve(true)),
        setFileDragActive: mocks.setFileDragActive,
        setSize: mocks.setIslandSize,
      },
      onNativeFileDrop: (handler: NonNullable<typeof mocks.nativeDropHandler>) => {
        mocks.nativeDropHandler = handler;
        return () => {
          if (mocks.nativeDropHandler === handler) mocks.nativeDropHandler = undefined;
        };
      },
    });
    localStorage.clear();
  });

  it('shows the idle summary and opens the existing scheduled-task page', async () => {
    render(<TitlebarDynamicIsland />);

    await screen.findByText('WINK GO is ready');
    fireEvent.click(screen.getByRole('button', { name: 'WINK GO is ready' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.openScheduledTasks' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/scheduled');
    expect(mocks.listJobs).toHaveBeenCalledTimes(1);
    expect(mocks.onJobCreated).toHaveBeenCalledTimes(1);
    expect(mocks.onJobUpdated).toHaveBeenCalledTimes(1);
    expect(mocks.onJobRemoved).toHaveBeenCalledTimes(1);
  });

  it('uses the logo without repeating the WINK GO name in the desktop capsule', async () => {
    render(<TitlebarDynamicIsland floating />);

    await screen.findByText('is ready');
    expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-floating', 'true');
    expect(screen.queryByText('WINK GO')).toBeNull();
    expect(document.querySelector('.titlebar-dynamic-island__brand img')).toBeTruthy();
    expect(screen.queryByText('WINK GO is ready')).toBeNull();
  });

  it('opens file collection in place for a native drag and stages the dropped paths directly', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.nativeDropHandler?.({ kind: 'enter', names: ['客户方案.png'], position: [120, 18] });
    });

    const island = screen.getByTestId('titlebar-dynamic-island');
    await waitFor(() => expect(island).toHaveAttribute('data-panel', 'drop'));
    expect(mocks.setFileDragActive).toHaveBeenLastCalledWith(true);
    await waitFor(() => expect(mocks.setIslandSize).toHaveBeenCalledWith({ width: 500, height: 108 }));

    act(() => {
      mocks.nativeDropHandler?.({ kind: 'over', position: [124, 22] });
      mocks.nativeDropHandler?.({ kind: 'drop', paths: ['C:\\Desktop\\客户方案.png'], position: [124, 22] });
    });

    await waitFor(() => expect(island).toHaveAttribute('data-panel', 'destination'));
    expect(mocks.setFileDragActive).toHaveBeenLastCalledWith(false);
  });

  it('collapses a native file hover that genuinely leaves without dropping', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.nativeDropHandler?.({ kind: 'enter', names: ['notes.txt'], position: [100, 18] });
    });
    await waitFor(() => expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-panel', 'drop'));

    act(() => {
      mocks.nativeDropHandler?.({ kind: 'leave' });
    });

    await waitFor(() => expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-panel', 'none'));
    expect(mocks.setFileDragActive).toHaveBeenLastCalledWith(false);
  });

  it('ignores a transient native leave followed by another drag-over during window expansion', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.nativeDropHandler?.({ kind: 'enter', names: ['photo.png'], position: [110, 18] });
    });
    const island = screen.getByTestId('titlebar-dynamic-island');
    await waitFor(() => expect(island).toHaveAttribute('data-panel', 'drop'));
    mocks.setFileDragActive.mockClear();

    act(() => {
      mocks.nativeDropHandler?.({ kind: 'leave' });
      mocks.nativeDropHandler?.({ kind: 'over', position: [114, 20] });
    });

    expect(island).toHaveAttribute('data-panel', 'drop');
    expect(mocks.setFileDragActive).not.toHaveBeenCalledWith(false);
  });

  it('reflects enabled scheduled tasks without starting another runtime', async () => {
    mocks.listJobs.mockResolvedValue([activeJob]);
    render(<TitlebarDynamicIsland />);

    await waitFor(() => {
      expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-status', 'active');
    });
    expect(screen.getByText('1 active')).toBeTruthy();
  });

  it('shows the real next task name instead of a generic countdown', async () => {
    mocks.listJobs.mockResolvedValue([
      {
        ...activeJob,
        name: 'AI 新闻洞察日报',
        state: {
          ...activeJob.state,
          next_run_at_ms: Date.now() + 3_600_000,
        },
      },
    ]);
    render(<TitlebarDynamicIsland floating />);

    expect(await screen.findByText(/^AI 新闻洞察日报 · /)).toBeTruthy();
    expect(screen.queryByText(/下一项任务/)).toBeNull();
  });

  it('opens the curved utility wheel and enters the focus timer without changing the route', async () => {
    render(<TitlebarDynamicIsland />);

    await screen.findByText('WINK GO is ready');
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.openUtilityWheel' }));

    expect(screen.getByTestId('titlebar-dynamic-island-tools-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: 'common.winkGoWorkspace.focusTimer' }));

    expect(screen.getByTestId('titlebar-dynamic-island-timer-panel')).toBeTruthy();
    expect(screen.getByText('25:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));

    expect(screen.queryByTestId('titlebar-dynamic-island-timer-panel')).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('uses the mouse wheel to select email and opens the email panel', async () => {
    render(<TitlebarDynamicIsland floating />);

    await screen.findByText('is ready');
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.openUtilityWheel' }));
    const wheel = screen.getByTestId('titlebar-dynamic-island-tools-panel');
    fireEvent.wheel(wheel, { deltaY: 120 });

    const mailTool = screen.getByRole('option', { name: 'common.winkGoWorkspace.mailNotifications' });
    expect(mailTool).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(mailTool);

    expect(screen.getByTestId('titlebar-dynamic-island-mail-panel')).toBeTruthy();
  });

  it('lists recent email and saves its body and attachments from the context menu', async () => {
    mocks.getMailStatus.mockResolvedValue({
      account: {
        enabled: true,
        label: 'QQ 邮箱',
        email: 'user@qq.com',
        username: 'user@qq.com',
        host: 'imap.qq.com',
        port: 993,
        security: 'tls',
        pollIntervalMinutes: 2,
        downloadDirectory: '',
        passwordConfigured: true,
      },
      state: 'connected',
      unreadCount: 4,
    });
    mocks.listMailMessages.mockResolvedValue([
      {
        id: 'user@qq.com:42',
        uid: 42,
        accountEmail: 'user@qq.com',
        senderName: '项目组',
        senderAddress: 'team@example.com',
        subject: '设计图与下载链接',
        receivedAt: Date.now(),
        hasAttachments: true,
        attachmentCount: 2,
        isUnread: true,
      },
    ]);
    render(<TitlebarDynamicIsland floating />);

    await screen.findByText('is ready');
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.openUtilityWheel' }));
    fireEvent.click(screen.getByRole('option', { name: 'common.winkGoWorkspace.mailNotifications' }));

    const subject = await screen.findByText('设计图与下载链接');
    expect(screen.getByRole('button', { name: 'common.winkGoWorkspace.downloadMailAttachments' })).toBeTruthy();
    fireEvent.click(subject.closest('article')!);
    expect(await screen.findByText('这是邮件的完整正文。')).toBeTruthy();
    expect(mocks.previewMail).toHaveBeenCalledWith({ uid: 42 });
    fireEvent.contextMenu(subject.closest('article')!);

    await waitFor(() => expect(mocks.downloadMail).toHaveBeenCalledWith({ uid: 42 }));
    expect(
      (await screen.findAllByRole('button', { name: 'common.winkGoWorkspace.openMailFolder' })).length
    ).toBeGreaterThan(0);
  });

  it('opens the full email body and hides download controls when there are no attachments', async () => {
    mocks.getMailStatus.mockResolvedValue({
      account: {
        enabled: true,
        label: 'QQ 邮箱',
        email: 'user@qq.com',
        username: 'user@qq.com',
        host: 'imap.qq.com',
        port: 993,
        security: 'tls',
        pollIntervalMinutes: 2,
        downloadDirectory: '',
        passwordConfigured: true,
      },
      state: 'connected',
      unreadCount: 1,
    });
    mocks.listMailMessages.mockResolvedValue([
      {
        id: 'user@qq.com:43',
        uid: 43,
        accountEmail: 'user@qq.com',
        senderName: '通知中心',
        senderAddress: 'notice@example.com',
        subject: '没有附件的正文邮件',
        receivedAt: Date.now(),
        hasAttachments: false,
        attachmentCount: 0,
        isUnread: true,
      },
    ]);
    mocks.previewMail.mockResolvedValue({
      ok: true,
      body: '这里显示邮件全文，不会写入下载目录。',
      attachmentNames: [],
    });
    render(<TitlebarDynamicIsland floating />);

    await screen.findByText('is ready');
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.openUtilityWheel' }));
    fireEvent.click(screen.getByRole('option', { name: 'common.winkGoWorkspace.mailNotifications' }));
    const subject = await screen.findByText('没有附件的正文邮件');
    fireEvent.click(subject.closest('article')!);

    expect(await screen.findByText('这里显示邮件全文，不会写入下载目录。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common.winkGoWorkspace.downloadMailAttachments' })).toBeNull();
    expect(mocks.downloadMail).not.toHaveBeenCalled();
  });

  it('shows a verification code directly in the message list', async () => {
    mocks.getMailStatus.mockResolvedValue({
      account: {
        enabled: true,
        label: 'QQ 邮箱',
        email: 'user@qq.com',
        username: 'user@qq.com',
        host: 'imap.qq.com',
        port: 993,
        security: 'tls',
        pollIntervalMinutes: 2,
        downloadDirectory: '',
        passwordConfigured: true,
      },
      state: 'connected',
      unreadCount: 1,
    });
    mocks.listMailMessages.mockResolvedValue([
      {
        id: 'user@qq.com:44',
        uid: 44,
        accountEmail: 'user@qq.com',
        senderName: 'ChatGPT',
        senderAddress: 'noreply@tm.openai.com',
        subject: '您的临时 ChatGPT 登录代码',
        receivedAt: Date.now(),
        hasAttachments: false,
        attachmentCount: 0,
        isUnread: true,
      },
    ]);
    mocks.previewMail.mockResolvedValue({
      ok: true,
      body: '您的验证码是 654321，请勿转发。',
      attachmentNames: [],
    });
    render(<TitlebarDynamicIsland floating />);

    await screen.findByText('is ready');
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.openUtilityWheel' }));
    fireEvent.click(screen.getByRole('option', { name: 'common.winkGoWorkspace.mailNotifications' }));

    expect(await screen.findByText('654321')).toBeTruthy();
    expect(mocks.previewMail).toHaveBeenCalledWith({ uid: 44 });
  });

  it('shows global tool activity from the shared conversation stream', async () => {
    render(<TitlebarDynamicIsland />);
    await screen.findByText('WINK GO is ready');

    act(() => {
      mocks.responseHandler?.({
        type: 'acp_tool_call',
        data: {
          update: {
            sessionUpdate: 'tool_call',
            tool_call_id: 'tool-1',
            status: 'in_progress',
            title: '读取项目文件',
            kind: 'read',
          },
        },
        msg_id: 'message-1',
        conversation_id: 'conversation-1',
      });
    });

    await screen.findByText('WINK GO · Running · 读取项目文件');
    expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-status', 'active');
  });

  it('expands MCP and Agent activity into the floating island message lane', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.responseHandler?.({
        type: 'tool_call',
        data: {
          call_id: 'mcp-call-1',
          name: 'mcp local task enqueue',
          description: '本地任务已进入本机执行队列',
          status: 'running',
        },
        msg_id: 'message-mcp-1',
        conversation_id: 'conversation-mcp-1',
      });
    });

    expect(await screen.findByTestId('titlebar-dynamic-island-toast-panel')).toHaveAttribute(
      'aria-label',
      'MCP · Running · mcp local task enqueue'
    );
  });

  it('expands XiaoZhi MCP connection changes into the same island message lane', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.xiaozhiHandler?.({
        runtime: { ok: true, label: 'Runtime', detail: 'ready', elapsedMs: 20 },
        bridge: { ok: true, label: 'LAN Bridge', detail: 'ready', elapsedMs: 30 },
        remoteGateway: {
          state: 'connected',
          enabled: true,
          connected: true,
          connecting: false,
          accountId: 'account',
          installationId: 'install',
          desktopId: 'desktop',
          deviceName: 'desktop',
          bindingCode: '',
          expiresInSeconds: 0,
          lastConnectedAt: '',
          lastSeenAt: '',
          lastError: '',
          relayUrl: 'wss://winkgo.top/desktop',
          migratedFromLegacy: false,
          enrolled: true,
          runtimeOnline: true,
          mcpReady: true,
        },
      } as WinkGoXiaozhiSnapshot);
    });

    expect(await screen.findByTestId('titlebar-dynamic-island-toast-panel')).toHaveTextContent('云端转发已连接');
  });

  it('shows the real ESP32 command and Runtime completion in the island activity history', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.xiaozhiActivityHandler?.({
        id: 'xiaozhi-command:xiaozhi_hardware:1:1',
        source: 'xiaozhi_hardware',
        sourceLabel: 'ESP32 小智',
        command: '打开网易云',
        toolName: 'music.station_open',
        status: 'success',
        message: 'WINK GO Runtime 已确认执行完成',
        startedAtMs: Date.now() - 300,
        updatedAtMs: Date.now(),
        elapsedMs: 300,
      });
    });

    const toast = await screen.findByTestId('titlebar-dynamic-island-toast-panel');
    expect(toast).toHaveTextContent('ESP32 小智');
    expect(toast).toHaveTextContent('打开网易云');
  });

  it('shows the active Windows media session and sends native playback controls', async () => {
    render(<TitlebarDynamicIsland />);
    await screen.findByText('WINK GO is ready');

    act(() => {
      mocks.mediaHandler?.({
        appId: 'QQMusic.exe',
        title: 'Zoo',
        artist: 'Ga$h Baby',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: '',
        updatedAt: Date.now(),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Zoo · Ga$h Baby' }));
    expect(screen.getByTestId('titlebar-dynamic-island-media-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.pauseMedia' }));
    expect(screen.getByRole('button', { name: 'common.winkGoWorkspace.playMedia' })).toBeTruthy();
    await waitFor(() => expect(mocks.controlMedia).toHaveBeenCalledWith({ action: 'play_pause' }));
  });

  it.each([
    ['system', 'MediaPlayer.exe'],
    ['netease', 'cloudmusic.exe'],
    ['qqmusic', 'QQMusic.exe'],
    ['kugou', 'KuGou.exe'],
    ['spotify', 'Spotify.exe'],
    ['apple', 'AppleMusic.exe'],
    ['echo', 'EchoMusic.exe'],
    ['lx-music', 'lx-music-desktop.exe'],
  ])('passes the selected %s platform to Windows and accepts its matching media session', async (target, appId) => {
    localStorage.setItem('winkgo_target_player', target);
    render(<TitlebarDynamicIsland />);

    await waitFor(() => {
      expect(mocks.configureWindowsRuntime).toHaveBeenCalledWith({
        mediaEnabled: true,
        mediaTarget: target,
        notificationEnabled: true,
      });
    });

    act(() => {
      mocks.mediaHandler?.({
        appId,
        title: 'Selected player track',
        artist: 'Artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,selected-player-cover',
        updatedAt: Date.now(),
      });
    });

    expect(screen.getByRole('button', { name: 'Selected player track · Artist' })).toBeTruthy();
  });

  it('switches the play button to pause immediately without waiting for Windows media feedback', async () => {
    render(<TitlebarDynamicIsland />);
    await screen.findByText('WINK GO is ready');

    act(() => {
      mocks.mediaHandler?.({
        appId: 'cloudmusic.exe',
        title: 'Paused NetEase track',
        artist: 'Artist',
        albumTitle: '',
        isPlaying: false,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: '',
        updatedAt: Date.now(),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Paused NetEase track · Artist' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.playMedia' }));

    expect(screen.getByRole('button', { name: 'common.winkGoWorkspace.pauseMedia' })).toBeTruthy();
    await waitFor(() => expect(mocks.controlMedia).toHaveBeenCalledWith({ action: 'play_pause' }));
  });

  it('shows and rotates the current album artwork while playback is active', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.mediaHandler?.({
        appId: 'Spotify.exe',
        title: 'Track with cover',
        artist: 'Artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,current-album',
        updatedAt: Date.now(),
      });
    });

    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(island).toHaveAttribute('data-identity-kind', 'media-cover');
    expect(island.querySelector('.titlebar-dynamic-island__brand--playing img')).toHaveAttribute(
      'src',
      'data:image/png;base64,current-album'
    );
  });

  it.each([
    ['system media', 'MediaPlayer.exe'],
    ['NetEase Cloud Music', 'cloudmusic.exe'],
    ['QQ Music', 'QQMusic.exe'],
    ['Kugou Music', 'KuGou.exe'],
    ['Spotify', 'Spotify.exe'],
    ['Apple Music', 'AppleMusic.exe'],
    ['EchoMusic', 'EchoMusic.exe'],
    ['LX Music', 'lx-music-desktop.exe'],
  ])('keeps the last verified artwork when %s temporarily reports an empty cover', async (_label, appId) => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    const firstSnapshot: WinkGoMediaSnapshot = {
      appId,
      title: 'Stable track',
      artist: 'Stable artist',
      albumTitle: 'Stable album',
      isPlaying: true,
      canPlayPause: true,
      canGoNext: true,
      canGoPrevious: true,
      coverUrl: 'data:image/png;base64,verified-cover',
      updatedAt: Date.now(),
    };

    act(() => {
      mocks.mediaHandler?.(firstSnapshot);
      mocks.mediaHandler?.({
        ...firstSnapshot,
        coverUrl: '',
        updatedAt: firstSnapshot.updatedAt + 1,
      });
    });

    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(island).toHaveAttribute('data-identity-kind', 'media-cover');
    expect(island.querySelector('.titlebar-dynamic-island__brand--media-cover img')).toHaveAttribute(
      'src',
      'data:image/png;base64,verified-cover'
    );
  });

  it('keeps the decoded cover during the brief next-track artwork handoff', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    const updatedAt = Date.now();
    act(() => {
      mocks.mediaHandler?.({
        appId: 'QQMusic.exe',
        title: 'First track',
        artist: 'First artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,first-verified-cover',
        updatedAt,
      });
    });
    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(island.querySelector('img[src="data:image/png;base64,first-verified-cover"]')).toBeTruthy();

    act(() => {
      mocks.mediaHandler?.({
        appId: 'QQMusic.exe',
        title: 'Second track',
        artist: 'Second artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: '',
        updatedAt: updatedAt + 1,
      });
    });

    expect(screen.getByRole('button', { name: 'WINK GO Second track · Second artist' })).toBeTruthy();
    expect(island).toHaveAttribute('data-identity-kind', 'media-app');
    expect(island.querySelector('img[src="data:image/png;base64,first-verified-cover"]')).toBeTruthy();

    act(() => {
      mocks.mediaHandler?.({
        appId: 'QQMusic.exe',
        title: 'Second track',
        artist: 'Second artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,second-verified-cover',
        updatedAt: updatedAt + 2,
      });
    });

    expect(island.querySelector('.titlebar-dynamic-island__brand--media-cover img')).toHaveAttribute(
      'src',
      'data:image/png;base64,second-verified-cover'
    );
  });

  it('falls back to the player logo immediately when a new track has no verified artwork', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');
    const updatedAt = Date.now();
    act(() => {
      mocks.mediaHandler?.({
        appId: 'KuGou.exe',
        title: 'Covered track',
        artist: 'Artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,kugou-cover',
        updatedAt,
      });
      mocks.mediaHandler?.({
        appId: 'KuGou.exe',
        title: 'Track without artwork',
        artist: 'Artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: '',
        updatedAt: updatedAt + 1,
      });
    });

    expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-identity-kind', 'media-app');
  });

  it('never carries artwork across music applications while the new player cover is loading', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.mediaHandler?.(createEchoMediaSnapshot('Echo track', 'data:image/png;base64,echo-cover', 1_000));
      mocks.mediaHandler?.({
        ...createEchoMediaSnapshot('Spotify track', '', 2_000),
        appId: 'Spotify.exe',
      });
    });

    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(island).toHaveAttribute('data-identity-kind', 'media-app');
    expect(island.querySelector('img[src="data:image/png;base64,echo-cover"]')).toBeNull();
  });

  it('ignores an older artwork snapshot that arrives after the current track', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.mediaHandler?.({
        appId: 'Spotify.exe',
        title: 'Current track',
        artist: 'Current artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,current-track-cover',
        updatedAt: 2_000,
      });
      mocks.mediaHandler?.({
        appId: 'Spotify.exe',
        title: 'Previous track',
        artist: 'Previous artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,late-previous-cover',
        updatedAt: 1_999,
      });
    });

    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(screen.getByRole('button', { name: 'WINK GO Current track · Current artist' })).toBeTruthy();
    expect(island.querySelector('.titlebar-dynamic-island__brand--media-cover img')).toHaveAttribute(
      'src',
      'data:image/png;base64,current-track-cover'
    );
  });

  it('restores the verified artwork when a previously played track returns without a cover', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.mediaHandler?.(createEchoMediaSnapshot('Track A', 'data:image/png;base64,track-a-cover', 1_000));
      mocks.mediaHandler?.(createEchoMediaSnapshot('Track B', 'data:image/png;base64,track-b-cover', 2_000));
      mocks.mediaHandler?.(createEchoMediaSnapshot('Track A', '', 3_000));
    });

    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(screen.getByRole('button', { name: 'WINK GO Track A · Artist' })).toBeTruthy();
    expect(island.querySelector('.titlebar-dynamic-island__brand--media-cover img')).toHaveAttribute(
      'src',
      'data:image/png;base64,track-a-cover'
    );
  });

  it('stops rotating the album artwork as soon as Windows reports playback paused', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    const media = {
      appId: 'cloudmusic.exe',
      title: 'Paused track',
      artist: 'NetEase artist',
      albumTitle: '',
      isPlaying: true,
      canPlayPause: true,
      canGoNext: true,
      canGoPrevious: true,
      coverUrl: 'data:image/png;base64,paused-album',
      updatedAt: Date.now(),
    };

    act(() => {
      mocks.mediaHandler?.(media);
    });

    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(island.querySelector('.titlebar-dynamic-island__brand--playing')).toBeTruthy();

    act(() => {
      mocks.mediaHandler?.({
        ...media,
        isPlaying: false,
        updatedAt: Date.now() + 1,
      });
    });

    expect(island.querySelector('.titlebar-dynamic-island__brand--playing')).toBeNull();
    expect(island.querySelector('.titlebar-dynamic-island__brand--media-cover img')).toHaveAttribute(
      'src',
      'data:image/png;base64,paused-album'
    );
  });

  it('opens synchronized lyrics with cover-matched ambience and returns when the background is clicked', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.mediaHandler?.({
        appId: 'QQMusic.exe',
        title: 'Zoo',
        artist: 'Ga$h Baby',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,zoo-cover',
        positionMs: 10_200,
        durationMs: 0,
        timelineUpdatedAt: Date.now(),
        timelineEstimated: true,
        updatedAt: Date.now(),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'WINK GO Zoo · Ga$h Baby' }));
    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(island).toHaveAttribute('data-panel', 'media');
    expect(screen.getByTestId('titlebar-dynamic-island-compact-media')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.openLyrics' }));
    expect(island).toHaveAttribute('data-panel', 'media');
    expect(island).toHaveAttribute('data-media-view', 'lyrics');
    const expandedPlayer = await screen.findByTestId('titlebar-dynamic-island-lyrics-view');
    expect(expandedPlayer).toBeTruthy();
    expect(screen.getByTestId('titlebar-dynamic-island-vinyl')).toHaveAttribute('data-playing', 'true');
    expect(screen.getByTestId('titlebar-dynamic-island-light-flow')).toBeTruthy();
    expect(screen.getByTestId('titlebar-dynamic-island-lyrics-backdrop')).toHaveStyle({
      backgroundImage: 'url("data:image/png;base64,zoo-cover")',
    });
    expect(screen.getByText('Second lyric').closest('[data-active="true"]')).toBeTruthy();
    expect(screen.getByText('First lyric').closest('[data-phase="past"]')).toBeTruthy();
    expect(screen.getByText('Second lyric').style.getPropertyValue('--lyric-progress')).toMatch(/^\d+%$/);
    expect(expandedPlayer).toHaveAttribute('data-platform', 'qqmusic');

    fireEvent.click(expandedPlayer);
    expect(island).toHaveAttribute('data-media-view', 'controls');
    const compactPlayer = screen.getByTestId('titlebar-dynamic-island-compact-media');
    expect(compactPlayer).toBeTruthy();

    fireEvent.click(compactPlayer);
    expect(island).toHaveAttribute('data-panel', 'none');
  });

  it('keeps the player usable when no trustworthy lyrics are found', async () => {
    mocks.getLyrics.mockImplementationOnce((request: { appId: string; title: string; artist: string }) =>
      Promise.resolve({
        status: 'not_found',
        trackKey: `${request.appId}\u0000${request.title}\u0000${request.artist}`.toLocaleLowerCase(),
        lines: [],
        fetchedAt: Date.now(),
      })
    );
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.mediaHandler?.({
        appId: 'Spotify.exe',
        title: 'Unknown song',
        artist: 'Unknown artist',
        albumTitle: '',
        isPlaying: false,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: '',
        updatedAt: Date.now(),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'WINK GO Unknown song · Unknown artist' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.openLyrics' }));
    expect(await screen.findByText('common.winkGoWorkspace.lyricsUnavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.playMedia' }));
    await waitFor(() => expect(mocks.controlMedia).toHaveBeenCalledWith({ action: 'play_pause' }));
    expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-media-view', 'lyrics');
  });

  it('keeps the floating media player open when a playback control is clicked', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.mediaHandler?.({
        appId: 'QQMusic.exe',
        title: 'Zoo',
        artist: 'Ga$h Baby',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,zoo-cover',
        updatedAt: Date.now(),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'WINK GO Zoo · Ga$h Baby' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.nextTrack' }));

    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(island).toHaveAttribute('data-panel', 'media');
    await waitFor(() => expect(mocks.controlMedia).toHaveBeenCalledWith({ action: 'next' }));
  });

  it('keeps transport controls clickable when a player reports incomplete capabilities', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.mediaHandler?.({
        appId: 'cloudmusic.exe',
        title: '播放器能力延迟',
        artist: '网易云音乐',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: false,
        canGoNext: false,
        canGoPrevious: false,
        coverUrl: '',
        updatedAt: Date.now(),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'WINK GO 播放器能力延迟 · 网易云音乐' }));
    const previous = screen.getByRole('button', {
      name: 'common.winkGoWorkspace.previousTrack',
    });
    const playPause = screen.getByRole('button', {
      name: 'common.winkGoWorkspace.pauseMedia',
    });
    const next = screen.getByRole('button', {
      name: 'common.winkGoWorkspace.nextTrack',
    });

    expect(previous).not.toBeDisabled();
    expect(playPause).not.toBeDisabled();
    expect(next).not.toBeDisabled();
    fireEvent.click(playPause);
    await waitFor(() => expect(mocks.controlMedia).toHaveBeenCalledWith({ action: 'play_pause' }));
  });

  it('refreshes the floating media metadata after skipping to the next track', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.mediaHandler?.({
        appId: 'cloudmusic.exe',
        title: '第一首',
        artist: '歌手甲',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,first-cover',
        updatedAt: Date.now(),
      });
    });
    mocks.getWindowsRuntimeState.mockResolvedValue({
      available: true,
      mediaEnabled: true,
      notificationEnabled: true,
      notificationAccess: 'Allowed',
      media: {
        appId: 'cloudmusic.exe',
        title: '第二首',
        artist: '歌手乙',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,second-cover',
        updatedAt: Date.now() + 1,
      },
      notification: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'WINK GO 第一首 · 歌手甲' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.nextTrack' }));

    await screen.findByText('第二首');
    expect(screen.getByText('歌手乙 · 网易云音乐')).toBeTruthy();
    expect(mocks.getWindowsRuntimeState).toHaveBeenCalled();
  });

  it('only keeps the previous post-skip artwork for the short visual handoff', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    const updatedAt = Date.now();
    act(() => {
      mocks.mediaHandler?.({
        appId: 'cloudmusic.exe',
        title: 'First track',
        artist: 'First artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,first-track-cover',
        updatedAt,
      });
    });
    mocks.getWindowsRuntimeState.mockResolvedValue({
      available: true,
      mediaEnabled: true,
      notificationEnabled: true,
      notificationAccess: 'Allowed',
      media: {
        appId: 'cloudmusic.exe',
        title: 'Second track',
        artist: 'Second artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: '',
        updatedAt: updatedAt + 1,
      },
      notification: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'WINK GO First track · First artist' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.nextTrack' }));

    await screen.findByText('Second track');
    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(island).toHaveAttribute('data-identity-kind', 'media-app');
    expect(island.querySelector('img[src="data:image/png;base64,first-track-cover"]')).toBeTruthy();
    await waitFor(() => expect(island.querySelector('img[src="data:image/png;base64,first-track-cover"]')).toBeNull(), {
      timeout: 1_200,
    });
  });

  it('retries previous once when the player only restarts the current track', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    const currentTrack = {
      appId: 'cloudmusic.exe',
      title: '当前歌曲',
      artist: '当前歌手',
      albumTitle: '',
      isPlaying: true,
      canPlayPause: true,
      canGoNext: true,
      canGoPrevious: true,
      coverUrl: 'data:image/png;base64,current-cover',
      updatedAt: Date.now(),
    };
    act(() => {
      mocks.mediaHandler?.(currentTrack);
    });
    mocks.getWindowsRuntimeState.mockResolvedValue({
      available: true,
      mediaEnabled: true,
      notificationEnabled: true,
      notificationAccess: 'Allowed',
      media: currentTrack,
      notification: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'WINK GO 当前歌曲 · 当前歌手' }));
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.previousTrack' }));

    await waitFor(
      () => {
        expect(mocks.controlMedia.mock.calls.filter(([payload]) => payload.action === 'previous')).toHaveLength(2);
      },
      { timeout: 2_000 }
    );
  });

  it('shows WeChat notifications with message privacy enabled by default', async () => {
    render(<TitlebarDynamicIsland />);
    await screen.findByText('WINK GO is ready');

    act(() => {
      mocks.notificationHandler?.({
        id: 'wechat-1',
        appName: '微信',
        title: '文件传输助手',
        body: '这段正文默认不应直接显示',
        appUserModelId: 'Tencent.WeChat',
        createdAt: Date.now(),
      });
    });

    fireEvent.click(screen.getByRole('button', { name: '微信 · 文件传输助手' }));
    expect(screen.getByTestId('titlebar-dynamic-island-notification-panel')).toBeTruthy();
    expect(screen.getByText('common.winkGoWorkspace.notificationBodyHidden')).toBeTruthy();
    expect(screen.queryByText('这段正文默认不应直接显示')).toBeNull();
  });

  it('downloads a mail body and attachments only after the user requests them', async () => {
    render(<TitlebarDynamicIsland />);
    await screen.findByText('WINK GO is ready');

    act(() => {
      mocks.mailNotificationHandler?.({
        id: 'winkgo-mail:user@example.com:42',
        appName: '邮箱',
        title: '项目组',
        body: '本周报告',
        appUserModelId: 'winkgo.mail.user@example.com',
        createdAt: Date.now(),
        mail: {
          uid: 42,
          accountEmail: 'user@example.com',
          hasAttachments: true,
          attachmentCount: 1,
        },
      });
    });

    expect(mocks.downloadMail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /项目组/ }));
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.downloadMailContent' }));

    await waitFor(() => expect(mocks.downloadMail).toHaveBeenCalledWith({ uid: 42 }));
    expect(await screen.findByText('common.winkGoWorkspace.mailDownloaded')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.openMailFolder' }));
    expect(mocks.showItemInFolder).toHaveBeenCalledWith({
      path: 'C:\\Downloads\\WINK GO 邮件\\user@example.com\\mail\\正文.txt',
    });
  });

  it('switches the identity and message copy when another application sends a notification', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.notificationHandler?.({
        id: 'qq-1',
        appName: 'QQ',
        title: 'Alice',
        body: '你好',
        appUserModelId: 'Tencent.QQ',
        createdAt: Date.now(),
      });
    });

    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(island).toHaveAttribute('data-identity-kind', 'notification-app');
    expect(island).toHaveAttribute('data-identity-label', 'QQ');
    expect(screen.getAllByText('QQ · Alice').length).toBeGreaterThan(0);
  });

  it('keeps the WINK GO mark visible for an unknown application notification', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.notificationHandler?.({
        id: 'chatgpt-1',
        appName: 'ChatGPT',
        title: '任务已完成',
        body: '',
        appUserModelId: 'OpenAI.ChatGPT',
        iconUrl: 'data:image/png;base64,blank-windows-icon',
        createdAt: Date.now(),
      });
    });

    const island = screen.getByTestId('titlebar-dynamic-island');
    expect(island).toHaveAttribute('data-identity-kind', 'brand');
    expect(island).toHaveAttribute('data-identity-label', 'ChatGPT');
    expect(island.querySelector('.titlebar-dynamic-island__identity img')).toHaveAttribute('data-winkgo-brand', 'true');
    expect(island.querySelector('img[src="data:image/png;base64,blank-windows-icon"]')).toBeNull();
  });

  it('shows queued application notifications one at a time', () => {
    vi.useFakeTimers();
    try {
      render(<TitlebarDynamicIsland floating />);
      act(() => {
        mocks.notificationHandler?.({
          id: 'wechat-queued',
          appName: '微信',
          title: '第一条消息',
          body: '',
          appUserModelId: 'Tencent.WeChat',
          createdAt: 1,
        });
        mocks.notificationHandler?.({
          id: 'mail-queued',
          appName: 'Outlook',
          title: '第二条消息',
          body: '',
          appUserModelId: 'Microsoft.Outlook',
          createdAt: 2,
        });
      });

      expect(screen.getByTestId('titlebar-dynamic-island-toast-panel')).toHaveAttribute(
        'aria-label',
        '微信 · 第一条消息'
      );
      expect(screen.queryByLabelText('Outlook · 第二条消息')).toBeNull();
      act(() => vi.advanceTimersByTime(7_400));
      expect(screen.getByTestId('titlebar-dynamic-island-toast-panel')).toHaveAttribute(
        'aria-label',
        'Outlook · 第二条消息'
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens the file inbox and category editor with the original shortcuts', async () => {
    render(<TitlebarDynamicIsland />);
    await screen.findByText('WINK GO is ready');

    fireEvent.keyDown(window, { altKey: true, key: '2' });
    expect(screen.getByTestId('titlebar-dynamic-island-files-panel')).toBeTruthy();

    fireEvent.keyDown(window, { altKey: true, key: '3' });
    expect(screen.getByTestId('titlebar-dynamic-island-category-panel')).toBeTruthy();
  });

  it('opens the compact local format workbench with Alt+4', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    fireEvent.keyDown(window, { altKey: true, key: '4' });

    expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-panel', 'format');
    expect(screen.getByTestId('titlebar-dynamic-island-format-panel')).toBeTruthy();
    expect(screen.getByText('NCM 转 MP3')).toBeTruthy();
  });

  describe('quick app shelf', () => {
    const notepad: WinkGoQuickApp = {
      name: 'Notepad',
      path: 'C:\\Windows\\System32\\notepad.exe',
      iconDataUrl: 'data:image/png;base64,bm90ZXBhZA==',
    };
    const calculator: WinkGoQuickApp = {
      name: 'Calculator',
      path: 'C:\\Windows\\System32\\calc.exe',
      iconDataUrl: 'data:image/png;base64,Y2FsYw==',
    };

    it('opens with Alt+5 and saves multiple selected applications without duplicates', async () => {
      localStorage.setItem('winkgo.quick-apps.v1', JSON.stringify([notepad]));
      mocks.selectQuickApps.mockResolvedValue([notepad, calculator]);
      render(<TitlebarDynamicIsland floating />);
      await screen.findByText('is ready');

      fireEvent.keyDown(window, { altKey: true, key: '5' });
      expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-panel', 'apps');
      fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.addQuickApps' }));

      await screen.findByRole('button', { name: 'Calculator' });
      expect(screen.getAllByRole('button', { name: 'Notepad' })).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem('winkgo.quick-apps.v1') || '[]')).toHaveLength(2);
    });

    it('launches a stored application and collapses the island', async () => {
      localStorage.setItem('winkgo.quick-apps.v1', JSON.stringify([notepad]));
      render(<TitlebarDynamicIsland floating />);
      await screen.findByText('is ready');

      fireEvent.keyDown(window, { altKey: true, key: '5' });
      fireEvent.click(screen.getByRole('button', { name: 'Notepad' }));

      await waitFor(() =>
        expect(mocks.launchQuickApp).toHaveBeenCalledWith({ path: 'C:\\Windows\\System32\\notepad.exe' })
      );
      expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-panel', 'none');
    });

    it('reorders applications after a long press without launching the dragged app', async () => {
      localStorage.setItem('winkgo.quick-apps.v1', JSON.stringify([notepad, calculator]));
      render(<TitlebarDynamicIsland floating />);
      await screen.findByText('is ready');
      fireEvent.keyDown(window, { altKey: true, key: '5' });

      const notepadButton = screen.getByRole('button', { name: 'Notepad' });
      const calculatorButton = screen.getByRole('button', { name: 'Calculator' });
      const notepadCard = notepadButton.closest<HTMLElement>('[data-quick-app-path]');
      const calculatorCard = calculatorButton.closest<HTMLElement>('[data-quick-app-path]');
      expect(notepadCard).toBeTruthy();
      expect(calculatorCard).toBeTruthy();
      vi.spyOn(notepadCard!, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 72 } as DOMRect);
      vi.spyOn(calculatorCard!, 'getBoundingClientRect').mockReturnValue({ left: 80, width: 72 } as DOMRect);

      vi.useFakeTimers();
      try {
        fireEvent.pointerDown(notepadCard!, { button: 0, pointerId: 1, clientX: 36, clientY: 36 });
        act(() => vi.advanceTimersByTime(421));
        expect(notepadCard).toHaveClass('titlebar-dynamic-island__quick-app--dragging');

        fireEvent.pointerMove(notepadCard!, { pointerId: 1, clientX: 116, clientY: 36 });
        fireEvent.pointerUp(notepadCard!, { pointerId: 1, clientX: 116, clientY: 36 });

        expect(
          (JSON.parse(localStorage.getItem('winkgo.quick-apps.v1') || '[]') as WinkGoQuickApp[]).map(
            (quickApp) => quickApp.name
          )
        ).toEqual(['Calculator', 'Notepad']);
        fireEvent.click(notepadButton);
        expect(mocks.launchQuickApp).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps a visible application fallback when a stored icon cannot be decoded', async () => {
      localStorage.setItem(
        'winkgo.quick-apps.v1',
        JSON.stringify([{ ...notepad, iconDataUrl: 'data:image/png;base64,broken' }])
      );
      render(<TitlebarDynamicIsland floating />);
      await screen.findByText('is ready');

      fireEvent.keyDown(window, { altKey: true, key: '5' });
      const button = screen.getByRole('button', { name: 'Notepad' });
      const iconImage = button.querySelector('img');
      expect(iconImage).toBeTruthy();

      fireEvent.error(iconImage as HTMLImageElement);
      expect(button.querySelector('img')).toBeNull();
      expect(button.querySelector('svg')).toBeTruthy();
    });

    it('refreshes missing icons for applications saved by an older version', async () => {
      const iconlessNotepad = { ...notepad, iconDataUrl: '' };
      localStorage.setItem('winkgo.quick-apps.v1', JSON.stringify([iconlessNotepad]));
      mocks.refreshQuickApps.mockResolvedValue([notepad]);
      render(<TitlebarDynamicIsland floating />);
      await screen.findByText('is ready');

      await waitFor(() =>
        expect(mocks.refreshQuickApps).toHaveBeenCalledWith({ paths: ['C:\\Windows\\System32\\notepad.exe'] })
      );
      fireEvent.keyDown(window, { altKey: true, key: '5' });

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Notepad' }).querySelector('img')).toHaveAttribute(
          'src',
          notepad.iconDataUrl
        )
      );
    });

    it('retries a transient icon extraction failure instead of keeping the generic placeholder', async () => {
      const iconlessNotepad = { ...notepad, iconDataUrl: '' };
      localStorage.setItem('winkgo.quick-apps.v1', JSON.stringify([iconlessNotepad]));
      mocks.refreshQuickApps.mockResolvedValueOnce([]).mockResolvedValueOnce([notepad]);
      render(<TitlebarDynamicIsland floating />);
      await screen.findByText('is ready');

      await waitFor(() => expect(mocks.refreshQuickApps).toHaveBeenCalledTimes(2), { timeout: 2_500 });
      fireEvent.keyDown(window, { altKey: true, key: '5' });

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Notepad' }).querySelector('img')).toHaveAttribute(
          'src',
          notepad.iconDataUrl
        )
      );
    });

    it('keeps the shelf open and reports a missing application instead of silently failing', async () => {
      localStorage.setItem('winkgo.quick-apps.v1', JSON.stringify([notepad]));
      mocks.launchQuickApp.mockResolvedValue({ error: 'not_found', launched: false });
      render(<TitlebarDynamicIsland floating />);
      await screen.findByText('is ready');

      fireEvent.keyDown(window, { altKey: true, key: '5' });
      fireEvent.click(screen.getByRole('button', { name: 'Notepad' }));

      expect(await screen.findByText('common.winkGoWorkspace.quickAppMissing')).toBeTruthy();
      expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-panel', 'apps');
    });
  });

  it('opens an organized file directly from the compact recent shelf', async () => {
    localStorage.setItem(
      'winkgo.organizer.recent-files.v1',
      JSON.stringify([
        {
          destination: 'C:\\WINK GO Inbox\\客户\\客户合同.pdf',
          finalName: '客户合同.pdf',
          category: 'documents',
          classification: '客户',
          fileType: 'PDF',
          sizeBytes: 18_432,
          organizedAt: Date.now(),
        },
      ])
    );
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    fireEvent.keyDown(window, { altKey: true, key: '2' });
    fireEvent.click(screen.getByRole('button', { name: /客户合同\.pdf/ }));

    await waitFor(() => expect(mocks.openFile).toHaveBeenCalledWith('C:\\WINK GO Inbox\\客户\\客户合同.pdf'));
  });

  it('shows only smart organization before custom categories exist and keeps staged files when changing root', async () => {
    mocks.showOpen.mockResolvedValueOnce(['C:\\incoming\\report.pdf']).mockResolvedValueOnce(['D:\\WINK GO 收纳箱']);
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    fireEvent.keyDown(window, { altKey: true, key: '2' });
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.chooseFiles' }));
    await screen.findByTestId('titlebar-dynamic-island-destination-panel');

    const destinationPanel = screen.getByTestId('titlebar-dynamic-island-destination-panel');
    expect(destinationPanel.querySelector('.titlebar-dynamic-island__destination-panel')).toHaveAttribute(
      'data-has-custom-destinations',
      'false'
    );
    expect(screen.getByRole('button', { name: /common\.winkGoWorkspace\.smartOrganize/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /common\.winkGoWorkspace\.fileCategories\.documents/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /common\.winkGoWorkspace\.newCategory/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /common\.edit/ }));

    await screen.findByText('D:\\WINK GO 收纳箱');
    expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-panel', 'destination');
  });

  it('scrolls custom collection destinations horizontally with a vertical mouse wheel', async () => {
    localStorage.setItem(
      'winkgo.organizer.rules.v1',
      JSON.stringify([
        { id: 'customer', name: '客户', keywords: ['客户'] },
        { id: 'contracts', name: '客户合同', keywords: ['合同'] },
        { id: 'assets', name: '品牌素材', keywords: ['素材'] },
      ])
    );
    mocks.showOpen.mockResolvedValue(['C:\\incoming\\report.pdf']);
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    fireEvent.keyDown(window, { altKey: true, key: '2' });
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.chooseFiles' }));
    const track = await screen.findByTestId('titlebar-dynamic-island-destination-track');
    Object.defineProperty(track, 'scrollWidth', { configurable: true, value: 900 });
    Object.defineProperty(track, 'clientWidth', { configurable: true, value: 560 });

    fireEvent.wheel(track, { deltaY: 120 });

    expect(track.scrollLeft).toBe(120);
    expect(track.querySelectorAll('.titlebar-dynamic-island__destination-card')).toHaveLength(4);
  });

  it('expands long system messages and marks them for horizontal scrolling', async () => {
    render(<TitlebarDynamicIsland floating />);
    await screen.findByText('is ready');

    act(() => {
      mocks.notificationHandler?.({
        id: 'long-system-message',
        appName: 'WINK GO',
        title: '已断开 · 本地 · 本地任务已进入本机执行队列，稍后会继续同步完整结果',
        body: '',
        appUserModelId: 'WINK.GO',
        createdAt: Date.now(),
      });
    });

    const toast = await screen.findByTestId('titlebar-dynamic-island-toast-panel');
    expect(toast).toHaveAttribute(
      'aria-label',
      'WINK GO · 已断开 · 本地 · 本地任务已进入本机执行队列，稍后会继续同步完整结果'
    );
    await waitFor(() =>
      expect(toast.querySelector('.titlebar-dynamic-island__toast-viewport--scrolling')).toBeTruthy()
    );
  });

  it('shows an error state when native file organization fails', async () => {
    mocks.showOpen.mockResolvedValue(['C:\\incoming\\report.pdf']);
    mocks.organizeFiles.mockRejectedValue(new Error('ORGANIZE_FAILED'));
    render(<TitlebarDynamicIsland />);
    await screen.findByText('WINK GO is ready');

    fireEvent.keyDown(window, { altKey: true, key: '2' });
    fireEvent.click(screen.getByRole('button', { name: 'common.winkGoWorkspace.chooseFiles' }));
    await screen.findByTestId('titlebar-dynamic-island-destination-panel');
    fireEvent.click(screen.getByRole('button', { name: /common.winkGoWorkspace.smartOrganize/ }));

    await screen.findByText('common.winkGoWorkspace.organizerFailed');
    expect(screen.getByTestId('titlebar-dynamic-island')).toHaveAttribute('data-status', 'error');
  });
});
