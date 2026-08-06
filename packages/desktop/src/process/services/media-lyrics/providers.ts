/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoLyricsRequest, WinkGoLyricLine } from '@/common/adapter/ipcBridge';
import { decodeLyricsPayload, findLyricsCandidate, parseLrc, type LyricsSearchCandidate } from './lyricParser';

export type LyricsProviderResult = {
  source: 'netease' | 'qqmusic' | 'qishui';
  lines: WinkGoLyricLine[];
};

type NetEaseSearchSong = {
  id?: unknown;
  name?: unknown;
  artists?: unknown;
  ar?: unknown;
};

type QqMusicSearchSong = {
  songmid?: unknown;
  songname?: unknown;
  singer?: unknown;
};

const REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WINK-GO/2.2',
};

const readArtistNames = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .map((artist) =>
          artist && typeof artist === 'object' && 'name' in artist
            ? String((artist as { name?: unknown }).name ?? '')
            : String(artist ?? '')
        )
        .map((artist) => artist.trim())
        .filter(Boolean)
    : [];

const fetchJson = async <T>(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string> = {}
): Promise<T | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { ...DEFAULT_HEADERS, ...headers },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

export const queryNetEaseLyrics = async (
  request: WinkGoLyricsRequest,
  fetchImpl: typeof fetch = fetch
): Promise<LyricsProviderResult | null> => {
  const query = encodeURIComponent(`${request.title} ${request.artist}`.trim());
  const search = await fetchJson<{ result?: { songs?: unknown } }>(
    fetchImpl,
    `https://music.163.com/api/cloudsearch/pc?type=1&limit=20&offset=0&s=${query}`,
    { Referer: 'https://music.163.com/' }
  );
  const songs = Array.isArray(search?.result?.songs) ? (search.result.songs as NetEaseSearchSong[]) : [];
  const candidates: LyricsSearchCandidate[] = songs
    .map((song) => ({
      id: String(song.id ?? ''),
      title: String(song.name ?? ''),
      artists: readArtistNames(song.artists ?? song.ar),
    }))
    .filter((song) => song.id && song.title);
  const candidate = findLyricsCandidate(request, candidates);
  if (!candidate) return null;

  const payload = await fetchJson<{
    lrc?: { lyric?: unknown };
    tlyric?: { lyric?: unknown };
  }>(fetchImpl, `https://music.163.com/api/song/lyric?id=${encodeURIComponent(candidate.id)}&lv=1&kv=1&tv=1`, {
    Referer: 'https://music.163.com/',
  });
  const lines = parseLrc(String(payload?.lrc?.lyric ?? ''), String(payload?.tlyric?.lyric ?? ''));
  return lines.length > 0 ? { source: 'netease', lines } : null;
};

export const queryQqMusicLyrics = async (
  request: WinkGoLyricsRequest,
  fetchImpl: typeof fetch = fetch
): Promise<LyricsProviderResult | null> => {
  const query = encodeURIComponent(`${request.title} ${request.artist}`.trim());
  const headers = { Referer: 'https://y.qq.com/' };
  const search = await fetchJson<{ data?: { song?: { list?: unknown } } }>(
    fetchImpl,
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=20&w=${query}&format=json`,
    headers
  );
  const songs = Array.isArray(search?.data?.song?.list) ? (search.data.song.list as QqMusicSearchSong[]) : [];
  const candidates: LyricsSearchCandidate[] = songs
    .map((song) => ({
      id: String(song.songmid ?? ''),
      title: String(song.songname ?? ''),
      artists: readArtistNames(song.singer),
    }))
    .filter((song) => song.id && song.title);
  const candidate = findLyricsCandidate(request, candidates);
  if (!candidate) return null;

  const payload = await fetchJson<{ lyric?: unknown; trans?: unknown }>(
    fetchImpl,
    `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(candidate.id)}&format=json&nobase64=1`,
    headers
  );
  const lines = parseLrc(decodeLyricsPayload(payload?.lyric), decodeLyricsPayload(payload?.trans));
  return lines.length > 0 ? { source: 'qqmusic', lines } : null;
};
