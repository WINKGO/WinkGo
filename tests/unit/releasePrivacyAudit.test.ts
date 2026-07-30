import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

type PrivacyViolation = {
  rule: string;
  label: string;
};

type PrivacyAuditModule = {
  compareInstallerAsar: (installerAsar: string, packedAsar: string) => PrivacyViolation | null;
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

  it('detects personal release accounts, developer paths, sessions, and device identities', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-privacy-rules-'));
    try {
      const fixture = join(root, 'payload.txt');
      writeFileSync(
        fixture,
        [
          'https://github.com/xuweihafeichangniu-lab/private',
          'C:\\Users\\ReleaseEngineer\\Desktop',
          'session_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZXYifQ.signature123',
          'device_id=63f7ac91-89e8-4b3c-88f3-87ef85916d55',
        ].join('\n')
      );

      const findings = audit.scanFileContent(fixture);

      expect(findings).toContain('personal-github-account');
      expect(findings).toContain('developer-windows-profile');
      expect(findings).toContain('login-session-token');
      expect(findings).toContain('device-identity');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows the official WINK GO repositories but blocks the legacy repository path', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-official-repositories-'));
    const fixture = join(root, 'payload.txt');

    try {
      writeFileSync(
        fixture,
        [
          'https://github.com/xuweihafeichangniu-lab/wink-go',
          'https://github.com/xuweihafeichangniu-lab/WinkGoCore',
          'https://github.com/xuweihafeichangniu-lab/winkgo_agent',
        ].join('\n')
      );
      expect(audit.scanFileContent(fixture)).not.toContain('personal-github-account');

      writeFileSync(fixture, 'https://github.com/xuweihafeichangniu-lab/wink/wiki/ACP-Setup');
      expect(audit.scanFileContent(fixture)).toContain('personal-github-account');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
