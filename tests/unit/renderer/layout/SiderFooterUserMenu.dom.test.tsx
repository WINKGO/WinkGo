/**
 * @license
 * Copyright 2025 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dialog, fs } from '@/common/adapter/ipcBridge';
import SiderFooter from '@renderer/components/layout/Sider/SiderFooter';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  dialog: { showOpen: { invoke: vi.fn() } },
  fs: { getImageBase64: { invoke: vi.fn() } },
}));

const baseProps = {
  isMobile: false,
  isSettings: false,
  collapsed: false,
  theme: 'light',
  siderTooltipProps: { disabled: true },
  onSettingsClick: vi.fn(),
  onThemeToggle: vi.fn(),
};

describe('SiderFooter user menu', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('opens the personal menu and edits the display name without navigating away', () => {
    render(<SiderFooter {...baseProps} user={{ username: 'wink-user', provider: 'winkgo' }} onLogoutClick={vi.fn()} />);

    expect(within(screen.getByTestId('sider-user-button')).queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('sider-user-avatar')).toHaveAttribute(
      'src',
      expect.stringContaining('winkgo-user-avatar-v1.png')
    );
    fireEvent.click(screen.getByTestId('sider-user-button'));

    const menu = screen.getByTestId('sider-user-menu');
    expect(screen.getByText('wink-user')).toBeInTheDocument();
    expect(screen.getByText('WINK GO · winkgo')).toBeInTheDocument();
    expect(screen.getAllByText('common.settings')).toHaveLength(2);
    expect(screen.getByText('settings.googleLogout')).toBeInTheDocument();

    fireEvent.click(within(menu).getByText('common.settings'));
    const nameInput = screen.getByLabelText('common.name');
    fireEvent.change(nameInput, { target: { value: 'Wink 好友' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    expect(screen.getByText('Wink 好友')).toBeInTheDocument();
    expect(window.localStorage.getItem('winkgo:user-profile:wink-user')).toContain('Wink 好友');
  });

  it('keeps the current profile when the edited name is blank', () => {
    render(<SiderFooter {...baseProps} user={{ username: 'wink-user' }} onLogoutClick={vi.fn()} />);

    fireEvent.click(screen.getByTestId('sider-user-button'));
    fireEvent.click(within(screen.getByTestId('sider-user-menu')).getByText('common.settings'));
    fireEvent.change(screen.getByLabelText('common.name'), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
  });

  it('uses a selected image as the avatar and persists it locally', async () => {
    vi.mocked(dialog.showOpen.invoke).mockResolvedValue(['C:\\avatar.png']);
    vi.mocked(fs.getImageBase64.invoke).mockResolvedValue('data:image/png;base64,avatar');

    render(<SiderFooter {...baseProps} user={{ username: 'wink-user' }} onLogoutClick={vi.fn()} />);

    fireEvent.click(screen.getByTestId('sider-user-button'));
    fireEvent.click(within(screen.getByTestId('sider-user-menu')).getByText('common.settings'));
    fireEvent.click(screen.getByRole('button', { name: 'settings.assistantAvatarUploadImage' }));

    await waitFor(() => {
      expect(screen.getByTestId('sider-user-profile-avatar')).toHaveAttribute('src', 'data:image/png;base64,avatar');
    });
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));

    expect(screen.getByTestId('sider-user-avatar')).toHaveAttribute('src', 'data:image/png;base64,avatar');
  });

  it('closes the menu and invokes logout', () => {
    const onLogoutClick = vi.fn();
    render(<SiderFooter {...baseProps} user={{ username: 'wink-user' }} onLogoutClick={onLogoutClick} />);

    fireEvent.click(screen.getByTestId('sider-user-button'));
    fireEvent.click(screen.getByText('settings.googleLogout'));

    expect(onLogoutClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('sider-user-menu')).not.toBeInTheDocument();
  });
});
