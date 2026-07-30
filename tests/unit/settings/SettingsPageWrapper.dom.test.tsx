/**
 * @license
 * Copyright 2025 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { layoutState, useExtensionSettingsTabsMock, useExtI18nMock, navigateMock } = vi.hoisted(() => ({
  layoutState: { isMobile: false },
  useExtensionSettingsTabsMock: vi.fn(() => []),
  useExtI18nMock: vi.fn(() => ({ resolveExtTabName: (tab: { label: string }) => tab.label })),
  navigateMock: vi.fn(),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => layoutState,
}));

vi.mock('@/renderer/hooks/system/useExtensionSettingsTabs', () => ({
  useExtensionSettingsTabs: useExtensionSettingsTabsMock,
}));

vi.mock('@/renderer/hooks/system/useExtI18n', () => ({
  useExtI18n: useExtI18nMock,
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  resolveExtensionAssetUrl: (value?: string) => value,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: '/settings/agent' }),
}));

vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  SettingsTabNavigateProvider: ({ children }: { children: React.ReactNode }) => children,
  SettingsViewModeProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import SettingsPageWrapper from '@/renderer/pages/settings/components/SettingsPageWrapper';

describe('SettingsPageWrapper settings panel performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layoutState.isMobile = false;
  });

  it('does not load hidden mobile extension navigation on desktop settings pages', () => {
    render(
      <SettingsPageWrapper>
        <div>Desktop content</div>
      </SettingsPageWrapper>
    );

    expect(screen.getByText('Desktop content')).toBeInTheDocument();
    expect(useExtensionSettingsTabsMock).not.toHaveBeenCalled();
    expect(useExtI18nMock).not.toHaveBeenCalled();
  });

  it('still loads and renders the settings navigation on mobile', () => {
    layoutState.isMobile = true;

    render(
      <SettingsPageWrapper>
        <div>Mobile content</div>
      </SettingsPageWrapper>
    );

    expect(screen.getByText('Mobile content')).toBeInTheDocument();
    expect(screen.getByText('Agents')).toBeInTheDocument();
    expect(useExtensionSettingsTabsMock).toHaveBeenCalledTimes(1);
    expect(useExtI18nMock).toHaveBeenCalledTimes(1);
  });
});
