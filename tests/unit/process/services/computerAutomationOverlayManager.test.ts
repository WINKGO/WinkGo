/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { DesktopAutomationStatus } from '@/common/types/desktopAutomation';
import {
  AutomationOverlayManager,
  type AutomationOverlayWindow,
} from '@process/services/computer-automation/automationOverlayManager';

describe('desktop automation overlay manager', () => {
  it('shows a protected click-through border while active and removes it when idle', () => {
    const setIgnoreMouseEvents = vi.fn();
    const setAlwaysOnTop = vi.fn();
    const setVisibleOnAllWorkspaces = vi.fn();
    const setContentProtection = vi.fn();
    const showInactive = vi.fn();
    const destroy = vi.fn();
    const sendStatus = vi.fn();
    const borderWindow: AutomationOverlayWindow = {
      isDestroyed: () => false,
      setBounds: vi.fn(),
      setIgnoreMouseEvents,
      setAlwaysOnTop,
      setVisibleOnAllWorkspaces,
      setContentProtection,
      showInactive,
      destroy,
      sendStatus,
    };
    const createBorderWindow = vi.fn(() => borderWindow);
    const manager = new AutomationOverlayManager({
      getDisplays: () => [
        {
          id: 31,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          scaleFactor: 1.5,
        },
      ],
      createBorderWindow,
    });
    const recording: DesktopAutomationStatus = {
      phase: 'recording',
      sessionId: 'session-visible-1',
      targetDisplayIds: [31],
      startedAt: 10,
      updatedAt: 12,
    };

    manager.sync(recording);

    expect(createBorderWindow).toHaveBeenCalledWith({
      displayId: 31,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      focusable: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
    });
    expect(setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
    expect(setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(setVisibleOnAllWorkspaces).toHaveBeenCalledWith(true, { visibleOnFullScreen: true });
    expect(setContentProtection).toHaveBeenCalledWith(true);
    expect(showInactive).toHaveBeenCalledOnce();
    expect(sendStatus).toHaveBeenCalledWith(recording);

    manager.sync({ phase: 'idle', targetDisplayIds: [], updatedAt: 20 });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('does not repeatedly resize or show an unchanged full-screen border', () => {
    const borderWindow: AutomationOverlayWindow = {
      isDestroyed: () => false,
      setBounds: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setContentProtection: vi.fn(),
      showInactive: vi.fn(),
      destroy: vi.fn(),
      sendStatus: vi.fn(),
    };
    const manager = new AutomationOverlayManager({
      getDisplays: () => [
        {
          id: 31,
          bounds: { x: 0, y: 0, width: 2560, height: 1440 },
          workArea: { x: 0, y: 0, width: 2560, height: 1400 },
          scaleFactor: 1.5,
        },
      ],
      createBorderWindow: () => borderWindow,
    });
    const recording: DesktopAutomationStatus = {
      phase: 'recording',
      sessionId: 'stable-session',
      targetDisplayIds: [31],
      startedAt: 10,
      updatedAt: 12,
    };

    manager.sync(recording);
    manager.sync({ ...recording, updatedAt: 13 });
    manager.sync({ ...recording, updatedAt: 14 });

    expect(borderWindow.setBounds).toHaveBeenCalledOnce();
    expect(borderWindow.showInactive).toHaveBeenCalledOnce();
  });

  it('frames the controlled window and translates a click marker into overlay-local coordinates', () => {
    const borderWindow: AutomationOverlayWindow = {
      isDestroyed: () => false,
      setBounds: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setContentProtection: vi.fn(),
      showInactive: vi.fn(),
      destroy: vi.fn(),
      sendStatus: vi.fn(),
    };
    const createBorderWindow = vi.fn(() => borderWindow);
    const manager = new AutomationOverlayManager({
      getDisplays: () => [
        {
          id: 31,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          scaleFactor: 1,
        },
      ],
      createBorderWindow,
    });

    manager.sync({
      phase: 'replaying',
      sessionId: 'desktop-cu-click',
      targetDisplayIds: [31],
      visualScope: 'target',
      targetRect: { x: 120, y: 80, width: 900, height: 640 },
      action: { kind: 'click', label: '保存' },
      pointer: { x: 620, y: 420, pulseId: 'click-1' },
      updatedAt: 50,
    });

    expect(createBorderWindow).toHaveBeenCalledWith(
      expect.objectContaining({ bounds: { x: 116, y: 76, width: 908, height: 648 } })
    );
    expect(borderWindow.sendStatus).toHaveBeenCalledWith(
      expect.objectContaining({ pointer: { x: 504, y: 344, pulseId: 'click-1' } })
    );
  });

  it('keeps a Codex-style full-display control border while retaining the precise target and click evidence', () => {
    const borderWindow: AutomationOverlayWindow = {
      isDestroyed: () => false,
      setBounds: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setVisibleOnAllWorkspaces: vi.fn(),
      setContentProtection: vi.fn(),
      showInactive: vi.fn(),
      destroy: vi.fn(),
      sendStatus: vi.fn(),
    };
    const createBorderWindow = vi.fn(() => borderWindow);
    const manager = new AutomationOverlayManager({
      getDisplays: () => [
        {
          id: 31,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          scaleFactor: 1,
        },
      ],
      createBorderWindow,
    });

    manager.sync({
      phase: 'replaying',
      sessionId: 'desktop-cu-full-display',
      targetDisplayIds: [31],
      visualScope: 'display',
      targetRect: { x: 120, y: 80, width: 900, height: 640 },
      action: { kind: 'click', label: '点击保存' },
      pointer: { x: 620, y: 420, pulseId: 'click-full-display' },
      updatedAt: 60,
    });

    expect(createBorderWindow).toHaveBeenCalledWith(
      expect.objectContaining({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
    );
    expect(borderWindow.sendStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        visualScope: 'display',
        targetRect: { x: 120, y: 80, width: 900, height: 640 },
        pointer: { x: 620, y: 420, pulseId: 'click-full-display' },
      })
    );
  });
});
