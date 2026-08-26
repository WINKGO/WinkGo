// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { shouldShowBackendStartupFailureDialog } from '@/renderer/components/layout/AppLoader';

describe('backend startup gate', () => {
  it('blocks the normal app when local data needs a newer WINK GO version', () => {
    expect(shouldShowBackendStartupFailureDialog('backend_database_newer_than_app' as any)).toBe(true);
  });
});
