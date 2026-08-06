import { describe, expect, it } from 'vitest';
import type { WinkGoMediaSnapshot } from '@/common/adapter/ipcBridge';
import {
  hasMaterialMediaChange,
  shouldRenderMediaSnapshot,
} from '@/renderer/components/layout/Titlebar/useIslandWindowsRuntime';

const media = (overrides: Partial<WinkGoMediaSnapshot> = {}): WinkGoMediaSnapshot => ({
  appId: 'CloudMusic.exe',
  title: 'Cyberpunk',
  artist: 'Alex',
  albumTitle: 'Night Drive',
  isPlaying: true,
  canPlayPause: true,
  canGoNext: true,
  canGoPrevious: true,
  coverUrl: 'data:image/png;base64,cover-a',
  positionMs: 12_000,
  durationMs: 180_000,
  playbackRate: 1,
  timelineUpdatedAt: 1_000,
  updatedAt: 1_000,
  ...overrides,
});

describe('WINK GO island media render pacing', () => {
  it('does not repaint the full island for every timeline-only sample', () => {
    const rendered = media();
    const timelineOnly = media({ positionMs: 12_300, timelineUpdatedAt: 1_300, updatedAt: 1_300 });

    expect(hasMaterialMediaChange(rendered, timelineOnly)).toBe(false);
    expect(shouldRenderMediaSnapshot(rendered, timelineOnly, 1_000, 1_300)).toBe(false);
    expect(shouldRenderMediaSnapshot(rendered, timelineOnly, 1_000, 2_200)).toBe(true);
  });

  it('renders a track, cover, or playback-state change immediately', () => {
    const rendered = media();

    expect(hasMaterialMediaChange(rendered, media({ title: 'Next Track' }))).toBe(true);
    expect(hasMaterialMediaChange(rendered, media({ coverUrl: 'data:image/png;base64,cover-b' }))).toBe(true);
    expect(hasMaterialMediaChange(rendered, media({ isPlaying: false }))).toBe(true);
    expect(shouldRenderMediaSnapshot(rendered, media({ title: 'Next Track' }), 1_000, 1_010)).toBe(true);
  });
});
