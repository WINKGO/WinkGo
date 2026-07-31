// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { configService } from '@/common/config/configService';
import { SYSTEM_THEME_ID } from '@/common/theme/constants';
import type { Theme } from '@/common/theme/types';
import { uuid } from '@/common/utils';
import { useThemeContext } from '@renderer/hooks/context/ThemeContext';
import { Button, Message, Modal } from '@arco-design/web-react';
import { CheckOne, EditTwo, Plus } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CssThemeModal from './CssThemeModal';
import { BACKGROUND_BLOCK_START, injectBackgroundCssBlock } from './backgroundUtils';

const ensureBackgroundCss = <T extends { cover?: string; css?: string }>(theme: T): T => {
  if (theme.cover && theme.css && !theme.css.includes(BACKGROUND_BLOCK_START)) {
    return { ...theme, css: injectBackgroundCssBlock(theme.css, theme.cover) };
  }
  return theme;
};

const SystemThemePreview: React.FC = () => (
  <span className='relative size-46px shrink-0 overflow-hidden rd-8px border border-border-2 bg-white'>
    <span className='absolute inset-0 bg-white' />
    <span className='absolute inset-0 bg-[#20242b]' style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }} />
    <span className='absolute left-7px top-8px h-4px w-22px rd-full bg-[#cbd5e1]' />
    <span className='absolute bottom-8px right-7px h-4px w-18px rd-full bg-[#64748b]' />
  </span>
);

const UserThemePreview: React.FC<{ theme: Theme }> = ({ theme }) => (
  <span
    className='relative size-46px shrink-0 overflow-hidden rd-8px border border-border-2'
    style={
      theme.cover
        ? { backgroundImage: `url(${theme.cover})`, backgroundPosition: 'center', backgroundSize: 'cover' }
        : { backgroundColor: theme.appearance === 'dark' ? '#20242b' : '#ffffff' }
    }
  >
    {!theme.cover ? (
      <>
        <span className='absolute left-7px top-8px h-4px w-22px rd-full bg-[#cbd5e1]' />
        <span className='absolute bottom-8px right-7px h-4px w-18px rd-full bg-[#64748b]' />
      </>
    ) : null}
  </span>
);

const CssThemeSettings: React.FC = () => {
  const { t } = useTranslation();
  const { activeId, selectTheme } = useThemeContext();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingTheme, setEditingTheme] = useState<Theme | null>(null);

  useEffect(() => {
    let cancelled = false;
    void configService
      .whenReady()
      .then(() => {
        if (cancelled) return;
        const userThemes = ((configService.get('theme.userThemes') as Theme[] | undefined) ?? []).map(
          ensureBackgroundCss
        );
        setThemes(userThemes.filter((theme) => !theme.builtin));
      })
      .catch((error) => console.error('Failed to load custom themes:', error));
    return () => {
      cancelled = true;
    };
  }, []);

  const activeThemeId = activeId ?? SYSTEM_THEME_ID;
  const visibleThemes = useMemo(
    () => [
      {
        id: SYSTEM_THEME_ID,
        name: t('settings.cssTheme.followSystem'),
        appearance: 'light' as const,
        builtin: true,
        created_at: 0,
        updated_at: 0,
      },
      ...themes,
    ],
    [t, themes]
  );

  const handleSelectTheme = useCallback(
    async (theme: Theme) => {
      try {
        await selectTheme(theme.id);
        Message.success(t('settings.cssTheme.applied', { name: theme.name }));
      } catch {
        Message.error(t('settings.cssTheme.applyFailed'));
      }
    },
    [selectTheme, t]
  );

  const handleSaveTheme = useCallback(
    async (themeData: Omit<Theme, 'id' | 'created_at' | 'updated_at' | 'builtin'>) => {
      try {
        const now = Date.now();
        const normalizedThemeData = ensureBackgroundCss(themeData);
        const savedTheme: Theme = editingTheme
          ? { ...editingTheme, ...normalizedThemeData, updated_at: now }
          : {
              id: uuid(),
              ...normalizedThemeData,
              builtin: false,
              created_at: now,
              updated_at: now,
            };
        const nextThemes = editingTheme
          ? themes.map((theme) => (theme.id === editingTheme.id ? savedTheme : theme))
          : [...themes, savedTheme];

        await configService.set('theme.userThemes', nextThemes);
        setThemes(nextThemes);
        if (editingTheme?.id === activeThemeId) {
          await selectTheme(editingTheme.id);
        }
        setModalVisible(false);
        setEditingTheme(null);
        Message.success(t('common.saveSuccess'));
      } catch (error) {
        console.error('Failed to save custom theme:', error);
        Message.error(t('common.saveFailed'));
      }
    },
    [activeThemeId, editingTheme, selectTheme, t, themes]
  );

  const handleDeleteTheme = useCallback(
    (themeId: string) => {
      Modal.confirm({
        title: t('common.confirmDelete'),
        content: t('settings.cssTheme.deleteConfirm'),
        okButtonProps: { status: 'danger' },
        onOk: async () => {
          try {
            const nextThemes = themes.filter((theme) => theme.id !== themeId);
            await configService.set('theme.userThemes', nextThemes);
            if (activeThemeId === themeId) {
              await selectTheme(SYSTEM_THEME_ID);
            }
            setThemes(nextThemes);
            setModalVisible(false);
            setEditingTheme(null);
            Message.success(t('common.deleteSuccess'));
          } catch (error) {
            console.error('Failed to delete custom theme:', error);
            Message.error(t('common.deleteFailed'));
          }
        },
      });
    },
    [activeThemeId, selectTheme, t, themes]
  );

  return (
    <div className='space-y-12px' data-testid='system-theme-only'>
      <div className='flex flex-wrap items-start justify-between gap-12px'>
        <div>
          <div className='text-14px text-t-primary leading-22px'>{t('settings.theme')}</div>
          <span className='mt-6px block text-13px leading-20px text-t-secondary'>
            {t('settings.cssTheme.selectOrCustomize')}
          </span>
        </div>
        <Button
          type='primary'
          size='small'
          icon={<Plus theme='outline' size='15' fill='currentColor' />}
          className='!h-32px !rd-8px !px-14px'
          onClick={() => {
            setEditingTheme(null);
            setModalVisible(true);
          }}
        >
          {t('settings.cssTheme.addManually')}
        </Button>
      </div>

      <div className='grid w-full gap-10px md:grid-cols-2'>
        {visibleThemes.map((theme) => (
          <div
            key={theme.id}
            role='button'
            tabIndex={0}
            className={`group flex min-h-76px cursor-pointer items-center justify-between gap-14px rd-8px border-2 bg-1 px-14px py-12px transition-colors ${activeThemeId === theme.id ? 'border-primary-5' : 'border-transparent hover:border-border-2'}`}
            onClick={() => void handleSelectTheme(theme)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void handleSelectTheme(theme);
              }
            }}
          >
            <div className='flex min-w-0 items-center gap-12px'>
              {theme.id === SYSTEM_THEME_ID ? <SystemThemePreview /> : <UserThemePreview theme={theme} />}
              <div className='min-w-0'>
                <strong className='block truncate text-14px text-t-primary'>{theme.name}</strong>
                <span className='mt-2px block text-12px leading-18px text-t-tertiary'>
                  {theme.id === SYSTEM_THEME_ID
                    ? t('settings.cssTheme.systemOnlyHint')
                    : theme.appearance === 'dark'
                      ? t('settings.darkMode')
                      : t('settings.lightMode')}
                </span>
              </div>
            </div>
            <div className='flex shrink-0 items-center gap-8px'>
              {theme.id !== SYSTEM_THEME_ID ? (
                <Button
                  type='text'
                  size='mini'
                  aria-label={t('settings.cssTheme.editTheme')}
                  icon={<EditTwo theme='outline' size='16' fill='currentColor' />}
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingTheme(theme);
                    setModalVisible(true);
                  }}
                />
              ) : null}
              {activeThemeId === theme.id ? <CheckOne theme='filled' size='20' fill='rgb(var(--primary-6))' /> : null}
            </div>
          </div>
        ))}
      </div>

      <CssThemeModal
        visible={modalVisible}
        theme={editingTheme}
        onClose={() => {
          setModalVisible(false);
          setEditingTheme(null);
        }}
        onSave={handleSaveTheme}
        onDelete={editingTheme ? () => handleDeleteTheme(editingTheme.id) : undefined}
      />
    </div>
  );
};

export default CssThemeSettings;
