// Modified from AionUI by WINK GO contributors in 2026.
import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme, seedElectronTheme } from '@/renderer/utils/theme/applyTheme';
import type { Theme } from '@/common/theme/types';

const base = { builtin: true, created_at: 0, updated_at: 0 };

beforeEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.body.removeAttribute('arco-theme');
  document.getElementById('theme-tokens')?.remove();
  document.getElementById('theme-decoration')?.remove();
});

describe('applyTheme', () => {
  it('sets appearance attributes', () => {
    applyTheme({ ...base, id: 'dark', name: 'Dark', appearance: 'dark' } as Theme);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.body.getAttribute('arco-theme')).toBe('dark');
  });

  it('defers arco-theme until the body is ready instead of losing the update', () => {
    const realBody = document.body;
    let bodyReady = false;
    Object.defineProperty(document, 'body', {
      configurable: true,
      get: () => (bodyReady ? realBody : null),
    });

    try {
      realBody.removeAttribute('arco-theme');
      applyTheme({ ...base, id: 'dark', name: 'Dark', appearance: 'dark' } as Theme, document);

      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(realBody.getAttribute('arco-theme')).toBeNull();

      bodyReady = true;
      document.dispatchEvent(new Event('DOMContentLoaded'));

      expect(realBody.getAttribute('arco-theme')).toBe('dark');
    } finally {
      Reflect.deleteProperty(document, 'body');
    }
  });

  it('injects decoration css when present and removes when absent', () => {
    applyTheme({ ...base, id: 'hk', name: 'HK', appearance: 'light', css: 'body{color:red}' } as Theme);
    expect(document.getElementById('theme-decoration')?.textContent).toContain('color:red');
    applyTheme({ ...base, id: 'light', name: 'Light', appearance: 'light' } as Theme);
    expect(document.getElementById('theme-decoration')).toBeNull();
  });
  it('writes tokens to a :root style block when present', () => {
    applyTheme({ ...base, id: 't', name: 'T', appearance: 'light', tokens: { '--primary': '#abc' } } as Theme);
    expect(document.getElementById('theme-tokens')?.textContent).toContain('--primary: #abc');
  });

  it('does not require the Electron bridge when WebUI seeds its theme', async () => {
    const theme = { ...base, id: 'system-light', name: 'System', appearance: 'light' } as Theme;
    const electronAPI = window.electronAPI;
    delete window.electronAPI;
    try {
      await expect(seedElectronTheme(theme)).resolves.toBeUndefined();
    } finally {
      window.electronAPI = electronAPI;
    }
  });
});
