/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoCapability } from '@/common/types/platform/winkGoEdition';
import { winkGoCloudAuthService } from './WinkGoCloudAuthService';

export const requireWinkGoCapability = (capability: WinkGoCapability): void => {
  if (winkGoCloudAuthService.hasCapability(capability)) return;

  const error = new Error('WINKGO_CAPABILITY_REQUIRED');
  error.name = 'WinkGoCapabilityRequiredError';
  throw error;
};
