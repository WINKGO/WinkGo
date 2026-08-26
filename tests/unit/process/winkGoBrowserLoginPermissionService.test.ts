/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const values = vi.hoisted(() => new Map<string, unknown>());
const getConfig = vi.hoisted(() => vi.fn(async (key: string) => values.get(key)));
const setConfig = vi.hoisted(() =>
  vi.fn(async (key: string, value: unknown) => {
    values.set(key, value);
  })
);

vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: {
    get: getConfig,
    set: setConfig,
  },
}));

describe('WINK GO browser login permission', () => {
  beforeEach(async () => {
    values.clear();
    vi.clearAllMocks();
    const service = await import('@process/services/winkGoBrowserLoginPermissionService');
    service.resetWinkGoBrowserLoginPermissionForTests();
  });

  it('is disabled by default and ignores consent from an obsolete disclaimer version', async () => {
    const service = await import('@process/services/winkGoBrowserLoginPermissionService');
    expect(await service.getWinkGoBrowserLoginPermission()).toEqual({ enabled: false });

    service.resetWinkGoBrowserLoginPermissionForTests();
    values.set('browser.loginAutomationEnabled', true);
    values.set('browser.loginAutomationConsentVersion', 'obsolete-v0');
    values.set('browser.loginAutomationConsentAt', '2026-01-01T00:00:00.000Z');

    expect(await service.getWinkGoBrowserLoginPermission()).toMatchObject({
      enabled: false,
      consentVersion: 'obsolete-v0',
    });
  });

  it('refuses to enable without an explicit disclaimer acceptance', async () => {
    const service = await import('@process/services/winkGoBrowserLoginPermissionService');

    await expect(service.setWinkGoBrowserLoginPermission({ enabled: true })).rejects.toThrow('免责声明');
    expect(setConfig).not.toHaveBeenCalled();
    expect(service.isWinkGoBrowserLoginAutomationEnabled()).toBe(false);
  });

  it('persists the current consent version and can be disabled immediately', async () => {
    const service = await import('@process/services/winkGoBrowserLoginPermissionService');

    const enabled = await service.setWinkGoBrowserLoginPermission({ enabled: true, consentAccepted: true });
    expect(enabled.enabled).toBe(true);
    expect(enabled.consentVersion).toBe(service.WINKGO_BROWSER_LOGIN_CONSENT_VERSION);
    expect(enabled.consentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(values.get('browser.loginAutomationEnabled')).toBe(true);
    expect(values.get('browser.loginAutomationConsentVersion')).toBe(service.WINKGO_BROWSER_LOGIN_CONSENT_VERSION);
    expect(service.isWinkGoBrowserLoginAutomationEnabled()).toBe(true);

    expect(await service.setWinkGoBrowserLoginPermission({ enabled: false })).toMatchObject({ enabled: false });
    expect(values.get('browser.loginAutomationEnabled')).toBe(false);
    expect(service.isWinkGoBrowserLoginAutomationEnabled()).toBe(false);
  });
});
