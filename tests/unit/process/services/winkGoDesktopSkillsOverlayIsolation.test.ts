/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callRuntimeTool: vi.fn(),
  disposeOverlay: vi.fn(),
  syncOverlay: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getAppMetrics: () => [],
    getPath: () => 'C:/winkgo-test',
  },
  screen: {
    getAllDisplays: () => [],
    getDisplayMatching: () => ({ id: 1 }),
    getPrimaryDisplay: () => ({ id: 1 }),
  },
}));

vi.mock('@process/services/WinkGoXiaozhiService', () => ({
  callWinkGoRuntimeTool: mocks.callRuntimeTool,
}));

vi.mock('@process/services/winkGoBrowserSkillAiService', () => ({
  selectWinkGoDesktopRepairCandidateWithAi: vi.fn(),
}));

vi.mock('@process/services/computer-automation/automationOverlayManager', () => ({
  AutomationOverlayManager: class {
    dispose = mocks.disposeOverlay;
    sync = mocks.syncOverlay;
  },
}));

vi.mock('@process/services/computer-automation/automationOverlayElectron', () => ({
  createElectronAutomationOverlayWindowFactory: () => vi.fn(),
}));

describe('WINK GO desktop skills overlay isolation', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.callRuntimeTool.mockReset().mockResolvedValue({ content: [] });
    mocks.disposeOverlay.mockReset();
    mocks.syncOverlay.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps publishing core recorder state when the decorative overlay throws', async () => {
    const service = await import('@process/services/winkGoDesktopSkillsService');
    const listener = vi.fn();
    const unsubscribe = service.onWinkGoDesktopAutomationStatus(listener);
    mocks.syncOverlay.mockImplementation(() => {
      throw new Error('overlay renderer unavailable');
    });

    await expect(service.cancelWinkGoDesktopAutomation()).resolves.toEqual(
      expect.objectContaining({ ok: true, status: expect.objectContaining({ phase: 'idle' }) })
    );
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'idle' }));

    unsubscribe();
    service.disposeWinkGoDesktopAutomation();
  });

  it('starts the current safe external window without a renderer-selected target', async () => {
    mocks.callRuntimeTool.mockImplementation(async (name: string) => ({
      structuredContent:
        name === 'desktop_automation.record_start_current'
          ? {
              success: true,
              target: {
                hwnd: 901,
                pid: 902,
                title: '今日计划 - 记事本',
                process_name: 'Notepad.exe',
                rect: { left: 20, top: 30, width: 900, height: 700 },
              },
              step_count: 0,
            }
          : { success: true },
    }));
    const service = await import('@process/services/winkGoDesktopSkillsService');

    await expect(service.startWinkGoDesktopRecording()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        status: expect.objectContaining({
          phase: 'recording',
          target: expect.objectContaining({ hwnd: 901, pid: 902, processName: 'Notepad.exe' }),
        }),
      })
    );
    expect(mocks.callRuntimeTool).toHaveBeenCalledWith(
      'desktop_automation.record_start_current',
      {},
      expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 30_000 })
    );
    expect(mocks.syncOverlay).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'arming', targetDisplayIds: [1] })
    );

    await service.cancelWinkGoDesktopAutomation();
    service.disposeWinkGoDesktopAutomation();
  });

  it('returns a bounded failure when the local automation runtime never responds', async () => {
    vi.useFakeTimers();
    mocks.callRuntimeTool.mockImplementation(() => new Promise(() => undefined));
    const service = await import('@process/services/winkGoDesktopSkillsService');

    const resultPromise = service.startWinkGoDesktopRecording();
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(resultPromise).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining('启动超时'),
        status: expect.objectContaining({ phase: 'error' }),
      })
    );
    service.disposeWinkGoDesktopAutomation();
  });
});
