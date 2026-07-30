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
    session: { account },
  },
}: {
  session?: LegacyLicenseSession;
  status?: LegacyLicenseStatus;
} = {}) => {
  const service = {
    clearSession: vi.fn(),
    getStatus: vi.fn(() => status),
    readSession: vi.fn(() => session),
    remoteHeartbeat: vi.fn(async () => ({ ok: true })),
    remoteLogin: vi.fn(async () => ({ ok: true })),
    remoteLogout: vi.fn(async () => ({ ok: true })),
    remoteRegister: vi.fn(async () => ({ ok: true })),
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
    });

    expect(service.remoteRegister).toHaveBeenCalledWith({
      username: 'Alice',
      password: 'secret-123',
      phone: '13800138000',
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

  it('keeps an account session authenticated when the legacy desktop lease is unavailable', () => {
    const service = createLegacyService({
      status: {
        ok: true,
        usable: false,
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
        session: { account: uuidAccount },
      },
    });

    const cloudAccountId = new WinkGoCloudAuthService(() => service).getSession().user?.id;
    expect(cloudAccountId).toBe(toWinkGoCloudAccountId(uuidAccount.id));
    expect(cloudAccountId).toMatch(/^u_[a-f0-9]{24}$/);
    expect(cloudAccountId).not.toBe(uuidAccount.id);
  });
});
