/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DesktopAutomationStatus } from '@/common/types/desktopAutomation';
import {
  resolveAutomationOverlayLayout,
  type AutomationDisplayLike,
  type AutomationRectangle,
} from './automationOverlayBounds';

export interface AutomationBorderWindowOptions {
  displayId: number;
  bounds: AutomationRectangle;
  focusable: false;
  frame: false;
  transparent: true;
  alwaysOnTop: true;
  skipTaskbar: true;
  hasShadow: false;
}

export interface AutomationOverlayWindow {
  isDestroyed(): boolean;
  setBounds(bounds: AutomationRectangle, animate?: boolean): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward: boolean }): void;
  setAlwaysOnTop(flag: boolean, level: 'screen-saver'): void;
  setVisibleOnAllWorkspaces(flag: boolean, options: { visibleOnFullScreen: boolean }): void;
  setContentProtection(enable: boolean): void;
  showInactive(): void;
  destroy(): void;
  sendStatus(status: DesktopAutomationStatus): void;
}

export interface AutomationOverlayManagerDependencies {
  getDisplays(): AutomationDisplayLike[];
  createBorderWindow(options: AutomationBorderWindowOptions): AutomationOverlayWindow;
}

/** Keeps one non-interactive visual border on every controlled display. */
export class AutomationOverlayManager {
  private readonly borderWindows = new Map<number, AutomationOverlayWindow>();
  private readonly borderBounds = new Map<number, AutomationRectangle>();

  constructor(private readonly dependencies: AutomationOverlayManagerDependencies) {}

  sync(status: DesktopAutomationStatus): void {
    if (status.phase === 'idle') {
      this.dispose();
      return;
    }

    const layout = resolveAutomationOverlayLayout({
      displays: this.dependencies.getDisplays(),
      targetDisplayIds: status.targetDisplayIds,
      controlDisplayId: status.targetDisplayIds[0] ?? Number.NaN,
      controlSize: { width: 280, height: 42 },
      topMargin: 12,
    });
    const targetRect = status.targetRect;
    const visualScope = status.visualScope ?? 'target';
    const borders = layout.borders.map((border, index) => {
      if (visualScope === 'display' || index !== 0 || !targetRect || !isUsableRectangle(targetRect)) return border;
      const gutter = 4;
      const displayRight = border.bounds.x + border.bounds.width;
      const displayBottom = border.bounds.y + border.bounds.height;
      const x = Math.max(border.bounds.x, targetRect.x - gutter);
      const y = Math.max(border.bounds.y, targetRect.y - gutter);
      const right = Math.min(displayRight, targetRect.x + targetRect.width + gutter);
      const bottom = Math.min(displayBottom, targetRect.y + targetRect.height + gutter);
      return {
        displayId: border.displayId,
        bounds: { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) },
      };
    });
    const activeDisplayIds = new Set(borders.map((border) => border.displayId));

    for (const [displayId, window] of this.borderWindows) {
      if (!activeDisplayIds.has(displayId) || window.isDestroyed()) {
        if (!window.isDestroyed()) window.destroy();
        this.borderWindows.delete(displayId);
        this.borderBounds.delete(displayId);
      }
    }

    for (const border of borders) {
      let window = this.borderWindows.get(border.displayId);
      if (!window || window.isDestroyed()) {
        window = this.dependencies.createBorderWindow({
          displayId: border.displayId,
          bounds: border.bounds,
          focusable: false,
          frame: false,
          transparent: true,
          alwaysOnTop: true,
          skipTaskbar: true,
          hasShadow: false,
        });
        window.setIgnoreMouseEvents(true, { forward: true });
        window.setAlwaysOnTop(true, 'screen-saver');
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        window.setContentProtection(true);
        this.borderWindows.set(border.displayId, window);
        this.borderBounds.set(border.displayId, { ...border.bounds });
        window.setBounds(border.bounds, false);
        window.showInactive();
      } else {
        const previous = this.borderBounds.get(border.displayId);
        if (
          !previous ||
          previous.x !== border.bounds.x ||
          previous.y !== border.bounds.y ||
          previous.width !== border.bounds.width ||
          previous.height !== border.bounds.height
        ) {
          window.setBounds(border.bounds, false);
          this.borderBounds.set(border.displayId, { ...border.bounds });
        }
      }

      window.sendStatus({
        ...status,
        targetRect: status.targetRect
          ? visualScope === 'display'
            ? {
                x: status.targetRect.x - border.bounds.x,
                y: status.targetRect.y - border.bounds.y,
                width: status.targetRect.width,
                height: status.targetRect.height,
              }
            : { x: 0, y: 0, width: border.bounds.width, height: border.bounds.height }
          : undefined,
        pointer: status.pointer
          ? {
              x: status.pointer.x - border.bounds.x,
              y: status.pointer.y - border.bounds.y,
              pulseId: status.pointer.pulseId,
            }
          : undefined,
      });
    }
  }

  dispose(): void {
    for (const window of this.borderWindows.values()) {
      if (!window.isDestroyed()) window.destroy();
    }
    this.borderWindows.clear();
    this.borderBounds.clear();
  }
}

const isUsableRectangle = (rect: AutomationRectangle): boolean =>
  Number.isFinite(rect.x) &&
  Number.isFinite(rect.y) &&
  Number.isFinite(rect.width) &&
  Number.isFinite(rect.height) &&
  rect.width > 0 &&
  rect.height > 0;
