// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hide = vi.fn();
const close = vi.fn();
const mockWindow = {
  hide,
  close,
  minimize: vi.fn(),
  maximize: vi.fn(),
  unmaximize: vi.fn(),
  isMaximized: vi.fn(() => false),
  isDestroyed: vi.fn(() => false),
  on: vi.fn(),
};
const getFocusedWindow = vi.fn(() => mockWindow);
const getAllWindows = vi.fn(() => [] as (typeof mockWindow)[]);

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => getFocusedWindow(),
    getAllWindows: () => getAllWindows(),
  },
}));

const getCloseToTrayEnabled = vi.fn(() => false);
const getIsQuitting = vi.fn(() => false);
vi.mock('@process/utils/tray', () => ({
  getCloseToTrayEnabled: () => getCloseToTrayEnabled(),
  getIsQuitting: () => getIsQuitting(),
}));

type Provider = () => Promise<void> | void;
const providers: Record<string, Provider> = {};
vi.mock('@/common', () => ({
  ipcBridge: {
    windowControls: {
      minimize: { provider: (fn: Provider) => (providers.minimize = fn) },
      maximize: { provider: (fn: Provider) => (providers.maximize = fn) },
      unmaximize: { provider: (fn: Provider) => (providers.unmaximize = fn) },
      close: { provider: (fn: Provider) => (providers.close = fn) },
      isMaximized: { provider: (fn: Provider) => (providers.isMaximized = fn) },
      maximizedChanged: { emit: vi.fn() },
    },
  },
}));

describe('custom title-bar close', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    getFocusedWindow.mockReturnValue(mockWindow);
    getAllWindows.mockReturnValue([]);
    getCloseToTrayEnabled.mockReturnValue(false);
    getIsQuitting.mockReturnValue(false);
    const { initWindowControlsBridge } = await import('@/process/bridge/windowControlsBridge');
    initWindowControlsBridge();
  });

  it('hides instead of closing when close-to-tray is enabled', async () => {
    getCloseToTrayEnabled.mockReturnValue(true);
    await providers.close();
    expect(hide).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('closes when the application is quitting', async () => {
    getCloseToTrayEnabled.mockReturnValue(true);
    getIsQuitting.mockReturnValue(true);
    await providers.close();
    expect(close).toHaveBeenCalledOnce();
    expect(hide).not.toHaveBeenCalled();
  });

  it('falls back to the first live window when focus is lost', async () => {
    getFocusedWindow.mockReturnValue(null);
    getAllWindows.mockReturnValue([mockWindow]);
    getCloseToTrayEnabled.mockReturnValue(true);
    await providers.close();
    expect(hide).toHaveBeenCalledOnce();
  });
});
