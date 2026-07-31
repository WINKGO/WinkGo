// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import LocalAgents from '@/renderer/pages/settings/AgentSettings/LocalAgents';
import WinkGoScrollArea from '@/renderer/components/base/WinkGoScrollArea';
import { useSettingsViewMode } from '../settingsViewContext';

const AgentModalContent: React.FC = () => {
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  return (
    <div className='flex flex-col h-full w-full'>
      <WinkGoScrollArea className='flex-1 min-h-0 pb-16px scrollbar-hide' disableOverflow={isPageMode}>
        <LocalAgents />
      </WinkGoScrollArea>
    </div>
  );
};

export default AgentModalContent;
