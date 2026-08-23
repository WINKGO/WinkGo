// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { conversation } from '@/common/adapter/ipcBridge';
import type { IAskQuestion, IMessageAsk } from '@/common/chat/chatLib';
import { Button, Card, Checkbox, Input, Radio } from '@arco-design/web-react';
import { CheckOne, CloseOne } from '@icon-park/react';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './components/MessagePermission/PermissionRequestPanel.module.css';
import own from './MessageQuestion.module.css';

const OTHER_VALUE = '__winkgo_other__';

type Draft = {
  labels: string[];
  other: string;
  otherSelected: boolean;
};

const emptyDraft = (): Draft => ({ labels: [], other: '', otherSelected: false });
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const MessageQuestion: React.FC<{ message: IMessageAsk }> = React.memo(({ message }) => {
  const { t } = useTranslation();
  const content = message.content || ({} as IMessageAsk['content']);
  const questions = useMemo<IAskQuestion[]>(
    () => (Array.isArray(content.questions) ? content.questions : []),
    [content.questions]
  );
  const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(emptyDraft));
  const [submitted, setSubmitted] = useState<'answered' | 'declined' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const updateDraft = useCallback((index: number, patch: Partial<Draft>) => {
    setDrafts((previous) => previous.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  }, []);

  const allAnswered =
    questions.length > 0 &&
    drafts.every((draft) => draft.labels.length > 0 || (draft.otherSelected && draft.other.trim().length > 0));
  const requestId = content.request_id || message.id;

  const handleSubmit = useCallback(async () => {
    if (!allAnswered || submitting) return;
    const answers = questions.map((question, index) => {
      const draft = drafts[index] ?? emptyDraft();
      const labels = [...draft.labels];
      if (draft.otherSelected && draft.other.trim()) labels.push(draft.other.trim());
      return { question: question.question, labels };
    });
    setSubmitting(true);
    setError('');
    try {
      await conversation.answerAsk.invoke({
        conversation_id: message.conversation_id,
        request_id: requestId,
        answers,
      });
      setSubmitted('answered');
    } catch (cause) {
      console.warn('[ask-card] failed to submit structured answers', {
        conversation_id: message.conversation_id,
        request_id: requestId,
        error: errorMessage(cause),
      });
      setError(t('messages.permissionResponseFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [allAnswered, drafts, message.conversation_id, questions, requestId, submitting, t]);

  const handleDecline = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await conversation.answerAsk.invoke({
        conversation_id: message.conversation_id,
        request_id: requestId,
        decline: true,
      });
      setSubmitted('declined');
    } catch (cause) {
      console.warn('[ask-card] failed to decline structured question', {
        conversation_id: message.conversation_id,
        request_id: requestId,
        error: errorMessage(cause),
      });
      setError(t('messages.permissionResponseFailed'));
    } finally {
      setSubmitting(false);
    }
  }, [message.conversation_id, requestId, submitting, t]);

  if (!questions.length) return null;

  return (
    <Card className={styles.card} bordered={false} data-testid='message-question'>
      <div className={styles.panel}>
        {questions.map((question, questionIndex) => {
          const draft = drafts[questionIndex] ?? emptyDraft();
          const multi = question.multiSelect === true || question.multi_select === true;
          return (
            <div
              key={`${question.question}:${questionIndex}`}
              className={own.questionBlock}
              data-testid={`message-question-item-${questionIndex}`}
            >
              {question.header ? <div className={own.header}>{question.header}</div> : null}
              <div className={own.question}>{question.question}</div>
              {multi ? (
                <Checkbox.Group
                  className={own.optionList}
                  value={draft.labels}
                  onChange={(labels) => updateDraft(questionIndex, { labels: labels as string[] })}
                  disabled={submitted !== null || submitting}
                >
                  {question.options.map((option) => (
                    <Checkbox
                      key={option.label}
                      className={own.optionRow}
                      value={option.label}
                      data-testid={`message-question-option-${questionIndex}-${option.label}`}
                    >
                      <span className={own.optionText}>
                        <span className={own.optionLabel}>{option.label}</span>
                        {option.description ? <span className={own.optionDesc}>{option.description}</span> : null}
                      </span>
                    </Checkbox>
                  ))}
                </Checkbox.Group>
              ) : (
                <Radio.Group
                  className={own.optionList}
                  value={draft.otherSelected ? OTHER_VALUE : draft.labels[0]}
                  onChange={(value) =>
                    value === OTHER_VALUE
                      ? updateDraft(questionIndex, { labels: [], otherSelected: true })
                      : updateDraft(questionIndex, { labels: [value], otherSelected: false })
                  }
                  disabled={submitted !== null || submitting}
                >
                  {question.options.map((option) => (
                    <Radio
                      key={option.label}
                      className={own.optionRow}
                      value={option.label}
                      data-testid={`message-question-option-${questionIndex}-${option.label}`}
                    >
                      <span className={own.optionText}>
                        <span className={own.optionLabel}>{option.label}</span>
                        {option.description ? <span className={own.optionDesc}>{option.description}</span> : null}
                      </span>
                    </Radio>
                  ))}
                  <Radio
                    className={own.optionRow}
                    value={OTHER_VALUE}
                    data-testid={`message-question-option-${questionIndex}-other`}
                  >
                    <span className={own.optionLabel}>{t('messages.askOther')}</span>
                  </Radio>
                  {draft.otherSelected ? (
                    <Input
                      className={own.otherInput}
                      placeholder={t('messages.askOtherPlaceholder')}
                      value={draft.other}
                      onChange={(value) => updateDraft(questionIndex, { other: value })}
                      disabled={submitted !== null || submitting}
                      data-testid={`message-question-other-input-${questionIndex}`}
                    />
                  ) : null}
                </Radio.Group>
              )}
            </div>
          );
        })}

        {submitted === null ? (
          <>
            <div className={own.actions}>
              <Button
                type='primary'
                size='small'
                loading={submitting}
                disabled={!allAnswered}
                onClick={handleSubmit}
                data-testid='message-question-submit'
              >
                {t('messages.askSubmit')}
              </Button>
              <Button size='small' disabled={submitting} onClick={handleDecline} data-testid='message-question-decline'>
                {t('messages.askDecline')}
              </Button>
            </div>
            {error ? (
              <div className={`${styles.feedback} ${styles.error}`} role='alert' data-testid='message-question-error'>
                <CloseOne theme='outline' size='16' aria-hidden='true' />
                <span>{error}</span>
              </div>
            ) : null}
          </>
        ) : (
          <div
            className={`${styles.feedback} ${styles.success}`}
            role='status'
            aria-live='polite'
            data-testid='message-question-status'
          >
            <CheckOne theme='outline' size='16' aria-hidden='true' />
            <span>{submitted === 'answered' ? t('messages.askAnswered') : t('messages.askDeclined')}</span>
          </div>
        )}
      </div>
    </Card>
  );
});

export default MessageQuestion;
