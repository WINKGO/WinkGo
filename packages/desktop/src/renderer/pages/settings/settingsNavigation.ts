/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Builtin settings tab IDs in display order (must match router paths). */
export const BUILTIN_TAB_IDS = [
  'agent',
  'model',
  'skills',
  'tools',
  'appearance',
  'webui',
  'pet',
  'island-files',
  'system',
  'about',
] as const;

/**
 * Legacy anchor IDs that have been merged into other tabs.
 * Older extensions can continue using their existing placement metadata.
 */
export const LEGACY_ANCHOR_REMAP: Record<string, string> = {
  'skills-hub': 'skills',
  capabilities: 'skills',
  display: 'appearance',
};
