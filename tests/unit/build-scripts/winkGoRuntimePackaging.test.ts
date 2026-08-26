/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('WINK GO customer Runtime packaging', () => {
  it('ships the prepared Runtime at the exact path used by the desktop resolver', () => {
    const builderConfig = readFileSync('packages/desktop/electron-builder.yml', 'utf8');

    expect(builderConfig).toMatch(/- from: resources\/winkgo-runtime\s+to: winkgo-runtime/);
  });

  it('stages only files sealed by the Runtime integrity manifest', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'winkgo-runtime-package-'));
    try {
      const sourceRoot = join(temporaryRoot, 'source');
      const destinationRoot = join(temporaryRoot, 'destination');
      const executable = Buffer.from('trusted-runtime');
      const skill = Buffer.from('{"name":"windows"}');
      mkdirSync(join(sourceRoot, 'skills', 'windows'), { recursive: true });
      mkdirSync(join(sourceRoot, 'logs'), { recursive: true });
      mkdirSync(join(destinationRoot, 'skills', 'codex'), { recursive: true });
      writeFileSync(join(sourceRoot, 'SparkBot-MCP-Hub-v1.1.0.exe'), executable);
      writeFileSync(join(sourceRoot, 'skills', 'windows', 'manifest.json'), skill);
      writeFileSync(join(sourceRoot, 'logs', 'customer-debug.log'), 'must-not-ship');
      writeFileSync(join(destinationRoot, 'skills', 'codex', 'manifest.json'), '{"id":"codex"}');
      writeFileSync(
        join(sourceRoot, 'winkgo-runtime-integrity.json'),
        JSON.stringify({
          version: 1,
          files: [
            {
              path: 'SparkBot-MCP-Hub-v1.1.0.exe',
              size: executable.length,
              sha256: createHash('sha256').update(executable).digest('hex'),
            },
            {
              path: 'skills/windows/manifest.json',
              size: skill.length,
              sha256: createHash('sha256').update(skill).digest('hex'),
            },
          ],
        })
      );

      const { prepareWinkGoRuntimePackage } = require('../../../scripts/prepare-winkgo-runtime-package.cjs') as {
        prepareWinkGoRuntimePackage(input: { sourceRoot: string; destinationRoot: string }): {
          copiedFiles: number;
        };
      };
      const result = prepareWinkGoRuntimePackage({ sourceRoot, destinationRoot });

      expect(result.copiedFiles).toBe(2);
      expect(readFileSync(join(destinationRoot, 'SparkBot-MCP-Hub-v1.1.0.exe'))).toEqual(executable);
      expect(readFileSync(join(destinationRoot, 'skills', 'windows', 'manifest.json'))).toEqual(skill);
      expect(existsSync(join(destinationRoot, 'winkgo-runtime-integrity.json'))).toBe(true);
      expect(existsSync(join(destinationRoot, 'logs', 'customer-debug.log'))).toBe(false);
      expect(existsSync(join(destinationRoot, 'skills', 'codex', 'manifest.json'))).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('prepares the Runtime before electron-builder creates the customer installer', () => {
    const buildScript = readFileSync('scripts/build-with-builder.js', 'utf8');
    const prepareIndex = buildScript.indexOf('prepare-winkgo-runtime-package.cjs');
    const builderIndex = buildScript.indexOf('const builderCommand = `bunx electron-builder --config');

    expect(prepareIndex).toBeGreaterThan(0);
    expect(builderIndex).toBeGreaterThan(prepareIndex);
  });

  it('allows a missing private Runtime only in the explicit pull-request build test', () => {
    const buildScript = readFileSync('scripts/build-with-builder.js', 'utf8');
    const prWorkflow = readFileSync('.github/workflows/pr-checks.yml', 'utf8');
    const releaseWorkflow = readFileSync('.github/workflows/build-and-release.yml', 'utf8');

    expect(buildScript).toContain("process.env.GITHUB_EVENT_NAME === 'pull_request'");
    expect(buildScript).toContain("process.env.WINKGO_BUILD_TEST_ALLOW_MISSING_RUNTIME === '1'");
    expect(prWorkflow).toContain("WINKGO_BUILD_TEST_ALLOW_MISSING_RUNTIME: '1'");
    expect(releaseWorkflow).not.toContain('WINKGO_BUILD_TEST_ALLOW_MISSING_RUNTIME');
  });

  it('rejects unsealed files from the final packaged Runtime', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'winkgo-runtime-package-extras-'));
    try {
      const runtimeRoot = join(temporaryRoot, 'runtime');
      const executable = Buffer.from('trusted-runtime');
      mkdirSync(join(runtimeRoot, 'skills', 'codex'), { recursive: true });
      writeFileSync(join(runtimeRoot, 'SparkBot-MCP-Hub-v1.1.0.exe'), executable);
      writeFileSync(join(runtimeRoot, 'skills', 'codex', 'manifest.json'), '{"id":"codex"}');
      writeFileSync(
        join(runtimeRoot, 'winkgo-runtime-integrity.json'),
        JSON.stringify({
          version: 1,
          files: [
            {
              path: 'SparkBot-MCP-Hub-v1.1.0.exe',
              size: executable.length,
              sha256: createHash('sha256').update(executable).digest('hex'),
            },
          ],
        })
      );

      const { readAndValidateIntegrity } = require('../../../scripts/prepare-winkgo-runtime-package.cjs') as {
        readAndValidateIntegrity(root: string): unknown;
      };

      expect(() => readAndValidateIntegrity(runtimeRoot)).toThrow(
        'Runtime package contains unsealed file(s): skills/codex/manifest.json'
      );
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('refuses a Windows installer whose unpacked payload is missing or corrupt', () => {
    const buildScript = readFileSync('scripts/build-with-builder.js', 'utf8');

    expect(buildScript).toContain('verifyPackagedWinkGoRuntime(packedWindowsExecutable)');
  });
});
