/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import winkGoAboutBackground from '@/renderer/assets/brand/wink-go-about-bg.png';
import winkGoLogo from '@/renderer/assets/logos/brand/app.png';
import { openExternalUrl } from '@/renderer/utils/platform';

const WINK_GO_WEBSITE = 'https://winkgo.top/';
const APACHE_LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

const AboutModalContent: React.FC = () => {
  const { t } = useTranslation();

  const openExternalLink = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    void openExternalUrl(url).catch((error) => {
      console.error(`Failed to open external link: ${url}`, error);
    });
  };

  return (
    <div
      className='relative flex min-h-full w-full box-border items-center justify-center overflow-hidden bg-2 px-32px'
      style={{ minHeight: 'calc(100vh - 42px)' }}
    >
      <div
        aria-hidden='true'
        className='absolute inset-0 bg-cover bg-center opacity-22'
        style={{ backgroundImage: `url(${winkGoAboutBackground})` }}
      />
      <div
        aria-hidden='true'
        className='absolute inset-0'
        style={{
          background:
            'radial-gradient(circle at 50% 48%, rgba(255, 255, 255, 0.86) 0%, rgba(255, 255, 255, 0.68) 24%, rgba(255, 255, 255, 0.18) 60%, transparent 100%)',
        }}
      />

      <div className='relative flex w-full flex-col items-center'>
        <a
          href={WINK_GO_WEBSITE}
          aria-label={WINK_GO_WEBSITE}
          onClick={(event) => openExternalLink(event, WINK_GO_WEBSITE)}
          className='group relative flex h-400px w-full max-w-460px flex-col items-center justify-center no-underline outline-none focus-visible:ring-2 focus-visible:ring-[rgba(17,17,17,0.32)]'
        >
          <span
            aria-hidden='true'
            className='absolute h-260px w-260px rounded-full bg-[rgba(255,255,255,0.66)] blur-28px transition-transform duration-500 group-hover:scale-110'
          />
          <img
            src={winkGoLogo}
            alt='WINK GO'
            className='relative h-300px w-300px object-contain transition-transform duration-500 group-hover:-translate-y-4px group-hover:scale-102'
            style={{ filter: 'drop-shadow(0 18px 38px rgba(17, 17, 17, 0.16))' }}
          />
          <span className='relative -mt-4px flex items-center rounded-full border border-border-2 bg-[rgba(255,255,255,0.92)] px-20px py-9px text-13px font-600 text-t-primary shadow-[0_10px_24px_rgba(17,17,17,0.1)] transition-transform duration-300 group-hover:-translate-y-2px md:text-15px'>
            {WINK_GO_WEBSITE}
          </span>
        </a>
      </div>
      <div
        data-testid='about-attribution'
        className='absolute bottom-20px left-16px right-16px flex flex-col items-center gap-0 text-center text-6px leading-8px text-t-tertiary opacity-20'
      >
        <p className='m-0'>{t('guid.openSourceLicense')}</p>
        <p className='m-0'>
          {t('guid.openSourceCopyright')}{' '}
          <a
            href={APACHE_LICENSE_URL}
            className='text-t-tertiary underline decoration-transparent underline-offset-3px transition-colors hover:text-t-secondary hover:decoration-current'
            onClick={(event) => openExternalLink(event, APACHE_LICENSE_URL)}
          >
            Apache-2.0
          </a>
        </p>
      </div>
    </div>
  );
};

export default AboutModalContent;
