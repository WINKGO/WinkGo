// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserWindow } from 'electron';
import type { Input } from 'electron';
import { trackPersistedWrite } from './persistOnQuit';

// Default to 95% for a more compact out-of-the-box layout. Must stay in sync
// with the renderer fallback (useFontScale) and is what Cmd/Ctrl+0 resets to.
// Users can still zoom with Cmd/Ctrl +/-/0 and their choice is persisted to
// ui.zoomFactor.
const UI_SCALE_DEFAULT = 0.95;
const UI_SCALE_MIN = 0.8;
const UI_SCALE_MAX = 1.3;
export const UI_SCALE_STEP = 0.05;

let currentZoomFactor = UI_SCALE_DEFAULT;
const fixedWindowZoomFactors = new WeakMap<BrowserWindow, number>();

export type ZoomShortcutAction = 'zoomIn' | 'zoomOut' | 'resetZoom';

// 将输入的缩放因子限制在允许范围，避免异常值 / Clamp zoom factor into safe range
const clampZoomFactor = (value: number): number => {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return UI_SCALE_DEFAULT;
  }
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
};

// 获取当前全局缩放值（供 renderer 查询显示）/ Expose current zoom for renderer state syncing
export const getZoomFactor = (): number => currentZoomFactor;

// 用持久化值初始化缩放，供应用启动时恢复 / Restore zoom from persisted config during startup
export const initializeZoomFactor = (factor: number | undefined): number => {
  currentZoomFactor = clampZoomFactor(factor ?? UI_SCALE_DEFAULT);
  return currentZoomFactor;
};

// 在新建窗口时应用最近一次缩放值 / Apply stored zoom to a newly created window
export const applyZoomToWindow = (win: BrowserWindow): void => {
  win.webContents.setZoomFactor(fixedWindowZoomFactors.get(win) ?? currentZoomFactor);
};

// Utility windows such as the desktop Dynamic Island have fixed pixel shells.
// Letting the app-wide UI zoom reach them enlarges the renderer while the native
// BrowserWindow bounds stay unchanged, which clips the bottom and right edges.
export const fixZoomForWindow = (win: BrowserWindow, factor = 1): void => {
  const fixedFactor = clampZoomFactor(factor);
  fixedWindowZoomFactors.set(win, fixedFactor);
  win.webContents.setZoomFactor(fixedFactor);
  win.webContents.on('did-finish-load', () => {
    if (!win.isDestroyed()) win.webContents.setZoomFactor(fixedWindowZoomFactors.get(win) ?? fixedFactor);
  });
};

// 将缩放同步到所有窗口，保持多窗口一致 / Sync zoom factor across all BrowserWindows
const updateAllWindowsZoom = (factor: number): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.setZoomFactor(fixedWindowZoomFactors.get(win) ?? factor);
  }
};

// 设置绝对缩放值，记录并广播给所有窗口 / Persist new zoom factor and broadcast to windows
export const setZoomFactor = (factor: number): number => {
  const clamped = clampZoomFactor(factor);
  currentZoomFactor = clamped;
  updateAllWindowsZoom(clamped);
  return clamped;
};

// 在当前值基础上增量调整缩放 / Adjust zoom by delta relative to current factor
export const adjustZoomFactor = (delta: number): number => {
  return setZoomFactor(currentZoomFactor + delta);
};

export const attachZoomShortcutsToWindow = (
  win: BrowserWindow,
  persistZoomFactor?: (factor: number) => void | Promise<void>
): void => {
  win.webContents.on('before-input-event', (event, input) => {
    const action = getZoomShortcutAction(input);
    if (!action) {
      return;
    }

    event.preventDefault();

    const updatedFactor =
      action === 'zoomIn'
        ? adjustZoomFactor(UI_SCALE_STEP)
        : action === 'zoomOut'
          ? adjustZoomFactor(-UI_SCALE_STEP)
          : setZoomFactor(UI_SCALE_DEFAULT);

    void persistZoomFactor?.(updatedFactor);
  });
};

export const setupZoomForWindow = (win: BrowserWindow): void => {
  applyZoomToWindow(win);
  attachZoomShortcutsToWindow(win, (factor) => {
    // Track the write so a ⌘± immediately followed by ⌘Q still flushes.
    const op = (async () => {
      try {
        const { ProcessConfig } = await import('./initStorage');
        await ProcessConfig.set('ui.zoomFactor', factor);
      } catch (error) {
        console.error('[WinkGo] Failed to persist zoom factor from keyboard shortcut:', error);
      }
    })();
    trackPersistedWrite(op);
  });
};

/**
 * Normalize platform-specific keyboard input into a zoom intent.
 * Prefer produced keys for layout safety; only rely on numpad codes as fallback.
 */
export const getZoomShortcutAction = (
  input: Pick<Input, 'type' | 'key' | 'code' | 'isComposing' | 'control' | 'meta' | 'alt'>,
  platform: NodeJS.Platform = process.platform
): ZoomShortcutAction | null => {
  if (input.type !== 'keyDown' || input.isComposing || input.alt) {
    return null;
  }

  const hasPrimaryModifier = platform === 'darwin' ? input.meta : input.control;
  if (!hasPrimaryModifier) {
    return null;
  }

  switch (input.key) {
    case '+':
    case '=':
      return 'zoomIn';
    case '-':
    case '_':
      return 'zoomOut';
    case '0':
      return 'resetZoom';
    default:
      break;
  }

  switch (input.code) {
    case 'NumpadAdd':
      return 'zoomIn';
    case 'NumpadSubtract':
      return 'zoomOut';
    case 'Numpad0':
      return input.key === 'Insert' ? null : 'resetZoom';
    default:
      return null;
  }
};
