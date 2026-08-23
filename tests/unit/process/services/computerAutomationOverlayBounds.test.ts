/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveAutomationOverlayLayout } from '@process/services/computer-automation/automationOverlayBounds';

describe('desktop automation overlay layout', () => {
  it('uses Electron DIP bounds for mixed-DPI displays, including negative coordinates', () => {
    const layout = resolveAutomationOverlayLayout({
      displays: [
        {
          id: 10,
          bounds: { x: -1600, y: 0, width: 1600, height: 900 },
          workArea: { x: -1600, y: 0, width: 1600, height: 860 },
          scaleFactor: 1.25,
        },
        {
          id: 20,
          bounds: { x: 0, y: 0, width: 1920, height: 1080 },
          workArea: { x: 0, y: 0, width: 1920, height: 1040 },
          scaleFactor: 1,
        },
      ],
      targetDisplayIds: [10, 20],
      controlDisplayId: 10,
      controlSize: { width: 280, height: 42 },
      topMargin: 12,
    });

    expect(layout.borders).toEqual([
      { displayId: 10, bounds: { x: -1600, y: 0, width: 1600, height: 900 } },
      { displayId: 20, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
    ]);
    expect(layout.control).toEqual({
      displayId: 10,
      bounds: { x: -940, y: 12, width: 280, height: 42 },
    });
  });

  it('keeps the compact control surface inside the selected work area', () => {
    const layout = resolveAutomationOverlayLayout({
      displays: [
        {
          id: 7,
          bounds: { x: 100, y: 50, width: 260, height: 100 },
          workArea: { x: 100, y: 50, width: 260, height: 60 },
          scaleFactor: 1.5,
        },
      ],
      targetDisplayIds: [7],
      controlDisplayId: 7,
      controlSize: { width: 280, height: 42 },
      topMargin: 30,
    });

    expect(layout.control).toEqual({
      displayId: 7,
      bounds: { x: 100, y: 68, width: 260, height: 42 },
    });
  });
});
