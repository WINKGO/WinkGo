/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { DesktopRecorderTarget } from '@/common/types/desktopAutomation';
import { filterDesktopRecorderTargets } from '@process/services/computer-automation/desktopRecorderTargetPolicy';

const target = (patch: Partial<DesktopRecorderTarget>): DesktopRecorderTarget => ({
  hwnd: 100,
  pid: 200,
  title: '记事本',
  processName: 'Notepad.exe',
  rect: { x: 20, y: 20, width: 900, height: 700 },
  ...patch,
});

describe('desktop recorder target policy', () => {
  it('never offers WINK GO itself or desktop overlay pseudo-windows as recording targets', () => {
    const result = filterDesktopRecorderTargets(
      [
        target({ pid: 628, title: 'WINK GO', processName: 'electron.exe' }),
        target({ pid: 18048, title: 'Windows 输入体验', processName: 'TextInputHost.exe', rect: { x: 0, y: 0, width: 2560, height: 1440 } }),
        target({ pid: 4640, title: 'Program Manager', processName: 'explorer.exe', rect: { x: 0, y: 0, width: 2560, height: 1440 } }),
        target({ pid: 7384, title: 'NVIDIA GeForce Overlay', processName: 'NVIDIA Overlay.exe', rect: { x: 0, y: 0, width: 2559, height: 1440 } }),
        target({ pid: 33616, title: 'Minimized Edge', processName: 'msedge.exe', rect: { x: -32000, y: -32000, width: 160, height: 28 } }),
        target({ pid: 9000, title: '今日要做.txt - Notepad', processName: 'Notepad.exe' }),
      ],
      { hostPid: 628, blockedPids: [628, 629, 630] }
    );

    expect(result).toEqual([expect.objectContaining({ pid: 9000, processName: 'Notepad.exe' })]);
  });

  it('rejects every Electron helper process owned by WINK GO', () => {
    const result = filterDesktopRecorderTargets(
      [
        target({ pid: 629, title: 'WINK GO 动态岛', processName: 'electron.exe' }),
        target({ pid: 630, title: 'Control Border', processName: 'electron.exe' }),
        target({ pid: 9000, title: '计算器', processName: 'CalculatorApp.exe' }),
      ],
      { hostPid: 628, blockedPids: [628, 629, 630] }
    );

    expect(result.map((item) => item.pid)).toEqual([9000]);
  });

  it('rejects malformed geometry and WINK GO executable name variants even without process metrics', () => {
    const result = filterDesktopRecorderTargets(
      [
        target({ pid: 700, title: 'WINK GO', processName: 'WINK GO.exe' }),
        target({ pid: 701, title: 'WINK GO', processName: 'wink-go.exe' }),
        target({ pid: 702, rect: { x: 0, y: 0, width: Number.NaN, height: 500 } }),
        target({ pid: 703, rect: { x: Number.POSITIVE_INFINITY, y: 0, width: 800, height: 500 } }),
        target({ pid: 9000, title: '计算器', processName: 'CalculatorApp.exe' }),
      ],
      { hostPid: 628 }
    );

    expect(result.map((item) => item.pid)).toEqual([9000]);
  });
});
