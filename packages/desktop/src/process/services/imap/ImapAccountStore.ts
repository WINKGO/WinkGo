/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WinkGoMailAccountConfig, WinkGoMailAccountInput } from '@/common/adapter/ipcBridge';

export type ImapSecretProtector = {
  isAvailable: () => boolean;
  encrypt: (plaintext: string) => Buffer;
  decrypt: (ciphertext: Buffer) => string;
};

type PersistedImapAccount = {
  schemaVersion: 1;
  config: Omit<WinkGoMailAccountConfig, 'passwordConfigured'>;
  passwordCiphertext: string;
  checkpoint: {
    uidValidity: string | null;
    lastUid: number | null;
  };
};

export type LoadedImapAccount = {
  config: Omit<WinkGoMailAccountConfig, 'passwordConfigured'>;
  password: string;
  checkpoint: PersistedImapAccount['checkpoint'];
};

export class SecureStorageUnavailableError extends Error {
  readonly code = 'secure_storage_unavailable' as const;

  constructor() {
    super('Electron secure storage is unavailable');
    this.name = 'SecureStorageUnavailableError';
  }
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

export class ImapAccountStore {
  constructor(
    private readonly filePath: string,
    private readonly protector: ImapSecretProtector
  ) {}

  private async readPersisted(): Promise<PersistedImapAccount | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return null;
      const candidate = parsed as Partial<PersistedImapAccount>;
      if (candidate.schemaVersion !== 1 || !candidate.config || typeof candidate.passwordCiphertext !== 'string') {
        return null;
      }
      return {
        schemaVersion: 1,
        config: candidate.config,
        passwordCiphertext: candidate.passwordCiphertext,
        checkpoint: {
          uidValidity: candidate.checkpoint?.uidValidity ?? null,
          lastUid: Number.isSafeInteger(candidate.checkpoint?.lastUid) ? (candidate.checkpoint?.lastUid ?? null) : null,
        },
      };
    } catch (error) {
      if (isMissingFile(error) || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private async writePersisted(value: PersistedImapAccount): Promise<void> {
    const parent = dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(parent, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(this.filePath, { force: true });
      await rename(temporaryPath, this.filePath).catch(async (renameError) => {
        await rm(temporaryPath, { force: true });
        throw renameError;
      });
      if (error instanceof Error && !error.message) throw error;
    }
  }

  async load(): Promise<LoadedImapAccount | null> {
    const persisted = await this.readPersisted();
    if (!persisted) return null;
    if (!this.protector.isAvailable()) throw new SecureStorageUnavailableError();
    return {
      config: persisted.config,
      password: this.protector.decrypt(Buffer.from(persisted.passwordCiphertext, 'base64')),
      checkpoint: persisted.checkpoint,
    };
  }

  async save({
    config,
    password,
  }: {
    config: Omit<WinkGoMailAccountInput, 'password'>;
    password?: string;
  }): Promise<void> {
    const existing = await this.readPersisted();
    let passwordCiphertext = existing?.passwordCiphertext ?? '';
    if (password !== undefined) {
      if (!this.protector.isAvailable()) throw new SecureStorageUnavailableError();
      passwordCiphertext = this.protector.encrypt(password).toString('base64');
    }
    if (!passwordCiphertext) throw new Error('missing_password');

    const sameMailbox =
      existing?.config.email === config.email &&
      existing.config.host === config.host &&
      existing.config.username === config.username;
    await this.writePersisted({
      schemaVersion: 1,
      config,
      passwordCiphertext,
      checkpoint: sameMailbox
        ? (existing?.checkpoint ?? { uidValidity: null, lastUid: null })
        : { uidValidity: null, lastUid: null },
    });
  }

  async updateCheckpoint(uidValidity: string | null, lastUid: number | null): Promise<void> {
    const existing = await this.readPersisted();
    if (!existing) return;
    await this.writePersisted({ ...existing, checkpoint: { uidValidity, lastUid } });
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
