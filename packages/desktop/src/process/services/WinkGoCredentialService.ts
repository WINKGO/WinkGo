/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  WinkGoAuthCredentials,
  WinkGoAuthResult,
  WinkGoAuthSession,
  WinkGoAuthUser,
} from '@/common/adapter/ipcBridge';
import { resolveWinkGoEditionSnapshot } from '@/common/types/platform/winkGoEdition';
import { getPlatformServices } from '@/common/platform';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const MAX_SECRET_BYTES = 2_400;
const MAX_OUTPUT_BYTES = 16 * 1024;

const WIN_CREDENTIAL_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
public static class WinkGoSharedCredentialBridge {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr credential);

  public static byte[] Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) return null;
    try {
      var credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      var data = new byte[credential.CredentialBlobSize];
      if (data.Length > 0) Marshal.Copy(credential.CredentialBlob, data, 0, data.Length);
      return data;
    } finally {
      CredFree(pointer);
    }
  }

  public static bool Write(string target, byte[] data) {
    IntPtr targetPointer = Marshal.StringToCoTaskMemUni(target);
    IntPtr userPointer = Marshal.StringToCoTaskMemUni("WINK GO");
    IntPtr dataPointer = Marshal.AllocCoTaskMem(data.Length);
    try {
      if (data.Length > 0) Marshal.Copy(data, 0, dataPointer, data.Length);
      var credential = new CREDENTIAL {
        Type = 1,
        TargetName = targetPointer,
        CredentialBlobSize = (UInt32)data.Length,
        CredentialBlob = dataPointer,
        Persist = 2,
        UserName = userPointer
      };
      return CredWrite(ref credential, 0);
    } finally {
      Marshal.FreeCoTaskMem(targetPointer);
      Marshal.FreeCoTaskMem(userPointer);
      Marshal.FreeCoTaskMem(dataPointer);
    }
  }

  public static bool Delete(string target) {
    if (CredDelete(target, 1, 0)) return true;
    return Marshal.GetLastWin32Error() == 1168;
  }
}`;

const runCredentialPowerShell = async (
  body: string,
  options: { input?: string; targets?: string[]; timeoutMs?: number } = {}
): Promise<string> => {
  if (process.platform !== 'win32') throw new Error('安全凭据当前只支持 Windows。');
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const encoded = Buffer.from(`$ErrorActionPreference='Stop'\n${body}`, 'utf16le').toString('base64');

  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: {
        ...process.env,
        WINKGO_CREDENTIAL_TARGETS: (options.targets ?? []).join('|'),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let settled = false;
    const finish = (task: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      task();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('Windows 凭据管理器响应超时。')));
    }, options.timeoutMs ?? 15_000);
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= MAX_OUTPUT_BYTES) stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errorBytes += chunk.byteLength;
      if (errorBytes <= MAX_OUTPUT_BYTES) stderr.push(chunk);
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('exit', (code) =>
      finish(() => {
        if (code === 0) resolve(Buffer.concat(stdout).toString('utf8').trim());
        else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || 'Windows 凭据操作失败。'));
      })
    );
    child.stdin.end(options.input ?? '');
  });
};

export const readWinkGoCredential = async (target: string): Promise<string | null> => {
  const output = await runCredentialPowerShell(
    `Add-Type -TypeDefinition @'\n${WIN_CREDENTIAL_SOURCE}\n'@\n` +
      `$value=[WinkGoSharedCredentialBridge]::Read(($env:WINKGO_CREDENTIAL_TARGETS -split '\\|')[0])\n` +
      `if ($null -ne $value) { [Console]::Out.Write([Convert]::ToBase64String($value)) }`,
    { targets: [target] }
  );
  return output ? Buffer.from(output, 'base64').toString('utf8') : null;
};

export const getWinkGoCredentialStatus = async (targets: string[]): Promise<Record<string, boolean>> => {
  if (targets.length === 0) return {};
  const output = await runCredentialPowerShell(
    `Add-Type -TypeDefinition @'\n${WIN_CREDENTIAL_SOURCE}\n'@\n` +
      `$targets=$env:WINKGO_CREDENTIAL_TARGETS -split '\\|'\n` +
      `foreach($target in $targets) { if ($null -eq [WinkGoSharedCredentialBridge]::Read($target)) { '0' } else { '1' } }`,
    { targets }
  );
  const values = output.split(/\r?\n/);
  return Object.fromEntries(targets.map((target, index) => [target, values[index]?.trim() === '1']));
};

export const writeWinkGoCredential = async (target: string, value: string): Promise<void> => {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength === 0) throw new Error('凭据不能为空。');
  if (bytes.byteLength > MAX_SECRET_BYTES) throw new Error('凭据过长，Windows 凭据管理器最多保存 2400 字节。');
  await runCredentialPowerShell(
    `Add-Type -TypeDefinition @'\n${WIN_CREDENTIAL_SOURCE}\n'@\n` +
      `$payload=[Console]::In.ReadToEnd().Trim()\n` +
      `$value=[Convert]::FromBase64String($payload)\n` +
      `$target=($env:WINKGO_CREDENTIAL_TARGETS -split '\\|')[0]\n` +
      `if (-not [WinkGoSharedCredentialBridge]::Write($target,$value)) { throw 'Windows 凭据写入失败。' }`,
    { input: bytes.toString('base64'), targets: [target] }
  );
};

export const deleteWinkGoCredential = async (target: string): Promise<void> => {
  await runCredentialPowerShell(
    `Add-Type -TypeDefinition @'\n${WIN_CREDENTIAL_SOURCE}\n'@\n` +
      `$target=($env:WINKGO_CREDENTIAL_TARGETS -split '\\|')[0]\n` +
      `if (-not [WinkGoSharedCredentialBridge]::Delete($target)) { throw 'Windows 凭据删除失败。' }`,
    { targets: [target] }
  );
};

type StoredWinkGoAccount = WinkGoAuthUser & {
  passwordSalt: string;
  passwordHash: string;
};

type WinkGoAccountStore = {
  schemaVersion: 1;
  accounts: StoredWinkGoAccount[];
};

export type WinkGoCredentialValidation = {
  valid: boolean;
  username: string;
  message?: string;
};

const AUTH_STORE_SCHEMA_VERSION = 1;
const AUTH_HASH_BYTES = 64;
const AUTH_SALT_BYTES = 24;
const MIN_USERNAME_LENGTH = 2;
const MAX_USERNAME_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 256;
const scryptAsync = promisify(scrypt);
const noopRelease = (): void => {};

const emptyAccountStore = (): WinkGoAccountStore => ({
  schemaVersion: AUTH_STORE_SCHEMA_VERSION,
  accounts: [],
});

const toPublicAuthUser = (account: StoredWinkGoAccount): WinkGoAuthUser => ({
  id: account.id,
  username: account.username,
  provider: account.provider,
  createdAt: account.createdAt,
  lastLoginAt: account.lastLoginAt,
  loginCount: account.loginCount,
});

const normalizeUsername = (username: string): string => username.normalize('NFKC').trim();
const containsControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127;
  });

export function validateWinkGoAuthCredentials(
  credentials: WinkGoAuthCredentials,
  options: { allowLegacyNumericUsername?: boolean } = {}
): WinkGoCredentialValidation {
  const username = normalizeUsername(credentials.username);
  if (
    username.length < MIN_USERNAME_LENGTH ||
    username.length > MAX_USERNAME_LENGTH ||
    containsControlCharacter(username)
  ) {
    return { valid: false, username, message: 'username' };
  }
  if (!options.allowLegacyNumericUsername && /^\d+$/.test(username)) {
    return { valid: false, username, message: 'usernameNumeric' };
  }
  if (credentials.password.length < MIN_PASSWORD_LENGTH || credentials.password.length > MAX_PASSWORD_LENGTH) {
    return { valid: false, username, message: 'password' };
  }
  return { valid: true, username };
}

const derivePasswordHash = async (password: string, salt: Buffer): Promise<Buffer> =>
  (await scryptAsync(password, salt, AUTH_HASH_BYTES)) as Buffer;

/**
 * Local desktop account registry.
 *
 * Accounts are device-local and passwords are stored only as salted scrypt
 * hashes. The authenticated session stays in memory, so app startup never
 * performs a heartbeat or background validation request.
 */
export class WinkGoDesktopAuthService {
  private currentUser: WinkGoAuthUser | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly resolveStorePath: () => string = () =>
      path.join(getPlatformServices().paths.getDataDir(), 'winkgo-auth', 'accounts.json')
  ) {}

  getSession(): WinkGoAuthSession {
    return {
      authenticated: this.currentUser !== null,
      user: this.currentUser,
      edition: resolveWinkGoEditionSnapshot({
        buildEdition: 'pro',
        authenticated: this.currentUser !== null,
        developmentBypass: true,
      }),
      oauth: {
        google: false,
        wechat: false,
      },
    };
  }

  async register(credentials: WinkGoAuthCredentials): Promise<WinkGoAuthResult> {
    return this.runExclusive(async () => {
      const validation = validateWinkGoAuthCredentials(credentials);
      if (!validation.valid) {
        return { success: false, code: 'validationError', message: validation.message };
      }

      try {
        const store = await this.readStore();
        const accountExists = store.accounts.some(
          (account) => account.username.toLocaleLowerCase() === validation.username.toLocaleLowerCase()
        );
        if (accountExists) {
          return { success: false, code: 'accountExists' };
        }

        const now = new Date().toISOString();
        const salt = randomBytes(AUTH_SALT_BYTES);
        const passwordHash = await derivePasswordHash(credentials.password, salt);
        const account: StoredWinkGoAccount = {
          id: randomUUID(),
          username: validation.username,
          provider: 'local',
          createdAt: now,
          lastLoginAt: now,
          loginCount: 1,
          passwordSalt: salt.toString('base64'),
          passwordHash: passwordHash.toString('base64'),
        };
        store.accounts.push(account);
        await this.writeStore(store);
        this.currentUser = toPublicAuthUser(account);
        return { success: true, user: this.currentUser };
      } catch (error) {
        console.error('[WINK GO Auth] Failed to register local account:', error);
        return { success: false, code: 'serverError' };
      }
    });
  }

  async login(credentials: WinkGoAuthCredentials): Promise<WinkGoAuthResult> {
    return this.runExclusive(async () => {
      const validation = validateWinkGoAuthCredentials(credentials, { allowLegacyNumericUsername: true });
      if (!validation.valid) {
        return { success: false, code: 'invalidCredentials' };
      }

      try {
        const store = await this.readStore();
        const account = store.accounts.find(
          (candidate) => candidate.username.toLocaleLowerCase() === validation.username.toLocaleLowerCase()
        );
        if (!account) {
          return { success: false, code: 'invalidCredentials' };
        }

        const expectedHash = Buffer.from(account.passwordHash, 'base64');
        const actualHash = await derivePasswordHash(credentials.password, Buffer.from(account.passwordSalt, 'base64'));
        if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
          return { success: false, code: 'invalidCredentials' };
        }

        account.lastLoginAt = new Date().toISOString();
        account.loginCount += 1;
        await this.writeStore(store);
        this.currentUser = toPublicAuthUser(account);
        return { success: true, user: this.currentUser };
      } catch (error) {
        console.error('[WINK GO Auth] Failed to sign in to local account:', error);
        return { success: false, code: 'serverError' };
      }
    });
  }

  logout(): void {
    this.currentUser = null;
  }

  private async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.operationQueue;
    let release: () => void = noopRelease;
    this.operationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await task();
    } finally {
      release();
    }
  }

  private async readStore(): Promise<WinkGoAccountStore> {
    const storePath = this.resolveStorePath();
    try {
      const raw = await fs.readFile(storePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<WinkGoAccountStore>;
      if (parsed.schemaVersion !== AUTH_STORE_SCHEMA_VERSION || !Array.isArray(parsed.accounts)) {
        throw new Error('Unsupported WINK GO account registry format.');
      }
      return parsed as WinkGoAccountStore;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyAccountStore();
      }
      throw error;
    }
  }

  private async writeStore(store: WinkGoAccountStore): Promise<void> {
    const storePath = this.resolveStorePath();
    const directory = path.dirname(storePath);
    const temporaryPath = path.join(directory, `accounts.${randomUUID()}.tmp`);
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(temporaryPath, storePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch((): undefined => undefined);
    }
  }
}

export const winkGoDesktopAuthService = new WinkGoDesktopAuthService();
