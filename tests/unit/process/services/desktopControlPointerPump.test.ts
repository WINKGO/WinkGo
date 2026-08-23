/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { DesktopControlPointerPump } from '@process/services/desktop-computer-use/desktopControlPointerPump';

describe('desktop Computer Use live pointer feedback', () => {
  it('publishes the real cursor while control is active and stops polling at the terminal state', () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const getCursor = vi
      .fn()
      .mockReturnValueOnce({ x: 100, y: 120 })
      .mockReturnValueOnce({ x: 140, y: 180 });
    const pump = new DesktopControlPointerPump({ getCursor, publish, intervalMs: 60 });

    pump.update({
      phase: 'ai_takeover',
      sessionId: 'pointer-session',
      targetDisplayIds: [1],
      updatedAt: 1,
    });
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ pointer: { x: 100, y: 120 } }));

    vi.advanceTimersByTime(60);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ pointer: { x: 140, y: 180 } }));

    pump.update({ phase: 'completed', sessionId: 'pointer-session', targetDisplayIds: [1], updatedAt: 2 });
    const callsAtCompletion = publish.mock.calls.length;
    vi.advanceTimersByTime(240);
    expect(publish).toHaveBeenCalledTimes(callsAtCompletion);
    pump.dispose();
    vi.useRealTimers();
  });

  it('preserves one explicit click pulse before following subsequent cursor movement', () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const pump = new DesktopControlPointerPump({
      getCursor: () => ({ x: 300, y: 320 }),
      publish,
      intervalMs: 60,
    });

    pump.update({
      phase: 'replaying',
      sessionId: 'click-session',
      targetDisplayIds: [1],
      pointer: { x: 220, y: 240, pulseId: 'click-1' },
      updatedAt: 1,
    });
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ pointer: { x: 220, y: 240, pulseId: 'click-1' } })
    );

    vi.advanceTimersByTime(60);
    expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ pointer: { x: 300, y: 320 } }));
    pump.dispose();
    vi.useRealTimers();
  });
});
