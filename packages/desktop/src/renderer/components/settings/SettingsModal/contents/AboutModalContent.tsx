/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Modal, Tabs } from '@arco-design/web-react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import winkGoAboutBackground from '@/renderer/assets/brand/wink-go-about-bg.png';
import winkGoLogo from '@/renderer/assets/logos/brand/app.png';
import { openExternalUrl } from '@/renderer/utils/platform';
import apacheLicenseText from '../../../../../../../../LICENSE?raw';
import noticeText from '../../../../../../../../NOTICE?raw';
import thirdPartyNoticesText from '../../../../../../../../THIRD_PARTY_NOTICES.md?raw';

const WINK_GO_WEBSITE = 'https://winkgo.top/';
const APACHE_LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

declare const __APP_VERSION__: string;

const AboutModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [legalVisible, setLegalVisible] = useState(false);

  const openExternalLink = (event: React.MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    void openExternalUrl(url).catch((error) => {
      console.error(`Failed to open external link: ${url}`, error);
    });
  };

  return (
    <div
      className='relative flex min-h-full w-full box-border items-center justify-center overflow-x-hidden overflow-y-auto bg-2 px-24px py-20px'
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

      <div className='relative flex w-full max-w-760px flex-col items-center'>
        <a
          href={WINK_GO_WEBSITE}
          aria-label={WINK_GO_WEBSITE}
          onClick={(event) => openExternalLink(event, WINK_GO_WEBSITE)}
          className='group relative flex h-300px w-full max-w-420px flex-col items-center justify-center no-underline outline-none focus-visible:ring-2 focus-visible:ring-[rgba(17,17,17,0.32)]'
        >
          <span
            aria-hidden='true'
            className='absolute h-220px w-220px rounded-full bg-[rgba(255,255,255,0.66)] blur-28px transition-transform duration-500 group-hover:scale-110'
          />
          <img
            src={winkGoLogo}
            alt='WINK GO'
            className='relative h-230px w-230px object-contain transition-transform duration-500 group-hover:-translate-y-4px group-hover:scale-102'
            style={{ filter: 'drop-shadow(0 18px 38px rgba(17, 17, 17, 0.16))' }}
          />
          <span className='relative -mt-4px flex items-center rounded-full border border-border-2 bg-[rgba(255,255,255,0.92)] px-20px py-9px text-13px font-600 text-t-primary shadow-[0_10px_24px_rgba(17,17,17,0.1)] transition-transform duration-300 group-hover:-translate-y-2px md:text-15px'>
            {WINK_GO_WEBSITE}
          </span>
        </a>

        <section
          data-testid='about-attribution'
          aria-label={t('settings.legal.title')}
          className='mb-8px flex w-full max-w-680px flex-col items-center gap-8px rounded-14px border border-border-2 bg-[rgba(255,255,255,0.82)] px-20px py-14px text-center text-12px leading-18px text-t-secondary shadow-[0_12px_30px_rgba(17,17,17,0.08)] backdrop-blur-12px'
        >
          <div className='font-600 text-t-primary'>
            {t('common.version')} {__APP_VERSION__}
          </div>
          <p className='m-0'>{t('settings.legal.summary')}</p>
          <p className='m-0'>{t('settings.legal.attribution')}</p>
          <div className='flex flex-wrap items-center justify-center gap-8px'>
            <Button size='mini' type='outline' onClick={() => setLegalVisible(true)}>
              {t('settings.legal.title')}
            </Button>
            <a
              href={APACHE_LICENSE_URL}
              className='text-t-secondary underline underline-offset-3px transition-colors hover:text-t-primary'
              onClick={(event) => openExternalLink(event, APACHE_LICENSE_URL)}
            >
              Apache-2.0
            </a>
          </div>
        </section>
      </div>

      <Modal
        title={t('settings.legal.title')}
        visible={legalVisible}
        onCancel={() => setLegalVisible(false)}
        footer={null}
        autoFocus={false}
        focusLock={false}
        unmountOnExit
        style={{ width: 'min(880px, calc(100vw - 32px))' }}
      >
        <Tabs defaultActiveTab='notice'>
          <Tabs.TabPane key='notice' title={t('settings.legal.notice')}>
            <pre
              data-testid='legal-document-notice'
              className='m-0 max-h-60vh overflow-auto whitespace-pre-wrap break-words rounded-8px bg-fill-1 p-16px text-12px leading-20px text-t-secondary'
            >
              {noticeText}
            </pre>
          </Tabs.TabPane>
          <Tabs.TabPane key='license' title={t('settings.legal.apacheLicense')}>
            <pre
              data-testid='legal-document-license'
              className='m-0 max-h-60vh overflow-auto whitespace-pre-wrap break-words rounded-8px bg-fill-1 p-16px text-12px leading-20px text-t-secondary'
            >
              {apacheLicenseText}
            </pre>
          </Tabs.TabPane>
          <Tabs.TabPane key='third-party' title={t('settings.legal.thirdPartyNotices')}>
            <pre
              data-testid='legal-document-third-party'
              className='m-0 max-h-60vh overflow-auto whitespace-pre-wrap break-words rounded-8px bg-fill-1 p-16px text-12px leading-20px text-t-secondary'
            >
              {thirdPartyNoticesText}
            </pre>
          </Tabs.TabPane>
        </Tabs>
      </Modal>
    </div>
  );
};

export default AboutModalContent;
