/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { Delete, PlayOne, Record, Refresh, Save } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  WinkGoBrowserRecorderStatus,
  WinkGoBrowserSkillDetail,
  WinkGoBrowserSkillItem,
  WinkGoBrowserSkillOperationResult,
  WinkGoBrowserWorkflowStep,
} from '@/common/adapter/ipcBridge';
import BrowserSkillStepEditor from './BrowserSkillStepEditor';
import './styles.css';

const EMPTY_STATUS: WinkGoBrowserRecorderStatus = {
  phase: 'idle',
  browserAttached: false,
  currentUrl: '',
  recordedStepCount: 0,
};

const BrowserSkillRecorder: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<WinkGoBrowserRecorderStatus>(EMPTY_STATUS);
  const [skills, setSkills] = useState<WinkGoBrowserSkillItem[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [skillDetails, setSkillDetails] = useState<Record<string, WinkGoBrowserSkillDetail>>({});
  const [draftSteps, setDraftSteps] = useState<Record<string, WinkGoBrowserWorkflowStep[]>>({});
  const [stepEditorBusy, setStepEditorBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextStatus, nextSkills] = await Promise.all([
      ipcBridge.winkGoBrowserSkills.getStatus.invoke(),
      ipcBridge.winkGoBrowserSkills.list.invoke(),
    ]);
    setStatus(nextStatus);
    setSkills(nextSkills);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setFeedback(t('common.browserSkillRecorder.loadFailed')));
  }, [refresh, t]);

  useEffect(() => {
    if (status.phase !== 'recording' && status.phase !== 'distilling') return undefined;
    const timer = window.setInterval(() => {
      void ipcBridge.winkGoBrowserSkills.getStatus
        .invoke()
        .then(setStatus)
        .catch((): void => {});
    }, 800);
    return () => window.clearInterval(timer);
  }, [status.phase]);

  const applyResult = useCallback(
    async (operation: Promise<WinkGoBrowserSkillOperationResult>): Promise<void> => {
      setBusy(true);
      try {
        const next = await operation;
        setStatus(next.status);
        setFeedback(
          next.message || (next.ok ? t('common.browserSkillRecorder.done') : t('common.browserSkillRecorder.failed'))
        );
        if (next.ok) await refresh();
      } catch {
        setFeedback(t('common.browserSkillRecorder.failed'));
      } finally {
        setBusy(false);
      }
    },
    [refresh, t]
  );

  const startRecording = (): void => {
    void applyResult(ipcBridge.winkGoBrowserSkills.start.invoke());
  };

  const stopAndSave = (): void => {
    if (!name.trim()) {
      setFeedback(t('common.browserSkillRecorder.nameRequired'));
      return;
    }
    setStatus((current) => ({ ...current, phase: 'distilling' }));
    void applyResult(
      ipcBridge.winkGoBrowserSkills.stopAndSave.invoke({ name: name.trim(), description: description.trim() })
    ).then(() => {
      setName('');
      setDescription('');
    });
  };

  const cancelRecording = (): void => {
    void applyResult(ipcBridge.winkGoBrowserSkills.cancel.invoke());
  };

  const runSkill = (skill: WinkGoBrowserSkillItem): void => {
    const requiredMissing = skill.parameters.some(
      (parameter) => parameter.required && !parameterValues[parameter.key]?.trim()
    );
    if (requiredMissing) {
      setSelectedSkillId(skill.id);
      setFeedback(t('common.browserSkillRecorder.parametersRequired'));
      return;
    }
    void applyResult(
      ipcBridge.winkGoBrowserSkills.run.invoke({
        skillId: skill.id,
        parameters: parameterValues,
      })
    );
  };

  const removeSkill = (skillId: string): void => {
    void applyResult(ipcBridge.winkGoBrowserSkills.remove.invoke({ skillId }));
  };

  const toggleSkill = (skillId: string): void => {
    if (selectedSkillId === skillId) {
      setSelectedSkillId(null);
      return;
    }
    setSelectedSkillId(skillId);
    if (skillDetails[skillId]) return;
    setStepEditorBusy(true);
    void ipcBridge.winkGoBrowserSkills.get
      .invoke({ skillId })
      .then((detail) => {
        if (!detail) {
          setFeedback(t('common.browserSkillRecorder.loadFailed'));
          return;
        }
        setSkillDetails((current) => ({ ...current, [skillId]: detail }));
        setDraftSteps((current) => ({ ...current, [skillId]: detail.steps }));
      })
      .catch(() => setFeedback(t('common.browserSkillRecorder.loadFailed')))
      .finally(() => setStepEditorBusy(false));
  };

  const moveStep = (skillId: string, index: number, direction: -1 | 1): void => {
    setDraftSteps((current) => {
      const steps = [...(current[skillId] || [])];
      const targetIndex = index + direction;
      if (!steps[index] || targetIndex < 0 || targetIndex >= steps.length) return current;
      [steps[index], steps[targetIndex]] = [steps[targetIndex], steps[index]];
      return { ...current, [skillId]: steps };
    });
  };

  const removeStep = (skillId: string, index: number): void => {
    setDraftSteps((current) => ({
      ...current,
      [skillId]: (current[skillId] || []).filter((_step, stepIndex) => stepIndex !== index),
    }));
  };

  const saveSteps = (skillId: string): void => {
    const steps = draftSteps[skillId] || [];
    setStepEditorBusy(true);
    void applyResult(
      ipcBridge.winkGoBrowserSkills.updateSteps.invoke({
        skillId,
        stepIds: steps.map((step) => step.id),
      })
    )
      .then(async () => {
        const detail = await ipcBridge.winkGoBrowserSkills.get.invoke({ skillId });
        if (!detail) return;
        setSkillDetails((current) => ({ ...current, [skillId]: detail }));
        setDraftSteps((current) => ({ ...current, [skillId]: detail.steps }));
      })
      .finally(() => setStepEditorBusy(false));
  };

  return (
    <div className='winkgo-browser-recorder'>
      <div className='winkgo-browser-recorder__status'>
        <span
          className={`winkgo-browser-recorder__status-dot${
            status.phase === 'recording' ? ' winkgo-browser-recorder__status-dot--recording' : ''
          }`}
          aria-hidden='true'
        />
        <span>
          <strong>
            {status.phase === 'recording'
              ? t('common.browserSkillRecorder.recording', { count: status.recordedStepCount })
              : status.phase === 'distilling'
                ? 'WINK GO AI 正在生成技能'
                : status.phase === 'replaying'
                  ? t('common.browserSkillRecorder.replaying')
                  : status.browserAttached
                    ? t('common.browserSkillRecorder.browserReady')
                    : t('common.browserSkillRecorder.browserMissing')}
          </strong>
          <small>{status.currentUrl || t('common.browserSkillRecorder.localOnly')}</small>
        </span>
        <Button
          type='text'
          size='mini'
          aria-label={t('common.refresh')}
          icon={<Refresh theme='outline' size='16' fill='currentColor' />}
          onClick={() => void refresh()}
        />
      </div>

      {status.phase === 'recording' ? (
        <div className='winkgo-browser-recorder__capture'>
          <Input
            value={name}
            maxLength={80}
            placeholder={t('common.browserSkillRecorder.namePlaceholder')}
            onChange={setName}
          />
          <Input
            value={description}
            maxLength={240}
            placeholder={t('common.browserSkillRecorder.descriptionPlaceholder')}
            onChange={setDescription}
          />
          <div className='winkgo-browser-recorder__actions'>
            <Button disabled={busy} onClick={cancelRecording}>
              {t('common.cancel')}
            </Button>
            <Button
              type='primary'
              loading={busy}
              icon={<Save theme='outline' size='16' fill='currentColor' />}
              onClick={stopAndSave}
            >
              {t('common.browserSkillRecorder.saveSkill')}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className='winkgo-browser-recorder__record-button'
          type='primary'
          size='small'
          long
          loading={busy}
          disabled={!status.browserAttached || status.phase !== 'idle'}
          icon={<Record theme='outline' size='17' fill='currentColor' />}
          onClick={startRecording}
        >
          {t('common.browserSkillRecorder.startRecording')}
        </Button>
      )}

      <div className='winkgo-browser-recorder__skills' aria-label={t('common.browserSkillRecorder.savedSkills')}>
        {skills.length > 0 ? (
          skills.map((skill) => {
            const expanded = selectedSkillId === skill.id;
            return (
              <article key={skill.id} className='winkgo-browser-recorder__skill'>
                <Button
                  type='text'
                  long
                  className='winkgo-browser-recorder__skill-summary'
                  onClick={() => toggleSkill(skill.id)}
                >
                  <span>
                    <strong>{skill.name}</strong>
                    <small>
                      {skill.domain}
                      {skill.capability ? ` · ${skill.capability}` : ''}
                      {skill.aiEnhanced ? ' · AI' : ''} ·{' '}
                      {t('common.browserSkillRecorder.stepCount', { count: skill.stepCount })}
                    </small>
                  </span>
                </Button>
                <div className='winkgo-browser-recorder__skill-actions'>
                  <Button
                    type='text'
                    size='mini'
                    aria-label={t('common.browserSkillRecorder.runSkill')}
                    icon={<PlayOne theme='outline' size='17' fill='currentColor' />}
                    onClick={() => runSkill(skill)}
                  />
                  <Button
                    type='text'
                    size='mini'
                    status='danger'
                    aria-label={t('common.delete')}
                    icon={<Delete theme='outline' size='16' fill='currentColor' />}
                    onClick={() => removeSkill(skill.id)}
                  />
                </div>
                {expanded && (
                  <div className='winkgo-browser-recorder__parameters'>
                    {skill.parameters.map((parameter) => (
                      <Input
                        key={parameter.key}
                        type={parameter.secret ? 'password' : 'text'}
                        value={parameterValues[parameter.key] || ''}
                        placeholder={`${parameter.label}${parameter.required ? ' *' : ''}`}
                        onChange={(value) => setParameterValues((current) => ({ ...current, [parameter.key]: value }))}
                      />
                    ))}
                    {skill.parameters.length > 0 && (
                      <Button type='primary' size='small' onClick={() => runSkill(skill)}>
                        {t('common.browserSkillRecorder.runSkill')}
                      </Button>
                    )}
                    {draftSteps[skill.id] && (
                      <BrowserSkillStepEditor
                        steps={draftSteps[skill.id]}
                        busy={stepEditorBusy}
                        dirty={
                          draftSteps[skill.id].map((step) => step.id).join('|') !==
                          skillDetails[skill.id]?.steps.map((step) => step.id).join('|')
                        }
                        onMove={(index, direction) => moveStep(skill.id, index, direction)}
                        onRemove={(index) => removeStep(skill.id, index)}
                        onSave={() => saveSteps(skill.id)}
                      />
                    )}
                  </div>
                )}
              </article>
            );
          })
        ) : (
          <div className='winkgo-browser-recorder__empty'>
            <span>{t('common.browserSkillRecorder.noSkills')}</span>
          </div>
        )}
      </div>

      {feedback && <p className='winkgo-browser-recorder__feedback'>{feedback}</p>}
    </div>
  );
};

export default BrowserSkillRecorder;
