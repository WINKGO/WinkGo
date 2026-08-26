/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AutomationRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AutomationDisplayLike {
  id: number;
  bounds: AutomationRectangle;
  workArea: AutomationRectangle;
  scaleFactor: number;
}

export interface AutomationOverlayLayout {
  borders: Array<{ displayId: number; bounds: AutomationRectangle }>;
  control: { displayId: number; bounds: AutomationRectangle } | null;
}

export interface ResolveAutomationOverlayLayoutInput {
  displays: AutomationDisplayLike[];
  targetDisplayIds: number[];
  controlDisplayId: number;
  controlSize: Pick<AutomationRectangle, 'width' | 'height'>;
  topMargin: number;
}

/** Resolves native window positions in Electron display-independent pixels. */
export const resolveAutomationOverlayLayout = ({
  displays,
  targetDisplayIds,
  controlDisplayId,
  controlSize,
  topMargin,
}: ResolveAutomationOverlayLayoutInput): AutomationOverlayLayout => {
  const targets = new Set(targetDisplayIds);
  const borders = displays
    .filter((display) => targets.has(display.id))
    .map((display) => ({ displayId: display.id, bounds: { ...display.bounds } }));
  const controlDisplay = displays.find((display) => display.id === controlDisplayId);
  const controlWidth = controlDisplay ? Math.min(controlSize.width, controlDisplay.workArea.width) : controlSize.width;
  const controlHeight = controlDisplay
    ? Math.min(controlSize.height, controlDisplay.workArea.height)
    : controlSize.height;
  const desiredControlY = controlDisplay ? controlDisplay.workArea.y + topMargin : 0;
  const maximumControlY = controlDisplay
    ? controlDisplay.workArea.y + controlDisplay.workArea.height - controlHeight
    : 0;

  return {
    borders,
    control: controlDisplay
      ? {
          displayId: controlDisplay.id,
          bounds: {
            x: Math.round(controlDisplay.workArea.x + (controlDisplay.workArea.width - controlWidth) / 2),
            y: Math.min(maximumControlY, Math.max(controlDisplay.workArea.y, desiredControlY)),
            width: controlWidth,
            height: controlHeight,
          },
        }
      : null,
  };
};
