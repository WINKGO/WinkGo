// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';

export interface LayoutContextValue {
  isMobile: boolean;
  siderCollapsed: boolean;
  setSiderCollapsed: (value: boolean) => void;
}

export const LayoutContext = React.createContext<LayoutContextValue | null>(null);

export function useLayoutContext(): LayoutContextValue | null {
  return React.useContext(LayoutContext);
}
