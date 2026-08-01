// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

// Hook Sentry IPC so the renderer SDK uses ipcRenderer.send instead of falling
// back to fetch('sentry-ipc://...'), which floods the DevTools Network panel.
// Bundled into this preload via `externalizeDepsPlugin({ exclude: [...] })` so
// Electron's sandbox-mode preload doesn't try to resolve it from node_modules.
import '@sentry/electron/preload';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { ADAPTER_BRIDGE_EVENT_KEY } from '../common/adapter/constant';

/**
 * @description 注入到renderer进程中, 用于与main进程通信
 * */
contextBridge.exposeInMainWorld('electronAPI', {
  emit: (name: string, data: unknown) => {
    return ipcRenderer
      .invoke(
        ADAPTER_BRIDGE_EVENT_KEY,
        JSON.stringify({
          name: name,
          data: data,
        })
      )
      .catch((error) => {
        console.error('IPC invoke error:', error);
        throw error;
      });
  },
  on: (callback: (payload: { value: unknown }) => void) => {
    const handler = (_event: unknown, value: unknown) => {
      callback({ value });
    };
    ipcRenderer.on(ADAPTER_BRIDGE_EVENT_KEY, handler);
    return () => {
      ipcRenderer.off(ADAPTER_BRIDGE_EVENT_KEY, handler);
    };
  },
  // 获取拖拽文件/目录的绝对路径 / Get absolute path for dragged file/directory
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // Save virtual files dragged from apps such as WeChat that do not expose a disk path.
  persistDroppedFile: (payload: { data: ArrayBuffer; name: string; type?: string }) =>
    ipcRenderer.invoke('winkgo-files:persist-dropped-file', payload),
  onNativeFileDrop: (
    callback: (
      event:
        | { kind: 'enter'; names: string[]; position: [number, number] }
        | { kind: 'over'; position: [number, number] }
        | { kind: 'leave' }
        | { kind: 'drop'; paths: string[]; position: [number, number] }
    ) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload:
        | { kind: 'enter'; names: string[]; position: [number, number] }
        | { kind: 'over'; position: [number, number] }
        | { kind: 'leave' }
        | { kind: 'drop'; paths: string[]; position: [number, number] }
    ) => callback(payload);
    ipcRenderer.on('winkgo-native-file-drop:event', handler);
    return () => ipcRenderer.off('winkgo-native-file-drop:event', handler);
  },
  // Feedback: collect and compress recent log files
  collectFeedbackLogs: () => ipcRenderer.invoke('feedback:collect-logs'),
  // Feedback: capture a screenshot of the current window
  captureFeedbackScreenshot: () => ipcRenderer.invoke('feedback:capture-screenshot'),
  // Feedback: forward diagnostics logs to the main process console
  logFeedbackEvent: (payload: { details?: unknown; level: 'info' | 'warn' | 'error'; message: string }) =>
    ipcRenderer.send('feedback:renderer-log', payload),
  recoverCorruptedDatabase: () => ipcRenderer.invoke('backend:recover-corrupted-database'),
  desktopIsland: {
    applySettings: (settings: { autoHideFullscreen: boolean; opacity: number; visible: boolean }) =>
      ipcRenderer.invoke('winkgo-desktop-island:apply-settings', settings),
    navigateMain: (route: string) => ipcRenderer.invoke('winkgo-desktop-island:navigate-main', route),
    ready: () => ipcRenderer.invoke('winkgo-desktop-island:ready'),
    setFileDragActive: (active: boolean) => ipcRenderer.invoke('winkgo-desktop-island:set-file-drag-active', active),
    setSize: (size: { height: number; width: number }) => ipcRenderer.invoke('winkgo-desktop-island:set-size', size),
  },
});

// Synchronously fetch the winkgo_core port and expose it to the renderer
// via contextBridge (direct window assignment is invisible under contextIsolation).
const backendPort = ipcRenderer.sendSync('get-backend-port') as number;
const initialLanguage = ipcRenderer.sendSync('get-initial-language') as string | null;
const backendStartupFailed = ipcRenderer.sendSync('get-backend-startup-failed') as boolean;
const backendStartupFailure = ipcRenderer.sendSync('get-backend-startup-failure') as unknown;
contextBridge.exposeInMainWorld('__backendPort', backendPort > 0 ? backendPort : 0);
contextBridge.exposeInMainWorld('__initialLanguage', initialLanguage ?? null);
contextBridge.exposeInMainWorld('__winkgoE2ETest', process.env.WINKGO_E2E_TEST === '1');
contextBridge.exposeInMainWorld('__backendStartupFailed', backendStartupFailed === true);
contextBridge.exposeInMainWorld('__backendStartupFailure', backendStartupFailure ?? null);

// 托盘事件监听 - 将 IPC 事件转换为 DOM 事件
// Tray event listeners - convert IPC events to DOM events
const trayEvents = [
  'tray:navigate-to-guid',
  'tray:navigate-to-conversation',
  'tray:open-about',
  'tray:pause-all-tasks',
  'tray:check-update',
];

for (const channel of trayEvents) {
  ipcRenderer.on(channel, (_event, ...args) => {
    window.dispatchEvent(new CustomEvent(channel, { detail: args[0] }));
  });
}
