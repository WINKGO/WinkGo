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

  // Keep this capability check for deployments where managed cloud relay is
  // disabled by policy.
  if (!winkGoCloudAuthService.hasCapability('remote.desktop')) {
    await clearWinkGoRemoteAuthorization().catch((): undefined => undefined);
    return result;
  }

  // The saved setting remains authoritative. New and migrated installations
  // default to relay enabled, while users who turn it off in the current
  // schema remain opted out.
  await startWinkGoRemoteGateway().catch((): undefined => undefined);
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
