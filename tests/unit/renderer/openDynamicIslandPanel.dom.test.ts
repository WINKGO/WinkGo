import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDynamicIslandPanel } from '@/renderer/utils/winkgo/openDynamicIslandPanel';

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock('@/renderer/utils/emitter', () => ({ emitter: { emit } }));

describe('openDynamicIslandPanel', () => {
  beforeEach(() => {
    emit.mockReset();
    window.electronAPI = undefined;
  });

  it('uses the Electron IPC bridge so the separate island window receives the panel request', async () => {
    const openPanel = vi.fn().mockResolvedValue(true);
    window.electronAPI = { desktopIsland: { openPanel } } as typeof window.electronAPI;

    await expect(openDynamicIslandPanel('desktopComputerUse')).resolves.toBe(true);

    expect(openPanel).toHaveBeenCalledWith('desktopComputerUse');
    expect(emit).not.toHaveBeenCalled();
  });

  it('falls back to the local emitter in WebUI and single-window tests', async () => {
    await expect(openDynamicIslandPanel('browserComputerUse')).resolves.toBe(false);

    expect(emit).toHaveBeenCalledWith('dynamic-island.open-panel', 'browserComputerUse');
  });
});
