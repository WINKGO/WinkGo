/**
 * @license
 * Copyright 2026 WINK GO
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readWinkGoIslandFilePreferences,
  subscribeWinkGoIslandFilePreferences,
  WINK_GO_ISLAND_PREFERENCES_KEY,
  writeWinkGoIslandFilePreferences,
} from '@/renderer/utils/winkgo/islandFilePreferences';

describe('WINK GO island and file preferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('migrates the original WINK GO preference keys', () => {
    window.localStorage.setItem('winkgo_island_opacity', '72');
    window.localStorage.setItem('winkgo_island_theme', 'black');
    window.localStorage.setItem('winkgo_music_ctrl', 'false');
    window.localStorage.setItem('winkgo_target_player', 'netease');
    window.localStorage.setItem('winkgo_autohide_fs', 'true');
    window.localStorage.setItem('winkgo_ui_sound_enabled', 'false');

    expect(readWinkGoIslandFilePreferences()).toMatchObject({
      autoHideFullscreen: true,
      interactionSoundEnabled: false,
      islandTheme: 'black',
      mediaControllerEnabled: false,
      mediaTarget: 'netease',
      opacity: 72,
    });
  });

  it('persists a sanitized unified snapshot and keeps legacy keys compatible', () => {
    const next = writeWinkGoIslandFilePreferences({
      activityEnabled: false,
      islandTheme: 'black',
      islandVisible: false,
      mediaControllerEnabled: false,
      mediaTarget: 'qqmusic',
      opacity: 180,
      organizerEnabled: false,
    });

    expect(next.opacity).toBe(100);
    expect(JSON.parse(window.localStorage.getItem(WINK_GO_ISLAND_PREFERENCES_KEY) || '{}')).toMatchObject(next);
    expect(window.localStorage.getItem('winkgo_island_opacity')).toBe('100');
    expect(window.localStorage.getItem('winkgo_island_theme')).toBe('black');
    expect(window.localStorage.getItem('winkgo_music_ctrl')).toBe('false');
    expect(window.localStorage.getItem('winkgo_target_player')).toBe('qqmusic');
    expect(window.localStorage.getItem('winkgo_xiaozhi_activity_enabled')).toBe('false');
    expect(window.localStorage.getItem('winkgo_file_organizer_enabled')).toBe('false');
  });

  it('notifies the current renderer immediately after a setting changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWinkGoIslandFilePreferences(listener);

    writeWinkGoIslandFilePreferences({ opacity: 64 });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ opacity: 64 }));
    unsubscribe();
  });
});
