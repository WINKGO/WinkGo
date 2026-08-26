// Modified from AionUI by WINK GO contributors in 2026.
// SPDX-License-Identifier: Apache-2.0

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpTerminalOutput } from '@/common/chat/chatLib';
import { buildMessageIndex, composeMessageWithIndex } from '@/renderer/pages/conversation/Messages/hooks';
import MessageAcpTerminalOutput from '@/renderer/pages/conversation/Messages/acp/MessageAcpTerminalOutput';

const { killInvoke } = vi.hoisted(() => ({ killInvoke: vi.fn() }));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: {
    killTerminal: { invoke: killInvoke },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { code?: number | string }) =>
      key === 'conversation.terminal.exited' ? `exit-${options?.code}` : key,
  }),
}));

const makeMessage = (
  terminalId: string,
  output: string,
  exitStatus?: { exit_code?: number | null; signaled?: boolean } | null
): IMessageAcpTerminalOutput => ({
  id: `term:turn-1:${terminalId}`,
  msg_id: 'turn-1',
  conversation_id: 'conversation-1',
  type: 'acp_terminal_output',
  position: 'left',
  content: {
    terminal_id: terminalId,
    command: 'echo hello',
    output,
    truncated: false,
    exit_status: exitStatus,
  },
});

describe('MessageAcpTerminalOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    killInvoke.mockResolvedValue(undefined);
  });

  it('renders live output and stops only the selected terminal', async () => {
    render(<MessageAcpTerminalOutput message={makeMessage('term-7', 'hello\n')} />);

    expect(screen.getByTestId('terminal-card-command')).toHaveTextContent('$ echo hello');
    expect(screen.getByTestId('terminal-card-output')).toHaveTextContent('hello');
    fireEvent.click(screen.getByTestId('terminal-card-stop'));

    expect(killInvoke).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      terminal_id: 'term-7',
    });
  });

  it('shows the final exit code and removes the stop action', () => {
    render(<MessageAcpTerminalOutput message={makeMessage('term-7', 'done', { exit_code: 0 })} />);

    expect(screen.getByTestId('terminal-card-status')).toHaveTextContent('exit-0');
    expect(screen.queryByTestId('terminal-card-stop')).not.toBeInTheDocument();
  });

  it('replaces snapshots by terminal id without collapsing sibling terminals', () => {
    let list: IMessageAcpTerminalOutput[] = [];
    const first = makeMessage('term-1', 'one');
    const second = makeMessage('term-2', 'two');
    list = composeMessageWithIndex(first, list, buildMessageIndex(list)) as IMessageAcpTerminalOutput[];
    list = composeMessageWithIndex(second, list, buildMessageIndex(list)) as IMessageAcpTerminalOutput[];
    list = composeMessageWithIndex(
      makeMessage('term-1', 'one updated'),
      list,
      buildMessageIndex(list)
    ) as IMessageAcpTerminalOutput[];

    expect(list).toHaveLength(2);
    expect(list.find((message) => message.content.terminal_id === 'term-1')?.content.output).toBe('one updated');
    expect(list.find((message) => message.content.terminal_id === 'term-2')?.content.output).toBe('two');
  });
});
