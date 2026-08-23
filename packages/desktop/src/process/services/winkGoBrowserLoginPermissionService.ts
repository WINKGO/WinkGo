/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ProcessConfig } from '@process/utils/initStorage';

export const WINKGO_BROWSER_LOGIN_CONSENT_VERSION = 'browser-login-automation-v1';

export type WinkGoBrowserLoginPermission = {
  enabled: boolean;
  consentVersion?: string;
  consentAt?: string;
};

let cachedPermission: WinkGoBrowserLoginPermission = { enabled: false };
let hydrated = false;
let hydration: Promise<WinkGoBrowserLoginPermission> | null = null;

const readPermission = async (): Promise<WinkGoBrowserLoginPermission> => {
  const [enabled, consentVersion, consentAt] = await Promise.all([
    ProcessConfig.get('browser.loginAutomationEnabled'),
    ProcessConfig.get('browser.loginAutomationConsentVersion'),
    ProcessConfig.get('browser.loginAutomationConsentAt'),
  ]);
  const acceptedCurrentDisclaimer = consentVersion === WINKGO_BROWSER_LOGIN_CONSENT_VERSION;
  return {
    enabled: enabled === true && acceptedCurrentDisclaimer,
    ...(typeof consentVersion === 'string' ? { consentVersion } : {}),
    ...(typeof consentAt === 'string' ? { consentAt } : {}),
  };
};

export const hydrateWinkGoBrowserLoginPermission = async (): Promise<WinkGoBrowserLoginPermission> => {
  if (hydrated) return { ...cachedPermission };
  hydration ??= readPermission()
    .then((permission) => {
      cachedPermission = permission;
      hydrated = true;
      return { ...permission };
    })
    .finally(() => {
      hydration = null;
    });
  return hydration;
};

export const getWinkGoBrowserLoginPermission = async (): Promise<WinkGoBrowserLoginPermission> => {
  await hydrateWinkGoBrowserLoginPermission();
  return { ...cachedPermission };
};

/** Synchronous policy read used by Electron's synchronous webview hooks. */
export const isWinkGoBrowserLoginAutomationEnabled = (): boolean => cachedPermission.enabled;

export const setWinkGoBrowserLoginPermission = async (input: {
  enabled: boolean;
  consentAccepted?: boolean;
}): Promise<WinkGoBrowserLoginPermission> => {
  if (input.enabled && input.consentAccepted !== true) {
    throw new Error('开启浏览器登录权限前必须确认免责声明。');
  }

  if (!input.enabled) {
    await ProcessConfig.set('browser.loginAutomationEnabled', false);
    cachedPermission = { ...cachedPermission, enabled: false };
    hydrated = true;
    return { ...cachedPermission };
  }

  const consentAt = new Date().toISOString();
  await ProcessConfig.set('browser.loginAutomationConsentVersion', WINKGO_BROWSER_LOGIN_CONSENT_VERSION);
  await ProcessConfig.set('browser.loginAutomationConsentAt', consentAt);
  await ProcessConfig.set('browser.loginAutomationEnabled', true);
  cachedPermission = {
    enabled: true,
    consentVersion: WINKGO_BROWSER_LOGIN_CONSENT_VERSION,
    consentAt,
  };
  hydrated = true;
  return { ...cachedPermission };
};

/** Test-only reset for module-level synchronous policy state. */
export const resetWinkGoBrowserLoginPermissionForTests = (): void => {
  cachedPermission = { enabled: false };
  hydrated = false;
  hydration = null;
};
