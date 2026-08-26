/**
 * @license
 * Copyright 2026 WINK GO contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopAutomationStatus } from '@/common/types/desktopAutomation';

type Listener = () => void;

const electronMocks = vi.hoisted(() => {
  const windows: Array<Record<string, unknown>> = [];
  class BrowserWindow {
    options: Record<string, unknown>;
    listeners = new Map<string, Listener>();
    webContents = {
      id: windows.length + 1,
      send: vi.fn(),
      on: vi.fn((event: string, listener: Listener) => this.listeners.set(event, listener)),
      once: vi.fn(),
      session: {},
    };
    destroy = vi.fn();
    isDestroyed = vi.fn(() => false);
    loadFile = vi.fn(async () => undefined);
    loadURL = vi.fn(async () => undefined);
    setAlwaysOnTop = vi.fn();
    setBounds = vi.fn();
    setContentProtection = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    showInactive = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      windows.push(this as unknown as Record<string, unknown>);
    }
  }
  return { BrowserWindow, windows };
});

const registerTrustedWindowSecurity = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: electronMocks.BrowserWindow,
}));

vi.mock('@/process/startup/electronSecurity', () => ({ registerTrustedWindowSecurity }));

describe('Electron computer automation overlay adapter', () => {
  beforeEach(() => {
    vi.resetModules();
    electronMocks.windows.length = 0;
    registerTrustedWindowSecurity.mockClear();
  });

  it('loads the isolated overlay and delivers the latest state after the renderer is ready', async () => {
    const { createElectronAutomationOverlayWindowFactory } =
      await import('@/process/services/computer-automation/automationOverlayElectron');
    const createWindow = createElectronAutomationOverlayWindowFactory({
      preloadFile: 'C:/winkgo/preload/automationOverlayPreload.js',
      rendererFile: 'C:/winkgo/renderer/automation-overlay/automation-overlay.html',
      rendererUrl: 'http://127.0.0.1:5173/',
    });

    const overlay = createWindow({
      alwaysOnTop: true,
      focusable: false,
      frame: false,
      hasShadow: false,
      height: 1080,
      skipTaskbar: true,
      transparent: true,
      width: 1920,
      x: 0,
      y: 0,
    });
    const electronWindow = electronMocks.windows[0] as unknown as InstanceType<typeof electronMocks.BrowserWindow>;

    expect(electronWindow.options).toEqual(
      expect.objectContaining({
        enableLargerThanScreen: true,
        focusable: false,
        frame: false,
        hasShadow: false,
        backgroundColor: '#00000000',
        resizable: false,
        transparent: true,
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          navigateOnDragDrop: false,
          nodeIntegration: false,
          preload: 'C:/winkgo/preload/automationOverlayPreload.js',
          sandbox: true,
          webSecurity: true,
        }),
      })
    );
    expect(registerTrustedWindowSecurity).toHaveBeenCalledWith(
      electronWindow,
      expect.objectContaining({
        role: 'automation-overlay',
        productionEntryFile: 'C:/winkgo/renderer/automation-overlay/automation-overlay.html',
      })
    );
    expect(electronWindow.loadURL).toHaveBeenCalledWith(
      'http://127.0.0.1:5173/automation-overlay/automation-overlay.html'
    );

    const status: DesktopAutomationStatus = {
      phase: 'recording',
      targetDisplayIds: [1],
      updatedAt: 42,
    };
    overlay.sendStatus(status);
    overlay.showInactive();
    expect(electronWindow.webContents.send).not.toHaveBeenCalled();
    expect(electronWindow.showInactive).not.toHaveBeenCalled();

    electronWindow.listeners.get('did-finish-load')?.();
    expect(electronWindow.webContents.send).toHaveBeenCalledWith('winkgo-computer-automation:overlay-status', status);
    expect(electronWindow.showInactive).toHaveBeenCalledOnce();
    expect(electronWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  });
});
