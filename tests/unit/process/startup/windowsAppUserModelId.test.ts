/**
 * @license
 * Copyright 2026 WINK GO contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { registerWindowsAppUserModelId, WINDOWS_APP_USER_MODEL_ID } from '@/process/startup/windowsAppUserModelId';

const makeApp = (isPackaged: boolean) => ({
  isPackaged,
  setAppUserModelId: vi.fn(),
});

describe('registerWindowsAppUserModelId', () => {
  it('registers the WINK GO installer identity on packaged Windows builds', () => {
    const app = makeApp(true);
    registerWindowsAppUserModelId({ app, platform: 'win32', execPath: 'C:\\Program Files\\WINK GO\\WINK-GO.exe' });
    expect(app.setAppUserModelId).toHaveBeenCalledOnce();
    expect(app.setAppUserModelId).toHaveBeenCalledWith(WINDOWS_APP_USER_MODEL_ID);
  });

  it('uses the Electron executable identity in Windows development builds', () => {
    const app = makeApp(false);
    registerWindowsAppUserModelId({ app, platform: 'win32', execPath: 'C:\\dev\\electron.exe' });
    expect(app.setAppUserModelId).toHaveBeenCalledWith('C:\\dev\\electron.exe');
  });

  it('does not register a Windows identity on other platforms', () => {
    const app = makeApp(true);
    registerWindowsAppUserModelId({ app, platform: 'darwin', execPath: '/Applications/WINK GO.app' });
    expect(app.setAppUserModelId).not.toHaveBeenCalled();
  });

  it('stays aligned with electron-builder.yml so Windows resolves the installed WINK GO icon', () => {
    const ymlPath = path.resolve(__dirname, '../../../../packages/desktop/electron-builder.yml');
    const yml = fs.readFileSync(ymlPath, 'utf8');
    expect(yml.match(/^appId:\s*(\S+)\s*$/m)?.[1]).toBe(WINDOWS_APP_USER_MODEL_ID);
  });
});
