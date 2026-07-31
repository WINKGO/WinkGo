import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import legacyLicenseModule, { type LegacyLicenseService } from '@process/services/winkgoCloud/license-service.cjs';

const temporaryDirectories: string[] = [];

const createService = (
  userDataPath: string,
  netFetch?: (input: string | Request, init?: RequestInit) => Promise<Response>
): LegacyLicenseService => {
  const factory = legacyLicenseModule.createLicenseService as unknown as (
    options: Record<string, unknown>
  ) => LegacyLicenseService;
  return factory({
    app: {
      getPath: () => userDataPath,
      isPackaged: false,
    },
    appendLog: vi.fn(),
    getVersionInfo: () => ({ currentVersion: '2.1.46-test' }),
    netFetch,
    localSecretProtector: {
      protect: (value: string) => Buffer.from(value, 'utf8').toString('base64'),
      unprotect: (value: string) => Buffer.from(value, 'base64').toString('utf8'),
    },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('WINK GO managed account transport', () => {
  it('forwards versioned policy consent without trusting a client acceptance timestamp', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'winkgo-license-consent-'));
    temporaryDirectories.push(userDataPath);
    const requestFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: 'invalid_credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', requestFetch);
    const service = createService(userDataPath);

    await service.remoteLogin({
      username: 'consent_probe',
      password: 'ProbePassword123!',
      privacyVersion: '2026-07-30',
      termsVersion: '2026-07-30',
      source: 'desktop_login',
    });

    const requestBody = JSON.parse(String(requestFetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(requestBody).toMatchObject({
      privacyVersion: '2026-07-30',
      termsVersion: '2026-07-30',
      source: 'desktop_login',
    });
    expect(requestBody).not.toHaveProperty('acceptedAt');
  });

  it('falls back to the Electron network stack when Node fetch fails', async () => {
    const userDataPath = mkdtempSync(path.join(tmpdir(), 'winkgo-license-transport-'));
    temporaryDirectories.push(userDataPath);
    const primaryFetch = vi.fn(async () => {
      throw new Error('simulated Node fetch failure');
    });
    const electronFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, error: 'invalid_credentials' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', primaryFetch);
    const service = createService(userDataPath, electronFetch);

    await expect(
      service.remoteLogin({
        username: 'transport_probe',
        password: 'ProbePassword123!',
      })
    ).resolves.toMatchObject({
      ok: false,
      error: 'invalid_credentials',
    });
    expect(primaryFetch).toHaveBeenCalledOnce();
    expect(electronFetch).toHaveBeenCalledOnce();
  });

  it('returns a structured local-state error when the profile cannot be read', async () => {
    const factory = legacyLicenseModule.createLicenseService as unknown as (
      options: Record<string, unknown>
    ) => LegacyLicenseService;
    const service = factory({
      app: {
        getPath: () => {
          throw new Error('user data directory unavailable');
        },
        isPackaged: true,
      },
      appendLog: vi.fn(),
      getVersionInfo: () => ({ currentVersion: '2.1.46-test' }),
    });

    await expect(
      service.remoteLogin({
        username: 'local_state_probe',
        password: 'ProbePassword123!',
      })
    ).resolves.toMatchObject({
      ok: false,
      error: 'local_auth_state_unavailable',
    });
  });
});
