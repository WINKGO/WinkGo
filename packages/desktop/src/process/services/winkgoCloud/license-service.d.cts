type LegacyLicenseAccount = {
  id?: string | number;
  username?: string;
  phone?: string;
  createdAt?: string;
  lastLoginAt?: string;
  loginCount?: number;
};

type LegacyLicenseSession = {
  account?: LegacyLicenseAccount | null;
  entitlements?: Record<string, boolean>;
  lease?: {
    token?: string;
    issuedAt?: string;
    expiresAt?: string;
    offlineAssertion?: string;
  };
};

type LegacyLicenseResult = {
  ok: boolean;
  error?: string;
  detail?: string;
  user?: LegacyLicenseAccount | null;
  session?: unknown;
  sessionInvalidated?: boolean;
};

type LegacyLicenseStatus = {
  ok: boolean;
  usable: boolean;
  degraded?: boolean;
  warning?: string;
  sessionIntegrity: {
    ok: boolean;
    sealed?: boolean;
    empty?: boolean;
    legacy?: boolean;
    serverSigned?: boolean;
    reason?: string;
  };
  session?: {
    account?: LegacyLicenseAccount | null;
    entitlements?: Record<string, boolean>;
  };
};

type LegacyLicenseService = {
  clearSession(): void;
  getStatus(): LegacyLicenseStatus;
  readSession(): LegacyLicenseSession;
  remoteHeartbeat(): Promise<LegacyLicenseResult>;
  remoteLogin(input: {
    username: string;
    password: string;
    privacyVersion?: string;
    termsVersion?: string;
    source?: 'desktop_login';
  }): Promise<LegacyLicenseResult>;
  remoteLogout(): Promise<LegacyLicenseResult>;
  remoteRegister(input: {
    username: string;
    password: string;
    phone?: string;
    privacyVersion?: string;
    termsVersion?: string;
    source?: 'desktop_registration';
  }): Promise<LegacyLicenseResult>;
};

type LegacyLicenseModule = {
  createLicenseService(options: {
    app: {
      getPath(name: string): string;
      isPackaged: boolean;
    };
    appendLog(message: string, details?: Record<string, unknown>): void;
    getVersionInfo(): { currentVersion: string };
    netFetch?: (input: string | Request, init?: RequestInit) => Promise<Response>;
    backupFilePaths?: {
      config?: string[];
      session?: string[];
      installation?: string[];
    };
  }): LegacyLicenseService;
};

declare const legacyLicenseModule: LegacyLicenseModule;

export default legacyLicenseModule;
export type {
  LegacyLicenseAccount,
  LegacyLicenseResult,
  LegacyLicenseService,
  LegacyLicenseSession,
  LegacyLicenseStatus,
};
