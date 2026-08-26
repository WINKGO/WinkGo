/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DesktopAutomationPhase, DesktopAutomationStatus } from '@/common/types/desktopAutomation';

type StatusPatch = Partial<Omit<DesktopAutomationStatus, 'phase' | 'updatedAt'>>;

const copyStatus = (status: DesktopAutomationStatus): DesktopAutomationStatus => ({
  ...status,
  targetDisplayIds: [...status.targetDisplayIds],
});

/** Authoritative lifecycle for one visible desktop automation session. */
export class DesktopAutomationStateMachine {
  private status: DesktopAutomationStatus;
  private resumePhase: Extract<DesktopAutomationPhase, 'recording' | 'replaying' | 'ai_takeover'> | null = null;

  constructor(private readonly now: () => number = Date.now) {
    this.status = {
      phase: 'idle',
      targetDisplayIds: [],
      updatedAt: this.now(),
    };
  }

  getSnapshot(): DesktopAutomationStatus {
    return copyStatus(this.status);
  }

  transition(phase: DesktopAutomationPhase, patch: StatusPatch = {}): DesktopAutomationStatus {
    if (this.status.phase === 'completed' || this.status.phase === 'error') {
      throw new Error(`Invalid desktop automation transition: ${this.status.phase} -> ${phase}`);
    }
    if (this.status.phase === 'idle' && phase !== 'idle' && phase !== 'arming') {
      throw new Error(`Invalid desktop automation transition: ${this.status.phase} -> ${phase}`);
    }
    if (
      (phase === 'paused' || phase === 'awaiting_confirmation') &&
      (this.status.phase === 'recording' || this.status.phase === 'replaying' || this.status.phase === 'ai_takeover')
    ) {
      this.resumePhase = this.status.phase;
    }
    const timestamp = this.now();
    this.status = {
      ...this.status,
      ...patch,
      phase,
      targetDisplayIds: [...(patch.targetDisplayIds ?? this.status.targetDisplayIds)],
      startedAt: phase === 'arming' ? timestamp : (patch.startedAt ?? this.status.startedAt),
      updatedAt: timestamp,
    };
    return this.getSnapshot();
  }

  resume(): DesktopAutomationStatus {
    if (!this.resumePhase || (this.status.phase !== 'paused' && this.status.phase !== 'awaiting_confirmation')) {
      throw new Error(`Desktop automation cannot resume from ${this.status.phase}`);
    }
    return this.transition(this.resumePhase);
  }

  reset(): DesktopAutomationStatus {
    this.resumePhase = null;
    this.status = {
      phase: 'idle',
      targetDisplayIds: [],
      updatedAt: this.now(),
    };
    return this.getSnapshot();
  }
}
