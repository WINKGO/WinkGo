// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { autoCheck, manualCheck } = vi.hoisted(() => ({ autoCheck: vi.fn(), manualCheck: vi.fn() }));

vi.mock('@/common', () => ({
  ipcBridge: {
    autoUpdate: { check: { invoke: autoCheck } },
    update: { check: { invoke: manualCheck } },
  },
}));

import { runUpdateCheck } from '@/renderer/components/settings/checkForUpdatesShared';

const opts = { includePrerelease: false, fallbackVersion: '0.0.0', checkFailedLabel: 'failed' };

describe('runUpdateCheck downgrade guard', () => {
  beforeEach(() => {
    autoCheck.mockReset();
    manualCheck.mockReset();
  });

  it('does not offer an older auto-update version as available', async () => {
    autoCheck.mockResolvedValue({ success: true, data: { updateInfo: { version: '2.2.11' } } });
    manualCheck.mockResolvedValue({
      success: true,
      data: { currentVersion: '2.2.12', updateAvailable: false, latest: { version: '2.2.11', htmlUrl: '' } },
    });

    await expect(runUpdateCheck(opts)).resolves.toMatchObject({ kind: 'upToDate' });
  });

  it('does not trust a manual updateAvailable flag for an older release', async () => {
    autoCheck.mockResolvedValue({ success: true, data: {} });
    manualCheck.mockResolvedValue({
      success: true,
      data: { currentVersion: '2.2.12', updateAvailable: true, latest: { version: '2.2.11', htmlUrl: '' } },
    });

    await expect(runUpdateCheck(opts)).resolves.toMatchObject({ kind: 'upToDate' });
  });

  it('offers a strictly newer version', async () => {
    autoCheck.mockResolvedValue({ success: true, data: { updateInfo: { version: '2.2.13' } } });
    manualCheck.mockResolvedValue({
      success: true,
      data: {
        currentVersion: '2.2.12',
        updateAvailable: true,
        latest: { version: '2.2.13', htmlUrl: 'https://winkgo.top/' },
      },
    });

    await expect(runUpdateCheck(opts)).resolves.toMatchObject({
      kind: 'available',
      autoUpdateAvailable: true,
      updateInfo: { version: '2.2.13' },
    });
  });
});
