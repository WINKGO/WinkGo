/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoMediaSnapshot } from '@/common/adapter/ipcBridge';

export type NetEaseHistoryRow = {
  jsonStr?: unknown;
};

const normalize = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');

const readArtists = (track: Record<string, unknown>): string[] => {
  const candidates = [track.artists, track.ar];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate
      .map((artist) =>
        artist && typeof artist === 'object' && 'name' in artist
          ? String((artist as { name?: unknown }).name ?? '')
          : String(artist ?? '')
      )
      .filter(Boolean);
  }
  return [];
};

const readArtworkUrl = (track: Record<string, unknown>): string => {
  const album =
    track.album && typeof track.album === 'object'
      ? (track.album as Record<string, unknown>)
      : track.al && typeof track.al === 'object'
        ? (track.al as Record<string, unknown>)
        : undefined;
  const value = album?.picUrl ?? album?.coverUrl ?? album?.cover ?? track.coverUrl;
  return typeof value === 'string' && /^https:\/\//i.test(value.trim()) ? value.trim() : '';
};

const parseTrack = (row: NetEaseHistoryRow): Record<string, unknown> | null => {
  try {
    const value = typeof row.jsonStr === 'string' ? JSON.parse(row.jsonStr) : row.jsonStr;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const withArtworkSize = (url: string): string =>
  /[?&]param=\d+y\d+/i.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}param=160y160`;

export const findNetEaseArtworkUrl = (
  snapshot: Pick<WinkGoMediaSnapshot, 'title' | 'artist'>,
  rows: NetEaseHistoryRow[]
): string => {
  const expectedTitle = normalize(snapshot.title);
  const expectedArtist = normalize(snapshot.artist);
  if (!expectedTitle) return '';

  let best: { score: number; url: string } | null = null;
  for (const row of rows) {
    const track = parseTrack(row);
    if (!track) continue;
    const title = normalize(track.name ?? track.title);
    if (!title) continue;

    let score = title === expectedTitle ? 8 : title.includes(expectedTitle) || expectedTitle.includes(title) ? 4 : 0;
    if (!score) continue;

    const artists = readArtists(track).map(normalize).filter(Boolean);
    if (expectedArtist && artists.some((artist) => artist === expectedArtist)) score += 4;
    else if (
      expectedArtist &&
      artists.some((artist) => artist.includes(expectedArtist) || expectedArtist.includes(artist))
    )
      score += 2;

    const url = readArtworkUrl(track);
    if (!url) continue;
    if (!best || score > best.score) best = { score, url };
    if (score >= 12) break;
  }

  return best ? withArtworkSize(best.url) : '';
};
