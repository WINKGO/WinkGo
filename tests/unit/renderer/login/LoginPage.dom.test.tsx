import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMocks = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' },
  }),
}));

vi.mock('@/renderer/services/i18n', () => ({
  changeLanguage: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@renderer/components/layout/AppLoader', () => ({
  default: () => <div>loading</div>,
}));

vi.mock('@renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({
    status: 'unauthenticated',
    login: authMocks.login,
    register: authMocks.register,
  }),
}));

import LoginPage from '@renderer/pages/login';

describe('WINK GO login page', () => {
  beforeEach(() => {
    authMocks.login.mockReset();
    authMocks.register.mockReset();
    navigate.mockReset();
    localStorage.clear();
  });

  it('allows users to open the registration form without an invitation code', () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByText('login.registerTab'));

    expect(screen.getByText('login.registerBrand')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('login.inviteCodePlaceholder')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('login.confirmPasswordPlaceholder')).toBeInTheDocument();
  });

  it('rejects mismatched registration passwords before creating an account', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByText('login.registerTab'));
    fireEvent.change(screen.getByPlaceholderText('login.usernamePlaceholder'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByPlaceholderText('login.phonePlaceholder'), { target: { value: '13800138000' } });
    fireEvent.change(screen.getByPlaceholderText('login.passwordPlaceholder'), { target: { value: 'secret-123' } });
    fireEvent.change(screen.getByPlaceholderText('login.confirmPasswordPlaceholder'), {
      target: { value: 'different-456' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'login.registerSubmit' }));

    expect(await screen.findByText('login.errors.passwordMismatch')).toBeInTheDocument();
    expect(authMocks.register).not.toHaveBeenCalled();
  });

  it('remembers only the username and removes legacy stored passwords', async () => {
    localStorage.setItem('rememberedPassword', 'legacy-secret');
    authMocks.register.mockResolvedValue({
      success: true,
      user: {
        id: 'account-1',
        username: 'Alice',
        provider: 'winkgo',
        createdAt: '2026-07-26T00:00:00.000Z',
        lastLoginAt: '2026-07-26T00:00:00.000Z',
        loginCount: 1,
      },
    });
    render(<LoginPage />);
    fireEvent.click(screen.getByText('login.registerTab'));
    fireEvent.change(screen.getByPlaceholderText('login.usernamePlaceholder'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByPlaceholderText('login.phonePlaceholder'), { target: { value: '13800138000' } });
    fireEvent.change(screen.getByPlaceholderText('login.passwordPlaceholder'), { target: { value: 'secret-123' } });
    fireEvent.change(screen.getByPlaceholderText('login.confirmPasswordPlaceholder'), {
      target: { value: 'secret-123' },
    });
    fireEvent.click(screen.getByText('login.rememberMe'));

    fireEvent.click(screen.getByRole('button', { name: 'login.registerSubmit' }));

    await waitFor(() => expect(authMocks.register).toHaveBeenCalledTimes(1));
    expect(authMocks.register).toHaveBeenCalledWith({
      username: 'Alice',
      password: 'secret-123',
      phone: '13800138000',
      remember: true,
    });
    expect(localStorage.getItem('rememberedUsername')).toBeTruthy();
    expect(localStorage.getItem('rememberedPassword')).toBeNull();
  });
});
