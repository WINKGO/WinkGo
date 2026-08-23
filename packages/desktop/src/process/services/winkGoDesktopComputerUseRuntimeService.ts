/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, screen } from 'electron';
import type { DesktopAutomationStatus } from '@/common/types/desktopAutomation';
import type {
  DesktopComputerUseAction,
  DesktopComputerUseRunRequest,
  DesktopComputerUseRunResult,
  DesktopComputerUseStatus,
  DesktopComputerUseTarget,
} from '@/common/types/computerUse';
import { callWinkGoRuntimeTool } from './WinkGoXiaozhiService';
import { AutomationOverlayManager } from './computer-automation/automationOverlayManager';
import { createElectronAutomationOverlayWindowFactory } from './computer-automation/automationOverlayElectron';
import { DesktopControlPointerPump } from './desktop-computer-use/desktopControlPointerPump';
import { createDesktopComputerUseRuntimePorts, DesktopComputerUseController } from './winkGoDesktopComputerUseService';
import {
  planWinkGoDesktopComputerUseStep,
  resolveWinkGoComputerUseModelForConversation,
} from './winkGoDesktopComputerUseAiService';

const overlay = new AutomationOverlayManager({
  getDisplays: () =>
    screen.getAllDisplays().map(({ id, bounds, workArea, scaleFactor }) => ({ id, bounds, workArea, scaleFactor })),
  createBorderWindow: createElectronAutomationOverlayWindowFactory(),
});

const controlPresenceListeners = new Set<(active: boolean) => void>();
let controlPresenceActive = false;
const setControlPresence = (active: boolean): void => {
  if (controlPresenceActive === active) return;
  controlPresenceActive = active;
  for (const listener of controlPresenceListeners) listener(active);
};
const publishOverlayStatus = (status: DesktopAutomationStatus): void => {
  setControlPresence(['arming', 'recording', 'replaying', 'ai_takeover'].includes(status.phase));
  overlay.sync(status);
};
const pointerFeedback = new DesktopControlPointerPump({
  getCursor: () => screen.getCursorScreenPoint(),
  publish: publishOverlayStatus,
});

const ports = createDesktopComputerUseRuntimePorts({
  callTool: callWinkGoRuntimeTool,
  plan: planWinkGoDesktopComputerUseStep,
});
const controller = new DesktopComputerUseController(ports);
let terminalOverlayReset: NodeJS.Timeout | undefined;
let agentOverlayReset: NodeJS.Timeout | undefined;
const agentTargets = new Map<string, DesktopComputerUseTarget>();

const clearAgentOverlayReset = (): void => {
  if (agentOverlayReset) clearTimeout(agentOverlayReset);
  agentOverlayReset = undefined;
};

const scheduleAgentOverlayReset = (delayMs = 8_000): void => {
  clearAgentOverlayReset();
  agentOverlayReset = setTimeout(() => {
    pointerFeedback.dispose();
    setControlPresence(false);
    overlay.dispose();
  }, delayMs);
  agentOverlayReset.unref?.();
};

const safeActionLabel = (action?: DesktopComputerUseAction, fallback?: string): string | undefined => {
  if (!action) return fallback;
  if (action.kind === 'type') return '正在安全输入文字';
  const label = action.label?.trim();
  return label ? label.slice(0, 80) : fallback;
};

const showAgentOverlay = (input: {
  sessionId: string;
  phase: DesktopAutomationStatus['phase'];
  target?: DesktopComputerUseTarget;
  action?: DesktopComputerUseAction;
  actionKind?: NonNullable<DesktopAutomationStatus['action']>['kind'];
  label?: string;
  message?: string;
}): void => {
  if (!app.isReady()) return;
  clearAgentOverlayReset();
  const target = input.target;
  const display = target ? screen.getDisplayMatching(target.rect) : screen.getPrimaryDisplay();
  const actionKind =
    input.action?.kind === 'launch' || input.action?.kind === 'open_file'
      ? 'observe'
      : input.action?.kind || input.actionKind;
  try {
    pointerFeedback.update({
      phase: input.phase,
      sessionId: input.sessionId,
      targetDisplayIds: [display.id],
      visualScope: 'display',
      targetRect: target ? { ...target.rect } : undefined,
      action: actionKind ? { kind: actionKind, label: safeActionLabel(input.action, input.label) } : undefined,
      pointer:
        input.action?.kind === 'click' && Number.isFinite(input.action.x) && Number.isFinite(input.action.y)
          ? {
              x: Number(input.action.x),
              y: Number(input.action.y),
              pulseId: `${input.sessionId}:${Date.now()}`,
            }
          : undefined,
      message: input.message,
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.warn('[DesktopComputerUse] Agent Control Border update failed:', error);
  }
};

const overlayStatus = (status: DesktopComputerUseStatus): DesktopAutomationStatus => {
  const targetDisplayIds = status.target
    ? [screen.getDisplayMatching(status.target.rect).id]
    : [screen.getPrimaryDisplay().id];
  const phase: DesktopAutomationStatus['phase'] =
    status.phase === 'idle'
      ? 'idle'
      : status.phase === 'starting'
        ? 'arming'
        : status.phase === 'awaiting_confirmation'
          ? 'awaiting_confirmation'
          : status.phase === 'acting'
            ? 'replaying'
            : status.phase === 'completed'
              ? 'completed'
              : status.phase === 'failed' || status.phase === 'blocked' || status.phase === 'cancelled'
                ? 'error'
                : 'ai_takeover';
  return {
    phase,
    sessionId: status.sessionId,
    targetDisplayIds,
    visualScope: 'display',
    targetRect: status.target ? { ...status.target.rect } : undefined,
    action: status.action
      ? {
          kind: status.action.kind === 'launch' || status.action.kind === 'open_file' ? 'observe' : status.action.kind,
          label: safeActionLabel(status.action, status.message),
        }
      : undefined,
    pointer:
      status.action?.kind === 'click' && Number.isFinite(status.action.x) && Number.isFinite(status.action.y)
        ? {
            x: Number(status.action.x),
            y: Number(status.action.y),
            pulseId: `${status.sessionId || 'desktop'}:${status.updatedAt}`,
          }
        : undefined,
    message: status.message,
    updatedAt: status.updatedAt,
  };
};

controller.onStatus((status) => {
  if (!app.isReady()) return;
  if (!['completed', 'failed', 'blocked', 'cancelled'].includes(status.phase) && terminalOverlayReset) {
    clearTimeout(terminalOverlayReset);
    terminalOverlayReset = undefined;
  }
  try {
    pointerFeedback.update(overlayStatus(status));
  } catch (error) {
    console.warn('[DesktopComputerUse] Control Border update failed:', error);
  }
  if (['completed', 'failed', 'blocked', 'cancelled'].includes(status.phase)) {
    if (terminalOverlayReset) clearTimeout(terminalOverlayReset);
    terminalOverlayReset = setTimeout(() => {
      pointerFeedback.dispose();
      setControlPresence(false);
      overlay.dispose();
    }, 1_400);
    terminalOverlayReset.unref?.();
  }
});

export const getWinkGoDesktopComputerUseStatus = (): DesktopComputerUseStatus => controller.getStatus();
export const onWinkGoDesktopComputerUseStatus = (listener: (status: DesktopComputerUseStatus) => void): (() => void) =>
  controller.onStatus(listener);
export const onWinkGoDesktopControlPresence = (listener: (active: boolean) => void): (() => void) => {
  controlPresenceListeners.add(listener);
  listener(controlPresenceActive);
  return () => controlPresenceListeners.delete(listener);
};
export const runWinkGoDesktopComputerUse = (
  request: DesktopComputerUseRunRequest
): Promise<DesktopComputerUseRunResult> => controller.run(request);
export const runWinkGoDesktopComputerUseForAgent = async (request: {
  goal: string;
  maxSteps?: number;
  conversationId?: string;
}): Promise<DesktopComputerUseRunResult> => {
  const model = await resolveWinkGoComputerUseModelForConversation(request.conversationId || '');
  if (!model) {
    return {
      ok: false,
      status: {
        phase: 'failed',
        goal: request.goal.trim(),
        stepCount: 0,
        message: '没有可用于桌面 Computer Use 的本地视觉模型，请先在模型设置中配置并启用一个模型。',
        updatedAt: Date.now(),
      },
    };
  }
  return controller.run({
    goal: request.goal,
    model,
    maxSteps: Math.max(1, Math.min(12, Math.trunc(request.maxSteps || 10))),
  });
};

/** Lets the current Agent model inspect the desktop without invoking a second, separately configured model. */
export const observeWinkGoDesktopForAgent = async (request: {
  sessionId: string;
  conversationId?: string;
  target?: Pick<DesktopComputerUseTarget, 'hwnd' | 'pid'>;
}): Promise<unknown> => {
  const previousTarget = agentTargets.get(request.sessionId);
  showAgentOverlay({
    sessionId: request.sessionId,
    phase: 'ai_takeover',
    target: previousTarget,
    actionKind: 'observe',
    label: '正在观察桌面',
  });
  try {
    const observation = await ports.observe({ sessionId: request.sessionId, target: request.target });
    agentTargets.set(request.sessionId, observation.target);
    showAgentOverlay({
      sessionId: request.sessionId,
      phase: 'ai_takeover',
      target: observation.target,
      actionKind: 'observe',
      label: '正在分析当前窗口',
    });
    scheduleAgentOverlayReset();
    return { ok: true, observation };
  } catch (error) {
    showAgentOverlay({
      sessionId: request.sessionId,
      phase: 'error',
      target: previousTarget,
      actionKind: 'observe',
      label: '桌面观察失败',
    });
    scheduleAgentOverlayReset(1_400);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/** Safely launches one named Windows application, then binds Computer Use to its verified window. */
export const launchWinkGoDesktopApplicationForAgent = async (request: {
  sessionId: string;
  conversationId?: string;
  appName: string;
}): Promise<unknown> => {
  const appName = request.appName.trim();
  if (!appName || appName.length > 80 || /[\\/:"'`;&|<>\r\n]/u.test(appName)) {
    return { ok: false, message: '应用名称不合法，请只提供简短的应用名称。' };
  }
  try {
    showAgentOverlay({
      sessionId: request.sessionId,
      phase: 'arming',
      actionKind: 'observe',
      label: `正在启动 ${appName}`,
    });
    const observation = await ports.launch({ sessionId: request.sessionId, appName });
    agentTargets.set(request.sessionId, observation.target);
    showAgentOverlay({
      sessionId: request.sessionId,
      phase: 'ai_takeover',
      target: observation.target,
      actionKind: 'observe',
      label: `已连接 ${appName}`,
    });
    scheduleAgentOverlayReset();
    return { ok: true, observation };
  } catch (error) {
    showAgentOverlay({
      sessionId: request.sessionId,
      phase: 'error',
      actionKind: 'observe',
      label: `${appName} 启动失败`,
    });
    scheduleAgentOverlayReset(1_400);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/** Executes exactly one bounded Agent-selected action, then observes whichever safe window is now foreground. */
export const actWinkGoDesktopForAgent = async (request: {
  sessionId: string;
  conversationId?: string;
  target: Pick<DesktopComputerUseTarget, 'hwnd' | 'pid'>;
  action: DesktopComputerUseAction;
  confirmed: boolean;
}): Promise<unknown> => {
  const previousTarget = agentTargets.get(request.sessionId);
  showAgentOverlay({
    sessionId: request.sessionId,
    phase: 'replaying',
    target:
      previousTarget?.hwnd === request.target.hwnd && previousTarget.pid === request.target.pid
        ? previousTarget
        : undefined,
    action: request.action,
    label: '正在执行桌面操作',
  });
  try {
    await ports.act({
      sessionId: request.sessionId,
      target: request.target,
      action: request.action,
      confirmed: request.confirmed,
    });
    // A launch/global hotkey can replace the foreground window. Rebind from a
    // fresh observation instead of pinning the previous HWND/PID forever.
    await new Promise((resolve) => setTimeout(resolve, 180));
    const observation = await ports.observe({ sessionId: request.sessionId });
    agentTargets.set(request.sessionId, observation.target);
    showAgentOverlay({
      sessionId: request.sessionId,
      phase: 'ai_takeover',
      target: observation.target,
      actionKind: 'observe',
      label: '正在检查执行结果',
    });
    scheduleAgentOverlayReset();
    return { ok: true, observation };
  } catch (error) {
    showAgentOverlay({
      sessionId: request.sessionId,
      phase: 'error',
      target: previousTarget,
      action: request.action,
      label: '桌面操作失败',
    });
    scheduleAgentOverlayReset(1_400);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

/** Bounded wait for UI transitions, followed by fresh visual/structured evidence. */
export const waitWinkGoDesktopForAgent = async (request: {
  sessionId: string;
  conversationId?: string;
  milliseconds: number;
}): Promise<unknown> => {
  const previousTarget = agentTargets.get(request.sessionId);
  showAgentOverlay({
    sessionId: request.sessionId,
    phase: 'replaying',
    target: previousTarget,
    actionKind: 'wait',
    label: '正在等待界面响应',
  });
  try {
    const milliseconds = Math.max(100, Math.min(5_000, Math.trunc(request.milliseconds)));
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    const observation = await ports.observe({ sessionId: request.sessionId });
    agentTargets.set(request.sessionId, observation.target);
    showAgentOverlay({
      sessionId: request.sessionId,
      phase: 'ai_takeover',
      target: observation.target,
      actionKind: 'observe',
      label: '正在检查界面变化',
    });
    scheduleAgentOverlayReset();
    return { ok: true, observation };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

export const cancelWinkGoDesktopForAgent = async (request: {
  sessionId: string;
  conversationId?: string;
}): Promise<unknown> => {
  try {
    await ports.cancel({ sessionId: request.sessionId });
    const target = agentTargets.get(request.sessionId);
    agentTargets.delete(request.sessionId);
    showAgentOverlay({
      sessionId: request.sessionId,
      phase: 'error',
      target,
      label: '桌面控制已停止',
    });
    scheduleAgentOverlayReset(900);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};
export const cancelWinkGoDesktopComputerUse = (): Promise<DesktopComputerUseStatus> => controller.cancel();
/** Gives the attended user priority over every active Desktop Computer Use entry point. */
export const stopAllWinkGoDesktopComputerUseForUser = async (): Promise<void> => {
  if (terminalOverlayReset) clearTimeout(terminalOverlayReset);
  terminalOverlayReset = undefined;
  clearAgentOverlayReset();
  const controllerStatus = controller.getStatus();
  const controllerWasActive = ['starting', 'observing', 'planning', 'acting', 'awaiting_confirmation'].includes(
    controllerStatus.phase
  );
  const agentTarget = agentTargets.values().next().value as DesktopComputerUseTarget | undefined;
  await controller.cancel();
  // controller.cancel() publishes a terminal state and schedules the normal
  // short overlay reset.  A human takeover owns the overlay for longer, so
  // discard that newly scheduled reset before showing the takeover state.
  if (terminalOverlayReset) clearTimeout(terminalOverlayReset);
  terminalOverlayReset = undefined;
  if (!controllerWasActive && agentTargets.size > 0) {
    await ports.cancel({ sessionId: 'winkgo-user-emergency-stop' }).catch((): undefined => undefined);
  }
  agentTargets.clear();
  showAgentOverlay({
    sessionId: controllerStatus.sessionId || 'winkgo-user-emergency-stop',
    phase: 'paused',
    target: controllerStatus.target || agentTarget,
    message: '用户已接管 · AI 已暂停',
  });
  scheduleAgentOverlayReset(2_400);
};
export const disposeWinkGoDesktopComputerUse = (): void => {
  if (terminalOverlayReset) clearTimeout(terminalOverlayReset);
  terminalOverlayReset = undefined;
  clearAgentOverlayReset();
  agentTargets.clear();
  pointerFeedback.dispose();
  setControlPresence(false);
  controlPresenceListeners.clear();
  overlay.dispose();
};
