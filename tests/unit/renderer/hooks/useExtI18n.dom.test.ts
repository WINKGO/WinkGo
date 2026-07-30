/**
 * @license
 * Copyright 2025 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExtensionSettingsTab } from '@/common/adapter/ipcBridge';

const { getExtI18nForLocaleMock, languageState } = vi.hoisted(() => ({
  getExtI18nForLocaleMock: vi.fn(),
  languageState: { current: 'zh-CN' },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  extensions: {
    getExtI18nForLocale: {
      invoke: getExtI18nForLocaleMock,
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: languageState.current },
  }),
}));

import { clearExtI18nCache, useExtI18n } from '@/renderer/hooks/system/useExtI18n';

const extensionTab = {
  id: 'ext-demo-general',
  extensionName: 'demo',
  label: 'Fallback label',
} as IExtensionSettingsTab;

describe('useExtI18n shared locale cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearExtI18nCache();
    languageState.current = 'zh-CN';
  });

  it('deduplicates concurrent extension locale requests across mounted settings panels', async () => {
    getExtI18nForLocaleMock.mockResolvedValue({
      demo: {
        extension: {
          settingsTabs: {
            general: { name: '扩展设置' },
          },
        },
      },
    });

    const first = renderHook(() => useExtI18n());
    const second = renderHook(() => useExtI18n());

    await waitFor(() => {
      expect(first.result.current.resolveExtTabName(extensionTab)).toBe('扩展设置');
      expect(second.result.current.resolveExtTabName(extensionTab)).toBe('扩展设置');
    });

    expect(getExtI18nForLocaleMock).toHaveBeenCalledTimes(1);
    expect(getExtI18nForLocaleMock).toHaveBeenCalledWith({ locale: 'zh-CN' });
  });

  it('reuses resolved locale data when a settings panel remounts', async () => {
    getExtI18nForLocaleMock.mockResolvedValue({
      demo: {
        extension: {
          settingsTabs: {
            general: { name: '扩展设置' },
          },
        },
      },
    });

    const first = renderHook(() => useExtI18n());
    await waitFor(() => expect(first.result.current.resolveExtTabName(extensionTab)).toBe('扩展设置'));
    first.unmount();

    const second = renderHook(() => useExtI18n());
    expect(second.result.current.resolveExtTabName(extensionTab)).toBe('扩展设置');
    expect(getExtI18nForLocaleMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed request so a later settings panel can retry', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getExtI18nForLocaleMock.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce({
      demo: {
        extension: {
          settingsTabs: {
            general: { name: '恢复后的设置' },
          },
        },
      },
    });

    const first = renderHook(() => useExtI18n());
    await waitFor(() => expect(getExtI18nForLocaleMock).toHaveBeenCalledTimes(1));
    first.unmount();

    const second = renderHook(() => useExtI18n());
    await waitFor(() => expect(second.result.current.resolveExtTabName(extensionTab)).toBe('恢复后的设置'));

    expect(getExtI18nForLocaleMock).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });
});
