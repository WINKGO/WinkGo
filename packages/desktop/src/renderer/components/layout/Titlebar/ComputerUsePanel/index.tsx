/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select } from '@arco-design/web-react';
import { PauseOne, PlayOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  BrowserComputerUseStatus,
  ComputerUseModelRef,
  DesktopComputerUseStatus,
} from '@/common/types/computerUse';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { selectDefaultWinkGoComputerUseModel } from '@/common/utils/computerUseModel';
import styles from './styles.module.css';

type ComputerUsePanelProps = {
  kind: 'desktop' | 'browser';
};

const MODEL_SEPARATOR = '\u0000';
const ACTIVE_PHASES = new Set(['starting', 'observing', 'planning', 'acting', 'awaiting_confirmation']);

const readModelRef = (value: string): ComputerUseModelRef | null => {
  const separatorIndex = value.indexOf(MODEL_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const providerId = value.slice(0, separatorIndex).trim();
  const model = value.slice(separatorIndex + 1).trim();
  return providerId && model ? { providerId, model } : null;
};

const ComputerUsePanel: React.FC<ComputerUsePanelProps> = ({ kind }) => {
  const { t } = useTranslation();
  const { providers, getAvailableModels, formatModelLabel } = useModelProviderList();
  const [goal, setGoal] = useState('');
  const [modelValue, setModelValue] = useState('');
  const [status, setStatus] = useState<DesktopComputerUseStatus | BrowserComputerUseStatus>({
    phase: 'idle',
    stepCount: 0,
    updatedAt: 0,
  });
  const [feedback, setFeedback] = useState('');

  const bridge = kind === 'desktop' ? ipcBridge.winkGoDesktopComputerUse : ipcBridge.winkGoBrowserComputerUse;
  const modelOptions = useMemo(
    () =>
      providers.flatMap((provider) =>
        getAvailableModels(provider).map((model) => ({
          value: `${provider.id}${MODEL_SEPARATOR}${model}`,
          label: `${provider.name || provider.id} · ${formatModelLabel(provider, model)}`,
        }))
      ),
    [formatModelLabel, getAvailableModels, providers]
  );

  useEffect(() => {
    if (modelValue) return;
    const preferred = selectDefaultWinkGoComputerUseModel(providers);
    const preferredValue = preferred ? `${preferred.providerId}${MODEL_SEPARATOR}${preferred.model}` : '';
    if (preferredValue && modelOptions.some((option) => option.value === preferredValue)) {
      setModelValue(preferredValue);
    } else if (modelOptions[0]) {
      setModelValue(modelOptions[0].value);
    }
  }, [modelOptions, modelValue, providers]);

  useEffect(() => {
    let mounted = true;
    void bridge.getStatus.invoke().then((next) => {
      if (mounted) setStatus(next);
    });
    const unsubscribe = bridge.statusChanged.on((next) => {
      if (mounted) setStatus(next);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);

  const running = ACTIVE_PHASES.has(status.phase);
  const placeholder =
    kind === 'desktop'
      ? t('common.desktopComputerUse.goalPlaceholder', {
          defaultValue: '例如：打开记事本并写入会议摘要',
        })
      : t('common.browserComputerUse.goalPlaceholder', {
          defaultValue: '例如：在内置浏览器搜索 WINK GO 官网并打开下载页',
        });

  const start = async () => {
    const model = readModelRef(modelValue);
    const trimmedGoal = goal.trim();
    if (!model || !trimmedGoal || running) return;
    setFeedback('');
    try {
      const result = await bridge.run.invoke({ goal: trimmedGoal, model, maxSteps: 12 });
      setStatus(result.status);
      if (!result.ok)
        setFeedback(result.status.message || t('common.computerUse.failed', { defaultValue: '任务未完成' }));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const cancel = async () => {
    const next = await bridge.cancel.invoke();
    setStatus(next);
  };

  return (
    <section className={styles.panel} data-computer-use-kind={kind}>
      <label className={styles.label}>
        <span>{t('common.computerUse.model', { defaultValue: '视觉模型' })}</span>
        <Select
          value={modelValue}
          onChange={setModelValue}
          placeholder={t('common.computerUse.chooseModel', { defaultValue: '选择视觉模型' })}
          aria-label={t('common.computerUse.chooseModel', { defaultValue: '选择视觉模型' })}
        >
          {modelOptions.map((option) => (
            <Select.Option key={option.value} value={option.value}>
              {option.label}
            </Select.Option>
          ))}
        </Select>
      </label>

      <label className={styles.label}>
        <span>{t('common.computerUse.goal', { defaultValue: '要完成的任务' })}</span>
        <Input.TextArea
          value={goal}
          onChange={setGoal}
          placeholder={placeholder}
          autoSize={{ minRows: 3, maxRows: 4 }}
        />
      </label>

      <div className={styles.status} data-phase={status.phase}>
        <span className={styles.dot} />
        <span>
          {status.message ||
            (running
              ? t('common.computerUse.running', { defaultValue: '模型正在观察并操作' })
              : t('common.computerUse.ready', { defaultValue: '准备就绪' }))}
        </span>
        {status.stepCount > 0 ? (
          <small>
            {t('common.computerUse.steps', {
              count: status.stepCount,
              defaultValue: `第 ${status.stepCount} 步`,
            })}
          </small>
        ) : null}
      </div>

      {feedback ? <p className={styles.feedback}>{feedback}</p> : null}
      <div className={styles.actions}>
        {running ? (
          <Button type='secondary' icon={<PauseOne />} onClick={cancel}>
            {t('common.computerUse.stop', { defaultValue: '停止' })}
          </Button>
        ) : (
          <Button
            type='primary'
            icon={<PlayOne />}
            disabled={!goal.trim() || !readModelRef(modelValue)}
            onClick={start}
          >
            {kind === 'desktop'
              ? t('common.desktopComputerUse.start', { defaultValue: '开始控制桌面' })
              : t('common.browserComputerUse.start', { defaultValue: '开始控制内置浏览器' })}
          </Button>
        )}
      </div>
    </section>
  );
};

export default ComputerUsePanel;
