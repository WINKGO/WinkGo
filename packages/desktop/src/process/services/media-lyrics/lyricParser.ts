/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoLyricLine } from '@/common/adapter/ipcBridge';

export type LyricsSearchCandidate = {
  id: string;
  title: string;
  artists: string[];
};

const TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const TITLE_VERSION_PATTERN =
  /(?:live|remix|mix|dj|cover|acoustic|instrumental|伴奏|现场|说唱版|合唱版|校园广播版|加速版|降速版|翻自)/giu;
const CREDIT_PREFIX_PATTERN =
  /^(?:作词|填词|词(?:lyricist|lyrics?)?|作曲|曲(?:composer)?|编曲(?:\/吉他)?|吉他|制作人|监制|人声编辑|和声(?:编写)?|配唱制作人|人声录音(?:师|棚)?|录音(?:师|棚)?|混音(?:师|棚)?|母带(?:后期混音师)?|视觉设计|策划(?:总监)?|营销推广|发行文案|制作统筹|制作公司|出品|op(?:\/sp)?|sp|lyric(?:s|ist)?|composer|arranger|guitar|producer|executive producer|vocal editing|backing vocal|vocal producer|recording engineer|mixing engineer|mastering engineer|visual design|planning director|marketing promoter|publishing copywriting|production director|recording studio|mixing studio|manufacturing company|produce)(?:\s|[:：/]|[a-z])/iu;

export const normalizeTrackText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[[(（【][^)\]）】]{1,64}[)\]）】]/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '');

const readArtistAliases = (value: string): string[] => {
  const source = String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[[(（【][^)\]）】]{1,64}[)\]）】]/g, ' ');
  const aliases = new Set<string>();
  const add = (part: string) => {
    const normalized = normalizeTrackText(part);
    if (normalized) aliases.add(normalized);
  };

  add(source);
  for (const part of source.split(/\s*(?:\/|、|&|,|，|;|；|\+|\bfeat\.?\b|\bft\.?\b)\s*/giu)) add(part);
  for (const han of source.match(/[\p{Script=Han}]+/gu) ?? []) add(han);
  add(source.replace(/[\p{Script=Han}]+/gu, ' '));
  return [...aliases];
};

const aliasesOverlap = (left: string[], right: string[]): boolean =>
  left.some((expected) =>
    right.some(
      (candidate) =>
        expected === candidate ||
        (Math.min(expected.length, candidate.length) >= 3 &&
          (expected.includes(candidate) || candidate.includes(expected)))
    )
  );

export const artistTextMatches = (expectedArtist: string, candidateArtistText: string): boolean => {
  const expectedAliases = readArtistAliases(expectedArtist);
  if (expectedAliases.length === 0) return true;
  return aliasesOverlap(expectedAliases, readArtistAliases(candidateArtistText));
};

const artistMatches = (expectedArtist: string, candidateArtists: string[]): boolean => {
  const expectedAliases = readArtistAliases(expectedArtist);
  if (expectedAliases.length === 0) return true;
  return aliasesOverlap(expectedAliases, candidateArtists.flatMap(readArtistAliases));
};

const readTitleVersions = (value: string): string[] =>
  [...String(value ?? '').matchAll(TITLE_VERSION_PATTERN)].map((match) => match[0].toLocaleLowerCase()).toSorted();

const titleVersionMatches = (expectedTitle: string, candidateTitle: string): boolean => {
  const expectedVersions = readTitleVersions(expectedTitle);
  const candidateVersions = readTitleVersions(candidateTitle);
  return expectedVersions.join('|') === candidateVersions.join('|');
};

export const isLyricCreditLine = (value: string): boolean => {
  const text = value.trim();
  return CREDIT_PREFIX_PATTERN.test(text) || /^(?:（|\()?本作品声明|^版权|^copyright\b/iu.test(text);
};

/** Selects a conservative title/artist match so a similarly named song never receives unrelated lyrics. */
export const findLyricsCandidate = (
  expected: { title: string; artist: string },
  candidates: LyricsSearchCandidate[]
): LyricsSearchCandidate | null => {
  const expectedTitle = normalizeTrackText(expected.title);
  const expectedArtist = normalizeTrackText(expected.artist);
  if (!expectedTitle) return null;

  let best: { score: number; candidate: LyricsSearchCandidate } | null = null;
  for (const candidate of candidates) {
    const title = normalizeTrackText(candidate.title);
    if (!title) continue;
    if (title !== expectedTitle || !titleVersionMatches(expected.title, candidate.title)) continue;

    const artists = candidate.artists.map(normalizeTrackText).filter(Boolean);
    if (!artistMatches(expected.artist, candidate.artists)) continue;
    const exactArtist = Boolean(expectedArtist) && artists.some((artist) => artist === expectedArtist);
    const score = 10 + (exactArtist ? 4 : expectedArtist ? 2 : 0);
    if (!best || score > best.score) best = { score, candidate };
  }
  return best?.candidate ?? null;
};

const timestampToMilliseconds = (minutes: string, seconds: string, fraction = ''): number => {
  const fractionMs = fraction ? Number(fraction.padEnd(3, '0').slice(0, 3)) : 0;
  return Number(minutes) * 60_000 + Number(seconds) * 1_000 + fractionMs;
};

const parseLrcMap = (value: string): Map<number, string> => {
  const lines = new Map<number, string>();
  for (const sourceLine of value.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const timestamps = [...sourceLine.matchAll(TIMESTAMP_PATTERN)];
    if (timestamps.length === 0) continue;
    const text = sourceLine.replace(TIMESTAMP_PATTERN, '').trim();
    if (!text || isLyricCreditLine(text)) continue;
    for (const timestamp of timestamps) {
      const timeMs = timestampToMilliseconds(timestamp[1], timestamp[2], timestamp[3]);
      if (!Number.isFinite(timeMs)) continue;
      lines.set(timeMs, text);
    }
  }
  return lines;
};

export const parseLrc = (lyrics: string, translatedLyrics = ''): WinkGoLyricLine[] => {
  const primary = parseLrcMap(lyrics);
  const translated = parseLrcMap(translatedLyrics);
  return [...primary.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([timeMs, text]) => {
      const line: WinkGoLyricLine = { timeMs, text };
      const translation = translated.get(timeMs);
      if (translation && translation !== text) line.translation = translation;
      return line;
    });
};

export const decodeLyricsPayload = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const decodedEntities = value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
  if (decodedEntities.includes('[')) return decodedEntities;
  try {
    const decodedBase64 = Buffer.from(decodedEntities, 'base64').toString('utf8');
    return decodedBase64.includes('[') ? decodedBase64 : decodedEntities;
  } catch {
    return decodedEntities;
  }
};
