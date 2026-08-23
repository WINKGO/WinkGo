// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildTurnClipboardText, collectAiCopyRows } from '@/renderer/utils/chat/turnCopy';

const user = (id: string) => ({ id, type: 'text', position: 'right', content: { content: 'q' } });
const aiText = (id: string, content: string) => ({ id, type: 'text', position: 'left', content: { content } });

describe('collectAiCopyRows', () => {
  it('copies every text segment in an AI turn split by tools and thinking', () => {
    const result = collectAiCopyRows(
      [
        user('u1'),
        aiText('a1', 'part A'),
        { id: 't1', type: 'tool_call', position: 'left', content: {} },
        { id: 'th1', type: 'thinking', position: 'left', content: {} },
        aiText('a2', 'part B'),
      ],
      false
    );

    expect([...result.copyRowIds]).toEqual(['a2']);
    expect(result.turnTextsById.get('a2')).toEqual(['part A', 'part B']);
  });

  it('keeps turns separated and withholds the streaming turn', () => {
    const result = collectAiCopyRows(
      [user('u1'), aiText('a1', 'finished'), user('u2'), aiText('a2', 'streaming')],
      true
    );

    expect([...result.copyRowIds]).toEqual(['a1']);
    expect(result.turnTextsById.has('a2')).toBe(false);
  });
});

describe('buildTurnClipboardText', () => {
  it('cleans hidden blocks and joins visible segments', () => {
    const result = buildTurnClipboardText([
      '<think>draft</think>answer',
      'tail [SKILL_SUGGEST]{"skills":[]}[/SKILL_SUGGEST]',
    ]);

    expect(result).toBe('answer\n\ntail');
  });
});
