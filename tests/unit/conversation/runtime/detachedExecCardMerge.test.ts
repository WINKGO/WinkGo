// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TMessage } from '@/common/chat/chatLib';
import { buildMessageIndex, composeMessageWithIndex } from '@/renderer/pages/conversation/Messages/hooks';
import { describe, expect, it } from 'vitest';

const CALL_ID = 'exec-detached-test';

const toolCard = (msgId: string, status: string, name: string, output?: string): TMessage =>
  ({
    id: `live-${msgId}-${status}`,
    msg_id: msgId,
    conversation_id: 'conv-1',
    type: 'tool_call',
    position: 'left',
    created_at: 1,
    content: { call_id: CALL_ID, name, status, output },
  }) as TMessage;

const text = (msgId: string, body: string): TMessage =>
  ({
    id: `text-${msgId}`,
    msg_id: msgId,
    conversation_id: 'conv-1',
    type: 'text',
    position: 'left',
    created_at: 2,
    content: { content: body },
  }) as TMessage;

describe('detached command card live merge', () => {
  it('settles the running card in place when a terminal frame arrives under a later turn', () => {
    let list: TMessage[] = [];
    const merge = (message: TMessage) => {
      list = composeMessageWithIndex(message, list, buildMessageIndex(list));
    };

    merge(toolCard('turn-a', 'running', 'commandExecution'));
    merge(toolCard('turn-a', 'running', 'commandExecution', 'build line 1'));
    merge(text('turn-a', 'The first line is ready.'));
    merge(toolCard('turn-orphan', 'completed', '', 'build lines 1-300'));

    const cards = list.filter((message) => message.type === 'tool_call');
    expect(cards).toHaveLength(1);
    expect((cards[0] as { content: { status?: string } }).content.status).toBe('completed');
  });

  it('keeps the tool name when a late terminal frame repeats it', () => {
    let list: TMessage[] = [];
    const merge = (message: TMessage) => {
      list = composeMessageWithIndex(message, list, buildMessageIndex(list));
    };

    merge(toolCard('turn-a', 'running', 'commandExecution'));
    merge(text('turn-a', 'done talking'));
    merge(toolCard('turn-orphan', 'completed', 'commandExecution'));

    const card = list.find((message) => message.type === 'tool_call') as {
      content: { name?: string; status?: string };
    };
    expect(card.content.name).toBe('commandExecution');
    expect(card.content.status).toBe('completed');
  });
});
