/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input } from '@arco-design/web-react';
import { Delete, PauseOne, PlayOne, Record, Save } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  DesktopRecorderStatus,
  DesktopSkillOperationResult,
  DesktopSkillSummary,
} from '@/common/types/desktopAutomation';
import './styles.css';

const IDLE_STATUS: DesktopRecorderStatus = {
  phase: 'idle',
  targetDisplayIds: [],
  updatedAt: 0,
  stepCount: 0,
  filteredEventCount: 0,
};

export interface DesktopSkillRecorderProps {
  onRecordingStarted?: () => void;
}

const DesktopSkillRecorder: React.FC<DesktopSkillRecorderProps> = ({ onRecordingStarted }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState(IDLE_STATUS);
  const [skills, setSkills] = useState<DesktopSkillSummary[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const mountedRef = useRef(false);
  const statusVersionRef = useRef(0);
  const statusRefreshInFlightRef = useRef<{ requestId: number; sessionKey: string } | null>(null);
  const statusRefreshRequestIdRef = useRef(0);

  const refresh = useCallback(async (preserveNewerStatus = false) => {
    const statusVersion = statusVersionRef.current;
    const [nextStatus, nextSkills] = await Promise.all([
      ipcBridge.winkGoDesktopSkills.getStatus.invoke(),
      ipcBridge.winkGoDesktopSkills.list.invoke(),
    ]);
    if (!mountedRef.current) return;
    if (!preserveNewerStatus || statusVersion === statusVersionRef.current) setStatus(nextStatus);
    setSkills(nextSkills);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh(true).catch(() => {
      if (mountedRef.current) setFeedback(t('common.desktopSkillRecorder.loadFailed'));
    });
    const unsubscribe = ipcBridge.winkGoDesktopSkills.statusChanged.on((nextStatus) => {
      statusVersionRef.current += 1;
      setStatus(nextStatus);
    });
    return () => {
      mountedRef.current = false;
      statusVersionRef.current += 1;
      unsubscribe();
    };
  }, [refresh, t]);

  useEffect(() => {
    if (status.phase !== 'recording' && status.phase !== 'paused') return undefined;
    let active = true;
    const sessionKey = status.sessionId || `${status.phase}:${status.startedAt ?? 'unknown'}`;
    const timer = window.setInterval(() => {
      if (statusRefreshInFlightRef.current?.sessionKey === sessionKey) return;
      const requestId = ++statusRefreshRequestIdRef.current;
      statusRefreshInFlightRef.current = { requestId, sessionKey };
      void ipcBridge.winkGoDesktopSkills.refreshStatus
        .invoke()
        .then((nextStatus) => {
          if (active) setStatus(nextStatus);
        })
        .catch((): void => {})
        .finally(() => {
          if (statusRefreshInFlightRef.current?.requestId === requestId) {
            statusRefreshInFlightRef.current = null;
          }
        });
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [status.phase, status.sessionId, status.startedAt]);

  const apply = useCallback(
    async (operation: Promise<DesktopSkillOperationResult>): Promise<DesktopSkillOperationResult | null> => {
      setBusy(true);
      try {
        const result = await operation;
        setStatus(result.status);
        setFeedback(
          result.error ||
            result.status.message ||
            (result.ok ? t('common.desktopSkillRecorder.done') : t('common.desktopSkillRecorder.failed'))
        );
        if (result.ok) {
          setSkills(await ipcBridge.winkGoDesktopSkills.list.invoke());
        }
        return result;
      } catch {
        setFeedback(t('common.desktopSkillRecorder.failed'));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [t]
  );

  const isCapturing = status.phase === 'recording' || status.phase === 'paused';

  const start = (): void => {
    void apply(ipcBridge.winkGoDesktopSkills.start.invoke()).then((result) => {
      if (result?.ok) onRecordingStarted?.();
    });
  };

  const save = (): void => {
    if (!name.trim()) {
      setFeedback(t('common.desktopSkillRecorder.nameRequired'));
      return;
    }
    void apply(
      ipcBridge.winkGoDesktopSkills.stopAndSave.invoke({
        name: name.trim(),
        description: description.trim(),
      })
    ).then((result) => {
      if (!result?.ok) return;
      setName('');
      setDescription('');
    });
  };

  const run = (skill: DesktopSkillSummary): void => {
    const missing = skill.parameters.some((parameter) => parameter.required && !parameters[parameter.key]?.trim());
    if (missing) {
      setExpandedSkillId(skill.id);
      setFeedback(t('common.desktopSkillRecorder.parametersRequired'));
      return;
    }
    void apply(ipcBridge.winkGoDesktopSkills.run.invoke({ skillId: skill.id, parameters, source: 'island' }));
  };

  return (
    <div className='winkgo-desktop-recorder'>
      <div
        className='winkgo-desktop-recorder__status'
        data-phase={status.phase}
        data-step-count={status.stepCount}
      >
        <i aria-hidden='true' />
        <span>
          <strong>
            {status.phase === 'recording'
              ? t('common.desktopSkillRecorder.recording', { count: status.stepCount })
              : status.phase === 'paused'
                ? t('common.desktopSkillRecorder.paused', { count: status.stepCount })
                : status.phase === 'replaying' || status.phase === 'ai_takeover'
                  ? t('common.desktopSkillRecorder.replaying')
                  : t('common.desktopSkillRecorder.ready')}
          </strong>
          <small>{status.target?.title || status.message || t('common.desktopSkillRecorder.localOnly')}</small>
        </span>
      </div>

      {isCapturing ? (
        <div className='winkgo-desktop-recorder__capture'>
          <div className='winkgo-desktop-recorder__capture-row'>
            <Input
              value={name}
              maxLength={80}
              placeholder={t('common.desktopSkillRecorder.namePlaceholder')}
              onChange={setName}
            />
            <Input
              value={description}
              maxLength={240}
              placeholder={t('common.desktopSkillRecorder.descriptionPlaceholder')}
              onChange={setDescription}
            />
          </div>
          <div className='winkgo-desktop-recorder__actions'>
            <Button disabled={busy} onClick={() => void apply(ipcBridge.winkGoDesktopSkills.cancel.invoke())}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={busy}
              icon={status.phase === 'paused' ? <PlayOne /> : <PauseOne />}
              onClick={() =>
                void apply(
                  status.phase === 'paused'
                    ? ipcBridge.winkGoDesktopSkills.resume.invoke()
                    : ipcBridge.winkGoDesktopSkills.pause.invoke()
                )
              }
            >
              {status.phase === 'paused'
                ? t('common.desktopSkillRecorder.resume')
                : t('common.desktopSkillRecorder.pause')}
            </Button>
            <Button type='primary' loading={busy} icon={<Save />} onClick={save}>
              {t('common.desktopSkillRecorder.saveSkill')}
            </Button>
          </div>
        </div>
      ) : (
        <div className='winkgo-desktop-recorder__start'>
          <small>{t('common.desktopSkillRecorder.localOnly')}</small>
          <Button type='primary' loading={busy} disabled={busy} icon={<Record />} onClick={start}>
            {t('common.desktopSkillRecorder.startRecording')}
          </Button>
        </div>
      )}

      <div className='winkgo-desktop-recorder__skills'>
        {skills.length ? (
          skills.map((skill) => (
            <article key={skill.id}>
              <Button
                type='text'
                className='winkgo-desktop-recorder__skill-name'
                onClick={() => setExpandedSkillId((current) => (current === skill.id ? null : skill.id))}
              >
                <span>
                  <strong>{skill.name}</strong>
                  <small>{t('common.desktopSkillRecorder.parameterCount', { count: skill.parameters.length })}</small>
                </span>
              </Button>
              <Button
                type='text'
                size='mini'
                aria-label={t('common.desktopSkillRecorder.runSkill')}
                icon={<PlayOne />}
                onClick={() => run(skill)}
              />
              <Button
                type='text'
                size='mini'
                status='danger'
                aria-label={t('common.delete')}
                icon={<Delete />}
                onClick={() => {
                  void ipcBridge.winkGoDesktopSkills.remove.invoke({ skillId: skill.id }).then(() => refresh());
                }}
              />
              {expandedSkillId === skill.id && skill.parameters.length > 0 && (
                <div className='winkgo-desktop-recorder__parameters'>
                  {skill.parameters.map((parameter) => (
                    <Input
                      key={parameter.key}
                      type={parameter.secret ? 'password' : 'text'}
                      value={parameters[parameter.key] || ''}
                      placeholder={`${parameter.label || parameter.key}${parameter.required ? ' *' : ''}`}
                      onChange={(value) => setParameters((current) => ({ ...current, [parameter.key]: value }))}
                    />
                  ))}
                </div>
              )}
            </article>
          ))
        ) : (
          <p className='winkgo-desktop-recorder__empty'>{t('common.desktopSkillRecorder.noSkills')}</p>
        )}
      </div>
      {feedback && <p className='winkgo-desktop-recorder__feedback'>{feedback}</p>}
    </div>
  );
};

export default DesktopSkillRecorder;
