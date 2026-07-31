// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';

import { diffColors } from '@/renderer/styles/colors';

/**
 * Format raw code string, attempting JSON pretty-print.
 * Falls back to stripped trailing newline if parsing fails.
 */
export const formatCode = (code: string): string => {
  const content = String(code).replace(/\n$/, '');
  try {
    return JSON.stringify(
      JSON.parse(content),
      (_key, value) => {
        return value;
      },
      2
    );
  } catch {
    return content;
  }
};

/**
 * Conditional render helper — returns trueComponent when condition is true,
 * falseComponent otherwise.
 */
export const logicRender = <T, F>(condition: boolean, trueComponent: T, falseComponent?: F): T | F => {
  return condition ? trueComponent : (falseComponent as F);
};

const safeDecodeURIComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export type LocalFileLinkReference = {
  filePath: string;
  rawReference: string;
  line?: number;
  column?: number;
  endLine?: number;
};

type LocalFileLocation = {
  line?: number;
  column?: number;
  endLine?: number;
  source?: 'hash' | 'colon';
};

type LocalFilePathCandidate = {
  filePath: string;
  hashLocation?: LocalFileLocation;
  hasInvalidHash?: boolean;
};

const parseHashLocation = (hash: string): LocalFileLocation | null => {
  const match = /^#L(\d+)(?:-L(\d+))?$/.exec(hash);
  if (!match) return null;

  const [, lineText, endLineText] = match;
  return {
    line: Number(lineText),
    endLine: endLineText == null ? undefined : Number(endLineText),
    source: 'hash',
  };
};

const splitHashLocation = (href: string): LocalFilePathCandidate => {
  const hashIndex = href.indexOf('#');
  if (hashIndex < 0) return { filePath: href };

  const hashLocation = parseHashLocation(href.slice(hashIndex));
  if (!hashLocation) {
    return {
      filePath: href.slice(0, hashIndex),
      hasInvalidHash: true,
    };
  }

  return {
    filePath: href.slice(0, hashIndex),
    hashLocation,
  };
};

const normalizeFilePath = (path: string): string => {
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path;
};

const normalizeLocalFileHrefToPath = (href: string): LocalFilePathCandidate | null => {
  if (/^https?:\/\//i.test(href)) return null;

  if (/^file:/i.test(href)) {
    try {
      const url = new URL(href);
      const path = normalizeFilePath(safeDecodeURIComponent(url.pathname));
      const rawHash = safeDecodeURIComponent(url.hash);
      if (!rawHash) return { filePath: path };

      const hashLocation = parseHashLocation(rawHash);
      return hashLocation ? { filePath: path, hashLocation } : { filePath: path, hasInvalidHash: true };
    } catch {
      const stripped = href.replace(/^file:(?:\/\/)?/i, '');
      const candidate = splitHashLocation(stripped);
      return {
        ...candidate,
        filePath: normalizeFilePath(candidate.filePath),
      };
    }
  }

  const candidate = splitHashLocation(href);
  const path = candidate.filePath;

  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return {
      ...candidate,
      filePath: path,
    };
  }

  if (/^\/[A-Za-z]:[\\/]/.test(path)) {
    return {
      ...candidate,
      filePath: path.slice(1),
    };
  }

  if (/^\/(Users|home|tmp|private|var|mnt|Volumes)\//.test(path)) return candidate;
  if (/^\/[^/?#]+\/.+\.[^/?#/.]+$/.test(path)) return candidate;

  return null;
};

const splitLocationSuffix = (filePath: string): Omit<LocalFileLinkReference, 'rawReference'> & LocalFileLocation => {
  const lineColumnMatch = /^(.*):(\d+):(\d+)$/.exec(filePath);
  if (lineColumnMatch) {
    const [, pathWithoutLocation, lineText, columnText] = lineColumnMatch;
    if (normalizeLocalFileHrefToPath(pathWithoutLocation)) {
      return {
        filePath: pathWithoutLocation,
        line: Number(lineText),
        column: Number(columnText),
        source: 'colon',
      };
    }
  }

  const lineMatch = /^(.*):(\d+)$/.exec(filePath);
  if (!lineMatch) return { filePath };

  const [, pathWithoutLocation, lineText] = lineMatch;
  if (!normalizeLocalFileHrefToPath(pathWithoutLocation)) return { filePath };

  return {
    filePath: pathWithoutLocation,
    line: Number(lineText),
    source: 'colon',
  };
};

const formatRawReference = (
  reference: Omit<LocalFileLinkReference, 'rawReference'>,
  source?: 'hash' | 'colon'
): string => {
  if (reference.line == null) return reference.filePath;

  if (source === 'hash') {
    return `${reference.filePath}#L${reference.line}${reference.endLine == null ? '' : `-L${reference.endLine}`}`;
  }

  return `${reference.filePath}:${reference.line}${reference.column == null ? '' : `:${reference.column}`}`;
};

export const resolveLocalFileLinkReference = (
  rawHref: string,
  resolvedHref?: string
): LocalFileLinkReference | null => {
  const href = safeDecodeURIComponent((rawHref || resolvedHref || '').trim());
  if (!href) return null;

  const candidate = normalizeLocalFileHrefToPath(href);
  if (!candidate || candidate.hasInvalidHash) return null;

  const colonReference = splitLocationSuffix(candidate.filePath);
  const reference =
    candidate.hashLocation?.line == null
      ? colonReference
      : {
          ...candidate.hashLocation,
          filePath: colonReference.filePath,
        };

  if (!normalizeLocalFileHrefToPath(reference.filePath)) return null;

  const source = candidate.hashLocation?.line == null ? colonReference.source : 'hash';
  const { source: _source, ...publicReference } = reference;
  return {
    ...publicReference,
    rawReference: formatRawReference(publicReference, source),
  };
};

export const resolveLocalFileLinkPath = (rawHref: string, resolvedHref?: string): string | null => {
  return resolveLocalFileLinkReference(rawHref, resolvedHref)?.filePath ?? null;
};

export const toLocalFileHref = (filePath: string): string => {
  const normalized = filePath.replace(/\\/g, '/');
  const withScheme = /^[A-Za-z]:\//.test(normalized) ? `file:///${normalized}` : `file://${normalized}`;
  return encodeURI(withScheme);
};

const LOCAL_IMAGE_EXTENSION_PATTERN = '(?:avif|bmp|gif|jpe?g|png|svg|webp)';
const LOCAL_IMAGE_PATTERNS = [
  new RegExp(`file:(?:/{2,3})[^<>"'\`\\r\\n]*?\\.${LOCAL_IMAGE_EXTENSION_PATTERN}`, 'gi'),
  new RegExp(`(?<![A-Za-z0-9])[A-Za-z]:[\\\\/][^<>"|?*\`\\r\\n]*?\\.${LOCAL_IMAGE_EXTENSION_PATTERN}`, 'gi'),
  new RegExp(`(?<![A-Za-z0-9.:/])/(?!/)[^<>"|?\`\\r\\n]*?\\.${LOCAL_IMAGE_EXTENSION_PATTERN}`, 'gi'),
];
const MARKDOWN_IMAGE_SOURCE_PATTERN = /!\[[^\]]*]\(\s*(?:<([^>]+)>|([^)]+?))\s*\)/g;
const HTML_IMAGE_SOURCE_PATTERN = /<img\b[^>]*\bsrc\s*=\s*(['"])(.*?)\1[^>]*>/gi;
const MAX_AUTO_LOCAL_IMAGE_PREVIEWS = 8;

type LocalImageCandidate = {
  end: number;
  index: number;
  path: string;
};

const normalizeLocalImagePath = (rawPath: string): string | null => {
  const trimmedPath = rawPath.trim().replace(/^[<"'`]+|[>"'`]+$/g, '');
  if (!trimmedPath || /^https?:\/\//i.test(trimmedPath) || trimmedPath.startsWith('data:')) return null;

  const resolvedPath = resolveLocalFileLinkPath(trimmedPath);
  if (resolvedPath) return resolvedPath;

  const decodedPath = safeDecodeURIComponent(trimmedPath);
  if (/^[A-Za-z]:[\\/]/.test(decodedPath) || /^\/(?!\/)/.test(decodedPath)) return decodedPath;
  return null;
};

const collectExplicitImageSources = (content: string): Set<string> => {
  const sources = new Set<string>();

  for (const match of content.matchAll(MARKDOWN_IMAGE_SOURCE_PATTERN)) {
    const path = normalizeLocalImagePath(match[1] || match[2] || '');
    if (path) sources.add(path);
  }

  for (const match of content.matchAll(HTML_IMAGE_SOURCE_PATTERN)) {
    const path = normalizeLocalImagePath(match[2] || '');
    if (path) sources.add(path);
  }

  return sources;
};

/**
 * Finds local image paths written as plain text or inline code in assistant replies.
 * Standard Markdown/HTML images are excluded because they already render through MarkdownView.
 */
export const extractLocalImagePaths = (content: string): string[] => {
  if (!content) return [];

  const explicitImageSources = collectExplicitImageSources(content);
  const candidates: LocalImageCandidate[] = [];

  for (const pattern of LOCAL_IMAGE_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      if (match.index == null) continue;
      const path = normalizeLocalImagePath(match[0]);
      if (!path || explicitImageSources.has(path)) continue;
      candidates.push({
        index: match.index,
        end: match.index + match[0].length,
        path,
      });
    }
  }

  candidates.sort((left, right) => left.index - right.index || right.end - left.end);

  const results: string[] = [];
  const seenPaths = new Set<string>();
  let coveredUntil = -1;

  for (const candidate of candidates) {
    if (candidate.index < coveredUntil) continue;
    coveredUntil = candidate.end;
    if (seenPaths.has(candidate.path)) continue;
    results.push(candidate.path);
    seenPaths.add(candidate.path);
    if (results.length >= MAX_AUTO_LOCAL_IMAGE_PREVIEWS) break;
  }

  return results;
};

/**
 * Get line background style for diff rendering.
 * Highlights additions (green), deletions (red), and hunk headers (blue).
 */
export const getDiffLineStyle = (line: string, isDark: boolean): React.CSSProperties => {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    return { backgroundColor: isDark ? diffColors.additionBgDark : diffColors.additionBgLight };
  }
  if (line.startsWith('-') && !line.startsWith('---')) {
    return { backgroundColor: isDark ? diffColors.deletionBgDark : diffColors.deletionBgLight };
  }
  if (line.startsWith('@@')) {
    return { backgroundColor: isDark ? diffColors.hunkBgDark : diffColors.hunkBgLight };
  }
  return {};
};
