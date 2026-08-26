// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { conversation } from '@/common/adapter/ipcBridge';
import type { IMessageAcpTerminalOutput } from '@/common/chat/chatLib';
import { Button, Card, Tag } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const MessageAcpTerminalOutput: React.FC<{ message: IMessageAcpTerminalOutput }> = ({ message }) => {
  const { t } = useTranslation();
  const { content, conversation_id } = message;
  const outputRef = useRef<HTMLPreElement>(null);
  const [killing, setKilling] = useState(false);
  const running = !content?.exit_status;

  useEffect(() => {
    const output = outputRef.current;
    if (output && running) {
      output.scrollTop = output.scrollHeight;
    }
  }, [content?.output, running]);

  const handleStop = useCallback(async () => {
    if (!conversation_id || !content?.terminal_id) return;
    setKilling(true);
    try {
      await conversation.killTerminal.invoke({
        conversation_id,
        terminal_id: content.terminal_id,
      });
    } catch (error) {
      console.warn('[terminal-card] stop failed', {
        conversation_id,
        terminal_id: content.terminal_id,
        error: error instanceof Error ? error.message : String(error),
      });
      setKilling(false);
    }
  }, [content?.terminal_id, conversation_id]);

  if (!content?.terminal_id) return null;

  const exit = content.exit_status;
  const statusTag = running ? (
    <Tag color='arcoblue' size='small' data-testid='terminal-card-status'>
      {t('conversation.terminal.running')}
    </Tag>
  ) : exit?.signaled ? (
    <Tag color='orange' size='small' data-testid='terminal-card-status'>
      {t('conversation.terminal.stopped')}
    </Tag>
  ) : (
    <Tag color={exit?.exit_code === 0 ? 'green' : 'red'} size='small' data-testid='terminal-card-status'>
      {t('conversation.terminal.exited', { code: exit?.exit_code ?? '?' })}
    </Tag>
  );

  return (
    <Card className='w-full mb-2' size='small' bordered data-testid='terminal-card'>
      <div className='flex items-center gap-2 mb-2 min-w-0'>
        <code className='text-13px font-mono text-t-primary truncate flex-1' data-testid='terminal-card-command'>
          $ {content.command}
        </code>
        {statusTag}
        {running && (
          <Button size='mini' status='danger' loading={killing} onClick={handleStop} data-testid='terminal-card-stop'>
            {t('conversation.terminal.stop')}
          </Button>
        )}
      </div>
      {(content.output || running) && (
        <pre
          ref={outputRef}
          data-testid='terminal-card-output'
          className='bg-1 p-2 rounded text-xs font-mono overflow-x-auto overflow-y-auto max-h-320px whitespace-pre-wrap m-0'
        >
          {content.truncated ? `…${t('conversation.terminal.truncated')}\n` : ''}
          {content.output || ''}
        </pre>
      )}
    </Card>
  );
};

export default MessageAcpTerminalOutput;
