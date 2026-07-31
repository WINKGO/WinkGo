// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import { ipcBridge } from '@/common';
import { resolveActiveTheme } from '@/common/theme/resolveTheme';
import { applyTheme, setActiveTheme } from '@/renderer/utils/theme/applyTheme';
import { getSystemPrefersDark } from '@/renderer/utils/theme/systemAppearance';
import { startSystemThemeWatcher } from '@/renderer/utils/theme/systemThemeWatcher';
import { BUILTIN_THEMES } from '@renderer/theme/builtinThemes';
import { SYSTEM_THEME_ID } from '@/common/theme/constants';
import type { Theme } from '@/common/theme/types';
import { useCallback, useEffect, useState } from 'react';

const APPEARANCE_CACHE_KEY = '__winkgo_theme';

function getPersistedActiveId(): string {
  return SYSTEM_THEME_ID;
}

async function initActiveTheme(): Promise<Theme> {
  try {
    await configService.whenReady();
    const activeId = getPersistedActiveId();
    if (configService.get('theme.activeId') !== SYSTEM_THEME_ID) {
      await configService.set('theme.activeId', SYSTEM_THEME_ID);
    }
    const userThemes = (configService.get('theme.userThemes') as Theme[]) ?? [];
    const resolved = resolveActiveTheme(activeId, [...BUILTIN_THEMES, ...userThemes], getSystemPrefersDark());
    applyTheme(resolved);
    try {
      localStorage.setItem(APPEARANCE_CACHE_KEY, resolved.appearance);
    } catch {
      /* noop */
    }
    // Seed the main-process relay so other surfaces (markdown shadow DOM, pet windows) can pull it.
    void ipcBridge.theme.setActive.invoke(resolved).catch(() => {});
    return resolved;
  } catch (e) {
    console.error('init theme failed', e);
    const fallback = resolveActiveTheme(SYSTEM_THEME_ID, BUILTIN_THEMES, getSystemPrefersDark());
    applyTheme(fallback);
    return fallback;
  }
}

let initialPromise: Promise<Theme> | null = null;
if (typeof window !== 'undefined') initialPromise = initActiveTheme();

/**
 * Returns [resolvedActiveTheme, selectThemeById, rawActiveId]. `rawActiveId` may be the
 * `system` sentinel while the resolved theme is the Light/Dark builtin — the gallery
 * highlights cards by `rawActiveId`.
 */
const useTheme = (): [Theme | null, (activeId: string) => Promise<void>, string | null] => {
  const [active, setActive] = useState<Theme | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    initialPromise
      ?.then((t) => {
        if (mounted) {
          setActive(t);
          setActiveId(getPersistedActiveId());
        }
      })
      .catch((e) => console.error('init theme failed', e));
    const off = ipcBridge.theme.changed.on((t: Theme) => {
      applyTheme(t);
      if (mounted) {
        setActive((prev) => (prev?.id === t.id ? prev : t));
        setActiveId(SYSTEM_THEME_ID);
      }
      try {
        localStorage.setItem(APPEARANCE_CACHE_KEY, t.appearance);
      } catch {
        /* noop */
      }
    });
    const offSystemWatch = startSystemThemeWatcher();
    return () => {
      mounted = false;
      off?.();
      offSystemWatch();
    };
  }, []);

  const select = useCallback(async (_activeId: string) => {
    await setActiveTheme(SYSTEM_THEME_ID);
    setActiveId(SYSTEM_THEME_ID);
  }, []);

  return [active, select, activeId];
};

export default useTheme;
