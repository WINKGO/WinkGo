import { emitter } from '@/renderer/utils/emitter';

export type WinkGoComputerUsePanel = 'browserComputerUse' | 'desktopComputerUse';

export async function openDynamicIslandPanel(panel: WinkGoComputerUsePanel): Promise<boolean> {
  const openAcrossWindows = window.electronAPI?.desktopIsland?.openPanel;
  if (openAcrossWindows) {
    try {
      if (await openAcrossWindows(panel)) return true;
    } catch (error) {
      console.warn('[WINK GO island] Cross-window panel open failed:', error);
    }
  }

  // WebUI and single-window test environments keep using the local emitter.
  emitter.emit('dynamic-island.open-panel', panel);
  return false;
}
