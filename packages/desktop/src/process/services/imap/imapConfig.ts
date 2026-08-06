/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoMailAccountInput, WinkGoMailSecurity } from '@/common/adapter/ipcBridge';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOST_PATTERN = /^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/i;

export class ImapConfigurationError extends Error {
  readonly code = 'invalid_config' as const;

  constructor(message: string) {
    super(message);
    this.name = 'ImapConfigurationError';
  }
}

const assertFiniteInteger = (value: number, minimum: number, maximum: number, field: string): void => {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ImapConfigurationError(`${field} is outside the supported range`);
  }
};

export const validateImapAccountInput = (input: WinkGoMailAccountInput): WinkGoMailAccountInput => {
  const rawEmail = input.email.trim();
  const email = rawEmail.toLocaleLowerCase();
  const host = input.host.trim().toLocaleLowerCase();
  const username = input.username.trim() || rawEmail;
  const label = input.label.trim().slice(0, 64);
  const downloadDirectory = input.downloadDirectory.trim();
  const security: WinkGoMailSecurity = input.security;

  if (!EMAIL_PATTERN.test(email)) throw new ImapConfigurationError('email is invalid');
  if (!HOST_PATTERN.test(host) || host.includes('..')) throw new ImapConfigurationError('host is invalid');
  if (!username || username.length > 320) throw new ImapConfigurationError('username is invalid');
  if (input.password !== undefined && (!input.password || input.password.length > 4096)) {
    throw new ImapConfigurationError('password is invalid');
  }
  if (security !== 'tls' && security !== 'starttls') {
    throw new ImapConfigurationError('unencrypted IMAP is not supported');
  }
  assertFiniteInteger(input.port, 1, 65_535, 'port');
  assertFiniteInteger(input.pollIntervalMinutes, 1, 60, 'poll interval');
  if (downloadDirectory.length > 1024) throw new ImapConfigurationError('download directory is too long');

  return {
    enabled: Boolean(input.enabled),
    label,
    email,
    username,
    password: input.password,
    host,
    port: input.port,
    security,
    pollIntervalMinutes: input.pollIntervalMinutes,
    downloadDirectory,
  };
};

export const sanitizeMailPathSegment = (value: string, fallback = '邮件'): string => {
  const sanitized = value
    .normalize('NFKC')
    .replace(/\.{2,}/g, ' ')
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/^[. ]+/g, '')
    .trim()
    .slice(0, 96);
  return sanitized || fallback;
};

export type ImapUidSyncPlan = {
  nextCheckpoint: number;
  range: { from: number; to: number } | null;
};

export const planUidSync = (lastUid: number | null, uidNext: number): ImapUidSyncPlan => {
  const newestUid = Math.max(0, Math.trunc(uidNext) - 1);
  if (lastUid === null) return { nextCheckpoint: newestUid, range: null };
  if (newestUid <= lastUid) return { nextCheckpoint: lastUid, range: null };
  return {
    nextCheckpoint: newestUid,
    range: { from: lastUid + 1, to: newestUid },
  };
};
