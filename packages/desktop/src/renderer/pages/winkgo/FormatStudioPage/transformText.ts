/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FormatStudioMode, FormatStudioResult } from './types';

function cleanText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createMarkdownOutline(input: string): string {
  return cleanText(input)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => (/^(?:#{1,6}\s|[-*+]\s|>\s|\d+[.)]\s)/.test(line) ? line : `- ${line.trim()}`))
    .join('\n');
}

export function transformFormatStudioText(input: string, mode: FormatStudioMode): FormatStudioResult {
  if (mode === 'cleanText') {
    return { ok: true, output: cleanText(input) };
  }

  if (mode === 'markdownOutline') {
    return { ok: true, output: createMarkdownOutline(input) };
  }

  try {
    const parsed: unknown = JSON.parse(input);
    return { ok: true, output: JSON.stringify(parsed, null, 2) };
  } catch {
    return { ok: false, error: 'invalidJson' };
  }
}
