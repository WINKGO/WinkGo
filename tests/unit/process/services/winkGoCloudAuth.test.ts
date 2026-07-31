import { describe, expect, it, vi } from 'vitest';
import { WinkGoCloudAuthService } from '@process/services/WinkGoCloudAuthService';
import { toWinkGoCloudAccountId } from '@process/services/winkgoCloud/account-identity';
import type {
  LegacyLicenseService,
  LegacyLicenseSession,
  LegacyLicenseStatus,
} from '@process/services/winkgoCloud/license-service.cjs';

const account = {
  id: 'u_aaaaaaaaaaaaaaaaaaaaaaaa',
  username: 'Alice',
  createdAt: '2026-07-26T00:00:00.000Z',
  lastLoginAt: '2026-07-26T00:00:00.000Z',
  loginCount: 1,
};

const createLegacyService = ({
  session = {
    account,
    lease: {
      offlineAssertion: 's'.repeat(192),
    },
  },
  status = {
    ok: true,
    usable: true,
    sessionIntegrity: { ok: true },
    session: { account },
  },
  loginResult = { ok: true },
  registerResult = { ok: true },
}: {
  session?: LegacyLicenseSession;
  status?: LegacyLicenseStatus;
  loginResult?: Awaited<ReturnType<LegacyLicenseService['remoteLogin']>>;
  registerResult?: Awaited<ReturnType<LegacyLicenseService['remoteRegister']>>;
} = {}) => {
  const service = {
    clearSession: vi.fn(),
    getStatus: vi.fn(() => status),
    readSession: vi.fn(() => session),
    remoteHeartbeat: vi.fn(async () => ({ ok: true })),
    remoteLogin: vi.fn(async () => loginResult),
    remoteLogout: vi.fn(async () => ({ ok: true })),
    remoteRegister: vi.fn(async () => registerResult),
  } satisfies LegacyLicenseService;
  return service;
};

describe('WINK GO cloud account authorization', () => {
  it('registers without an invitation or a separate desktop authorization', async () => {
    const service = createLegacyService();
    const auth = new WinkGoCloudAuthService(() => service);

    const result = await auth.register({
      username: 'Alice',
      password: 'secret-123',
      phone: '13800138000',
      privacyVersion: '2026-07-30',
      termsVersion: '2026-07-30',
      source: 'desktop_registration',
    });

    expect(service.remoteRegister).toHaveBeenCalledWith({
      username: 'Alice',
      password: 'secret-123',
      phone: '13800138000',
      privacyVersion: '2026-07-30',
      termsVersion: '2026-07-30',
      source: 'desktop_registration',
    });
    expect(result).toMatchObject({
      success: true,
      user: {
        id: 'u_aaaaaaaaaaaaaaaaaaaaaaaa',
        username: 'Alice',
        provider: 'winkgo',
      },
    });
    expect(service.clearSession).not.toHaveBeenCalled();
  });

  it('allows a verified account to login without a signed desktop assertion', async () => {
    const service = createLegacyService({
      session: {
        account,
        lease: {
          offlineAssertion: '',
        },
      },
    });
    const auth = new WinkGoCloudAuthService(() => service);

    const result = await auth.login({
      username: 'Alice',
      password: 'secret-123',
      privacyVersion: '2026-07-30',
      termsVersion: '2026-07-30',
      source: 'desktop_login',
    });

    expect(service.remoteLogin).toHaveBeenCalledWith({
      username: 'Alice',
      password: 'secret-123',
      privacyVersion: '2026-07-30',
      termsVersion: '2026-07-30',
      source: 'desktop_login',
    });
    expect(result).toMatchObject({
      success: true,
      user: {
        id: 'u_aaaaaaaaaaaaaaaaaaaaaaaa',
        username: 'Alice',
      },
    });
    expect(service.clearSession).not.toHaveBeenCalled();
  });

  it('reports registration service unavailability as a server error', async () => {
    const service = createLegacyService({
      registerResult: {
        ok: false,
        error: 'registration_unavailable',
      },
    });
    const auth = new WinkGoCloudAuthService(() => service);

    await expect(
      auth.register({
        username: 'Alice',
        password: 'secret-123',
        phone: '13800138000',
      })
    ).resolves.toMatchObject({
      success: false,
      code: 'serverError',
    });
  });

  it('keeps transport failures distinct from account-service failures', async () => {
    const networkService = createLegacyService({
      loginResult: {
        ok: false,
        error: 'license_service_unreachable',
        detail: 'fetch failed',
      },
    });
    const serverService = createLegacyService({
      loginResult: {
        ok: false,
        error: 'service_unavailable',
      },
    });
    const localStateService = createLegacyService({
      loginResult: {
        ok: false,
        error: 'local_auth_state_unavailable',
        detail: 'profile directory unavailable',
      },
    });
    const deniedService = createLegacyService({
      loginResult: {
        ok: false,
        error: 'device_access_denied',
      },
    });

    await expect(
      new WinkGoCloudAuthService(() => networkService).login({
        username: 'Alice',
        password: 'secret-123',
      })
    ).resolves.toMatchObject({
      success: false,
      code: 'networkError',
    });
    await expect(
      new WinkGoCloudAuthService(() => serverService).login({
        username: 'Alice',
        password: 'secret-123',
      })
    ).resolves.toMatchObject({
      success: false,
      code: 'serverError',
    });
    await expect(
      new WinkGoCloudAuthService(() => localStateService).login({
        username: 'Alice',
        password: 'secret-123',
      })
    ).resolves.toMatchObject({
      success: false,
      code: 'localError',
    });
    await expect(
      new WinkGoCloudAuthService(() => deniedService).login({
        username: 'Alice',
        password: 'secret-123',
      })
    ).resolves.toMatchObject({
      success: false,
      code: 'licenseDenied',
    });
  });

  it('keeps an account session authenticated when the legacy desktop lease is unavailable', () => {
    const service = createLegacyService({
      status: {
        ok: true,
        usable: false,
        sessionIntegrity: { ok: true },
        session: { account },
      },
    });
    const auth = new WinkGoCloudAuthService(() => service);

    expect(auth.getSession()).toMatchObject({
      authenticated: true,
      user: {
        id: 'u_aaaaaaaaaaaaaaaaaaaaaaaa',
        username: 'Alice',
      },
    });
  });

  it('separates the UUID license account from the relay cloud account scope', () => {
    const uuidAccount = {
      ...account,
      id: '5a180b33-fb45-4d4d-8312-4a93a3b1e4a7',
    };
    const service = createLegacyService({
      session: {
        account: uuidAccount,
        lease: { offlineAssertion: 's'.repeat(192) },
      },
      status: {
        ok: true,
        usable: true,
        sessionIntegrity: { ok: true },
        session: { account: uuidAccount },
      },
    });

    const cloudAccountId = new WinkGoCloudAuthService(() => service).getSession().user?.id;
    expect(cloudAccountId).toBe(toWinkGoCloudAccountId(uuidAccount.id));
    expect(cloudAccountId).toMatch(/^u_[a-f0-9]{24}$/);
    expect(cloudAccountId).not.toBe(uuidAccount.id);
  });

  it('rejects a persisted account when session integrity validation fails', () => {
    const service = createLegacyService({
      status: {
        ok: true,
        usable: false,
        sessionIntegrity: {
          ok: false,
          sealed: true,
          reason: '授权会话签名无效，请重新登录。',
        },
        session: { account },
      },
    });

    const auth = new WinkGoCloudAuthService(() => service);

    expect(auth.getSession()).toMatchObject({
      authenticated: false,
      user: null,
    });
  });

  it('fails closed when the license service omits the session integrity result', () => {
    const service = createLegacyService();
    service.getStatus.mockReturnValue({
      ok: true,
      usable: true,
      session: { account },
    } as LegacyLicenseStatus);

    const auth = new WinkGoCloudAuthService(() => service);

    expect(auth.getSession()).toMatchObject({
      authenticated: false,
      user: null,
    });
  });

  it('does not restore identity from a second unverified session read', () => {
    const service = createLegacyService({
      session: { account },
      status: {
        ok: true,
        usable: false,
        sessionIntegrity: { ok: true },
        session: { account: null },
      },
    });

    const auth = new WinkGoCloudAuthService(() => service);

    expect(auth.getSession()).toMatchObject({
      authenticated: false,
      user: null,
    });
    expect(service.readSession).not.toHaveBeenCalled();
  });
});
