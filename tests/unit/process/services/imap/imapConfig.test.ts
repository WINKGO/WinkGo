/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  ImapConfigurationError,
  planUidSync,
  sanitizeMailPathSegment,
  validateImapAccountInput,
} from '@/process/services/imap/imapConfig';

describe('IMAP configuration', () => {
  it('normalizes a secure account without weakening TLS', () => {
    expect(
      validateImapAccountInput({
        enabled: true,
        label: ' 工作邮箱 ',
        email: ' USER@Example.COM ',
        username: '',
        password: 'secret',
        host: ' IMAP.Example.COM ',
        port: 993,
        security: 'tls',
        pollIntervalMinutes: 2,
        downloadDirectory: ' C:\\Downloads\\Mail ',
      })
    ).toEqual({
      enabled: true,
      label: '工作邮箱',
      email: 'user@example.com',
      username: 'USER@Example.COM',
      password: 'secret',
      host: 'imap.example.com',
      port: 993,
      security: 'tls',
      pollIntervalMinutes: 2,
      downloadDirectory: 'C:\\Downloads\\Mail',
    });
  });

  it('rejects invalid or plaintext connection settings', () => {
    expect(() =>
      validateImapAccountInput({
        enabled: true,
        label: '',
        email: 'not-an-email',
        username: '',
        password: 'secret',
        host: 'imap.example.com',
        port: 0,
        security: 'tls',
        pollIntervalMinutes: 0,
        downloadDirectory: '',
      })
    ).toThrowError(ImapConfigurationError);
  });

  it('sanitizes server-provided names before using them as local paths', () => {
    expect(sanitizeMailPathSegment(' ../../季度报告:<草稿>? ')).toBe('季度报告 草稿');
    expect(sanitizeMailPathSegment('..')).toBe('邮件');
  });
});

describe('IMAP UID synchronization', () => {
  it('uses the first successful check as a baseline instead of notifying old mail', () => {
    expect(planUidSync(null, 42)).toEqual({ nextCheckpoint: 41, range: null });
  });

  it('returns only UIDs that arrived after the saved checkpoint', () => {
    expect(planUidSync(41, 45)).toEqual({
      nextCheckpoint: 44,
      range: { from: 42, to: 44 },
    });
  });
});
