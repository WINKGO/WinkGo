// Modified from AionUI by WINK GO contributors in 2026.
/**
 * System theme E2E tests.
 *
 * WINK GO intentionally exposes only the operating-system appearance. The
 * historical manual light/dark theme picker must not return.
 */

import { test, expect } from '../../../fixtures';
import { goToSettings } from '../../../helpers/navigation';

test.describe('System Theme', () => {
  test.beforeEach(async ({ page }) => {
    await goToSettings(page, 'appearance');
  });

  test('shows exactly one follow-system theme choice', async ({ page }) => {
    const systemTheme = page.getByTestId('system-theme-only');
    await expect(systemTheme).toBeVisible({ timeout: 10_000 });
    await expect(systemTheme.getByRole('status')).toHaveCount(1);
  });

  test('does not expose manual light, dark, or custom theme controls', async ({ page }) => {
    const systemTheme = page.getByTestId('system-theme-only');
    await expect(systemTheme).toBeVisible({ timeout: 10_000 });
    await expect(systemTheme.getByRole('radiogroup')).toHaveCount(0);
    await expect(systemTheme.getByRole('radio')).toHaveCount(0);
    await expect(systemTheme.getByRole('button')).toHaveCount(0);
  });
});
