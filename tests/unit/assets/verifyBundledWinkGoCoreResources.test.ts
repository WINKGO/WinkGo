import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const {
  verifyBundledWinkGoCoreResources,
} = require('../../../packages/shared-scripts/src/verify-bundled-winkgo-core-resources');

const COMPLIANT_PDF_TOOLKIT_CORE = [
  'pdf-toolkit/SKILL.md',
  'name: pdf-toolkit',
  'This original skill is distributed under the Apache License 2.0.',
].join('\0');

function writeFile(filePath: string, contents = '') {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, { flush: true });
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { flush: true });
}

function nodeRequiredFiles(runtimeKey: string) {
  return ['LICENSE', runtimeKey.startsWith('win32-') ? 'node_modules/npm/LICENSE' : 'lib/node_modules/npm/LICENSE'];
}

function writeManagedResourcesContract(
  managedResourcesDir: string,
  {
    runtimeKey = 'win32-x64',
    nodeRoot = 'node/node-v24.11.0-win-x64',
    nodeExecutable = 'node.exe',
  }: {
    runtimeKey?: string;
    nodeRoot?: string;
    nodeExecutable?: string;
  } = {}
) {
  writeJson(join(managedResourcesDir, 'manifest.json'), {
    schemaVersion: 2,
    runtimeKey,
    node: {
      version: '24.11.0',
      root: nodeRoot,
      executable: nodeExecutable,
      requiredFiles: nodeRequiredFiles(runtimeKey),
    },
    clis: [],
  });
}

function seedRuntimeKey(
  resourcesDir: string,
  {
    runtimeKey,
    platform,
    arch,
    nodeRoot,
    nodeExecutable,
  }: { runtimeKey: string; platform: string; arch: string; nodeRoot: string; nodeExecutable: string }
) {
  const managedResourcesDir = join(resourcesDir, 'bundled-winkgo-core', runtimeKey, 'managed-resources');
  mkdirSync(join(resourcesDir, 'bundled-winkgo-core', runtimeKey), { recursive: true });
  writeFile(
    join(resourcesDir, 'bundled-winkgo-core', runtimeKey, platform === 'win32' ? 'winkgo_core.exe' : 'winkgo_core'),
    COMPLIANT_PDF_TOOLKIT_CORE
  );
  writeJson(join(resourcesDir, 'bundled-winkgo-core', runtimeKey, 'manifest.json'), { platform, arch });
  const nodeDir = join(managedResourcesDir, ...nodeRoot.split('/'));
  writeFile(join(nodeDir, ...nodeExecutable.split('/')), 'node');
  for (const requiredFile of nodeRequiredFiles(runtimeKey)) {
    writeFile(join(nodeDir, ...requiredFile.split('/')), 'license');
  }
  writeManagedResourcesContract(managedResourcesDir, { runtimeKey, nodeRoot, nodeExecutable });
  return managedResourcesDir;
}

describe('verifyBundledWinkGoCoreResources', () => {
  let tmp: string;
  let resourcesDir: string;
  let managedResourcesDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'winkgo-bundled-resources-'));
    resourcesDir = join(tmp, 'resources');
    managedResourcesDir = seedRuntimeKey(resourcesDir, {
      runtimeKey: 'win32-x64',
      platform: 'win32',
      arch: 'x64',
      nodeRoot: 'node/node-v24.11.0-win-x64',
      nodeExecutable: 'node.exe',
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('passes when the managed resources contract points to existing resources', () => {
    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.runtimeKey).toBe('win32-x64');
    expect(result.missing).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it('rejects a Core that embeds the removed restricted PDF Skill', () => {
    const binaryPath = join(resourcesDir, 'bundled-winkgo-core', 'win32-x64', 'winkgo_core.exe');
    writeFile(binaryPath, [COMPLIANT_PDF_TOOLKIT_CORE, 'pdf/SKILL.md', 'pdf/LICENSE.txt'].join('\0'));

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'winkgo_core',
        reason: 'restricted_legacy_pdf_skill',
      })
    );
    expect(result.missing).toEqual(expect.arrayContaining([expect.stringContaining('<restricted_legacy_pdf_skill:')]));
  });

  it('rejects a Core that does not embed the original pdf-toolkit', () => {
    const binaryPath = join(resourcesDir, 'bundled-winkgo-core', 'win32-x64', 'winkgo_core.exe');
    writeFile(binaryPath, 'clean but incomplete core');

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'winkgo_core',
        reason: 'missing_original_pdf_toolkit',
      })
    );
  });

  it('rejects the removed builtin-skills/pdf directory in a prepared bundle', () => {
    writeFile(join(managedResourcesDir, 'builtin-skills', 'pdf', 'SKILL.md'), 'legacy PDF skill');

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'winkgo_core-bundle',
        reason: 'restricted_legacy_pdf_skill_path',
      })
    );
  });

  it('fails when managed resources contract is missing', () => {
    rmSync(join(managedResourcesDir, 'manifest.json'));

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain('bundled-winkgo-core/win32-x64/managed-resources/manifest.json');
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'managed-resources',
        reason: 'missing_file',
      })
    );
  });

  it('reports bundle manifest platform and architecture mismatches', () => {
    writeJson(join(resourcesDir, 'bundled-winkgo-core', 'win32-x64', 'manifest.json'), {
      platform: 'darwin',
      arch: 'arm64',
    });

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain('bundled-winkgo-core/win32-x64/manifest.json<platform:win32>');
    expect(result.missing).toContain('bundled-winkgo-core/win32-x64/manifest.json<arch:x64>');
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'bundle-manifest',
        reason: 'runtime_key_mismatch',
      })
    );
  });

  it('passes with the Windows arm64 managed Node layout', () => {
    const arm64ResourcesDir = join(tmp, 'win32-arm64-resources');
    seedRuntimeKey(arm64ResourcesDir, {
      runtimeKey: 'win32-arm64',
      platform: 'win32',
      arch: 'arm64',
      nodeRoot: 'node/node-v24.11.0-win-arm64',
      nodeExecutable: 'node.exe',
    });

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir: arm64ResourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'arm64',
    });

    expect(result.missing).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.checked).toContain(
      'bundled-winkgo-core/win32-arm64/managed-resources/node/node-v24.11.0-win-arm64/LICENSE'
    );
    expect(result.checked).toContain(
      'bundled-winkgo-core/win32-arm64/managed-resources/node/node-v24.11.0-win-arm64/node_modules/npm/LICENSE'
    );
  });

  it('passes for non-Windows node runtime layout', () => {
    const darwinResourcesDir = join(tmp, 'darwin-resources');
    seedRuntimeKey(darwinResourcesDir, {
      runtimeKey: 'darwin-arm64',
      platform: 'darwin',
      arch: 'arm64',
      nodeRoot: 'node/node-v24.11.0-darwin-arm64',
      nodeExecutable: 'bin/node',
    });

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir: darwinResourcesDir,
      electronPlatformName: 'darwin',
      targetArch: 'arm64',
    });

    expect(result.missing).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(result.checked).toContain(
      'bundled-winkgo-core/darwin-arm64/managed-resources/node/node-v24.11.0-darwin-arm64/bin/node'
    );
    expect(result.checked).toContain(
      'bundled-winkgo-core/darwin-arm64/managed-resources/node/node-v24.11.0-darwin-arm64/lib/node_modules/npm/LICENSE'
    );
  });

  it('reports missing non-Windows managed node runtime executable', () => {
    const linuxResourcesDir = join(tmp, 'linux-resources');
    const linuxManagedResourcesDir = seedRuntimeKey(linuxResourcesDir, {
      runtimeKey: 'linux-x64',
      platform: 'linux',
      arch: 'x64',
      nodeRoot: 'node/node-v24.11.0-linux-x64',
      nodeExecutable: 'bin/node',
    });
    // Remove the node executable, leaving the directory.
    rmSync(join(linuxManagedResourcesDir, 'node', 'node-v24.11.0-linux-x64', 'bin', 'node'), { force: true });

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir: linuxResourcesDir,
      electronPlatformName: 'linux',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-winkgo-core/linux-x64/managed-resources/node/node-v24.11.0-linux-x64/bin/node'
    );
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'managed-node',
        reason: 'missing_file',
      })
    );
  });

  it('rejects a stray managed Codex binary tree even when omitted from the contract', () => {
    writeFile(join(managedResourcesDir, 'cli', 'codex', '0.144.6', 'win32-x64', 'codex.exe'), 'binary');

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        reason: 'forbidden_bundled_external_cli',
        path: expect.stringContaining('/cli/codex'),
      })
    );
  });

  it('rejects a stray managed Claude binary tree even when omitted from the contract', () => {
    writeFile(join(managedResourcesDir, 'cli', 'claude', '2.1.215', 'win32-x64', 'claude.exe'), 'binary');

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        reason: 'forbidden_bundled_external_cli',
        path: expect.stringContaining('/cli/claude'),
      })
    );
  });

  it('rejects managed npm package markers outside a conventional CLI path', () => {
    writeJson(join(managedResourcesDir, 'staging', 'package.json'), {
      dependencies: { '@openai/codex': '0.144.6' },
    });

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        reason: 'forbidden_bundled_external_cli',
        detail: '@openai/codex',
      })
    );
  });

  it('fails when the Node LICENSE declared by the contract is missing', () => {
    rmSync(join(managedResourcesDir, 'node', 'node-v24.11.0-win-x64', 'LICENSE'));

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-winkgo-core/win32-x64/managed-resources/node/node-v24.11.0-win-x64/LICENSE'
    );
  });

  it('fails when node.requiredFiles omits the bundled npm LICENSE', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.node.requiredFiles = ['LICENSE'];
    writeJson(manifestPath, manifest);

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'managed-node',
        reason: 'missing_node_legal_file',
        detail: 'node_modules/npm/LICENSE',
      })
    );
  });

  it('fails when contract node root points to the required version but only a wrong node directory exists', () => {
    rmSync(join(managedResourcesDir, 'node', 'node-v24.11.0-win-x64'), { recursive: true, force: true });
    writeFile(join(managedResourcesDir, 'node', 'node-v20.0.0-win-x64', 'node.exe'));

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.missing).toContain(
      'bundled-winkgo-core/win32-x64/managed-resources/node/node-v24.11.0-win-x64/node.exe'
    );
  });

  it('ignores unknown contract fields but rejects duplicate cli names', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.extraDiagnostic = { ignored: true };
    const externalCli = {
      name: 'open-agent',
      version: '1.0.0',
      root: 'cli/open-agent/1.0.0/win32-x64',
      platformDirectory: 'win32-x64',
      executable: 'agent.exe',
      requiredFiles: [],
      requiredDirectories: [],
    };
    manifest.clis = [externalCli, { ...externalCli }];
    writeJson(manifestPath, manifest);

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: 'open-agent',
        reason: 'duplicate_cli_name',
      })
    );
  });

  it.each(['claude', 'codex'])('rejects a %s entry in the managed resources contract', (name) => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.clis = [
      {
        name,
        version: '1.0.0',
        root: `cli/${name}/1.0.0/win32-x64`,
        platformDirectory: 'win32-x64',
        executable: `${name}.exe`,
        requiredFiles: [],
        requiredDirectories: [],
      },
    ];
    writeJson(manifestPath, manifest);

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(
      expect.objectContaining({
        component: name,
        reason: 'forbidden_bundled_external_cli',
      })
    );
  });

  it('fails when the contract is invalid JSON', () => {
    writeFileSync(join(managedResourcesDir, 'manifest.json'), '{');

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'invalid_json' }));
  });

  it('fails when the contract schema version is unsupported', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.schemaVersion = 1;
    writeJson(manifestPath, manifest);

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'unsupported_schema_version' }));
  });

  it('fails when required contract fields have invalid types', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.node.root = 42;
    writeJson(manifestPath, manifest);

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'invalid_schema' }));
  });

  it('fails when a cli platform directory does not match the runtime key', () => {
    const manifestPath = join(managedResourcesDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.clis = [
      {
        name: 'open-agent',
        version: '1.0.0',
        root: 'cli/open-agent/1.0.0/win32-x64',
        platformDirectory: 'win32-x64',
        executable: 'agent.exe',
        requiredFiles: [],
        requiredDirectories: [],
      },
    ];
    manifest.clis[0].platformDirectory = 'linux-x64';
    writeJson(manifestPath, manifest);

    const result = verifyBundledWinkGoCoreResources({
      resourcesDir,
      electronPlatformName: 'win32',
      targetArch: 'x64',
    });

    expect(result.failures).toContainEqual(expect.objectContaining({ reason: 'runtime_key_mismatch' }));
  });
});
