/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoMediaSnapshot } from '@/common/adapter/ipcBridge';

export type QqMusicSearchSong = {
  songname?: unknown;
  singer?: unknown;
  albummid?: unknown;
};

const normalize = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');

const readArtists = (song: QqMusicSearchSong): string[] => {
  if (!Array.isArray(song.singer)) return [];
  return song.singer
    .map((artist) =>
      artist && typeof artist === 'object' && 'name' in artist
        ? String((artist as { name?: unknown }).name ?? '')
        : String(artist ?? '')
    )
    .map(normalize)
    .filter(Boolean);
};

export const findQqMusicArtworkUrl = (
  snapshot: Pick<WinkGoMediaSnapshot, 'title' | 'artist'>,
  songs: QqMusicSearchSong[]
): string => {
  const expectedTitle = normalize(snapshot.title);
  const expectedArtist = normalize(snapshot.artist);
  if (!expectedTitle) return '';

  let best: { score: number; albumMid: string } | null = null;
  for (const song of songs) {
    const title = normalize(song.songname);
    const albumMid = typeof song.albummid === 'string' ? song.albummid.trim() : '';
    if (!title || !/^[a-zA-Z0-9]+$/.test(albumMid)) continue;

    let score = title === expectedTitle ? 8 : title.includes(expectedTitle) || expectedTitle.includes(title) ? 4 : 0;
    if (!score) continue;

    const artists = readArtists(song);
    if (expectedArtist && artists.some((artist) => artist === expectedArtist)) score += 4;
    else if (
      expectedArtist &&
      artists.some((artist) => artist.includes(expectedArtist) || expectedArtist.includes(artist))
    )
      score += 2;

    if (!best || score > best.score) best = { score, albumMid };
    if (score >= 12) break;
  }

  return best && best.score >= 8 ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${best.albumMid}.jpg` : '';
};
