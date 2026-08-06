/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ImapAccountStore,
  SecureStorageUnavailableError,
  type ImapSecretProtector,
} from '@/process/services/imap/ImapAccountStore';

const temporaryDirectories: string[] = [];

const makeTemporaryStorePath = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'winkgo-imap-store-'));
  temporaryDirectories.push(directory);
  return join(directory, 'account.json');
};

const protector: ImapSecretProtector = {
  isAvailable: () => true,
  encrypt: (plaintext) => Buffer.from(`protected:${plaintext}`, 'utf8'),
  decrypt: (ciphertext) =>
    Buffer.from(ciphertext)
      .toString('utf8')
      .replace(/^protected:/, ''),
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('ImapAccountStore', () => {
  it('persists the password only as encrypted ciphertext and restores it for IMAP', async () => {
    const filePath = await makeTemporaryStorePath();
    const store = new ImapAccountStore(filePath, protector);

    await store.save({
      config: {
        enabled: true,
        label: '工作邮箱',
        email: 'user@example.com',
        username: 'user@example.com',
        host: 'imap.example.com',
        port: 993,
        security: 'tls',
        pollIntervalMinutes: 2,
        downloadDirectory: 'C:\\Downloads\\WINK GO 邮件',
      },
      password: 'mail-password-123',
    });

    const persisted = await readFile(filePath, 'utf8');
    expect(persisted).not.toContain('mail-password-123');
    expect(persisted).toContain(Buffer.from('protected:mail-password-123').toString('base64'));

    await expect(store.load()).resolves.toEqual(
      expect.objectContaining({
        password: 'mail-password-123',
        config: expect.objectContaining({ email: 'user@example.com' }),
      })
    );
  });

  it('refuses to save a password when Electron secure storage is unavailable', async () => {
    const filePath = await makeTemporaryStorePath();
    const store = new ImapAccountStore(filePath, {
      ...protector,
      isAvailable: () => false,
    });

    await expect(
      store.save({
        config: {
          enabled: true,
          label: '',
          email: 'user@example.com',
          username: 'user@example.com',
          host: 'imap.example.com',
          port: 993,
          security: 'tls',
          pollIntervalMinutes: 2,
          downloadDirectory: 'C:\\Downloads\\WINK GO 邮件',
        },
        password: 'mail-password-123',
      })
    ).rejects.toBeInstanceOf(SecureStorageUnavailableError);
  });
});
