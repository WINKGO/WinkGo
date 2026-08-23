import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  prepareWinkGoCore,
  resolveLocalCargoTargetDir,
} = require('../../../packages/shared-scripts/src/prepare-winkgo-core');

describe('prepare-winkgo-core local bundle input', () => {
  it('uses an ASCII Cargo target when a Windows project path contains non-ASCII characters', () => {
    const target = resolveLocalCargoTargetDir(
      'D:\\WINK GO AGENT\\共享组件\\桌面主程序源码',
      'win32',
      'x64',
      {},
      'C:\\Users\\builder\\AppData\\Local\\Temp'
    );

    expect(target).toMatch(/^C:\\Users\\builder\\AppData\\Local\\Temp\\winkgo-cargo-target\\[a-f0-9]{12}\\x64$/u);
    expect(target).not.toContain('共享组件');
  });

  it('preserves an explicitly configured Cargo target directory', () => {
    expect(
      resolveLocalCargoTargetDir('D:\\项目', 'win32', 'x64', {
        WINKGO_BACKEND_CARGO_TARGET_DIR: 'C:\\WINKGO-Cache',
      })
    ).toBe('C:\\WINKGO-Cache');
  });

  it('hard fails local bundle input that lacks managed-resources manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'winkgo-local-bundle-'));
    const projectRoot = join(tmp, 'project');
    const localBundle = join(tmp, 'bundle');
    mkdirSync(join(localBundle, 'managed-resources'), { recursive: true });
    writeFileSync(join(localBundle, 'winkgo_core.exe'), '');

    const previous = process.env.WINKGO_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.WINKGO_BACKEND_LOCAL_BUNDLE_DIR = localBundle;
    try {
      expect(() =>
        prepareWinkGoCore({
          projectRoot,
          platform: 'win32',
          arch: 'x64',
          version: 'v0.1.46',
        })
      ).toThrow(/managed-resources\/manifest\.json/);
    } finally {
      if (previous === undefined) delete process.env.WINKGO_BACKEND_LOCAL_BUNDLE_DIR;
      else process.env.WINKGO_BACKEND_LOCAL_BUNDLE_DIR = previous;
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects a noncompliant local Core before attempting to execute it', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'winkgo-local-binary-pdf-gate-'));
    const projectRoot = join(tmp, 'project');
    const previous = {
      actionsRunId: process.env.WINKGO_BACKEND_RUN_ID,
      localBinary: process.env.WINKGO_BACKEND_LOCAL_BINARY,
      localBundle: process.env.WINKGO_BACKEND_LOCAL_BUNDLE_DIR,
      skipLocalBuild: process.env.WINKGO_BACKEND_SKIP_LOCAL_BUILD,
    };
    delete process.env.WINKGO_BACKEND_RUN_ID;
    delete process.env.WINKGO_BACKEND_LOCAL_BUNDLE_DIR;
    process.env.WINKGO_BACKEND_LOCAL_BINARY = process.execPath;
    process.env.WINKGO_BACKEND_SKIP_LOCAL_BUILD = '1';

    try {
      expect(() =>
        prepareWinkGoCore({
          projectRoot,
          platform: process.platform,
          arch: process.arch,
          version: 'v0.1.46',
        })
      ).toThrow(/missing the required original pdf-toolkit markers/);
    } finally {
      for (const [key, value] of Object.entries({
        WINKGO_BACKEND_RUN_ID: previous.actionsRunId,
        WINKGO_BACKEND_LOCAL_BINARY: previous.localBinary,
        WINKGO_BACKEND_LOCAL_BUNDLE_DIR: previous.localBundle,
        WINKGO_BACKEND_SKIP_LOCAL_BUILD: previous.skipLocalBuild,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
