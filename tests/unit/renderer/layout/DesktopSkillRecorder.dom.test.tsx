/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopRecorderStatus, DesktopRecorderTarget } from '@/common/types/desktopAutomation';

const IDLE_STATUS: DesktopRecorderStatus = {
  phase: 'idle',
  targetDisplayIds: [],
  updatedAt: 0,
  stepCount: 0,
  filteredEventCount: 0,
};

const RECORDING_STATUS: DesktopRecorderStatus = {
  ...IDLE_STATUS,
  phase: 'recording',
  sessionId: 'recording-session-a',
  updatedAt: 1,
};

const SECOND_RECORDING_STATUS: DesktopRecorderStatus = {
  ...RECORDING_STATUS,
  sessionId: 'recording-session-b',
  updatedAt: 2,
};

const TARGETS: DesktopRecorderTarget[] = [
  {
    hwnd: 101,
    pid: 201,
    title: 'Notepad',
    processName: 'notepad.exe',
    rect: { x: 0, y: 0, width: 800, height: 600 },
  },
  {
    hwnd: 102,
    pid: 202,
    title: 'Calculator',
    processName: 'calculator.exe',
    rect: { x: 20, y: 20, width: 400, height: 500 },
  },
];

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  listTargets: vi.fn(),
  listSkills: vi.fn(),
  refreshStatus: vi.fn(),
  start: vi.fn(),
  statusHandler: undefined as ((status: DesktopRecorderStatus) => void) | undefined,
  unsubscribe: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    winkGoDesktopSkills: {
      getStatus: { invoke: mocks.getStatus },
      listTargets: { invoke: mocks.listTargets },
      list: { invoke: mocks.listSkills },
      refreshStatus: { invoke: mocks.refreshStatus },
      start: { invoke: mocks.start },
      cancel: { invoke: vi.fn() },
      pause: { invoke: vi.fn() },
      resume: { invoke: vi.fn() },
      stopAndSave: { invoke: vi.fn() },
      run: { invoke: vi.fn() },
      remove: { invoke: vi.fn() },
      statusChanged: {
        on: (handler: (status: DesktopRecorderStatus) => void) => {
          mocks.statusHandler = handler;
          return mocks.unsubscribe;
        },
      },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: (() => {
    const t = (key: string) =>
      ({
        'common.desktopSkillRecorder.chooseTarget': '选择目标窗口',
        'common.desktopSkillRecorder.startRecording': '开始录制',
        'common.desktopSkillRecorder.ready': '准备就绪',
        'common.desktopSkillRecorder.recording': '正在录制',
        'common.desktopSkillRecorder.localOnly': '录制内容和参数仅保存在本机',
        'common.desktopSkillRecorder.noSkills': '还没有电脑自动化 Skill',
      })[key] ?? key;
    return () => ({ t });
  })(),
}));

vi.mock('@icon-park/react', () => ({
  Delete: () => <i />,
  PauseOne: () => <i />,
  PlayOne: () => <i />,
  Record: () => <i />,
  Save: () => <i />,
}));

vi.mock('@arco-design/web-react', () => {
  const Button = ({
    children,
    disabled,
    onClick,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    disabled?: boolean;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
    'aria-label'?: string;
  }) => (
    <button type='button' aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
  const Input = ({
    value,
    placeholder,
    onChange,
  }: {
    value?: string;
    placeholder?: string;
    onChange?: (value: string) => void;
  }) => <input value={value} placeholder={placeholder} onChange={(event) => onChange?.(event.target.value)} />;
  const Select = ({
    children,
    value,
    placeholder,
    onChange,
  }: {
    children?: React.ReactNode;
    value?: string;
    placeholder?: string;
    onChange?: (value: string) => void;
  }) => (
    <select aria-label={placeholder} value={value} onChange={(event) => onChange?.(event.target.value)}>
      <option value=''>{placeholder}</option>
      {children}
    </select>
  );
  Select.Option = ({ children, value }: { children?: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  );
  return { Button, Input, Select };
});

import DesktopSkillRecorder from '@renderer/components/layout/Titlebar/DesktopSkillRecorder';

const flushInitialLoad = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('DesktopSkillRecorder', () => {
  beforeEach(() => {
    mocks.getStatus.mockReset().mockResolvedValue(IDLE_STATUS);
    mocks.listTargets.mockReset().mockResolvedValue(TARGETS);
    mocks.listSkills.mockReset().mockResolvedValue([]);
    mocks.refreshStatus.mockReset().mockResolvedValue(RECORDING_STATUS);
    mocks.start.mockReset();
    mocks.unsubscribe.mockReset();
    mocks.statusHandler = undefined;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts recording in one click without asking the user to choose a window', async () => {
    const onRecordingStarted = vi.fn();
    let finishStart: ((result: { ok: boolean; status: DesktopRecorderStatus; error?: string }) => void) | undefined;
    mocks.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        })
    );
    render(<DesktopSkillRecorder onRecordingStarted={onRecordingStarted} />);
    await flushInitialLoad();

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const startButton = screen.getByRole('button', { name: '开始录制' });
    expect(startButton).toBeEnabled();
    fireEvent.click(startButton);

    expect(mocks.start).toHaveBeenCalledWith();
    await act(async () => {
      finishStart?.({ ok: true, status: RECORDING_STATUS });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRecordingStarted).toHaveBeenCalledTimes(1);
    expect(mocks.listTargets).not.toHaveBeenCalled();
  });

  it('keeps the recorder panel open when one-click recording fails', async () => {
    const onRecordingStarted = vi.fn();
    let finishStart: ((result: { ok: boolean; status: DesktopRecorderStatus; error?: string }) => void) | undefined;
    mocks.start.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishStart = resolve;
        })
    );
    render(<DesktopSkillRecorder onRecordingStarted={onRecordingStarted} />);
    await flushInitialLoad();

    fireEvent.click(screen.getByRole('button', { name: '开始录制' }));

    expect(mocks.start).toHaveBeenCalledWith();
    await act(async () => {
      finishStart?.({
        ok: false,
        status: IDLE_STATUS,
        error: '请先打开要录制的软件。',
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onRecordingStarted).not.toHaveBeenCalled();
    expect(screen.getByText('请先打开要录制的软件。')).toBeInTheDocument();
  });

  it('does not let a late initial status overwrite a newer pushed recorder session', async () => {
    let finishInitialStatus: ((status: DesktopRecorderStatus) => void) | undefined;
    mocks.getStatus.mockImplementation(
      () =>
        new Promise<DesktopRecorderStatus>((resolve) => {
          finishInitialStatus = resolve;
        })
    );
    render(<DesktopSkillRecorder />);

    act(() => mocks.statusHandler?.(SECOND_RECORDING_STATUS));
    expect(screen.getByText('正在录制')).toBeInTheDocument();

    await act(async () => {
      finishInitialStatus?.(IDLE_STATUS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('正在录制')).toBeInTheDocument();
  });

  it('keeps one status refresh in flight even when several timer ticks elapse', async () => {
    let finishRefresh: ((status: DesktopRecorderStatus) => void) | undefined;
    mocks.refreshStatus.mockImplementation(
      () => new Promise<DesktopRecorderStatus>((resolve) => (finishRefresh = resolve))
    );
    render(<DesktopSkillRecorder />);
    await flushInitialLoad();

    vi.useFakeTimers();
    act(() => mocks.statusHandler?.(RECORDING_STATUS));
    act(() => vi.advanceTimersByTime(4_500));
    expect(mocks.refreshStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishRefresh?.(RECORDING_STATUS);
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => vi.advanceTimersByTime(1_500));
    expect(mocks.refreshStatus).toHaveBeenCalledTimes(2);
  });

  it('keeps the same session single-flight guard while recording is paused', async () => {
    mocks.refreshStatus.mockImplementation(() => new Promise<DesktopRecorderStatus>(() => undefined));
    render(<DesktopSkillRecorder />);
    await flushInitialLoad();

    vi.useFakeTimers();
    act(() => mocks.statusHandler?.(RECORDING_STATUS));
    act(() => vi.advanceTimersByTime(1_500));
    expect(mocks.refreshStatus).toHaveBeenCalledTimes(1);

    act(() => mocks.statusHandler?.({ ...RECORDING_STATUS, phase: 'paused', updatedAt: 2 }));
    act(() => vi.advanceTimersByTime(3_000));
    expect(mocks.refreshStatus).toHaveBeenCalledTimes(1);
  });

  it('lets a new recording session refresh while an old session request is still pending', async () => {
    let finishOldRefresh: ((status: DesktopRecorderStatus) => void) | undefined;
    mocks.refreshStatus
      .mockImplementationOnce(
        () =>
          new Promise<DesktopRecorderStatus>((resolve) => {
            finishOldRefresh = resolve;
          })
      )
      .mockResolvedValueOnce({ ...SECOND_RECORDING_STATUS, target: TARGETS[1] });
    render(<DesktopSkillRecorder />);
    await flushInitialLoad();

    vi.useFakeTimers();
    act(() => mocks.statusHandler?.({ ...RECORDING_STATUS, target: TARGETS[0] }));
    act(() => vi.advanceTimersByTime(1_500));
    expect(mocks.refreshStatus).toHaveBeenCalledTimes(1);

    act(() => mocks.statusHandler?.({ ...SECOND_RECORDING_STATUS, target: TARGETS[1] }));
    await act(async () => {
      vi.advanceTimersByTime(1_500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.refreshStatus).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.winkgo-desktop-recorder__status small')).toHaveTextContent('Calculator');

    await act(async () => {
      finishOldRefresh?.({ ...RECORDING_STATUS, target: TARGETS[0] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(document.querySelector('.winkgo-desktop-recorder__status small')).toHaveTextContent('Calculator');
  });

  it('stops status polling when the recorder unmounts', async () => {
    const view = render(<DesktopSkillRecorder />);
    await flushInitialLoad();

    vi.useFakeTimers();
    act(() => mocks.statusHandler?.(RECORDING_STATUS));
    view.unmount();
    act(() => vi.advanceTimersByTime(6_000));

    expect(mocks.refreshStatus).not.toHaveBeenCalled();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });
});
