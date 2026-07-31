/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export type LegalDocumentId = 'notice' | 'license' | 'thirdPartyNotices' | 'privacy' | 'terms';

export type EmbeddedLegalDocuments = Record<LegalDocumentId, string>;

const EMPTY_LEGAL_DOCUMENTS: EmbeddedLegalDocuments = {
  notice: '',
  license: '',
  thirdPartyNotices: '',
  privacy: '',
  terms: '',
};

export function resolveEmbeddedLegalDocuments(extra: Record<string, unknown> | undefined): EmbeddedLegalDocuments {
  const documents = extra?.legalDocuments;
  if (!documents || typeof documents !== 'object') return EMPTY_LEGAL_DOCUMENTS;

  const candidate = documents as Partial<EmbeddedLegalDocuments>;
  if (
    typeof candidate.notice !== 'string' ||
    typeof candidate.license !== 'string' ||
    typeof candidate.thirdPartyNotices !== 'string' ||
    typeof candidate.privacy !== 'string' ||
    typeof candidate.terms !== 'string'
  ) {
    return EMPTY_LEGAL_DOCUMENTS;
  }
  return candidate as EmbeddedLegalDocuments;
}
