// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');

function restoreOutDirectory(outDir: string, backupOutDir: string, movedExistingOut: boolean): void {
  rmSync(outDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  if (!movedExistingOut) return;

  try {
    renameSync(backupOutDir, outDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EACCES') throw error;

    // Windows scanners and short-lived child processes can retain a directory
    // handle briefly after spawnSync returns. Copying restores the developer's
    // prior output without making the test fail on that transient handle.
    cpSync(backupOutDir, outDir, { recursive: true, force: true });
    rmSync(backupOutDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

function readInstallerErrorDefinitions(): Array<{ defineName: string; code: string }> {
  const source = readFileSync(resolve(repoRoot, 'resources/windows/installer-errors-sentry.nsh'), 'utf8');
  return Array.from(source.matchAll(/!define\s+(WINKGO_E_[A-Z0-9_]+)\s+"(E\d{4})"/g), (match) => ({
    defineName: match[1],
    code: match[2],
  }));
}

function resolveAppBuilderInstallUtil(): string {
  const direct = resolve(repoRoot, 'node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh');
  if (existsSync(direct)) {
    return direct;
  }

  const bunModulesDir = resolve(repoRoot, 'node_modules/.bun');
  const appBuilderDir = readdirSync(bunModulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('app-builder-lib@'))
    .map((entry) => resolve(bunModulesDir, entry.name, 'node_modules/app-builder-lib'))
    .find((candidate) => existsSync(resolve(candidate, 'package.json')));

  if (!appBuilderDir) {
    throw new Error('app-builder-lib installUtil.nsh not found');
  }

  return resolve(appBuilderDir, 'templates/nsis/include/installUtil.nsh');
}

// These tests intentionally exercise the repository-level `out/` directory.
// Keep them serialized so parallel Vitest workers cannot move or restore the
// same directory at the same time on Windows.
describe.sequential('build-with-builder', () => {
  it('rejects skip-vite when renderer output is only a source html shell', { timeout: 300e3 }, () => {
    const outDir = resolve(repoRoot, 'out');
    const backupOutDir = resolve(repoRoot, `.tmp-out-backup-${process.pid}-${Date.now()}`);
    const tempDir = mkdtempSync(join(tmpdir(), 'winkgo-build-skip-vite-test-'));
    const hookPath = join(tempDir, 'hook.cjs');

    writeFileSync(
      hookPath,
      `
const childProcess = require('node:child_process');
childProcess.execSync = function mockedExecSync(command) {
  return Buffer.from('');
};
`,
      'utf8'
    );

    let movedExistingOut = false;
    try {
      if (existsSync(outDir)) {
        renameSync(outDir, backupOutDir);
        movedExistingOut = true;
      }
      mkdirSync(resolve(outDir, 'main'), { recursive: true });
      mkdirSync(resolve(outDir, 'preload'), { recursive: true });
      mkdirSync(resolve(outDir, 'renderer'), { recursive: true });
      writeFileSync(resolve(outDir, 'main/index.js'), 'console.log("main placeholder");\n', 'utf8');
      writeFileSync(resolve(outDir, 'preload/index.js'), 'console.log("preload placeholder");\n', 'utf8');
      writeFileSync(
        resolve(outDir, '.winkgo-vite-build.json'),
        JSON.stringify({ schemaVersion: 1, edition: 'free' }) + '\n',
        'utf8'
      );
      writeFileSync(
        resolve(outDir, 'renderer/index.html'),
        '<!doctype html><html><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>\n',
        'utf8'
      );

      const result = spawnSync(
        process.execPath,
        ['scripts/build-with-builder.js', 'x64', '--skip-vite', '--pack-only', '--edition', 'free'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${hookPath}`].filter(Boolean).join(' '),
          },
        }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('Renderer build output is incomplete');
    } finally {
      restoreOutDirectory(outDir, backupOutDir, movedExistingOut);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('defaults an unqualified build to Free and writes a matching Vite edition marker', { timeout: 300e3 }, () => {
    const outDir = resolve(repoRoot, 'out');
    const backupOutDir = resolve(repoRoot, `.tmp-out-backup-${process.pid}-${Date.now()}-default-free`);
    const tempDir = mkdtempSync(join(tmpdir(), 'winkgo-build-default-free-'));
    const hookPath = join(tempDir, 'hook.cjs');

    writeFileSync(
      hookPath,
      `
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function writeOutput(relativePath, content = '') {
  const target = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

childProcess.execSync = function mockedExecSync(command) {
  if (String(command).includes('electron-vite build')) {
    writeOutput('out/main/index.js');
    writeOutput('out/preload/index.js');
    writeOutput('out/renderer/assets/index-test.js');
    writeOutput('out/renderer/assets/index-test.css');
    writeOutput(
      'out/renderer/index.html',
      '<!doctype html><html><head><script type="module" src="./assets/index-test.js"></script><link rel="stylesheet" href="./assets/index-test.css"></head><body><div id="root"></div></body></html>\\n'
    );
  }
  return Buffer.from('');
};
`,
      'utf8'
    );

    let movedExistingOut = false;
    try {
      if (existsSync(outDir)) {
        renameSync(outDir, backupOutDir);
        movedExistingOut = true;
      }

      const result = spawnSync(process.execPath, ['scripts/build-with-builder.js', 'x64', '--pack-only'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          WINKGO_EDITION: '',
          WINKGO_ALLOW_PRO_DEV_BUILD: '',
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${hookPath}`].filter(Boolean).join(' '),
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain('WINK GO edition: Free');
      expect(JSON.parse(readFileSync(resolve(outDir, '.winkgo-vite-build.json'), 'utf8'))).toMatchObject({
        schemaVersion: 1,
        edition: 'free',
      });
    } finally {
      restoreOutDirectory(outDir, backupOutDir, movedExistingOut);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects skip-vite when the cached Vite output was built for another edition', { timeout: 300e3 }, () => {
    const outDir = resolve(repoRoot, 'out');
    const backupOutDir = resolve(repoRoot, `.tmp-out-backup-${process.pid}-${Date.now()}-edition-mismatch`);
    const tempDir = mkdtempSync(join(tmpdir(), 'winkgo-build-edition-mismatch-'));
    const hookPath = join(tempDir, 'hook.cjs');

    writeFileSync(
      hookPath,
      `
const childProcess = require('node:child_process');
childProcess.execSync = function mockedExecSync() {
  return Buffer.from('');
};
`,
      'utf8'
    );

    let movedExistingOut = false;
    try {
      if (existsSync(outDir)) {
        renameSync(outDir, backupOutDir);
        movedExistingOut = true;
      }
      mkdirSync(resolve(outDir, 'main'), { recursive: true });
      mkdirSync(resolve(outDir, 'preload'), { recursive: true });
      mkdirSync(resolve(outDir, 'renderer/assets'), { recursive: true });
      writeFileSync(resolve(outDir, 'main/index.js'), '', 'utf8');
      writeFileSync(resolve(outDir, 'preload/index.js'), '', 'utf8');
      writeFileSync(resolve(outDir, 'renderer/assets/index-test.js'), '', 'utf8');
      writeFileSync(resolve(outDir, 'renderer/assets/index-test.css'), '', 'utf8');
      writeFileSync(
        resolve(outDir, 'renderer/index.html'),
        '<!doctype html><html><head><script type="module" src="./assets/index-test.js"></script><link rel="stylesheet" href="./assets/index-test.css"></head><body><div id="root"></div></body></html>\n',
        'utf8'
      );
      writeFileSync(
        resolve(outDir, '.winkgo-vite-build.json'),
        JSON.stringify({ schemaVersion: 1, edition: 'pro' }) + '\n',
        'utf8'
      );

      const result = spawnSync(
        process.execPath,
        ['scripts/build-with-builder.js', 'x64', '--skip-vite', '--pack-only', '--edition', 'free'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${hookPath}`].filter(Boolean).join(' '),
          },
        }
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toContain('Refusing --skip-vite');
      expect(result.stderr + result.stdout).toContain('expected "free"');
      expect(result.stderr + result.stdout).toContain('found "pro"');
    } finally {
      restoreOutDirectory(outDir, backupOutDir, movedExistingOut);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects Pro packaging unless the explicit development-only guard is present', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/build-with-builder.js', 'x64', '--pack-only', '--edition', 'pro'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          WINKGO_ALLOW_PRO_DEV_BUILD: '',
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('Pro builds are development-only');
    expect(result.stderr + result.stdout).toContain('--allow-pro-dev');
  });

  it.each(['1', 'true', 'yes'])('rejects Pro packaging in CI when CI=%s', (ciValue) => {
    const result = spawnSync(
      process.execPath,
      ['scripts/build-with-builder.js', 'x64', '--pack-only', '--edition', 'pro', '--allow-pro-dev'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          CI: ciValue,
        },
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('Pro builds are development-only');
    expect(result.stderr + result.stdout).toContain('local development machine');
  });

  it('releases the NSIS output directory before any update repair or uninstall work', () => {
    const script = readFileSync(resolve(repoRoot, 'resources/windows/installer-update-verify.nsh'), 'utf8');
    const preInit = script.match(/!macro WINKGO_INSTALLER_PREINIT([\s\S]*?)!macroend/)?.[1];
    const releaseMacro = script.match(/!macro WINKGO_RELEASE_INSTALL_DIR_OUTDIR([\s\S]*?)!macroend/)?.[1];

    expect(preInit).toBeTruthy();
    expect(releaseMacro).toBeTruthy();
    expect(releaseMacro).toContain('InitPluginsDir');
    expect(releaseMacro).toContain('SetOutPath "$PLUGINSDIR"');
    expect(releaseMacro).not.toContain('SetOutPath $INSTDIR');
    expect(preInit).toContain('!insertmacro WINKGO_RELEASE_INSTALL_DIR_OUTDIR');
    expect(preInit!.indexOf('WINKGO_RELEASE_INSTALL_DIR_OUTDIR')).toBeLessThan(
      preInit!.indexOf('WINKGO_SESSION_BEGIN')
    );
  });

  it('uses install-directory ownership checks in the shared Windows NSIS include', () => {
    const script = readFileSync(resolve(repoRoot, 'resources/windows/installer-process-control.nsh'), 'utf8');

    expect(script).toContain('!macro customCheckAppRunning');
    expect(script).toContain('$$ownedPrefix');
    expect(script).toContain('StartsWith($$ownedPrefix');
    expect(script).toContain('[System.IO.Path]::GetFullPath($$path)');
    expect(script).not.toContain("Name -ieq '${WINKGO_APP_EXECUTABLE_FILENAME}'");
  });

  it('records installer self-lock diagnostics when Restart Manager finds no locking process', () => {
    const script = readFileSync(resolve(repoRoot, 'resources/windows/installer-process-control.nsh'), 'utf8');
    const queryScript = readFileSync(resolve(repoRoot, 'resources/windows/support/query-lockers.ps1'), 'utf8');
    const captureMacro = script.match(/!macro WINKGO_CAPTURE_FAILED_PATH_LOCKERS[\s\S]*?!macroend/)?.[0];

    expect(script).toContain('winkgo-query-lockers.ps1');
    expect(captureMacro).toContain('WINKGO_QUERY_LOCKERS');
    expect(captureMacro).not.toContain('WINKGO_QUERY_LOCKERS_INLINE_LEGACY');
    expect(queryScript).toContain('$CurrentOutDir');
    expect(queryScript).toContain('$script:installerSelfLock');
    expect(queryScript).toContain("'installer-self-lock'");
    expect(queryScript).toContain('outerInstallerPid');
    expect(queryScript).toContain('currentOutDir');
    expect(queryScript).toContain("name = 'WINK GO installer'");
  });

  it('continues with the bundled uninstaller when installed-uninstaller repair remains locked', () => {
    const script = readFileSync(resolve(repoRoot, 'resources/windows/installer-repair-heal.nsh'), 'utf8');
    const messages = readFileSync(resolve(repoRoot, 'resources/windows/installer-messages.nsh'), 'utf8');

    const retryFailureBranch = script.match(
      /\$\{If\} \$\{Errors\}\s+([\s\S]*?)\$\{Else\}\s+!insertmacro WINKGO_LOG_UNINSTALLER_REPAIR "after-copy-retry"/
    )?.[1];

    expect(retryFailureBranch).toBeTruthy();
    expect(retryFailureBranch).toContain('copy-failed-using-bundled');
    expect(retryFailureBranch).toContain('$WinkGoBundledUninstaller');
    expect(retryFailureBranch).not.toContain('MessageBox');
    expect(retryFailureBranch).not.toContain('WINKGO_MSG_UNINSTALLER_LOCKED');
    expect(messages).not.toContain('existing uninstaller is locked');
  });

  it('keeps coded Windows installer failures on the unified reportable failure path', () => {
    const resourcesDir = resolve(repoRoot, 'resources/windows');
    const files = readdirSync(resourcesDir).filter((file) => file.endsWith('.nsh'));

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(resolve(resourcesDir, file), 'utf8');
      source.split(/\r?\n/).forEach((line, index) => {
        if (line.includes('!macro WINKGO_FAIL ')) {
          offenders.push(`${file}:${index + 1}: defines non-reportable coded failure macro`);
        }
        if (line.includes('!insertmacro WINKGO_FAIL ')) {
          offenders.push(`${file}:${index + 1}: uses non-reportable coded failure macro`);
        }
        if (/^\s*Abort\b/.test(line)) {
          offenders.push(`${file}:${index + 1}: aborts without unified failure UI`);
        }
        if (line.includes('SetErrorLevel 2') && file !== 'installer-errors-sentry.nsh') {
          offenders.push(`${file}:${index + 1}: sets failure exit code outside unified failure UI`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('allows raw Windows installer MessageBox calls only for unified reporting or non-terminal prompts', () => {
    const resourcesDir = resolve(repoRoot, 'resources/windows');
    const files = readdirSync(resourcesDir).filter((file) => file.endsWith('.nsh'));

    const allowedMessageBoxes = new Map<string, RegExp[]>([
      ['installer-errors-sentry.nsh', [/MessageBox MB_YESNO\|MB_ICONSTOP/]],
      [
        'installer-process-control.nsh',
        [/WINKGO_MSG_FILE_OR_FOLDER_IN_USE_ZH/, /\$\(appRunning\)/, /WINKGO_MSG_CLOSE_OR_REMOVE_PREVIOUS_ZH/],
      ],
    ]);

    const offenders: string[] = [];
    for (const file of files) {
      const allowed = allowedMessageBoxes.get(file) ?? [];
      const source = readFileSync(resolve(resourcesDir, file), 'utf8');
      source.split(/\r?\n/).forEach((line, index) => {
        if (!line.includes('MessageBox')) {
          return;
        }
        if (allowed.some((pattern) => pattern.test(line))) {
          return;
        }
        offenders.push(`${file}:${index + 1}: unexpected raw MessageBox`);
      });
    }

    expect(offenders).toEqual([]);
  });

  it('routes app-cannot-be-closed cancellation through E1003 instead of quitting silently', () => {
    const script = readFileSync(resolve(repoRoot, 'resources/windows/installer-process-control.nsh'), 'utf8');
    const cannotCloseBranch = script.match(
      /WINKGO_MSG_CLOSE_OR_REMOVE_PREVIOUS_ZH[\s\S]*?IDRETRY winkgo_wait_for_close([\s\S]*?)\$\{Else\}/
    )?.[1];

    expect(cannotCloseBranch).toBeTruthy();
    expect(cannotCloseBranch).toContain('WINKGO_E_INSTALL_DIR_REMOVE_OR_LOCKED');
    expect(cannotCloseBranch).toContain('WINKGO_FAIL_REPORTABLE_BILINGUAL_DIAGNOSTICS');
    expect(cannotCloseBranch).not.toMatch(/^\s*Quit\s*$/m);
  });

  it('automatically closes an existing WINK GO instance before an install or upgrade', () => {
    const processControl = readFileSync(resolve(repoRoot, 'resources/windows/installer-process-control.nsh'), 'utf8');
    const repairHeal = readFileSync(resolve(repoRoot, 'resources/windows/installer-repair-heal.nsh'), 'utf8');
    const customInit = repairHeal.match(/!macro customInit([\s\S]*?)!macroend/)?.[1];

    expect(customInit).toBeTruthy();
    expect(customInit).toContain('WINKGO_CLOSE_RUNNING_APP_FOR_INSTALL');
    expect(customInit?.indexOf('WINKGO_CLOSE_RUNNING_APP_FOR_INSTALL')).toBeLessThan(
      customInit?.indexOf('WINKGO_REPAIR_INSTALLED_UNINSTALLER') ?? -1
    );

    expect(processControl).toContain('!macro WINKGO_CLOSE_RUNNING_APP_FOR_INSTALL');
    expect(processControl).toContain("'WINK-GO.exe'");
    expect(processControl).toContain("'WinkGo.exe'");
    expect(processControl).toContain('CloseMainWindow');
    expect(processControl).toContain('Stop-Process -Id $$id -Force');
    expect(processControl).not.toContain("'electron.exe'");
  });

  it('covers each of the 12 Windows installer error codes with one explicit e2e scenario', () => {
    const expectedDefinitions = readInstallerErrorDefinitions();
    const result = spawnSync(
      process.execPath,
      [resolve(repoRoot, 'scripts/smoke-installer-failure-messagebox.js'), '--list-codes-json', '--compile-only'],
      { encoding: 'utf8' }
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
    const matrix = JSON.parse(result.stdout) as {
      codes: string[];
      scenarios?: Array<{ id: string; code: string; defineName: string }>;
    };
    const expectedCodes = expectedDefinitions.map((definition) => definition.code);
    const expectedDefineNames = expectedDefinitions.map((definition) => definition.defineName);
    const scenarioCodes = matrix.scenarios?.map((scenario) => scenario.code);
    const scenarioDefineNames = matrix.scenarios?.map((scenario) => scenario.defineName);
    const scenarioIds = matrix.scenarios?.map((scenario) => scenario.id);

    expect(expectedDefinitions).toHaveLength(12);
    expect(new Set(expectedCodes).size).toBe(12);
    expect(matrix.codes).toEqual(expectedCodes);
    expect(matrix.scenarios).toHaveLength(12);
    expect(new Set(scenarioIds).size).toBe(12);
    expect(scenarioCodes).toEqual(expectedCodes);
    expect(scenarioDefineNames).toEqual(expectedDefineNames);
  });

  it.each([
    {
      args: ['arm64', '--win', '--arm64'],
      expectedArch: 'arm64',
    },
    {
      args: ['auto', '--mac', '--x64'],
      expectedArch: 'x64',
    },
  ])('prepares bundled WinkGoCore for $expectedArch with args $args', { timeout: 300e3 }, ({ args, expectedArch }) => {
    const tempDir = mkdtempSync(join(tmpdir(), 'winkgo-build-test-'));
    const hookPath = join(tempDir, 'hook.cjs');
    const callsPath = join(tempDir, 'prepare-calls.json');
    const outDir = resolve(repoRoot, 'out');
    const backupOutDir = resolve(repoRoot, `.tmp-out-backup-${process.pid}-${Date.now()}-${expectedArch}`);

    writeFileSync(
      hookPath,
      `
const childProcess = require('node:child_process');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const originalLoad = Module._load;

function recordPrepareCall(options) {
  const callsPath = process.env.WINKGO_PREPARE_CALLS_FILE;
  const calls = fs.existsSync(callsPath) ? JSON.parse(fs.readFileSync(callsPath, 'utf8')) : [];
  calls.push(options ?? null);
  fs.writeFileSync(callsPath, JSON.stringify(calls));
  return { prepared: true, dir: 'mock-bundled-winkgo-core', sourceType: 'mock' };
}

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './prepareWinkGoCore' || request.endsWith('/prepareWinkGoCore')) {
    return recordPrepareCall;
  }

  if (request.endsWith('packages/shared-scripts/src/prepare-winkgo-core.js')) {
    return { prepareWinkGoCore: recordPrepareCall };
  }

  if (request === './resolveWinkGoCoreVersion.js' || request.endsWith('/resolveWinkGoCoreVersion.js')) {
    return { resolveWinkGoCoreVersion: () => 'v-test' };
  }

  return originalLoad.call(this, request, parent, isMain);
};

// Satisfy build-with-builder's output checks without clobbering real build
// artifacts: out/ lives in the actual repo (the script resolves it from its
// own __dirname), so only create empty placeholders when nothing is there.
function ensurePlaceholder(relativePath) {
  const target = path.join(process.cwd(), relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, '');
  }
}

childProcess.execSync = function mockedExecSync(command) {
  const commandText = String(command);
  if (commandText.includes('electron-vite build')) {
    ensurePlaceholder('out/main/index.js');
    ensurePlaceholder('out/preload/index.js');
    ensurePlaceholder('out/renderer/assets/index-test.js');
    ensurePlaceholder('out/renderer/assets/index-test.css');
    fs.writeFileSync(
      path.join(process.cwd(), 'out/renderer/index.html'),
      '<!doctype html><html><head><script type="module" src="./assets/index-test.js"></script><link rel="stylesheet" href="./assets/index-test.css"></head><body><div id="root"></div></body></html>\\n'
    );
  }
  if (commandText.includes('electron-builder') && process.argv.includes('--win')) {
    const version = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version;
    const arch = process.argv.includes('--arm64') ? 'arm64' : 'x64';
    ensurePlaceholder(\`out/WINK-GO-Free-Setup-\${version}-\${arch}.exe\`);
  }
  return Buffer.from('');
};

childProcess.spawnSync = function mockedSpawnSync() {
  return { status: 0, stdout: '', stderr: '' };
};
`,
      'utf8'
    );

    let movedExistingOut = false;
    try {
      if (existsSync(outDir)) {
        renameSync(outDir, backupOutDir);
        movedExistingOut = true;
      }

      const result = spawnSync(process.execPath, ['scripts/build-with-builder.js', ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          WINKGO_PREPARE_CALLS_FILE: callsPath,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${hookPath}`].filter(Boolean).join(' '),
        },
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(readFileSync(resolve(repoRoot, 'resources/windows/support/_sentry-dsn.generated.nsh'), 'utf8')).toBe(
        '!define WINKGO_SENTRY_DSN ""\n'
      );

      if (args.includes('--win')) {
        const installUtil = readFileSync(resolveAppBuilderInstallUtil(), 'utf8');
        expect(installUtil).toContain('WINK-GO bundled uninstaller override source');
        expect(installUtil).toContain('$PLUGINSDIR\\WINK-GO-fixed-uninstaller.exe');
        expect(installUtil.match(/WINK-GO bundled uninstaller override source/g)).toHaveLength(1);
        expect(installUtil).not.toContain('WinkGo-bundled-uninstaller override source');
        expect(installUtil).not.toContain('$PLUGINSDIR\\WinkGo-fixed-uninstaller.exe');
      }

      const calls = JSON.parse(readFileSync(callsPath, 'utf8')) as Array<{ arch?: string } | null>;
      expect(calls).toContainEqual(expect.objectContaining({ arch: expectedArch }));
    } finally {
      restoreOutDirectory(outDir, backupOutDir, movedExistingOut);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
