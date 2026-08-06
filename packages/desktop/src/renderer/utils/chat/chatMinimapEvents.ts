// Modified from AionUI by WINK GO contributors in 2026.
export const CHAT_MESSAGE_JUMP_EVENT = 'winkgo-chat-message-jump';

export interface ChatMessageJumpDetail {
  conversation_id: string;
  messageId?: string;
  msgId?: string;
  align?: 'start' | 'center' | 'end';
  behavior?: 'auto' | 'smooth';
}

export function dispatchChatMessageJump(detail: ChatMessageJumpDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ChatMessageJumpDetail>(CHAT_MESSAGE_JUMP_EVENT, {
      detail,
    })
  );
}

/** Ask the active conversation header to open its search panel. */
export const CHAT_SEARCH_PANEL_OPEN_EVENT = 'winkgo-chat-search-panel-open';

export interface ChatSearchPanelOpenDetail {
  conversation_id: string;
}

export function dispatchChatSearchPanelOpen(detail: ChatSearchPanelOpenDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ChatSearchPanelOpenDetail>(CHAT_SEARCH_PANEL_OPEN_EVENT, {
      detail,
    })
  );
}
