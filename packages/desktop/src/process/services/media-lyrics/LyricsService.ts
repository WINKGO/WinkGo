/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoLyricsRequest, WinkGoLyricsResult } from '@/common/adapter/ipcBridge';
import { queryNetEaseLyrics, queryQqMusicLyrics, type LyricsProviderResult } from './providers';
import { querySodaLocalLyrics } from './sodaLocalProvider';

type CacheEntry = { expiresAt: number; result: WinkGoLyricsResult };
type Provider = (request: WinkGoLyricsRequest, fetchImpl: typeof fetch) => Promise<LyricsProviderResult | null>;

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1_000;
// A player can publish SMTC metadata before its client has persisted lyrics.
// Keep misses very short so the open lyrics panel can recover automatically.
const MISS_TTL_MS = 2_500;

export const createLyricsTrackKey = (request: WinkGoLyricsRequest): string =>
  `${request.appId}\u0000${request.title}\u0000${request.artist}`.toLocaleLowerCase();

const NETEASE_APP_PATTERN = /cloudmusic|netease|music\.163|com\.netease|网易云/i;
const QQ_MUSIC_APP_PATTERN = /qqmusic|qq music|tencent\.qqmusic|com\.tencent\.qqmusic|qq音乐/i;
const SODA_MUSIC_APP_PATTERN = /sodamusic|soda music|qishui|luna\.music|lunamusic|bytedance\.music|汽水/i;

/**
 * Native players must never borrow lyrics from a competing catalogue. A
 * cross-provider fallback can silently select a different recording with the
 * same title, which is worse than showing a clear "not found" state.
 */
const providerOrder = (appId: string): Provider[] => {
  if (NETEASE_APP_PATTERN.test(appId)) return [queryNetEaseLyrics];
  if (QQ_MUSIC_APP_PATTERN.test(appId)) return [queryQqMusicLyrics];
  if (SODA_MUSIC_APP_PATTERN.test(appId)) return [querySodaLocalLyrics];
  return [queryNetEaseLyrics, queryQqMusicLyrics];
};

export class WinkGoLyricsService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<WinkGoLyricsResult>>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async getLyrics(request: WinkGoLyricsRequest): Promise<WinkGoLyricsResult> {
    const trackKey = createLyricsTrackKey(request);
    if (!request.title.trim()) {
      return { status: 'not_found', trackKey, lines: [], fetchedAt: Date.now() };
    }

    const cached = this.cache.get(trackKey);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    const active = this.inFlight.get(trackKey);
    if (active) return active;

    const lookup = this.lookup(request, trackKey);
    this.inFlight.set(trackKey, lookup);
    try {
      return await lookup;
    } finally {
      if (this.inFlight.get(trackKey) === lookup) this.inFlight.delete(trackKey);
    }
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  private async lookup(request: WinkGoLyricsRequest, trackKey: string): Promise<WinkGoLyricsResult> {
    let hadProviderError = false;
    const providers = providerOrder(request.appId);
    const matches = await Promise.all(
      providers.map((provider) =>
        provider(request, this.fetchImpl).catch((): LyricsProviderResult | null => {
          hadProviderError = true;
          return null;
        })
      )
    );
    const match = matches.find((candidate) => candidate !== null);
    if (match) {
      const result: WinkGoLyricsResult = {
        status: 'ok',
        trackKey,
        source: match.source,
        lines: match.lines,
        fetchedAt: Date.now(),
      };
      this.cache.set(trackKey, { result, expiresAt: Date.now() + SUCCESS_TTL_MS });
      return result;
    }

    const result: WinkGoLyricsResult = {
      status: hadProviderError ? 'error' : 'not_found',
      trackKey,
      lines: [],
      fetchedAt: Date.now(),
    };
    this.cache.set(trackKey, { result, expiresAt: Date.now() + MISS_TTL_MS });
    return result;
  }
}
