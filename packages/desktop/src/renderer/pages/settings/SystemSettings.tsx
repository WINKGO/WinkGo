// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useLocation } from 'react-router';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const SystemModalContent = React.lazy(
  () => import('@/renderer/components/settings/SettingsModal/contents/SystemModalContent')
);
const AboutModalContent = React.lazy(
  () => import('@/renderer/components/settings/SettingsModal/contents/AboutModalContent')
);

const SystemSettings: React.FC = () => {
  const location = useLocation();
  const isAboutPage = location.pathname === '/settings/about';

  return (
    <SettingsPageWrapper
      className={isAboutPage ? '!overflow-hidden !px-0 !py-0' : undefined}
      contentClassName={isAboutPage ? '!max-w-none !min-h-full !py-0' : undefined}
    >
      <React.Suspense fallback={null}>{isAboutPage ? <AboutModalContent /> : <SystemModalContent />}</React.Suspense>
    </SettingsPageWrapper>
  );
};

export default SystemSettings;
