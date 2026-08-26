/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DesktopAutomationStatus } from '@/common/types/desktopAutomation';

const phaseLabels: Record<DesktopAutomationStatus['phase'], string> = {
  idle: '',
  arming: 'WINK GO 正在准备使用你的电脑',
  recording: '正在录制电脑操作',
  replaying: 'WINK GO 正在使用你的电脑',
  ai_takeover: 'WINK GO 正在使用你的电脑',
  paused: '电脑自动化已暂停',
  awaiting_confirmation: '等待确认后继续',
  completed: '电脑自动化已完成',
  error: '电脑自动化出现错误',
};

const actionLabels: Record<NonNullable<DesktopAutomationStatus['action']>['kind'], string> = {
  observe: '正在观察窗口',
  click: '正在点击',
  type: '正在输入',
  press: '正在按键',
  hotkey: '正在使用快捷键',
  scroll: '正在滚动',
  wait: '正在等待界面响应',
};

const CLICK_FEEDBACK_DURATION_MS = 720;
const pointerHideTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

const cancelPointerHide = (pointerElement: HTMLElement): void => {
  const timer = pointerHideTimers.get(pointerElement);
  if (timer) clearTimeout(timer);
  pointerHideTimers.delete(pointerElement);
};

const hidePointerNow = (pointerElement: HTMLElement): void => {
  cancelPointerHide(pointerElement);
  pointerElement.hidden = true;
};

const finishPointerFeedback = (pointerElement: HTMLElement): void => {
  cancelPointerHide(pointerElement);
  const timer = setTimeout(() => {
    pointerElement.hidden = true;
    pointerElement.classList.remove('control-pointer--pulse');
    pointerHideTimers.delete(pointerElement);
  }, CLICK_FEEDBACK_DURATION_MS);
  pointerHideTimers.set(pointerElement, timer);
};

/** Applies the current automation phase to the non-focus-stealing control border. */
export const applyAutomationOverlayStatus = (root: HTMLElement, status: DesktopAutomationStatus): void => {
  const pausedByUser = status.phase === 'paused';
  const label = pausedByUser && status.message?.trim() ? status.message.trim().slice(0, 80) : phaseLabels[status.phase];
  root.dataset.phase = status.phase;
  root.dataset.controlOwner = pausedByUser || status.phase === 'awaiting_confirmation' ? 'user' : 'ai';
  root.hidden = status.phase === 'idle';
  root.setAttribute('aria-hidden', root.hidden ? 'true' : 'false');
  if (label) root.setAttribute('aria-label', label);
  else root.removeAttribute('aria-label');
  const labelElement = root.querySelector<HTMLElement>('[data-role="automation-status-label"]');
  if (labelElement) labelElement.textContent = label;
  const actionElement = root.querySelector<HTMLElement>('[data-role="automation-action-label"]');
  if (actionElement) {
    actionElement.textContent = status.action?.label || (status.action ? actionLabels[status.action.kind] : '');
    actionElement.hidden = !actionElement.textContent;
  }
  const pointerElement = root.querySelector<HTMLElement>('[data-role="automation-pointer"]');
  if (pointerElement) {
    const pointer = status.pointer;
    if (pointer) {
      cancelPointerHide(pointerElement);
      pointerElement.hidden = false;
      delete pointerElement.dataset.cursorKind;
      pointerElement.dataset.feedbackKind = 'native-cursor-halo';
      pointerElement.style.left = `${Math.round(pointer.x)}px`;
      pointerElement.style.top = `${Math.round(pointer.y)}px`;
      if (pointer.pulseId && pointerElement.dataset.pulseId !== pointer.pulseId) {
        pointerElement.dataset.pulseId = pointer.pulseId;
        pointerElement.classList.remove('control-pointer--pulse');
        void pointerElement.offsetWidth;
        pointerElement.classList.add('control-pointer--pulse');
      } else if (!pointer.pulseId) {
        pointerElement.classList.remove('control-pointer--pulse');
      }
    } else if (status.phase === 'idle' || status.phase === 'paused' || status.phase === 'error') {
      hidePointerNow(pointerElement);
    } else if (!pointerElement.hidden) {
      finishPointerFeedback(pointerElement);
    } else {
      hidePointerNow(pointerElement);
    }
  }
};
