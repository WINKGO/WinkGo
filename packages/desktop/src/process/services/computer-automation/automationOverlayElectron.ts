/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import type { BrowserWindowConstructorOptions } from 'electron';
import {
  DESKTOP_AUTOMATION_OVERLAY_STATUS_CHANNEL,
  type DesktopAutomationStatus,
} from '@/common/types/desktopAutomation';
import { resolveTrustedDevServerUrl } from '@/common/platform/electronSecurity';
import { registerTrustedWindowSecurity } from '@process/startup/electronSecurity';
import type { AutomationBorderWindowOptions, AutomationOverlayWindow } from './automationOverlayManager';

export interface ElectronAutomationOverlayFactoryOptions {
  preloadFile?: string;
  rendererFile?: string;
  rendererUrl?: string | null;
}

function defaultOutputFile(...segments: string[]): string {
  return path.join(app.getAppPath(), 'out', ...segments);
}

/**
 * Electron system-boundary adapter for AutomationOverlayManager.
 *
 * The manager owns overlay lifecycle and click-through policy. This adapter
 * owns only hardened BrowserWindow construction and renderer delivery.
 */
export function createElectronAutomationOverlayWindowFactory(
  options: ElectronAutomationOverlayFactoryOptions = {}
): (windowOptions: AutomationBorderWindowOptions) => AutomationOverlayWindow {
  const preloadFile = options.preloadFile ?? defaultOutputFile('preload', 'automationOverlayPreload.js');
  const rendererFile =
    options.rendererFile ?? defaultOutputFile('renderer', 'automation-overlay', 'automation-overlay.html');
  const rendererUrl = app.isPackaged
    ? null
    : resolveTrustedDevServerUrl(options.rendererUrl ?? process.env['ELECTRON_RENDERER_URL']);

  return (windowOptions) => {
    const browserWindowOptions: BrowserWindowConstructorOptions = {
      ...windowOptions,
      // Keep the native surface fully alpha-transparent.  The renderer only
      // paints the thin control border and the real cursor indicator.
      backgroundColor: '#00000000',
      enableLargerThanScreen: true,
      fullscreenable: false,
      maximizable: false,
      minimizable: false,
      movable: false,
      resizable: false,
      show: false,
      webPreferences: {
        allowRunningInsecureContent: false,
        contextIsolation: true,
        navigateOnDragDrop: false,
        nodeIntegration: false,
        preload: preloadFile,
        safeDialogs: true,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
      },
    };
    const window = new BrowserWindow(browserWindowOptions);

    registerTrustedWindowSecurity(window, {
      role: 'automation-overlay',
      productionEntryFile: rendererFile,
      devServerUrl: rendererUrl,
    });

    let rendererReady = false;
    let showRequested = false;
    let latestStatus: DesktopAutomationStatus | null = null;

    window.webContents.on('did-finish-load', () => {
      rendererReady = true;
      if (latestStatus) {
        window.webContents.send(DESKTOP_AUTOMATION_OVERLAY_STATUS_CHANNEL, latestStatus);
      }
      if (showRequested && !window.isDestroyed()) {
        window.showInactive();
        window.setIgnoreMouseEvents(true, { forward: true });
      }
    });

    const loadFallback = () => {
      void window.loadFile(rendererFile).catch((error) => {
        console.error('[ComputerAutomation] Failed to load Control Border overlay:', error);
      });
    };
    if (rendererUrl) {
      const url = new URL('/automation-overlay/automation-overlay.html', rendererUrl).toString();
      void window.loadURL(url).catch((error) => {
        console.warn('[ComputerAutomation] Overlay dev renderer failed, using built output:', error);
        loadFallback();
      });
    } else {
      loadFallback();
    }

    return {
      destroy: () => window.destroy(),
      isDestroyed: () => window.isDestroyed(),
      sendStatus: (status) => {
        latestStatus = status;
        if (rendererReady && !window.isDestroyed()) {
          window.webContents.send(DESKTOP_AUTOMATION_OVERLAY_STATUS_CHANNEL, status);
        }
      },
      setAlwaysOnTop: (flag, level) => window.setAlwaysOnTop(flag, level),
      setBounds: (bounds) => window.setBounds(bounds),
      setContentProtection: (enabled) => window.setContentProtection(enabled),
      setIgnoreMouseEvents: (ignore, ignoreOptions) => window.setIgnoreMouseEvents(ignore, ignoreOptions),
      setVisibleOnAllWorkspaces: (visible, workspaceOptions) =>
        window.setVisibleOnAllWorkspaces(visible, workspaceOptions),
      showInactive: () => {
        showRequested = true;
        if (rendererReady && !window.isDestroyed()) {
          window.showInactive();
          window.setIgnoreMouseEvents(true, { forward: true });
        }
      },
    };
  };
}
