// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type WindowStub = {
  isDestroyed: () => boolean;
  webContents: {
    on: (event: string, handler: () => void) => void;
    setZoomFactor: ReturnType<typeof vi.fn>;
  };
  fire: (event: string) => void;
};

const { windows } = vi.hoisted(() => ({ windows: [] as WindowStub[] }));

vi.mock('electron', () => ({
  app: { on: vi.fn() },
  BrowserWindow: { getAllWindows: () => windows },
}));

import { fixZoomForWindow, initializeZoomFactor, setZoomFactor } from '@/process/utils/zoom';

const createWindow = (): WindowStub => {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    isDestroyed: () => false,
    webContents: {
      on: (event, handler) => {
        (handlers[event] ??= []).push(handler);
      },
      setZoomFactor: vi.fn(),
    },
    fire: (event) => {
      for (const handler of handlers[event] ?? []) handler();
    },
  };
};

describe('fixed utility window zoom', () => {
  beforeEach(() => {
    windows.length = 0;
    initializeZoomFactor(0.95);
  });

  it('keeps the Dynamic Island at native zoom while regular windows follow global UI scaling', () => {
    const island = createWindow();
    const main = createWindow();
    windows.push(island, main);

    fixZoomForWindow(island as never, 1);
    setZoomFactor(1.2);

    expect(island.webContents.setZoomFactor.mock.calls.map(([factor]) => factor)).toEqual([1, 1]);
    expect(main.webContents.setZoomFactor).toHaveBeenCalledExactlyOnceWith(1.2);
  });

  it('reapplies native zoom after the fixed window finishes loading', () => {
    const island = createWindow();

    fixZoomForWindow(island as never, 1);
    island.fire('did-finish-load');

    expect(island.webContents.setZoomFactor.mock.calls.map(([factor]) => factor)).toEqual([1, 1]);
  });
});
