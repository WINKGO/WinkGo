/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  completeMeituanAccountLink,
  getWinkGoInspirationSnapshot,
  saveWinkGoInspirationProvider,
  startMeituanAccountLink,
  testWinkGoInspirationProvider,
} from '@process/services/WinkGoInspirationService';
import { requireWinkGoCapability } from '@process/services/winkGoEditionGuard';

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
    requireWinkGoCapability('inspiration.full');
    return task();
  });

/** Registers the on-demand WINK GO life-service skill bridge. */
export function initWinkGoInspirationBridge(): void {
  ipcBridge.winkGoInspiration.getSnapshot.provider(() => capturePro(getWinkGoInspirationSnapshot));
  ipcBridge.winkGoInspiration.saveProvider.provider((request) =>
    capturePro(() => saveWinkGoInspirationProvider(request))
  );
  ipcBridge.winkGoInspiration.testProvider.provider(({ providerId }) =>
    capturePro(() => testWinkGoInspirationProvider(providerId))
  );
  ipcBridge.winkGoInspiration.startMeituanLink.provider(() => capturePro(startMeituanAccountLink));
  ipcBridge.winkGoInspiration.completeMeituanLink.provider(() => capturePro(completeMeituanAccountLink));
}
