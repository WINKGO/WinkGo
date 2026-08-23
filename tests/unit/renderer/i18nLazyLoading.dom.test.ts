// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const configGet = vi.fn(() => 'zh-CN');
const configSet = vi.fn(async () => {});
const languageChangedOn = vi.fn();
const mainLanguageChange = vi.fn(async () => {});

vi.mock('@/common/config/configService', () => ({
  configService: {
    whenReady: vi.fn(async () => {}),
    get: configGet,
    set: configSet,
  },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    systemSettings: {
      changeLanguage: { invoke: mainLanguageChange },
      languageChanged: { on: languageChangedOn },
    },
  },
}));

describe('renderer i18n lazy loading', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('i18nextLng', 'zh-CN');
  });

  it('loads only the hinted locale at startup and adds another locale on demand', async () => {
    const locale = await import('@/renderer/services/i18n');
    await locale.i18nStartup;

    expect(locale.default.language).toBe('zh-CN');
    expect(locale.getLoadedLanguages()).toEqual(expect.arrayContaining(['en-US', 'zh-CN']));
    expect(locale.getLoadedLanguages()).not.toContain('ja-JP');
    expect(locale.default.t('common.confirm')).toBe('确定');

    await locale.changeLanguage('ja-JP');

    expect(locale.default.language).toBe('ja-JP');
    expect(locale.getLoadedLanguages()).toContain('ja-JP');
    expect(locale.default.t('common.confirm')).toBe('確認');
    expect(configSet).toHaveBeenCalledWith('language', 'ja-JP');
  });
});
