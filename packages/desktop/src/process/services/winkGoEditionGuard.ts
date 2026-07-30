/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoCapability } from '@/common/types/platform/winkGoEdition';
import { winkGoCloudAuthService } from './WinkGoCloudAuthService';

export const requireWinkGoCapability = (capability: WinkGoCapability): void => {
  if (winkGoCloudAuthService.hasCapability(capability)) return;

  const error = new Error('此功能需要 WINK GO Pro。升级后重新登录即可使用。');
  error.name = 'WinkGoProRequiredError';
  throw error;
};
