/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { DesktopComputerUseEmergencyStop } from '@process/services/desktop-computer-use/emergencyStop';

describe('desktop Computer Use emergency stop', () => {
  it('lets the user stop active desktop control from the global shortcut', async () => {
    let shortcutHandler: (() => void) | undefined;
    const stop = vi.fn().mockResolvedValue(undefined);
    const shortcut = {
      isRegistered: vi.fn().mockReturnValue(false),
      register: vi.fn((_accelerator: string, handler: () => void) => {
        shortcutHandler = handler;
        return true;
      }),
      unregister: vi.fn(),
    };
    const emergencyStop = new DesktopComputerUseEmergencyStop({ shortcut, stop });

    expect(emergencyStop.activate()).toBe(true);
    expect(shortcut.register).toHaveBeenCalledWith('Esc', expect.any(Function));

    shortcutHandler?.();
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());

    emergencyStop.dispose();
    expect(shortcut.unregister).toHaveBeenCalledWith('Esc');
  });

  it('does not unregister a shortcut owned by another feature', () => {
    const shortcut = {
      isRegistered: vi.fn().mockReturnValue(true),
      register: vi.fn(),
      unregister: vi.fn(),
    };
    const emergencyStop = new DesktopComputerUseEmergencyStop({ shortcut, stop: vi.fn() });

    expect(emergencyStop.activate()).toBe(false);
    emergencyStop.dispose();

    expect(shortcut.register).not.toHaveBeenCalled();
    expect(shortcut.unregister).not.toHaveBeenCalled();
  });
});
