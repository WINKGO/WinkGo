/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArrowLeft, MindMapping, Refresh } from '@icon-park/react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

export const resolveKnowledgeCanvasUrl = (pageHref: string) => {
  const url = new URL(CANVAS_ASSET_PATH, pageHref);
  url.searchParams.set('v', CANVAS_ASSET_VERSION);
  return url.toString();
};

const KnowledgeCanvasPage: React.FC = () => {
  const navigate = useNavigate();
  const [frameKey, setFrameKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [analysisRunning, setAnalysisRunning] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const activeAnalysisRef = useRef<AbortController | null>(null);
  const canvasUrl = useMemo(() => resolveKnowledgeCanvasUrl(window.location.href), []);

  useEffect(() => {
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
          const message = error instanceof Error ? error.message : 'WINK GO AI 分析失败，请稍后重试';
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
  }, []);

  const reloadCanvas = () => {
    activeAnalysisRef.current?.abort();
    activeAnalysisRef.current = null;
    setAnalysisRunning(false);
    setReady(false);
    setFrameKey((value) => value + 1);
  };

  return (
    <section className={styles.page} aria-label='WINK GO 知识画布'>
      <header className={styles.toolbar}>
        <div className={styles.titleGroup}>
          <button
            type='button'
            className={styles.iconButton}
            onClick={() => navigate('/guid')}
            aria-label='返回聊天'
            title='返回聊天'
          >
            <ArrowLeft theme='outline' size='18' fill='currentColor' strokeWidth={3} />
          </button>
          <span className={styles.canvasMark} aria-hidden='true'>
            <MindMapping theme='outline' size='19' fill='currentColor' strokeWidth={3} />
          </span>
          <div>
            <h1 className={styles.title}>知识画布</h1>
            <p className={styles.subtitle}>把网页、文档与想法整理成可编辑的知识结构</p>
          </div>
        </div>

        <div className={styles.toolbarActions}>
          <span className={styles.offlineBadge}>
            <span className={styles.offlineDot} aria-hidden='true' />
            {analysisRunning ? 'WINK GO AI 分析中' : '本机画布 · AI 可用'}
          </span>
          <button
            type='button'
            className={styles.iconButton}
            onClick={reloadCanvas}
            aria-label='重新加载知识画布'
            title='重新加载'
          >
            <Refresh theme='outline' size='18' fill='currentColor' strokeWidth={3} />
          </button>
        </div>
      </header>

      <div className={styles.canvasShell}>
        {!ready ? (
          <div className={styles.loading} role='status'>
            <span className={styles.loadingMark}>
              <MindMapping theme='outline' size='24' fill='currentColor' strokeWidth={3} />
            </span>
            <span>正在打开知识画布…</span>
          </div>
        ) : null}
        <iframe
          key={frameKey}
          ref={frameRef}
          className={styles.canvasFrame}
          src={canvasUrl}
          title='WINK GO 知识画布'
          allow='clipboard-read; clipboard-write; fullscreen'
          referrerPolicy='no-referrer'
          onLoad={() => setReady(true)}
        />
      </div>
    </section>
  );
};

export default KnowledgeCanvasPage;
