/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { winkGoCloudAuthService } from '@process/services/WinkGoCloudAuthService';
import { clearWinkGoRemoteAuthorization } from '@process/services/WinkGoXiaozhiService';

export const authenticateAndSyncRemoteGateway = async (
  authenticate: () => Promise<ipcBridge.WinkGoAuthResult>
): Promise<ipcBridge.WinkGoAuthResult> => {
  const result = await authenticate();
  if (!result.success) return result;

  // Keep this capability check for deployments where managed cloud relay is
  // disabled by policy.
  if (!winkGoCloudAuthService.hasCapability('remote.desktop')) {
    await clearWinkGoRemoteAuthorization().catch((): undefined => undefined);
    return result;
  }

  // Authentication never opts a user into the optional cloud relay.
  // The gateway is started only after the user explicitly enables and saves
  // the relay setting (or on a later startup when that saved opt-in exists).
  return result;
};

/** Registers WINK GO account authentication; remote-device relay sync is optional. */
export function initWinkGoAuthBridge(): void {
  ipcBridge.winkGoAuth.getSession.provider(() => winkGoCloudAuthService.getSession());
  ipcBridge.winkGoAuth.login.provider((credentials) =>
    authenticateAndSyncRemoteGateway(() => winkGoCloudAuthService.login(credentials))
  );
  ipcBridge.winkGoAuth.register.provider((credentials) =>
    authenticateAndSyncRemoteGateway(() => winkGoCloudAuthService.register(credentials))
  );
  ipcBridge.winkGoAuth.logout.provider(async () => {
    await clearWinkGoRemoteAuthorization().catch((): undefined => undefined);
    await winkGoCloudAuthService.logout();
  });
}
