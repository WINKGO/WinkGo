/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Button, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import type { SiderTooltipProps } from '@renderer/utils/ui/siderTooltip';

interface SiderFeatureEntryProps {
  label: string;
  icon: React.ReactNode;
  isMobile: boolean;
  isActive: boolean;
  collapsed: boolean;
  siderTooltipProps: SiderTooltipProps;
  testId: string;
  badge?: string;
  onClick: () => void;
}

const SiderFeatureEntry: React.FC<SiderFeatureEntryProps> = ({
  label,
  icon,
  isMobile,
  isActive,
  collapsed,
  siderTooltipProps,
  testId,
  badge,
  onClick,
}) => {
  return (
    <Tooltip {...siderTooltipProps} content={label} position='right'>
      <Button
        type='text'
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        data-testid={testId}
        onClick={onClick}
        className={classNames(
          '!box-border !h-34px !min-h-34px !w-full !p-0 !border-none !text-t-primary !rd-8px !transition-colors',
          collapsed ? '!flex !items-center !justify-center' : '!flex !items-center !justify-start !px-10px',
          isMobile && 'sider-action-btn-mobile',
          isActive ? '!bg-fill-3' : 'hover:!bg-fill-3 active:!bg-fill-4'
        )}
      >
        <span
          className={classNames(
            'size-22px flex items-center justify-center shrink-0 text-t-primary leading-none',
            !collapsed && 'mr-8px'
          )}
        >
          {icon}
        </span>
        {!collapsed && (
          <>
            <span className='collapsed-hidden text-t-primary text-14px font-[500] leading-24px'>{label}</span>
            {badge && (
              <span className='ml-auto rd-full bg-primary-1 px-6px py-1px text-9px font-700 text-primary-6'>
                {badge}
              </span>
            )}
          </>
        )}
      </Button>
    </Tooltip>
  );
};

export default SiderFeatureEntry;
