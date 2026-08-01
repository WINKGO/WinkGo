import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

type PrivacyViolation = {
  rule: string;
  label: string;
};

type PrivacyAuditModule = {
  compareInstallerAsar: (installerAsar: string, packedAsar: string) => PrivacyViolation | null;
  isExcludedBundledCoreBuildInput: (filePath: string, baseRoot?: string) => boolean;
  listSourceFiles: (sourceRoot?: string) => string[];
  physicalPathViolation: (filePath: string, baseRoot?: string, mode?: string) => string;
  scanFileContent: (filePath: string) => string[];
};

const require = createRequire(import.meta.url);
const audit = require(resolve(__dirname, '../../scripts/audit-release-privacy.cjs')) as PrivacyAuditModule;

describe('final release privacy audit', () => {
  it('blocks when the final installer ASAR differs from win-unpacked', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-asar-mismatch-'));
    try {
      const installerAsar = join(root, 'installer.asar');
      const packedAsar = join(root, 'packed.asar');
      writeFileSync(installerAsar, 'installer payload');
      writeFileSync(packedAsar, 'different unpacked payload');

      const violation = audit.compareInstallerAsar(installerAsar, packedAsar);

      expect(violation?.rule).toBe('installer-packed-asar-mismatch');
      expect(violation?.label).toContain('installer=');
      expect(violation?.label).toContain('packed=');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts identical final installer and win-unpacked ASAR files', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-asar-match-'));
    try {
      const installerAsar = join(root, 'installer.asar');
      const packedAsar = join(root, 'packed.asar');
      writeFileSync(installerAsar, 'same payload');
      writeFileSync(packedAsar, 'same payload');

      expect(audit.compareInstallerAsar(installerAsar, packedAsar)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when the win-unpacked ASAR reference is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-asar-missing-'));
    try {
      const installerAsar = join(root, 'installer.asar');
      writeFileSync(installerAsar, 'installer payload');

      const violation = audit.compareInstallerAsar(installerAsar, join(root, 'missing.asar'));

      expect(violation?.rule).toBe('missing-packed-asar-reference');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects unexpected release repositories, developer paths, sessions, and device identities', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-privacy-rules-'));
    try {
      const fixture = join(root, 'payload.txt');
      writeFileSync(
        fixture,
        [
          'https://github.com/WINKGO/private',
          'C:\\Users\\ReleaseEngineer\\Desktop',
          'session_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZXYifQ.signature123',
          'device_id=63f7ac91-89e8-4b3c-88f3-87ef85916d55',
        ].join('\n')
      );

      const findings = audit.scanFileContent(fixture);

      expect(findings).toContain('unexpected-winkgo-github-repository');
      expect(findings).toContain('developer-windows-profile');
      expect(findings).toContain('login-session-token');
      expect(findings).toContain('device-identity');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks retired AionUI runtime identifiers in release content', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-retired-runtime-'));
    try {
      const fixture = join(root, 'payload.txt');
      writeFileSync(
        fixture,
        ['runtime=bundled-aioncore', 'package=@aionui/web-host', 'env=AIONUI_DATA_DIR'].join('\n')
      );

      const findings = audit.scanFileContent(fixture);

      expect(findings).toContain('legacy-bundled-aioncore');
      expect(findings).toContain('legacy-aionui-web-host');
      expect(findings).toContain('legacy-aionui-runtime-env');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows the compliant PDF compatibility skill alongside the independently authored toolkit', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-pdf-skill-'));
    try {
      const compliantFixture = join(root, 'compliant-core.bin');
      writeFileSync(
        compliantFixture,
        [
          'pdf/SKILL.md',
          'name: pdf\n',
          'pdf/SOURCE.md',
          'pdf-toolkit/SKILL.md',
          'name: pdf-toolkit',
          'This original skill is distributed under the Apache License 2.0.',
        ].join('\0')
      );
      expect(audit.scanFileContent(compliantFixture)).not.toEqual(
        expect.arrayContaining(['restricted-pdf-license-path', 'restricted-pdf-scripts-path'])
      );

      const legacyFixture = join(root, 'legacy-core.bin');
      writeFileSync(legacyFixture, ['pdf/SKILL.md', 'pdf/LICENSE.txt'].join('\0'));
      expect(audit.scanFileContent(legacyFixture)).toContain('restricted-pdf-license-path');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('continues to exempt retired runtime names only in the exact hash-pinned inventory', () => {
    const canonicalInventory = resolve(__dirname, '../../docs/vendor/aioncore-upstream-inventory.tsv');
    const root = mkdtempSync(join(tmpdir(), 'winkgo-unverified-inventory-'));
    try {
      const copiedInventory = join(root, 'aioncore-upstream-inventory.tsv');
      writeFileSync(copiedInventory, readFileSync(canonicalInventory, 'utf8'));
      expect(audit.scanFileContent(copiedInventory)).not.toEqual(
        expect.arrayContaining(['restricted-pdf-skill-path', 'restricted-pdf-license-path'])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('only exempts retired runtime names in the exact hash-pinned upstream inventory', () => {
    const canonicalInventory = resolve(__dirname, '../../docs/vendor/aionui-upstream-inventory.tsv');
    expect(audit.scanFileContent(canonicalInventory)).not.toEqual(
      expect.arrayContaining(['legacy-bundled-aioncore', 'legacy-aionui-web-host', 'legacy-aionui-runtime-env'])
    );

    const root = mkdtempSync(join(tmpdir(), 'winkgo-unverified-runtime-inventory-'));
    try {
      const copiedInventory = join(root, 'aionui-upstream-inventory.tsv');
      writeFileSync(copiedInventory, readFileSync(canonicalInventory));
      expect(audit.scanFileContent(copiedInventory)).toContain('legacy-bundled-aioncore');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks retired runtime package paths even when file contents are clean', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-retired-runtime-path-'));

    try {
      expect(audit.physicalPathViolation(join(root, 'resources', 'bundled-aioncore', 'runtime.exe'), root)).toContain(
        'legacy-bundled-aioncore-path'
      );
      expect(
        audit.physicalPathViolation(join(root, 'node_modules', '@aionui', 'web-host', 'index.js'), root)
      ).toContain('legacy-aionui-web-host-path');
      expect(
        audit.physicalPathViolation(join(root, 'backend', 'assets', 'builtin-skills', 'pdf', 'SKILL.md'), root)
      ).toBe('');
      expect(
        audit.physicalPathViolation(join(root, 'backend', 'assets', 'builtin-skills', 'pdf', 'LICENSE.txt'), root)
      ).toBe('restricted-legacy-pdf-skill-path');
      expect(
        audit.physicalPathViolation(join(root, 'backend', 'assets', 'builtin-skills', 'pdf-toolkit', 'SKILL.md'), root)
      ).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows WINK GO-owned UI and skill assets while blocking managed external CLIs', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-source-path-policy-'));

    try {
      expect(
        audit.physicalPathViolation(
          join(root, 'resources', 'managed-resources', 'cli', 'claude', 'claude.exe'),
          root,
          'source'
        )
      ).toBe('forbidden-bundled-external-cli');
      expect(audit.physicalPathViolation(join(root, 'public', 'knowledge-canvas', 'index.html'), root, 'source')).toBe(
        ''
      );
      expect(
        audit.physicalPathViolation(join(root, 'resources', 'winkgo', 'provider-skills', 'vendor'), root, 'source')
      ).toBe('');
      expect(
        audit.physicalPathViolation(join(root, 'resources', 'winkgo', 'skills', 'browser-control'), root, 'source')
      ).toBe('');
      expect(
        audit.physicalPathViolation(
          join(root, 'packed', 'resources', 'winkgo', 'skills', 'browser-control'),
          root,
          'source'
        )
      ).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('audits tracked and untracked non-ignored source files while excluding gitignored files', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-source-inventory-'));

    try {
      writeFileSync(join(root, '.gitignore'), 'ignored.txt\n');
      writeFileSync(join(root, 'tracked.txt'), 'tracked');
      writeFileSync(join(root, 'untracked.txt'), 'untracked');
      writeFileSync(join(root, 'ignored.txt'), 'ignored');

      expect(spawnSync('git', ['init', '-q'], { cwd: root }).status).toBe(0);
      expect(spawnSync('git', ['add', '.gitignore', 'tracked.txt'], { cwd: root }).status).toBe(0);

      const inventoriedNames = audit.listSourceFiles(root).map((filePath) => filePath.split(/[\\/]/).at(-1));

      expect(inventoriedNames).toContain('tracked.txt');
      expect(inventoriedNames).toContain('untracked.txt');
      expect(inventoriedNames).not.toContain('ignored.txt');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows legal attribution records and ordinary third-party copyright headers', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-legal-attribution-'));

    try {
      const notice = join(root, 'THIRD_PARTY_NOTICES.md');
      writeFileSync(notice, 'Historical packages: bundled-aioncore, @aionui/web-host, AIONUI_DATA_DIR');
      expect(audit.scanFileContent(notice)).not.toEqual(
        expect.arrayContaining(['legacy-bundled-aioncore', 'legacy-aionui-web-host', 'legacy-aionui-runtime-env'])
      );

      const sourceHeader = join(root, 'upstream-header.ts');
      writeFileSync(sourceHeader, '// Copyright 2025 AionUi (aionui.com)\nexport {};');
      expect(audit.scanFileContent(sourceHeader)).not.toEqual(
        expect.arrayContaining(['legacy-bundled-aioncore', 'legacy-aionui-web-host', 'legacy-aionui-runtime-env'])
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows only the official WINK GO repository and blocks retired account links', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-official-repositories-'));
    const fixture = join(root, 'payload.txt');

    try {
      writeFileSync(
        fixture,
        [
          'https://github.com/WINKGO/WinkGo',
          'https://api.github.com/repos/WINKGO/WinkGo/releases/latest',
          'https://github.com/WINKGO/wink-go',
        ].join('\n')
      );
      expect(audit.scanFileContent(fixture)).not.toEqual(
        expect.arrayContaining(['retired-winkgo-github-account', 'unexpected-winkgo-github-repository'])
      );

      writeFileSync(fixture, 'https://github.com/WINKGO/winkgo-skills');
      expect(audit.scanFileContent(fixture)).toContain('unexpected-winkgo-github-repository');

      writeFileSync(fixture, 'https://github.com/xuweihafeichangniu-lab/wink-go');
      expect(audit.scanFileContent(fixture)).toContain('retired-winkgo-github-account');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('blocks complete PEM private keys without flagging parser marker constants', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-private-key-structure-'));
    const fixture = join(root, 'payload.txt');

    try {
      writeFileSync(fixture, '-----BEGIN PRIVATE KEY-----\0-----END PRIVATE KEY-----');
      expect(audit.scanFileContent(fixture)).not.toContain('private-key');

      writeFileSync(
        fixture,
        [
          '-----BEGIN PRIVATE KEY-----',
          'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj',
          'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          '-----END PRIVATE KEY-----',
        ].join('\n')
      );
      expect(audit.scanFileContent(fixture)).toContain('private-key');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('matches only the bundled Core preparation and npm documentation exclusions', () => {
    const root = 'C:\\release';
    const bundle = join(root, 'resources', 'bundled-winkgo-core', 'win32-x64');

    expect(audit.isExcludedBundledCoreBuildInput(join(bundle, '.prepare-data', 'runtime', 'node.exe'), root)).toBe(
      true
    );
    expect(
      audit.isExcludedBundledCoreBuildInput(
        join(bundle, 'managed-resources', 'node', 'node-v24', 'node_modules', 'npm', 'docs', 'index.md'),
        root
      )
    ).toBe(true);
    expect(
      audit.isExcludedBundledCoreBuildInput(
        join(bundle, 'managed-resources', 'node', 'node-v24', 'node_modules', 'npm', '.npmrc'),
        root
      )
    ).toBe(true);
    expect(audit.isExcludedBundledCoreBuildInput(join(bundle, 'managed-resources', 'manifest.json'), root)).toBe(false);
    expect(
      audit.isExcludedBundledCoreBuildInput(
        join(bundle, 'managed-resources', 'node', 'node-v24', 'node_modules', 'npm', 'LICENSE'),
        root
      )
    ).toBe(false);
  });

  it('allows localized example profile names that are not developer identities', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-privacy-placeholders-'));
    const fixture = join(root, 'placeholder.txt');

    try {
      writeFileSync(
        fixture,
        [
          'C:\\Users\\me\\.mytools\\skills',
          'C:\\Users\\ich\\.mytools\\skills',
          'C:\\Users\\yo\\.misherramientas\\skills',
          'C:\\Users\\moi\\.outils\\skills',
        ].join('\n')
      );

      expect(audit.scanFileContent(fixture)).not.toContain('developer-windows-profile');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores upstream compiler profile paths in native binaries but still blocks embedded secrets', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-native-binary-'));
    const fixture = join(root, 'upstream.node');

    try {
      writeFileSync(
        fixture,
        Buffer.from(
          [
            'PDB=C:\\Users\\UpstreamBuilder\\source\\native-addon.pdb',
            'sk-abcdefghijklmnopqrstuvwxyz0123456789AB',
          ].join('\0\n'),
          'latin1'
        )
      );

      const findings = audit.scanFileContent(fixture);

      expect(findings).not.toContain('developer-windows-profile');
      expect(findings).toContain('openai-compatible-secret');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
