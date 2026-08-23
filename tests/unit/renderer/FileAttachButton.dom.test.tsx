/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FileAttachButton from '@/renderer/components/media/FileAttachButton';

const { emitMock, navigateMock } = vi.hoisted(() => ({
  emitMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: { fs: { listAvailableSkills: { invoke: vi.fn().mockResolvedValue([]) } } },
}));
vi.mock('@/renderer/hooks/context/ConversationContext', () => ({ useConversationContextSafe: () => null }));
vi.mock('@/renderer/styles/colors', () => ({ iconColors: { primary: '#000' } }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('@/renderer/services/FileService', () => ({ FileService: { processDroppedFiles: vi.fn() } }));
vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit: emitMock } }));
vi.mock('react-router', () => ({ useNavigate: () => navigateMock }));
vi.mock('swr', () => ({ default: () => ({ data: [] }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      ({
        'common.fileAttach.addFiles': '添加文件',
        'common.fileAttach.manageSkills': '添加或管理技能',
        'common.browserComputerUse.title': 'WINK GO 浏览器 Computer Use',
        'common.browserComputerUse.hint': '使用模型操作软件内置浏览器',
        'common.desktopComputerUse.title': '桌面 Computer Use',
        'common.desktopComputerUse.hint': '使用视觉模型操作 Windows 软件',
        'cron.scheduledTasks': '定时任务',
        'conversation.mcp.openSettings': '前往工具设置',
      })[key] ??
      options?.defaultValue ??
      key,
  }),
}));
vi.mock('@icon-park/react', () => ({
  Browser: () => <i />,
  Calendar: () => <i />,
  Computer: () => <i />,
  FolderOpen: () => <i />,
  Lightning: () => <i />,
  Paperclip: () => <i />,
  Plus: () => <i />,
  Puzzle: () => <i />,
  Right: () => <i />,
  Shield: () => <i />,
}));
vi.mock('@arco-design/web-react', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Message: { error: vi.fn() },
  Trigger: ({ children, popup }: { children: React.ReactNode; popup: () => React.ReactNode }) => (
    <div>
      {children}
      <div data-testid='plus-menu'>{popup()}</div>
    </div>
  ),
}));

describe('FileAttachButton composer capability menu', () => {
  beforeEach(() => {
    emitMock.mockReset();
    navigateMock.mockReset();
  });

  it('keeps the plus button as a capability menu even with no loaded skills or MCP servers', () => {
    render(<FileAttachButton openFileSelector={vi.fn()} loadedSkills={[]} loadedMcpStatuses={[]} />);

    expect(screen.getByText('添加文件')).toBeInTheDocument();
    expect(screen.getByText('WINK GO 浏览器 Computer Use')).toBeInTheDocument();
    expect(screen.getByText('桌面 Computer Use')).toBeInTheDocument();
    expect(screen.getByText('定时任务')).toBeInTheDocument();
    expect(screen.getByText('添加或管理技能')).toBeInTheDocument();
    expect(screen.getByText('前往工具设置')).toBeInTheDocument();
  });

  it('opens desktop automation from the composer capability menu', () => {
    render(<FileAttachButton openFileSelector={vi.fn()} loadedSkills={[]} loadedMcpStatuses={[]} />);

    fireEvent.click(screen.getByText('桌面 Computer Use'));

    expect(emitMock).toHaveBeenCalledWith('dynamic-island.open-panel', 'desktopComputerUse');
  });

  it('routes scheduled tasks from the composer capability menu', () => {
    render(<FileAttachButton openFileSelector={vi.fn()} loadedSkills={[]} loadedMcpStatuses={[]} />);

    fireEvent.click(screen.getByText('定时任务'));

    expect(navigateMock).toHaveBeenCalledWith('/scheduled');
  });

  it('opens Browser Computer Use in the dynamic island from the composer menu', () => {
    render(<FileAttachButton openFileSelector={vi.fn()} loadedSkills={[]} loadedMcpStatuses={[]} />);

    fireEvent.click(screen.getByText('WINK GO 浏览器 Computer Use'));

    expect(emitMock).toHaveBeenCalledWith('dynamic-island.open-panel', 'browserComputerUse');
  });

  it('routes skill and MCP management to their real settings pages', () => {
    render(<FileAttachButton openFileSelector={vi.fn()} loadedSkills={[]} loadedMcpStatuses={[]} />);

    fireEvent.click(screen.getByText('添加或管理技能'));
    fireEvent.click(screen.getByText('前往工具设置'));

    expect(navigateMock).toHaveBeenNthCalledWith(1, '/settings/skills');
    expect(navigateMock).toHaveBeenNthCalledWith(2, '/settings/tools');
  });
});
