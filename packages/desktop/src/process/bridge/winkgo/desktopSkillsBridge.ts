/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { ipcBridge } from '@/common';
import {
  cancelWinkGoDesktopAutomation,
  disposeWinkGoDesktopAutomation,
  getWinkGoDesktopAutomationStatus,
  listWinkGoDesktopSkills,
  listWinkGoDesktopTargets,
  onWinkGoDesktopAutomationStatus,
  pauseWinkGoDesktopRecording,
  refreshWinkGoDesktopRecordingStatus,
  removeWinkGoDesktopSkill,
  resumeWinkGoDesktopRecording,
  runWinkGoDesktopSkill,
  startWinkGoDesktopRecording,
  stopAndSaveWinkGoDesktopRecording,
} from '@process/services/winkGoDesktopSkillsService';

let initialized = false;

export function initWinkGoDesktopSkillsBridge(): void {
  if (initialized) return;
  initialized = true;
  ipcBridge.winkGoDesktopSkills.getStatus.provider(() => getWinkGoDesktopAutomationStatus());
  ipcBridge.winkGoDesktopSkills.listTargets.provider(() => listWinkGoDesktopTargets());
  ipcBridge.winkGoDesktopSkills.list.provider(() => listWinkGoDesktopSkills());
  ipcBridge.winkGoDesktopSkills.start.provider(() => startWinkGoDesktopRecording());
  ipcBridge.winkGoDesktopSkills.refreshStatus.provider(() => refreshWinkGoDesktopRecordingStatus());
  ipcBridge.winkGoDesktopSkills.pause.provider(() => pauseWinkGoDesktopRecording());
  ipcBridge.winkGoDesktopSkills.resume.provider(() => resumeWinkGoDesktopRecording());
  ipcBridge.winkGoDesktopSkills.stopAndSave.provider((request) => stopAndSaveWinkGoDesktopRecording(request));
  ipcBridge.winkGoDesktopSkills.cancel.provider(() => cancelWinkGoDesktopAutomation());
  ipcBridge.winkGoDesktopSkills.run.provider((request) => runWinkGoDesktopSkill(request));
  ipcBridge.winkGoDesktopSkills.remove.provider(({ skillId }) => removeWinkGoDesktopSkill(skillId));
  const unsubscribe = onWinkGoDesktopAutomationStatus((status) => {
    ipcBridge.winkGoDesktopSkills.statusChanged.emit(status);
  });
  app.once('will-quit', () => {
    unsubscribe();
    disposeWinkGoDesktopAutomation();
  });
}
