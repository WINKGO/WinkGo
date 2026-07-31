// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';

type SideQuestionConversationType = TChatConversation['type'];

export type SideQuestionEligibilityTarget = {
  backend?: string;
  type: SideQuestionConversationType;
};

export function isSideQuestionSupported(target: SideQuestionEligibilityTarget): boolean {
  return target.type === 'acp' && target.backend === 'claude';
}
