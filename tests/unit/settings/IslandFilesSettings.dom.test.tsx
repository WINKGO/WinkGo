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
  getStartOnBootStatus: vi.fn(() =>
    Promise.resolve({
      success: true,
      data: { supported: true, enabled: false, isPackaged: true, platform: 'win32' },
    })
  ),
  navigate: vi.fn(),
  requestNotificationAccess: vi.fn(() => Promise.resolve({ status: 'Allowed' })),
  setStartOnBoot: vi.fn(),
  showOpen: vi.fn(),
  undo: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      getStartOnBootStatus: { invoke: mocks.getStartOnBootStatus },
      setStartOnBoot: { invoke: mocks.setStartOnBoot },
    },
    dialog: { showOpen: { invoke: mocks.showOpen } },
    winkGoFiles: {
      getDefaultFolder: { invoke: mocks.getDefaultFolder },
      undo: { invoke: mocks.undo },
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
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const shortcut of ['Ctrl + T', 'Ctrl + Shift + O', 'Ctrl + Shift + M', 'Ctrl + Shift + A']) {
      expect(screen.getByText(shortcut)).toBeInTheDocument();
    }
    await screen.findByText('C:\\Users\\Tester\\Documents\\WINK GO 收纳箱');
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
