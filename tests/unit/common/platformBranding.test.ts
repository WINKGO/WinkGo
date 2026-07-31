import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_DISPLAY_NAME,
  configureBrandedAppPaths,
  DEFAULT_WORK_DIR_NAME,
  getAppDisplayName,
  getDevAppName,
  PRO_APP_DISPLAY_NAME,
} from '../../../packages/desktop/src/common/platform';

const temporaryDirectories: string[] = [];
const originalMultiInstance = process.env.WINKGO_MULTI_INSTANCE;
const originalEdition = process.env.WINKGO_EDITION;

afterEach(() => {
  if (originalMultiInstance === undefined) {
    delete process.env.WINKGO_MULTI_INSTANCE;
  } else {
    process.env.WINKGO_MULTI_INSTANCE = originalMultiInstance;
  }
  if (originalEdition === undefined) {
    delete process.env.WINKGO_EDITION;
  } else {
    process.env.WINKGO_EDITION = originalEdition;
  }

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('WINK GO application paths', () => {
  it('uses branded names for normal and multi-instance development modes', () => {
    process.env.WINKGO_EDITION = 'free';
    delete process.env.WINKGO_MULTI_INSTANCE;
    expect(getAppDisplayName()).toBe(APP_DISPLAY_NAME);
    expect(getDevAppName()).toBe('WINK GO-Dev');

    process.env.WINKGO_MULTI_INSTANCE = '1';
    expect(getDevAppName()).toBe('WINK GO-Dev-2');
  });

  it('keeps Pro application data isolated from Free and legacy profiles', () => {
    process.env.WINKGO_EDITION = 'pro';
    delete process.env.WINKGO_MULTI_INSTANCE;
    const appDataRoot = mkdtempSync(path.join(os.tmpdir(), 'wink-go-pro-path-test-'));
    temporaryDirectories.push(appDataRoot);

    const legacyUserData = path.join(appDataRoot, 'WinkGo');
    mkdirSync(legacyUserData, { recursive: true });
    writeFileSync(path.join(legacyUserData, 'auth.json'), 'must-not-migrate');

    const state = {
      appName: '',
      logsPath: '',
      userDataPath: legacyUserData,
    };
    const electronApp = {
      getPath: () => state.userDataPath,
      isPackaged: true,
      setAppLogsPath: (value: string) => {
        state.logsPath = value;
      },
      setName: (value: string) => {
        state.appName = value;
      },
      setPath: (_name: string, value: string) => {
        state.userDataPath = value;
      },
    } as unknown as Parameters<typeof configureBrandedAppPaths>[0];

    const proUserData = configureBrandedAppPaths(electronApp);

    expect(getAppDisplayName()).toBe(PRO_APP_DISPLAY_NAME);
    expect(proUserData).toBe(path.join(appDataRoot, 'WINK GO Pro'));
    expect(state.appName).toBe(PRO_APP_DISPLAY_NAME);
    expect(existsSync(path.join(legacyUserData, 'auth.json'))).toBe(true);
    expect(existsSync(path.join(proUserData, 'auth.json'))).toBe(false);
  });

  it('moves legacy dev data and the default workspace without losing files', () => {
    process.env.WINKGO_EDITION = 'free';
    delete process.env.WINKGO_MULTI_INSTANCE;
    const appDataRoot = mkdtempSync(path.join(os.tmpdir(), 'wink-go-path-test-'));
    temporaryDirectories.push(appDataRoot);

    const legacyUserData = path.join(appDataRoot, 'WinkGo-Dev');
    const legacyWorkspace = path.join(legacyUserData, 'winkgo');
    mkdirSync(legacyWorkspace, { recursive: true });
    writeFileSync(path.join(legacyWorkspace, 'conversation.txt'), 'preserved');

    const state = {
      appName: '',
      logsPath: '',
      userDataPath: path.join(appDataRoot, 'WinkGo'),
    };
    const electronApp = {
      getPath: () => state.userDataPath,
      isPackaged: false,
      setAppLogsPath: (value: string) => {
        state.logsPath = value;
      },
      setName: (value: string) => {
        state.appName = value;
      },
      setPath: (_name: string, value: string) => {
        state.userDataPath = value;
      },
    } as unknown as Parameters<typeof configureBrandedAppPaths>[0];

    const brandedUserData = configureBrandedAppPaths(electronApp);
    const brandedWorkspace = path.join(brandedUserData, DEFAULT_WORK_DIR_NAME);

    expect(brandedUserData).toBe(path.join(appDataRoot, 'WINK GO-Dev'));
    expect(state.appName).toBe(APP_DISPLAY_NAME + '-Dev');
    expect(state.logsPath).toBe(path.join(brandedUserData, 'logs'));
    expect(existsSync(path.join(brandedWorkspace, 'conversation.txt'))).toBe(true);
    expect(existsSync(legacyUserData)).toBe(false);
    expect(existsSync(legacyWorkspace)).toBe(false);
  });
});
