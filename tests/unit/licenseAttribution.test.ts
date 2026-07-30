/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = resolve(__dirname, '../..');
const originalNotice = (year: string) => `Copyright ${year} AionUi (aionui.com)`;
const modificationNotice = 'Modifications Copyright 2026 WINK GO (winkgo.top)';
const spdxNotice = 'SPDX-License-Identifier: Apache-2.0';

type ManifestRow = {
  year: '2025' | '2026';
  currentPath: string;
  upstreamPath: string;
};

function readManifestRows(): ManifestRow[] {
  return readFileSync(resolve(projectRoot, 'docs/vendor/aionui-source-notice-manifest.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [year, currentPath, upstreamPath] = line.split('\t');
      if ((year !== '2025' && year !== '2026') || !currentPath || !upstreamPath) {
        throw new Error(`Invalid attribution manifest row: ${line}`);
      }
      return { year, currentPath, upstreamPath };
    });
}

function headerOccurrences(source: string, value: string): number {
  return source.split(/\r?\n/).filter((line) => line === ` * ${value}`).length;
}

describe('Apache-2.0 derivative attribution', () => {
  it('preserves every pinned upstream source notice with the correct year and modification marker', () => {
    const rows = readManifestRows();
    const currentPaths = new Set(rows.map((row) => row.currentPath));
    const upstreamPaths = new Set(rows.map((row) => row.upstreamPath));

    expect(rows).toHaveLength(785);
    expect(currentPaths.size).toBe(785);
    expect(upstreamPaths.size).toBe(785);
    expect(rows.filter((row) => row.year === '2025')).toHaveLength(766);
    expect(rows.filter((row) => row.year === '2026')).toHaveLength(19);
    expect(rows.filter((row) => row.currentPath !== row.upstreamPath)).toHaveLength(16);

    for (const row of rows) {
      const sourcePath = resolve(projectRoot, row.currentPath);
      expect(existsSync(sourcePath), row.currentPath).toBe(true);
      const source = readFileSync(sourcePath, 'utf8');
      expect(headerOccurrences(source, originalNotice(row.year)), row.currentPath).toBe(1);
      expect(headerOccurrences(source, modificationNotice), row.currentPath).toBe(1);
      expect(headerOccurrences(source, spdxNotice), row.currentPath).toBe(1);
    }
  });

  it('keeps project-level license and distribution notices aligned', () => {
    const license = readFileSync(resolve(projectRoot, 'LICENSE'), 'utf8');
    const notice = readFileSync(resolve(projectRoot, 'NOTICE'), 'utf8');
    const thirdPartyNotices = readFileSync(resolve(projectRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');

    expect(license).toContain('Copyright 2025 AionUi (aionui.com)');
    expect(license).toContain('Modifications Copyright 2026 WINK GO');
    expect(notice).toContain('Copyright 2025-2026 AionUi');
    expect(notice).toContain('WINK GO is an independent derivative project');
    expect(thirdPartyNotices).toContain('2d8925fc67a97a20996fadcd2a0862b778b572ba');
    expect(thirdPartyNotices).toContain('aionui-source-notice-manifest.txt');
  });

  it('marks a renamed derivative that had no original file header without inventing one', () => {
    const source = readFileSync(
      resolve(projectRoot, 'tests/unit/renderer/conversation/WinkGoAgentSendBox.dom.test.tsx'),
      'utf8'
    );

    expect(source).toContain('Derived from AionUi v2.1.41 and modified by WINK GO in 2026.');
    expect(source).not.toContain('Copyright 2025 AionUi');
  });

  it('does not add upstream ownership to a newly authored WINK GO file', () => {
    const source = readFileSync(resolve(projectRoot, 'mobile/app/legal.tsx'), 'utf8');

    expect(source).toContain('Copyright 2026 WINK GO (winkgo.top)');
    expect(source).not.toContain('Copyright 2025 AionUi');
  });
});
