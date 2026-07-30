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
  return (
    <div>
      <span>{auth.status}</span>
      <span>{auth.user?.username ?? 'no-user'}</span>
      <button type='button' onClick={() => void auth.login({ username: 'Alice', password: 'secret-123' })}>
        login
      </button>
      <button
        type='button'
        onClick={() =>
          void auth.register({
            username: 'Alice',
            password: 'secret-123',
          })
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
