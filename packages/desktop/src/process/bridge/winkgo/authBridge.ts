/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { winkGoCloudAuthService } from '@process/services/WinkGoCloudAuthService';
import { clearWinkGoRemoteAuthorization, startWinkGoRemoteGateway } from '@process/services/WinkGoXiaozhiService';

export const authenticateAndSyncRemoteGateway = async (
  authenticate: () => Promise<ipcBridge.WinkGoAuthResult>
): Promise<ipcBridge.WinkGoAuthResult> => {
  const result = await authenticate();
  if (!result.success) return result;

  // The current public Free launch includes the complete product experience.
  // Keep this capability check because it becomes the enforcement point again
  // when the future paid policy disables managed cloud relay for Free accounts.
  if (!winkGoCloudAuthService.hasCapability('remote.desktop')) {
    await clearWinkGoRemoteAuthorization().catch((): undefined => undefined);
    return result;
  }

  // Remote-device relay setup is optional. Do not keep the login screen
  // waiting for a WebSocket authorization attempt that can take several
  // seconds on a slow or unavailable network.
  void startWinkGoRemoteGateway().catch((error) => {
    console.warn('[WINK GO Auth] Remote gateway credentials are not ready yet', error);
  });
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
