/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import {
  readWinkGoIslandFilePreferences,
  subscribeWinkGoIslandFilePreferences,
  type WinkGoIslandFilePreferences,
} from '@renderer/utils/winkgo/islandFilePreferences';

export const useWinkGoIslandFilePreferences = (): WinkGoIslandFilePreferences => {
  const [preferences, setPreferences] = useState(readWinkGoIslandFilePreferences);

  useEffect(() => subscribeWinkGoIslandFilePreferences(setPreferences), []);

  return preferences;
};
