/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import appConfig from '../app.config';
import { resolveEmbeddedLegalDocuments } from '../src/constants/legalDocuments';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prepareMobileLegalAssets } = require('../scripts/prepare-legal-assets') as {
  prepareMobileLegalAssets: (options: { repositoryRoot: string; outputDirectory: string }) => string[];
};

describe('mobile legal documents', () => {
  it('embeds the canonical repository documents in the app config', () => {
    const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
    const documents = (config.extra as { legalDocuments: Record<string, string> }).legalDocuments;
    const repositoryRoot = resolve(__dirname, '../..');

    expect(documents.license).toBe(readFileSync(resolve(repositoryRoot, 'LICENSE'), 'utf8'));
    expect(documents.notice).toBe(readFileSync(resolve(repositoryRoot, 'NOTICE'), 'utf8'));
    expect(documents.thirdPartyNotices).toBe(
      readFileSync(resolve(repositoryRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8')
    );
    expect(documents.privacy).toBe(readFileSync(resolve(repositoryRoot, 'PRIVACY.md'), 'utf8'));
    expect(documents.terms).toBe(readFileSync(resolve(repositoryRoot, 'TERMS.md'), 'utf8'));
    expect(config.assetBundlePatterns).toContain('assets/**/*');
  });

  it('stages complete dependency notices as bundled mobile assets', () => {
    const outputDirectory = mkdtempSync(resolve(tmpdir(), 'winkgo-mobile-legal-'));
    const repositoryRoot = resolve(__dirname, '../..');
    try {
      const files = prepareMobileLegalAssets({ repositoryRoot, outputDirectory });
      expect(files).toHaveLength(5);
      for (const file of files) expect(statSync(file).size).toBeGreaterThan(0);
      expect(readFileSync(resolve(outputDirectory, 'THIRD_PARTY_DEPENDENCIES.json'), 'utf8')).toContain(
        '"schemaVersion": 1'
      );
      expect(readFileSync(resolve(outputDirectory, 'THIRD_PARTY_LICENSES.txt'), 'utf8')).toContain(
        'GNU LESSER GENERAL PUBLIC LICENSE'
      );
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('fails safely when a build omits or corrupts an embedded document', () => {
    expect(resolveEmbeddedLegalDocuments(undefined)).toEqual({
      notice: '',
      license: '',
      thirdPartyNotices: '',
      privacy: '',
      terms: '',
    });
    expect(resolveEmbeddedLegalDocuments({ legalDocuments: { notice: 42 } })).toEqual({
      notice: '',
      license: '',
      thirdPartyNotices: '',
      privacy: '',
      terms: '',
    });
  });
});
