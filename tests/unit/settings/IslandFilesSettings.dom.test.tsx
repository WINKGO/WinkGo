/**
 * @license
 * Copyright 2026 WINK GO
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import IslandFilesSettings from '@/renderer/pages/settings/IslandFilesSettings';
import { WINK_GO_ORGANIZER_STORAGE_KEYS } from '@/renderer/utils/winkgo/islandFilePreferences';

const mocks = vi.hoisted(() => ({
  applySettings: vi.fn(() => Promise.resolve(true)),
  getDefaultFolder: vi.fn(() => Promise.resolve('C:\\Users\\Tester\\Documents\\WINK GO 收纳箱')),
  getMailStatus: vi.fn(),
  getStartOnBootStatus: vi.fn(() =>
    Promise.resolve({
      success: true,
      data: { supported: true, enabled: false, isPackaged: true, platform: 'win32' },
    })
  ),
  navigate: vi.fn(),
  openExternal: vi.fn(() => Promise.resolve()),
  requestNotificationAccess: vi.fn(() => Promise.resolve({ status: 'Allowed' })),
  saveMailAccount: vi.fn(),
  testMailConnection: vi.fn(),
  checkMailNow: vi.fn(),
  clearMailAccount: vi.fn(),
  mailStatusHandler: undefined as ((status: unknown) => void) | undefined,
  setStartOnBoot: vi.fn(),
  showOpen: vi.fn(),
  undo: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        'settings.imap.title': '邮箱通知',
        'settings.imap.description': '通过本机 IMAP 安全收取新邮件，并在灵动岛提醒',
        'settings.imap.helpTooltip': '查看邮箱配置帮助',
        'settings.imap.helpTitle': '如何配置邮箱通知',
        'settings.imap.helpBody': '先开启 IMAP 并生成客户端授权码，再测试连接并保存。',
        'settings.imap.helpProviderHint': '常用邮箱官方直达入口',
        'settings.imap.helpOpenProvider': '打开 {{provider}}',
        'settings.imap.enabled': '启用邮箱接收',
        'settings.imap.account': '邮箱账号',
        'settings.imap.accountHint': '登录名留空时使用邮箱地址',
        'settings.imap.emailPlaceholder': 'name@example.com',
        'settings.imap.usernamePlaceholder': 'IMAP 登录名（可留空）',
        'settings.imap.server': 'IMAP 服务器',
        'settings.imap.serverHint': '仅支持 TLS 或强制 STARTTLS，不允许明文连接',
        'settings.imap.hostPlaceholder': 'imap.example.com',
        'settings.imap.tls': 'TLS',
        'settings.imap.starttls': 'STARTTLS',
        'settings.imap.password': '邮箱密码或授权码',
        'settings.imap.passwordHint': '优先使用邮箱服务商提供的客户端授权码',
        'settings.imap.passwordPlaceholder': '输入邮箱密码或客户端授权码',
        'settings.imap.interval': '检查间隔',
        'settings.imap.intervalHint': '每 1 到 60 分钟检查一次',
        'settings.imap.minutes': '分钟',
        'settings.imap.downloadDirectory': '正文与附件保存位置',
        'settings.imap.defaultDownloadDirectory': '默认保存位置',
        'settings.imap.chooseDirectory': '选择文件夹',
        'settings.imap.checkNow': '立即检查',
        'settings.imap.test': '测试连接',
        'settings.imap.save': '保存邮箱设置',
        'settings.imap.privacy': '密码使用安全存储',
        'settings.imap.saved': '邮箱设置已安全保存',
        'settings.imap.states.disabled': '未启用',
      };
      const template = translations[key] ?? key;
      return Object.entries(params ?? {}).reduce(
        (value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)),
        template
      );
    },
  }),
}));

vi.mock('@arco-design/web-react', async () => {
  const actual = await vi.importActual<typeof import('@arco-design/web-react')>('@arco-design/web-react');
  return {
    ...actual,
    Message: {
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
  };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      getStartOnBootStatus: { invoke: mocks.getStartOnBootStatus },
      setStartOnBoot: { invoke: mocks.setStartOnBoot },
    },
    dialog: { showOpen: { invoke: mocks.showOpen } },
    shell: { openExternal: { invoke: mocks.openExternal } },
    winkGoFiles: {
      getDefaultFolder: { invoke: mocks.getDefaultFolder },
      undo: { invoke: mocks.undo },
    },
    winkGoMail: {
      getStatus: { invoke: mocks.getMailStatus },
      saveAccount: { invoke: mocks.saveMailAccount },
      testConnection: { invoke: mocks.testMailConnection },
      checkNow: { invoke: mocks.checkMailNow },
      clearAccount: { invoke: mocks.clearMailAccount },
      statusChanged: {
        on: (handler: (status: unknown) => void) => {
          mocks.mailStatusHandler = handler;
          return () => {
            mocks.mailStatusHandler = undefined;
          };
        },
      },
    },
    winkGoWindows: {
      requestNotificationAccess: { invoke: mocks.requestNotificationAccess },
    },
  },
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageHeader', () => ({
  default: ({ title, description }: { title: React.ReactNode; description?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

describe('IslandFilesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.assign(window.electronAPI || {}, {
      desktopIsland: { applySettings: mocks.applySettings },
    });
    mocks.showOpen.mockResolvedValue(undefined);
    mocks.getMailStatus.mockResolvedValue({ account: null, state: 'disabled', unreadCount: 0 });
    mocks.saveMailAccount.mockResolvedValue({
      ok: true,
      status: { account: null, state: 'idle', unreadCount: 0 },
    });
    mocks.testMailConnection.mockResolvedValue({ ok: true, latencyMs: 88 });
    mocks.checkMailNow.mockResolvedValue({ account: null, state: 'connected', unreadCount: 0 });
    mocks.clearMailAccount.mockResolvedValue({ account: null, state: 'disabled', unreadCount: 0 });
    mocks.mailStatusHandler = undefined;
    mocks.undo.mockResolvedValue({ restored: [], failures: [] });
    mocks.setStartOnBoot.mockResolvedValue({
      success: true,
      data: { supported: true, enabled: true, isPackaged: true, platform: 'win32' },
    });
  });

  it('renders every requested island and file organizer setting', async () => {
    render(<IslandFilesSettings />);

    expect(screen.getByRole('heading', { name: '灵动岛与文件收纳' })).toBeInTheDocument();
    for (const label of [
      '轻量交互音效',
      '岛屿颜色',
      '目标媒体平台',
      '媒体控制器',
      '灵动岛不透明度',
      '开机自启动',
      '通知接收',
      '全屏自动隐藏',
      '隐藏或显示灵动岛',
      '活动上岛',
      '文件收纳',
      '启用文件投递',
      '收纳目录',
      '投递方式',
      '内容识别与智能文件名',
      '文件收纳盒快捷键',
      '新建分类快捷键',
      '格式快转快捷键',
      '最近文件',
      '快速新建会话',
      '快速切换文件夹',
      '快速切换模型',
      '快速切换授权模式',
      '备忘录快捷键',
      '微信通知卡片',
      '自定义文件分类',
      '邮箱通知',
      '邮箱账号',
      'IMAP 服务器',
      '邮箱密码或授权码',
      '检查间隔',
      '正文与附件保存位置',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const shortcut of ['Ctrl + T', 'Ctrl + Shift + O', 'Ctrl + Shift + M', 'Ctrl + Shift + A']) {
      expect(screen.getByText(shortcut)).toBeInTheDocument();
    }
    await screen.findByText('C:\\Users\\Tester\\Documents\\WINK GO 收纳箱');
  });

  it('sends IMAP credentials to the main process without persisting them in renderer storage', async () => {
    render(<IslandFilesSettings />);

    fireEvent.change(screen.getByPlaceholderText('name@example.com'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('imap.example.com'), { target: { value: 'imap.example.com' } });
    fireEvent.change(screen.getByPlaceholderText('输入邮箱密码或客户端授权码'), {
      target: { value: 'app-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存邮箱设置' }));

    await waitFor(() => {
      expect(mocks.saveMailAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
          host: 'imap.example.com',
          password: 'app-password',
          security: 'tls',
        })
      );
    });
    expect(JSON.stringify(window.localStorage)).not.toContain('app-password');
  });

  it('automatically fills the secure QQ Mail IMAP endpoint from the email address', async () => {
    render(<IslandFilesSettings />);

    const emailInput = screen.getByPlaceholderText('name@example.com');
    const hostInput = screen.getByPlaceholderText('imap.example.com');
    fireEvent.change(emailInput, { target: { value: '1394748660@qq.com' } });

    expect(hostInput).toHaveValue('imap.qq.com');
    fireEvent.change(screen.getByPlaceholderText('输入邮箱密码或客户端授权码'), {
      target: { value: 'qq-client-authorization-code' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存邮箱设置' }));

    await waitFor(() => {
      expect(mocks.saveMailAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          email: '1394748660@qq.com',
          host: 'imap.qq.com',
          port: 993,
          security: 'tls',
        })
      );
    });
  });

  it('repairs a saved email address that was mistakenly used as the QQ IMAP host', async () => {
    mocks.getMailStatus.mockResolvedValueOnce({
      account: {
        enabled: true,
        label: '',
        email: '1394748660@qq.com',
        username: '',
        host: '1394748660@qq.com',
        port: 993,
        security: 'tls',
        pollIntervalMinutes: 2,
        downloadDirectory: '',
        passwordConfigured: true,
      },
      state: 'idle',
      unreadCount: 0,
    });

    render(<IslandFilesSettings />);

    await waitFor(() => expect(screen.getByPlaceholderText('imap.example.com')).toHaveValue('imap.qq.com'));
  });

  it('opens email setup help from the question button and links to the provider', async () => {
    render(<IslandFilesSettings />);

    fireEvent.click(screen.getByRole('button', { name: '查看邮箱配置帮助' }));

    expect(await screen.findByText('如何配置邮箱通知')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /打开 QQ Mail/ }));
    expect(mocks.openExternal).toHaveBeenCalledWith('https://service.mail.qq.com/detail/0/75');
  });

  it('stores a custom organizer category for the desktop island', async () => {
    render(<IslandFilesSettings />);

    fireEvent.change(screen.getByPlaceholderText('分类名称，如：客户合同'), {
      target: { value: '客户合同' },
    });
    fireEvent.change(screen.getByPlaceholderText('识别关键词，用逗号分隔'), {
      target: { value: '合同，客户资料' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加分类' }));

    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(WINK_GO_ORGANIZER_STORAGE_KEYS.rules) || '[]');
      expect(stored).toEqual([
        expect.objectContaining({
          name: '客户合同',
          keywords: ['合同', '客户资料'],
        }),
      ]);
    });
  });
});
