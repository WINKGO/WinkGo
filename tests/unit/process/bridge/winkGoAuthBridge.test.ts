import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startRemoteGateway: vi.fn(),
  clearRemoteAuthorization: vi.fn(),
  hasCapability: vi.fn(() => true),
}));

vi.mock('@/common', () => ({
  ipcBridge: {},
}));

vi.mock('@process/services/WinkGoCloudAuthService', () => ({
  winkGoCloudAuthService: {
    hasCapability: mocks.hasCapability,
  },
}));

vi.mock('@process/services/WinkGoXiaozhiService', () => ({
  clearWinkGoRemoteAuthorization: mocks.clearRemoteAuthorization,
  startWinkGoRemoteGateway: mocks.startRemoteGateway,
}));

import { authenticateAndSyncRemoteGateway } from '@process/bridge/winkgo/authBridge';

describe('WINK GO login gateway synchronization', () => {
  beforeEach(() => {
    mocks.startRemoteGateway.mockReset();
    mocks.startRemoteGateway.mockResolvedValue(undefined);
    mocks.clearRemoteAuthorization.mockReset();
    mocks.clearRemoteAuthorization.mockResolvedValue(undefined);
    mocks.hasCapability.mockReset();
    mocks.hasCapability.mockReturnValue(true);
  });

  it('returns a successful login without rotating authorization or waiting for the gateway', async () => {
    let finishRemoteSync: (() => void) | undefined;
    mocks.startRemoteGateway.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRemoteSync = resolve;
        })
    );

    const result = await authenticateAndSyncRemoteGateway(async () => ({
      success: true,
      user: {
        id: 'u_aaaaaaaaaaaaaaaaaaaaaaaa',
        username: 'Alice',
        provider: 'winkgo',
      },
    }));

    expect(result.success).toBe(true);
    expect(mocks.startRemoteGateway).toHaveBeenCalledOnce();
    finishRemoteSync?.();
  });

  it('does not start gateway synchronization after a failed login', async () => {
    const result = await authenticateAndSyncRemoteGateway(async () => ({
      success: false,
      code: 'invalidCredentials',
    }));

    expect(result.success).toBe(false);
    expect(mocks.startRemoteGateway).not.toHaveBeenCalled();
  });

  it('starts remote gateway synchronization for Free full-access logins', async () => {
    mocks.hasCapability.mockReturnValue(true);

    const result = await authenticateAndSyncRemoteGateway(async () => ({
      success: true,
      user: {
        id: 'u_bbbbbbbbbbbbbbbbbbbbbbbb',
        username: 'Free User',
        provider: 'winkgo',
      },
    }));

    expect(result.success).toBe(true);
    expect(mocks.startRemoteGateway).toHaveBeenCalledOnce();
    expect(mocks.clearRemoteAuthorization).not.toHaveBeenCalled();
  });

  it('clears stale remote authorization when a future restricted edition lacks remote access', async () => {
    mocks.hasCapability.mockReturnValue(false);

    const result = await authenticateAndSyncRemoteGateway(async () => ({
      success: true,
      user: {
        id: 'u_cccccccccccccccccccccccc',
        username: 'Restricted User',
        provider: 'winkgo',
      },
    }));

    expect(result.success).toBe(true);
    expect(mocks.startRemoteGateway).not.toHaveBeenCalled();
    expect(mocks.clearRemoteAuthorization).toHaveBeenCalledOnce();
  });
});
