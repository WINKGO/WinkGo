/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoMediaSnapshot } from '@/common/adapter/ipcBridge';
import { findQqMusicArtworkUrl, type QqMusicSearchSong } from './QqMusicArtworkMatcher';

type CacheEntry = { expiresAt: number; dataUrl: string };
type QqMusicSearchResponse = {
  code?: unknown;
  data?: { song?: { list?: unknown } };
};

const artworkCache = new Map<string, CacheEntry>();
const inFlightLookups = new Map<string, Promise<string>>();
const SUCCESS_TTL_MS = 12 * 60 * 60 * 1000;
const MISS_TTL_MS = 6_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_ARTWORK_BYTES = 1024 * 1024;

export const isQqMusicMediaSnapshot = (snapshot: Pick<WinkGoMediaSnapshot, 'appId'>): boolean =>
  /qqmusic|qq music|tencent\.qqmusic|com\.tencent\.qqmusic/i.test(snapshot.appId);

const lookupArtwork = async (snapshot: WinkGoMediaSnapshot, fetchImpl: typeof fetch): Promise<string> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const query = encodeURIComponent(`${snapshot.title} ${snapshot.artist}`.trim());
    const searchUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=20&w=${query}&format=json`;
    const searchResponse = await fetchImpl(searchUrl, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WINK-GO/1.0',
      },
      signal: controller.signal,
    });
    if (!searchResponse.ok) return '';

    const payload = (await searchResponse.json()) as QqMusicSearchResponse;
    const songs = Array.isArray(payload.data?.song?.list) ? (payload.data.song.list as QqMusicSearchSong[]) : [];
    const artworkUrl = findQqMusicArtworkUrl(snapshot, songs);
    if (!artworkUrl) return '';

    const artworkResponse = await fetchImpl(artworkUrl, {
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*',
        Referer: 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WINK-GO/1.0',
      },
      signal: controller.signal,
    });
    if (!artworkResponse.ok) return '';
    const contentType = artworkResponse.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!contentType.startsWith('image/')) return '';
    const bytes = Buffer.from(await artworkResponse.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_ARTWORK_BYTES) return '';
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
};

export const resolveQqMusicArtworkDataUrl = async (
  snapshot: WinkGoMediaSnapshot,
  fetchImpl: typeof fetch = fetch
): Promise<string> => {
  if (snapshot.coverUrl || !isQqMusicMediaSnapshot(snapshot) || !snapshot.title.trim()) {
    return snapshot.coverUrl;
  }

  const cacheKey = `${snapshot.appId}\u0000${snapshot.title}\u0000${snapshot.artist}`.toLocaleLowerCase();
  const cached = artworkCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.dataUrl;

  const existingLookup = inFlightLookups.get(cacheKey);
  if (existingLookup) return existingLookup;

  const lookup = lookupArtwork(snapshot, fetchImpl).then((dataUrl) => {
    artworkCache.set(cacheKey, {
      dataUrl,
      expiresAt: Date.now() + (dataUrl ? SUCCESS_TTL_MS : MISS_TTL_MS),
    });
    return dataUrl;
  });
  inFlightLookups.set(cacheKey, lookup);
  try {
    return await lookup;
  } finally {
    if (inFlightLookups.get(cacheKey) === lookup) inFlightLookups.delete(cacheKey);
  }
};
