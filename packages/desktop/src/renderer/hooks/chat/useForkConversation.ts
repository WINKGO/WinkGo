/**
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { parseError } from '@/common/utils';
import { emitter } from '@/renderer/utils/emitter';
import { Message } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

export function getForkErrorMessage(error: unknown, t: TFunction): string {
  const raw = parseError(error);
  if (raw.includes('FORK_TEAM_UNSUPPORTED')) return t('messages.fork.errorTeamUnsupported');
  if (raw.includes('Message') && raw.includes('not found')) return t('messages.fork.errorPointUnsupported');
  return t('messages.fork.errorGeneric', { message: raw });
}

export function useForkConversation(conversationId: string | undefined) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const forkingRef = useRef(false);

  return useCallback(
    async (messageId: string) => {
      if (!conversationId || forkingRef.current) return;
      forkingRef.current = true;
      try {
        const forked = await ipcBridge.conversation.fork.invoke({
          conversation_id: conversationId,
          message_id: messageId,
        });
        if (!forked?.id) throw new Error('fork returned no conversation');
        emitter.emit('chat.history.refresh');
        void navigate(`/conversation/${forked.id}`);
        void ipcBridge.conversation.ensureRuntime.invoke({ conversation_id: forked.id }).catch((): void => undefined);
      } catch (error) {
        console.error('Failed to branch conversation:', error);
        Message.error(getForkErrorMessage(error, t));
      } finally {
        forkingRef.current = false;
      }
    },
    [conversationId, navigate, t]
  );
}
