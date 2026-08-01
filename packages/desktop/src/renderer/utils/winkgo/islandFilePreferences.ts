/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoMediaTarget } from '@/common/adapter/ipcBridge';

export type { WinkGoMediaTarget } from '@/common/adapter/ipcBridge';

export const WINK_GO_ISLAND_PREFERENCES_KEY = 'winkgo.island-files.preferences.v1';
export const WINK_GO_ISLAND_PREFERENCES_EVENT = 'winkgo:island-files-preferences-changed';
export const WINK_GO_ORGANIZER_SETTINGS_EVENT = 'winkgo:organizer-settings-changed';

export const WINK_GO_ORGANIZER_STORAGE_KEYS = {
  recentFiles: 'winkgo.organizer.recent-files.v1',
  lastBatch: 'winkgo.organizer.last-batch.v1',
  rules: 'winkgo.organizer.rules.v1',
  root: 'winkgo.organizer.root.v1',
  mode: 'winkgo.organizer.mode.v1',
  autoRename: 'winkgo.organizer.auto-rename.v1',
} as const;

export type WinkGoIslandTheme = 'black' | 'white';
export type WinkGoIslandFilePreferences = {
  activityEnabled: boolean;
  autoHideFullscreen: boolean;
  interactionSoundEnabled: boolean;
  islandTheme: WinkGoIslandTheme;
  islandVisible: boolean;
  mediaControllerEnabled: boolean;
  mediaTarget: WinkGoMediaTarget;
  notificationReceiveEnabled: boolean;
  opacity: number;
  organizerEnabled: boolean;
  wechatNotificationCardsEnabled: boolean;
};

export const DEFAULT_WINK_GO_ISLAND_FILE_PREFERENCES: WinkGoIslandFilePreferences = {
  activityEnabled: true,
  autoHideFullscreen: false,
  interactionSoundEnabled: true,
  islandTheme: 'white',
  islandVisible: true,
  mediaControllerEnabled: true,
  mediaTarget: 'system',
  notificationReceiveEnabled: true,
  opacity: 100,
  organizerEnabled: true,
  wechatNotificationCardsEnabled: true,
};

const readLegacyBoolean = (key: string, fallback: boolean): boolean => {
  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored !== 'false';
};

const sanitizeOpacity = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_WINK_GO_ISLAND_FILE_PREFERENCES.opacity;
  return Math.min(100, Math.max(20, Math.round(parsed)));
};

const sanitizeIslandTheme = (value: unknown): WinkGoIslandTheme => (value === 'black' ? 'black' : 'white');

const sanitizeMediaTarget = (value: unknown): WinkGoMediaTarget => {
  const supported: WinkGoMediaTarget[] = [
    'system',
    'netease',
    'spotify',
    'apple',
    'qqmusic',
    'kugou',
    'echo',
    'lx-music',
  ];
  return supported.includes(value as WinkGoMediaTarget) ? (value as WinkGoMediaTarget) : 'system';
};

const sanitizePreferences = (value: Partial<WinkGoIslandFilePreferences>): WinkGoIslandFilePreferences => ({
  activityEnabled:
    typeof value.activityEnabled === 'boolean'
      ? value.activityEnabled
      : readLegacyBoolean('winkgo_xiaozhi_activity_enabled', true),
  autoHideFullscreen:
    typeof value.autoHideFullscreen === 'boolean'
      ? value.autoHideFullscreen
      : window.localStorage.getItem('winkgo_autohide_fs') === 'true',
  interactionSoundEnabled:
    typeof value.interactionSoundEnabled === 'boolean'
      ? value.interactionSoundEnabled
      : readLegacyBoolean('winkgo_ui_sound_enabled', true),
  islandTheme: sanitizeIslandTheme(value.islandTheme ?? window.localStorage.getItem('winkgo_island_theme') ?? 'white'),
  islandVisible: typeof value.islandVisible === 'boolean' ? value.islandVisible : true,
  mediaControllerEnabled:
    typeof value.mediaControllerEnabled === 'boolean'
      ? value.mediaControllerEnabled
      : readLegacyBoolean('winkgo_music_ctrl', true),
  mediaTarget: sanitizeMediaTarget(
    value.mediaTarget ?? window.localStorage.getItem('winkgo_target_player') ?? 'system'
  ),
  notificationReceiveEnabled:
    typeof value.notificationReceiveEnabled === 'boolean'
      ? value.notificationReceiveEnabled
      : readLegacyBoolean('winkgo_msg_notify', true),
  opacity: sanitizeOpacity(value.opacity ?? window.localStorage.getItem('winkgo_island_opacity') ?? 100),
  organizerEnabled:
    typeof value.organizerEnabled === 'boolean'
      ? value.organizerEnabled
      : readLegacyBoolean('winkgo_file_organizer_enabled', true),
  wechatNotificationCardsEnabled:
    typeof value.wechatNotificationCardsEnabled === 'boolean'
      ? value.wechatNotificationCardsEnabled
      : readLegacyBoolean('winkgo_wechat_notification_cards', true),
});

export const readWinkGoIslandFilePreferences = (): WinkGoIslandFilePreferences => {
  try {
    const stored = window.localStorage.getItem(WINK_GO_ISLAND_PREFERENCES_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : {};
    return sanitizePreferences(parsed && typeof parsed === 'object' ? parsed : {});
  } catch {
    return { ...DEFAULT_WINK_GO_ISLAND_FILE_PREFERENCES };
  }
};

export const writeWinkGoIslandFilePreferences = (
  update:
    | Partial<WinkGoIslandFilePreferences>
    | ((current: WinkGoIslandFilePreferences) => Partial<WinkGoIslandFilePreferences>)
): WinkGoIslandFilePreferences => {
  const current = readWinkGoIslandFilePreferences();
  const patch = typeof update === 'function' ? update(current) : update;
  const next = sanitizePreferences({ ...current, ...patch });

  window.localStorage.setItem(WINK_GO_ISLAND_PREFERENCES_KEY, JSON.stringify(next));
  // Keep the original WINK GO keys in sync so existing installations migrate
  // without losing any of the behavior configured in the former desktop app.
  window.localStorage.setItem('winkgo_ui_sound_enabled', String(next.interactionSoundEnabled));
  window.localStorage.setItem('winkgo_island_theme', next.islandTheme);
  window.localStorage.setItem('winkgo_island_opacity', String(next.opacity));
  window.localStorage.setItem('winkgo_music_ctrl', String(next.mediaControllerEnabled));
  window.localStorage.setItem('winkgo_target_player', next.mediaTarget);
  window.localStorage.setItem('winkgo_msg_notify', String(next.notificationReceiveEnabled));
  window.localStorage.setItem('winkgo_autohide_fs', String(next.autoHideFullscreen));
  window.localStorage.setItem('winkgo_xiaozhi_activity_enabled', String(next.activityEnabled));
  window.localStorage.setItem('winkgo_file_organizer_enabled', String(next.organizerEnabled));
  window.localStorage.setItem('winkgo_wechat_notification_cards', String(next.wechatNotificationCardsEnabled));
  window.dispatchEvent(new CustomEvent(WINK_GO_ISLAND_PREFERENCES_EVENT, { detail: next }));
  return next;
};

export const subscribeWinkGoIslandFilePreferences = (
  listener: (preferences: WinkGoIslandFilePreferences) => void
): (() => void) => {
  const handlePreferencesChanged = () => listener(readWinkGoIslandFilePreferences());
  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === WINK_GO_ISLAND_PREFERENCES_KEY ||
      event.key === 'winkgo_ui_sound_enabled' ||
      event.key === 'winkgo_island_theme' ||
      event.key === 'winkgo_island_opacity' ||
      event.key === 'winkgo_music_ctrl' ||
      event.key === 'winkgo_target_player' ||
      event.key === 'winkgo_msg_notify' ||
      event.key === 'winkgo_autohide_fs' ||
      event.key === 'winkgo_xiaozhi_activity_enabled' ||
      event.key === 'winkgo_file_organizer_enabled' ||
      event.key === 'winkgo_wechat_notification_cards'
    ) {
      handlePreferencesChanged();
    }
  };

  window.addEventListener(WINK_GO_ISLAND_PREFERENCES_EVENT, handlePreferencesChanged);
  window.addEventListener('storage', handleStorage);
  return () => {
    window.removeEventListener(WINK_GO_ISLAND_PREFERENCES_EVENT, handlePreferencesChanged);
    window.removeEventListener('storage', handleStorage);
  };
};

export const notifyWinkGoOrganizerSettingsChanged = (): void => {
  window.dispatchEvent(new CustomEvent(WINK_GO_ORGANIZER_SETTINGS_EVENT));
};

export const playWinkGoInteractionSound = (kind: 'click' | 'complete' = 'click'): void => {
  try {
    const audioContext = new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const startAt = audioContext.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(kind === 'complete' ? 660 : 520, startAt);
    if (kind === 'complete') oscillator.frequency.exponentialRampToValueAtTime(880, startAt + 0.09);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(kind === 'complete' ? 0.055 : 0.028, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + (kind === 'complete' ? 0.15 : 0.07));
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + (kind === 'complete' ? 0.16 : 0.08));
    oscillator.addEventListener('ended', () => {
      void audioContext.close();
    });
  } catch {
    // Sound is an optional on-demand enhancement; never keep an audio service alive.
  }
};
