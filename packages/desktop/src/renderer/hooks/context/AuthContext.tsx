// Modified from AionUI by WINK GO contributors in 2026.
import { ipcBridge } from '@/common';
import {
  hasWinkGoCapability,
  resolveWinkGoEditionSnapshot,
  type WinkGoCapability,
  type WinkGoEditionSnapshot,
} from '@/common/types/platform/winkGoEdition';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
// M6: CSRF removed with legacy webserver — stub functions for compatibility, re-implement in M7
const withCsrfToken = <T extends Record<string, unknown>>(data: T): T => data;
const hasValidCsrfToken = (): boolean => true;
const clearCookie = (_name: string, _path?: string): void => {};
const CSRF_COOKIE_NAME = 'csrf-token';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  id: string;
  username: string;
  phone?: string;
  provider?: ipcBridge.WinkGoAuthProvider;
  createdAt?: string;
  lastLoginAt?: string;
  loginCount?: number;
}

interface LoginParams {
  username: string;
  password: string;
  phone?: string;
  remember?: boolean;
  privacyVersion?: string;
  termsVersion?: string;
  source?: 'desktop_login' | 'desktop_registration';
}

type LoginErrorCode =
  | 'invalidCredentials'
  | 'accountExists'
  | 'licenseDenied'
  | 'validationError'
  | 'tooManyAttempts'
  | 'localError'
  | 'serverError'
  | 'networkError'
  | 'csrfError'
  | 'unknown';

interface LoginResult {
  success: boolean;
  message?: string;
  code?: LoginErrorCode;
  shouldClearCache?: boolean;
}

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  status: AuthStatus;
  edition: WinkGoEditionSnapshot;
  can: (capability: WinkGoCapability) => boolean;
  login: (params: LoginParams) => Promise<LoginResult>;
  register: (params: LoginParams) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clearAuthCache: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_USER_ENDPOINT = '/api/auth/user';

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);
const DEFAULT_WEB_EDITION = resolveWinkGoEditionSnapshot({
  buildEdition: 'free',
  authenticated: false,
});

function isElectronE2ETestRuntime(): boolean {
  return typeof window !== 'undefined' && window.__winkgoE2ETest === true;
}

// Clear expired auth cache including cookies and localStorage
// 清除过期的认证缓存，包括 Cookie 和 localStorage
function clearAuthCache(): void {
  if (typeof window === 'undefined') return;

  try {
    // Clear CSRF cookie
    clearCookie(CSRF_COOKIE_NAME);
    clearCookie(CSRF_COOKIE_NAME, '/');

    // Clear localStorage auth-related items
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.includes('auth') || key.includes('csrf') || key.includes('token'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch (error) {
    console.error('Failed to clear auth cache:', error);
  }
}

async function fetchCurrentUser(signal?: AbortSignal): Promise<AuthUser | null> {
  try {
    const response = await fetch(AUTH_USER_ENDPOINT, {
      method: 'GET',
      credentials: 'include',
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      success: boolean;
      user?: AuthUser;
    };
    if (data.success && data.user) {
      return data.user;
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return null;
    }
    console.error('Failed to fetch current user:', error);
  }

  return null;
}

export const AuthProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');
  const [edition, setEdition] = useState<WinkGoEditionSnapshot>(DEFAULT_WEB_EDITION);
  const [ready, setReady] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    // Electron navigation tests use a disposable user-data directory and must
    // never depend on a real WINK GO cloud account. The flag is injected by
    // the isolated Playwright main process and is false in production builds.
    if (isElectronE2ETestRuntime()) {
      setUser({ id: 'winkgo-e2e-user', username: 'WINK GO E2E' });
      setEdition(
        resolveWinkGoEditionSnapshot({
          buildEdition: 'free',
          authenticated: true,
        })
      );
      setStatus('authenticated');
      setReady(true);
      return;
    }

    if (isDesktopRuntime) {
      setStatus('checking');
      try {
        const session = await ipcBridge.winkGoAuth.getSession.invoke();
        setUser(session.user);
        setEdition(session.edition || DEFAULT_WEB_EDITION);
        setStatus(session.authenticated && session.user ? 'authenticated' : 'unauthenticated');
      } catch (error) {
        console.error('Failed to read desktop authentication session:', error);
        setUser(null);
        setEdition(DEFAULT_WEB_EDITION);
        setStatus('unauthenticated');
      } finally {
        setReady(true);
      }
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('checking');

    const currentUser = await fetchCurrentUser(controller.signal);
    if (currentUser) {
      setUser(currentUser);
      setEdition(
        resolveWinkGoEditionSnapshot({
          buildEdition: 'free',
          authenticated: true,
        })
      );
      setStatus('authenticated');
    } else {
      setUser(null);
      setEdition(DEFAULT_WEB_EDITION);
      setStatus('unauthenticated');
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  const login = useCallback(
    async ({
      username,
      password,
      remember,
      privacyVersion,
      termsVersion,
      source,
    }: LoginParams): Promise<LoginResult> => {
      try {
        if (isDesktopRuntime) {
          const result = await ipcBridge.winkGoAuth.login.invoke({
            username,
            password,
            privacyVersion,
            termsVersion,
            source,
          });
          if (result.success && result.user) {
            let session: Awaited<ReturnType<typeof ipcBridge.winkGoAuth.getSession.invoke>> | undefined;
            try {
              session = await ipcBridge.winkGoAuth.getSession.invoke();
            } catch (error) {
              // The login response is authoritative for this operation. A
              // follow-up status refresh is useful metadata, but must not undo a
              // successful sign-in when the local profile is momentarily busy.
              console.warn('Desktop account session refresh failed after login:', error);
            }
            setUser(session?.user || result.user);
            setEdition(
              session?.edition ||
                resolveWinkGoEditionSnapshot({
                  buildEdition: 'free',
                  authenticated: true,
                })
            );
            // The login response is authoritative for this operation. A
            // separately refreshed session can momentarily lag behind remote
            // persistence and must not revert a successful login in the UI.
            setStatus('authenticated');
            setReady(true);
          }
          return result;
        }

        // Check CSRF token availability before login
        // If token is missing, clear cache and inform user
        const csrfTokenValid = hasValidCsrfToken();
        if (!csrfTokenValid) {
          console.warn('CSRF token missing or invalid, clearing cache');
          clearAuthCache();
          // Allow login to proceed anyway - server will set new token
        }

        // P1 安全修复：登录请求需要 CSRF Token / P1 Security fix: Login needs CSRF token
        // Backend route is /login; web-host's static-server explicitly proxies it.
        const response = await fetch('/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(withCsrfToken({ username, password, remember, privacyVersion, termsVersion, source })),
        });

        const data = (await response.json()) as {
          success: boolean;
          message?: string;
          user?: AuthUser;
        };

        if (!response.ok || !data.success || !data.user) {
          let code: LoginErrorCode = 'unknown';
          let message = data?.message ?? 'Login failed';
          let shouldClearCache = false;

          if (response.status === 401) {
            code = 'invalidCredentials';
          } else if (response.status === 403) {
            // CSRF validation failed - clear cache
            code = 'csrfError';
            message = 'Security token expired. Please try again.';
            shouldClearCache = true;
          } else if (response.status === 429) {
            code = 'tooManyAttempts';
          } else if (response.status >= 500) {
            code = 'serverError';
          } else if (!csrfTokenValid) {
            // If we knew CSRF was invalid and login failed, suggest cache clear
            code = 'csrfError';
            message = 'Login failed due to cached data. Please clear your browser cache and try again.';
            shouldClearCache = true;
          }

          // Clear cache on CSRF-related errors
          if (shouldClearCache) {
            clearAuthCache();
          }

          return {
            success: false,
            message,
            code,
            shouldClearCache,
          };
        }

        setUser(data.user);
        setEdition(
          resolveWinkGoEditionSnapshot({
            buildEdition: 'free',
            authenticated: true,
          })
        );
        setStatus('authenticated');
        setReady(true);

        // Re-enable WebSocket reconnection after successful login (WebUI mode only)
        const reconnectWindow = window as Window & { __websocketReconnect?: () => void };
        if (reconnectWindow.__websocketReconnect) {
          reconnectWindow.__websocketReconnect();
        }

        return { success: true };
      } catch (error) {
        console.error('Login request failed:', error);

        // Check if error is related to CSRF token parsing
        const errorMessage = (error as Error).message;
        if (errorMessage?.includes('parse') || errorMessage?.includes('csrf') || errorMessage?.includes('cookie')) {
          // CSRF or cookie parsing error - clear cache
          clearAuthCache();
          return {
            success: false,
            message: 'Login failed due to cached data. Please clear your browser cache and try again.',
            code: 'csrfError',
            shouldClearCache: true,
          };
        }

        return {
          success: false,
          message: 'Desktop account service failed. Please try again.',
          code: 'serverError',
        };
      }
    },
    []
  );

  const register = useCallback(
    async ({ username, password, phone, privacyVersion, termsVersion, source }: LoginParams): Promise<LoginResult> => {
      if (!isDesktopRuntime) {
        return { success: false, code: 'unknown' };
      }

      try {
        const result = await ipcBridge.winkGoAuth.register.invoke({
          username,
          password,
          phone,
          privacyVersion,
          termsVersion,
          source,
        });
        if (result.success && result.user) {
          let session: Awaited<ReturnType<typeof ipcBridge.winkGoAuth.getSession.invoke>> | undefined;
          try {
            session = await ipcBridge.winkGoAuth.getSession.invoke();
          } catch (error) {
            console.warn('Desktop account session refresh failed after registration:', error);
          }
          setUser(session?.user || result.user);
          setEdition(
            session?.edition ||
              resolveWinkGoEditionSnapshot({
                buildEdition: 'free',
                authenticated: true,
              })
          );
          setStatus('authenticated');
          setReady(true);
        }
        return result;
      } catch (error) {
        console.error('Desktop account registration failed:', error);
        return { success: false, code: 'serverError' };
      }
    },
    []
  );

  const logout = useCallback(async () => {
    if (isDesktopRuntime) {
      await ipcBridge.winkGoAuth.logout.invoke();
      setUser(null);
      setEdition(DEFAULT_WEB_EDITION);
      setStatus('unauthenticated');
      return;
    }

    try {
      await fetch('/logout', {
        method: 'POST',
        // Logout also needs CSRF token / 登出同样需要 CSRF Token
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(withCsrfToken({})),
      });
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      setUser(null);
      setEdition(DEFAULT_WEB_EDITION);
      setStatus('unauthenticated');
      // Clear cache on logout for security
      clearAuthCache();
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      status,
      edition,
      can: (capability) => hasWinkGoCapability(edition, capability),
      login,
      register,
      logout,
      refresh,
      clearAuthCache,
    }),
    [edition, login, logout, ready, refresh, register, status, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
