/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UpdateReleaseInfo } from '@/common/update/updateTypes';
import semver from 'semver';

export const WINKGO_OFFICIAL_SITE_URL = 'https://github.com/WINKGO/wink-go/releases';
const BUILD_EDITION =
  String(process.env.WINKGO_EDITION || 'free')
    .trim()
    .toLowerCase() === 'pro'
    ? 'pro'
    : 'free';
export const WINKGO_UPDATE_MANIFEST_URL = `https://winkgo.top/winkgo-${BUILD_EDITION}-update.json`;

export type WinkGoUpdateManifest = {
  version?: string;
  latestVersion?: string;
  appVersion?: string;
  productName?: string;
  notes?: string;
  changelog?: string;
  message?: string;
  generatedAt?: string;
  officialSite?: string;
  windows?: {
    version?: string;
    latestVersion?: string;
    notes?: string;
    changelog?: string;
  };
};

const firstText = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (text) return text;
  }
  return '';
};

const normalizeOfficialUrl = (value: unknown): string => {
  const text = firstText(value);
  if (!text) return WINKGO_OFFICIAL_SITE_URL;

  try {
    const parsed = new URL(text);
    const winkGoRepositoryPath = '/winkgo/wink-go';
    const normalizedPath = parsed.pathname.replace(/\/+$/, '').toLowerCase();
    const isWinkGoReleasePage =
      parsed.protocol === 'https:' &&
      parsed.hostname === 'github.com' &&
      (normalizedPath === winkGoRepositoryPath ||
        normalizedPath === `${winkGoRepositoryPath}/releases` ||
        normalizedPath.startsWith(`${winkGoRepositoryPath}/releases/`));
    if (isWinkGoReleasePage) {
      return parsed.toString();
    }
  } catch {
    // Ignore malformed or non-WINK GO URLs from a damaged manifest.
  }

  return WINKGO_OFFICIAL_SITE_URL;
};

export const normalizeWinkGoUpdateManifest = (rawManifest: unknown): UpdateReleaseInfo => {
  if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest)) {
    throw new Error('WINK GO 官网版本清单格式无效');
  }

  const manifest = rawManifest as WinkGoUpdateManifest;
  const windows = manifest.windows && typeof manifest.windows === 'object' ? manifest.windows : {};
  const rawVersion = firstText(
    windows.version,
    windows.latestVersion,
    manifest.version,
    manifest.latestVersion,
    manifest.appVersion
  ).replace(/^v/i, '');
  const version = semver.valid(rawVersion) || semver.coerce(rawVersion)?.version;

  if (!version) {
    throw new Error('WINK GO 官网版本清单缺少有效版本号');
  }

  const notes = firstText(windows.notes, windows.changelog, manifest.notes, manifest.changelog, manifest.message);
  const officialSite = normalizeOfficialUrl(manifest.officialSite);

  return {
    tagName: `v${version}`,
    version,
    name: firstText(manifest.productName) || 'WINK GO',
    body: notes,
    htmlUrl: officialSite,
    publishedAt: firstText(manifest.generatedAt) || undefined,
    prerelease: semver.prerelease(version) !== null,
    draft: false,
    // The public fallback opens the WINK GO GitHub release page. The standard
    // electron-updater feed handles direct binary updates; the manual fallback
    // must never save an HTML page as an executable.
    assets: [],
  };
};

export const fetchWinkGoUpdateManifest = async (
  fetcher: typeof fetch = fetch,
  manifestUrl = process.env.WINKGO_UPDATE_MANIFEST_URL?.trim() || WINKGO_UPDATE_MANIFEST_URL
): Promise<UpdateReleaseInfo> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetcher(manifestUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'WINK GO',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`WINK GO 官网版本清单请求失败（HTTP ${response.status}）`);
    }

    return normalizeWinkGoUpdateManifest(await response.json());
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('检查 WINK GO 官网更新超时', { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};
