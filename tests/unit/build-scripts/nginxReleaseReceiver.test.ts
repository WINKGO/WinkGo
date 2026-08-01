import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const receiver = require('../../../scripts/security/nginx-release-receiver.cjs') as {
  parseForcedCommand: (command: string | undefined) => { action: 'probe' | 'publish'; version?: string };
  validateBundle: (
    bundleDirectory: string,
    version: string
  ) => {
    installerName: string;
    sha256: string;
    sizeBytes: number;
  };
  validateArchiveEntries: (entries: string[], version: string) => string[];
  validateArchiveTypes: (verboseEntries: string[], expectedCount: number) => void;
  publishBundle: (options: {
    bundleDirectory: string;
    releasesRoot: string;
    siteIndexPath: string;
    version: string;
  }) => { installerName: string; sha256: string; sizeBytes: number };
  publishArchive: (options: { archivePath: string; releasesRoot: string; siteIndexPath: string; version: string }) => {
    installerName: string;
    sha256: string;
    sizeBytes: number;
  };
};

const legalFiles = [
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'THIRD_PARTY_DEPENDENCIES.json',
  'THIRD_PARTY_LICENSES.txt',
  'PRIVACY.md',
  'TERMS.md',
];

function writeValidBundle(directory: string, version: string) {
  const installerName = `WINK-GO-Free-Setup-${version}-x64.exe`;
  const installerBytes = Buffer.from('signed WINK GO installer fixture');
  const digest = createHash('sha256').update(installerBytes).digest('hex').toUpperCase();
  const downloadUrl = `https://winkgo.top/releases/free/${version}/${installerName}`;

  writeFileSync(join(directory, installerName), installerBytes);
  writeFileSync(join(directory, `${installerName}.sha256.txt`), `${digest}  ${installerName}\n`);
  writeFileSync(
    join(directory, 'latest.yml'),
    `version: ${version}\nfiles:\n  - url: ${installerName}\npath: ${installerName}\nsha512: fixture\n`
  );
  for (const legalFile of legalFiles) {
    writeFileSync(join(directory, legalFile), `WINK GO release legal fixture: ${legalFile}\n`);
  }
  writeFileSync(
    join(directory, 'winkgo-free-update.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      version,
      edition: 'free',
      releaseProfile: 'free',
      fileName: installerName,
      downloadUrl,
      sha256: digest,
      sizeBytes: installerBytes.byteLength,
      windows: {
        version,
        fileName: installerName,
        downloadUrl,
        sha256: digest,
        sizeBytes: installerBytes.byteLength,
      },
    })}\n`
  );

  return { installerBytes, installerName, digest };
}

describe('restricted nginx release receiver', () => {
  it('accepts only probe or a strict stable-version publish command', () => {
    expect(receiver.parseForcedCommand('probe')).toEqual({ action: 'probe' });
    expect(receiver.parseForcedCommand('publish 2.2.7')).toEqual({ action: 'publish', version: '2.2.7' });

    for (const command of [
      undefined,
      '',
      'bash',
      'publish v2.2.7',
      'publish 2.2',
      'publish 2.2.7; id',
      'publish ../2.2.7',
    ]) {
      expect(() => receiver.parseForcedCommand(command), String(command)).toThrow(/refused/i);
    }
  });

  it('validates the installer bytes, checksum, updater YAML, and website manifest together', () => {
    const directory = mkdtempSync(join(tmpdir(), 'winkgo-receiver-test-'));
    const version = '2.2.7';

    try {
      const { digest, installerBytes, installerName } = writeValidBundle(directory, version);

      expect(receiver.validateBundle(directory, version)).toEqual({
        installerName,
        sha256: digest,
        sizeBytes: installerBytes.byteLength,
      });

      writeFileSync(join(directory, installerName), Buffer.from('tampered'));
      expect(() => receiver.validateBundle(directory, version)).toThrow(/checksum|size/i);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it('rejects path traversal, Pro assets, and unapproved archive contents before extraction', () => {
    const version = '2.2.7';
    const installerName = `WINK-GO-Free-Setup-${version}-x64.exe`;
    const requiredEntries = [
      installerName,
      `${installerName}.sha256.txt`,
      'latest.yml',
      'winkgo-free-update.json',
      ...legalFiles,
    ];

    expect(receiver.validateArchiveEntries(requiredEntries, version)).toEqual(requiredEntries);
    for (const unsafeEntry of [
      '../index.html',
      'nested/latest.yml',
      `WINK-GO-Pro-Setup-${version}-x64.exe`,
      'shell.sh',
    ]) {
      expect(() => receiver.validateArchiveEntries([...requiredEntries, unsafeEntry], version), unsafeEntry).toThrow(
        /archive|release|entry/i
      );
    }
  });

  it('rejects symbolic links, hard links, and directories even when their names are whitelisted', () => {
    expect(() => receiver.validateArchiveTypes(['-rw-r--r-- root/root 12 file'], 1)).not.toThrow();
    for (const listing of [
      'lrwxrwxrwx root/root 0 latest.yml -> /etc/passwd',
      'hrw-r--r-- root/root 0 latest.yml link to /etc/passwd',
      'drwxr-xr-x root/root 0 latest.yml/',
    ]) {
      expect(() => receiver.validateArchiveTypes([listing], 1), listing).toThrow(/regular files/i);
    }
  });

  it('publishes atomically, updates stable aliases and homepage URLs, and refuses same-version overwrite', () => {
    const siteRoot = mkdtempSync(join(tmpdir(), 'winkgo-site-test-'));
    const bundleDirectory = mkdtempSync(join(tmpdir(), 'winkgo-bundle-test-'));
    const releasesRoot = join(siteRoot, 'releases', 'free');
    const siteIndexPath = join(siteRoot, 'index.html');
    const version = '2.2.7';
    const oldVersion = '2.2.6';
    const { installerName, digest } = writeValidBundle(bundleDirectory, version);
    writeFileSync(
      siteIndexPath,
      [
        `https://winkgo.top/releases/free/${oldVersion}/WINK-GO-Free-Setup-${oldVersion}-x64.exe`,
        `https://github.com/WINKGO/wink-go/releases/download/v${oldVersion}/WINK-GO-Free-Setup-${oldVersion}-x64.exe`,
      ].join('\n')
    );

    try {
      expect(receiver.publishBundle({ bundleDirectory, releasesRoot, siteIndexPath, version })).toEqual({
        installerName,
        sha256: digest,
        sizeBytes: statSync(join(bundleDirectory, installerName)).size,
      });
      expect(existsSync(join(releasesRoot, version, installerName))).toBe(true);
      if (process.platform !== 'win32') {
        expect(statSync(join(releasesRoot, version)).mode & 0o777).toBe(0o755);
      }
      expect(readFileSync(join(releasesRoot, 'latest.yml'), 'utf8')).toContain(`version: ${version}`);
      expect(JSON.parse(readFileSync(join(siteRoot, 'winkgo-free-update.json'), 'utf8')).version).toBe(version);
      expect(readFileSync(siteIndexPath, 'utf8')).toContain(`/releases/free/${version}/${installerName}`);
      expect(readFileSync(siteIndexPath, 'utf8')).toContain(`/releases/download/v${version}/${installerName}`);
      expect(() => receiver.publishBundle({ bundleDirectory, releasesRoot, siteIndexPath, version })).toThrow(
        /same-version|already exists/i
      );
    } finally {
      rmSync(siteRoot, { force: true, recursive: true });
      rmSync(bundleDirectory, { force: true, recursive: true });
    }
  });

  it('lists and validates the tar archive before extracting and publishing it', () => {
    const siteRoot = mkdtempSync(join(tmpdir(), 'winkgo-archive-site-test-'));
    const bundleDirectory = mkdtempSync(join(tmpdir(), 'winkgo-archive-bundle-test-'));
    const archivePath = join(siteRoot, 'release.tar.gz');
    const siteIndexPath = join(siteRoot, 'index.html');
    const version = '2.2.7';
    const oldVersion = '2.2.6';
    const { installerName } = writeValidBundle(bundleDirectory, version);
    const archiveEntries = [
      installerName,
      `${installerName}.sha256.txt`,
      'latest.yml',
      'winkgo-free-update.json',
      ...legalFiles,
    ];
    writeFileSync(
      siteIndexPath,
      `https://winkgo.top/releases/free/${oldVersion}/WINK-GO-Free-Setup-${oldVersion}-x64.exe\n` +
        `https://github.com/WINKGO/wink-go/releases/download/v${oldVersion}/WINK-GO-Free-Setup-${oldVersion}-x64.exe\n`
    );

    try {
      execFileSync('tar', ['-czf', archivePath, '-C', bundleDirectory, ...archiveEntries]);
      expect(
        receiver.publishArchive({
          archivePath,
          releasesRoot: join(siteRoot, 'releases', 'free'),
          siteIndexPath,
          version,
        }).installerName
      ).toBe(installerName);
    } finally {
      rmSync(siteRoot, { force: true, recursive: true });
      rmSync(bundleDirectory, { force: true, recursive: true });
    }
  });
});
