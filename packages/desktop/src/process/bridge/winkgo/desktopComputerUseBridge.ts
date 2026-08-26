/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, globalShortcut } from 'electron';
import { ipcBridge } from '@/common';
import {
  cancelWinkGoDesktopComputerUse,
  disposeWinkGoDesktopComputerUse,
  getWinkGoDesktopComputerUseStatus,
  onWinkGoDesktopControlPresence,
  onWinkGoDesktopComputerUseStatus,
  runWinkGoDesktopComputerUse,
  stopAllWinkGoDesktopComputerUseForUser,
} from '@process/services/winkGoDesktopComputerUseRuntimeService';
import { DesktopComputerUseEmergencyStop } from '@process/services/desktop-computer-use/emergencyStop';

let initialized = false;

export function initWinkGoDesktopComputerUseBridge(): void {
  if (initialized) return;
  initialized = true;
  ipcBridge.winkGoDesktopComputerUse.getStatus.provider(() => getWinkGoDesktopComputerUseStatus());
  ipcBridge.winkGoDesktopComputerUse.run.provider((request) => runWinkGoDesktopComputerUse(request));
  ipcBridge.winkGoDesktopComputerUse.cancel.provider(() => cancelWinkGoDesktopComputerUse());
  const unsubscribe = onWinkGoDesktopComputerUseStatus((status) => {
    ipcBridge.winkGoDesktopComputerUse.statusChanged.emit(status);
  });
  const emergencyStop = new DesktopComputerUseEmergencyStop({
    shortcut: globalShortcut,
    stop: stopAllWinkGoDesktopComputerUseForUser,
  });
  const unsubscribeControlPresence = onWinkGoDesktopControlPresence((active) => {
    if (!active) {
      emergencyStop.dispose();
      return;
    }
    if (app.isReady()) emergencyStop.activate();
    else app.once('ready', () => emergencyStop.activate());
  });
  app.once('will-quit', () => {
    emergencyStop.dispose();
    unsubscribeControlPresence();
    unsubscribe();
    disposeWinkGoDesktopComputerUse();
  });
}
