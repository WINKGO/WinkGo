/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type {
  ComputerUseModelRef,
  DesktopComputerUseAction,
  DesktopComputerUseRunRequest,
  DesktopComputerUseRunResult,
  DesktopComputerUseStatus,
  DesktopComputerUseTarget,
} from '@/common/types/computerUse';
import { unwrapRuntimeToolPayload } from './desktop-automation/runtimePort';

export type {
  ComputerUseModelRef,
  DesktopComputerUseAction,
  DesktopComputerUseRunRequest,
  DesktopComputerUseRunResult,
  DesktopComputerUseStatus,
  DesktopComputerUseTarget,
} from '@/common/types/computerUse';

export type DesktopComputerUseObservation = {
  target: DesktopComputerUseTarget;
  screenshotPath: string;
  text: string;
  controls: Array<Record<string, unknown>>;
  ocr: Array<Record<string, unknown>>;
};

export type DesktopComputerUseDecision = {
  status: 'act' | 'done' | 'blocked' | 'failed';
  message: string;
  action?: DesktopComputerUseAction;
};

export type DesktopComputerUsePlanInput = {
  goal: string;
  model: ComputerUseModelRef;
  observation: DesktopComputerUseObservation;
  history: Array<{ action?: DesktopComputerUseAction; ok: boolean; message: string }>;
};

export type DesktopComputerUsePorts = {
  observe: (input: {
    sessionId: string;
    target?: Pick<DesktopComputerUseTarget, 'hwnd' | 'pid'>;
  }) => Promise<DesktopComputerUseObservation>;
  act: (input: {
    sessionId: string;
    target: Pick<DesktopComputerUseTarget, 'hwnd' | 'pid'>;
    action: DesktopComputerUseAction;
    confirmed?: boolean;
  }) => Promise<{ observation: DesktopComputerUseObservation }>;
  launch: (input: { sessionId: string; appName: string }) => Promise<DesktopComputerUseObservation>;
  openPath: (input: { sessionId: string; path: string }) => Promise<DesktopComputerUseObservation>;
  plan: (input: DesktopComputerUsePlanInput) => Promise<DesktopComputerUseDecision>;
  cancel: (input: { sessionId: string }) => Promise<void>;
};

type DesktopRuntimeToolCaller = (
  name: string,
  arguments_: Record<string, unknown>,
  options?: { signal?: AbortSignal; timeoutMs?: number }
) => Promise<unknown>;

const LAUNCH_BIND_ATTEMPTS = 3;
const LAUNCH_BIND_RETRY_MS = 300;
const LAUNCH_OBSERVE_TIMEOUT_MS = 8_000;
const PRELAUNCH_OBSERVE_TIMEOUT_MS = 2_000;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const numberValue = (value: unknown): number => (Number.isFinite(Number(value)) ? Number(value) : 0);
const EXPLICIT_LOCAL_FILE_PATH =
  /[A-Za-z]:\\[^\r\n"'<>|?*]+?\.(?:txt|md|docx|xlsx|pptx|pdf|csv|json|html?)(?=$|[\s，。；：,;:）)])/iu;

const explicitLocalFilePath = (goal: string): string => goal.match(EXPLICIT_LOCAL_FILE_PATH)?.[0]?.trim() || '';

const sameTarget = (
  left: Pick<DesktopComputerUseTarget, 'hwnd' | 'pid'> | undefined,
  right: Pick<DesktopComputerUseTarget, 'hwnd' | 'pid'> | undefined
): boolean => Boolean(left && right && left.hwnd === right.hwnd && left.pid === right.pid);

const compactVisibleText = (value: string): string => value.replace(/\s+/gu, '').toLocaleLowerCase();

const isVerifiedUnsavedTypingGoal = (
  goal: string,
  action: DesktopComputerUseAction,
  observation: DesktopComputerUseObservation
): boolean => {
  if (action.kind !== 'type' || !action.text || !/(?:不要|无需|不必)保存/u.test(goal)) return false;
  const typed = compactVisibleText(action.text);
  return typed.length >= 2 && compactVisibleText(observation.text).includes(typed);
};

const compactIdentity = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/\.exe$/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const matchesLaunchedIdentity = (
  candidate: DesktopComputerUseTarget,
  requestedAppName: string,
  launcherTarget?: DesktopComputerUseTarget
): boolean => {
  if (launcherTarget && sameTarget(candidate, launcherTarget)) return true;
  const candidateTitle = compactIdentity(candidate.title);
  const candidateProcess = compactIdentity(candidate.processName);
  const requested = compactIdentity(requestedAppName);
  const launcherTitle = compactIdentity(launcherTarget?.title || '');
  const launcherProcess = compactIdentity(launcherTarget?.processName || '');
  return Boolean(
    (requested && candidateTitle.includes(requested)) ||
    (launcherTitle && candidateTitle === launcherTitle) ||
    (launcherProcess && candidateProcess === launcherProcess)
  );
};

const parseTarget = (value: unknown): DesktopComputerUseTarget => {
  const raw = asRecord(value);
  const rect = asRecord(raw?.rect);
  const rectTuple = Array.isArray(raw?.rect) ? raw.rect : null;
  const x = rectTuple ? numberValue(rectTuple[0]) : numberValue(rect?.x ?? rect?.left);
  const y = rectTuple ? numberValue(rectTuple[1]) : numberValue(rect?.y ?? rect?.top);
  const width = rectTuple ? numberValue(rectTuple[2]) - x : numberValue(rect?.width) || numberValue(rect?.right) - x;
  const height = rectTuple ? numberValue(rectTuple[3]) - y : numberValue(rect?.height) || numberValue(rect?.bottom) - y;
  const target = {
    hwnd: numberValue(raw?.hwnd),
    pid: numberValue(raw?.pid),
    title: textValue(raw?.title),
    processName: textValue(raw?.process_name ?? raw?.processName),
    rect: { x, y, width, height },
  };
  if (target.hwnd <= 0 || target.pid <= 0 || width <= 0 || height <= 0) {
    throw new Error('桌面 Computer Use 返回了无效目标窗口。');
  }
  return target;
};

const parseObservation = (value: unknown): DesktopComputerUseObservation => {
  const raw = asRecord(value);
  if (!raw || raw.success === false) {
    throw new Error(textValue(raw?.error) || textValue(raw?.error_code) || '桌面观察失败。');
  }
  return {
    target: parseTarget(raw.target),
    screenshotPath: textValue(raw.screenshot_path ?? raw.screenshotPath),
    text: textValue(raw.text),
    controls: Array.isArray(raw.controls)
      ? raw.controls.flatMap((item) => (asRecord(item) ? [asRecord(item)!] : []))
      : [],
    ocr: Array.isArray(raw.ocr) ? raw.ocr.flatMap((item) => (asRecord(item) ? [asRecord(item)!] : [])) : [],
  };
};

export const createDesktopComputerUseRuntimePorts = (dependencies: {
  callTool: DesktopRuntimeToolCaller;
  plan: DesktopComputerUsePorts['plan'];
  sleep?: (milliseconds: number) => Promise<void>;
}): DesktopComputerUsePorts => ({
  observe: async ({ sessionId, target }) => {
    const raw = unwrapRuntimeToolPayload(
      await dependencies.callTool(
        'desktop_automation.observe',
        { session_id: sessionId, hwnd: target?.hwnd || 0, pid: target?.pid || 0 },
        { timeoutMs: 30_000 }
      )
    );
    return parseObservation(raw);
  },
  act: async ({ sessionId, target, action, confirmed }) => {
    const raw = unwrapRuntimeToolPayload(
      await dependencies.callTool(
        'desktop_automation.act',
        { target, action: { ...action, session_id: sessionId }, confirmed: Boolean(confirmed) },
        { timeoutMs: 30_000 }
      )
    );
    if (!raw || raw.success === false) {
      throw new Error(textValue(raw?.error) || textValue(raw?.error_code) || '桌面动作失败。');
    }
    return { observation: parseObservation(raw.observation) };
  },
  launch: async ({ sessionId, appName }) => {
    const normalized = appName.trim();
    if (!normalized || normalized.length > 80 || /[\\/:"'`;&|<>\r\n]/u.test(normalized)) {
      throw new Error('应用名称不合法，请只提供简短的应用名称。');
    }
    const observeRuntime = async (
      target?: Pick<DesktopComputerUseTarget, 'hwnd' | 'pid'>,
      timeoutMs = LAUNCH_OBSERVE_TIMEOUT_MS
    ): Promise<DesktopComputerUseObservation> => {
      const raw = unwrapRuntimeToolPayload(
        await dependencies.callTool(
          'desktop_automation.observe',
          { session_id: sessionId, hwnd: target?.hwnd || 0, pid: target?.pid || 0 },
          { timeoutMs }
        )
      );
      return parseObservation(raw);
    };
    const preexistingObservation = await observeRuntime(undefined, PRELAUNCH_OBSERVE_TIMEOUT_MS).catch(
      (): undefined => undefined
    );
    const launched = unwrapRuntimeToolPayload(
      await dependencies.callTool(
        'windows.open_application',
        { app_name: normalized, force_new_window: true },
        { timeoutMs: 15_000 }
      )
    );
    if (!launched || launched.success === false) {
      throw new Error(textValue(launched?.error) || textValue(launched?.message) || `无法启动 ${normalized}。`);
    }
    const launcherTarget = asRecord(launched.window) ? parseTarget(launched.window) : undefined;
    let reusedExistingWindow = false;
    let lastError: unknown;
    for (let attempt = 0; attempt < LAUNCH_BIND_ATTEMPTS; attempt += 1) {
      const acceptCandidate = (candidate: DesktopComputerUseObservation): boolean => {
        if (!matchesLaunchedIdentity(candidate.target, normalized, launcherTarget)) return false;
        if (sameTarget(preexistingObservation?.target, candidate.target)) {
          reusedExistingWindow = true;
          return false;
        }
        return true;
      };
      try {
        // oxlint-disable-next-line no-await-in-loop -- each retry must observe the newest foreground window
        const candidate = await observeRuntime();
        if (acceptCandidate(candidate)) return candidate;
      } catch (error) {
        lastError = error;
      }
      if (reusedExistingWindow && sameTarget(preexistingObservation?.target, launcherTarget)) break;
      if (launcherTarget) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- launcher HWND verification is ordered after foreground probing
          const candidate = await observeRuntime(launcherTarget);
          if (acceptCandidate(candidate)) return candidate;
        } catch (error) {
          lastError = error;
        }
      }
      if (attempt + 1 < LAUNCH_BIND_ATTEMPTS) {
        // oxlint-disable-next-line no-await-in-loop -- bounded UI startup retries intentionally wait for a fresh window
        await (dependencies.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(
          LAUNCH_BIND_RETRY_MS
        );
      }
    }
    if (reusedExistingWindow) {
      throw new Error(`${normalized} 已经打开，但启动请求只返回了原有窗口。为避免修改错误内容，已停止操作。`);
    }
    throw new Error(
      `${normalized} 已启动，但未能绑定到新窗口。${lastError instanceof Error ? ` ${lastError.message}` : ''}`
    );
  },
  openPath: async ({ sessionId, path }) => {
    const normalized = path.trim();
    if (
      !/^[A-Za-z]:\\.{1,1000}$/u.test(normalized) ||
      normalized.includes('\0') ||
      normalized.includes('\r') ||
      normalized.includes('\n')
    ) {
      throw new Error('文件路径不合法，请提供明确的本机绝对路径。');
    }
    const opened = unwrapRuntimeToolPayload(
      await dependencies.callTool('windows.open_path', { path: normalized }, { timeoutMs: 20_000 })
    );
    if (!opened || opened.success === false) {
      throw new Error(textValue(opened?.error) || textValue(opened?.message) || `无法打开文件 ${normalized}。`);
    }
    const verifiedTarget = parseTarget(opened.window);
    const raw = unwrapRuntimeToolPayload(
      await dependencies.callTool(
        'desktop_automation.observe',
        { session_id: sessionId, hwnd: verifiedTarget.hwnd, pid: verifiedTarget.pid },
        { timeoutMs: 30_000 }
      )
    );
    const observation = parseObservation(raw);
    if (observation.target.hwnd !== verifiedTarget.hwnd || observation.target.pid !== verifiedTarget.pid) {
      throw new Error('文件虽然已打开，但桌面观察绑定到了另一个窗口，已停止以避免误操作。');
    }
    return observation;
  },
  plan: dependencies.plan,
  cancel: async () => {
    await dependencies.callTool('desktop_automation.cancel', {}, { timeoutMs: 5_000 });
  },
});

const idleStatus = (): DesktopComputerUseStatus => ({ phase: 'idle', stepCount: 0, updatedAt: Date.now() });

export class DesktopComputerUseController {
  private status: DesktopComputerUseStatus = idleStatus();
  private activeSessionId: string | null = null;
  private readonly listeners = new Set<(status: DesktopComputerUseStatus) => void>();

  constructor(private readonly ports: DesktopComputerUsePorts) {}

  getStatus(): DesktopComputerUseStatus {
    return {
      ...this.status,
      model: this.status.model ? { ...this.status.model } : undefined,
      target: this.status.target ? { ...this.status.target, rect: { ...this.status.target.rect } } : undefined,
      action: this.status.action
        ? {
            ...this.status.action,
            keys: this.status.action.keys ? [...this.status.action.keys] : undefined,
          }
        : undefined,
    };
  }

  onStatus(listener: (status: DesktopComputerUseStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<DesktopComputerUseStatus>): DesktopComputerUseStatus {
    this.status = { ...this.status, ...patch, updatedAt: Date.now() };
    const snapshot = this.getStatus();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  async run(request: DesktopComputerUseRunRequest): Promise<DesktopComputerUseRunResult> {
    const goal = request.goal.trim();
    if (!goal) return { ok: false, status: this.publish({ phase: 'failed', message: '任务目标不能为空。' }) };
    if (this.activeSessionId) return { ok: false, status: this.getStatus() };
    const sessionId = randomUUID();
    this.activeSessionId = sessionId;
    this.status = {
      sessionId,
      phase: 'starting',
      goal,
      model: { ...request.model },
      stepCount: 0,
      updatedAt: Date.now(),
    };
    this.publish({});
    const history: DesktopComputerUsePlanInput['history'] = [];
    const maxSteps = Math.max(1, Math.min(20, Math.trunc(request.maxSteps || 10)));
    let target: DesktopComputerUseTarget | undefined;
    try {
      const requestedPath = explicitLocalFilePath(goal);
      if (requestedPath) {
        const openAction: DesktopComputerUseAction = {
          kind: 'open_file',
          path: requestedPath,
          label: '打开指定文件',
        };
        this.publish({ phase: 'acting', action: openAction, message: '正在打开并绑定指定文件。' });
        const openedObservation = await this.ports.openPath({ sessionId, path: requestedPath });
        target = openedObservation.target;
        history.push({ action: openAction, ok: true, message: '已绑定指定文件窗口。' });
        this.publish({ target, stepCount: history.length });
      }
      for (let turn = 0; turn < maxSteps; turn += 1) {
        if (this.activeSessionId !== sessionId) return { ok: false, status: this.getStatus() };
        this.publish({ phase: 'observing', action: undefined });
        // oxlint-disable-next-line no-await-in-loop -- every plan must use a fresh screenshot/UIA observation
        const observation = await this.ports.observe({
          sessionId,
          ...(target ? { target: { hwnd: target.hwnd, pid: target.pid } } : {}),
        });
        target = observation.target;
        this.publish({ phase: 'planning', target, action: undefined, stepCount: history.length });
        // oxlint-disable-next-line no-await-in-loop -- Computer Use is a bounded sequential control loop
        const decision = await this.ports.plan({ goal, model: request.model, observation, history: [...history] });
        if (decision.status === 'done') {
          return {
            ok: true,
            status: this.publish({ phase: 'completed', action: undefined, message: decision.message }),
          };
        }
        if (decision.status === 'blocked') {
          return { ok: false, status: this.publish({ phase: 'blocked', message: decision.message }) };
        }
        if (decision.status === 'failed' || !decision.action) {
          return { ok: false, status: this.publish({ phase: 'failed', message: decision.message }) };
        }
        this.publish({ phase: 'acting', action: { ...decision.action }, message: decision.message });
        if (decision.action.kind === 'launch') {
          // oxlint-disable-next-line no-await-in-loop -- launch must finish and produce a verified target before planning continues
          const launchedObservation = await this.ports.launch({
            sessionId,
            appName: decision.action.appName || '',
          });
          target = launchedObservation.target;
        } else if (decision.action.kind === 'open_file') {
          // oxlint-disable-next-line no-await-in-loop -- the verified file window must be bound before visual editing
          const openedObservation = await this.ports.openPath({
            sessionId,
            path: decision.action.path || '',
          });
          target = openedObservation.target;
        } else {
          // oxlint-disable-next-line no-await-in-loop -- action order is visible and must be deterministic
          const acted = await this.ports.act({
            sessionId,
            target: { hwnd: target.hwnd, pid: target.pid },
            action: decision.action,
          });
          if (isVerifiedUnsavedTypingGoal(goal, decision.action, acted.observation)) {
            target = acted.observation.target;
            history.push({ action: decision.action, ok: true, message: decision.message });
            return {
              ok: true,
              status: this.publish({
                phase: 'completed',
                target,
                action: undefined,
                stepCount: history.length,
                message: '已在独立目标窗口中核对输入内容；按要求未保存。',
              }),
            };
          }
        }
        history.push({ action: decision.action, ok: true, message: decision.message });
        this.publish({ stepCount: history.length });
      }
      return { ok: false, status: this.publish({ phase: 'failed', message: '达到最大操作步数，尚未验证完成。' }) };
    } catch (error) {
      return {
        ok: false,
        status: this.publish({ phase: 'failed', message: error instanceof Error ? error.message : String(error) }),
      };
    } finally {
      if (this.activeSessionId === sessionId) this.activeSessionId = null;
    }
  }

  async cancel(): Promise<DesktopComputerUseStatus> {
    const sessionId = this.activeSessionId;
    this.activeSessionId = null;
    if (sessionId) await this.ports.cancel({ sessionId }).catch((): undefined => undefined);
    return this.publish({ phase: 'cancelled', message: '任务已停止。' });
  }
}
