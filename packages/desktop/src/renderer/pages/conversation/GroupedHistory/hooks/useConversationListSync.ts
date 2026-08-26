// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import {
  primeConversationCaches,
  removeConversationFromCache,
} from '@/renderer/pages/conversation/utils/conversationCache';
import { addEventListener } from '@/renderer/utils/emitter';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * Whitelist of message types that indicate content generation is in progress.
 * Only these types should trigger the sidebar loading spinner.
 * Using a whitelist (instead of a blacklist) prevents unknown/internal message
 * types (e.g. slash_commands_updated, acp_context_usage) from falsely
 * triggering the generating state.
 */
const isGeneratingStreamMessage = (type: string): boolean => {
  return (
    type === 'content' ||
    type === 'start' ||
    type === 'thought' ||
    type === 'thinking' ||
    type === 'tool_group' ||
    type === 'acp_tool_call' ||
    type === 'acp_permission' ||
    type === 'permission' ||
    type === 'plan'
  );
};

const isTerminalAgentStatus = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const { status } = data as { status?: string };
  return status === 'error' || status === 'disconnected';
};

const isTerminalStreamMessage = (message: { type: string; data: unknown }): boolean => {
  return (
    message.type === 'finish' ||
    message.type === 'error' ||
    (message.type === 'agent_status' && isTerminalAgentStatus(message.data))
  );
};

const isTerminalTurnState = (state: string): boolean => {
  return state === 'ai_waiting_input' || state === 'error' || state === 'stopped';
};

export type SidebarStreamGuardDecision = {
  markGenerating: boolean;
  clearCompleted: boolean;
  lateIgnored: boolean;
};

export const getSidebarStreamGuardDecision = ({
  type,
  completed,
  completedTurnId,
  streamTurnId,
}: {
  type: string;
  completed: boolean;
  completedTurnId?: string | null;
  streamTurnId?: string | null;
}): SidebarStreamGuardDecision => {
  if (!isGeneratingStreamMessage(type)) {
    return {
      markGenerating: false,
      clearCompleted: false,
      lateIgnored: false,
    };
  }

  if (type === 'start') {
    return {
      markGenerating: true,
      clearCompleted: true,
      lateIgnored: false,
    };
  }

  if (completed) {
    const isNewerTurn =
      typeof streamTurnId === 'string' &&
      streamTurnId.length > 0 &&
      typeof completedTurnId === 'string' &&
      completedTurnId.length > 0 &&
      streamTurnId !== completedTurnId;
    if (isNewerTurn) {
      return {
        markGenerating: true,
        clearCompleted: true,
        lateIgnored: false,
      };
    }

    return {
      markGenerating: false,
      clearCompleted: false,
      lateIgnored: true,
    };
  }

  return {
    markGenerating: true,
    clearCompleted: false,
    lateIgnored: false,
  };
};

type ConversationListSyncSnapshot = {
  conversations: TChatConversation[];
  generatingConversationIds: Set<string>;
  completionUnreadConversationIds: Set<string>;
  manualUnreadConversationIds: Set<string>;
};

const MANUAL_UNREAD_STORAGE_KEY = 'conversation-manual-unread-ids';

const readStoredManualUnread = (): Set<string> => {
  try {
    const raw = localStorage.getItem(MANUAL_UNREAD_STORAGE_KEY);
    if (!raw) return new Set();
    const value = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
};

const listeners = new Set<() => void>();

let isStoreInitialized = false;
let conversationsState: TChatConversation[] = [];
let generatingConversationIdsState = new Set<string>();
let completionUnreadConversationIdsState = new Set<string>();
let manualUnreadConversationIdsState = readStoredManualUnread();
let completedConversationIdsState = new Set<string>();
const completedTurnIdByConversation = new Map<string, string | null>();
let conversation_idsState = new Set<string>();
// Full conversation id → owning project id map from the unfiltered list.
// Keeping this in the synchronous snapshot prevents Explorer from showing the
// previous project's tree while a newly selected conversation is still loading.
let projectIdByIdState = new Map<string, string | null>();
let activeConversationIdState: string | null = null;
let conversationRefreshInFlight = false;
let conversationRefreshQueued = false;
let snapshotState: ConversationListSyncSnapshot = {
  conversations: conversationsState,
  generatingConversationIds: generatingConversationIdsState,
  completionUnreadConversationIds: completionUnreadConversationIdsState,
  manualUnreadConversationIds: manualUnreadConversationIdsState,
};

const persistManualUnread = () => {
  try {
    localStorage.setItem(MANUAL_UNREAD_STORAGE_KEY, JSON.stringify([...manualUnreadConversationIdsState]));
  } catch {
    // Ignore unavailable or full renderer storage.
  }
};

const emitStoreChange = () => {
  snapshotState = {
    conversations: conversationsState,
    generatingConversationIds: generatingConversationIdsState,
    completionUnreadConversationIds: completionUnreadConversationIdsState,
    manualUnreadConversationIds: manualUnreadConversationIdsState,
  };
  listeners.forEach((listener) => listener());
};

const subscribeConversationListSync = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getConversationListSyncSnapshot = (): ConversationListSyncSnapshot => snapshotState;

/**
 * Resolve a conversation's project synchronously from the already-loaded list.
 * `undefined` means the row is not loaded yet; `null` means it is known and has
 * no project. Callers must use either case as an empty placeholder, never keep a
 * stale project from the previously active conversation.
 */
export const getSnapshotConversationProjectId = (conversation_id: string): string | null | undefined => {
  if (!projectIdByIdState.has(conversation_id)) return undefined;
  return projectIdByIdState.get(conversation_id) ?? null;
};

export const setConversationProjectMapForTest = (entries: Array<[string, string | null]>): void => {
  projectIdByIdState = new Map(entries);
};

const refreshConversations = () => {
  if (conversationRefreshInFlight) {
    conversationRefreshQueued = true;
    return;
  }

  conversationRefreshInFlight = true;
  void ipcBridge.database.getUserConversations
    .invoke({ limit: 10000 })
    .then((result) => {
      const items = result?.items;
      if (items && Array.isArray(items)) {
        const filteredData = items.filter((conv) => {
          // Legacy rows from the pre-provider-probe health check flow are hidden
          // from normal history. New health checks must not create conversations.
          const extra = conv.extra as { is_health_check?: boolean; team_id?: string; teamId?: string } | undefined;
          return extra?.is_health_check !== true && !extra?.team_id && !extra?.teamId;
        });
        conversationsState = filteredData;
        primeConversationCaches(filteredData);
        // Use ALL conversation IDs (including team/legacy health-check rows) so the
        // responseStream listener recognises them as known and doesn't
        // trigger an infinite refreshConversations loop.
        conversation_idsState = new Set(items.map((conversation) => conversation.id));
        projectIdByIdState = new Map(items.map((conversation) => [conversation.id, conversation.project_id ?? null]));
        emitStoreChange();
        return;
      }

      conversationsState = [];
      conversation_idsState = new Set();
      projectIdByIdState = new Map();
      emitStoreChange();
    })
    .catch((error) => {
      console.error('[WorkspaceGroupedHistory] Failed to load conversations:', error);
      conversationsState = [];
      conversation_idsState = new Set();
      projectIdByIdState = new Map();
      emitStoreChange();
    })
    .finally(() => {
      conversationRefreshInFlight = false;
      if (conversationRefreshQueued) {
        conversationRefreshQueued = false;
        refreshConversations();
      }
    });
};

const markGenerating = (conversation_id: string) => {
  if (generatingConversationIdsState.has(conversation_id)) {
    return;
  }

  generatingConversationIdsState = new Set(generatingConversationIdsState).add(conversation_id);
  emitStoreChange();
};

const clearGenerating = (conversation_id: string) => {
  if (!generatingConversationIdsState.has(conversation_id)) {
    return;
  }

  const next = new Set(generatingConversationIdsState);
  next.delete(conversation_id);
  generatingConversationIdsState = next;
  emitStoreChange();
};

const markCompletionUnread = (conversation_id: string) => {
  if (completionUnreadConversationIdsState.has(conversation_id)) {
    return;
  }

  completionUnreadConversationIdsState = new Set(completionUnreadConversationIdsState).add(conversation_id);
  emitStoreChange();
};

const clearCompletionUnreadState = (conversation_id: string) => {
  if (!completionUnreadConversationIdsState.has(conversation_id)) {
    return;
  }

  const next = new Set(completionUnreadConversationIdsState);
  next.delete(conversation_id);
  completionUnreadConversationIdsState = next;
  emitStoreChange();
};

const markManualUnreadState = (conversation_id: string) => {
  if (manualUnreadConversationIdsState.has(conversation_id)) return;
  manualUnreadConversationIdsState = new Set(manualUnreadConversationIdsState).add(conversation_id);
  persistManualUnread();
  emitStoreChange();
};

const clearManualUnreadState = (conversation_id: string) => {
  if (!manualUnreadConversationIdsState.has(conversation_id)) return;
  const next = new Set(manualUnreadConversationIdsState);
  next.delete(conversation_id);
  manualUnreadConversationIdsState = next;
  persistManualUnread();
  emitStoreChange();
};

const markCompleted = (conversation_id: string, turn_id?: string | null) => {
  completedConversationIdsState = new Set(completedConversationIdsState).add(conversation_id);
  completedTurnIdByConversation.set(conversation_id, turn_id ?? null);
};

const clearCompleted = (conversation_id: string) => {
  if (!completedConversationIdsState.has(conversation_id)) {
    return;
  }

  const next = new Set(completedConversationIdsState);
  next.delete(conversation_id);
  completedConversationIdsState = next;
  completedTurnIdByConversation.delete(conversation_id);
};

const logLateStreamIgnored = (conversation_id: string, type: string) => {
  void ipcBridge.application.writeRendererLog
    .invoke({
      level: 'warn',
      tag: 'conversationRuntimeView',
      message: 'late_stream_ignored_for_runtime',
      data: {
        conversation_id,
        stream_type: type,
      },
    })
    .catch(() => {});
};

const setActiveConversationState = (conversation_id: string | null) => {
  activeConversationIdState = conversation_id;
};

const initializeConversationListSyncStore = () => {
  if (isStoreInitialized) {
    return;
  }

  isStoreInitialized = true;
  refreshConversations();

  addEventListener('chat.history.refresh', refreshConversations);
  ipcBridge.conversation.listChanged.on((event) => {
    if (event.action === 'deleted') {
      removeConversationFromCache(event.conversation_id);
      clearGenerating(event.conversation_id);
      clearCompletionUnreadState(event.conversation_id);
      clearManualUnreadState(event.conversation_id);
      clearCompleted(event.conversation_id);
    }
    refreshConversations();
  });
  ipcBridge.conversation.responseStream.on((message) => {
    const conversation_id = message.conversation_id;
    if (!conversation_id) {
      return;
    }

    if (!conversation_idsState.has(conversation_id)) {
      refreshConversations();
    }

    if (isTerminalStreamMessage(message)) {
      const wasGenerating = generatingConversationIdsState.has(conversation_id);
      if (wasGenerating && activeConversationIdState !== conversation_id) {
        markCompletionUnread(conversation_id);
      }
      clearGenerating(conversation_id);
      return;
    }

    const decision = getSidebarStreamGuardDecision({
      type: message.type,
      completed: completedConversationIdsState.has(conversation_id),
      completedTurnId: completedTurnIdByConversation.get(conversation_id) ?? null,
      streamTurnId: message.turn_id ?? null,
    });
    if (decision.clearCompleted) {
      clearCompleted(conversation_id);
    }
    if (decision.lateIgnored) {
      logLateStreamIgnored(conversation_id, message.type);
      return;
    }
    if (decision.markGenerating) {
      markGenerating(conversation_id);
    }
  });
  ipcBridge.conversation.turnCompleted.on((event) => {
    if (isTerminalTurnState(event.state) && activeConversationIdState !== event.session_id) {
      markCompletionUnread(event.session_id);
    }
    markCompleted(event.session_id, event.turn_id);
    clearGenerating(event.session_id);
    refreshConversations();
  });
};

export const useConversationListSync = () => {
  useEffect(() => {
    initializeConversationListSyncStore();
  }, []);

  const { conversations, generatingConversationIds, completionUnreadConversationIds, manualUnreadConversationIds } =
    useSyncExternalStore(
      subscribeConversationListSync,
      getConversationListSyncSnapshot,
      getConversationListSyncSnapshot
    );

  const clearCompletionUnread = useCallback((conversation_id: string) => {
    clearCompletionUnreadState(conversation_id);
  }, []);

  const markManualUnread = useCallback((conversation_id: string) => {
    markManualUnreadState(conversation_id);
  }, []);

  const clearManualUnread = useCallback((conversation_id: string) => {
    clearManualUnreadState(conversation_id);
  }, []);

  const setActiveConversation = useCallback((conversation_id: string | null) => {
    setActiveConversationState(conversation_id);
  }, []);

  const isConversationGenerating = useCallback(
    (conversation_id: string) => {
      return generatingConversationIds.has(conversation_id);
    },
    [generatingConversationIds]
  );

  const hasCompletionUnread = useCallback(
    (conversation_id: string) => {
      return completionUnreadConversationIds.has(conversation_id);
    },
    [completionUnreadConversationIds]
  );

  const isManualUnread = useCallback(
    (conversation_id: string) => manualUnreadConversationIds.has(conversation_id),
    [manualUnreadConversationIds]
  );

  return {
    conversations,
    isConversationGenerating,
    hasCompletionUnread,
    clearCompletionUnread,
    isManualUnread,
    markManualUnread,
    clearManualUnread,
    setActiveConversation,
  };
};
