/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { shouldReleaseIslandSurfaceBeforeResize } from '@process/winkgo/desktopIslandResizePolicy';

describe('desktop island resize policy', () => {
  it('keeps the island window visible while a native file drag is active', () => {
    expect(shouldReleaseIslandSurfaceBeforeResize('win32', true)).toBe(false);
  });

  it('still releases the Windows transparent surface for normal panel resizes', () => {
    expect(shouldReleaseIslandSurfaceBeforeResize('win32', false)).toBe(true);
    expect(shouldReleaseIslandSurfaceBeforeResize('darwin', false)).toBe(false);
  });
});
