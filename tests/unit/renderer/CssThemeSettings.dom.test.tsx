/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const selectTheme = vi.fn().mockResolvedValue(undefined);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/common/config/configService', () => ({
  configService: {
    whenReady: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(() => []),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ activeId: 'system', selectTheme, theme: 'light' }),
}));

vi.mock('@renderer/pages/settings/AppearanceSettings/CssThemeModal', () => ({
  default: ({ visible }: { visible: boolean }) => (visible ? <div data-testid='css-theme-modal' /> : null),
}));

import CssThemeSettings from '@renderer/pages/settings/AppearanceSettings/CssThemeSettings';

describe('CssThemeSettings', () => {
  it('keeps Follow System as the only preset and exposes Add Theme', async () => {
    render(<CssThemeSettings />);

    expect(screen.getByTestId('system-theme-only')).toHaveTextContent('settings.cssTheme.followSystem');
    expect(screen.getByRole('button', { name: /settings.cssTheme.addManually/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('button')).toHaveLength(2));
  });

  it('opens the custom theme editor from the header action', () => {
    render(<CssThemeSettings />);

    fireEvent.click(screen.getByRole('button', { name: /settings.cssTheme.addManually/ }));
    expect(screen.getByTestId('css-theme-modal')).toBeInTheDocument();
  });
});
