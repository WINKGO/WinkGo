// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { SYSTEM_THEME_ID } from '@/common/theme/constants';
import { useThemeContext } from '@renderer/hooks/context/ThemeContext';
import { CheckOne } from '@icon-park/react';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const SystemThemePreview: React.FC = () => (
  <span className='relative size-46px shrink-0 overflow-hidden rd-8px border border-border-2 bg-white'>
    <span className='absolute inset-0 bg-white' />
    <span className='absolute inset-0 bg-[#20242b]' style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }} />
    <span className='absolute left-7px top-8px h-4px w-22px rd-full bg-[#cbd5e1]' />
    <span className='absolute bottom-8px right-7px h-4px w-18px rd-full bg-[#64748b]' />
  </span>
);

/** WINK GO intentionally exposes only the operating-system appearance. */
const CssThemeSettings: React.FC = () => {
  const { t } = useTranslation();
  const { activeId, selectTheme } = useThemeContext();

  useEffect(() => {
    if (activeId !== SYSTEM_THEME_ID) {
      void selectTheme(SYSTEM_THEME_ID);
    }
  }, [activeId, selectTheme]);

  return (
    <div className='space-y-12px' data-testid='system-theme-only'>
      <div>
        <div className='text-14px text-t-primary leading-22px'>{t('settings.theme')}</div>
        <span className='mt-6px block text-13px leading-20px text-t-secondary'>
          {t('settings.cssTheme.systemOnlyHint')}
        </span>
      </div>

      <div className='grid w-full gap-10px md:grid-cols-2'>
        <div
          role='status'
          aria-label={t('settings.cssTheme.followSystem')}
          className='flex min-h-76px items-center justify-between gap-14px rd-8px border-2 border-primary-5 bg-1 px-14px py-12px'
        >
          <div className='flex min-w-0 items-center gap-12px'>
            <SystemThemePreview />
            <div className='min-w-0'>
              <strong className='block truncate text-14px text-t-primary'>{t('settings.cssTheme.followSystem')}</strong>
              <span className='mt-2px block text-12px leading-18px text-t-tertiary'>
                {t('settings.cssTheme.systemOnlyHint')}
              </span>
            </div>
          </div>
          <CheckOne theme='filled' size='20' fill='rgb(var(--primary-6))' />
        </div>
      </div>
    </div>
  );
};

export default CssThemeSettings;
