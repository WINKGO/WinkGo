import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateWinkGoAuthCredentials, WinkGoDesktopAuthService } from '@process/services/WinkGoCredentialService';

const temporaryRoots: string[] = [];

const createAuthService = async (): Promise<{ service: WinkGoDesktopAuthService; storePath: string }> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'winkgo-auth-'));
  temporaryRoots.push(root);
  const storePath = path.join(root, 'accounts.json');
  return {
    service: new WinkGoDesktopAuthService(() => storePath),
    storePath,
  };
};

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('WINK GO desktop authentication', () => {
  it('rejects malformed usernames and short passwords before writing', () => {
    expect(validateWinkGoAuthCredentials({ username: 'a', password: '123456' }).valid).toBe(false);
    expect(validateWinkGoAuthCredentials({ username: 'valid-user', password: '123' }).message).toBe('password');
    expect(validateWinkGoAuthCredentials({ username: '123456', password: 'secret-123' }).message).toBe(
      'usernameNumeric'
    );
    expect(
      validateWinkGoAuthCredentials(
        { username: '123456', password: 'secret-123' },
        { allowLegacyNumericUsername: true }
      ).valid
    ).toBe(true);
  });

  it('rejects new numeric-only accounts without affecting legacy login validation', async () => {
    const { service } = await createAuthService();

    const result = await service.register({ username: '123456', password: 'secret-123' });

    expect(result).toMatchObject({ success: false, code: 'validationError', message: 'usernameNumeric' });
  });

  it('registers multiple local accounts without storing plaintext passwords', async () => {
    const { service, storePath } = await createAuthService();

    const first = await service.register({ username: ' Alice ', password: 'secret-123' });
    await service.logout();
    const second = await service.register({ username: 'Bob', password: 'another-456' });
    const stored = await readFile(storePath, 'utf8');

    expect(first.user?.username).toBe('Alice');
    expect(second.success).toBe(true);
    expect(stored).not.toContain('secret-123');
  });

  it('rejects duplicate usernames without replacing the existing account', async () => {
    const { service } = await createAuthService();
    await service.register({ username: 'Alice', password: 'secret-123' });

    const duplicate = await service.register({ username: 'alice', password: 'replacement-456' });

    expect(duplicate).toMatchObject({ success: false, code: 'accountExists' });
  });

  it('authenticates the correct password and updates the local login audit', async () => {
    const { service } = await createAuthService();
    await service.register({ username: 'Alice', password: 'secret-123' });
    service.logout();

    const failed = await service.login({ username: 'Alice', password: 'wrong-password' });
    const authenticated = await service.login({ username: 'alice', password: 'secret-123' });

    expect(failed).toMatchObject({ success: false, code: 'invalidCredentials' });
    expect(authenticated.user?.loginCount).toBe(2);
    expect(service.getSession().authenticated).toBe(true);
  });

  it('clears only the in-memory session on logout', async () => {
    const { service } = await createAuthService();
    await service.register({ username: 'Alice', password: 'secret-123' });

    service.logout();
    const login = await service.login({ username: 'Alice', password: 'secret-123' });

    expect(service.getSession().authenticated).toBe(true);
    expect(login.success).toBe(true);
  });
});
