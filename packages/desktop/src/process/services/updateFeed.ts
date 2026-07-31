// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { CdnGenericProvider } from './cdnGenericProvider';
import type { CdnGenericProviderConfiguration } from './cdnGenericProvider';

/**
 * Standard electron-updater feed owned by WINK GO.
 *
 * The website publishes latest*.yml under this directory. The separate
 * edition-specific winkgo-*-update.json endpoints remain the authoritative
 * manual fallback.
 */
const BUILD_EDITION =
  String(process.env.WINKGO_EDITION || 'free')
    .trim()
    .toLowerCase() === 'pro'
    ? 'pro'
    : 'free';
export const CDN_UPDATE_BASE_URL = `https://winkgo.top/releases/${BUILD_EDITION}`;

export type CdnFeedOptions = CdnGenericProviderConfiguration & {
  updateProvider: typeof CdnGenericProvider;
};

export function buildCdnFeedOptions(): CdnFeedOptions {
  return {
    provider: 'custom',
    url: CDN_UPDATE_BASE_URL,
    updateProvider: CdnGenericProvider,
  };
}
