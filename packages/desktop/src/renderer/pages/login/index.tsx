// Modified from AionUI by WINK GO contributors in 2026.
import loginLogo from '@renderer/assets/brand/wink-go-wordmark.png';
import { Button, Checkbox, Input, Modal, Radio, Select, Tabs } from '@arco-design/web-react';
import { Lock, Phone, User } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_OPTIONS } from '@/common/config/i18n';
import { changeLanguage } from '@/renderer/services/i18n';
import { useNavigate } from 'react-router';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useAuth } from '../../hooks/context/AuthContext';
import privacyPolicyText from '../../../../../../PRIVACY.md?raw';
import termsOfServiceText from '../../../../../../TERMS.md?raw';
import { recordPolicyConsent, WINK_GO_POLICY_VERSION } from './policyConsent';
import policyStyles from './LoginPolicy.module.css';
import './LoginPage.css';

type MessageState = {
  type: 'error' | 'success';
  text: string;
};

type LoginMode = 'login' | 'register';
type PolicyDocumentTab = 'privacy' | 'terms';

const REMEMBER_ME_KEY = 'rememberMe';
const REMEMBERED_USERNAME_KEY = 'rememberedUsername';
const REMEMBERED_PASSWORD_KEY = 'rememberedPassword';
const normalizePhone = (value: string): string => value.replace(/[\s()-]/g, '');
const VALID_PHONE = /^(?:1[3-9]\d{9}|\+[1-9]\d{7,14})$/;

// Simple obfuscation for the remembered username (not cryptographically secure)
const obfuscate = (text: string): string => {
  const encoded = btoa(encodeURIComponent(text));
  return encoded.split('').toReversed().join('');
};

const deobfuscate = (text: string): string => {
  try {
    const reversed = text.split('').toReversed().join('');
    return decodeURIComponent(atob(reversed));
  } catch {
    return '';
  }
};

const LoginPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { status, login, register } = useAuth();
  const isDesktopRuntime = Boolean(window.electronAPI);

  const [mode, setMode] = useState<LoginMode>('login');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [policyAgreement, setPolicyAgreement] = useState<Record<LoginMode, boolean>>({
    login: false,
    register: false,
  });
  const [policyVisible, setPolicyVisible] = useState(false);
  const [policyTab, setPolicyTab] = useState<PolicyDocumentTab>('terms');
  const [message, setMessage] = useState<MessageState | null>(null);
  const [loading, setLoading] = useState(false);

  const messageTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    document.body.classList.add('login-page-active');
    return () => {
      document.body.classList.remove('login-page-active');
      if (messageTimer.current) {
        window.clearTimeout(messageTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    document.title = t('login.pageTitle');
  }, [t]);

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  useEffect(() => {
    localStorage.removeItem(REMEMBERED_PASSWORD_KEY);
    const isRememberMe = localStorage.getItem(REMEMBER_ME_KEY) === 'true';
    if (isRememberMe) {
      const storedUsername = localStorage.getItem(REMEMBERED_USERNAME_KEY);
      if (storedUsername) setUsername(deobfuscate(storedUsername));
      setRememberMe(true);
    }

    return () => {
      if (messageTimer.current) {
        window.clearTimeout(messageTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      void navigate('/guid', { replace: true });
    }
  }, [navigate, status]);

  const clearMessageLater = useCallback(() => {
    if (messageTimer.current) {
      window.clearTimeout(messageTimer.current);
    }
    messageTimer.current = window.setTimeout(() => {
      setMessage((prev) => (prev?.type === 'success' ? prev : null));
    }, 5000);
  }, []);

  const showMessage = useCallback(
    (next: MessageState) => {
      setMessage(next);
      if (next.type === 'error') {
        clearMessageLater();
      }
    },
    [clearMessageLater]
  );

  const handleLanguageChange = useCallback((nextLanguage: string) => {
    changeLanguage(nextLanguage).catch((error: Error) => {
      console.error('Failed to change language:', error);
    });
  }, []);

  const handleModeChange = useCallback((nextMode: LoginMode) => {
    setMode(nextMode);
    setPhone('');
    setPassword('');
    setConfirmPassword('');
    setMessage(null);
  }, []);

  const openPolicyDocument = useCallback(
    (event: { preventDefault: () => void; stopPropagation: () => void }, tab: PolicyDocumentTab) => {
      event.preventDefault();
      event.stopPropagation();
      setPolicyTab(tab);
      setPolicyVisible(true);
    },
    []
  );

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedUsername = username.trim();

      if (!policyAgreement[mode]) {
        showMessage({ type: 'error', text: t('login.errors.agreementRequired') });
        return;
      }
      if (!trimmedUsername || !password) {
        showMessage({ type: 'error', text: t('login.errors.empty') });
        return;
      }
      const normalizedPhone = normalizePhone(phone);
      if (mode === 'register' && !normalizedPhone) {
        showMessage({ type: 'error', text: t('login.errors.phoneRequired') });
        return;
      }
      if (mode === 'register' && !VALID_PHONE.test(normalizedPhone)) {
        showMessage({ type: 'error', text: t('login.errors.phoneInvalid') });
        return;
      }
      if (mode === 'register' && password.length < 10) {
        showMessage({ type: 'error', text: t('login.errors.passwordTooShort') });
        return;
      }
      if (mode === 'register' && password !== confirmPassword) {
        showMessage({ type: 'error', text: t('login.errors.passwordMismatch') });
        return;
      }

      setLoading(true);
      setMessage(null);
      const policyAcceptedAt = new Date();

      const result =
        mode === 'register'
          ? await register({
              username: trimmedUsername,
              password,
              phone: normalizedPhone,
              remember: rememberMe,
              privacyVersion: WINK_GO_POLICY_VERSION,
              termsVersion: WINK_GO_POLICY_VERSION,
              source: 'desktop_registration',
            })
          : await login({
              username: trimmedUsername,
              password,
              remember: rememberMe,
              privacyVersion: WINK_GO_POLICY_VERSION,
              termsVersion: WINK_GO_POLICY_VERSION,
              source: 'desktop_login',
            });

      if (result.success) {
        if (rememberMe) {
          localStorage.setItem(REMEMBER_ME_KEY, 'true');
          localStorage.setItem(REMEMBERED_USERNAME_KEY, obfuscate(trimmedUsername));
        } else {
          localStorage.removeItem(REMEMBER_ME_KEY);
          localStorage.removeItem(REMEMBERED_USERNAME_KEY);
        }
        localStorage.removeItem(REMEMBERED_PASSWORD_KEY);
        recordPolicyConsent(localStorage, mode, policyAcceptedAt);

        const successText = mode === 'register' ? t('login.registerSuccess') : t('login.success');
        showMessage({ type: 'success', text: successText });

        void navigate('/guid', { replace: true });
      } else {
        const errorText = (() => {
          switch (result.code) {
            case 'invalidCredentials':
              return t('login.errors.invalidCredentials');
            case 'accountExists':
              return t('login.errors.accountExists');
            case 'licenseDenied':
              return t('login.errors.licenseDenied');
            case 'validationError':
              return t('login.errors.validationError');
            case 'tooManyAttempts':
              return t('login.errors.tooManyAttempts');
            case 'localError':
              return t('login.errors.localError');
            case 'networkError':
              return t('login.errors.networkError');
            case 'serverError':
              return t('login.errors.serverError');
            case 'unknown':
            default:
              return result.message ?? t('login.errors.unknown');
          }
        })();

        showMessage({ type: 'error', text: errorText });
      }

      setLoading(false);
    },
    [
      confirmPassword,
      login,
      mode,
      navigate,
      password,
      phone,
      policyAgreement,
      register,
      rememberMe,
      showMessage,
      t,
      username,
    ]
  );

  if (status === 'checking') {
    return <AppLoader />;
  }

  return (
    <div className='login-page'>
      <div className='login-page__lang-select-wrapper'>
        <Select
          className='login-page__lang-select'
          value={i18n.language}
          onChange={handleLanguageChange}
          aria-label={t('login.languageToggle')}
        >
          {LANGUAGE_OPTIONS.map((lang) => (
            <Select.Option key={lang.code} value={lang.code}>
              {lang.label}
            </Select.Option>
          ))}
        </Select>
      </div>

      <div className='login-page__card'>
        <div className='login-page__header'>
          <div className='login-page__logo'>
            <img src={loginLogo} alt='WINK GO' />
          </div>
          <h1 className='login-page__title'>{mode === 'register' ? t('login.registerBrand') : t('login.brand')}</h1>
          <p className='login-page__subtitle'>
            {mode === 'register' ? t('login.registerSubtitle') : t('login.subtitle')}
          </p>
        </div>

        {isDesktopRuntime && (
          <Radio.Group
            className='login-page__mode-switch'
            type='button'
            value={mode}
            options={[
              { label: t('login.loginTab'), value: 'login' },
              { label: t('login.registerTab'), value: 'register' },
            ]}
            onChange={(value) => handleModeChange(value as LoginMode)}
          />
        )}

        <form className='login-page__form' onSubmit={handleSubmit}>
          <div className='login-page__form-item'>
            <label className='login-page__label' htmlFor='username'>
              {t('login.username')}
            </label>
            <div className='login-page__input-shell'>
              <Input
                id='username'
                name='username'
                className='login-page__input'
                prefix={<User theme='outline' size='17' fill='currentColor' />}
                placeholder={t('login.usernamePlaceholder')}
                autoComplete='username'
                autoFocus
                value={username}
                onChange={setUsername}
                aria-required='true'
              />
            </div>
          </div>

          {mode === 'register' && (
            <div className='login-page__form-item'>
              <label className='login-page__label' htmlFor='phone'>
                {t('login.phone')}
              </label>
              <div className='login-page__input-shell'>
                <Input
                  id='phone'
                  name='phone'
                  className='login-page__input'
                  prefix={<Phone theme='outline' size='17' fill='currentColor' />}
                  placeholder={t('login.phonePlaceholder')}
                  autoComplete='tel'
                  value={phone}
                  onChange={setPhone}
                  aria-required='true'
                />
              </div>
            </div>
          )}

          <div className='login-page__form-item'>
            <label className='login-page__label' htmlFor='password'>
              {t('login.password')}
            </label>
            <div className='login-page__input-shell'>
              <Input.Password
                id='password'
                name='password'
                className='login-page__input'
                prefix={<Lock theme='outline' size='17' fill='currentColor' />}
                placeholder={t('login.passwordPlaceholder')}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={setPassword}
                visibilityToggle
                aria-required='true'
              />
            </div>
          </div>

          {mode === 'register' && (
            <div className='login-page__form-item'>
              <label className='login-page__label' htmlFor='confirm-password'>
                {t('login.confirmPassword')}
              </label>
              <div className='login-page__input-shell'>
                <Input.Password
                  id='confirm-password'
                  name='confirm-password'
                  className='login-page__input'
                  prefix={<Lock theme='outline' size='17' fill='currentColor' />}
                  placeholder={t('login.confirmPasswordPlaceholder')}
                  autoComplete='new-password'
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  visibilityToggle
                  aria-required='true'
                />
              </div>
            </div>
          )}

          <Checkbox className='login-page__checkbox' checked={rememberMe} onChange={setRememberMe}>
            {t('login.rememberMe')}
          </Checkbox>

          <Checkbox
            className={`login-page__checkbox ${policyStyles.policyCheckbox}`}
            checked={policyAgreement[mode]}
            onChange={(checked) => setPolicyAgreement((current) => ({ ...current, [mode]: checked }))}
            aria-label={t('login.agreementCheckbox')}
          >
            <span className={policyStyles.policyLabel}>
              {t('login.agreementPrefix')}
              <Button
                htmlType='button'
                type='text'
                size='mini'
                className={policyStyles.policyLink}
                onClick={(event) => openPolicyDocument(event, 'terms')}
              >
                {t('login.termsOfService')}
              </Button>
              {t('login.agreementAnd')}
              <Button
                htmlType='button'
                type='text'
                size='mini'
                className={policyStyles.policyLink}
                onClick={(event) => openPolicyDocument(event, 'privacy')}
              >
                {t('login.privacyPolicy')}
              </Button>
            </span>
          </Checkbox>

          <Button htmlType='submit' type='primary' className='login-page__submit' loading={loading} disabled={loading}>
            {loading
              ? mode === 'register'
                ? t('login.registering')
                : t('login.submitting')
              : mode === 'register'
                ? t('login.registerSubmit')
                : t('login.submit')}
          </Button>

          <div
            role='alert'
            aria-live='polite'
            className={`login-page__message ${message ? 'login-page__message--visible' : ''} ${message ? (message.type === 'success' ? 'login-page__message--success' : 'login-page__message--error') : ''}`}
            hidden={!message}
          >
            {message?.text}
          </div>

          {isDesktopRuntime && (
            <div className='login-page__privacy'>
              <p>{t('login.dataDisclosure')}</p>
              <p>{t('login.oauthUnavailable')}</p>
            </div>
          )}
        </form>
      </div>

      <Modal
        title={t('login.policyModalTitle')}
        visible={policyVisible}
        onCancel={() => setPolicyVisible(false)}
        footer={null}
        autoFocus={false}
        focusLock
        unmountOnExit
        className={policyStyles.policyModal}
      >
        <p className={policyStyles.policyBaseline}>{t('login.policyBaselineNotice')}</p>
        <Tabs activeTab={policyTab} onChange={(tab) => setPolicyTab(tab as PolicyDocumentTab)} destroyOnHide={false}>
          <Tabs.TabPane key='terms' title={t('login.termsOfService')}>
            <pre data-testid='login-policy-terms' className={policyStyles.policyDocument}>
              {termsOfServiceText}
            </pre>
          </Tabs.TabPane>
          <Tabs.TabPane key='privacy' title={t('login.privacyPolicy')}>
            <pre data-testid='login-policy-privacy' className={policyStyles.policyDocument}>
              {privacyPolicyText}
            </pre>
          </Tabs.TabPane>
        </Tabs>
      </Modal>
    </div>
  );
};

export default LoginPage;
