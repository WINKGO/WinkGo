// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { hasSkillSuggest, stripSkillSuggest } from './skillSuggestParser';
import { hasThinkTags, stripThinkTags } from './thinkTagFilter';

export interface TurnCopyItem {
  id: string;
  type?: string;
  position?: string;
  content?: unknown;
}

export interface AiCopyRows {
  copyRowIds: Set<string>;
  turnTextsById: Map<string, string[]>;
}

const PSEUDO_TYPES = new Set(['file_summary', 'tool_summary', 'artifact']);

export function collectAiCopyRows(items: TurnCopyItem[], isProcessing: boolean): AiCopyRows {
  const copyRowIds = new Set<string>();
  const turnTextsById = new Map<string, string[]>();
  let pendingTextId: string | undefined;
  let turnTexts: string[] = [];

  const flush = () => {
    if (pendingTextId) {
      copyRowIds.add(pendingTextId);
      turnTextsById.set(pendingTextId, turnTexts);
    }
    pendingTextId = undefined;
    turnTexts = [];
  };

  for (const item of items) {
    if (item.type && PSEUDO_TYPES.has(item.type)) continue;
    if (item.position === 'right') {
      flush();
      continue;
    }
    if (item.type === 'text') {
      pendingTextId = item.id;
      const raw = (item.content as { content?: unknown } | undefined)?.content;
      if (typeof raw === 'string' && raw.trim()) turnTexts.push(raw);
    }
  }

  const lastTurnTextId = pendingTextId;
  flush();
  if (isProcessing && lastTurnTextId) {
    copyRowIds.delete(lastTurnTextId);
    turnTextsById.delete(lastTurnTextId);
  }
  return { copyRowIds, turnTextsById };
}

export function buildTurnClipboardText(segments: string[]): string {
  return segments
    .map((segment) => {
      let cleaned = segment;
      if (hasThinkTags(cleaned)) cleaned = stripThinkTags(cleaned);
      if (hasSkillSuggest(cleaned)) cleaned = stripSkillSuggest(cleaned);
      return cleaned.trim();
    })
    .filter(Boolean)
    .join('\n\n');
}
