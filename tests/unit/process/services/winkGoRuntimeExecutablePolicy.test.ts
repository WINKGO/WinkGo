/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  resolvePreferredWinkGoRuntimeExecutable,
  resolvePreferredWinkGoRuntimeIdentity,
  shouldRestartWinkGoRuntimeForUpgrade,
} from '@process/services/winkGoRuntimeExecutablePolicy';

const roots: string[] = [];

const createRoot = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), 'winkgo-runtime-policy-'));
  roots.push(root);
  return root;
};

const createExecutable = (directory: string, timestamp: number): string => {
  mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, 'SparkBot-MCP-Hub-v1.1.0.exe');
  writeFileSync(executable, 'runtime');
  const date = new Date(timestamp);
  utimesSync(executable, date, date);
  return executable;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('WINK GO Runtime executable selection', () => {
  it('reports the selected active release identity and its matching log path', () => {
    const localAppData = createRoot();
    const resourcesPath = path.join(localAppData, 'resources');
    const releaseDirectory = path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi', 'release-v173');
    const active = createExecutable(releaseDirectory, 300);

    expect(resolvePreferredWinkGoRuntimeIdentity({ localAppData, resourcesPath })).toMatchObject({
      installed: true,
      executablePath: active,
      logPath: path.join(releaseDirectory, 'logs', 'sparkbot.log'),
      source: 'installed_release',
      legacyFallback: false,
    });
  });

  it('marks legacy fallback explicitly instead of hiding the selected copy', () => {
    const localAppData = createRoot();
    const resourcesPath = path.join(localAppData, 'resources');
    const legacyDirectory = path.join(localAppData, 'Wink Go', 'winkgo-runtime');
    const legacy = createExecutable(legacyDirectory, 100);

    expect(resolvePreferredWinkGoRuntimeIdentity({ localAppData, resourcesPath })).toMatchObject({
      installed: true,
      executablePath: legacy,
      source: 'legacy',
      legacyFallback: true,
    });
  });

  it('returns a stable missing identity when no Runtime executable exists', () => {
    const localAppData = createRoot();
    const resourcesPath = path.join(localAppData, 'resources');

    expect(resolvePreferredWinkGoRuntimeIdentity({ localAppData, resourcesPath })).toEqual({
      installed: false,
      executablePath: '',
      logPath: '',
      source: 'missing',
      legacyFallback: false,
      modifiedAtMs: 0,
    });
  });

  it('prefers the newest active installed release over the legacy runtime directory', () => {
    const localAppData = createRoot();
    const resourcesPath = path.join(localAppData, 'resources');
    const releasesRoot = path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi');
    const legacy = createExecutable(path.join(localAppData, 'Wink Go', 'winkgo-runtime'), 100);
    const active = createExecutable(path.join(releasesRoot, 'release-v173'), 300);
    createExecutable(path.join(releasesRoot, 'release-v172'), 200);

    expect(resolvePreferredWinkGoRuntimeExecutable({ localAppData, resourcesPath })).toBe(active);
    expect(resolvePreferredWinkGoRuntimeExecutable({ localAppData, resourcesPath })).not.toBe(legacy);
  });

  it('prefers a newer packaged Runtime over a stale installed release after upgrade', () => {
    const localAppData = createRoot();
    const resourcesPath = path.join(localAppData, 'resources');
    createExecutable(path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi', 'release-v173'), 100);
    const packaged = createExecutable(path.join(resourcesPath, 'winkgo-runtime'), 300);

    expect(resolvePreferredWinkGoRuntimeIdentity({ localAppData, resourcesPath })).toMatchObject({
      executablePath: packaged,
      source: 'packaged',
    });
  });

  it('ignores atomic backup release directories and falls back to legacy only when needed', () => {
    const localAppData = createRoot();
    const resourcesPath = path.join(localAppData, 'resources');
    const releasesRoot = path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi');
    createExecutable(path.join(releasesRoot, 'release-v173.old-123-1'), 500);
    const legacy = createExecutable(path.join(localAppData, 'Wink Go', 'winkgo-runtime'), 100);

    expect(resolvePreferredWinkGoRuntimeExecutable({ localAppData, resourcesPath })).toBe(legacy);
  });

  it('uses an explicitly trusted E2E runtime root before installed releases', () => {
    const localAppData = createRoot();
    const resourcesPath = path.join(localAppData, 'resources');
    const explicitRoot = path.join(localAppData, 'fresh-bundle');
    const explicit = createExecutable(path.join(explicitRoot, 'SparkBot-MCP-Hub-v1.1.0-release'), 100);
    createExecutable(path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi', 'release-old'), 500);

    expect(
      resolvePreferredWinkGoRuntimeExecutable({ localAppData, resourcesPath, explicitRuntimeRoot: explicitRoot })
    ).toBe(explicit);
  });

  it('prefers the prepared release inside an explicit bundle over a stale root executable', () => {
    const localAppData = createRoot();
    const resourcesPath = path.join(localAppData, 'resources');
    const explicitRoot = path.join(localAppData, 'fresh-bundle');
    createExecutable(explicitRoot, 100);
    const prepared = createExecutable(path.join(explicitRoot, 'SparkBot-MCP-Hub-v1.1.0-release'), 300);

    expect(
      resolvePreferredWinkGoRuntimeExecutable({ localAppData, resourcesPath, explicitRuntimeRoot: explicitRoot })
    ).toBe(prepared);
  });

  it('restarts a running Runtime when the packaged executable is newer than the running build', () => {
    expect(
      shouldRestartWinkGoRuntimeForUpgrade({
        runningBuildAtMs: 100,
        preferredRuntimeModifiedAtMs: 300,
      })
    ).toBe(true);
    expect(
      shouldRestartWinkGoRuntimeForUpgrade({
        runningBuildAtMs: 400,
        preferredRuntimeModifiedAtMs: 300,
      })
    ).toBe(false);
    expect(
      shouldRestartWinkGoRuntimeForUpgrade({
        runningBuildAtMs: 0,
        preferredRuntimeModifiedAtMs: 300,
      })
    ).toBe(false);
  });
});
