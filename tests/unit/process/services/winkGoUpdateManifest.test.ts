/**
 * @license
 * Copyright 2026 WINK GO
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeWinkGoUpdateManifest,
  WINKGO_OFFICIAL_SITE_URL,
  WINKGO_UPDATE_MANIFEST_URL,
} from '@/process/services/winkGoUpdateManifest';

describe('WINK GO official update manifest', () => {
  it('maps the release manifest to the desktop update contract', () => {
    const release = normalizeWinkGoUpdateManifest({
      version: '2.1.41',
      productName: 'WINK GO',
      generatedAt: '2026-07-26T02:00:00.000Z',
      officialSite: 'https://winkgo.top/releases',
      notes: '新增知识画布。',
      windows: {
        version: '2.1.41',
      },
    });

    expect(release).toMatchObject({
      tagName: 'v2.1.41',
      version: '2.1.41',
      name: 'WINK GO',
      body: '新增知识画布。',
      htmlUrl: WINKGO_OFFICIAL_SITE_URL,
      publishedAt: '2026-07-26T02:00:00.000Z',
      prerelease: false,
      draft: false,
      assets: [],
    });
  });

  it('rejects invalid versions and never trusts a foreign website URL', () => {
    expect(() =>
      normalizeWinkGoUpdateManifest({
        version: 'not-a-version',
      })
    ).toThrow('缺少有效版本号');

    const release = normalizeWinkGoUpdateManifest({
      version: '2.1.42',
      officialSite: 'https://example.com/fake-update',
    });
    expect(release.htmlUrl).toBe(WINKGO_OFFICIAL_SITE_URL);

    const legacyGithubRelease = normalizeWinkGoUpdateManifest({
      version: '2.1.43',
      officialSite: 'https://github.com/WINKGO/wink-go/releases',
    });
    expect(legacyGithubRelease.htmlUrl).toBe(WINKGO_OFFICIAL_SITE_URL);
    expect(WINKGO_OFFICIAL_SITE_URL).toBe('https://winkgo.top/');
    expect(WINKGO_UPDATE_MANIFEST_URL).toBe('https://winkgo.top/winkgo-free-update.json');
  });
});
