// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { shouldShowFromTray } from '@/process/utils/tray';

describe('tray visibility decision', () => {
  it('shows a hidden window', () => {
    expect(shouldShowFromTray(false, false)).toBe(true);
  });

  it('shows a minimized window', () => {
    expect(shouldShowFromTray(true, true)).toBe(true);
  });

  it('hides a visible non-minimized window', () => {
    expect(shouldShowFromTray(true, false)).toBe(false);
  });
});
