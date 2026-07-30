/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { app } from 'electron';
import { winkGoCloudAuthService } from '@process/services/WinkGoCloudAuthService';
import { requireWinkGoCapability } from '@process/services/winkGoEditionGuard';
import {
  authorizeWinkGoXiaozhiFirewall,
  detectWinkGoLanIp,
  getWinkGoXiaozhiSnapshot,
  refreshWinkGoBindingCode,
  saveWinkGoXiaozhiConfig,
  startWinkGoRemoteGateway,
  startWinkGoXiaozhiRuntime,
  stopWinkGoRemoteGateway,
  subscribeWinkGoXiaozhiStatus,
  testWinkGoXiaozhiConnections,
} from '@process/services/WinkGoXiaozhiService';

let initialized = false;

const capture = async <T>(task: () => Promise<T>): Promise<ipcBridge.WinkGoInspirationResult<T>> => {
  try {
    return { success: true, data: await task() };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const capturePro = async <T>(task: () => Promise<T>): Promise<ipcBridge.WinkGoInspirationResult<T>> =>
  capture(async () => {
    requireWinkGoCapability('mcp.miniapp');
    return task();
  });

/** Registers the on-demand WINK GO XiaoZhi dual-channel bridge. */
export function initWinkGoXiaozhiBridge(): void {
  if (initialized) return;
  initialized = true;
  ipcBridge.winkGoXiaozhi.getSnapshot.provider(() => capturePro(getWinkGoXiaozhiSnapshot));
  ipcBridge.winkGoXiaozhi.saveConfig.provider((request) => capturePro(() => saveWinkGoXiaozhiConfig(request)));
  ipcBridge.winkGoXiaozhi.testConnections.provider(() => capturePro(testWinkGoXiaozhiConnections));
  ipcBridge.winkGoXiaozhi.startRuntime.provider(() => capturePro(startWinkGoXiaozhiRuntime));
  ipcBridge.winkGoXiaozhi.refreshBindingCode.provider(() => capturePro(refreshWinkGoBindingCode));
  ipcBridge.winkGoXiaozhi.authorizeFirewall.provider(() => capturePro(authorizeWinkGoXiaozhiFirewall));
  ipcBridge.winkGoXiaozhi.detectLanIp.provider(() => capturePro(async () => detectWinkGoLanIp()));
  const unsubscribe = subscribeWinkGoXiaozhiStatus((snapshot) => {
    ipcBridge.winkGoXiaozhi.statusChanged.emit(snapshot);
  });
  if (winkGoCloudAuthService.hasUsableSession() && winkGoCloudAuthService.hasCapability('remote.desktop')) {
    void startWinkGoRemoteGateway().catch(() => {
      // The settings page exposes a readable relay status; desktop startup must continue.
    });
  }
  app.once('will-quit', () => {
    unsubscribe();
    void stopWinkGoRemoteGateway();
  });
}
