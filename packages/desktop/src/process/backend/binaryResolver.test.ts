// Modified from AionUI by WINK GO contributors in 2026.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBinaryPath } from './binaryResolver';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const originalBackendBin = process.env.WINKGO_BACKEND_BIN;
const originalRendererUrl = process.env.ELECTRON_RENDERER_URL;
const originalE2ETest = process.env.WINKGO_E2E_TEST;
const originalDefaultApp = (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp;

function setResourcesPath(resourcesPath: string | undefined): void {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: resourcesPath,
  });
}

function setDefaultApp(defaultApp: boolean | undefined): void {
  Object.defineProperty(process, 'defaultApp', {
    configurable: true,
    value: defaultApp,
  });
}

function dirEntry(name: string, isDirectory = false): ReturnType<typeof readdirSync>[number] {
  return {
    name,
    isDirectory: () => isDirectory,
  } as unknown as ReturnType<typeof readdirSync>[number];
}

describe('resolveBinaryPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WINKGO_BACKEND_BIN;
    delete process.env.ELECTRON_RENDERER_URL;
    delete process.env.WINKGO_E2E_TEST;
    setDefaultApp(undefined);
  });

  afterEach(() => {
    setResourcesPath(originalResourcesPath);
    if (originalBackendBin === undefined) delete process.env.WINKGO_BACKEND_BIN;
    else process.env.WINKGO_BACKEND_BIN = originalBackendBin;
    if (originalRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL;
    else process.env.ELECTRON_RENDERER_URL = originalRendererUrl;
    if (originalE2ETest === undefined) delete process.env.WINKGO_E2E_TEST;
    else process.env.WINKGO_E2E_TEST = originalE2ETest;
    setDefaultApp(originalDefaultApp);
  });

  it('uses an explicit source-built Core only in electron-vite development', () => {
    const configured = 'backend/target/debug/winkgo_core.exe';
    process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173';
    process.env.WINKGO_BACKEND_BIN = configured;
    vi.mocked(existsSync).mockImplementation((path) => path === resolve(configured));

    expect(resolveBinaryPath()).toBe(resolve(configured));
    expect(execSync).not.toHaveBeenCalled();
  });

  it('uses an explicit source-built Core in the isolated E2E runtime', () => {
    const configured = 'backend/target/debug/winkgo_core.exe';
    process.env.WINKGO_E2E_TEST = '1';
    process.env.WINKGO_BACKEND_BIN = configured;
    vi.mocked(existsSync).mockImplementation((path) => path === resolve(configured));

    expect(resolveBinaryPath()).toBe(resolve(configured));
    expect(execSync).not.toHaveBeenCalled();
  });

  it('uses the repository-bundled Core when launching the checkout with electron dot', () => {
    const runtimeKey = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'winkgo_core.exe' : 'winkgo_core';
    const expected = join(process.cwd(), 'resources', 'bundled-winkgo-core', runtimeKey, binaryName);
    setDefaultApp(true);
    vi.mocked(existsSync).mockImplementation((path) => path === expected);

    expect(resolveBinaryPath()).toBe(expected);
    expect(execSync).not.toHaveBeenCalled();
  });

  it('ignores the source-built Core override outside development', () => {
    process.env.WINKGO_BACKEND_BIN = 'backend/target/debug/winkgo_core.exe';
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found on PATH');
    });

    expect(() => resolveBinaryPath()).toThrow('Cannot find "winkgo_core" binary');
  });

  it('attaches bundled path diagnostics when winkgo_core cannot be resolved', () => {
    const resourcesPath = '/app/resources';
    const runtimeKey = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'winkgo_core.exe' : 'winkgo_core';
    const bundledDir = join(resourcesPath, 'bundled-winkgo-core');
    const runtimeDir = join(bundledDir, runtimeKey);
    const checkedBundledPath = join(runtimeDir, binaryName);

    setResourcesPath(resourcesPath);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(readdirSync).mockImplementation((path) => {
      if (path === resourcesPath) return [dirEntry('bundled-winkgo-core', true)];
      if (path === runtimeDir) return [dirEntry('manifest.json')];
      return [] as ReturnType<typeof readdirSync>;
    });
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found on PATH');
    });

    expect(() => resolveBinaryPath()).toThrow('Cannot find "winkgo_core" binary');

    try {
      resolveBinaryPath();
    } catch (error) {
      expect(error).toMatchObject({
        name: 'BackendBinaryResolveError',
        diagnostics: expect.objectContaining({
          resourcesPath,
          runtimeKey,
          binaryName,
          checkedBundledPath,
          bundledDirExists: false,
          runtimeDirExists: false,
          resourcesDirEntries: ['bundled-winkgo-core/'],
          runtimeDirEntries: ['manifest.json'],
          pathLookupCommand: process.platform === 'win32' ? 'where winkgo_core' : 'which winkgo_core',
          pathLookupError: expect.stringContaining('not found on PATH'),
        }),
      });
    }
  });
});
