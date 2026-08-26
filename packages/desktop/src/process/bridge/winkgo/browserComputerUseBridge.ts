/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  cancelWinkGoBrowserComputerUse,
  getWinkGoBrowserComputerUseStatus,
  onWinkGoBrowserComputerUseStatus,
  runWinkGoBrowserComputerUse,
} from '@process/services/winkGoBrowserComputerUseService';

let initialized = false;

export function initWinkGoBrowserComputerUseBridge(): void {
  if (initialized) return;
  initialized = true;
  ipcBridge.winkGoBrowserComputerUse.getStatus.provider(() => getWinkGoBrowserComputerUseStatus());
  ipcBridge.winkGoBrowserComputerUse.run.provider((request) => runWinkGoBrowserComputerUse(request));
  ipcBridge.winkGoBrowserComputerUse.cancel.provider(() => cancelWinkGoBrowserComputerUse());
  onWinkGoBrowserComputerUseStatus((status) => {
    ipcBridge.winkGoBrowserComputerUse.statusChanged.emit(status);
  });
}
