/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots: string[] = [];
const scriptPath = path.resolve('scripts/audit-winkgo-runtime-skills.cjs');
const executableName = 'SparkBot-MCP-Hub-v1.1.0.exe';

const createRoot = (): string => {
  const root = mkdtempSync(path.join(tmpdir(), 'winkgo-audit-runtime-'));
  roots.push(root);
  return root;
};

const createRuntime = (directory: string, timestamp: number): string => {
  mkdirSync(directory, { recursive: true });
  const executablePath = path.join(directory, executableName);
  writeFileSync(executablePath, 'runtime');
  writeFileSync(path.join(directory, 'config.yaml'), 'plugins: {}');
  const date = new Date(timestamp);
  utimesSync(executablePath, date, date);
  return executablePath;
};

const printRuntime = (localAppData: string): Record<string, unknown> => {
  const result = spawnSync(process.execPath, [scriptPath, '--print-runtime'], {
    cwd: path.dirname(path.dirname(path.dirname(scriptPath))),
    encoding: 'utf8',
    env: { ...process.env, LOCALAPPDATA: localAppData },
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
};

const recoverRuntimeLock = (localAppData: string): Record<string, unknown> => {
  const result = spawnSync(process.execPath, [scriptPath, '--recover-runtime-lock'], {
    cwd: path.dirname(path.dirname(path.dirname(scriptPath))),
    encoding: 'utf8',
    env: { ...process.env, LOCALAPPDATA: localAppData },
  });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('WINK GO Runtime skill audit selection', () => {
  it('audits the newest active installed Runtime instead of a stale legacy copy', () => {
    const localAppData = createRoot();
    const releasesRoot = path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi');
    const active = createRuntime(path.join(releasesRoot, 'release-v173'), 300);
    createRuntime(path.join(releasesRoot, 'release-v172'), 200);
    createRuntime(path.join(localAppData, 'Wink Go', 'winkgo-runtime'), 100);

    expect(printRuntime(localAppData)).toMatchObject({
      executablePath: active,
      runtimeRoot: path.dirname(active),
      source: 'installed_release',
    });
  });

  it('ignores atomic backup releases when diagnosing the Runtime', () => {
    const localAppData = createRoot();
    const releasesRoot = path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi');
    createRuntime(path.join(releasesRoot, 'release-v173.old-123'), 500);
    const legacy = createRuntime(path.join(localAppData, 'Wink Go', 'winkgo-runtime'), 100);

    expect(printRuntime(localAppData)).toMatchObject({
      executablePath: legacy,
      source: 'legacy',
    });
  });

  it('removes a reused-pid lock before starting the selected Runtime', () => {
    const localAppData = createRoot();
    const runtimeDirectory = path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi', 'release-v173');
    createRuntime(runtimeDirectory, 300);
    writeFileSync(path.join(runtimeDirectory, 'runtime.lock'), String(process.pid));

    expect(recoverRuntimeLock(localAppData)).toMatchObject({
      removed: true,
      pid: process.pid,
      reason: 'pid_reused',
    });
  });
});
