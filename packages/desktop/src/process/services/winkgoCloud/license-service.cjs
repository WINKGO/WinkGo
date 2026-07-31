const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { protectWindowsSecret, unprotectWindowsSecret } = require('./windows-dpapi.cjs');

const LICENSE_CONFIG_FILE = 'winkgo.license.config.json';
const LICENSE_SESSION_FILE = 'winkgo.license.session.json';
const LICENSE_INSTALLATION_FILE = 'winkgo.installation.json';
const DEFAULT_OFFLINE_GRACE_HOURS = 48;
const DEFAULT_HEARTBEAT_INTERVAL_HOURS = 12;
const LICENSE_CONFIG_LOCK_MESSAGE = '设备码服务为托管配置，不能手动关闭。';
const LICENSE_SERVICE_UNREACHABLE = 'license_service_unreachable';
const LICENSE_LOCAL_STATE_UNAVAILABLE = 'local_auth_state_unavailable';
const LICENSE_REQUEST_TIMEOUT_MS = 8000;
const LICENSE_MAX_REDIRECTS = 3;
const LICENSE_SESSION_SEAL_VERSION = 2;
const LICENSE_SESSION_SEAL_ALGORITHM = 'hmac-sha256-installation';
const OFFLINE_ASSERTION_VERSION = 1;
const OFFLINE_ASSERTION_CLOCK_SKEW_SECONDS = 300;
const POLICY_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMBEDDED_OFFLINE_ASSERTION_PUBLIC_KEYS = Object.freeze({
  e337a51e1702e14c:
    '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAGtj/dJO6bCcv6rGPwlg+0cRv6B9cuNUVomT78cOLqB0=\n-----END PUBLIC KEY-----\n',
});
const PUBLIC_MANAGED_LICENSE_ENDPOINT = 'https://****/license/index.php?route=****';
const PUBLIC_MANAGED_PROJECT_ID = 'winkgo-****';
const MANAGED_LICENSE_TEXT_KEY = [17, 23, 31, 41, 53, 67, 79, 59, 29];
const MANAGED_LICENSE_ENDPOINT_CIPHER = [
  121, 99, 107, 89, 70, 121, 96, 20, 106, 120, 121, 116, 78, 90, 109, 59, 84, 109, 62, 123, 118, 74, 80, 45, 60, 94, 50,
  120, 121, 123, 76, 77, 109, 63, 83, 109, 46, 101, 112, 92, 65, 38, 114,
];
const MANAGED_LICENSE_PROJECT_CIPHER = [102, 126, 113, 66, 82, 44, 98, 87, 116, 114, 114, 113, 90, 80];

function decodeManagedLicenseText(cipher = []) {
  return cipher
    .map((value, index) =>
      String.fromCharCode(Number(value) ^ MANAGED_LICENSE_TEXT_KEY[index % MANAGED_LICENSE_TEXT_KEY.length])
    )
    .join('');
}

function getManagedLicenseEndpoint() {
  return decodeManagedLicenseText(MANAGED_LICENSE_ENDPOINT_CIPHER);
}

function getManagedProjectId() {
  return decodeManagedLicenseText(MANAGED_LICENSE_PROJECT_CIPHER);
}

function buildPolicyConsentPayload(input, expectedSource) {
  const privacyVersion = String(input?.privacyVersion || '')
    .trim()
    .slice(0, 40);
  const termsVersion = String(input?.termsVersion || '')
    .trim()
    .slice(0, 40);
  const source = String(input?.source || '')
    .trim()
    .slice(0, 48);
  if (
    !POLICY_VERSION_PATTERN.test(privacyVersion) ||
    !POLICY_VERSION_PATTERN.test(termsVersion) ||
    source !== expectedSource
  ) {
    return {};
  }
  // The server must assign acceptedAt from its own clock. The desktop only
  // supplies the exact policy versions and the fixed flow identifier.
  return { privacyVersion, termsVersion, source };
}

function redactLicenseText(value) {
  const text = String(value || '');
  if (!text) return '';
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <redacted>')
    .replace(
      /([?&](?:access[_-]?token|auth|code|invite(?:_code)?|key|password|secret|token)=)[^&#\s"'<>]*/gi,
      '$1<redacted>'
    )
    .replace(
      /("(?:access[_-]?token|auth|code|invite(?:_code)?|key|password|secret|token)"\s*:\s*")[^"]*(")/gi,
      '$1<redacted>$2'
    )
    .replace(/https?:\/\/[^\s"'<>]+/gi, PUBLIC_MANAGED_LICENSE_ENDPOINT);
}

function redactLicensePayload(value, parentKey = '') {
  if (
    /(authorization|auth[_-]?token|password|secret|token|invite(?:code)?|activationcode|api[_-]?key)/i.test(
      String(parentKey || '')
    )
  ) {
    return value ? '<redacted>' : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactLicensePayload(item, parentKey));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).reduce((result, key) => {
      result[key] = redactLicensePayload(value[key], key);
      return result;
    }, {});
  }
  if (typeof value === 'string') {
    return redactLicenseText(value);
  }
  return value;
}

function sanitizePublicLicenseValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePublicLicenseValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((result, [key, item]) => {
      if (/(authorization|auth[_-]?token|password|secret|token|assertion|private[_-]?key|api[_-]?key)/i.test(key)) {
        return result;
      }
      result[key] = sanitizePublicLicenseValue(item);
      return result;
    }, {});
  }
  return value;
}

function buildDefaultLicenseEndpoints() {
  const managedEndpoint = String(getManagedLicenseEndpoint()).trim().replace(/\/+$/, '');
  const endpoints = [];

  if (managedEndpoint) {
    endpoints.push(managedEndpoint);
  }

  return [...new Set(endpoints)];
}

const DEFAULT_LICENSE_ENDPOINTS = buildDefaultLicenseEndpoints();
const MANAGED_LICENSE_CONFIG = {
  provider: 'tencent',
  apiBaseUrl: DEFAULT_LICENSE_ENDPOINTS[0],
  apiBaseUrls: DEFAULT_LICENSE_ENDPOINTS,
  projectId: getManagedProjectId(),
  offlineGraceHours: DEFAULT_OFFLINE_GRACE_HOURS,
  heartbeatIntervalHours: DEFAULT_HEARTBEAT_INTERVAL_HOURS,
  enabled: true,
};
const DEFAULT_CLOUD_FEATURE_KEYS = [
  'runtime.start',
  'runtime.tools',
  'skill.wechat',
  'skill.music',
  'skill.windows',
  'skill.smart_home',
  'skill.desktop_agents',
  'integration.openclaw',
  'integration.hermes',
  'integration.codex',
  'integration.claude',
];
const CONTROLLED_FEATURE_KEYS = new Set(DEFAULT_CLOUD_FEATURE_KEYS);

function isEnvTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function createLicenseService({
  app,
  appendLog,
  getVersionInfo,
  netFetch = null,
  backupFilePaths = {},
  developmentOfflineAssertionPublicKeys = {},
  localSecretProtector = null,
}) {
  let fingerprintInputCache = null;
  let fingerprintHashCache = '';
  let installationCache = null;
  let sessionSealKeyCache = '';
  const protectedSecretCache = new Map();

  function appendLicenseLog(message, details = {}) {
    appendLog(message, redactLicensePayload(details));
  }

  function normalizeBackupPaths(paths = []) {
    return [
      ...new Set(
        (Array.isArray(paths) ? paths : [paths])
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .map((item) => path.resolve(item))
      ),
    ];
  }

  const backupPaths = {
    config: normalizeBackupPaths(backupFilePaths.config),
    session: normalizeBackupPaths(backupFilePaths.session),
    installation: normalizeBackupPaths(backupFilePaths.installation),
  };

  function hasRemoteLicenseConfig(config = {}) {
    const apiBaseUrl = String(config?.apiBaseUrl || '').trim();
    const apiBaseUrls = Array.isArray(config?.apiBaseUrls)
      ? config.apiBaseUrls.map((item) => String(item || '').trim()).filter(Boolean)
      : [];

    return Boolean(config?.enabled && (apiBaseUrl || apiBaseUrls.length > 0));
  }

  function getFilePath(fileName) {
    return path.join(app.getPath('userData'), fileName);
  }

  function ensureDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function readJsonCandidate(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        return { ok: false, missing: true, error: '' };
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw.trim()) {
        return { ok: false, missing: false, error: 'empty_json' };
      }
      return { ok: true, value: JSON.parse(raw) };
    } catch (error) {
      return {
        ok: false,
        missing: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  function readJson(filePath, fallback) {
    const result = readJsonCandidate(filePath);
    return result.ok ? result.value : fallback;
  }

  function writeJson(filePath, payload) {
    ensureDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }

  function writeJsonWithBackups(filePath, payload, backups = []) {
    const written = writeJson(filePath, payload);
    for (const backupPath of backups) {
      if (!backupPath || path.resolve(backupPath) === path.resolve(filePath)) {
        continue;
      }
      try {
        writeJson(backupPath, payload);
      } catch (error) {
        appendLicenseLog('Failed to mirror license data backup', {
          fileName: path.basename(filePath),
          backupPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return written;
  }

  function readJsonWithBackups(filePath, fallback, backups = []) {
    const primary = readJsonCandidate(filePath);
    if (primary.ok) {
      for (const backupPath of backups) {
        if (!backupPath || path.resolve(backupPath) === path.resolve(filePath)) {
          continue;
        }
        try {
          if (!fs.existsSync(backupPath)) {
            writeJson(backupPath, primary.value);
          }
        } catch (_error) {
          // Backup mirroring must never block startup.
        }
      }
      return primary.value;
    }

    for (const backupPath of backups) {
      const backup = readJsonCandidate(backupPath);
      if (!backup.ok) {
        continue;
      }
      try {
        writeJson(filePath, backup.value);
      } catch (_error) {
        // Best effort restore; still return the recovered data.
      }
      appendLicenseLog('Restored license data from persistent backup', {
        fileName: path.basename(filePath),
        backupPath,
      });
      return backup.value;
    }

    return fallback;
  }

  function normalizeConfig(input = {}) {
    const merged = {
      ...MANAGED_LICENSE_CONFIG,
      ...input,
    };
    const normalizedManagedUrls = DEFAULT_LICENSE_ENDPOINTS.map((value) =>
      String(value || '')
        .trim()
        .replace(/\/+$/, '')
    ).filter(Boolean);
    const apiBaseUrls = [
      ...new Set(normalizedManagedUrls.length > 0 ? normalizedManagedUrls : [MANAGED_LICENSE_CONFIG.apiBaseUrl]),
    ];
    const apiBaseUrl =
      String(apiBaseUrls[0] || MANAGED_LICENSE_CONFIG.apiBaseUrl)
        .trim()
        .replace(/\/+$/, '') ||
      apiBaseUrls[0] ||
      MANAGED_LICENSE_CONFIG.apiBaseUrl;

    return {
      provider: MANAGED_LICENSE_CONFIG.provider,
      apiBaseUrl,
      apiBaseUrls,
      projectId: String(merged.projectId || MANAGED_LICENSE_CONFIG.projectId).trim(),
      offlineGraceHours: Math.max(
        1,
        Number(merged.offlineGraceHours || DEFAULT_OFFLINE_GRACE_HOURS) || DEFAULT_OFFLINE_GRACE_HOURS
      ),
      heartbeatIntervalHours: Math.max(
        1,
        Number(merged.heartbeatIntervalHours || DEFAULT_HEARTBEAT_INTERVAL_HOURS) || DEFAULT_HEARTBEAT_INTERVAL_HOURS
      ),
      enabled: MANAGED_LICENSE_CONFIG.enabled,
    };
  }

  function buildPublicConfigSnapshot(config = normalizeConfig({})) {
    return {
      provider: 'winkgo',
      apiBaseUrl: PUBLIC_MANAGED_LICENSE_ENDPOINT,
      apiBaseUrls: [PUBLIC_MANAGED_LICENSE_ENDPOINT],
      projectId: PUBLIC_MANAGED_PROJECT_ID,
      offlineGraceHours: Math.max(
        1,
        Number(config.offlineGraceHours || DEFAULT_OFFLINE_GRACE_HOURS) || DEFAULT_OFFLINE_GRACE_HOURS
      ),
      heartbeatIntervalHours: Math.max(
        1,
        Number(config.heartbeatIntervalHours || DEFAULT_HEARTBEAT_INTERVAL_HOURS) || DEFAULT_HEARTBEAT_INTERVAL_HOURS
      ),
      enabled: MANAGED_LICENSE_CONFIG.enabled,
      managed: true,
    };
  }

  function persistedConfigMayExposeEndpoint(raw = {}) {
    try {
      const text = JSON.stringify(raw || {});
      return /https?:\/\//i.test(text) && !text.includes('****');
    } catch (_error) {
      return false;
    }
  }

  function getDefaultSession() {
    return {
      account: null,
      device: null,
      entitlements: {},
      lease: {
        token: '',
        tokenProtected: '',
        issuedAt: '',
        expiresAt: '',
        offlineGraceUntil: '',
        offlineAssertion: '',
      },
      authorizationEpochs: {
        global: 0,
        account: 0,
      },
      source: 'none',
      lastValidatedAt: '',
      lastHeartbeatAt: '',
    };
  }

  function normalizeSession(input = {}) {
    return {
      ...getDefaultSession(),
      ...input,
      activation:
        input.activation && typeof input.activation === 'object' && !Array.isArray(input.activation)
          ? input.activation
          : null,
      entitlements:
        input.entitlements && typeof input.entitlements === 'object' && !Array.isArray(input.entitlements)
          ? input.entitlements
          : {},
      lease: {
        ...getDefaultSession().lease,
        ...(input.lease && typeof input.lease === 'object' && !Array.isArray(input.lease) ? input.lease : {}),
      },
      authorizationEpochs: {
        ...getDefaultSession().authorizationEpochs,
        ...(input.authorizationEpochs &&
        typeof input.authorizationEpochs === 'object' &&
        !Array.isArray(input.authorizationEpochs)
          ? input.authorizationEpochs
          : {}),
      },
    };
  }

  function canonicalizeValue(value) {
    if (Array.isArray(value)) {
      return value.map((item) => canonicalizeValue(item));
    }
    if (value && typeof value === 'object') {
      return Object.keys(value)
        .sort()
        .reduce((result, key) => {
          if (key === 'seal') {
            return result;
          }
          result[key] = canonicalizeValue(value[key]);
          return result;
        }, {});
    }
    return value;
  }

  function isEmptySession(session = {}) {
    const normalized = normalizeSession(session);
    return (
      !normalized.account &&
      !normalized.device &&
      !normalized.lease?.token &&
      !normalized.lease?.expiresAt &&
      !normalized.lease?.offlineGraceUntil &&
      normalized.source === 'none'
    );
  }

  function getConfigPath() {
    return getFilePath(LICENSE_CONFIG_FILE);
  }

  function getSessionPath() {
    return getFilePath(LICENSE_SESSION_FILE);
  }

  function getInstallationPath() {
    return getFilePath(LICENSE_INSTALLATION_FILE);
  }

  function readConfig() {
    const raw = readJsonWithBackups(getConfigPath(), normalizeConfig({}), backupPaths.config);
    const normalized = normalizeConfig(raw);
    if (persistedConfigMayExposeEndpoint(raw)) {
      try {
        writeJsonWithBackups(getConfigPath(), buildPublicConfigSnapshot(normalized), backupPaths.config);
      } catch (_error) {
        // Do not block startup when the user data dir is temporarily read-only.
      }
    }
    return normalized;
  }

  function writeConfig(input = {}) {
    const normalized = normalizeConfig(input);
    writeJsonWithBackups(getConfigPath(), buildPublicConfigSnapshot(normalized), backupPaths.config);
    return normalized;
  }

  function saveConfig(input = {}) {
    const attemptedManagedOverride =
      Object.prototype.hasOwnProperty.call(input || {}, 'apiBaseUrl') ||
      Object.prototype.hasOwnProperty.call(input || {}, 'apiBaseUrls') ||
      Object.prototype.hasOwnProperty.call(input || {}, 'provider') ||
      Object.prototype.hasOwnProperty.call(input || {}, 'projectId');

    if (Object.prototype.hasOwnProperty.call(input || {}, 'enabled') && !input.enabled) {
      return {
        ok: false,
        error: LICENSE_CONFIG_LOCK_MESSAGE,
        config: buildPublicConfigSnapshot(readConfig()),
      };
    }

    if (attemptedManagedOverride) {
      appendLicenseLog('Ignored managed license config override attempt', {
        keys: Object.keys(input || {}),
      });
    }

    const nextInput = {
      ...input,
      provider: MANAGED_LICENSE_CONFIG.provider,
      projectId: MANAGED_LICENSE_CONFIG.projectId,
      apiBaseUrl: MANAGED_LICENSE_CONFIG.apiBaseUrl,
      apiBaseUrls: [...MANAGED_LICENSE_CONFIG.apiBaseUrls],
      enabled: MANAGED_LICENSE_CONFIG.enabled,
    };

    return {
      ok: true,
      config: buildPublicConfigSnapshot(writeConfig(nextInput)),
    };
  }

  function readSession() {
    const normalized = normalizeSession(
      readJsonWithBackups(getSessionPath(), getDefaultSession(), backupPaths.session)
    );
    if (!normalized.lease.token && normalized.lease.tokenProtected) {
      normalized.lease.token = unprotectLocalSecret(normalized.lease.tokenProtected);
    }
    return normalized;
  }

  function maskActivationCode(value) {
    const text = String(value || '')
      .trim()
      .replace(/\s+/g, '');
    if (!text) return '';
    if (text.length <= 4) return `${text.slice(0, 1)}***`;
    if (text.length <= 8) return `${text.slice(0, 2)}****${text.slice(-1)}`;
    return `${text.slice(0, 4)}****${text.slice(-4)}`;
  }

  function buildActivationSummary(inviteCode, payload = {}) {
    const code = String(inviteCode || '').trim();
    const remoteActivation =
      payload.activation && typeof payload.activation === 'object' && !Array.isArray(payload.activation)
        ? payload.activation
        : {};
    const codePreview = String(
      remoteActivation.codePreview ||
        payload.activationCodePreview ||
        payload.inviteCodePreview ||
        payload.invitationCodePreview ||
        maskActivationCode(code) ||
        ''
    ).trim();
    const codeHash = String(
      remoteActivation.codeHash ||
        payload.activationCodeHash ||
        (code ? crypto.createHash('sha256').update(code).digest('hex').slice(0, 16) : '')
    ).trim();

    if (!codePreview && !codeHash) {
      return null;
    }

    return {
      codePreview,
      codeHash,
      activatedAt: String(
        remoteActivation.activatedAt || payload.activationAt || payload.activatedAt || new Date().toISOString()
      ).trim(),
    };
  }

  function writeSession(input = {}) {
    const sealed = attachSessionSeal(input);
    const stored = normalizeSession(sealed);
    if (stored.lease.token) {
      stored.lease.tokenProtected = protectLocalSecret(stored.lease.token);
      stored.lease.token = '';
    } else {
      stored.lease.tokenProtected = '';
    }
    writeJsonWithBackups(getSessionPath(), stored, backupPaths.session);
    return sealed;
  }

  function clearSession() {
    return writeSession(getDefaultSession());
  }

  function getElectronSafeStorage() {
    try {
      const electron = require('electron');
      const safeStorage = electron && typeof electron === 'object' ? electron.safeStorage : null;
      return safeStorage?.isEncryptionAvailable?.() ? safeStorage : null;
    } catch (_error) {
      return null;
    }
  }

  function protectLocalSecret(secret) {
    const text = String(secret || '');
    if (!text) return '';
    if (localSecretProtector?.protect) {
      const protectedValue = `custom:${String(localSecretProtector.protect(text) || '')}`;
      protectedSecretCache.set(protectedValue, text);
      return protectedValue;
    }
    // Direct Windows DPAPI is independent of Electron's Chromium profile.
    // That makes mirrored credentials recoverable after a repair install or
    // userData path migration without weakening the current-user binding.
    const windowsProtected = protectWindowsSecret(text);
    if (windowsProtected) {
      protectedSecretCache.set(windowsProtected, text);
      return windowsProtected;
    }
    const safeStorage = getElectronSafeStorage();
    if (safeStorage) {
      const protectedValue = `enc:${safeStorage.encryptString(text).toString('base64')}`;
      protectedSecretCache.set(protectedValue, text);
      return protectedValue;
    }
    if (!app.isPackaged) {
      const encoded = `dev:${Buffer.from(text, 'utf8').toString('base64')}`;
      protectedSecretCache.set(encoded, text);
      return encoded;
    }
    throw new Error('license_local_secret_protection_unavailable');
  }

  function unprotectLocalSecret(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (protectedSecretCache.has(text)) {
      return protectedSecretCache.get(text);
    }
    let plain = '';
    if (text.startsWith('custom:') && localSecretProtector?.unprotect) {
      plain = String(localSecretProtector.unprotect(text.slice(7)) || '');
    }
    if (!plain && text.startsWith('enc:')) {
      const safeStorage = getElectronSafeStorage();
      if (!safeStorage) return '';
      try {
        plain = safeStorage.decryptString(Buffer.from(text.slice(4), 'base64'));
      } catch (_error) {
        return '';
      }
    }
    if (!plain && text.startsWith('win:')) {
      plain = unprotectWindowsSecret(text);
    }
    if (!plain && text.startsWith('dev:') && !app.isPackaged) {
      try {
        plain = Buffer.from(text.slice(4), 'base64').toString('utf8');
      } catch (_error) {
        return '';
      }
    }
    if (plain) {
      protectedSecretCache.set(text, plain);
    }
    return plain;
  }

  function getProtectedSealKeyCandidates(installation = {}) {
    const installationId = String(installation.installationId || '');
    const candidates = [installation.sessionSealKeyProtected, installation.sessionSealKeyProtectedFallback];
    for (const backupPath of backupPaths.installation) {
      const backup = readJsonCandidate(backupPath);
      if (backup.ok && String(backup.value?.installationId || '') === installationId) {
        candidates.push(backup.value?.sessionSealKeyProtected, backup.value?.sessionSealKeyProtectedFallback);
      }
    }
    return [...new Set(candidates.map((item) => String(item || '').trim()).filter(Boolean))];
  }

  function readOrCreateInstallation() {
    if (installationCache?.installationId && sessionSealKeyCache) {
      return installationCache;
    }
    const stored = readJsonWithBackups(getInstallationPath(), null, backupPaths.installation);
    const installation = stored?.installationId
      ? { ...stored }
      : {
          installationId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        };
    const primaryProtectedSealKey = String(installation.sessionSealKeyProtected || '').trim();
    let protectedSealKey = '';
    let sealKey = '';
    for (const candidate of getProtectedSealKeyCandidates(installation)) {
      const candidateSealKey = unprotectLocalSecret(candidate);
      if (candidateSealKey) {
        protectedSealKey = candidate;
        sealKey = candidateSealKey;
        break;
      }
    }
    if (primaryProtectedSealKey && !sealKey) {
      // A copied/corrupted DPAPI value cannot authenticate any existing
      // session. Rotate the local seal key so status/login remain reachable;
      // the old session will fail its seal check and require cloud login.
      appendLicenseLog('Rotating unreadable local license session key', {
        installationIdPresent: Boolean(installation.installationId),
      });
      protectedSealKey = '';
      installation.sessionSealKeyRecoveryAt = new Date().toISOString();
    }
    if (!sealKey) {
      sealKey = crypto.randomBytes(32).toString('base64url');
      protectedSealKey = protectLocalSecret(sealKey);
      installation.sessionSealKeyCreatedAt = new Date().toISOString();
    } else if (process.platform === 'win32' && !protectedSealKey.startsWith('win:')) {
      const portableProtectedSealKey = protectLocalSecret(sealKey);
      if (portableProtectedSealKey.startsWith('win:')) {
        protectedSealKey = portableProtectedSealKey;
        installation.sessionSealKeyMigratedAt = new Date().toISOString();
        appendLicenseLog('Migrated local license session key to profile-independent DPAPI');
      }
    }
    installation.sessionSealKeyVersion = protectedSealKey.startsWith('win:') ? 2 : 1;
    installation.sessionSealKeyProtected = protectedSealKey;
    writeJsonWithBackups(getInstallationPath(), installation, backupPaths.installation);
    installationCache = installation;
    sessionSealKeyCache = sealKey;
    return installationCache;
  }

  function getSessionSealKey() {
    if (!sessionSealKeyCache) {
      readOrCreateInstallation();
    }
    if (!sessionSealKeyCache) {
      throw new Error('license_local_session_key_unavailable');
    }
    return sessionSealKeyCache;
  }

  function tryReadWindowsMachineGuid() {
    if (process.platform !== 'win32') {
      return '';
    }

    try {
      const output = require('child_process').spawnSync(
        'reg',
        ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
        {
          windowsHide: true,
          encoding: 'utf8',
        }
      );

      const text = String(output.stdout || '');
      const match = text.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      return match ? String(match[1] || '').trim() : '';
    } catch (_error) {
      return '';
    }
  }

  function tryReadSystemDriveSerial() {
    if (process.platform !== 'win32') {
      return '';
    }

    try {
      const output = require('child_process').spawnSync('cmd.exe', ['/d', '/s', '/c', 'vol C:'], {
        windowsHide: true,
        encoding: 'utf8',
      });
      const text = String(output.stdout || '');
      const match = text.match(/([A-F0-9]{4}-[A-F0-9]{4})/i);
      return match ? String(match[1] || '').trim() : '';
    } catch (_error) {
      return '';
    }
  }

  function getFingerprintInput() {
    if (fingerprintInputCache) {
      return { ...fingerprintInputCache };
    }
    fingerprintInputCache = {
      machineGuid: tryReadWindowsMachineGuid(),
      systemVolumeSerial: tryReadSystemDriveSerial(),
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
    };
    return { ...fingerprintInputCache };
  }

  function getFingerprintHash() {
    if (fingerprintHashCache) {
      return fingerprintHashCache;
    }
    const input = getFingerprintInput();
    const raw = JSON.stringify(input);
    fingerprintHashCache = crypto.createHash('sha256').update(raw).digest('hex');
    return fingerprintHashCache;
  }

  function getDeviceSnapshot() {
    const installation = readOrCreateInstallation();
    return {
      installationId: installation.installationId,
      fingerprintHash: getFingerprintHash(),
      appVersion: getVersionInfo().currentVersion,
    };
  }

  function buildSessionSealPayload(session = {}, device = getDeviceSnapshot()) {
    const normalized = normalizeSession(session);
    return {
      version: LICENSE_SESSION_SEAL_VERSION,
      binding: {
        installationId: String(device.installationId || ''),
        fingerprintHash: String(device.fingerprintHash || ''),
      },
      session: {
        account: canonicalizeValue(normalized.account || null),
        device: canonicalizeValue(normalized.device || null),
        activation: canonicalizeValue(normalized.activation || null),
        entitlements: canonicalizeValue(normalized.entitlements || {}),
        authorizationEpochs: canonicalizeValue(normalized.authorizationEpochs || {}),
        lease: {
          token: String(normalized.lease?.token || ''),
          issuedAt: String(normalized.lease?.issuedAt || ''),
          expiresAt: String(normalized.lease?.expiresAt || ''),
          offlineGraceUntil: String(normalized.lease?.offlineGraceUntil || ''),
          offlineAssertion: String(normalized.lease?.offlineAssertion || ''),
        },
        source: String(normalized.source || ''),
        lastValidatedAt: String(normalized.lastValidatedAt || ''),
        lastHeartbeatAt: String(normalized.lastHeartbeatAt || ''),
      },
    };
  }

  function signSession(session = {}, device = getDeviceSnapshot()) {
    return crypto
      .createHmac('sha256', getSessionSealKey())
      .update(JSON.stringify(buildSessionSealPayload(session, device)))
      .digest('hex');
  }

  function attachSessionSeal(input = {}) {
    const normalized = normalizeSession(input);
    if (isEmptySession(normalized)) {
      const empty = normalizeSession(normalized);
      delete empty.seal;
      return empty;
    }
    const device = getDeviceSnapshot();
    const sealed = normalizeSession(normalized);
    sealed.seal = {
      version: LICENSE_SESSION_SEAL_VERSION,
      algorithm: LICENSE_SESSION_SEAL_ALGORITHM,
      installationId: String(device.installationId || ''),
      fingerprintHash: String(device.fingerprintHash || ''),
      value: signSession(sealed, device),
    };
    return sealed;
  }

  function decodeAssertionPart(value) {
    const text = String(value || '').trim();
    if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) {
      throw new Error('offline_assertion_encoding_invalid');
    }
    return Buffer.from(text, 'base64url');
  }

  function readAssertionClaim(payload, ...keys) {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(payload || {}, key)) {
        return payload[key];
      }
    }
    return undefined;
  }

  function normalizeEpoch(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
  }

  function verifyOfflineAssertion(session = readSession(), options = {}) {
    const normalized = normalizeSession(session);
    const assertion = String(normalized.lease?.offlineAssertion || '').trim();
    if (!assertion) {
      return {
        ok: !options.requirePresent,
        present: false,
        expiresAt: '',
        reason: options.requirePresent ? '离线授权断言缺失，请联网重新登录。' : '',
      };
    }

    try {
      const parts = assertion.split('.');
      if (parts.length !== 3 || parts.some((part) => !part)) {
        throw new Error('offline_assertion_format_invalid');
      }
      const header = JSON.parse(decodeAssertionPart(parts[0]).toString('utf8'));
      const claims = JSON.parse(decodeAssertionPart(parts[1]).toString('utf8'));
      if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') {
        throw new Error('offline_assertion_payload_invalid');
      }
      const headerVersion = Number(header.v ?? header.version ?? 0);
      const claimVersion = Number(claims.v ?? claims.version ?? 0);
      if (
        String(header.alg || '') !== 'EdDSA' ||
        String(header.typ || '') !== 'WGL1' ||
        headerVersion !== OFFLINE_ASSERTION_VERSION ||
        claimVersion !== OFFLINE_ASSERTION_VERSION
      ) {
        throw new Error('offline_assertion_algorithm_or_version_invalid');
      }
      const keyId = String(header.kid || '').trim();
      const trustedKeys = {
        ...EMBEDDED_OFFLINE_ASSERTION_PUBLIC_KEYS,
        ...(!app.isPackaged &&
        developmentOfflineAssertionPublicKeys &&
        typeof developmentOfflineAssertionPublicKeys === 'object'
          ? developmentOfflineAssertionPublicKeys
          : {}),
      };
      const publicKey = keyId ? trustedKeys[keyId] : null;
      if (!publicKey) {
        throw new Error('offline_assertion_key_untrusted');
      }
      const signature = decodeAssertionPart(parts[2]);
      const signatureValid = crypto.verify(null, Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'), publicKey, signature);
      if (!signatureValid) {
        throw new Error('offline_assertion_signature_invalid');
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const issuedAt = Number(readAssertionClaim(claims, 'iat'));
      const expiresAt = Number(readAssertionClaim(claims, 'exp'));
      if (
        !Number.isSafeInteger(issuedAt) ||
        !Number.isSafeInteger(expiresAt) ||
        issuedAt <= 0 ||
        expiresAt <= issuedAt ||
        issuedAt > nowSeconds + OFFLINE_ASSERTION_CLOCK_SKEW_SECONDS ||
        (!options.allowExpired && expiresAt + OFFLINE_ASSERTION_CLOCK_SKEW_SECONDS <= nowSeconds) ||
        expiresAt - issuedAt > DEFAULT_OFFLINE_GRACE_HOURS * 60 * 60 + OFFLINE_ASSERTION_CLOCK_SKEW_SECONDS
      ) {
        throw new Error('offline_assertion_time_invalid');
      }

      const device = getDeviceSnapshot();
      const expectedClaims = {
        projectId: String(getManagedProjectId() || ''),
        accountId: String(normalized.account?.id || ''),
        deviceId: String(normalized.device?.id || ''),
        installationId: String(device.installationId || ''),
        fingerprintHash: String(device.fingerprintHash || ''),
      };
      const actualClaims = {
        projectId: String(readAssertionClaim(claims, 'project_id', 'projectId') || ''),
        accountId: String(readAssertionClaim(claims, 'account_id', 'accountId') || ''),
        deviceId: String(readAssertionClaim(claims, 'device_id', 'deviceId') || ''),
        installationId: String(readAssertionClaim(claims, 'installation_id', 'installationId') || ''),
        fingerprintHash: String(readAssertionClaim(claims, 'fingerprint_hash', 'fingerprintHash') || ''),
      };
      if (
        Object.keys(expectedClaims).some((key) => !expectedClaims[key] || actualClaims[key] !== expectedClaims[key])
      ) {
        throw new Error('offline_assertion_binding_invalid');
      }

      const expectedGlobalEpoch = normalizeEpoch(normalized.authorizationEpochs?.global);
      const expectedAccountEpoch = normalizeEpoch(normalized.authorizationEpochs?.account);
      const actualGlobalEpoch = normalizeEpoch(readAssertionClaim(claims, 'global_epoch', 'globalEpoch'));
      const actualAccountEpoch = normalizeEpoch(readAssertionClaim(claims, 'account_epoch', 'accountEpoch'));
      if (
        expectedGlobalEpoch < 0 ||
        expectedAccountEpoch < 0 ||
        actualGlobalEpoch !== expectedGlobalEpoch ||
        actualAccountEpoch !== expectedAccountEpoch
      ) {
        throw new Error('offline_assertion_epoch_invalid');
      }

      const assertedEntitlements = readAssertionClaim(claims, 'entitlements');
      if (
        !assertedEntitlements ||
        typeof assertedEntitlements !== 'object' ||
        Array.isArray(assertedEntitlements) ||
        JSON.stringify(canonicalizeValue(assertedEntitlements)) !==
          JSON.stringify(canonicalizeValue(normalized.entitlements || {}))
      ) {
        throw new Error('offline_assertion_entitlements_invalid');
      }

      return {
        ok: true,
        present: true,
        keyId,
        issuedAt: new Date(issuedAt * 1000).toISOString(),
        expiresAt: new Date(expiresAt * 1000).toISOString(),
        claims,
        reason: '',
      };
    } catch (error) {
      appendLicenseLog('Offline license assertion verification failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        present: true,
        expiresAt: '',
        reason: '离线授权断言无效，请联网重新登录。',
      };
    }
  }

  function verifySessionSeal(session = readSession()) {
    const normalized = normalizeSession(session);
    if (isEmptySession(normalized)) {
      return { ok: true, sealed: false, empty: true, reason: '' };
    }

    const seal = normalized.seal || {};
    const hasSeal = Boolean(String(seal.value || '').trim());
    const strict = Boolean(app.isPackaged || isEnvTruthy(process.env.WINKGO_STRICT_LICENSE_SEAL));
    if (!hasSeal) {
      return {
        ok: !strict,
        sealed: false,
        legacy: true,
        reason: strict ? '授权会话缺少本机签名，请重新登录。' : '',
      };
    }

    if (
      Number(seal.version || 0) !== LICENSE_SESSION_SEAL_VERSION ||
      String(seal.algorithm || '') !== LICENSE_SESSION_SEAL_ALGORITHM
    ) {
      return {
        ok: false,
        sealed: true,
        legacy: true,
        reason: '授权会话使用旧版共享签名，请重新登录。',
      };
    }

    const device = getDeviceSnapshot();
    const expected = signSession(normalized, device);
    const actual = String(seal.value || '')
      .trim()
      .toLowerCase();
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = /^[a-f0-9]{64}$/i.test(actual) ? Buffer.from(actual, 'hex') : Buffer.alloc(0);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
      return {
        ok: false,
        sealed: true,
        legacy: false,
        reason: '授权会话签名无效，请重新登录。',
      };
    }
    if (
      String(seal.installationId || '') !== String(device.installationId || '') ||
      String(seal.fingerprintHash || '') !== String(device.fingerprintHash || '')
    ) {
      return {
        ok: false,
        sealed: true,
        legacy: false,
        reason: '授权会话不属于当前电脑，请重新登录。',
      };
    }
    const offlineAssertion = verifyOfflineAssertion(normalized, { allowExpired: true });
    if (!offlineAssertion.ok) {
      return {
        ok: false,
        sealed: true,
        legacy: false,
        serverSigned: true,
        reason: offlineAssertion.reason || '服务器授权签名无效，请重新登录。',
      };
    }
    return {
      ok: true,
      sealed: true,
      legacy: false,
      serverSigned: offlineAssertion.present,
      reason: '',
    };
  }

  function isSessionUsable(session = readSession()) {
    const normalized = normalizeSession(session);
    if (!verifySessionSeal(normalized).ok) {
      return false;
    }
    if (
      !normalized.account ||
      !normalized.device ||
      !String(normalized.lease?.token || '').trim() ||
      !isStatusAllowed(normalized.account?.status) ||
      !isStatusAllowed(normalized.device?.status) ||
      isExplicitlyExpired(normalized.account?.expiresAt) ||
      isExplicitlyExpired(normalized.device?.expiresAt)
    ) {
      return false;
    }
    const leaseExpiry = Date.parse(normalized.lease?.expiresAt || '');
    if (!Number.isNaN(leaseExpiry) && leaseExpiry > Date.now()) {
      return true;
    }
    const offlineAssertion = verifyOfflineAssertion(normalized, { requirePresent: true });
    return Boolean(offlineAssertion.ok && parseTimeMs(offlineAssertion.expiresAt) > Date.now());
  }

  function parseTimeMs(value) {
    const timestamp = Date.parse(String(value || ''));
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function isStatusAllowed(value) {
    const status = String(value || '')
      .trim()
      .toLowerCase();
    if (!status) {
      return true;
    }
    return !/(blocked|disabled|inactive|expired|revoked|suspended|locked|ban)/i.test(status);
  }

  function isExplicitlyExpired(value) {
    const expiresAt = parseTimeMs(value);
    return Boolean(expiresAt && expiresAt <= Date.now());
  }

  function getNetworkOutageGraceUntil(session = {}) {
    const normalized = normalizeSession(session);
    const offlineAssertion = verifyOfflineAssertion(normalized);
    const untilMs =
      offlineAssertion.ok && offlineAssertion.present
        ? parseTimeMs(offlineAssertion.expiresAt)
        : parseTimeMs(normalized.lease?.expiresAt);
    return untilMs ? new Date(untilMs).toISOString() : '';
  }

  function isCachedSessionUsable(session = readSession()) {
    return isSessionUsable(session);
  }

  function isFeatureAllowed(featureKey, session = readSession()) {
    if (!isCachedSessionUsable(session)) {
      return false;
    }

    if (!featureKey) {
      return true;
    }

    const entitlements = session.entitlements || {};
    if (!Object.prototype.hasOwnProperty.call(entitlements, featureKey)) {
      return !CONTROLLED_FEATURE_KEYS.has(featureKey);
    }

    return Boolean(entitlements[featureKey]);
  }

  function mapAuthResponseToSession(payload = {}) {
    return normalizeSession({
      account: payload.account || null,
      device: payload.device || null,
      activation: buildActivationSummary('', payload),
      entitlements: payload.entitlements || {},
      lease: {
        token: String(payload.leaseToken || '').trim(),
        issuedAt: String(payload.issuedAt || new Date().toISOString()).trim(),
        expiresAt: String(payload.expiresAt || '').trim(),
        offlineGraceUntil: String(payload.offlineGraceUntil || payload.expiresAt || '').trim(),
        offlineAssertion: String(payload.offlineAssertion || payload.offline_assertion || '').trim(),
      },
      authorizationEpochs: {
        global: normalizeEpoch(
          payload.globalEpoch ??
            payload.global_epoch ??
            payload.authEpoch ??
            payload.authorizationEpochs?.global ??
            payload.epochs?.global ??
            0
        ),
        account: normalizeEpoch(
          payload.accountEpoch ??
            payload.account_epoch ??
            payload.account?.authEpoch ??
            payload.authorizationEpochs?.account ??
            payload.epochs?.account ??
            0
        ),
      },
      source: payload.source || 'remote',
      lastValidatedAt: new Date().toISOString(),
      lastHeartbeatAt: payload.lastHeartbeatAt || '',
    });
  }

  async function performJsonRequest(
    fetchImpl,
    targetUrl,
    body,
    timeoutMs = LICENSE_REQUEST_TIMEOUT_MS,
    redirectCount = 0,
    trustedOrigin = ''
  ) {
    const parsedTarget = new URL(String(targetUrl || ''));
    if (parsedTarget.protocol !== 'https:' || parsedTarget.username || parsedTarget.password) {
      throw new Error('license_endpoint_must_use_https');
    }
    const requestOrigin = trustedOrigin || parsedTarget.origin;
    if (parsedTarget.origin !== requestOrigin) {
      throw new Error('license_redirect_cross_origin_blocked');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
        redirect: 'manual',
      });

      if ([301, 302, 303, 307, 308].includes(Number(response.status)) && redirectCount < LICENSE_MAX_REDIRECTS) {
        const location = response.headers?.get?.('location') || '';
        if (location) {
          const redirected = new URL(location, targetUrl);
          if (
            redirected.protocol !== 'https:' ||
            redirected.origin !== requestOrigin ||
            redirected.username ||
            redirected.password
          ) {
            throw new Error('license_redirect_not_allowed');
          }
          const redirectedUrl = redirected.toString();
          appendLicenseLog('Following license redirect with POST preserved', {
            status: response.status,
            targetUrl,
            redirectedUrl,
          });
          clearTimeout(timeoutId);
          return await performJsonRequest(fetchImpl, redirectedUrl, body, timeoutMs, redirectCount + 1, requestOrigin);
        }
      }

      const rawText = await response.text().catch(() => '');
      let payload = {};

      if (rawText) {
        try {
          payload = JSON.parse(rawText);
        } catch (_error) {
          payload = {
            raw: rawText,
          };
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        payload,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function postJson(targetUrl, body) {
    let primaryError = null;

    try {
      return await performJsonRequest(fetch, targetUrl, body);
    } catch (error) {
      primaryError = error;
      appendLicenseLog('Primary license request failed', {
        targetUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (typeof netFetch === 'function') {
      try {
        const response = await performJsonRequest(netFetch, targetUrl, body);
        appendLicenseLog('License request succeeded via Electron net stack', {
          targetUrl,
        });
        return response;
      } catch (error) {
        appendLicenseLog('Electron net license request failed', {
          targetUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    throw primaryError;
  }

  async function postJsonWithFallback(config, endpointPath, body) {
    const candidates = [];
    const preferred = String(config?.apiBaseUrl || '')
      .trim()
      .replace(/\/+$/, '');
    if (preferred) {
      candidates.push(preferred);
    }
    for (const item of Array.isArray(config?.apiBaseUrls) ? config.apiBaseUrls : []) {
      const normalized = String(item || '')
        .trim()
        .replace(/\/+$/, '');
      if (normalized && !candidates.includes(normalized)) {
        candidates.push(normalized);
      }
    }

    const attempts = [];
    for (const baseUrl of candidates) {
      try {
        const response = await postJson(buildLicenseRequestUrl(baseUrl, endpointPath), body);
        if (baseUrl !== config.apiBaseUrl) {
          writeConfig({
            ...config,
            apiBaseUrl: baseUrl,
            apiBaseUrls: candidates,
          });
        }
        return {
          ...response,
          baseUrl,
        };
      } catch (error) {
        attempts.push({
          baseUrl: redactLicenseText(baseUrl),
          error: redactLicenseText(error instanceof Error ? error.message : String(error)),
        });
        appendLicenseLog('License endpoint attempt failed', {
          endpointPath,
          baseUrl,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const combinedError = new Error(
      attempts.map((item) => `${item.baseUrl}: ${item.error}`).join(' | ') || LICENSE_SERVICE_UNREACHABLE
    );
    combinedError.attempts = attempts;
    throw combinedError;
  }

  function buildLicenseRequestUrl(baseUrl, endpointPath) {
    const rawBaseUrl = String(baseUrl || '').trim();
    const normalizedEndpoint = String(endpointPath || '')
      .trim()
      .replace(/^\/+/, '');
    if (!rawBaseUrl) {
      return `/${normalizedEndpoint}`;
    }

    if (/[?&]route=/i.test(rawBaseUrl)) {
      return rawBaseUrl.replace(/([?&]route=)([^&#]*)/i, `$1${normalizedEndpoint}`);
    }

    return `${rawBaseUrl.replace(/\/+$/, '')}/${normalizedEndpoint}`;
  }

  function buildNetworkError(error) {
    const detail = redactLicenseText(error instanceof Error ? error.message : String(error || ''));
    appendLicenseLog('License service request failed', {
      error: detail,
    });
    return {
      ok: false,
      error: LICENSE_SERVICE_UNREACHABLE,
      detail,
    };
  }

  function buildLocalStateError(error) {
    const detail = redactLicenseText(error instanceof Error ? error.message : String(error || ''));
    appendLicenseLog('Local account state is unavailable', {
      error: detail,
    });
    return {
      ok: false,
      error: LICENSE_LOCAL_STATE_UNAVAILABLE,
      detail,
    };
  }

  function buildCloudAuthResult(session, mode) {
    writeSession(session);
    return {
      ok: true,
      user: session.account,
      session: buildPublicSessionSnapshot(session),
      mode,
    };
  }

  function buildPublicSessionSnapshot(session = readSession()) {
    const normalized = normalizeSession(session);
    const tokenPresent = Boolean(String(normalized.lease?.token || '').trim());
    const offlineAssertion = verifyOfflineAssertion(normalized);
    const snapshot = {
      account: normalized.account ? sanitizePublicLicenseValue(normalized.account) : null,
      device: normalized.device ? sanitizePublicLicenseValue(normalized.device) : null,
      activation: normalized.activation || null,
      entitlements: { ...normalized.entitlements },
      authorizationEpochs: { ...normalized.authorizationEpochs },
      lease: {
        issuedAt: String(normalized.lease?.issuedAt || ''),
        expiresAt: String(normalized.lease?.expiresAt || ''),
        offlineGraceUntil:
          offlineAssertion.ok && offlineAssertion.present
            ? offlineAssertion.expiresAt
            : String(normalized.lease?.expiresAt || ''),
        hasToken: tokenPresent,
        hasOfflineAssertion: Boolean(offlineAssertion.ok && offlineAssertion.present),
      },
      source: String(normalized.source || ''),
      lastValidatedAt: String(normalized.lastValidatedAt || ''),
      lastHeartbeatAt: String(normalized.lastHeartbeatAt || ''),
    };
    return snapshot;
  }

  function clearSessionAfterExplicitDenial(response, operation) {
    const status = Number(response?.status || 0);
    const remoteError = String(response?.payload?.error || response?.payload?.code || '').trim();
    // A failed login/register validates only the supplied credentials. It is
    // not authoritative evidence that an already-issued lease was revoked.
    // Clearing here used to turn a typo into a logout and overwrite every
    // persistent session mirror with an empty session.
    if (operation !== 'heartbeat') {
      return false;
    }
    const explicitPayloadDenial =
      /(?:account|device|lease|session|token).*(?:blocked|disabled|expired|inactive|invalid|locked|revoked|suspended)|(?:blocked|disabled|expired|inactive|invalid|locked|revoked|suspended).*(?:account|device|lease|session|token)|unauthori[sz]ed/i.test(
        remoteError
      );
    if (!explicitPayloadDenial || status < 400 || status >= 500) {
      return false;
    }
    clearSession();
    appendLicenseLog('Cleared cached license session after explicit server denial', {
      operation,
      status,
      error: remoteError,
    });
    return true;
  }

  async function remoteLogin(input = {}) {
    let config;
    let device;
    try {
      config = readConfig();
      device = getDeviceSnapshot();
    } catch (error) {
      return buildLocalStateError(error);
    }
    if (!hasRemoteLicenseConfig(config)) {
      return { ok: false, error: '设备码服务尚未配置，当前仍使用本地模式。' };
    }

    let response;

    try {
      response = await postJsonWithFallback(config, '/auth/login', {
        username: String(input.username || '').trim(),
        password: String(input.password || ''),
        ...buildPolicyConsentPayload(input, 'desktop_login'),
        ...device,
      });
    } catch (error) {
      return buildNetworkError(error);
    }

    if (!response.ok || !response.payload?.ok) {
      appendLicenseLog('Cloud account login was rejected', {
        status: response.status,
        error: response.payload?.error || '',
        requestId: response.payload?.requestId || '',
      });
      return {
        ok: false,
        error: redactLicenseText(response.payload?.error || `Remote login failed (${response.status})`),
        sessionInvalidated: false,
      };
    }

    try {
      const session = mapAuthResponseToSession(response.payload);
      appendLicenseLog('Cloud license login succeeded', {
        username: String(input.username || '').trim(),
        provider: config.provider,
      });
      return buildCloudAuthResult(session, 'cloud');
    } catch (error) {
      return buildLocalStateError(error);
    }
  }

  async function remoteRegister(input = {}) {
    let config;
    try {
      config = readConfig();
    } catch (error) {
      return buildLocalStateError(error);
    }
    if (!hasRemoteLicenseConfig(config)) {
      return { ok: false, error: '设备码服务尚未配置，当前仍使用本地模式。' };
    }

    const username = String(input.username || '').trim();
    const password = String(input.password || '');
    const phone = String(input.phone || '').replace(/[\s()-]/g, '');
    if (!username || !password || !phone) {
      return { ok: false, error: 'missing_required_fields' };
    }
    if (!/^(?:1[3-9]\d{9}|\+[1-9]\d{7,14})$/.test(phone)) {
      return { ok: false, error: 'phone_format_invalid' };
    }
    if (password.length < 10) {
      return { ok: false, error: 'password_too_short' };
    }

    let device;
    try {
      device = getDeviceSnapshot();
    } catch (error) {
      return buildLocalStateError(error);
    }
    let response;

    try {
      response = await postJsonWithFallback(config, '/auth/register', {
        username,
        password,
        phone,
        ...buildPolicyConsentPayload(input, 'desktop_registration'),
        ...device,
      });
    } catch (error) {
      return buildNetworkError(error);
    }

    if (!response.ok || !response.payload?.ok) {
      appendLicenseLog('Cloud account registration was rejected', {
        status: response.status,
        error: response.payload?.error || '',
        requestId: response.payload?.requestId || '',
      });
      return {
        ok: false,
        error: redactLicenseText(response.payload?.error || `Remote register failed (${response.status})`),
        sessionInvalidated: false,
      };
    }

    try {
      const session = mapAuthResponseToSession(response.payload);
      appendLicenseLog('Cloud license register succeeded', {
        username,
        provider: config.provider,
      });
      return buildCloudAuthResult(session, 'cloud-register');
    } catch (error) {
      return buildLocalStateError(error);
    }
  }

  async function remoteHeartbeat() {
    const config = readConfig();
    const currentSession = readSession();

    if (!hasRemoteLicenseConfig(config)) {
      return { ok: false, error: '设备码服务未启用' };
    }

    if (!currentSession?.lease?.token) {
      return { ok: false, error: 'No active lease token' };
    }

    const device = getDeviceSnapshot();
    let response;

    try {
      response = await postJsonWithFallback(config, '/auth/heartbeat', {
        leaseToken: currentSession.lease.token,
        installationId: device.installationId,
        fingerprintHash: device.fingerprintHash,
        appVersion: device.appVersion,
      });
    } catch (error) {
      appendLicenseLog('Cloud license heartbeat fell back to cached lease', {
        error: error instanceof Error ? error.message : String(error),
      });
      if (isCachedSessionUsable(currentSession)) {
        return {
          ok: true,
          session: buildPublicSessionSnapshot(currentSession),
          degraded: true,
          warning: LICENSE_SERVICE_UNREACHABLE,
          networkOutageGraceUntil: getNetworkOutageGraceUntil(currentSession),
        };
      }
      return buildNetworkError(error);
    }

    if (!response.ok || !response.payload?.ok) {
      const sessionInvalidated = clearSessionAfterExplicitDenial(response, 'heartbeat');
      return {
        ok: false,
        error: redactLicenseText(response.payload?.error || `Remote heartbeat failed (${response.status})`),
        sessionInvalidated,
      };
    }

    const nextSession = mapAuthResponseToSession({
      ...response.payload,
      account: response.payload.account || currentSession.account,
      device: response.payload.device || currentSession.device,
    });
    nextSession.activation = nextSession.activation || currentSession.activation || null;
    nextSession.lease.token = String(response.payload.leaseToken || '').trim() || currentSession.lease.token;
    nextSession.lease.issuedAt = String(response.payload.issuedAt || '').trim() || currentSession.lease.issuedAt;
    nextSession.lease.offlineAssertion =
      String(response.payload.offlineAssertion || response.payload.offline_assertion || '').trim() ||
      currentSession.lease.offlineAssertion;
    const heartbeatIncludesEpochs = [
      'globalEpoch',
      'global_epoch',
      'accountEpoch',
      'account_epoch',
      'authorizationEpochs',
      'epochs',
    ].some((key) => Object.prototype.hasOwnProperty.call(response.payload || {}, key));
    if (!heartbeatIncludesEpochs) {
      nextSession.authorizationEpochs = { ...currentSession.authorizationEpochs };
    }
    nextSession.lastHeartbeatAt = new Date().toISOString();
    writeSession(nextSession);
    return {
      ok: true,
      session: buildPublicSessionSnapshot(nextSession),
    };
  }

  async function remoteIssueDownloadTicket(input = {}) {
    const config = readConfig();
    const currentSession = readSession();
    if (!hasRemoteLicenseConfig(config) || !currentSession?.lease?.token) {
      return { ok: false, error: 'active_session_required', sessionInvalidated: false };
    }
    const channel = String(input?.type || 'official')
      .trim()
      .toLowerCase();
    if (!['official', 'backup'].includes(channel)) {
      return { ok: false, error: 'download_channel_invalid', sessionInvalidated: false };
    }
    const device = getDeviceSnapshot();
    let response;
    try {
      response = await postJsonWithFallback(config, '/download/ticket', {
        leaseToken: currentSession.lease.token,
        installationId: device.installationId,
        fingerprintHash: device.fingerprintHash,
        appVersion: device.appVersion,
        type: channel,
      });
    } catch (error) {
      return buildNetworkError(error);
    }
    if (!response.ok || !response.payload?.success) {
      return {
        ok: false,
        error: redactLicenseText(response.payload?.error || `Download ticket failed (${response.status})`),
        sessionInvalidated: false,
      };
    }
    try {
      const apiOrigin = new URL(String(config.apiBaseUrl || '')).origin;
      const downloadUrl = new URL(String(response.payload.download_url || ''), apiOrigin);
      if (
        downloadUrl.protocol !== 'https:' ||
        downloadUrl.origin !== apiOrigin ||
        downloadUrl.pathname !== '/download.php' ||
        !downloadUrl.searchParams.get('ticket')
      ) {
        throw new Error('download_ticket_url_invalid');
      }
      return {
        ok: true,
        downloadUrl: downloadUrl.toString(),
        expiresAt: String(response.payload.expires_at || ''),
      };
    } catch (_error) {
      return { ok: false, error: 'download_ticket_url_invalid', sessionInvalidated: false };
    }
  }

  async function remoteLogout() {
    const config = readConfig();
    const currentSession = readSession();

    if (hasRemoteLicenseConfig(config) && currentSession?.lease?.token) {
      try {
        await postJsonWithFallback(config, '/auth/logout', {
          leaseToken: currentSession.lease.token,
        });
      } catch (_error) {
        // best effort
      }
    }

    clearSession();
    return { ok: true };
  }

  function getStatus() {
    const config = readConfig();
    const session = readSession();
    const device = getDeviceSnapshot();
    const sessionIntegrity = verifySessionSeal(session);
    const standardUsable = sessionIntegrity.ok && isSessionUsable(session);
    const leaseExpiresAt = parseTimeMs(session?.lease?.expiresAt);
    const offlineAssertion = verifyOfflineAssertion(session);
    const networkOutageRecoverable = Boolean(
      standardUsable && leaseExpiresAt <= Date.now() && offlineAssertion.ok && offlineAssertion.present
    );
    return {
      ok: true,
      config: buildPublicConfigSnapshot(config),
      session: buildPublicSessionSnapshot(session),
      device,
      sessionIntegrity,
      usable: standardUsable || networkOutageRecoverable,
      degraded: networkOutageRecoverable,
      warning: networkOutageRecoverable ? LICENSE_SERVICE_UNREACHABLE : '',
      networkOutageGraceUntil: networkOutageRecoverable ? getNetworkOutageGraceUntil(session) : '',
    };
  }

  function assertAllowed(featureKey = '') {
    const config = readConfig();
    if (!config.enabled) {
      return { ok: true, mode: 'disabled' };
    }

    const session = readSession();
    const sessionIntegrity = verifySessionSeal(session);
    if (!sessionIntegrity.ok) {
      return {
        ok: false,
        code: 'license_integrity_invalid',
        error: sessionIntegrity.reason || '授权会话校验失败，请重新登录。',
      };
    }
    if (!isCachedSessionUsable(session)) {
      return {
        ok: false,
        code: 'license_inactive',
        error: '当前授权已失效，请重新登录。',
      };
    }

    if (!isFeatureAllowed(featureKey, session)) {
      return {
        ok: false,
        code: 'feature_disabled',
        error: `当前账号未开通功能：${featureKey || 'unknown'}`,
      };
    }

    return {
      ok: true,
      mode: parseTimeMs(session?.lease?.expiresAt) > Date.now() ? 'cloud' : 'offline-assertion',
      session,
    };
  }

  return {
    assertAllowed,
    clearSession,
    getDeviceSnapshot,
    getStatus,
    readConfig,
    readSession,
    remoteHeartbeat,
    remoteIssueDownloadTicket,
    remoteLogin,
    remoteRegister,
    remoteLogout,
    saveConfig,
    writeConfig,
    writeSession,
  };
}

module.exports = {
  createLicenseService,
  __securityTest: {
    getManagedProjectId,
  },
};
