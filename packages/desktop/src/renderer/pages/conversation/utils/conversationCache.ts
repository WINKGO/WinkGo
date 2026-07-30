/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { isBackendHttpError } from '@/common/adapter/httpBridge';
import type { TChatConversation } from '@/common/config/storage';
import { mutate } from 'swr';

const MAX_MEMORY_CONVERSATIONS = 120;
const memoryConversationCache = new Map<string, TChatConversation>();

const rememberConversation = (conversation: TChatConversation): TChatConversation => {
  memoryConversationCache.delete(conversation.id);
  memoryConversationCache.set(conversation.id, conversation);

  while (memoryConversationCache.size > MAX_MEMORY_CONVERSATIONS) {
    const oldestId = memoryConversationCache.keys().next().value as string | undefined;
    if (!oldestId) break;
    memoryConversationCache.delete(oldestId);
  }

  return conversation;
};

export const primeConversationCache = (conversation: TChatConversation): void => {
  rememberConversation(conversation);
};

export const primeConversationCaches = (conversations: TChatConversation[]): void => {
  conversations.slice(0, MAX_MEMORY_CONVERSATIONS).forEach(rememberConversation);
};

export const peekConversationCache = (conversation_id: string): TChatConversation | undefined => {
  return memoryConversationCache.get(conversation_id);
};

export const removeConversationFromCache = (conversation_id: string): void => {
  memoryConversationCache.delete(conversation_id);
};

export const clearConversationMemoryCache = (): void => {
  memoryConversationCache.clear();
};

const fetchConversationOrNull = async (conversation_id: string): Promise<TChatConversation | null> => {
  try {
    const conversation = await ipcBridge.conversation.get.invoke({ id: conversation_id });
    return rememberConversation(conversation);
  } catch (error) {
    if (isBackendHttpError(error) && error.status === 404 && error.code === 'NOT_FOUND') {
      memoryConversationCache.delete(conversation_id);
      return null;
    }
    throw error;
  }
};

export async function getConversationOrNull(conversation_id: string): Promise<TChatConversation | null> {
  const cachedConversation = memoryConversationCache.get(conversation_id);
  if (cachedConversation) {
    return cachedConversation;
  }

  return fetchConversationOrNull(conversation_id);
}

export async function refreshConversationCache(conversation_id: string): Promise<void> {
  const conversation = await fetchConversationOrNull(conversation_id);
  if (!conversation) return;

  await mutate<TChatConversation>(`conversation/${conversation_id}`, conversation, false);
}
