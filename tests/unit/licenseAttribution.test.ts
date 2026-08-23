/**
 * @license
 * Copyright 2026 WINK GO contributors.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '../..');

function listFilesRecursively(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
  });
}

describe('Apache-2.0 derivative attribution', () => {
  it('retains the legacy source-notice index and points to the canonical manifest', () => {
    const legacyManifest = readFileSync(resolve(projectRoot, 'docs/vendor/aionui-source-notice-manifest.txt'), 'utf8');

    expect(legacyManifest).toContain('Legacy AionUi source-notice index');
    expect(legacyManifest).toContain('2d8925fc67a97a20996fadcd2a0862b778b572ba');
    expect(legacyManifest).toContain('docs/vendor/aionui-modification-manifest.tsv');
    expect(existsSync(resolve(projectRoot, 'docs/vendor/aionui-modification-manifest.tsv'))).toBe(true);
  });

  it('keeps project-level license and distribution notices aligned', () => {
    const license = readFileSync(resolve(projectRoot, 'LICENSE'), 'utf8');
    const notice = readFileSync(resolve(projectRoot, 'NOTICE'), 'utf8');
    const thirdPartyNotices = readFileSync(resolve(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');

    expect(license).toContain('Copyright 2025 AionUi (aionui.com)');
    expect(license).toContain('Modifications Copyright 2026 WINK GO contributors.');
    expect(notice).toContain('Copyright 2025 AionUi (aionui.com)');
    expect(notice).toContain('Copyright 2026 iOfficeAI');
    expect(notice).toContain('WINK GO is an independent derivative project');
    for (const value of [
      '2d8925fc67a97a20996fadcd2a0862b778b572ba',
      '76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d',
      '445a18e1625cc68ded3a647ee99332195fbe8508',
      'aionui-modification-manifest.tsv',
      'aioncore-modification-manifest.tsv',
      'aionrs-modification-manifest.tsv',
    ]) {
      expect(thirdPartyNotices).toContain(value);
    }
  });

  it('marks a renamed derivative that had no original file header without inventing one', () => {
    const source = readFileSync(
      resolve(projectRoot, 'tests/unit/renderer/conversation/WinkGoAgentSendBox.dom.test.tsx'),
      'utf8'
    );

    expect(source).toContain('Derived from AionUi v2.1.41 and modified by WINK GO in 2026.');
    expect(source).not.toContain('Copyright 2025 AionUi');
  });

  it('marks modified package metadata and stylesheet derivatives', () => {
    for (const packagePath of [
      'package.json',
      'mobile/package.json',
      'packages/desktop/package.json',
      'packages/shared-scripts/package.json',
      'packages/web-cli/package.json',
      'packages/web-host/package.json',
    ]) {
      const packageJson = JSON.parse(readFileSync(resolve(projectRoot, packagePath), 'utf8')) as {
        'x-upstream-modification-notice'?: string;
      };
      expect(packageJson['x-upstream-modification-notice'], packagePath).toBe(
        'Modified from AionUI by WINK GO contributors in 2026.'
      );
    }

    const stylesheet = readFileSync(
      resolve(projectRoot, 'packages/desktop/src/renderer/pages/settings/AppearanceSettings/presets/retroma-y2k.css'),
      'utf8'
    );
    expect(stylesheet).toContain('Portions Copyright 2025-2026 AionUi');
    expect(stylesheet).toContain('Modified from AionUI by WINK GO contributors in 2026.');
  });

  it('retains Wry copyright, dual-license, source, and packaged legal records', () => {
    const nativeRoot = 'packages/desktop/native/winkgo-native-drop';
    const source = readFileSync(resolve(projectRoot, nativeRoot, 'src/lib.rs'), 'utf8');
    const cargo = readFileSync(resolve(projectRoot, nativeRoot, 'Cargo.toml'), 'utf8');
    const sourceRecord = readFileSync(resolve(projectRoot, nativeRoot, 'vendor/wry-0.55.1/SOURCE.md'), 'utf8');
    const notices = readFileSync(resolve(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    const desktopConfig = readFileSync(resolve(projectRoot, 'packages/desktop/electron-builder.yml'), 'utf8');
    const afterPack = readFileSync(resolve(projectRoot, 'scripts/afterPack.js'), 'utf8');

    expect(source).toContain('Copyright 2020-2023 Tauri Programme within The Commons Conservancy');
    expect(source).toContain('SPDX-License-Identifier: Apache-2.0');
    expect(source).toContain('SPDX-License-Identifier: MIT');
    expect(source).toContain('Modified from Wry 0.55.1 by WINK GO contributors in 2026.');
    expect(cargo).toContain('license = "Apache-2.0 OR MIT"');
    for (const document of [sourceRecord, notices]) {
      expect(document).toContain('a5bf203a1c8dbb3583588382538d6521655222a8');
      expect(document).toContain('Apache License 2.0 OR MIT');
    }
    for (const licenseName of ['LICENSE-APACHE', 'LICENSE-MIT']) {
      expect(existsSync(resolve(projectRoot, nativeRoot, 'vendor/wry-0.55.1', licenseName))).toBe(true);
      expect(desktopConfig).toContain('packages/desktop/native/winkgo-native-drop/vendor/wry-0.55.1');
      expect(afterPack).toContain(`vendor/wry-0.55.1/${licenseName}`);
    }
  });

  it('provides the exact MPL source code form for the unmodified option-ext runtime dependency', () => {
    const cargoLock = readFileSync(resolve(projectRoot, 'backend/Cargo.lock'), 'utf8');
    const notices = readFileSync(resolve(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    const licenseArchive = readFileSync(resolve(projectRoot, 'legal/THIRD_PARTY_LICENSES.txt'), 'utf8');
    const checksum = '04744f49eae99ab78e0d5c0b603ab218f515ea8cfe5a456d7629ad883a3b6e7d';

    expect(cargoLock).toMatch(
      new RegExp(`name = "option-ext"\\r?\\nversion = "0\\.2\\.0"[\\s\\S]*?checksum = "${checksum}"`)
    );
    expect(notices).toContain('option-ext');
    expect(notices).toContain('Mozilla Public License 2.0 (`MPL-2.0`)');
    expect(notices).toContain('https://crates.io/api/v1/crates/option-ext/0.2.0/download');
    expect(notices).toContain(checksum);
    expect(notices).toContain('WINK GO has not modified its covered source files');
    expect(licenseArchive).toContain('Mozilla Public License Version 2.0');
  });

  it('pins official managed Node.js archives and preserves the Node.js and npm licenses', () => {
    const managedNode = readFileSync(
      resolve(projectRoot, 'backend/crates/winkgo-runtime/src/node_runtime/managed.rs'),
      'utf8'
    );
    const contract = readFileSync(
      resolve(projectRoot, 'backend/crates/winkgo-runtime/src/managed_resources_contract.rs'),
      'utf8'
    );
    const notices = readFileSync(resolve(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    const checksums = [
      '0be2ab2816a4fa02d1acff014a434f29f56d8d956f5af6a98b70ced6c5f4d201',
      '3884671e87f46f773832d98a0a6cabcc5ec4f637084f0f3515b69e66ea27f2f1',
      '4786d00c4d259d3ff0b2328307f764ef3ced65f2d6e9502d433e68d66238509d',
      'b3c071cdf47aab867c3b2aa287257df12ec5d7c962bf922b32fd33226c4295fd',
      '12d3b1aa9696b7411e115a4fa2aef57f95560b5ee16bb62cd69843e535ec72be',
      '1054540bce22b54ec7e50ebc078ec5d090700a77657607a58f6a64df21f49fdd',
    ];

    expect(managedNode).not.toContain('sha256: None');
    expect(managedNode).toContain('verify_archive_checksum(&archive_path, &download_source.sha256)');
    expect(contract).toContain('"node_modules/npm/LICENSE" | "lib/node_modules/npm/LICENSE"');
    expect(notices).toContain('npm `11.6.1`');
    for (const checksum of checksums) {
      expect(managedNode).toContain(checksum);
      expect(notices).toContain(checksum);
    }
  });

  it('does not add upstream ownership to a newly authored WINK GO file', () => {
    const source = readFileSync(resolve(projectRoot, 'mobile/app/legal.tsx'), 'utf8');

    expect(source).toContain('Copyright 2026 WINK GO (winkgo.top)');
    expect(source).not.toContain('Copyright 2025 AionUi');
  });

  it('bundles only the independently written PDF compatibility skill', { timeout: 60_000 }, () => {
    const builtinSkillsRoot = resolve(projectRoot, 'backend/crates/winkgo-app/assets/builtin-skills');
    const pdfSkillRoot = resolve(builtinSkillsRoot, 'pdf');
    const restrictedLegacyFileHashes = new Set([
      '6f8bd7f4d8ec5cb52b7a59ccb9e8c14c2a4ba529cb5adfc5e0bc676892b8ca79',
      'ca855e47acbe3a75ab28bec7c020d1b6effa24e0c7dd8fc38efcd5d279acefe0',
    ]);

    expect(readFileSync(resolve(pdfSkillRoot, 'SOURCE.md'), 'utf8')).toContain(
      'No text, code, prompts, scripts, or assets from the removed redistribution-'
    );
    expect(readFileSync(resolve(pdfSkillRoot, 'LICENSE'), 'utf8')).toContain('Apache License');
    expect(readFileSync(resolve(pdfSkillRoot, 'SKILL.md'), 'utf8')).toMatch(/independently written PDF\s+Toolkit/);

    for (const filePath of listFilesRecursively(builtinSkillsRoot)) {
      const digest = createHash('sha256').update(readFileSync(filePath)).digest('hex');
      expect(restrictedLegacyFileHashes.has(digest), filePath).toBe(false);
    }
  });
});
