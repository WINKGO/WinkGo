/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  desktopRun: vi.fn(),
  desktopCancel: vi.fn(),
  browserRun: vi.fn(),
  browserCancel: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    winkGoDesktopComputerUse: {
      getStatus: { invoke: vi.fn().mockResolvedValue({ phase: 'idle', stepCount: 0, updatedAt: 0 }) },
      run: { invoke: mocks.desktopRun },
      cancel: { invoke: mocks.desktopCancel },
      statusChanged: { on: vi.fn(() => vi.fn()) },
    },
    winkGoBrowserComputerUse: {
      getStatus: { invoke: vi.fn().mockResolvedValue({ phase: 'idle', stepCount: 0, updatedAt: 0 }) },
      run: { invoke: mocks.browserRun },
      cancel: { invoke: mocks.browserCancel },
      statusChanged: { on: vi.fn(() => vi.fn()) },
    },
  },
}));

vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useModelProviderList: () => ({
    providers: [{ id: 'local-openai', name: '我的视觉模型', models: ['vision-pro'] }],
    getAvailableModels: () => ['vision-pro'],
    formatModelLabel: (_provider: unknown, model: string) => model,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) => {
      const template = key === 'common.computerUse.steps' ? '第 {{count}} 步' : (options?.defaultValue ?? key);
      return options?.count === undefined ? template : template.replace('{{count}}', String(options.count));
    },
  }),
}));

vi.mock('@arco-design/web-react', () => {
  const Button = ({ children, onClick, disabled }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type='button' onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
  const TextArea = ({ value, placeholder, onChange }: any) => (
    <textarea value={value} placeholder={placeholder} onChange={(event) => onChange?.(event.target.value)} />
  );
  const Select = ({ value, placeholder, onChange, children }: any) => (
    <select aria-label={placeholder} value={value} onChange={(event) => onChange?.(event.target.value)}>
      <option value=''>{placeholder}</option>
      {children}
    </select>
  );
  Select.Option = ({ value, children }: any) => <option value={value}>{children}</option>;
  return { Button, Input: { TextArea }, Select };
});

vi.mock('@icon-park/react', () => ({ PauseOne: () => <i />, PlayOne: () => <i /> }));

import ComputerUsePanel from '@renderer/components/layout/Titlebar/ComputerUsePanel';

describe('ComputerUsePanel separates desktop and browser skills', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runs the desktop skill only through the desktop Computer Use bridge', async () => {
    mocks.desktopRun.mockResolvedValue({ ok: true, status: { phase: 'completed', stepCount: 1, updatedAt: 1 } });
    render(<ComputerUsePanel kind='desktop' />);

    fireEvent.change(screen.getByLabelText('选择视觉模型'), { target: { value: 'local-openai\u0000vision-pro' } });
    fireEvent.change(screen.getByPlaceholderText('例如：打开记事本并写入会议摘要'), {
      target: { value: '打开记事本并写入会议摘要' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始控制桌面' }));

    await waitFor(() =>
      expect(mocks.desktopRun).toHaveBeenCalledWith({
        goal: '打开记事本并写入会议摘要',
        model: { providerId: 'local-openai', model: 'vision-pro' },
        maxSteps: 12,
      })
    );
    expect(mocks.browserRun).not.toHaveBeenCalled();
  });

  it('runs the browser skill only through the in-app browser bridge', async () => {
    mocks.browserRun.mockResolvedValue({ ok: true, status: { phase: 'completed', stepCount: 1, updatedAt: 1 } });
    render(<ComputerUsePanel kind='browser' />);

    fireEvent.change(screen.getByLabelText('选择视觉模型'), { target: { value: 'local-openai\u0000vision-pro' } });
    fireEvent.change(screen.getByPlaceholderText('例如：在内置浏览器搜索 WINK GO 官网并打开下载页'), {
      target: { value: '打开 WINK GO 官网下载页' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始控制内置浏览器' }));

    await waitFor(() =>
      expect(mocks.browserRun).toHaveBeenCalledWith({
        goal: '打开 WINK GO 官网下载页',
        model: { providerId: 'local-openai', model: 'vision-pro' },
        maxSteps: 12,
      })
    );
    expect(mocks.desktopRun).not.toHaveBeenCalled();
  });

  it('renders the completed step count instead of the untranslated placeholder', async () => {
    mocks.desktopRun.mockResolvedValue({ ok: true, status: { phase: 'completed', stepCount: 3, updatedAt: 1 } });
    render(<ComputerUsePanel kind='desktop' />);

    fireEvent.change(screen.getByLabelText('选择视觉模型'), { target: { value: 'local-openai\u0000vision-pro' } });
    fireEvent.change(screen.getByPlaceholderText('例如：打开记事本并写入会议摘要'), {
      target: { value: '打开记事本' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始控制桌面' }));

    expect(await screen.findByText('第 3 步')).toBeInTheDocument();
    expect(screen.queryByText('第 {{count}} 步')).not.toBeInTheDocument();
  });
});
