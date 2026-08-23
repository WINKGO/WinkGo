// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { initApplicationBridge } from './applicationBridge';
import { initDialogBridge } from './dialogBridge';
import { initUpdateBridge } from './updateBridge';
import { initSystemSettingsBridge } from './systemSettingsBridge';
import { initWindowControlsBridge } from './windowControlsBridge';
import { initNotificationBridge } from './notificationBridge';
import { initWebuiBridge } from './webuiBridge';
import { initThemeBridge } from './themeBridge';
import {
  initWinkGoAuthBridge,
  initWinkGoBrowserComputerUseBridge,
  initWinkGoDesktopComputerUseBridge,
  initWinkGoFilesBridge,
  initWinkGoFormatBridge,
  initWinkGoImageBridge,
  initWinkGoInspirationBridge,
  initWinkGoMailBridge,
  initWinkGoSkillsBridge,
  initWinkGoWindowsBridge,
  initWinkGoXiaozhiBridge,
} from './winkgo';

export type BridgeDependencies = Record<string, never>;

export function initAllBridges(_deps: BridgeDependencies = {}): void {
  initDialogBridge();
  initApplicationBridge();
  initWindowControlsBridge();
  initUpdateBridge();
  initSystemSettingsBridge();
  initNotificationBridge();
  initWebuiBridge();
  initThemeBridge();
  initWinkGoAuthBridge();
  initWinkGoBrowserComputerUseBridge();
  initWinkGoDesktopComputerUseBridge();
  initWinkGoSkillsBridge();
  initWinkGoFilesBridge();
  initWinkGoFormatBridge();
  initWinkGoImageBridge();
  initWinkGoMailBridge();
  initWinkGoWindowsBridge();
  initWinkGoInspirationBridge();
  initWinkGoXiaozhiBridge();
}

export {
  initApplicationBridge,
  initDialogBridge,
  initNotificationBridge,
  initSystemSettingsBridge,
  initThemeBridge,
  initUpdateBridge,
  initWindowControlsBridge,
  initWebuiBridge,
  initWinkGoAuthBridge,
  initWinkGoBrowserComputerUseBridge,
  initWinkGoDesktopComputerUseBridge,
  initWinkGoFilesBridge,
  initWinkGoFormatBridge,
  initWinkGoImageBridge,
  initWinkGoInspirationBridge,
  initWinkGoMailBridge,
  initWinkGoSkillsBridge,
  initWinkGoWindowsBridge,
  initWinkGoXiaozhiBridge,
};
export { registerWindowMaximizeListeners } from './windowControlsBridge';
export const disposeAllTeamSessions = (): Promise<void> => Promise.resolve();
