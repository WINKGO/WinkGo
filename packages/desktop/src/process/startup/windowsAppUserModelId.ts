/**
 * @license
 * Copyright 2026 WINK GO contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { App } from 'electron';

/**
 * Windows identity stamped onto the installed Start Menu shortcut.
 * Keep this value aligned with electron-builder.yml so native toast
 * notifications resolve the WINK GO application name and icon reliably.
 */
export const WINDOWS_APP_USER_MODEL_ID = 'com.winkgo.desktop';

type AppUserModelIdTarget = Pick<App, 'isPackaged' | 'setAppUserModelId'>;

type RegisterWindowsAppUserModelIdOptions = {
  app: AppUserModelIdTarget;
  platform?: NodeJS.Platform;
  execPath?: string;
};

/**
 * NSIS does not register the running Electron process identity automatically.
 * Register it before app.whenReady() so every local WINK GO notification uses
 * the same identity as the installed shortcut. Development keeps Electron's
 * executable path, matching Electron's notification guidance.
 */
export function registerWindowsAppUserModelId(options: RegisterWindowsAppUserModelIdOptions): void {
  const { app, platform = process.platform, execPath = process.execPath } = options;
  if (platform !== 'win32') return;
  app.setAppUserModelId(app.isPackaged ? WINDOWS_APP_USER_MODEL_ID : execPath);
}
