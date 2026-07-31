// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { installQuitCleanup } from '@/process/startup/quitCleanup';

type BeforeQuitEvent = {
  preventDefault: () => void;
};

const flushMicrotasks = (): Promise<void> =>
  Array.from({ length: 6 }).reduce<Promise<void>>((chain) => chain.then(() => {}), Promise.resolve());

describe('installQuitCleanup', () => {
  it('prevents the first quit until cleanup finishes, then requests quit again', async () => {
    const calls: string[] = [];
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;
    let resolveStopBackend: (() => void) | undefined;

    const quitApp = vi.fn(() => calls.push('quit-app'));
    const hideWindows = vi.fn(() => calls.push('hide-windows'));
    const stopBackend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          calls.push('stop-backend-start');
          resolveStopBackend = resolve;
        })
    );

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp,
      setIsQuitting: (value) => calls.push(`set-quitting:${value}`),
      markExplicitQuit: () => calls.push('mark-explicit-quit'),
      destroyTray: () => calls.push('destroy-tray'),
      hideWindows,
      disposeCronResumeListener: () => calls.push('dispose-cron'),
      stopBackend,
      destroyPetWindow: () => calls.push('destroy-pet'),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    const preventDefault = vi.fn();
    beforeQuitHandler?.({ preventDefault });
    await flushMicrotasks();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(quitApp).not.toHaveBeenCalled();
    expect(calls).toEqual([
      'set-quitting:true',
      'mark-explicit-quit',
      'destroy-tray',
      'hide-windows',
      'dispose-cron',
      'stop-backend-start',
      'destroy-pet',
    ]);
    expect(hideWindows).toHaveBeenCalledTimes(1);

    resolveStopBackend?.();
    await flushMicrotasks();

    expect(quitApp).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      'set-quitting:true',
      'mark-explicit-quit',
      'destroy-tray',
      'hide-windows',
      'dispose-cron',
      'stop-backend-start',
      'destroy-pet',
      'quit-app',
    ]);
  });

  it('allows the second before-quit after cleanup has completed', async () => {
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;
    const quitApp = vi.fn();

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp,
      setIsQuitting: vi.fn(),
      markExplicitQuit: vi.fn(),
      destroyTray: vi.fn(),
      disposeCronResumeListener: vi.fn(),
      stopBackend: async () => {},
      destroyPetWindow: vi.fn(),
      logInfo: vi.fn(),
      logWarn: vi.fn(),
      logError: vi.fn(),
    });

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(quitApp).toHaveBeenCalledTimes(1));

    const preventDefault = vi.fn();
    beforeQuitHandler?.({ preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('continues quitting when backend cleanup exceeds the time limit', async () => {
    vi.useFakeTimers();
    let beforeQuitHandler: ((event: BeforeQuitEvent) => void) | undefined;
    const quitApp = vi.fn();
    const logWarn = vi.fn();

    installQuitCleanup({
      onBeforeQuit: (handler) => {
        beforeQuitHandler = handler;
      },
      quitApp,
      setIsQuitting: vi.fn(),
      markExplicitQuit: vi.fn(),
      destroyTray: vi.fn(),
      hideWindows: vi.fn(),
      disposeCronResumeListener: vi.fn(),
      stopBackend: () => new Promise<void>(() => {}),
      destroyPetWindow: vi.fn(),
      logInfo: vi.fn(),
      logWarn,
      logError: vi.fn(),
      timeoutMs: 250,
    });

    beforeQuitHandler?.({ preventDefault: vi.fn() });
    await vi.advanceTimersByTimeAsync(250);

    expect(logWarn).toHaveBeenCalledWith('[WINK GO] Cleanup timed out after 250ms, forcing quit');
    expect(quitApp).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
