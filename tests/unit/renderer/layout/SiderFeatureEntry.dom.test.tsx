/**
 * @license
 * Copyright 2025 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SiderFeatureEntry from '@renderer/components/layout/Sider/SiderNav/SiderFeatureEntry';

const tooltipProps = {
  disabled: true,
  unmountOnExit: true,
  popupHoverStay: false,
};

describe('SiderFeatureEntry', () => {
  it('exposes an accessible button and invokes navigation', () => {
    const onClick = vi.fn();
    render(
      <SiderFeatureEntry
        label='格式台'
        icon={<span data-testid='format-icon'>F</span>}
        isMobile={false}
        isActive={false}
        collapsed={false}
        siderTooltipProps={tooltipProps}
        testId='sider-format-studio'
        onClick={onClick}
      />
    );

    const button = screen.getByRole('button', { name: '格式台' });
    expect(screen.getByTestId('format-icon')).toBeTruthy();
    expect(button).not.toHaveAttribute('aria-current');

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps its label accessible and marks the active route when collapsed', () => {
    render(
      <SiderFeatureEntry
        label='技能中心'
        icon={<span>S</span>}
        isMobile={false}
        isActive
        collapsed
        siderTooltipProps={tooltipProps}
        testId='sider-skill-center'
        onClick={() => {}}
      />
    );

    const button = screen.getByRole('button', { name: '技能中心' });
    expect(button).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByText('技能中心')).toBeNull();
  });
});
