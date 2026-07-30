/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { dialog, fs } from '@/common/adapter/ipcBridge';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input, Message, Tooltip } from '@arco-design/web-react';
import { ArrowCircleLeft, CloseOne, Moon, SettingTwo, SunOne, UploadPicture } from '@icon-park/react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import defaultUserAvatar from '@renderer/assets/brand/winkgo-user-avatar-v1.png';
import styles from './Sider.module.css';

interface SiderUser {
  username: string;
  provider?: string;
}

interface SiderFooterProps {
  isMobile: boolean;
  isSettings: boolean;
  collapsed?: boolean;
  theme: string;
  siderTooltipProps: SiderTooltipProps;
  onSettingsClick: () => void;
  onSettingsIntent?: () => void;
  onThemeToggle: () => void;
  user?: SiderUser;
  onLogoutClick?: () => void;
}

interface StoredUserProfile {
  displayName: string;
  avatar?: string;
}

const USER_PROFILE_STORAGE_PREFIX = 'winkgo:user-profile:';
const MAX_STORED_AVATAR_LENGTH = 240_000;

const getProfileStorageKey = (username: string) => `${USER_PROFILE_STORAGE_PREFIX}${username}`;

const readStoredProfile = (user: SiderUser): StoredUserProfile => {
  try {
    const stored = window.localStorage.getItem(getProfileStorageKey(user.username));
    if (!stored) return { displayName: user.username };
    const parsed = JSON.parse(stored) as Partial<StoredUserProfile>;
    return {
      displayName: parsed.displayName?.trim() || user.username,
      avatar: typeof parsed.avatar === 'string' ? parsed.avatar : undefined,
    };
  } catch {
    return { displayName: user.username };
  }
};

const shrinkAvatarDataUrl = async (source: string): Promise<string> => {
  if (source.length <= MAX_STORED_AVATAR_LENGTH || source.startsWith('data:image/svg')) return source;

  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener('load', () => {
      const longestEdge = Math.max(image.width, image.height);
      const scale = Math.min(1, 256 / longestEdge);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(source);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      } catch {
        resolve(source);
      }
    });
    image.addEventListener('error', () => resolve(source));
    image.src = source;
  });
};

const ProfileAvatar: React.FC<{
  avatar?: string;
  displayName: string;
  className?: string;
  testId: string;
}> = ({ avatar, className, testId }) => {
  if (avatar) {
    return <img src={avatar} alt='' className={className} data-testid={testId} />;
  }

  return <img src={defaultUserAvatar} alt='' className={className} data-testid={testId} />;
};

const SiderFooter: React.FC<SiderFooterProps> = ({
  isMobile,
  isSettings,
  collapsed = false,
  theme,
  siderTooltipProps,
  onSettingsClick,
  onSettingsIntent,
  onThemeToggle,
  user,
  onLogoutClick,
}) => {
  const { t } = useTranslation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profile, setProfile] = useState<StoredUserProfile>(() =>
    user ? readStoredProfile(user) : { displayName: '' }
  );
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [draftName, setDraftName] = useState(profile.displayName);
  const [draftAvatar, setDraftAvatar] = useState(profile.avatar);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (!user) {
      setUserMenuOpen(false);
      return;
    }
    const nextProfile = readStoredProfile(user);
    setProfile(nextProfile);
    setDraftName(nextProfile.displayName);
    setDraftAvatar(nextProfile.avatar);
    setIsEditingProfile(false);
  }, [user?.username]);

  useEffect(() => {
    if (userMenuOpen) return;
    setIsEditingProfile(false);
    setDraftName(profile.displayName);
    setDraftAvatar(profile.avatar);
  }, [profile, userMenuOpen]);

  const handlePickAvatar = useCallback(async () => {
    try {
      const selectedFiles = await dialog.showOpen.invoke({
        properties: ['openFile'],
        filters: [
          {
            name: t('settings.assistantAvatarImageFiles'),
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'],
          },
        ],
      });
      const pickedPath = selectedFiles?.[0];
      if (!pickedPath) return;
      const dataUrl = await fs.getImageBase64.invoke({ path: pickedPath });
      if (!dataUrl) return;
      setDraftAvatar(await shrinkAvatarDataUrl(dataUrl));
    } catch (error) {
      console.error('Failed to select a WINK GO profile avatar:', error);
      Message.error(t('common.failed'));
    }
  }, [t]);

  const handleSaveProfile = useCallback(() => {
    if (!user) return;
    const displayName = draftName.trim();
    if (!displayName) return;
    const nextProfile = { displayName, avatar: draftAvatar };
    setProfile(nextProfile);
    try {
      window.localStorage.setItem(getProfileStorageKey(user.username), JSON.stringify(nextProfile));
    } catch (error) {
      console.error('Failed to persist the WINK GO local profile:', error);
    }
    setIsEditingProfile(false);
  }, [draftAvatar, draftName, user]);

  const settingsIcon = isSettings ? (
    <ArrowCircleLeft
      theme='outline'
      size='16'
      fill='currentColor'
      className='block leading-none'
      style={{ lineHeight: 0 }}
    />
  ) : (
    <SettingTwo
      theme='outline'
      size='16'
      fill='currentColor'
      className='block leading-none'
      style={{ lineHeight: 0 }}
    />
  );
  const showThemeToggle = isSettings && !collapsed;
  const themeTooltip = theme === 'dark' ? t('settings.lightMode') : t('settings.darkMode');

  return (
    <div className='shrink-0 sider-footer mt-auto pt-8px pb-8px border-t border-solid border-[var(--color-border-2)] border-l-0 border-r-0 border-b-0'>
      <div className={classNames('flex', collapsed ? 'flex-col gap-2px' : 'items-center gap-2px')}>
        <Tooltip {...siderTooltipProps} content={isSettings ? t('common.back') : t('common.settings')} position='right'>
          <div
            onClick={onSettingsClick}
            onPointerEnter={onSettingsIntent}
            className={classNames(
              'group h-34px flex items-center rd-0.5rem cursor-pointer transition-colors',
              collapsed ? 'w-full justify-center' : 'flex-1 min-w-0 justify-start gap-8px pl-10px pr-8px',
              isMobile && 'sider-footer-btn-mobile',
              {
                'bg-fill-3': isSettings,
                'hover:bg-fill-3 active:bg-fill-4': !isSettings,
              }
            )}
          >
            <span className='size-22px flex items-center justify-center shrink-0 text-t-secondary'>{settingsIcon}</span>
            <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px truncate'>
              {isSettings ? t('common.back') : t('common.settings')}
            </span>
          </div>
        </Tooltip>
        {/* Theme toggle — lightweight icon button, only while inside Settings page (not in collapsed mode) */}
        {showThemeToggle && (
          <Tooltip {...siderTooltipProps} content={themeTooltip} position='right'>
            <div
              onClick={onThemeToggle}
              className={classNames(
                'h-32px w-40px shrink-0 flex items-center justify-center cursor-pointer rd-0.5rem transition-colors text-t-secondary hover:bg-fill-2 hover:text-t-primary active:bg-fill-3',
                isMobile && 'sider-footer-btn-mobile'
              )}
              aria-label={themeTooltip}
            >
              <span className='w-28px h-28px flex items-center justify-center shrink-0'>
                {theme === 'dark' ? (
                  <SunOne theme='outline' size='18' fill='currentColor' className='block leading-none' />
                ) : (
                  <Moon theme='outline' size='18' fill='currentColor' className='block leading-none' />
                )}
              </span>
            </div>
          </Tooltip>
        )}
        {user && (
          <div ref={userMenuRef} className={classNames(styles.userMenuRoot, collapsed && styles.userMenuRootCollapsed)}>
            {userMenuOpen && (
              <div className={styles.userMenu} role='menu' data-testid='sider-user-menu'>
                <div className={styles.userMenuHeader}>
                  <span className={styles.userMenuAvatar}>
                    <ProfileAvatar
                      avatar={profile.avatar}
                      displayName={profile.displayName}
                      className={styles.userAvatarVisual}
                      testId='sider-user-menu-avatar'
                    />
                  </span>
                  <span className={styles.userMenuIdentity}>
                    <strong title={profile.displayName}>{profile.displayName}</strong>
                    <small>WINK GO · {user.provider === 'local' || !user.provider ? 'winkgo' : user.provider}</small>
                  </span>
                </div>
                {isEditingProfile ? (
                  <div className={styles.userProfileEditor} data-testid='sider-user-profile-editor'>
                    <div className={styles.userProfileAvatarRow}>
                      <ProfileAvatar
                        avatar={draftAvatar}
                        displayName={draftName || profile.displayName}
                        className={styles.userProfileAvatarPreview}
                        testId='sider-user-profile-avatar'
                      />
                      <Button
                        size='mini'
                        type='secondary'
                        icon={<UploadPicture theme='outline' size='15' fill='currentColor' />}
                        onClick={handlePickAvatar}
                      >
                        {t('settings.assistantAvatarUploadImage')}
                      </Button>
                    </div>
                    <Input
                      size='small'
                      value={draftName}
                      aria-label={t('common.name')}
                      maxLength={32}
                      onChange={setDraftName}
                    />
                    <div className={styles.userProfileEditorActions}>
                      <Button
                        size='mini'
                        onClick={() => {
                          setDraftName(profile.displayName);
                          setDraftAvatar(profile.avatar);
                          setIsEditingProfile(false);
                        }}
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button size='mini' type='primary' disabled={!draftName.trim()} onClick={handleSaveProfile}>
                        {t('common.save')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type='text'
                    role='menuitem'
                    className={styles.userMenuAction}
                    onClick={() => {
                      setDraftName(profile.displayName);
                      setDraftAvatar(profile.avatar);
                      setIsEditingProfile(true);
                    }}
                  >
                    <SettingTwo theme='outline' size='16' fill='currentColor' />
                    <span>{t('common.settings')}</span>
                  </Button>
                )}
                {!isEditingProfile && onLogoutClick && (
                  <Button
                    type='text'
                    role='menuitem'
                    className={classNames(styles.userMenuAction, styles.userMenuLogout)}
                    onClick={() => {
                      setUserMenuOpen(false);
                      onLogoutClick();
                    }}
                  >
                    <CloseOne theme='outline' size='16' fill='currentColor' />
                    <span>{t('settings.googleLogout')}</span>
                  </Button>
                )}
              </div>
            )}
            <Tooltip
              {...siderTooltipProps}
              content={profile.displayName}
              position='right'
              disabled={userMenuOpen || !collapsed}
            >
              <Button
                type='text'
                className={classNames(
                  styles.userButton,
                  userMenuOpen && styles.userButtonActive,
                  isMobile && 'sider-footer-btn-mobile'
                )}
                aria-label={`${t('common.name')}: ${profile.displayName}`}
                aria-haspopup='menu'
                aria-expanded={userMenuOpen}
                data-testid='sider-user-button'
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <ProfileAvatar
                  avatar={profile.avatar}
                  displayName={profile.displayName}
                  className={styles.userAvatarVisual}
                  testId='sider-user-avatar'
                />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
};

export default SiderFooter;
