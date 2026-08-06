// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

const turnStartTimes = new Map<string, number>();

export const beginConversationTurn = (conversationId: string, at: number = Date.now()): number => {
  const existing = turnStartTimes.get(conversationId);
  if (existing !== undefined) {
    return existing;
  }
  turnStartTimes.set(conversationId, at);
  return at;
};

export const endConversationTurn = (conversationId: string): void => {
  turnStartTimes.delete(conversationId);
};

export const getConversationTurnStart = (conversationId: string): number | null => {
  return turnStartTimes.get(conversationId) ?? null;
};

export const resetConversationTurnClockForTests = (): void => {
  turnStartTimes.clear();
};
