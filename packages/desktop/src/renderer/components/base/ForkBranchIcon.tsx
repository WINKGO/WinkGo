/**
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';

const ForkBranchIcon: React.FC<{ size?: number | string; fill?: string; className?: string }> = ({
  size = 16,
  fill = 'currentColor',
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke={fill}
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
    aria-hidden='true'
  >
    <path d='M3 12h6' />
    <path d='M9 12l9-7' />
    <path d='M13.5 4.5H18.5V9.5' />
    <path d='M9 12l5 5' />
    <path d='M14.5 13.5v4h-4' />
  </svg>
);

export default ForkBranchIcon;
