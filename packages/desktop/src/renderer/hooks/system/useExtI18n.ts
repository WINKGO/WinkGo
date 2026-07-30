/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { extensions as extensionsIpc, type IExtensionSettingsTab } from '@/common/adapter/ipcBridge';

type NestedRecord = Record<string, unknown>;
type ExtI18nData = Record<string, unknown>;

const localeCache = new Map<string, ExtI18nData>();
const localeRequests = new Map<string, Promise<ExtI18nData>>();

function loadExtI18n(locale: string): Promise<ExtI18nData> {
  const cached = localeCache.get(locale);
  if (cached) return Promise.resolve(cached);

  const existingRequest = localeRequests.get(locale);
  if (existingRequest) return existingRequest;

  const request = extensionsIpc.getExtI18nForLocale
    .invoke({ locale })
    .then((data) => {
      const resolved = data ?? {};
      localeCache.set(locale, resolved);
      return resolved;
    })
    .finally(() => {
      localeRequests.delete(locale);
    });

  localeRequests.set(locale, request);
  return request;
}

export function clearExtI18nCache(): void {
  localeCache.clear();
  localeRequests.clear();
}

/**
 * Deeply resolve a dot-separated key path from a nested object.
 * e.g. resolve('settingsTabs.ext-feishu.name', { settingsTabs: { 'ext-feishu': { name: 'Feishu' } } })
 */
function deepGet(obj: unknown, keyPath: string): string | undefined {
  const parts = keyPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as NestedRecord)[part];
  }
  return typeof current === 'string' ? current : undefined;
}

/**
 * Hook that provides a resolver function for extension settings tab names
 * with i18n support. Fetches extension i18n data for the current locale
 * and looks up `settingsTabs.{tabId}.name` in the extension's namespace.
 *
 * Falls back to `tab.label` when no translation is found.
 */
function getLocalSettingsTabId(tab: IExtensionSettingsTab): string {
  const globalPrefix = `ext-${tab.extensionName}-`;
  return tab.id.startsWith(globalPrefix) ? tab.id.slice(globalPrefix.length) : tab.id;
}

export function useExtI18n(): {
  resolveExtTabName: (tab: IExtensionSettingsTab) => string;
} {
  const { i18n } = useTranslation();
  const locale = i18n.language;
  const [extI18nData, setExtI18nData] = useState<ExtI18nData>(() => localeCache.get(locale) ?? {});

  useEffect(() => {
    let active = true;
    const cached = localeCache.get(locale);
    if (cached) {
      setExtI18nData(cached);
      return () => {
        active = false;
      };
    }

    setExtI18nData({});
    void loadExtI18n(locale)
      .then((data) => {
        if (active) setExtI18nData(data);
      })
      .catch((err) => console.error('[useExtI18n] Failed to load ext i18n:', err));

    return () => {
      active = false;
    };
  }, [locale]);

  const resolveExtTabName = useCallback(
    (tab: IExtensionSettingsTab): string => {
      const nsData = extI18nData[tab.extensionName] as NestedRecord | undefined;
      const localTabId = getLocalSettingsTabId(tab);
      if (nsData) {
        const translated =
          deepGet(nsData, `extension.settingsTabs.${localTabId}.name`) ?? deepGet(nsData, `settings.tab.${localTabId}`);
        if (translated) return translated;
      }
      return tab.label;
    },
    [extI18nData]
  );

  return { resolveExtTabName };
}
