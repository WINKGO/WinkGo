/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyAutomationOverlayStatus } from '@/renderer/automation-overlay/automationOverlayView';

describe('desktop automation control border', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows only for an active desktop session and exposes the current phase to CSS', () => {
    const root = document.createElement('div');
    const label = document.createElement('span');
    label.dataset.role = 'automation-status-label';
    root.append(label);

    applyAutomationOverlayStatus(root, {
      phase: 'recording',
      sessionId: 'desktop-session-1',
      targetDisplayIds: [4],
      updatedAt: 100,
    });
    expect(root.hidden).toBe(false);
    expect(root.dataset.phase).toBe('recording');
    expect(label.textContent).toBe('正在录制电脑操作');
    expect(root.getAttribute('aria-label')).toBe('正在录制电脑操作');

    applyAutomationOverlayStatus(root, { phase: 'idle', targetDisplayIds: [], updatedAt: 200 });
    expect(root.hidden).toBe(true);
    expect(root.dataset.phase).toBe('idle');
    expect(label.textContent).toBe('');
  });

  it('keeps the user-facing control message stable while the internal AI phase changes', () => {
    const root = document.createElement('div');
    const label = document.createElement('span');
    label.dataset.role = 'automation-status-label';
    root.append(label);

    applyAutomationOverlayStatus(root, {
      phase: 'replaying',
      sessionId: 'desktop-session-2',
      targetDisplayIds: [1],
      updatedAt: 300,
    });
    expect(label.textContent).toBe('WINK GO 正在使用你的电脑');

    applyAutomationOverlayStatus(root, {
      phase: 'ai_takeover',
      sessionId: 'desktop-session-2',
      targetDisplayIds: [1],
      updatedAt: 400,
    });
    expect(label.textContent).toBe('WINK GO 正在使用你的电脑');
  });

  it('keeps the native cursor visible and lets the click halo finish after the next observation arrives', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    const label = document.createElement('span');
    label.dataset.role = 'automation-status-label';
    const action = document.createElement('span');
    action.dataset.role = 'automation-action-label';
    const pointer = document.createElement('span');
    pointer.dataset.role = 'automation-pointer';
    root.append(label, action, pointer);

    applyAutomationOverlayStatus(root, {
      phase: 'replaying',
      sessionId: 'desktop-session-click',
      targetDisplayIds: [1],
      action: { kind: 'click', label: '点击保存' },
      pointer: { x: 214, y: 318, pulseId: 'click-a' },
      updatedAt: 500,
    });

    expect(action.textContent).toBe('点击保存');
    expect(pointer.hidden).toBe(false);
    expect(pointer.style.left).toBe('214px');
    expect(pointer.style.top).toBe('318px');
    expect(pointer.dataset.pulseId).toBe('click-a');
    expect(pointer.dataset.feedbackKind).toBe('native-cursor-halo');
    expect(pointer.dataset.cursorKind).toBeUndefined();
    expect(root.dataset.controlOwner).toBe('ai');

    applyAutomationOverlayStatus(root, {
      phase: 'ai_takeover',
      sessionId: 'desktop-session-click',
      targetDisplayIds: [1],
      action: { kind: 'observe', label: '正在检查结果' },
      updatedAt: 600,
    });
    expect(pointer.hidden).toBe(false);

    vi.advanceTimersByTime(719);
    expect(pointer.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(pointer.hidden).toBe(true);
  });

  it('decorates the native cursor without rendering a second oversized pointer', () => {
    const html = readFileSync(
      resolve('packages/desktop/src/renderer/automation-overlay/automation-overlay.html'),
      'utf8'
    );
    const css = readFileSync(resolve('packages/desktop/src/renderer/automation-overlay/styles.css'), 'utf8');
    const document = new DOMParser().parseFromString(html, 'text/html');
    const pointer = document.querySelector<HTMLElement>('[data-role="automation-pointer"]');

    expect(pointer).not.toBeNull();
    expect(pointer?.querySelector('.control-pointer__cursor')).toBeNull();
    expect(pointer?.querySelector('.control-pointer__halo')).not.toBeNull();
    expect(pointer?.querySelector('.control-pointer__ripple')).not.toBeNull();
    expect(css).toMatch(/\.control-pointer\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;/s);
  });

  it('tracks ordinary native cursor movement without falsely playing a click pulse', () => {
    const root = document.createElement('div');
    const pointer = document.createElement('span');
    pointer.dataset.role = 'automation-pointer';
    root.append(pointer);

    applyAutomationOverlayStatus(root, {
      phase: 'ai_takeover',
      sessionId: 'desktop-session-moving',
      targetDisplayIds: [1],
      pointer: { x: 480, y: 260 },
      updatedAt: 550,
    });

    expect(pointer.hidden).toBe(false);
    expect(pointer.style.left).toBe('480px');
    expect(pointer.style.top).toBe('260px');
    expect(pointer.classList.contains('control-pointer--pulse')).toBe(false);
  });

  it('switches the visible control state to the user when desktop control is paused', () => {
    const root = document.createElement('div');
    const label = document.createElement('span');
    label.dataset.role = 'automation-status-label';
    root.append(label);

    applyAutomationOverlayStatus(root, {
      phase: 'paused',
      sessionId: 'desktop-session-user',
      targetDisplayIds: [1],
      message: '用户已接管 · AI 已暂停',
      updatedAt: 700,
    });

    expect(root.dataset.controlOwner).toBe('user');
    expect(label.textContent).toBe('用户已接管 · AI 已暂停');
    expect(root.getAttribute('aria-label')).toBe('用户已接管 · AI 已暂停');
  });
});
