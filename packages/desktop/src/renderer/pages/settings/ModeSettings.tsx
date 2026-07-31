// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import ModelModalContent from '@/renderer/components/settings/SettingsModal/contents/ModelModalContent';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const ModeSettings: React.FC = () => {
  return (
    <SettingsPageWrapper contentClassName='max-w-1100px'>
      <ModelModalContent />
    </SettingsPageWrapper>
  );
};

export default ModeSettings;
