/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import type { WinkGoLyricsRequest, WinkGoLyricLine } from '@/common/adapter/ipcBridge';
import { artistTextMatches, isLyricCreditLine } from './lyricParser';
import type { LyricsProviderResult } from './providers';

const CACHE_CHUNK_BYTES = 4 * 1024 * 1024;
const CACHE_CHUNK_OVERLAP_BYTES = 64 * 1024;
const RECORD_PREFIX_BYTES = 32 * 1024;
const RECORD_CONTEXT_BYTES = 384 * 1024;
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
const MAX_LYRIC_DISTANCE_BYTES = 48 * 1024;
const SODA_TIMED_LINE_PATTERN = /\[(\d{1,9}),(\d{1,9})\]((?:<\d+,\d+,\d+>[^<[\p{Cc}]*)+)/gu;
const SODA_WORD_TIMING_PATTERN = /<\d+,\d+,\d+>/gu;

const resolveSodaCachePath = (): string =>
  path.join(process.env.APPDATA || '', 'SodaMusic', 'LunaCacheV2', 'entries.db');

export const parseSodaTimedLyrics = (value: string): WinkGoLyricLine[] => {
  const lines: WinkGoLyricLine[] = [];
  const seen = new Set<string>();
  let previousMatchEnd = -1;
  for (const match of value.matchAll(SODA_TIMED_LINE_PATTERN)) {
    if (previousMatchEnd >= 0 && (match.index ?? 0) - previousMatchEnd > 1_024) break;
    previousMatchEnd = (match.index ?? 0) + match[0].length;
    const timeMs = Number(match[1]);
    const text = match[3]
      .split(/[£�]/u, 1)[0]
      .replace(SODA_WORD_TIMING_PATTERN, '')
      .replace(/\p{Cc}+$/gu, '')
      .trim();
    if (!Number.isFinite(timeMs) || !text || isLyricCreditLine(text)) continue;
    const lineKey = `${timeMs}\u0000${text}`;
    if (seen.has(lineKey)) continue;
    seen.add(lineKey);
    lines.push({ timeMs, text });
  }
  return lines.toSorted((left, right) => left.timeMs - right.timeMs);
};

const readRecordLyrics = async (
  file: Awaited<ReturnType<typeof open>>,
  fileSize: number,
  titleOffset: number,
  request: WinkGoLyricsRequest
): Promise<WinkGoLyricLine[] | null> => {
  const contextStart = Math.max(0, titleOffset - RECORD_PREFIX_BYTES);
  const contextLength = Math.min(RECORD_CONTEXT_BYTES, fileSize - contextStart);
  const contextBuffer = Buffer.allocUnsafe(contextLength);
  const { bytesRead } = await file.read(contextBuffer, 0, contextLength, contextStart);
  const context = contextBuffer.subarray(0, bytesRead).toString('utf8');
  const titleIndex = context.indexOf(request.title);
  if (titleIndex < 0) return null;

  const artist = request.artist.trim();
  const nearbyMetadata = context.slice(Math.max(0, titleIndex - 16 * 1024), titleIndex + 32 * 1024);
  if (artist && !artistTextMatches(artist, nearbyMetadata)) return null;

  // LunaCacheV2 uses a compact binary dictionary: field names are not always
  // repeated beside every record, so a textual `lyrics` marker is unreliable.
  // The first word-timed row following the exact song metadata is the stable
  // boundary written by current Soda Music releases.
  const afterTitle = context.slice(titleIndex + request.title.length);
  const firstTimedLineIndex = afterTitle.search(SODA_TIMED_LINE_PATTERN);
  if (firstTimedLineIndex < 0 || firstTimedLineIndex > MAX_LYRIC_DISTANCE_BYTES) return null;

  const lines = parseSodaTimedLyrics(afterTitle.slice(firstTimedLineIndex));
  return lines.length >= 2 ? lines : null;
};

/**
 * Reads only the local cache already written by the installed Soda Music
 * client. Nothing is uploaded and no private Soda endpoint or account token is
 * used. Searching backwards makes the currently playing track resolve before
 * older duplicate cache entries.
 */
export const querySodaLocalLyrics = async (
  request: WinkGoLyricsRequest,
  _fetchImpl: typeof fetch = fetch,
  cachePath = resolveSodaCachePath()
): Promise<LyricsProviderResult | null> => {
  if (!request.title.trim() || !cachePath) return null;

  let fileSize = 0;
  try {
    fileSize = (await stat(cachePath)).size;
  } catch {
    return null;
  }
  if (fileSize <= 0 || fileSize > MAX_CACHE_BYTES) return null;

  const titleBytes = Buffer.from(request.title, 'utf8');
  if (titleBytes.length === 0) return null;

  const file = await open(cachePath, 'r');
  try {
    let end = fileSize;
    while (end > 0) {
      const start = Math.max(0, end - CACHE_CHUNK_BYTES);
      const length = end - start;
      const chunk = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(chunk, 0, length, start);
      const contents = chunk.subarray(0, bytesRead);

      let matchIndex = contents.lastIndexOf(titleBytes);
      while (matchIndex >= 0) {
        const lines = await readRecordLyrics(file, fileSize, start + matchIndex, request);
        if (lines) return { source: 'qishui', lines };
        matchIndex = contents.lastIndexOf(titleBytes, matchIndex - 1);
      }

      if (start === 0) break;
      end = start + CACHE_CHUNK_OVERLAP_BYTES;
    }
    return null;
  } finally {
    await file.close();
  }
};
