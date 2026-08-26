/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  DESKTOP_AUTOMATION_OVERLAY_STATUS_CHANNEL,
  type DesktopAutomationStatus,
} from '@/common/types/desktopAutomation';

contextBridge.exposeInMainWorld('winkGoAutomationOverlay', {
  subscribe: (callback: (status: DesktopAutomationStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: DesktopAutomationStatus) => callback(status);
    ipcRenderer.on(DESKTOP_AUTOMATION_OVERLAY_STATUS_CHANNEL, handler);
    return () => ipcRenderer.off(DESKTOP_AUTOMATION_OVERLAY_STATUS_CHANNEL, handler);
  },
});
