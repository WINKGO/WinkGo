/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import SystemSettings from '@/renderer/pages/settings/SystemSettings';

const mockUseLocation = vi.fn();

vi.mock('react-router-dom', () => ({
  useLocation: () => mockUseLocation(),
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent', () => ({
  default: () => <div data-testid='system-modal-content'>SystemModalContent</div>,
}));

vi.mock('@/renderer/components/settings/SettingsModal/contents/AboutModalContent', () => ({
  default: () => <div data-testid='about-modal-content'>AboutModalContent</div>,
}));

vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({
    children,
    className,
    contentClassName,
  }: {
    children: React.ReactNode;
    className?: string;
    contentClassName?: string;
  }) => (
    <div
      data-testid='settings-page-wrapper'
      {...(className ? { 'data-container-class': className } : {})}
      {...(contentClassName ? { 'data-content-class': contentClassName } : {})}
    >
      {children}
    </div>
  ),
}));

describe('SystemSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders SystemModalContent when pathname is not /settings/about', async () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    expect(await screen.findByTestId('system-modal-content')).toBeInTheDocument();
    expect(screen.queryByTestId('about-modal-content')).not.toBeInTheDocument();
  });

  it('renders AboutModalContent when pathname is /settings/about', async () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/about' });
    render(<SystemSettings />);
    expect(await screen.findByTestId('about-modal-content')).toBeInTheDocument();
    expect(screen.queryByTestId('system-modal-content')).not.toBeInTheDocument();
  });

  it('lets the about page background fill the full settings content area', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/about' });
    render(<SystemSettings />);
    const wrapper = screen.getByTestId('settings-page-wrapper');
    expect(wrapper).toHaveAttribute('data-container-class', '!overflow-hidden !px-0 !py-0');
    expect(wrapper).toHaveAttribute('data-content-class', '!max-w-none !min-h-full !py-0');
  });

  it('does not apply contentClassName for system page', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    const wrapper = screen.getByTestId('settings-page-wrapper');
    expect(wrapper).not.toHaveAttribute('data-content-class');
  });

  it('wraps content in SettingsPageWrapper', () => {
    mockUseLocation.mockReturnValue({ pathname: '/settings/system' });
    render(<SystemSettings />);
    expect(screen.getByTestId('settings-page-wrapper')).toBeInTheDocument();
  });
});
