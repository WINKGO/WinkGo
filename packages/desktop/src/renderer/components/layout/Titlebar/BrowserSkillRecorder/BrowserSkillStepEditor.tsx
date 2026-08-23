/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button } from '@arco-design/web-react';
import { Delete, Down, Save, Up } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { WinkGoBrowserWorkflowStep } from '@/common/adapter/ipcBridge';
import styles from './BrowserSkillStepEditor.module.css';

type BrowserSkillStepEditorProps = {
  steps: WinkGoBrowserWorkflowStep[];
  busy: boolean;
  dirty: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
};

const stepLabelKey = (type: WinkGoBrowserWorkflowStep['type']): string =>
  `common.browserSkillRecorder.stepTypes.${type}`;

const BrowserSkillStepEditor: React.FC<BrowserSkillStepEditorProps> = ({
  steps,
  busy,
  dirty,
  onMove,
  onRemove,
  onSave,
}) => {
  const { t } = useTranslation();

  return (
    <section className={styles.editor} aria-label={t('common.browserSkillRecorder.workflowSteps')}>
      <div className={styles.header}>
        <span>
          <strong>{t('common.browserSkillRecorder.workflowSteps')}</strong>
          <small>{t('common.browserSkillRecorder.workflowStepsHint')}</small>
        </span>
        <Button
          type='primary'
          size='mini'
          loading={busy}
          disabled={!dirty || steps.length === 0}
          icon={<Save theme='outline' size='14' fill='currentColor' />}
          onClick={onSave}
        >
          {t('common.save')}
        </Button>
      </div>

      <div className={styles.steps} data-testid='browser-skill-step-editor'>
        {steps.map((step, index) => {
          const target =
            step.accessibleName ||
            step.fallbackText ||
            step.url ||
            step.selector ||
            t('common.browserSkillRecorder.unknownTarget');
          return (
            <div key={step.id} className={styles.step} data-step-id={step.id}>
              <span className={styles.index}>{index + 1}</span>
              <span className={styles.details}>
                <strong>{t(stepLabelKey(step.type))}</strong>
                <small title={target}>{target}</small>
              </span>
              <span className={styles.actions}>
                <Button
                  type='text'
                  size='mini'
                  disabled={busy || index === 0}
                  aria-label={t('common.browserSkillRecorder.moveStepUp')}
                  icon={<Up theme='outline' size='13' fill='currentColor' />}
                  onClick={() => onMove(index, -1)}
                />
                <Button
                  type='text'
                  size='mini'
                  disabled={busy || index === steps.length - 1}
                  aria-label={t('common.browserSkillRecorder.moveStepDown')}
                  icon={<Down theme='outline' size='13' fill='currentColor' />}
                  onClick={() => onMove(index, 1)}
                />
                <Button
                  type='text'
                  size='mini'
                  status='danger'
                  disabled={busy || steps.length === 1}
                  aria-label={t('common.delete')}
                  icon={<Delete theme='outline' size='13' fill='currentColor' />}
                  onClick={() => onRemove(index)}
                />
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default BrowserSkillStepEditor;
