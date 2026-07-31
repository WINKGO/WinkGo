import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const projectRoot = resolve(__dirname, '../../..');
const generator = require('../../../scripts/licenses/generate-third-party-licenses.cjs') as {
  checkLockInputs: () => void;
  normalizeLicense: (value: unknown) => string | null;
  normalizeNpmVersion: (value: unknown) => string;
  validateEntries: (entries: Array<{ id: string; license: string | null; licenseTextHashes: string[] }>) => void;
};

describe('third-party dependency license artifacts', () => {
  it('covers every locked Bun package and every referenced license text', () => {
    expect(() => generator.checkLockInputs()).not.toThrow();
  });

  it('rejects a dependency with no license metadata or text', () => {
    expect(() =>
      generator.validateEntries([
        {
          id: 'npm:unlicensed-example@1.0.0',
          license: null,
          licenseTextHashes: [],
        },
      ])
    ).toThrow(/neither license metadata nor a license text/);
  });

  it('normalizes legacy npm license metadata without inventing a license', () => {
    expect(generator.normalizeLicense([{ type: 'MIT' }, { type: 'Apache-2.0' }])).toBe('Apache-2.0 OR MIT');
    expect(generator.normalizeLicense(undefined)).toBeNull();
  });

  it('normalizes non-standard v-prefixed npm package versions', () => {
    expect(generator.normalizeNpmVersion('v2.1.5')).toBe('2.1.5');
    expect(generator.normalizeNpmVersion('1.0.0-beta.1')).toBe('1.0.0-beta.1');
  });

  it('ships generated artifacts in desktop, web CLI, release, and CI paths', () => {
    const distributionFiles = [
      'packages/desktop/electron-builder.yml',
      'scripts/afterPack.js',
      'scripts/pack-web-cli.js',
      'scripts/prepare-release-assets.sh',
      'scripts/smoke-test-web-cli.sh',
      'scripts/verify-release-assets.sh',
      '.github/workflows/build-and-release.yml',
      '.github/workflows/release-distribute.yml',
      'mobile/scripts/prepare-legal-assets.js',
    ].map((file) => readFileSync(resolve(projectRoot, file), 'utf8'));

    for (const artifact of ['THIRD_PARTY_DEPENDENCIES.json', 'THIRD_PARTY_LICENSES.txt']) {
      for (const content of distributionFiles) expect(content).toContain(artifact);
    }

    const mobileConfig = readFileSync(resolve(projectRoot, 'mobile/app.config.ts'), 'utf8');
    expect(mobileConfig).toContain("assetBundlePatterns: ['assets/**/*']");

    const desktopConfig = readFileSync(resolve(projectRoot, 'packages/desktop/electron-builder.yml'), 'utf8');
    const afterPack = readFileSync(resolve(projectRoot, 'scripts/afterPack.js'), 'utf8');
    expect(desktopConfig).toContain("'!**/node_modules/sharp/**'");
    expect(desktopConfig).toContain("'!**/node_modules/.bun/@img+sharp-*/**'");
    expect(afterPack).toContain('verifyNoRuntimeSharpLibvips(resourcesDir)');
    expect(afterPack).toContain("entry.name === 'app.asar'");

    expect(readFileSync(resolve(projectRoot, '.github/workflows/build-and-release.yml'), 'utf8')).toContain(
      'bun run licenses:check'
    );
    expect(readFileSync(resolve(projectRoot, '.github/workflows/_build-reusable.yml'), 'utf8')).toContain(
      '--check-locks'
    );
  });

  it('retains approved manual sources and omits removed proprietary skills', () => {
    const notices = readFileSync(resolve(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    expect(notices).toContain('e04dee2af5a0822db867edd67fcf29c9e02739fc');
    expect(notices).toContain('ef740771ac901e03fbca3ce4e1c453a96010f30a');
    expect(notices).not.toContain('@lobehub/icons-static-svg');
    expect(notices).toContain('sharp` version `0.35.3');
    expect(notices).toContain('libvips version `8.18.3');
    expect(notices).toMatch(/not included in WINK GO\s+end-user installers/);
    expect(notices).not.toMatch(/^## (?:Moltbook|PDF Skill)$/m);
  });
});
