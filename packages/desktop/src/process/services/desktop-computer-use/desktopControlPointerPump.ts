/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DesktopAutomationStatus } from '@/common/types/desktopAutomation';

type CursorPoint = { x: number; y: number };

export interface DesktopControlPointerPumpDependencies {
  getCursor(): CursorPoint;
  publish(status: DesktopAutomationStatus): void;
  intervalMs?: number;
}

const LIVE_POINTER_PHASES = new Set<DesktopAutomationStatus['phase']>([
  'arming',
  'recording',
  'replaying',
  'ai_takeover',
]);

/**
 * Keeps the visual feedback aligned with the real Windows cursor while AI
 * control is active. Explicit action pointers retain their one-shot click
 * pulse; ordinary movement only updates the coloured halo.
 */
export class DesktopControlPointerPump {
  private timer?: ReturnType<typeof setInterval>;
  private current?: DesktopAutomationStatus;
  private lastPoint?: CursorPoint;

  constructor(private readonly dependencies: DesktopControlPointerPumpDependencies) {}

  update(status: DesktopAutomationStatus): void {
    const active = LIVE_POINTER_PHASES.has(status.phase);
    this.current = active ? { ...status, pointer: undefined } : undefined;

    if (!active) {
      this.stopTimer();
      this.dependencies.publish(status);
      return;
    }

    let initial = status;
    if (!status.pointer) {
      const point = this.readCursor();
      if (point) initial = { ...status, pointer: point };
    }
    if (initial.pointer) this.lastPoint = { x: initial.pointer.x, y: initial.pointer.y };
    this.dependencies.publish(initial);
    this.ensureTimer();
  }

  dispose(): void {
    this.current = undefined;
    this.lastPoint = undefined;
    this.stopTimer();
  }

  private ensureTimer(): void {
    if (this.timer) return;
    const intervalMs = Math.max(40, Math.trunc(this.dependencies.intervalMs ?? 70));
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    if (!this.current) return;
    const point = this.readCursor();
    if (!point) return;
    if (this.lastPoint?.x === point.x && this.lastPoint.y === point.y) return;
    this.lastPoint = point;
    this.dependencies.publish({ ...this.current, pointer: point, updatedAt: Date.now() });
  }

  private readCursor(): CursorPoint | undefined {
    try {
      const point = this.dependencies.getCursor();
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
      return { x: point.x, y: point.y };
    } catch {
      return undefined;
    }
  }
}
