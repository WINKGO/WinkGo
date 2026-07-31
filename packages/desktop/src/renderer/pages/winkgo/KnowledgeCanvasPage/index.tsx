/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, MindMapping, Refresh } from '@icon-park/react';
import { Button } from '@arco-design/web-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import styles from './index.module.css';
import {
  isKnowledgeCanvasAnalysisRequest,
  isKnowledgeCanvasCancelRequest,
  KNOWLEDGE_CANVAS_BRIDGE_CHANNEL,
  KNOWLEDGE_CANVAS_BRIDGE_VERSION,
  runKnowledgeCanvasAnalysis,
  type KnowledgeCanvasHostMessage,
} from './knowledgeCanvasAiBridge';

const CANVAS_ASSET_PATH = './knowledge-canvas/index.html';
const CANVAS_ASSET_VERSION = '20260726-ai-bridge-1';

export const isKnowledgeCanvasBundleEnabled = () =>
  import.meta.env.DEV && import.meta.env.VITE_WINKGO_ENABLE_KNOWLEDGE_CANVAS === '1';

export const resolveKnowledgeCanvasUrl = (pageHref: string) => {
  const url = new URL(CANVAS_ASSET_PATH, pageHref);
  url.searchParams.set('v', CANVAS_ASSET_VERSION);
  return url.toString();
};

const KnowledgeCanvasPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [frameKey, setFrameKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const activeAnalysisRef = useRef<AbortController | null>(null);
  const canvasUrl = useMemo(() => resolveKnowledgeCanvasUrl(window.location.href), []);
  const canvasEnabled = useMemo(() => isKnowledgeCanvasBundleEnabled(), []);

  useEffect(() => {
    if (!canvasEnabled) return;

    const postToCanvas = (message: KnowledgeCanvasHostMessage) => {
      frameRef.current?.contentWindow?.postMessage(message, '*');
    };

    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (isKnowledgeCanvasCancelRequest(event.data)) {
        activeAnalysisRef.current?.abort();
        activeAnalysisRef.current = null;
        setAnalysisRunning(false);
        return;
      }
      if (!isKnowledgeCanvasAnalysisRequest(event.data)) return;
      const request = event.data;
      activeAnalysisRef.current?.abort();
      const abortController = new AbortController();
      activeAnalysisRef.current = abortController;
      setAnalysisRunning(true);

      void runKnowledgeCanvasAnalysis(request, {
        signal: abortController.signal,
        onProgress: (progress) => {
          postToCanvas({
            channel: KNOWLEDGE_CANVAS_BRIDGE_CHANNEL,
            version: KNOWLEDGE_CANVAS_BRIDGE_VERSION,
            type: 'progress',
            requestId: request.requestId,
            ...progress,
          });
        },
      })
        .then((analysis) => {
          if (abortController.signal.aborted) return;
          postToCanvas({
            channel: KNOWLEDGE_CANVAS_BRIDGE_CHANNEL,
            version: KNOWLEDGE_CANVAS_BRIDGE_VERSION,
            type: 'result',
            requestId: request.requestId,
            analysis,
          });
        })
        .catch((error: unknown) => {
          if (abortController.signal.aborted) return;
          const message = error instanceof Error ? error.message : t('guid.knowledgeCanvas.analysisFailed');
          postToCanvas({
            channel: KNOWLEDGE_CANVAS_BRIDGE_CHANNEL,
            version: KNOWLEDGE_CANVAS_BRIDGE_VERSION,
            type: 'error',
            requestId: request.requestId,
            message,
            code: 'WINKGO_AI_ANALYSIS_FAILED',
          });
        })
        .finally(() => {
          if (activeAnalysisRef.current === abortController) {
            activeAnalysisRef.current = null;
            setAnalysisRunning(false);
          }
        });
    };

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      activeAnalysisRef.current?.abort();
      activeAnalysisRef.current = null;
    };
  }, [canvasEnabled, t]);

  const reloadCanvas = () => {
    activeAnalysisRef.current?.abort();
    activeAnalysisRef.current = null;
    setAnalysisRunning(false);
    setReady(false);
    setFrameKey((value) => value + 1);
  };

  return (
    <section className={styles.page} aria-label={t('guid.knowledgeCanvas.pageLabel')}>
      <header className={styles.toolbar}>
        <div className={styles.titleGroup}>
          <Button
            type='secondary'
            shape='circle'
            className={styles.iconButton}
            onClick={() => navigate('/guid')}
            aria-label={t('guid.knowledgeCanvas.backToChat')}
            title={t('guid.knowledgeCanvas.backToChat')}
            icon={<ArrowLeft theme='outline' size='18' fill='currentColor' strokeWidth={3} />}
          />
          <span className={styles.canvasMark} aria-hidden='true'>
            <MindMapping theme='outline' size='19' fill='currentColor' strokeWidth={3} />
          </span>
          <div>
            <h1 className={styles.title}>{t('guid.knowledgeCanvas.title')}</h1>
            <p className={styles.subtitle}>{t('guid.knowledgeCanvas.subtitle')}</p>
          </div>
        </div>

        <div className={styles.toolbarActions}>
          <span className={styles.offlineBadge}>
            <span className={styles.offlineDot} aria-hidden='true' />
            {!canvasEnabled
              ? t('guid.knowledgeCanvas.statusUnavailable')
              : analysisRunning
                ? t('guid.knowledgeCanvas.statusAnalyzing')
                : t('guid.knowledgeCanvas.statusReady')}
          </span>
          {canvasEnabled ? (
            <Button
              type='secondary'
              shape='circle'
              className={styles.iconButton}
              onClick={reloadCanvas}
              aria-label={t('guid.knowledgeCanvas.reload')}
              title={t('guid.knowledgeCanvas.reload')}
              icon={<Refresh theme='outline' size='18' fill='currentColor' strokeWidth={3} />}
            />
          ) : null}
        </div>
      </header>

      <div className={styles.canvasShell}>
        {!canvasEnabled ? (
          <div className={styles.unavailable} role='status'>
            <span className={styles.unavailableMark}>
              <MindMapping theme='outline' size='28' fill='currentColor' strokeWidth={3} />
            </span>
            <h2>{t('guid.knowledgeCanvas.unavailableTitle')}</h2>
            <p>{t('guid.knowledgeCanvas.unavailableDescription')}</p>
          </div>
        ) : (
          <>
            {!ready ? (
              <div className={styles.loading} role='status'>
                <span className={styles.loadingMark}>
                  <MindMapping theme='outline' size='24' fill='currentColor' strokeWidth={3} />
                </span>
                <span>{t('guid.knowledgeCanvas.loading')}</span>
              </div>
            ) : null}
            <iframe
              key={frameKey}
              ref={frameRef}
              className={styles.canvasFrame}
              src={canvasUrl}
              title={t('guid.knowledgeCanvas.frameTitle')}
              allow='clipboard-read; clipboard-write; fullscreen'
              referrerPolicy='no-referrer'
              onLoad={() => setReady(true)}
            />
          </>
        )}
      </div>
    </section>
  );
};

export default KnowledgeCanvasPage;
