import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    winkGoAuth: {
      getSession: { invoke: bridgeMocks.getSession },
      login: { invoke: bridgeMocks.login },
      register: { invoke: bridgeMocks.register },
      logout: { invoke: bridgeMocks.logout },
    },
  },
}));

import { AuthProvider, useAuth } from '@renderer/hooks/context/AuthContext';

const authenticatedUser = {
  id: 'account-1',
  username: 'Alice',
  provider: 'winkgo' as const,
  createdAt: '2026-07-26T00:00:00.000Z',
  lastLoginAt: '2026-07-26T00:00:00.000Z',
  loginCount: 1,
};

const AuthProbe: React.FC = () => {
  const auth = useAuth();
  const [lastResult, setLastResult] = React.useState('none');
  return (
    <div>
      <span>{auth.status}</span>
      <span>{auth.user?.username ?? 'no-user'}</span>
      <span data-testid='last-result'>{lastResult}</span>
      <button
        type='button'
        onClick={() =>
          void auth
            .login({ username: 'Alice', password: 'secret-123' })
            .then((result) => setLastResult(result.success ? 'success' : result.code || 'unknown'))
        }
      >
        login
      </button>
      <button
        type='button'
        onClick={() =>
          void auth
            .register({
              username: 'Alice',
              password: 'secret-123',
            })
            .then((result) => setLastResult(result.success ? 'success' : result.code || 'unknown'))
        }
      >
        register
      </button>
      <button type='button' onClick={() => void auth.logout()}>
        logout
      </button>
    </div>
  );
};

describe('desktop authentication context', () => {
  beforeEach(() => {
    window.__winkgoE2ETest = false;
    bridgeMocks.getSession.mockReset();
    bridgeMocks.login.mockReset();
    bridgeMocks.register.mockReset();
    bridgeMocks.logout.mockReset();
    bridgeMocks.getSession.mockResolvedValue({
      authenticated: false,
      user: null,
      oauth: { google: false, wechat: false },
    });
  });

  it('uses an isolated authenticated session for Electron E2E navigation tests', async () => {
    window.__winkgoE2ETest = true;

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByText('authenticated')).toBeInTheDocument();
    expect(screen.getByText('WINK GO E2E')).toBeInTheDocument();
    expect(bridgeMocks.getSession).not.toHaveBeenCalled();
  });

  it('starts unauthenticated when no in-memory desktop session exists', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    expect(await screen.findByText('unauthenticated')).toBeInTheDocument();
    expect(bridgeMocks.getSession).toHaveBeenCalledTimes(1);
  });

  it('authenticates after a successful WINK GO cloud account login', async () => {
    bridgeMocks.login.mockResolvedValue({ success: true, user: authenticatedUser });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );
    await screen.findByText('unauthenticated');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'login' }));
    });

    expect(screen.getByText('authenticated')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('registers a new cloud account without an invitation code', async () => {
    bridgeMocks.register.mockResolvedValue({ success: true, user: authenticatedUser });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );
    await screen.findByText('unauthenticated');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'register' }));
    });

    expect(bridgeMocks.register).toHaveBeenCalledWith({
      username: 'Alice',
      password: 'secret-123',
    });
    expect(screen.getByText('authenticated')).toBeInTheDocument();
  });

  it('does not label an unexpected desktop provider failure as a network outage', async () => {
    bridgeMocks.login.mockRejectedValue(new Error('provider failed'));
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );
    await screen.findByText('unauthenticated');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'login' }));
    });

    expect(screen.getByTestId('last-result')).toHaveTextContent('serverError');
  });

  it('keeps a successful login when the follow-up session refresh fails', async () => {
    bridgeMocks.getSession.mockReset();
    bridgeMocks.getSession
      .mockResolvedValueOnce({
        authenticated: false,
        user: null,
        oauth: { google: false, wechat: false },
      })
      .mockRejectedValueOnce(new Error('session refresh failed'));
    bridgeMocks.login.mockResolvedValue({ success: true, user: authenticatedUser });
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );
    await screen.findByText('unauthenticated');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'login' }));
    });

    expect(screen.getByText('authenticated')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByTestId('last-result')).toHaveTextContent('success');
  });

  it('returns to the login gate after desktop logout', async () => {
    bridgeMocks.getSession.mockResolvedValue({
      authenticated: true,
      user: authenticatedUser,
      oauth: { google: false, wechat: false },
    });
    bridgeMocks.logout.mockResolvedValue(undefined);
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );
    await screen.findByText('authenticated');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'logout' }));
    });

    expect(screen.getByText('unauthenticated')).toBeInTheDocument();
    expect(screen.getByText('no-user')).toBeInTheDocument();
  });
});
