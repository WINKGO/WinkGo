/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import {
  cancelWinkGoBrowserRecording,
  getWinkGoBrowserSkill,
  getWinkGoBrowserRecorderStatus,
  listWinkGoBrowserSkills,
  removeWinkGoBrowserSkill,
  runWinkGoBrowserSkill,
  startWinkGoBrowserRecording,
  stopAndSaveWinkGoBrowserRecording,
  updateWinkGoBrowserSkillSteps,
} from '@process/services/winkGoBrowserSkillsService';

/** Registers the local browser workflow recorder and deterministic replay bridge. */
export function initWinkGoBrowserSkillsBridge(): void {
  ipcBridge.winkGoBrowserSkills.getStatus.provider(() => getWinkGoBrowserRecorderStatus());
  ipcBridge.winkGoBrowserSkills.list.provider(() => listWinkGoBrowserSkills());
  ipcBridge.winkGoBrowserSkills.get.provider(({ skillId }) => getWinkGoBrowserSkill(skillId));
  ipcBridge.winkGoBrowserSkills.start.provider(() => startWinkGoBrowserRecording());
  ipcBridge.winkGoBrowserSkills.stopAndSave.provider((request) => stopAndSaveWinkGoBrowserRecording(request));
  ipcBridge.winkGoBrowserSkills.cancel.provider(() => cancelWinkGoBrowserRecording());
  ipcBridge.winkGoBrowserSkills.run.provider((request) => runWinkGoBrowserSkill(request));
  ipcBridge.winkGoBrowserSkills.updateSteps.provider((request) => updateWinkGoBrowserSkillSteps(request));
  ipcBridge.winkGoBrowserSkills.remove.provider(({ skillId }) => removeWinkGoBrowserSkill(skillId));
}
