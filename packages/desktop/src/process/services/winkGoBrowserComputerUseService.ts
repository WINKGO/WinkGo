/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  BrowserComputerUseRunRequest,
  BrowserComputerUseRunResult,
  BrowserComputerUseStatus,
} from '@/common/types/computerUse';
import { runWinkGoBrowserAgentTask } from './winkGoBrowserAgentService';

const listeners = new Set<(status: BrowserComputerUseStatus) => void>();
let status: BrowserComputerUseStatus = { phase: 'idle', stepCount: 0, updatedAt: Date.now() };
let activeAbort: AbortController | null = null;

const snapshot = (): BrowserComputerUseStatus => ({
  ...status,
  model: status.model ? { ...status.model } : undefined,
});
const publish = (patch: Partial<BrowserComputerUseStatus>): BrowserComputerUseStatus => {
  status = { ...status, ...patch, updatedAt: Date.now() };
  const next = snapshot();
  for (const listener of listeners) listener(next);
  return next;
};

export const getWinkGoBrowserComputerUseStatus = (): BrowserComputerUseStatus => snapshot();
export const onWinkGoBrowserComputerUseStatus = (
  listener: (next: BrowserComputerUseStatus) => void
): (() => void) => {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
};

export const runWinkGoBrowserComputerUse = async (
  request: BrowserComputerUseRunRequest
): Promise<BrowserComputerUseRunResult> => {
  if (activeAbort) return { ok: false, status: snapshot() };
  const goal = request.goal.trim();
  if (!goal) return { ok: false, status: publish({ phase: 'failed', message: '网页任务目标不能为空。' }) };
  const abort = new AbortController();
  activeAbort = abort;
  publish({ phase: 'starting', goal, model: { ...request.model }, stepCount: 0, message: '正在连接内置浏览器…' });
  try {
    const result = await runWinkGoBrowserAgentTask(
      { ...request, goal },
      {
        signal: abort.signal,
        onProgress: (event) => publish({ ...event }),
      }
    );
    const phase: BrowserComputerUseStatus['phase'] = result.ok
      ? 'completed'
      : result.status === 'blocked'
        ? abort.signal.aborted
          ? 'cancelled'
          : 'blocked'
        : 'failed';
    return {
      ok: result.ok,
      status: publish({
        taskId: result.taskId,
        phase,
        stepCount: result.steps.length,
        url: result.finalPage?.url,
        title: result.finalPage?.title,
        message: result.message,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      status: publish({ phase: abort.signal.aborted ? 'cancelled' : 'failed', message: error instanceof Error ? error.message : String(error) }),
    };
  } finally {
    if (activeAbort === abort) activeAbort = null;
  }
};

export const cancelWinkGoBrowserComputerUse = (): BrowserComputerUseStatus => {
  activeAbort?.abort();
  activeAbort = null;
  return publish({ phase: 'cancelled', message: '浏览器任务已停止。' });
};
