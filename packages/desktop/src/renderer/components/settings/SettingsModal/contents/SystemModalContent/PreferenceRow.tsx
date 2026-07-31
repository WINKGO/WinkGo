// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

/**
 * Preference row component
 * Displays a label and control in a unified horizontal layout
 */
const PreferenceRow: React.FC<{
  label: string;
  children: React.ReactNode;
  description?: React.ReactNode;
  extra?: React.ReactNode;
}> = ({ label, children, description, extra }) => (
  <div className='flex items-center justify-between gap-24px py-12px'>
    <div className='flex-1'>
      <div className='flex flex-wrap items-center gap-8px'>
        <span className='text-14px text-2'>{label}</span>
        {extra}
      </div>
      {description && <div className='text-12px text-t-tertiary mt-4px'>{description}</div>}
    </div>
    <div className='flex-shrink-0'>{children}</div>
  </div>
);

export default PreferenceRow;
