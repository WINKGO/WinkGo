// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveBinaryPath } from '@/process/backend/binaryResolver';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

const originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
const originalRendererUrl = process.env.ELECTRON_RENDERER_URL;
const originalBackendBin = process.env.WINKGO_BACKEND_BIN;

function setResourcesPath(resourcesPath: string | undefined): void {
  Object.defineProperty(process, 'resourcesPath', {
    configurable: true,
    value: resourcesPath,
  });
}

beforeEach(() => {
  delete process.env.WINKGO_BACKEND_BIN;
  delete process.env.ELECTRON_RENDERER_URL;
});

afterEach(() => {
  vi.clearAllMocks();
  setResourcesPath(originalResourcesPath);
  if (originalRendererUrl === undefined) {
    delete process.env.ELECTRON_RENDERER_URL;
  } else {
    process.env.ELECTRON_RENDERER_URL = originalRendererUrl;
  }
  if (originalBackendBin === undefined) {
    delete process.env.WINKGO_BACKEND_BIN;
  } else {
    process.env.WINKGO_BACKEND_BIN = originalBackendBin;
  }
});

describe('development backend binary resolution', () => {
  it('prefers an explicit source-built Core during electron-vite development', () => {
    const configured = 'backend/target/debug/winkgo_core.exe';
    process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173';
    process.env.WINKGO_BACKEND_BIN = configured;
    vi.mocked(existsSync).mockImplementation((path) => path === resolve(configured));

    expect(resolveBinaryPath()).toBe(resolve(configured));
    expect(execSync).not.toHaveBeenCalled();
  });

  it('ignores the explicit source-built Core outside development', () => {
    delete process.env.ELECTRON_RENDERER_URL;
    process.env.WINKGO_BACKEND_BIN = 'backend/target/debug/winkgo_core.exe';
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found on PATH');
    });

    expect(() => resolveBinaryPath()).toThrow('Cannot find "winkgo_core" binary');
  });

  it('uses the repository-local bundled runtime during electron-vite development', () => {
    const resourcesPath = '/electron/resources';
    const runtimeKey = `${process.platform}-${process.arch}`;
    const binaryName = process.platform === 'win32' ? 'winkgo_core.exe' : 'winkgo_core';
    const developmentBundledPath = join(process.cwd(), 'resources', 'bundled-winkgo-core', runtimeKey, binaryName);

    setResourcesPath(resourcesPath);
    process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173';
    vi.mocked(existsSync).mockImplementation((path) => path === developmentBundledPath);

    expect(resolveBinaryPath()).toBe(developmentBundledPath);
    expect(execSync).not.toHaveBeenCalled();
  });
});
