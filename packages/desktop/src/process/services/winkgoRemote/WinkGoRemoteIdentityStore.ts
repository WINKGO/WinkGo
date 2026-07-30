/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, safeStorage } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deleteWinkGoCredential, readWinkGoCredential, writeWinkGoCredential } from '../WinkGoCredentialService';
import {
  cloudAccountMatchesLicenseAccount,
  isWinkGoCloudAccountId,
  isWinkGoLicenseAccountId,
  toWinkGoCloudAccountId,
} from '../winkgoCloud/account-identity';

const IDENTITY_SCHEMA_VERSION = 2;
const METADATA_DIRECTORY = 'com.winkgo.desktop';
const METADATA_FILENAME = 'remote-gateway.json';
const DEVICE_TOKEN_TARGET = 'WINKGO.RELAY.device-token';
const LICENSE_ASSERTION_TARGET = 'WINKGO.RELAY.license-assertion';
const LEGACY_IDENTITY_FILENAME = 'winkgo-miniapp-bridge.json';
const LEGACY_LICENSE_FILENAME = 'winkgo.license.session.json';

type StoredIdentityMetadata = {
  schemaVersion: 2;
  accountId: string;
  installationId: string;
  desktopId: string;
  deviceName: string;
  enrolled: boolean;
  migratedFromLegacy: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WinkGoRemoteIdentity = StoredIdentityMetadata & {
  deviceToken: string;
  licenseAssertion: string;
};

const nowIso = (): string => new Date().toISOString();
const clean = (value: unknown, max: number): string =>
  (typeof value === 'string' ? value : '')
    .trim()
    .replace(/[\r\n\t]/g, ' ')
    .slice(0, max);

const isDesktopId = (value: string): boolean => isUuid(value);
const isAccountId = (value: string): boolean => isWinkGoCloudAccountId(value) || isWinkGoLicenseAccountId(value);
const isUuid = (value: string): boolean =>
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

const metadataPath = (): string => path.join(app.getPath('appData'), METADATA_DIRECTORY, METADATA_FILENAME);

const legacyRoots = (): string[] => {
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return [
    app.getPath('userData'),
    path.join(roaming, 'WinkGo', 'bridge'),
    path.join(roaming, 'Wink Go', 'bridge'),
    path.join(local, 'WinkGo', 'bridge'),
  ];
};

const legacyIdentityPaths = (): string[] => [
  ...new Set(legacyRoots().map((root) => path.resolve(root, LEGACY_IDENTITY_FILENAME))),
];

const legacyLicensePaths = (): string[] => {
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return [
    path.join(app.getPath('userData'), LEGACY_LICENSE_FILENAME),
    path.join(roaming, 'WinkGo', 'license', LEGACY_LICENSE_FILENAME),
    path.join(roaming, 'Wink Go', 'license', LEGACY_LICENSE_FILENAME),
    path.join(local, 'WinkGo', 'license', LEGACY_LICENSE_FILENAME),
  ];
};

const readJson = async (filePath: string): Promise<Record<string, unknown> | null> => {
  try {
    const data = await fs.readFile(filePath);
    if (data.byteLength > 256 * 1024) return null;
    const parsed = JSON.parse(data.toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const writeMetadata = async (metadata: StoredIdentityMetadata): Promise<void> => {
  const target = metadataPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(temporary, target);
};

const decryptLegacyWindowsSecret = async (protectedValue: string): Promise<string> => {
  if (process.platform !== 'win32' || !protectedValue.startsWith('win:')) return '';
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const script = [
    "$ErrorActionPreference='Stop'",
    '$value=[Console]::In.ReadToEnd().Trim()',
    '$secure=ConvertTo-SecureString $value',
    "$plain=[System.Net.NetworkCredential]::new('', $secure).Password",
    '[Console]::Out.Write($plain)',
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), 8_000);
    child.stdout.on('data', (chunk: Buffer) => {
      if (Buffer.concat(chunks).byteLength < 8_192) chunks.push(chunk);
    });
    child.once('error', () => {
      clearTimeout(timer);
      resolve('');
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? Buffer.concat(chunks).toString('utf8').trim() : '');
    });
    child.stdin.end(protectedValue.slice(4));
  });
};

const revealLegacyToken = async (raw: Record<string, unknown>): Promise<string> => {
  const protectedValue = clean(raw.deviceTokenProtected, 16_000);
  if (protectedValue.startsWith('win:')) return decryptLegacyWindowsSecret(protectedValue);
  if (protectedValue) {
    try {
      if (!safeStorage.isEncryptionAvailable()) return '';
      const encoded = protectedValue.startsWith('enc:') ? protectedValue.slice(4) : protectedValue;
      return safeStorage.decryptString(Buffer.from(encoded, 'base64')).trim();
    } catch {
      return '';
    }
  }
  return app.isPackaged ? '' : clean(raw.deviceToken, 2_400);
};

const readLegacyIdentity = async (): Promise<{
  desktopId: string;
  deviceName: string;
  deviceToken: string;
} | null> => {
  const candidates = await Promise.all(
    legacyIdentityPaths().map(async (candidate) => {
      const raw = await readJson(candidate);
      if (!raw) return null;
      const desktopId = clean(raw.deviceId, 128);
      const deviceToken = await revealLegacyToken(raw);
      if (!isDesktopId(desktopId) || !deviceToken) return null;
      return {
        desktopId,
        deviceName: clean(raw.deviceName, 64) || `${os.hostname() || '这台电脑'} 的 WINK GO`,
        deviceToken,
      };
    })
  );
  return candidates.find((candidate) => candidate !== null) ?? null;
};

const readLegacyLicenseAssertion = async (): Promise<string> => {
  const assertions = await Promise.all(
    legacyLicensePaths().map(async (candidate) => {
      const raw = await readJson(candidate);
      const lease = raw?.lease;
      return lease && typeof lease === 'object'
        ? clean((lease as Record<string, unknown>).offlineAssertion, 8_192)
        : '';
    })
  );
  return assertions.find((assertion) => assertion.length >= 128) ?? '';
};

const assertionIdentityClaims = (
  assertion: string
): {
  accountId: string;
  installationId: string;
} => {
  try {
    const payload = assertion.split('.')[1];
    if (!payload) return { accountId: '', installationId: '' };
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
    return {
      accountId: clean(decoded.account_id || decoded.accountId || decoded.sub, 64).toLowerCase(),
      installationId: clean(decoded.installation_id || decoded.installationId, 64).toLowerCase(),
    };
  } catch {
    return { accountId: '', installationId: '' };
  }
};

const createFreshIdentityMetadata = (
  accountId: string,
  deviceName: string,
  installationId: string = randomUUID()
): StoredIdentityMetadata => {
  const createdAt = nowIso();
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    accountId,
    installationId,
    desktopId: randomUUID(),
    deviceName,
    enrolled: false,
    migratedFromLegacy: false,
    createdAt,
    updatedAt: createdAt,
  };
};

const normalizeMetadata = (raw: Record<string, unknown> | null): StoredIdentityMetadata | null => {
  const schemaVersion = Number(raw?.schemaVersion);
  if (!raw || (schemaVersion !== 1 && schemaVersion !== IDENTITY_SCHEMA_VERSION)) return null;
  const desktopId = clean(raw.desktopId, 128);
  const installationId = clean(raw.installationId, 64);
  const accountId = clean(raw.accountId, 64).toLowerCase();
  if (!isDesktopId(desktopId) || !installationId) return null;
  return {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    accountId: isAccountId(accountId) ? accountId : '',
    installationId,
    desktopId,
    deviceName: clean(raw.deviceName, 64) || `${os.hostname() || '这台电脑'} 的 WINK GO`,
    enrolled: raw.enrolled === true,
    migratedFromLegacy: raw.migratedFromLegacy === true,
    createdAt: clean(raw.createdAt, 64) || nowIso(),
    updatedAt: clean(raw.updatedAt, 64) || nowIso(),
  };
};

export class WinkGoRemoteIdentityStore {
  private cached: WinkGoRemoteIdentity | null = null;

  async load(): Promise<WinkGoRemoteIdentity> {
    if (this.cached) return { ...this.cached };

    const storedMetadata = await readJson(metadataPath());
    const metadataNeedsUpgrade =
      storedMetadata !== null && Number(storedMetadata.schemaVersion) !== IDENTITY_SCHEMA_VERSION;
    let metadata = normalizeMetadata(storedMetadata);
    let deviceToken = await readWinkGoCredential(DEVICE_TOKEN_TARGET).catch((): null => null);
    let licenseAssertion = await readWinkGoCredential(LICENSE_ASSERTION_TARGET).catch((): null => null);

    if (!metadata || !deviceToken) {
      const legacy = await readLegacyIdentity();
      const createdAt = nowIso();
      metadata = {
        schemaVersion: IDENTITY_SCHEMA_VERSION,
        accountId: '',
        installationId: randomUUID(),
        desktopId: legacy?.desktopId || randomUUID(),
        deviceName: legacy?.deviceName || `${os.hostname() || '这台电脑'} 的 WINK GO`,
        enrolled: Boolean(legacy),
        migratedFromLegacy: Boolean(legacy),
        createdAt,
        updatedAt: createdAt,
      };
      deviceToken = legacy?.deviceToken || randomBytes(32).toString('base64url');
      await writeWinkGoCredential(DEVICE_TOKEN_TARGET, deviceToken);
      await writeMetadata(metadata);
    } else if (metadataNeedsUpgrade) {
      await writeMetadata(metadata);
    }

    if (!licenseAssertion) {
      licenseAssertion = await readLegacyLicenseAssertion();
      if (licenseAssertion) {
        await writeWinkGoCredential(LICENSE_ASSERTION_TARGET, licenseAssertion).catch((): undefined => undefined);
      }
    }

    this.cached = {
      ...metadata,
      deviceToken,
      licenseAssertion: licenseAssertion || '',
    };
    return { ...this.cached };
  }

  async markEnrolled(accountIdValue = ''): Promise<WinkGoRemoteIdentity> {
    const identity = await this.load();
    const accountId = clean(accountIdValue, 64).toLowerCase();
    if (accountId && !isAccountId(accountId)) {
      throw new Error('云端返回的客户账号身份无效。');
    }
    if (identity.accountId && accountId && identity.accountId !== accountId) {
      throw new Error('这台电脑已经绑定到其他 WINK GO 账号，已拒绝静默迁移。');
    }
    const nextAccountId = identity.accountId || accountId;
    if (identity.enrolled && identity.accountId === nextAccountId) return identity;
    const metadata: StoredIdentityMetadata = {
      schemaVersion: IDENTITY_SCHEMA_VERSION,
      accountId: nextAccountId,
      installationId: identity.installationId,
      desktopId: identity.desktopId,
      deviceName: identity.deviceName,
      enrolled: true,
      migratedFromLegacy: identity.migratedFromLegacy,
      createdAt: identity.createdAt,
      updatedAt: nowIso(),
    };
    await writeMetadata(metadata);
    this.cached = { ...identity, ...metadata };
    return { ...this.cached };
  }

  async syncLicenseAssertionFromSession(accountIdValue: string): Promise<string> {
    const accountId = clean(accountIdValue, 64).toLowerCase();
    if (!isWinkGoCloudAccountId(accountId)) {
      throw new Error('云账号身份无效，请重新登录。');
    }
    const licenseAssertion = await readLegacyLicenseAssertion();
    if (!licenseAssertion) {
      throw new Error('云账号没有可用的签名授权，请重新登录后再试。');
    }
    const signedClaims = assertionIdentityClaims(licenseAssertion);
    const signedAccountId = signedClaims.accountId;
    if (
      signedAccountId &&
      signedAccountId !== accountId &&
      !cloudAccountMatchesLicenseAccount(accountId, signedAccountId)
    ) {
      throw new Error('云账号签名与当前登录账号不一致，请退出后重新登录。');
    }
    const signedInstallationId = isUuid(signedClaims.installationId) ? signedClaims.installationId : '';

    let identity = await this.load();
    if (identity.accountId !== accountId) {
      const isLegacyIdentityForCurrentAccount =
        isWinkGoLicenseAccountId(identity.accountId) && toWinkGoCloudAccountId(identity.accountId) === accountId;
      const preserveDesktopIdentity = !identity.accountId || isLegacyIdentityForCurrentAccount;
      const metadata: StoredIdentityMetadata = preserveDesktopIdentity
        ? {
            schemaVersion: IDENTITY_SCHEMA_VERSION,
            accountId,
            installationId: signedInstallationId || identity.installationId,
            desktopId: identity.desktopId,
            deviceName: identity.deviceName,
            enrolled: identity.enrolled,
            migratedFromLegacy: true,
            createdAt: identity.createdAt,
            updatedAt: nowIso(),
          }
        : createFreshIdentityMetadata(accountId, identity.deviceName, signedInstallationId || randomUUID());
      const deviceToken = preserveDesktopIdentity ? identity.deviceToken : randomBytes(32).toString('base64url');
      await writeWinkGoCredential(DEVICE_TOKEN_TARGET, deviceToken);
      await writeMetadata(metadata);
      identity = {
        ...metadata,
        deviceToken,
        licenseAssertion: '',
      };
    } else if (signedInstallationId && identity.installationId !== signedInstallationId) {
      // The relay validates the installation carried by the signed cloud
      // assertion. Keep the local desktop possession token, but align the
      // installation routing identity with the authenticated cloud session.
      const metadata: StoredIdentityMetadata = {
        schemaVersion: IDENTITY_SCHEMA_VERSION,
        accountId,
        installationId: signedInstallationId,
        desktopId: identity.desktopId,
        deviceName: identity.deviceName,
        enrolled: false,
        migratedFromLegacy: identity.migratedFromLegacy,
        createdAt: identity.createdAt,
        updatedAt: nowIso(),
      };
      await writeMetadata(metadata);
      identity = {
        ...identity,
        ...metadata,
        licenseAssertion: '',
      };
    }

    await writeWinkGoCredential(LICENSE_ASSERTION_TARGET, licenseAssertion);
    this.cached = {
      ...identity,
      licenseAssertion,
    };
    return licenseAssertion;
  }

  async clearLicenseAssertion(): Promise<void> {
    await deleteWinkGoCredential(LICENSE_ASSERTION_TARGET).catch((): undefined => undefined);
    if (this.cached) {
      this.cached = {
        ...this.cached,
        licenseAssertion: '',
      };
    }
  }

  async rotateDesktopIdentity(): Promise<WinkGoRemoteIdentity> {
    const identity = await this.load();
    const metadata: StoredIdentityMetadata = {
      schemaVersion: IDENTITY_SCHEMA_VERSION,
      accountId: identity.accountId,
      installationId: identity.installationId,
      desktopId: randomUUID(),
      deviceName: identity.deviceName,
      enrolled: false,
      migratedFromLegacy: false,
      createdAt: identity.createdAt,
      updatedAt: nowIso(),
    };
    const deviceToken = randomBytes(32).toString('base64url');
    await writeWinkGoCredential(DEVICE_TOKEN_TARGET, deviceToken);
    await writeMetadata(metadata);
    this.cached = {
      ...metadata,
      deviceToken,
      licenseAssertion: identity.licenseAssertion,
    };
    return { ...this.cached };
  }

  clearCache(): void {
    this.cached = null;
  }

  getMetadataPath(): string {
    return metadataPath();
  }
}
