/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  WinkGoAuthCredentials,
  WinkGoAuthErrorCode,
  WinkGoAuthResult,
  WinkGoAuthSession,
  WinkGoAuthUser,
} from '@/common/adapter/ipcBridge';
import {
  hasWinkGoCapability,
  normalizeWinkGoBuildEdition,
  resolveWinkGoEditionSnapshot,
  type WinkGoCapability,
} from '@/common/types/platform/winkGoEdition';
import { app, net } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import legacyLicenseModule, {
  type LegacyLicenseAccount,
  type LegacyLicenseResult,
  type LegacyLicenseService,
} from './winkgoCloud/license-service.cjs';
import { toWinkGoCloudAccountId } from './winkgoCloud/account-identity';

const LICENSE_CONFIG_FILE = 'winkgo.license.config.json';
const LICENSE_SESSION_FILE = 'winkgo.license.session.json';
const LICENSE_INSTALLATION_FILE = 'winkgo.installation.json';
const AUTH_SESSION_POLICY_FILE = 'winkgo.auth-session-policy.json';

// Version 2 deliberately invalidates the historical development/test sessions
// that were mirrored into multiple legacy product directories. Future account
// sessions remain in the active WINK GO userData directory and survive normal
// application upgrades.
const AUTH_SESSION_POLICY_VERSION = 2;

const legacyRoots = (): string[] => {
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return [
    path.join(roaming, 'WinkGo', 'license'),
    path.join(roaming, 'Wink Go', 'license'),
    path.join(local, 'WinkGo', 'license'),
  ];
};

const backupPaths = (fileName: string): string[] => legacyRoots().map((root) => path.join(root, fileName));

const readAuthSessionPolicyVersion = (): number => {
  try {
    const filePath = path.join(app.getPath('userData'), AUTH_SESSION_POLICY_FILE);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as { version?: unknown };
    return Number(parsed.version) || 0;
  } catch {
    return 0;
  }
};

const writeAuthSessionPolicy = (): void => {
  const filePath = path.join(app.getPath('userData'), AUTH_SESSION_POLICY_FILE);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(
    temporaryPath,
    `${JSON.stringify(
      {
        version: AUTH_SESSION_POLICY_VERSION,
        appliedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  // Windows renameSync does not replace an existing destination. Remove the
  // previous policy marker first so future policy-version bumps remain safe.
  rmSync(filePath, { force: true });
  renameSync(temporaryPath, filePath);
};

const removeLegacySessionBackups = (): void => {
  for (const legacySessionPath of backupPaths(LICENSE_SESSION_FILE)) {
    try {
      if (existsSync(legacySessionPath)) {
        rmSync(legacySessionPath, { force: true });
      }
    } catch (error) {
      console.warn('[WINK GO Cloud] Could not remove a legacy account-session backup.', {
        fileName: path.basename(legacySessionPath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

const removeActiveSessionFile = (): void => {
  const activeSessionPath = path.join(app.getPath('userData'), LICENSE_SESSION_FILE);
  if (existsSync(activeSessionPath)) {
    rmSync(activeSessionPath, { force: true });
  }
};

const enforceAuthSessionPolicy = (service: LegacyLicenseService): boolean => {
  if (readAuthSessionPolicyVersion() === AUTH_SESSION_POLICY_VERSION) {
    return true;
  }

  try {
    // Clear the active profile first, then remove the historical mirrors. The
    // session backup list is intentionally empty below, so clearSession cannot
    // recreate those legacy files.
    service.clearSession();
    // The legacy service represents a signed-out state by writing a blank
    // session object. For the one-time privacy migration we remove the active
    // file entirely so no account-derived bytes from a previous installation
    // remain on disk.
    removeActiveSessionFile();
    removeLegacySessionBackups();
    writeAuthSessionPolicy();
    console.info('[WINK GO Cloud] Historical test login sessions were invalidated.');
    return true;
  } catch (error) {
    // Fail closed: an old account must never be treated as authenticated if the
    // privacy migration could not be completed.
    console.error('[WINK GO Cloud] Failed to apply account-session privacy policy.', error);
    return false;
  }
};

const bounded = (value: unknown, max: number): string =>
  (typeof value === 'string' || typeof value === 'number' ? String(value) : '').trim().slice(0, max);

const stableAccountId = (account: LegacyLicenseAccount, username: string): string => {
  return toWinkGoCloudAccountId(bounded(account.id, 128), username);
};

const toAuthUser = (account: LegacyLicenseAccount | null | undefined): WinkGoAuthUser | null => {
  if (!account) return null;
  const username = bounded(account.username, 128);
  if (!username) return null;
  const now = new Date().toISOString();
  return {
    id: stableAccountId(account, username),
    username,
    phone: bounded(account.phone, 32) || undefined,
    provider: 'winkgo',
    createdAt: bounded(account.createdAt, 64) || now,
    lastLoginAt: bounded(account.lastLoginAt, 64) || now,
    loginCount: Math.max(1, Number(account.loginCount) || 1),
  };
};

const errorCode = (result: LegacyLicenseResult): WinkGoAuthErrorCode => {
  const message = `${result.error || ''} ${result.detail || ''}`.toLowerCase();
  if (/invalid.*credential|password.*invalid|account.*not.*found|unauthori[sz]ed/.test(message)) {
    return 'invalidCredentials';
  }
  if (/already.*exist|account_exists|username.*exist/.test(message)) return 'accountExists';
  if (/too.*many|rate.*limit/.test(message)) return 'tooManyAttempts';
  if (/license|lease|device.*(?:blocked|denied|disabled|revoked)|authorization/.test(message)) {
    return 'licenseDenied';
  }
  if (/unreachable|network|timeout|fetch|econn|dns|socket/.test(message)) return 'networkError';
  if (/missing_required_fields|password_too_short|format|validation/.test(message)) return 'validationError';
  return 'serverError';
};

const publicError = (result: LegacyLicenseResult): WinkGoAuthResult => ({
  success: false,
  code: errorCode(result),
  message: bounded(result.error || result.detail, 320) || 'WINK GO 云账号服务暂时不可用。',
});

const defaultLegacyService = (): LegacyLicenseService =>
  legacyLicenseModule.createLicenseService({
    app,
    appendLog: (message, details = {}) => {
      console.info(`[WINK GO Cloud] ${message}`, details);
    },
    getVersionInfo: () => ({ currentVersion: app.getVersion() }),
    netFetch: (input, init) => net.fetch(input, init),
    backupFilePaths: {
      config: backupPaths(LICENSE_CONFIG_FILE),
      // Account sessions are private to the active application profile. They
      // must never be restored from a previous product name or old installation.
      session: [],
      installation: backupPaths(LICENSE_INSTALLATION_FILE),
    },
  });

export class WinkGoCloudAuthService {
  private service: LegacyLicenseService | null = null;
  private readonly serviceFactory: () => LegacyLicenseService;
  private readonly enforceLocalSessionPolicy: boolean;
  private sessionPolicyReady = true;

  constructor(serviceFactory?: () => LegacyLicenseService) {
    this.serviceFactory = serviceFactory || defaultLegacyService;
    this.enforceLocalSessionPolicy = !serviceFactory;
  }

  getSession(): WinkGoAuthSession {
    const service = this.getService();
    if (!this.sessionPolicyReady) {
      return {
        authenticated: false,
        user: null,
        edition: resolveWinkGoEditionSnapshot({
          buildEdition: normalizeWinkGoBuildEdition(process.env.WINKGO_EDITION),
          authenticated: false,
        }),
        oauth: {
          google: false,
          wechat: false,
        },
      };
    }
    const status = service.getStatus();
    const internalSession = service.readSession();
    const user = toAuthUser(internalSession.account || status.session?.account);
    // WINK GO accounts are ordinary product accounts. A successful account
    // login must not be blocked by the old desktop-license/heartbeat system.
    // Remote-device relay credentials are optional and are synchronized
    // separately after login.
    const authenticated = Boolean(user);
    const edition = resolveWinkGoEditionSnapshot({
      buildEdition: normalizeWinkGoBuildEdition(process.env.WINKGO_EDITION),
      authenticated,
      entitlements: internalSession.entitlements || status.session?.entitlements,
      developmentBypass: !app?.isPackaged,
    });
    return {
      authenticated,
      user: authenticated ? user : null,
      edition,
      oauth: {
        google: false,
        wechat: false,
      },
    };
  }

  hasUsableSession(): boolean {
    return this.getSession().authenticated;
  }

  hasCapability(capability: WinkGoCapability): boolean {
    return hasWinkGoCapability(this.getSession().edition, capability);
  }

  getLicenseAssertion(): string {
    return bounded(this.getService().readSession().lease?.offlineAssertion, 8_192);
  }

  async login(credentials: WinkGoAuthCredentials): Promise<WinkGoAuthResult> {
    const result = await this.getService().remoteLogin({
      username: credentials.username,
      password: credentials.password,
    });
    return this.finishAuthentication(result);
  }

  async register(credentials: WinkGoAuthCredentials): Promise<WinkGoAuthResult> {
    const result = await this.getService().remoteRegister({
      username: credentials.username,
      password: credentials.password,
      phone: credentials.phone,
    });
    return this.finishAuthentication(result);
  }

  async logout(): Promise<void> {
    await this.getService().remoteLogout();
  }

  clearSession(): void {
    this.getService().clearSession();
  }

  private finishAuthentication(result: LegacyLicenseResult): WinkGoAuthResult {
    if (!result.ok) return publicError(result);
    const session = this.getSession();
    if (!session.authenticated || !session.user) {
      return {
        success: false,
        code: 'serverError',
        message: '账号服务未返回有效的用户信息，请稍后重试。',
      };
    }
    return {
      success: true,
      user: session.user,
    };
  }

  private getService(): LegacyLicenseService {
    if (!this.service) {
      this.service = this.serviceFactory();
      if (this.enforceLocalSessionPolicy) {
        this.sessionPolicyReady = enforceAuthSessionPolicy(this.service);
      }
    }
    return this.service;
  }
}

export const winkGoCloudAuthService = new WinkGoCloudAuthService();
