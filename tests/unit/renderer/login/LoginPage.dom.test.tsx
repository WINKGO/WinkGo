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

vi.mock('react-router', () => ({
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
import { WINK_GO_POLICY_CONSENT_STORAGE_KEY, WINK_GO_POLICY_VERSION } from '@renderer/pages/login/policyConsent';

const acceptCurrentPolicy = () => {
  fireEvent.click(screen.getByRole('checkbox', { name: 'login.agreementCheckbox' }));
};

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
    expect(screen.getByRole('checkbox', { name: 'login.agreementCheckbox' })).not.toBeChecked();
  });

  it('requires separate, unselected consent for login and registration', async () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: 'login.submit' }));
    expect(await screen.findByText('login.errors.agreementRequired')).toBeInTheDocument();
    expect(authMocks.login).not.toHaveBeenCalled();

    acceptCurrentPolicy();
    fireEvent.click(screen.getByText('login.registerTab'));

    expect(screen.getByRole('checkbox', { name: 'login.agreementCheckbox' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'login.registerSubmit' }));
    expect(await screen.findByText('login.errors.agreementRequired')).toBeInTheDocument();
    expect(authMocks.register).not.toHaveBeenCalled();
  });

  it('opens the bundled terms and privacy policy without a network request', () => {
    render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: 'login.termsOfService' }));
    expect(screen.getByTestId('login-policy-terms')).toHaveTextContent('Terms of Service');
    expect(screen.getByTestId('login-policy-terms')).toHaveTextContent('1394748660@qq.com');

    fireEvent.click(screen.getByRole('tab', { name: 'login.privacyPolicy' }));
    expect(screen.getByTestId('login-policy-privacy')).toHaveTextContent('Privacy Policy');
    expect(screen.getByTestId('login-policy-privacy')).toHaveTextContent('1394748660@qq.com');
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
    acceptCurrentPolicy();

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
    acceptCurrentPolicy();

    fireEvent.click(screen.getByRole('button', { name: 'login.registerSubmit' }));

    await waitFor(() => expect(authMocks.register).toHaveBeenCalledTimes(1));
    expect(authMocks.register).toHaveBeenCalledWith({
      username: 'Alice',
      password: 'secret-123',
      phone: '13800138000',
      remember: true,
      privacyVersion: WINK_GO_POLICY_VERSION,
      termsVersion: WINK_GO_POLICY_VERSION,
      source: 'desktop_registration',
    });
    expect(localStorage.getItem('rememberedUsername')).toBeTruthy();
    expect(localStorage.getItem('rememberedPassword')).toBeNull();
    const storedConsent = JSON.parse(localStorage.getItem(WINK_GO_POLICY_CONSENT_STORAGE_KEY) ?? '{}') as {
      policyVersion?: string;
      privacyVersion?: string;
      termsVersion?: string;
      acceptedAt?: string;
      flow?: string;
    };
    expect(storedConsent).toMatchObject({
      policyVersion: WINK_GO_POLICY_VERSION,
      privacyVersion: WINK_GO_POLICY_VERSION,
      termsVersion: WINK_GO_POLICY_VERSION,
      flow: 'register',
    });
    expect(Number.isNaN(Date.parse(storedConsent.acceptedAt ?? ''))).toBe(false);
  });

  it('records the accepted policy version and time after a successful login', async () => {
    authMocks.login.mockResolvedValue({
      success: true,
      user: {
        id: 'account-2',
        username: 'Alice',
        provider: 'winkgo',
        createdAt: '2026-07-26T00:00:00.000Z',
        lastLoginAt: '2026-07-30T00:00:00.000Z',
        loginCount: 2,
      },
    });
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('login.usernamePlaceholder'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByPlaceholderText('login.passwordPlaceholder'), {
      target: { value: 'secret-123' },
    });
    acceptCurrentPolicy();

    fireEvent.click(screen.getByRole('button', { name: 'login.submit' }));

    await waitFor(() => expect(authMocks.login).toHaveBeenCalledTimes(1));
    expect(authMocks.login).toHaveBeenCalledWith({
      username: 'Alice',
      password: 'secret-123',
      remember: false,
      privacyVersion: WINK_GO_POLICY_VERSION,
      termsVersion: WINK_GO_POLICY_VERSION,
      source: 'desktop_login',
    });
    const storedConsent = JSON.parse(localStorage.getItem(WINK_GO_POLICY_CONSENT_STORAGE_KEY) ?? '{}') as {
      policyVersion?: string;
      acceptedAt?: string;
      flow?: string;
    };
    expect(storedConsent.policyVersion).toBe(WINK_GO_POLICY_VERSION);
    expect(storedConsent.flow).toBe('login');
    expect(Number.isNaN(Date.parse(storedConsent.acceptedAt ?? ''))).toBe(false);
  });

  it('shows a local profile error separately from a network outage', async () => {
    authMocks.login.mockResolvedValue({
      success: false,
      code: 'localError',
    });
    render(<LoginPage />);
    fireEvent.change(screen.getByPlaceholderText('login.usernamePlaceholder'), { target: { value: 'Alice' } });
    fireEvent.change(screen.getByPlaceholderText('login.passwordPlaceholder'), {
      target: { value: 'secret-123' },
    });
    acceptCurrentPolicy();

    fireEvent.click(screen.getByRole('button', { name: 'login.submit' }));

    expect(await screen.findByText('login.errors.localError')).toBeInTheDocument();
    expect(localStorage.getItem(WINK_GO_POLICY_CONSENT_STORAGE_KEY)).toBeNull();
  });
});
