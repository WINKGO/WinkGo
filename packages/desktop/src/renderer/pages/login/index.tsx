import loginLogo from '@renderer/assets/brand/wink-go-wordmark.png';
import { Button, Checkbox, Input, Radio, Select } from '@arco-design/web-react';
import { Lock, Phone, User } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '@/renderer/services/i18n';
import { useNavigate } from 'react-router-dom';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useAuth } from '../../hooks/context/AuthContext';
import './LoginPage.css';

type MessageState = {
  type: 'error' | 'success';
  text: string;
};

type LoginMode = 'login' | 'register';

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

  const supportedLanguages = useMemo<{ code: string; label: string }[]>(
    () => [
      { code: 'zh-CN', label: '简体中文' },
      { code: 'zh-TW', label: '繁體中文' },
      { code: 'ja-JP', label: '日本語' },
      { code: 'ko-KR', label: '한국어' },
      { code: 'tr-TR', label: 'Türkçe' },
      { code: 'uk-UA', label: 'Українська' },
      { code: 'pt-BR', label: 'Português (BR)' },
      { code: 'de-DE', label: 'Deutsch' },
      { code: 'es-ES', label: 'Español' },
      { code: 'fa-IR', label: 'فارسی' },
      { code: 'en-US', label: 'English' },
    ],
    []
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

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const trimmedUsername = username.trim();

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

      const result =
        mode === 'register'
          ? await register({
              username: trimmedUsername,
              password,
              phone: normalizedPhone,
              remember: rememberMe,
            })
          : await login({ username: trimmedUsername, password, remember: rememberMe });

      if (result.success) {
        if (rememberMe) {
          localStorage.setItem(REMEMBER_ME_KEY, 'true');
          localStorage.setItem(REMEMBERED_USERNAME_KEY, obfuscate(trimmedUsername));
        } else {
          localStorage.removeItem(REMEMBER_ME_KEY);
          localStorage.removeItem(REMEMBERED_USERNAME_KEY);
        }
        localStorage.removeItem(REMEMBERED_PASSWORD_KEY);

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
    [confirmPassword, login, mode, navigate, password, phone, register, rememberMe, showMessage, t, username]
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
          {supportedLanguages.map((lang) => (
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
              <p>{t('login.localPrivacy')}</p>
              <p>{t('login.oauthUnavailable')}</p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
