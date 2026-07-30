/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  getWinkGoSmartHomePreferences,
  getWinkGoWechatPreferences,
  listWinkGoSkillsCatalog,
  prepareWinkGoSkillImport,
  saveWinkGoSmartHomePreferences,
  saveWinkGoWechatPreferences,
  syncWinkGoSkillBridge,
} from '@process/services/winkGoSkillsCatalog';
import { requireWinkGoCapability } from '@process/services/winkGoEditionGuard';

const requirePremiumSkills = (): void => requireWinkGoCapability('skills.premium');

/** Registers the opt-in WINK GO skill catalog and its filtered Runtime bridge. */
export function initWinkGoSkillsBridge(): void {
  ipcBridge.winkGoSkills.listCatalog.provider(() => {
    requirePremiumSkills();
    return listWinkGoSkillsCatalog();
  });
  ipcBridge.winkGoSkills.prepareImport.provider(({ skillId }) => {
    requirePremiumSkills();
    return prepareWinkGoSkillImport(skillId);
  });
  ipcBridge.winkGoSkills.syncEnabled.provider(({ skillIds }) => {
    requirePremiumSkills();
    return syncWinkGoSkillBridge(skillIds);
  });
  ipcBridge.winkGoSkills.getWechatPreferences.provider(async () => {
    requirePremiumSkills();
    return getWinkGoWechatPreferences();
  });
  ipcBridge.winkGoSkills.saveWechatPreferences.provider(async (preferences) => {
    requirePremiumSkills();
    return saveWinkGoWechatPreferences(preferences);
  });
  ipcBridge.winkGoSkills.getSmartHomePreferences.provider(() => {
    requirePremiumSkills();
    return getWinkGoSmartHomePreferences();
  });
  ipcBridge.winkGoSkills.saveSmartHomePreferences.provider((request) => {
    requirePremiumSkills();
    return saveWinkGoSmartHomePreferences(request);
  });
}
