/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import appConfig from '../app.config';
import { resolveEmbeddedLegalDocuments } from '../src/constants/legalDocuments';

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
  });

  it('fails safely when a build omits or corrupts an embedded document', () => {
    expect(resolveEmbeddedLegalDocuments(undefined)).toEqual({
      notice: '',
      license: '',
      thirdPartyNotices: '',
    });
    expect(resolveEmbeddedLegalDocuments({ legalDocuments: { notice: 42 } })).toEqual({
      notice: '',
      license: '',
      thirdPartyNotices: '',
    });
  });
});
