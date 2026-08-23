/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { app, screen } from 'electron';
import type {
  DesktopAutomationStatus,
  DesktopRecorderStatus,
  DesktopRecorderTarget,
  DesktopSkillOperationResult,
  DesktopSkillPackage,
  DesktopSkillLocator,
  DesktopSkillRunRequest,
  DesktopSkillSaveRequest,
  DesktopSkillStep,
  DesktopSkillSummary,
} from '@/common/types/desktopAutomation';
import { callWinkGoRuntimeTool } from './WinkGoXiaozhiService';
import { selectWinkGoDesktopRepairCandidateWithAi } from './winkGoBrowserSkillAiService';
import { AutomationOverlayManager } from './computer-automation/automationOverlayManager';
import { createElectronAutomationOverlayWindowFactory } from './computer-automation/automationOverlayElectron';
import { DesktopAutomationStateMachine } from './computer-automation/automationStateMachine';
import { RecorderOperationCoordinator, SingleFlight } from './computer-automation/singleFlight';
import {
  filterDesktopRecorderTargets,
  isSafeDesktopRecorderTarget,
} from './computer-automation/desktopRecorderTargetPolicy';
import {
  RuntimeDesktopAutomationPort,
  WinkGoDesktopSkillRunner,
  WinkGoDesktopSkillsStore,
  unwrapRuntimeToolPayload,
} from './desktop-automation';

type RuntimeRecordedStep = Record<string, unknown>;

const PROFILE_ID = 'local';
const RECORDING_START_TIMEOUT_MS = 30_000;
const listeners = new Set<(status: DesktopRecorderStatus) => void>();
const state = new DesktopAutomationStateMachine();
let target: DesktopRecorderTarget | undefined;
let stepCount = 0;
let filteredEventCount = 0;
let message = '';
let terminalReset: NodeJS.Timeout | undefined;
let store: WinkGoDesktopSkillsStore | undefined;
const recordingStatusRefresh = new SingleFlight<DesktopRecorderStatus>();
const recorderOperations = new RecorderOperationCoordinator();

const beginRecorderMutation = (): number | null => {
  const token = recorderOperations.beginMutation();
  if (token !== null) recordingStatusRefresh.invalidate();
  return token;
};

const invalidateRecorderOperations = (): void => {
  recorderOperations.invalidate();
  recordingStatusRefresh.invalidate();
};

const winkGoProcessIds = (): Set<number> => {
  const ids = new Set<number>([process.pid]);
  for (const metric of app.getAppMetrics()) {
    if (Number.isInteger(metric.pid) && metric.pid > 0) ids.add(metric.pid);
  }
  return ids;
};

const overlay = new AutomationOverlayManager({
  getDisplays: () =>
    screen.getAllDisplays().map(({ id, bounds, workArea, scaleFactor }) => ({ id, bounds, workArea, scaleFactor })),
  createBorderWindow: createElectronAutomationOverlayWindowFactory(),
});

const getStore = (): WinkGoDesktopSkillsStore =>
  (store ??= new WinkGoDesktopSkillsStore({ rootDir: path.join(app.getPath('userData'), 'winkgo-desktop-skills') }));

const statusSnapshot = (): DesktopRecorderStatus => ({
  ...state.getSnapshot(),
  ...(target ? { target: { ...target, rect: { ...target.rect } } } : {}),
  stepCount,
  filteredEventCount,
  ...(message ? { message } : {}),
});

const publish = (): DesktopRecorderStatus => {
  const status = statusSnapshot();
  try {
    overlay.sync(status);
  } catch (error) {
    console.warn('[ComputerAutomation] Control Border overlay update failed:', error);
  }
  for (const listener of listeners) listener(status);
  return status;
};

const clearTerminalReset = (): void => {
  if (terminalReset) clearTimeout(terminalReset);
  terminalReset = undefined;
};

const resetSoon = (): void => {
  clearTerminalReset();
  terminalReset = setTimeout(() => {
    state.reset();
    target = undefined;
    stepCount = 0;
    filteredEventCount = 0;
    message = '';
    publish();
  }, 1_400);
  terminalReset.unref?.();
};

const transition = (phase: DesktopAutomationStatus['phase'], patch: Partial<DesktopAutomationStatus> = {}): void => {
  state.transition(phase, patch);
  publish();
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const numberValue = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);

const parseTarget = (value: unknown): DesktopRecorderTarget | undefined => {
  const raw = asRecord(value);
  const rect = asRecord(raw?.rect);
  if (!raw || !rect) return undefined;
  const left = numberValue(rect.left ?? rect.x);
  const top = numberValue(rect.top ?? rect.y);
  const width = numberValue(rect.width) || numberValue(rect.right) - left;
  const height = numberValue(rect.height) || numberValue(rect.bottom) - top;
  const parsed = {
    hwnd: numberValue(raw.hwnd),
    pid: numberValue(raw.pid),
    title: textValue(raw.title),
    processName: textValue(raw.process_name ?? raw.processName),
    rect: { x: left, y: top, width, height },
  };
  return parsed.hwnd > 0 && parsed.pid > 0 && width > 0 && height > 0 ? parsed : undefined;
};

const targetDisplayIds = (nextTarget?: DesktopRecorderTarget): number[] => {
  if (!nextTarget) return [screen.getPrimaryDisplay().id];
  return [screen.getDisplayMatching(nextTarget.rect).id];
};

const requireRuntimeResult = async (
  name: string,
  args: Record<string, unknown> = {},
  options: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<Record<string, unknown>> => {
  const payload = unwrapRuntimeToolPayload(await callWinkGoRuntimeTool(name, args, options));
  if (!payload) throw new Error('Runtime 返回了无法识别的桌面自动化结果。');
  if (payload.success === false) {
    throw new Error(
      textValue(payload.error) || textValue(payload.reason) || textValue(payload.error_code) || '桌面自动化失败。'
    );
  }
  return payload;
};

const requireRuntimeResultBeforeDeadline = async (
  name: string,
  args: Record<string, unknown> = {},
  timeoutMs = RECORDING_START_TIMEOUT_MS
): Promise<Record<string, unknown>> => {
  const controller = new AbortController();
  let deadline: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      requireRuntimeResult(name, args, { signal: controller.signal, timeoutMs }),
      new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          controller.abort();
          reject(new Error('电脑自动化服务启动超时，请确认本地 Runtime 已启动后重试。'));
        }, timeoutMs);
        deadline.unref?.();
      }),
    ]);
  } finally {
    if (deadline) clearTimeout(deadline);
  }
};

const locatorFrom = (value: unknown): DesktopSkillLocator => {
  const raw = asRecord(value) || {};
  const point = asRecord(raw.relativePoint ?? raw.relative_point);
  return {
    ...(textValue(raw.automationId ?? raw.automation_id)
      ? { automationId: textValue(raw.automationId ?? raw.automation_id) }
      : {}),
    ...(textValue(raw.controlType ?? raw.control_type)
      ? { controlType: textValue(raw.controlType ?? raw.control_type) }
      : {}),
    ...(textValue(raw.name) ? { name: textValue(raw.name) } : {}),
    ...(textValue(raw.className ?? raw.class_name) ? { className: textValue(raw.className ?? raw.class_name) } : {}),
    ...(textValue(raw.ocrText ?? raw.ocr_text) ? { ocrText: textValue(raw.ocrText ?? raw.ocr_text) } : {}),
    ...(point ? { relativePoint: { x: numberValue(point.x), y: numberValue(point.y) } } : {}),
  };
};

const stepFromRuntime = (value: RuntimeRecordedStep, index: number): DesktopSkillStep | null => {
  const id = textValue(value.step_id ?? value.id) || `step-${String(index + 1).padStart(4, '0')}`;
  const kind = textValue(value.kind).toLowerCase();
  const locatorRaw = asRecord(value.locator) || {};
  const normalizedPoint = asRecord(value.normalized_point);
  const locator = locatorFrom({
    ...locatorRaw,
    ...(normalizedPoint ? { relativePoint: normalizedPoint } : {}),
  });
  if (kind === 'click') return { id, kind: 'click', locator };
  if (kind === 'set_value' || kind === 'input') {
    const parameter = asRecord(value.parameter);
    return {
      id,
      kind: 'input',
      locator,
      parameterKey: textValue(parameter?.name) || `text_${String(index + 1).padStart(4, '0')}`,
      sensitive: parameter?.secret === true,
    };
  }
  if (kind === 'key_chord') {
    const keys = (Array.isArray(value.keys) ? value.keys : []).map(textValue).filter(Boolean);
    if (!keys.length) return null;
    return keys.length === 1 ? { id, kind: 'press', key: keys[0] } : { id, kind: 'hotkey', keys };
  }
  if (kind === 'scroll') return { id, kind: 'scroll', deltaY: numberValue(value.delta) };
  return null;
};

const slugify = (name: string): string => {
  const latin = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return latin || `desktop-${randomUUID().slice(0, 12)}`;
};

const packageFromRecording = (
  recording: Record<string, unknown>,
  request: DesktopSkillSaveRequest
): DesktopSkillPackage => {
  const recordedTarget = parseTarget(recording.target);
  if (!recordedTarget) throw new Error('录制目标已失效，无法保存桌面技能。');
  const rawSteps = (Array.isArray(recording.steps) ? recording.steps : []).filter((item): item is RuntimeRecordedStep =>
    Boolean(asRecord(item))
  );
  const steps = rawSteps.map(stepFromRuntime).filter((item): item is DesktopSkillStep => Boolean(item));
  if (!steps.length) throw new Error('没有录制到可回放的有效操作。');
  const rawParameters = (Array.isArray(recording.parameters) ? recording.parameters : []).map(asRecord).filter(Boolean);
  const parameterByKey = new Map<string, { key: string; required: boolean; secret: boolean }>();
  for (const parameter of rawParameters) {
    const key = textValue(parameter?.name);
    if (key)
      parameterByKey.set(key, { key, required: parameter?.required !== false, secret: parameter?.secret === true });
  }
  for (const step of steps) {
    if (step.kind === 'input' && step.parameterKey && !parameterByKey.has(step.parameterKey)) {
      parameterByKey.set(step.parameterKey, {
        key: step.parameterKey,
        required: true,
        secret: Boolean(step.sensitive),
      });
    }
  }
  const name = request.name.trim();
  if (!name) throw new Error('请输入桌面技能名称。');
  return {
    manifest: {
      schemaVersion: 'winkgo.desktop.skill.v1',
      id: slugify(name),
      name,
      description:
        request.description?.trim() || `在 ${recordedTarget.processName || recordedTarget.title} 中重复执行录制流程。`,
      runner: 'winkgo.desktop-skill.v1',
      capability: 'desktop.automation.run',
      triggerPhrases: [
        ...new Set([name, ...(request.triggerPhrases || []).map((item) => item.trim()).filter(Boolean)]),
      ].slice(0, 12),
      parameters: [...parameterByKey.values()],
    },
    workflow: {
      schemaVersion: 'winkgo.desktop.workflow.v1',
      targetApp: { processName: recordedTarget.processName },
      steps,
      outcomeChecks: [{ id: 'target-window-still-present', kind: 'window_exists' }],
    },
  };
};

const operationFailure = (error: unknown): DesktopSkillOperationResult => {
  invalidateRecorderOperations();
  message = error instanceof Error ? error.message : String(error);
  try {
    transition('error');
  } catch {
    state.reset();
    state.transition('arming');
    transition('error');
  }
  resetSoon();
  return { ok: false, status: statusSnapshot(), error: message };
};

const staleOperationResult = (): DesktopSkillOperationResult => ({
  ok: false,
  status: statusSnapshot(),
  error: '录制操作已取消或被新的会话替代。',
});

const busyOperationResult = (): DesktopSkillOperationResult => ({
  ok: false,
  status: statusSnapshot(),
  error: '另一个录制操作正在处理中，请稍候。',
});

export const onWinkGoDesktopAutomationStatus = (listener: (status: DesktopRecorderStatus) => void): (() => void) => {
  listeners.add(listener);
  listener(statusSnapshot());
  return () => listeners.delete(listener);
};

export const getWinkGoDesktopAutomationStatus = (): DesktopRecorderStatus => statusSnapshot();

export const listWinkGoDesktopTargets = async (): Promise<DesktopRecorderTarget[]> => {
  const result = await requireRuntimeResult('desktop_automation.list_targets', { limit: 60 });
  const parsed = (Array.isArray(result.targets) ? result.targets : [])
    .map(parseTarget)
    .filter(Boolean) as DesktopRecorderTarget[];
  return filterDesktopRecorderTargets(parsed, { hostPid: process.pid, blockedPids: winkGoProcessIds() });
};

export const listWinkGoDesktopSkills = async (): Promise<DesktopSkillSummary[]> => {
  const registry = await getStore().list(PROFILE_ID);
  return Promise.all(
    registry.map(async (item) => {
      const skill = await getStore().load(PROFILE_ID, item.id);
      return { ...item, parameters: skill?.manifest.parameters || [] };
    })
  );
};

export const startWinkGoDesktopRecording = async (): Promise<DesktopSkillOperationResult> => {
  const operationToken = beginRecorderMutation();
  if (operationToken === null) return busyOperationResult();
  try {
    clearTerminalReset();
    state.reset();
    transition('arming', {
      sessionId: `record-${randomUUID()}`,
      targetDisplayIds: [screen.getPrimaryDisplay().id],
    });
    const result = await requireRuntimeResultBeforeDeadline('desktop_automation.record_start_current');
    if (!recorderOperations.isCurrent(operationToken)) {
      await callWinkGoRuntimeTool('desktop_automation.cancel', {}, { timeoutMs: 5_000 }).catch(
        (): undefined => undefined
      );
      return staleOperationResult();
    }
    const runtimeTarget = parseTarget(result.target);
    if (
      !runtimeTarget ||
      !isSafeDesktopRecorderTarget(runtimeTarget, { hostPid: process.pid, blockedPids: winkGoProcessIds() })
    ) {
      await callWinkGoRuntimeTool('desktop_automation.cancel', {}, { timeoutMs: 5_000 }).catch(
        (): undefined => undefined
      );
      throw new Error('Runtime 没有锁定到安全的外部窗口，已停止录制。');
    }
    target = runtimeTarget;
    stepCount = numberValue(result.step_count);
    filteredEventCount = 0;
    message = '';
    transition('recording', { targetDisplayIds: targetDisplayIds(target) });
    return { ok: true, status: statusSnapshot() };
  } catch (error) {
    if (!recorderOperations.isCurrent(operationToken)) return staleOperationResult();
    return operationFailure(error);
  } finally {
    recorderOperations.endMutation(operationToken);
  }
};

export const refreshWinkGoDesktopRecordingStatus = (): Promise<DesktopRecorderStatus> =>
  recordingStatusRefresh.run(async () => {
    const phase = state.getSnapshot().phase;
    if (phase !== 'recording' && phase !== 'paused') return statusSnapshot();
    const generation = recorderOperations.snapshot();
    const result = await requireRuntimeResult('desktop_automation.record_status');
    const currentPhase = state.getSnapshot().phase;
    if (!recorderOperations.isCurrent(generation) || (currentPhase !== 'recording' && currentPhase !== 'paused')) {
      return statusSnapshot();
    }
    target = parseTarget(result.target) || target;
    stepCount = numberValue(result.step_count);
    filteredEventCount = numberValue(result.filtered_event_count);
    return publish();
  });

export const pauseWinkGoDesktopRecording = async (): Promise<DesktopSkillOperationResult> => {
  const operationToken = beginRecorderMutation();
  if (operationToken === null) return busyOperationResult();
  try {
    const result = await requireRuntimeResult('desktop_automation.record_pause');
    if (!recorderOperations.isCurrent(operationToken)) return staleOperationResult();
    stepCount = numberValue(result.step_count);
    transition('paused');
    return { ok: true, status: statusSnapshot() };
  } catch (error) {
    if (!recorderOperations.isCurrent(operationToken)) return staleOperationResult();
    return operationFailure(error);
  } finally {
    recorderOperations.endMutation(operationToken);
  }
};

export const resumeWinkGoDesktopRecording = async (): Promise<DesktopSkillOperationResult> => {
  const operationToken = beginRecorderMutation();
  if (operationToken === null) return busyOperationResult();
  try {
    const result = await requireRuntimeResult('desktop_automation.record_resume');
    if (!recorderOperations.isCurrent(operationToken)) return staleOperationResult();
    stepCount = numberValue(result.step_count);
    state.resume();
    publish();
    return { ok: true, status: statusSnapshot() };
  } catch (error) {
    if (!recorderOperations.isCurrent(operationToken)) return staleOperationResult();
    return operationFailure(error);
  } finally {
    recorderOperations.endMutation(operationToken);
  }
};

export const stopAndSaveWinkGoDesktopRecording = async (
  request: DesktopSkillSaveRequest
): Promise<DesktopSkillOperationResult> => {
  const operationToken = beginRecorderMutation();
  if (operationToken === null) return busyOperationResult();
  try {
    const result = await requireRuntimeResult('desktop_automation.record_stop', {}, { timeoutMs: 15_000 });
    if (!recorderOperations.isCurrent(operationToken)) return staleOperationResult();
    stepCount = (Array.isArray(result.steps) ? result.steps : []).length;
    filteredEventCount = numberValue(result.filtered_event_count);
    const skill = packageFromRecording(result, request);
    await getStore().save({ profileId: PROFILE_ID, skill });
    if (!recorderOperations.isCurrent(operationToken)) return staleOperationResult();
    message = `已保存桌面技能：${skill.manifest.name}`;
    transition('completed');
    resetSoon();
    return { ok: true, status: statusSnapshot(), skill };
  } catch (error) {
    if (!recorderOperations.isCurrent(operationToken)) return staleOperationResult();
    return operationFailure(error);
  } finally {
    recorderOperations.endMutation(operationToken);
  }
};

export const cancelWinkGoDesktopAutomation = async (): Promise<DesktopSkillOperationResult> => {
  invalidateRecorderOperations();
  await callWinkGoRuntimeTool('desktop_automation.cancel', {}, { timeoutMs: 5_000 }).catch((): undefined => undefined);
  clearTerminalReset();
  state.reset();
  target = undefined;
  stepCount = 0;
  filteredEventCount = 0;
  message = '';
  return { ok: true, status: publish() };
};

export const removeWinkGoDesktopSkill = async (skillId: string): Promise<boolean> =>
  getStore().remove(PROFILE_ID, skillId);

export const runWinkGoDesktopSkill = async (request: DesktopSkillRunRequest): Promise<DesktopSkillOperationResult> => {
  try {
    invalidateRecorderOperations();
    clearTerminalReset();
    state.reset();
    const skill = await getStore().load(PROFILE_ID, request.skillId);
    if (!skill) throw new Error('没有找到这个桌面技能。');
    const executionId = `desktop-${randomUUID()}`;
    transition('arming', { sessionId: executionId, targetDisplayIds: [screen.getPrimaryDisplay().id] });
    transition('replaying');
    const runtimePort = new RuntimeDesktopAutomationPort({ callTool: callWinkGoRuntimeTool });
    const runner = new WinkGoDesktopSkillRunner({
      runtimePort,
      recoveryPort: {
        selectCandidate: async ({ failedStep, reason, candidates }) => {
          transition('ai_takeover');
          const candidateId = await selectWinkGoDesktopRepairCandidateWithAi({ failedStep, reason, candidates });
          transition('replaying');
          return candidateId ? { candidateId } : null;
        },
      },
    });
    const execution = await runner.run({
      executionId,
      skill,
      parameters: request.parameters || {},
      source: request.source || 'desktop',
    });
    message =
      execution.status === 'completed'
        ? `桌面技能“${skill.manifest.name}”执行完成。`
        : execution.status === 'failed'
          ? execution.reason
          : '桌面技能已取消。';
    transition(
      execution.status === 'completed' ? 'completed' : execution.status === 'cancelled' ? 'completed' : 'error'
    );
    resetSoon();
    return {
      ok: execution.status === 'completed',
      status: statusSnapshot(),
      skill,
      execution,
      ...(execution.status === 'failed' ? { error: execution.reason } : {}),
    };
  } catch (error) {
    return operationFailure(error);
  }
};

export const disposeWinkGoDesktopAutomation = (): void => {
  invalidateRecorderOperations();
  clearTerminalReset();
  overlay.dispose();
  listeners.clear();
};
