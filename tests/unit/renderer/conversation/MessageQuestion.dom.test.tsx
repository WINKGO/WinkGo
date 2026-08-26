// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAsk } from '@/common/chat/chatLib';
import MessageQuestion from '@/renderer/pages/conversation/Messages/MessageQuestion';

const { answerAskInvoke } = vi.hoisted(() => ({ answerAskInvoke: vi.fn() }));

vi.mock('@/common/adapter/ipcBridge', () => ({
  conversation: {
    answerAsk: { invoke: answerAskInvoke },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const makeMessage = (): IMessageAsk => ({
  id: 'ask-message-1',
  msg_id: 'ask-message-1',
  conversation_id: 'conversation-1',
  type: 'ask',
  position: 'left',
  content: {
    session_id: 'conversation-1',
    request_id: 'request-1',
    questions: [
      {
        header: '编辑器',
        question: '首选哪种编辑器？',
        options: [
          { label: 'VS Code', description: '轻量' },
          { label: 'JetBrains', description: '功能完整' },
        ],
      },
      {
        header: '语言',
        question: '需要哪些语言？',
        multi_select: true,
        options: [{ label: 'TypeScript' }, { label: 'Rust' }],
      },
    ],
  },
});

describe('MessageQuestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    answerAskInvoke.mockResolvedValue(undefined);
  });

  it('submits every structured answer together, including multi-select values', async () => {
    render(<MessageQuestion message={makeMessage()} />);

    expect(screen.getByTestId('message-question-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('message-question-option-0-VS Code'));
    fireEvent.click(screen.getByTestId('message-question-option-1-TypeScript'));
    fireEvent.click(screen.getByTestId('message-question-option-1-Rust'));
    fireEvent.click(screen.getByTestId('message-question-submit'));

    expect(answerAskInvoke).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      request_id: 'request-1',
      answers: [
        { question: '首选哪种编辑器？', labels: ['VS Code'] },
        { question: '需要哪些语言？', labels: ['TypeScript', 'Rust'] },
      ],
    });
    expect(await screen.findByTestId('message-question-status')).toHaveTextContent('messages.askAnswered');
  });

  it('sends a dedicated decline instead of an empty allow', async () => {
    render(<MessageQuestion message={makeMessage()} />);
    fireEvent.click(screen.getByTestId('message-question-decline'));

    expect(answerAskInvoke).toHaveBeenCalledWith({
      conversation_id: 'conversation-1',
      request_id: 'request-1',
      decline: true,
    });
    expect(await screen.findByTestId('message-question-status')).toHaveTextContent('messages.askDeclined');
  });

  it('accepts a free-text answer and reports bridge errors without losing the draft', async () => {
    answerAskInvoke.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const message = makeMessage();
    message.content.questions = [message.content.questions[0]];
    render(<MessageQuestion message={message} />);

    fireEvent.click(screen.getByTestId('message-question-option-0-other'));
    fireEvent.change(screen.getByTestId('message-question-other-input-0'), { target: { value: 'Neovim' } });
    fireEvent.click(screen.getByTestId('message-question-submit'));
    expect(await screen.findByTestId('message-question-error')).toHaveTextContent('messages.permissionResponseFailed');

    fireEvent.click(screen.getByTestId('message-question-submit'));
    expect(answerAskInvoke).toHaveBeenLastCalledWith({
      conversation_id: 'conversation-1',
      request_id: 'request-1',
      answers: [{ question: '首选哪种编辑器？', labels: ['Neovim'] }],
    });
    expect(await screen.findByTestId('message-question-status')).toHaveTextContent('messages.askAnswered');
  });
});
