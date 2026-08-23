/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DesktopAutomationStatus } from '@/common/types/desktopAutomation';
import { applyAutomationOverlayStatus } from './automationOverlayView';

declare global {
  interface Window {
    winkGoAutomationOverlay?: {
      subscribe(callback: (status: DesktopAutomationStatus) => void): () => void;
    };
  }
}

const root = document.querySelector<HTMLElement>('#control-border');
if (!root) throw new Error('WINK GO Control Border root is missing');

const unsubscribe = window.winkGoAutomationOverlay?.subscribe((status) => {
  applyAutomationOverlayStatus(root, status);
});

window.addEventListener('beforeunload', () => unsubscribe?.(), { once: true });
