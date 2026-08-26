/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { DesktopAutomationStateMachine } from '@process/services/computer-automation/automationStateMachine';

describe('desktop automation state machine', () => {
  it('starts idle and enters an observable recording session through arming', () => {
    const machine = new DesktopAutomationStateMachine(() => 1_000);

    expect(machine.getSnapshot()).toMatchObject({
      phase: 'idle',
      targetDisplayIds: [],
    });

    machine.transition('arming', {
      sessionId: 'desktop-session-1',
      targetDisplayIds: [17],
    });
    const recording = machine.transition('recording');

    expect(recording).toMatchObject({
      phase: 'recording',
      sessionId: 'desktop-session-1',
      targetDisplayIds: [17],
      startedAt: 1_000,
      updatedAt: 1_000,
    });
  });

  it('rejects starting desktop control without an arming phase', () => {
    const machine = new DesktopAutomationStateMachine();

    expect(() => machine.transition('recording')).toThrow(/idle.*recording/i);
    expect(machine.getSnapshot().phase).toBe('idle');
  });

  it('returns control to the active phase that was paused', () => {
    const machine = new DesktopAutomationStateMachine();

    machine.transition('arming', { sessionId: 'desktop-session-2', targetDisplayIds: [3] });
    machine.transition('replaying');
    machine.transition('ai_takeover');
    machine.transition('paused');

    expect(machine.resume().phase).toBe('ai_takeover');

    machine.transition('awaiting_confirmation');
    expect(machine.resume().phase).toBe('ai_takeover');
  });

  it('keeps completed and error states terminal until reset', () => {
    const machine = new DesktopAutomationStateMachine();

    machine.transition('arming');
    machine.transition('recording');
    machine.transition('completed');
    expect(() => machine.transition('recording')).toThrow(/completed.*recording/i);
    expect(machine.reset().phase).toBe('idle');

    machine.transition('arming');
    machine.transition('replaying');
    machine.transition('error');
    expect(() => machine.transition('replaying')).toThrow(/error.*replaying/i);
    expect(machine.reset().phase).toBe('idle');
  });
});
