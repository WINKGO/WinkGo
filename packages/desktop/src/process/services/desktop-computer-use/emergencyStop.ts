/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export const DESKTOP_COMPUTER_USE_STOP_SHORTCUT = 'Esc' as const;

export interface DesktopComputerUseShortcutPort {
  isRegistered(accelerator: string): boolean;
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface DesktopComputerUseEmergencyStopDependencies {
  shortcut: DesktopComputerUseShortcutPort;
  stop(): Promise<unknown> | unknown;
}

/** Owns the attended-control shortcut without disturbing shortcuts registered by another feature. */
export class DesktopComputerUseEmergencyStop {
  private ownsShortcut = false;

  constructor(private readonly dependencies: DesktopComputerUseEmergencyStopDependencies) {}

  activate(): boolean {
    if (this.ownsShortcut) return true;
    if (this.dependencies.shortcut.isRegistered(DESKTOP_COMPUTER_USE_STOP_SHORTCUT)) return false;
    this.ownsShortcut = this.dependencies.shortcut.register(DESKTOP_COMPUTER_USE_STOP_SHORTCUT, () => {
      void Promise.resolve(this.dependencies.stop()).catch((error) => {
        console.warn('[DesktopComputerUse] Emergency stop failed:', error);
      });
    });
    return this.ownsShortcut;
  }

  dispose(): void {
    if (!this.ownsShortcut) return;
    this.dependencies.shortcut.unregister(DESKTOP_COMPUTER_USE_STOP_SHORTCUT);
    this.ownsShortcut = false;
  }
}
