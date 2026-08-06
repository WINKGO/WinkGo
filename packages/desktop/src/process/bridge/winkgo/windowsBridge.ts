/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { ipcBridge } from '@/common';
import { WinkGoWindowsRuntimeService } from '@process/services/WinkGoWindowsRuntimeService';
import { WinkGoLyricsService } from '@process/services/media-lyrics';

let runtimeService: WinkGoWindowsRuntimeService | null = null;
let lyricsService: WinkGoLyricsService | null = null;

const getRuntimeService = (): WinkGoWindowsRuntimeService => {
  runtimeService ??= new WinkGoWindowsRuntimeService({
    onMedia: (snapshot) => ipcBridge.winkGoWindows.mediaChanged.emit(snapshot),
    onNotification: (notification) => ipcBridge.winkGoWindows.notificationReceived.emit(notification),
  });
  return runtimeService;
};

const getLyricsService = (): WinkGoLyricsService => {
  lyricsService ??= new WinkGoLyricsService();
  return lyricsService;
};

/** Registers the opt-in Windows media-session and WeChat-notification bridge. */
export function initWinkGoWindowsBridge(): void {
  ipcBridge.winkGoWindows.configure.provider((options) => getRuntimeService().configure(options));
  ipcBridge.winkGoWindows.getState.provider(() => getRuntimeService().getState());
  ipcBridge.winkGoWindows.controlMedia.provider(({ action }) => getRuntimeService().controlMedia(action));
  ipcBridge.winkGoWindows.getLyrics.provider((request) => getLyricsService().getLyrics(request));
  ipcBridge.winkGoWindows.requestNotificationAccess.provider(() => getRuntimeService().requestNotificationAccess());

  app.on('will-quit', () => {
    runtimeService?.dispose();
    runtimeService = null;
    lyricsService?.clear();
    lyricsService = null;
  });
}
