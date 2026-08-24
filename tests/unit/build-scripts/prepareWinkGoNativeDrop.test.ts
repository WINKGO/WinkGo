import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { prepareWinkGoNativeDrop } = require('../../../scripts/prepare-winkgo-native-drop.cjs') as {
  prepareWinkGoNativeDrop: (options: Record<string, unknown>) => {
    skipped: boolean;
    outputPath?: string;
    size?: number;
  };
};

describe('prepare-winkgo-native-drop', () => {
  it('copies a verified Cargo DLL to the Node addon packaging path', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'winkgo-native-drop-project-'));
    const targetRoot = mkdtempSync(join(tmpdir(), 'winkgo-native-drop-target-'));
    try {
      const manifestPath = join(projectRoot, 'packages', 'desktop', 'native', 'winkgo-native-drop', 'Cargo.toml');
      mkdirSync(join(manifestPath, '..'), { recursive: true });
      writeFileSync(manifestPath, '[package]\nname = "winkgo-native-drop"\nversion = "0.1.0"\n');

      const result = prepareWinkGoNativeDrop({
        projectRoot,
        platform: 'win32',
        arch: process.arch,
        targetRoot,
        stdio: 'ignore',
        runner: (_command: string, _args: string[], options: { env: Record<string, string> }) => {
          const releaseDir = join(options.env.CARGO_TARGET_DIR, 'release');
          mkdirSync(releaseDir, { recursive: true });
          writeFileSync(join(releaseDir, 'winkgo_native_drop.dll'), Buffer.alloc(2048, 7));
          return { status: 0 };
        },
      });

      expect(result).toMatchObject({ skipped: false, size: 2048 });
      expect(readFileSync(result.outputPath as string)).toEqual(Buffer.alloc(2048, 7));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(targetRoot, { recursive: true, force: true });
    }
  });

  it('fails closed when Cargo does not produce the addon', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'winkgo-native-drop-missing-'));
    const targetRoot = mkdtempSync(join(tmpdir(), 'winkgo-native-drop-target-'));
    try {
      const manifestPath = join(projectRoot, 'packages', 'desktop', 'native', 'winkgo-native-drop', 'Cargo.toml');
      mkdirSync(join(manifestPath, '..'), { recursive: true });
      writeFileSync(manifestPath, '[package]\nname = "winkgo-native-drop"\nversion = "0.1.0"\n');

      expect(() =>
        prepareWinkGoNativeDrop({
          projectRoot,
          platform: 'win32',
          arch: process.arch,
          targetRoot,
          stdio: 'ignore',
          runner: () => ({ status: 0 }),
        })
      ).toThrow('output is missing or incomplete');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(targetRoot, { recursive: true, force: true });
    }
  });

  it('skips native addon preparation outside Windows', () => {
    expect(prepareWinkGoNativeDrop({ platform: 'darwin' })).toEqual({ skipped: true, reason: 'non_windows' });
  });
});
