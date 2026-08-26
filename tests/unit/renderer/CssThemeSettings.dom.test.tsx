/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectTheme = vi.fn().mockResolvedValue(undefined);
const themeState = vi.hoisted(() => ({ activeId: 'system' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ activeId: themeState.activeId, selectTheme, theme: 'light' }),
}));

import CssThemeSettings from '@renderer/pages/settings/AppearanceSettings/CssThemeSettings';

describe('CssThemeSettings', () => {
  beforeEach(() => {
    themeState.activeId = 'system';
    selectTheme.mockClear();
  });

  it('shows Follow System as the only theme without add or edit actions', () => {
    render(<CssThemeSettings />);

    expect(screen.getByTestId('system-theme-only')).toHaveTextContent('settings.cssTheme.followSystem');
    expect(screen.getByRole('status', { name: 'settings.cssTheme.followSystem' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(selectTheme).not.toHaveBeenCalled();
  });

  it('normalizes a legacy active theme back to Follow System', async () => {
    themeState.activeId = 'legacy-theme';
    render(<CssThemeSettings />);

    await waitFor(() => expect(selectTheme).toHaveBeenCalledWith('system'));
  });
});
