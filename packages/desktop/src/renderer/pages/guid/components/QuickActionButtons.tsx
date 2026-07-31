// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { webui } from '@/common/adapter/ipcBridge';
import { Button } from '@arco-design/web-react';
import { DownloadComputer, Earth } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import styles from '../index.module.css';
import InstallerCenter from './InstallerCenter';

type QuickActionButtonsProps = {
  onOpenLink: (url: string) => void;
  inactiveBorderColor: string;
  activeShadow: string;
};

type WebuiQuickStatus = 'checking' | 'running' | 'stopped' | 'error';

const WEBUI_STATUS_CACHE_TTL_MS = 3000;
let webuiStatusCache: {
  quickStatus: WebuiQuickStatus;
  at: number;
} | null = null;

const QuickActionButtons: React.FC<QuickActionButtonsProps> = ({ onOpenLink, inactiveBorderColor, activeShadow }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [hoveredQuickAction, setHoveredQuickAction] = useState<'installer' | 'website' | 'webui' | null>(null);
  const [installerCenterVisible, setInstallerCenterVisible] = useState(false);
  const [webuiQuickStatus, setWebuiQuickStatus] = useState<WebuiQuickStatus>('checking');

  useEffect(() => {
    let alive = true;
    const loadStatus = async () => {
      const now = Date.now();
      if (webuiStatusCache && now - webuiStatusCache.at < WEBUI_STATUS_CACHE_TTL_MS) {
        setWebuiQuickStatus(webuiStatusCache.quickStatus);
        return;
      }

      try {
        const result = await webui.getStatus.invoke();
        if (!alive) return;
        if (result) {
          const quickStatus: WebuiQuickStatus = result.running ? 'running' : 'stopped';
          setWebuiQuickStatus(quickStatus);
          webuiStatusCache = { quickStatus, at: Date.now() };
          return;
        }
        setWebuiQuickStatus('error');
        webuiStatusCache = { quickStatus: 'error', at: Date.now() };
      } catch {
        if (!alive) return;
        setWebuiQuickStatus('error');
        webuiStatusCache = { quickStatus: 'error', at: Date.now() };
      }
    };

    void loadStatus();

    const unsubscribe = webui.statusChanged.on((payload) => {
      const nextQuickStatus: WebuiQuickStatus = payload.running ? 'running' : 'stopped';
      setWebuiQuickStatus(nextQuickStatus);
      webuiStatusCache = { quickStatus: nextQuickStatus, at: Date.now() };
    });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const quickActionStyle = useCallback(
    (isActive: boolean) => ({
      borderWidth: '1px',
      borderStyle: 'solid',
      borderColor: inactiveBorderColor,
      boxShadow: isActive ? activeShadow : 'none',
    }),
    [activeShadow, inactiveBorderColor]
  );

  const handleOpenWebUI = useCallback(() => {
    void navigate('/settings/webui');
  }, [navigate]);

  const webuiStatusLabel =
    webuiQuickStatus === 'running'
      ? t('settings.webui.running', { defaultValue: 'Running' })
      : webuiQuickStatus === 'checking'
        ? t('settings.webui.starting', { defaultValue: 'Checking' })
        : webuiQuickStatus === 'error'
          ? t('settings.webui.operationFailed', { defaultValue: 'Unavailable' })
          : t('settings.webui.enable', { defaultValue: 'Start' });
  const webuiIconColor =
    webuiQuickStatus === 'running'
      ? 'rgb(var(--success-6))'
      : webuiQuickStatus === 'checking'
        ? 'rgb(var(--primary-6))'
        : webuiQuickStatus === 'error'
          ? 'var(--color-text-3)'
          : 'var(--color-text-4)';

  return (
    <>
      <div
        className={`absolute left-50% -translate-x-1/2 flex flex-col justify-center items-center ${styles.guidQuickActions}`}
      >
        <div className='flex justify-center items-center gap-24px'>
          <Button
            type='text'
            className='group inline-flex items-center justify-center !h-36px !min-w-36px !max-w-36px !px-0 !rd-999px !bg-fill-0 cursor-pointer overflow-hidden whitespace-nowrap hover:!max-w-170px hover:!px-14px hover:justify-start hover:gap-8px transition-[max-width,padding,border-radius,box-shadow] duration-420 ease-in-out'
            style={quickActionStyle(hoveredQuickAction === 'installer')}
            onMouseEnter={() => setHoveredQuickAction('installer')}
            onMouseLeave={() => setHoveredQuickAction(null)}
            onClick={() => setInstallerCenterVisible(true)}
            aria-label={t('guid.installerCenter.entry')}
            title={t('guid.installerCenter.entry')}
          >
            <DownloadComputer
              theme='outline'
              size='20'
              fill='currentColor'
              className='flex-shrink-0 text-[var(--color-text-3)] group-hover:text-[var(--color-primary)] transition-colors duration-300'
            />
            <span className='opacity-0 max-w-0 overflow-hidden text-14px text-[var(--color-text-2)] group-hover:opacity-100 group-hover:max-w-128px transition-all duration-360 ease-in-out'>
              {t('guid.installerCenter.entry')}
            </span>
          </Button>
          <div
            className='group inline-flex items-center justify-center h-36px min-w-36px max-w-36px px-0 rd-999px bg-fill-0 cursor-pointer overflow-hidden whitespace-nowrap hover:max-w-150px hover:px-14px hover:justify-start hover:gap-8px transition-[max-width,padding,border-radius,box-shadow] duration-420 ease-in-out'
            style={quickActionStyle(hoveredQuickAction === 'website')}
            onMouseEnter={() => setHoveredQuickAction('website')}
            onMouseLeave={() => setHoveredQuickAction(null)}
            onClick={() => onOpenLink('https://github.com/xuweihafeichangniu-lab/wink-go')}
            aria-label={`WINK GO ${t('common.website')}`}
            title={`WINK GO ${t('common.website')}`}
          >
            <svg
              className='flex-shrink-0 text-[var(--color-text-3)] group-hover:text-[var(--color-text-1)] transition-colors duration-300'
              width='20'
              height='20'
              viewBox='0 0 20 20'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
            >
              <path
                d='M11.6667 3.33333H16.6667V8.33333M16.25 3.75L9.16667 10.8333M8.33333 4.16667H5C4.55797 4.16667 4.13405 4.34226 3.82149 4.65482C3.50893 4.96738 3.33333 5.39131 3.33333 5.83333V15C3.33333 15.442 3.50893 15.866 3.82149 16.1785C4.13405 16.4911 4.55797 16.6667 5 16.6667H14.1667C14.6087 16.6667 15.0326 16.4911 15.3452 16.1785C15.6577 15.866 15.8333 15.442 15.8333 15V11.6667'
                stroke='currentColor'
                strokeWidth='1.66667'
                strokeLinecap='round'
                strokeLinejoin='round'
              />
            </svg>
            <span className='opacity-0 max-w-0 overflow-hidden text-14px text-[var(--color-text-2)] group-hover:opacity-100 group-hover:max-w-120px transition-all duration-360 ease-in-out'>
              WINK GO · {t('common.website')}
            </span>
          </div>
          <div
            className='group inline-flex items-center justify-center h-36px min-w-36px max-w-36px px-0 rd-999px bg-fill-0 cursor-pointer overflow-hidden whitespace-nowrap hover:max-w-200px hover:px-14px hover:justify-start hover:gap-8px transition-[max-width,padding,border-radius,box-shadow] duration-420 ease-in-out'
            style={quickActionStyle(hoveredQuickAction === 'webui')}
            onMouseEnter={() => setHoveredQuickAction('webui')}
            onMouseLeave={() => setHoveredQuickAction(null)}
            onClick={handleOpenWebUI}
          >
            <div className='relative w-20px h-20px flex-shrink-0 leading-none'>
              <div className='absolute inset-0 flex items-center justify-center'>
                <Earth
                  theme='outline'
                  size={20}
                  fill='currentColor'
                  className='block transition-colors duration-360'
                  style={{ color: webuiIconColor }}
                />
              </div>
            </div>
            <span className='opacity-0 max-w-0 overflow-hidden text-14px text-[var(--color-text-2)] group-hover:opacity-100 group-hover:max-w-160px transition-all duration-360 ease-in-out'>
              {t('settings.webui', { defaultValue: 'WebUI' })} · {webuiStatusLabel}
            </span>
          </div>
        </div>
      </div>
      <InstallerCenter visible={installerCenterVisible} onCancel={() => setInstallerCenterVisible(false)} />
    </>
  );
};

export default QuickActionButtons;
