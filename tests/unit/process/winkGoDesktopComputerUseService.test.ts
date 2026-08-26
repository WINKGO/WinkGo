/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopComputerUseRuntimePorts,
  DesktopComputerUseController,
  type DesktopComputerUseObservation,
  type DesktopComputerUsePorts,
} from '@process/services/winkGoDesktopComputerUseService';

const MODEL = { providerId: 'provider-fixture', model: 'vision-model-fixture' };
const observation = (screenshotPath: string): DesktopComputerUseObservation => ({
  target: {
    hwnd: 101,
    pid: 202,
    title: 'Notepad',
    processName: 'notepad.exe',
    rect: { x: 0, y: 0, width: 800, height: 600 },
  },
  screenshotPath,
  text: 'fixture',
  controls: [{ ref: 'uia:editor', name: 'Editor', rect: { left: 10, top: 20, right: 700, bottom: 500 } }],
  ocr: [],
});

describe('desktop Computer Use controller', () => {
  it('runs a model-selected observe-act-observe loop and completes only after visible verification', async () => {
    const observe = vi
      .fn()
      .mockResolvedValueOnce(observation('before.png'))
      .mockResolvedValueOnce(observation('after.png'));
    const act = vi.fn().mockResolvedValue({ observation: observation('after.png') });
    const plan = vi
      .fn()
      .mockResolvedValueOnce({ status: 'act', message: 'Type the note', action: { kind: 'click', x: 100, y: 120 } })
      .mockResolvedValueOnce({ status: 'done', message: 'The note editor is ready.' });
    const ports: DesktopComputerUsePorts = { observe, act, launch: vi.fn(), openPath: vi.fn(), plan, cancel: vi.fn() };
    const controller = new DesktopComputerUseController(ports);

    const result = await controller.run({ goal: 'Open the editor', model: MODEL, maxSteps: 4 });

    expect(result.ok).toBe(true);
    expect(result.status.phase).toBe('completed');
    expect(plan).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        goal: 'Open the editor',
        model: MODEL,
        observation: expect.objectContaining({ screenshotPath: 'before.png' }),
      })
    );
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ hwnd: 101, pid: 202 }),
        action: { kind: 'click', x: 100, y: 120 },
      })
    );
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('publishes the exact visible action before it is executed so the control border can render feedback', async () => {
    let finishAction!: (value: { observation: DesktopComputerUseObservation }) => void;
    const observe = vi.fn().mockResolvedValue(observation('before.png'));
    const act = vi.fn(
      () =>
        new Promise<{ observation: DesktopComputerUseObservation }>((resolve) => {
          finishAction = resolve;
        })
    );
    const plan = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'act',
        message: '点击保存按钮',
        action: { kind: 'click', x: 420, y: 360, label: '保存' },
      })
      .mockResolvedValueOnce({ status: 'done', message: '保存完成' });
    const controller = new DesktopComputerUseController({
      observe,
      act,
      launch: vi.fn(),
      openPath: vi.fn(),
      plan,
      cancel: vi.fn(),
    });
    const statuses: Array<ReturnType<typeof controller.getStatus>> = [];
    controller.onStatus((status) => statuses.push(status));

    const running = controller.run({ goal: '保存文档', model: MODEL, maxSteps: 2 });
    await vi.waitFor(() => expect(act).toHaveBeenCalledOnce());

    expect(statuses.at(-1)).toEqual(
      expect.objectContaining({
        phase: 'acting',
        action: { kind: 'click', x: 420, y: 360, label: '保存' },
        target: expect.objectContaining({ hwnd: 101, pid: 202 }),
      })
    );

    finishAction({ observation: observation('after.png') });
    await running;
  });

  it('finishes an unsaved typing task immediately after the fresh target observation proves the exact text', async () => {
    const afterTyping = { ...observation('typed.png'), text: 'WINK GO SAFE WINDOW PASS' };
    const observe = vi.fn().mockResolvedValue(observation('blank-notepad.png'));
    const act = vi.fn().mockResolvedValue({ observation: afterTyping });
    const plan = vi.fn().mockResolvedValue({
      status: 'act',
      message: '输入验收文字',
      action: { kind: 'type', text: 'WINK GO SAFE WINDOW PASS', label: '输入文字' },
    });
    const controller = new DesktopComputerUseController({
      observe,
      act,
      launch: vi.fn(),
      openPath: vi.fn(),
      plan,
      cancel: vi.fn(),
    });

    const result = await controller.run({
      goal: '在当前新窗口输入 WINK GO SAFE WINDOW PASS，不要保存',
      model: MODEL,
      maxSteps: 8,
    });

    expect(result).toMatchObject({ ok: true, status: { phase: 'completed', stepCount: 1 } });
    expect(plan).toHaveBeenCalledTimes(1);
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it('uses only the desktop observe and act Runtime tools instead of the removed recorder tools', async () => {
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({
        success: true,
        target: observation('before.png').target,
        screenshot_path: 'before.png',
        text: 'fixture',
        controls: [],
        ocr: [],
      })
      .mockResolvedValueOnce({
        success: true,
        observation: {
          success: true,
          target: observation('after.png').target,
          screenshot_path: 'after.png',
          text: 'fixture',
          controls: [],
          ocr: [],
        },
      });
    const plan = vi.fn();
    const ports = createDesktopComputerUseRuntimePorts({ callTool, plan });

    const observed = await ports.observe({ sessionId: 'session-fixture' });
    await ports.act({
      sessionId: 'session-fixture',
      target: { hwnd: observed.target.hwnd, pid: observed.target.pid },
      action: { kind: 'click', x: 30, y: 40 },
    });

    expect(callTool.mock.calls.map(([name]) => name)).toEqual(['desktop_automation.observe', 'desktop_automation.act']);
  });

  it('can launch an application inside the same bounded visual loop before continuing with it', async () => {
    const initial = observation('desktop-before.png');
    const launched = {
      ...observation('notepad-launched.png'),
      target: { ...observation('notepad-launched.png').target, hwnd: 303, pid: 404 },
    };
    const observe = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(launched);
    const launch = vi.fn().mockResolvedValue(launched);
    const plan = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'act',
        message: '启动记事本',
        action: { kind: 'launch', appName: '记事本', label: '打开记事本' },
      })
      .mockResolvedValueOnce({ status: 'done', message: '记事本已经打开。' });
    const controller = new DesktopComputerUseController({
      observe,
      act: vi.fn(),
      launch,
      openPath: vi.fn(),
      plan,
      cancel: vi.fn(),
    });

    const result = await controller.run({ goal: '打开记事本', model: MODEL, maxSteps: 3 });

    expect(result.ok).toBe(true);
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: expect.any(String), appName: '记事本' }));
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ target: { hwnd: 303, pid: 404 } }));
  });

  it('opens an explicit local file through the Runtime and binds the verified file window before editing', async () => {
    const initial = observation('desktop-before.png');
    const opened = {
      ...observation('file-opened.png'),
      target: {
        ...observation('file-opened.png').target,
        hwnd: 505,
        pid: 606,
        title: 'WINK-GO-Computer-Use-E2E.txt - Notepad',
      },
    };
    const observe = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(opened);
    const openPath = vi.fn().mockResolvedValue(opened);
    const plan = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'act',
        message: '打开指定验收文档',
        action: {
          kind: 'open_file',
          path: 'C:\\Users\\Administrator\\Desktop\\WINK-GO-Computer-Use-E2E.txt',
          label: '打开验收文档',
        },
      })
      .mockResolvedValueOnce({ status: 'done', message: '文档已经在记事本中打开。' });
    const controller = new DesktopComputerUseController({
      observe,
      act: vi.fn(),
      launch: vi.fn(),
      openPath,
      plan,
      cancel: vi.fn(),
    });

    const result = await controller.run({ goal: '打开并修改桌面验收文档', model: MODEL, maxSteps: 3 });

    expect(result.ok).toBe(true);
    expect(openPath).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        path: 'C:\\Users\\Administrator\\Desktop\\WINK-GO-Computer-Use-E2E.txt',
      })
    );
    expect(observe).toHaveBeenLastCalledWith(expect.objectContaining({ target: { hwnd: 505, pid: 606 } }));
  });

  it('opens an absolute file path before the first observation so another foreground document cannot be edited', async () => {
    const opened = {
      ...observation('file-opened.png'),
      target: {
        ...observation('file-opened.png').target,
        hwnd: 515,
        pid: 616,
        title: 'desktop-e2e.txt - Notepad',
      },
    };
    const observe = vi.fn().mockResolvedValue(opened);
    const openPath = vi.fn().mockResolvedValue(opened);
    const plan = vi.fn().mockResolvedValue({ status: 'done', message: '目标文件已绑定。' });
    const controller = new DesktopComputerUseController({
      observe,
      act: vi.fn(),
      launch: vi.fn(),
      openPath,
      plan,
      cancel: vi.fn(),
    });

    const result = await controller.run({
      goal: '修改 D:\\WINK GO AGENT\\实验室\\desktop-e2e.txt：写入 PASS。',
      model: MODEL,
      maxSteps: 2,
    });

    expect(result.ok).toBe(true);
    expect(openPath).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'D:\\WINK GO AGENT\\实验室\\desktop-e2e.txt' })
    );
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ target: { hwnd: 515, pid: 616 } }));
  });

  it('uses windows.open_path and observes the exact verified file window', async () => {
    const openedTarget = {
      hwnd: 707,
      pid: 808,
      title: 'WINK-GO-Computer-Use-E2E.txt - Notepad',
      process_name: 'Notepad.exe',
      rect: { x: 40, y: 50, width: 900, height: 700 },
    };
    const callTool = vi.fn().mockResolvedValueOnce({ success: true, window: openedTarget }).mockResolvedValueOnce({
      success: true,
      target: openedTarget,
      screenshot_path: 'opened.png',
      text: '任务状态：待处理',
      controls: [],
      ocr: [],
    });
    const ports = createDesktopComputerUseRuntimePorts({ callTool, plan: vi.fn() });

    const result = await ports.openPath({
      sessionId: 'session-open-file',
      path: 'C:\\Users\\Administrator\\Desktop\\WINK-GO-Computer-Use-E2E.txt',
    });

    expect(result.target).toEqual(expect.objectContaining({ hwnd: 707, pid: 808 }));
    expect(callTool.mock.calls).toEqual([
      [
        'windows.open_path',
        { path: 'C:\\Users\\Administrator\\Desktop\\WINK-GO-Computer-Use-E2E.txt' },
        { timeoutMs: 20_000 },
      ],
      ['desktop_automation.observe', { session_id: 'session-open-file', hwnd: 707, pid: 808 }, { timeoutMs: 30_000 }],
    ]);
  });

  it('binds a launched application to the exact verified window instead of an unrelated foreground window', async () => {
    const launchedTarget = {
      hwnd: 909,
      pid: 910,
      title: '计算器',
      process_name: 'ApplicationFrameHost.exe',
      rect: { x: 40, y: 50, width: 420, height: 640 },
    };
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'no active external window' })
      .mockResolvedValueOnce({ success: true, window: launchedTarget })
      .mockResolvedValueOnce({
        success: true,
        target: launchedTarget,
        screenshot_path: 'calculator.png',
        text: '0',
        controls: [],
        ocr: [],
      });
    const ports = createDesktopComputerUseRuntimePorts({ callTool, plan: vi.fn() });

    const result = await ports.launch({ sessionId: 'session-launch', appName: '计算器' });

    expect(result.target).toEqual(expect.objectContaining({ hwnd: 909, pid: 910 }));
    expect(callTool.mock.calls).toEqual([
      ['desktop_automation.observe', { session_id: 'session-launch', hwnd: 0, pid: 0 }, { timeoutMs: 2_000 }],
      ['windows.open_application', { app_name: '计算器', force_new_window: true }, { timeoutMs: 15_000 }],
      ['desktop_automation.observe', { session_id: 'session-launch', hwnd: 0, pid: 0 }, { timeoutMs: 8_000 }],
    ]);
  });

  it('accepts the Win32 rectangle tuple returned by the Windows application launcher', async () => {
    const launchedWindow = {
      hwnd: 1201,
      pid: 1202,
      title: '计算器',
      process: 'CalculatorApp.exe',
      rect: [10, 20, 330, 553],
    };
    const observedTarget = {
      hwnd: 1201,
      pid: 1202,
      title: '计算器',
      process_name: 'CalculatorApp.exe',
      rect: { left: 10, top: 20, right: 330, bottom: 553, width: 320, height: 533 },
    };
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'no active external window' })
      .mockResolvedValueOnce({ success: true, window: launchedWindow })
      .mockResolvedValueOnce({
        success: true,
        target: observedTarget,
        screenshot_path: 'calculator.png',
        text: '0',
        controls: [],
        ocr: [],
      });
    const ports = createDesktopComputerUseRuntimePorts({ callTool, plan: vi.fn() });

    const result = await ports.launch({ sessionId: 'session-launch', appName: 'Calculator' });

    expect(result.target).toEqual(
      expect.objectContaining({ hwnd: 1201, pid: 1202, rect: { x: 10, y: 20, width: 320, height: 533 } })
    );
    expect(callTool).toHaveBeenLastCalledWith(
      'desktop_automation.observe',
      { session_id: 'session-launch', hwnd: 0, pid: 0 },
      { timeoutMs: 8_000 }
    );
  });

  it('refuses to continue when an application launch has no verified target window', async () => {
    const callTool = vi.fn().mockResolvedValue({ success: true, message: 'launch requested' });
    const ports = createDesktopComputerUseRuntimePorts({
      callTool,
      plan: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(ports.launch({ sessionId: 'session-launch', appName: '计算器' })).rejects.toThrow('未能绑定到新窗口');

    expect(callTool.mock.calls.filter(([name]) => name === 'windows.open_application')).toHaveLength(1);
  });

  it('falls back to the active UWP host window when the launcher process cannot be observed directly', async () => {
    const launcherTarget = {
      hwnd: 1401,
      pid: 1402,
      title: '计算器',
      process_name: 'CalculatorApp.exe',
      rect: { x: 10, y: 20, width: 320, height: 533 },
    };
    const hostedTarget = {
      hwnd: 1501,
      pid: 1502,
      title: '计算器',
      process_name: 'ApplicationFrameHost.exe',
      rect: { x: 10, y: 20, width: 320, height: 533 },
    };
    const callTool = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: 'no active external window' })
      .mockResolvedValueOnce({ success: true, window: launcherTarget })
      .mockResolvedValueOnce({
        success: true,
        target: hostedTarget,
        screenshot_path: 'calculator-host.png',
        text: '0',
        controls: [],
        ocr: [],
      });
    const ports = createDesktopComputerUseRuntimePorts({ callTool, plan: vi.fn() });

    const result = await ports.launch({ sessionId: 'session-uwp', appName: '计算器' });

    expect(result.target).toEqual(expect.objectContaining({ hwnd: 1501, pid: 1502, title: '计算器' }));
    expect(callTool).toHaveBeenLastCalledWith(
      'desktop_automation.observe',
      { session_id: 'session-uwp', hwnd: 0, pid: 0 },
      { timeoutMs: 8_000 }
    );
  });

  it('refuses to reuse an already-open window after a launch request', async () => {
    const existingTarget = {
      hwnd: 1601,
      pid: 1602,
      title: '客户资料.txt - Notepad',
      process_name: 'Notepad.exe',
      rect: { x: 10, y: 20, width: 800, height: 600 },
    };
    const observationPayload = {
      success: true,
      target: existingTarget,
      screenshot_path: 'existing-notepad.png',
      text: 'existing content',
      controls: [],
      ocr: [],
    };
    const callTool = vi.fn(async (name: string) =>
      name === 'windows.open_application' ? { success: true, window: existingTarget } : observationPayload
    );
    const ports = createDesktopComputerUseRuntimePorts({
      callTool,
      plan: vi.fn(),
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await expect(ports.launch({ sessionId: 'session-existing', appName: 'Notepad' })).rejects.toThrow('原有窗口');
  });
});
