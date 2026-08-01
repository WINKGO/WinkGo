/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export const shouldReleaseIslandSurfaceBeforeResize = (
  platform: NodeJS.Platform,
  nativeFileDragActive: boolean
): boolean => platform === 'win32' && !nativeFileDragActive;
