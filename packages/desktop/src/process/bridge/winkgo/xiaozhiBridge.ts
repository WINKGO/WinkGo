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
  bindWinkGoNeteaseAccount,
  detectWinkGoLanIp,
  getWinkGoNeteaseAccount,
  getWinkGoXiaozhiSnapshot,
  refreshWinkGoBindingCode,
  resolveWinkGoXiaozhiRuntimeLogPath,
  saveWinkGoXiaozhiConfig,
  startWinkGoRemoteGateway,
  startWinkGoXiaozhiRuntime,
  stopWinkGoRemoteGateway,
  subscribeWinkGoXiaozhiStatus,
  testWinkGoXiaozhiConnections,
  unbindWinkGoNeteaseAccount,
} from '@process/services/WinkGoXiaozhiService';
import { WinkGoXiaozhiActivityMonitor } from '@process/services/WinkGoXiaozhiActivityService';

let initialized = false;

export const startWinkGoXiaozhiAtLaunch = async ({
  hasUsableSession,
  hasXiaozhiCapability,
  startRuntime,
}: {
  hasUsableSession: boolean;
  hasXiaozhiCapability: boolean;
  startRuntime: () => Promise<unknown>;
}): Promise<boolean> => {
  if (!hasUsableSession || !hasXiaozhiCapability) return false;
  await startRuntime();
  return true;
};

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
  ipcBridge.winkGoXiaozhi.getNeteaseAccount.provider(() => capturePro(getWinkGoNeteaseAccount));
  ipcBridge.winkGoXiaozhi.bindNeteaseAccount.provider((request) =>
    capturePro(() => bindWinkGoNeteaseAccount(request.musicU))
  );
  ipcBridge.winkGoXiaozhi.unbindNeteaseAccount.provider(() => capturePro(unbindWinkGoNeteaseAccount));
  const unsubscribe = subscribeWinkGoXiaozhiStatus((snapshot) => {
    ipcBridge.winkGoXiaozhi.statusChanged.emit(snapshot);
  });
  const activityMonitor = new WinkGoXiaozhiActivityMonitor(resolveWinkGoXiaozhiRuntimeLogPath, (activity) => {
    ipcBridge.winkGoXiaozhi.activityChanged.emit(activity);
  });
  const stopActivityMonitor = activityMonitor.start();
  void startWinkGoXiaozhiAtLaunch({
    hasUsableSession: winkGoCloudAuthService.hasUsableSession(),
    hasXiaozhiCapability: winkGoCloudAuthService.hasCapability('mcp.miniapp'),
    startRuntime: startWinkGoXiaozhiRuntime,
  }).catch((error) => {
    // Starting here also runs the packaged-Runtime upgrade check before the
    // ESP32 channel reconnects, so a customer never keeps routing through a
    // stale executable merely because they did not open the MCP settings page.
    console.warn(
      '[WINK GO Xiaozhi] 启动时更新并连接 Runtime 失败：',
      error instanceof Error ? error.message : String(error)
    );
  });
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
