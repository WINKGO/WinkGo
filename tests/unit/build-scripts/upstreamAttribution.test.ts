import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

type ManifestRow = {
  disposition: 'inline' | 'manifest-only';
  type: 'text' | 'binary';
  upstream_path: string;
  current_path: string;
  upstream_sha256: string;
  current_sha256: string;
};

type InventoryRow = Omit<ManifestRow, 'disposition' | 'current_sha256'>;

type ProjectExpectation = {
  name: string;
  rows: number;
  inline: number;
  manifestOnly: number;
};

type AttributionVerifier = {
  verifyRepository: (repoRoot?: string) => {
    projects: number;
    modifiedFiles: number;
    inlineNotices: number;
    manifestOnly: number;
  };
  verifyManifestRows: (repoRoot: string, project: ProjectExpectation, rows: ManifestRow[]) => void;
  verifyInventoryCoverage: (
    repoRoot: string,
    project: { name: string; currentRoot: string; upstreamEntries: number },
    inventoryRows: InventoryRow[],
    manifestRows: ManifestRow[]
  ) => void;
};

const require = createRequire(import.meta.url);
const verifier = require('../../../scripts/licenses/verify-upstream-attribution.cjs') as AttributionVerifier;
const projectRoot = resolve(__dirname, '../../..');
const temporaryRoots: string[] = [];
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('upstream attribution verification', () => {
  it('covers every mapped modified file and required legal notice', () => {
    expect(verifier.verifyRepository()).toEqual({
      projects: 3,
      modifiedFiles: 2428,
      inlineNotices: 2202,
      manifestOnly: 226,
    });
  }, 600_000);

  it('keeps all canonical manifests visible to Git', () => {
    const manifestPaths = [
      'docs/vendor/aionui-modification-manifest.tsv',
      'docs/vendor/aioncore-modification-manifest.tsv',
      'docs/vendor/aionrs-modification-manifest.tsv',
      'docs/vendor/aionui-upstream-inventory.tsv',
      'docs/vendor/aioncore-upstream-inventory.tsv',
      'docs/vendor/aionrs-upstream-inventory.tsv',
    ];
    const visiblePaths = new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...manifestPaths], {
        cwd: projectRoot,
        encoding: 'utf8',
      })
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
    );

    expect(visiblePaths).toEqual(new Set(manifestPaths));
  });

  it('rejects a safely commentable modified file without its inline notice', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-attribution-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, 'src'));
    const source = 'export const value = 1;\n';
    writeFileSync(join(root, 'src', 'example.ts'), source);
    const row: ManifestRow = {
      disposition: 'inline',
      type: 'text',
      upstream_path: 'src/example.ts',
      current_path: 'src/example.ts',
      upstream_sha256: '0'.repeat(64),
      current_sha256: sha256(source),
    };

    expect(() =>
      verifier.verifyManifestRows(root, { name: 'AionUI', rows: 1, inline: 1, manifestOnly: 0 }, [row])
    ).toThrow('Missing modification notice');
  });

  it('detects when a formerly identical upstream file changes without entering the manifest', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-inventory-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'example.ts'), 'export const value = 2;\n');
    const inventory: InventoryRow = {
      type: 'text',
      upstream_path: 'src/example.ts',
      current_path: 'src/example.ts',
      upstream_sha256: sha256('export const value = 1;\n'),
    };

    expect(() =>
      verifier.verifyInventoryCoverage(root, { name: 'AionUI', currentRoot: '', upstreamEntries: 1 }, [inventory], [])
    ).toThrow('Modified upstream file is missing from the manifest');
  });
});
