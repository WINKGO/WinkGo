/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const selectTheme = vi.fn().mockResolvedValue(undefined);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ activeId: 'dark', selectTheme }),
}));

import CssThemeSettings from '@renderer/pages/settings/AppearanceSettings/CssThemeSettings';

describe('CssThemeSettings', () => {
  it('offers only Follow System and repairs a legacy manual selection', async () => {
    render(<CssThemeSettings />);

    expect(screen.getByTestId('system-theme-only')).toHaveTextContent('settings.cssTheme.followSystem');
    expect(screen.queryByText('settings.cssTheme.addManually')).not.toBeInTheDocument();
    await waitFor(() => expect(selectTheme).toHaveBeenCalledWith('system'));
  });
});
