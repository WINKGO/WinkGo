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
  resolveWinkGoXiaozhiRuntimeLogPath,
  saveWinkGoXiaozhiConfig,
  startWinkGoRemoteGateway,
  startWinkGoXiaozhiRuntime,
  stopWinkGoRemoteGateway,
  subscribeWinkGoXiaozhiStatus,
  testWinkGoXiaozhiConnections,
} from '@process/services/WinkGoXiaozhiService';
import { WinkGoXiaozhiActivityMonitor } from '@process/services/WinkGoXiaozhiActivityService';

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
  const activityMonitor = new WinkGoXiaozhiActivityMonitor(resolveWinkGoXiaozhiRuntimeLogPath, (activity) => {
    ipcBridge.winkGoXiaozhi.activityChanged.emit(activity);
  });
  const stopActivityMonitor = activityMonitor.start();
  if (winkGoCloudAuthService.hasUsableSession() && winkGoCloudAuthService.hasCapability('mcp.miniapp')) {
    void getWinkGoXiaozhiSnapshot().catch((error) => {
      // Re-post the saved gateway configuration on every desktop start. This
      // deliberately makes the official ESP32 channel reconnect and refresh
      // its advertised Runtime capabilities instead of keeping a stale tool
      // cache after skills or music providers are changed.
      console.warn(
        '[WINK GO Xiaozhi] 启动时刷新 ESP32/小程序能力失败：',
        error instanceof Error ? error.message : String(error)
      );
    });
  }
  if (winkGoCloudAuthService.hasUsableSession() && winkGoCloudAuthService.hasCapability('remote.desktop')) {
    void startWinkGoRemoteGateway().catch(() => {
      // The settings page exposes a readable relay status; desktop startup must continue.
    });
  }
  app.once('will-quit', () => {
    unsubscribe();
    stopActivityMonitor();
    void stopWinkGoRemoteGateway();
  });
}
