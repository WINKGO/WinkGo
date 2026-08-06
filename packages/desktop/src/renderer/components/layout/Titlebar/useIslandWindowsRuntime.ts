/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type {
  WinkGoCapturedNotification,
  WinkGoMediaControlAction,
  WinkGoMediaSnapshot,
  WinkGoNotificationAccess,
} from '@/common/adapter/ipcBridge';
import type { WinkGoMediaTarget } from '@renderer/utils/winkgo/islandFilePreferences';

const PRIVACY_STORAGE_KEY = 'winkgo.island.notificationPrivacy';
const NOTIFICATION_CARD_DURATION_MS = 7_200;
const MAIL_NOTIFICATION_CARD_DURATION_MS = 15_000;
const MAX_NOTIFICATION_QUEUE_SIZE = 12;
const MEDIA_CONTROL_OPTIMISTIC_WINDOW_MS = 1_600;
const MEDIA_TRACK_REFRESH_DELAYS_MS = [160, 240, 400, 700, 1_000] as const;
const MEDIA_ARTWORK_CACHE_LIMIT = 64;
const MEDIA_TIMELINE_RENDER_INTERVAL_MS = 1_200;

type OptimisticPlaybackState = {
  expectedPlaying: boolean;
  expiresAt: number;
  trackKey: string;
};

const mediaTrackKey = (media: WinkGoMediaSnapshot): string => `${media.appId}|${media.title}|${media.artist}`;

/**
 * Windows publishes timeline corrections several times per second. None of
 * those values change the compact island, and MediaLyrics already advances a
 * local clock between native samples. Keep the latest sample in the ref, but
 * only repaint React when something the user can see changed.
 */
export const hasMaterialMediaChange = (
  current: WinkGoMediaSnapshot | null,
  next: WinkGoMediaSnapshot | null
): boolean => {
  if (!current || !next) return current !== next;
  return (
    current.appId !== next.appId ||
    current.title !== next.title ||
    current.artist !== next.artist ||
    current.albumTitle !== next.albumTitle ||
    current.isPlaying !== next.isPlaying ||
    current.canPlayPause !== next.canPlayPause ||
    current.canGoNext !== next.canGoNext ||
    current.canGoPrevious !== next.canGoPrevious ||
    current.coverUrl !== next.coverUrl ||
    current.appIconUrl !== next.appIconUrl ||
    current.durationMs !== next.durationMs ||
    current.playbackRate !== next.playbackRate ||
    current.timelineEstimated !== next.timelineEstimated
  );
};

export const shouldRenderMediaSnapshot = (
  rendered: WinkGoMediaSnapshot | null,
  next: WinkGoMediaSnapshot | null,
  lastRenderedAt: number,
  now: number
): boolean => hasMaterialMediaChange(rendered, next) || now - lastRenderedAt >= MEDIA_TIMELINE_RENDER_INTERVAL_MS;

const readPrivacyPreference = (): boolean => {
  try {
    return window.localStorage.getItem(PRIVACY_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
};

export const resolveMediaSourceName = (appId: string): string => {
  const normalized = appId.toLocaleLowerCase();
  if (
    normalized.includes('cloudmusic') ||
    normalized.includes('netease') ||
    normalized.includes('music.163') ||
    normalized.includes('com.netease') ||
    normalized.includes('网易云')
  ) {
    return '网易云音乐';
  }
  if (
    normalized.includes('qqmusic') ||
    normalized.includes('qq music') ||
    normalized.includes('tencent.qqmusic') ||
    normalized.includes('com.tencent.qqmusic') ||
    normalized.includes('qq音乐')
  ) {
    return 'QQ音乐';
  }
  if (
    normalized.includes('sodamusic') ||
    normalized.includes('soda music') ||
    normalized.includes('soda') ||
    normalized.includes('qishui') ||
    normalized.includes('luna.music') ||
    normalized.includes('lunamusic') ||
    normalized.includes('bytedance.music') ||
    normalized.includes('com.bytedance.music') ||
    normalized.includes('汽水')
  ) {
    return '汽水音乐';
  }
  if (normalized.includes('spotify')) return 'Spotify';
  if (normalized.includes('kugou') || normalized.includes('酷狗')) return '酷狗音乐';
  if (normalized.includes('kuwo') || normalized.includes('酷我')) return '酷我音乐';
  if (normalized.includes('migu') || normalized.includes('咪咕')) return '咪咕音乐';
  if (normalized.includes('qianqian') || normalized.includes('千千')) return '千千音乐';
  if (normalized.includes('lx-music') || normalized.includes('lxmusic') || normalized.includes('洛雪')) {
    return '洛雪音乐';
  }
  if (normalized.includes('apple') || normalized.includes('itunes')) return 'Apple Music';
  if (normalized.includes('musicbee')) return 'MusicBee';
  if (normalized.includes('foobar')) return 'foobar2000';
  if (normalized.includes('aimp')) return 'AIMP';
  if (normalized.includes('winamp')) return 'Winamp';
  return appId.trim() || '系统媒体';
};

export const matchesMediaTarget = (
  snapshot: WinkGoMediaSnapshot | null,
  target: WinkGoMediaTarget
): snapshot is WinkGoMediaSnapshot => {
  if (!snapshot) return false;
  if (target === 'system') return true;
  const appId = snapshot.appId.toLocaleLowerCase();
  const aliases: Record<Exclude<WinkGoMediaTarget, 'system'>, string[]> = {
    netease: ['cloudmusic', 'netease', 'music.163', 'com.netease', '网易云'],
    spotify: ['spotify'],
    apple: ['applemusic', 'apple music', 'itunes', 'apple'],
    qqmusic: ['qqmusic', 'qq music', 'tencent.qqmusic', 'com.tencent.qqmusic', 'qq音乐'],
    kugou: ['kugou', '酷狗'],
    echo: ['echomusic', 'echo music', 'echo'],
    'lx-music': ['lx-music', 'lxmusic', 'lx music'],
  };
  return aliases[target].some((alias) => appId.includes(alias));
};

type UseIslandWindowsRuntimeOptions = {
  mediaEnabled?: boolean;
  mediaTarget?: WinkGoMediaTarget;
  notificationCardsEnabled?: boolean;
  notificationEnabled?: boolean;
  mailNotificationsEnabled?: boolean;
};

export const useIslandWindowsRuntime = ({
  mediaEnabled = true,
  mediaTarget = 'system',
  notificationCardsEnabled = true,
  notificationEnabled = true,
  mailNotificationsEnabled = true,
}: UseIslandWindowsRuntimeOptions = {}) => {
  const [media, setMedia] = useState<WinkGoMediaSnapshot | null>(null);
  const [notification, setNotification] = useState<WinkGoCapturedNotification | null>(null);
  const [notificationAccess, setNotificationAccess] = useState<WinkGoNotificationAccess>('Unspecified');
  const [privacyMode, setPrivacyModeState] = useState(readPrivacyPreference);
  const optimisticPlaybackRef = useRef<OptimisticPlaybackState | null>(null);
  const mediaRefreshGenerationRef = useRef(0);
  const currentMediaRef = useRef<WinkGoMediaSnapshot | null>(null);
  const renderedMediaRef = useRef<WinkGoMediaSnapshot | null>(null);
  const lastMediaRenderAtRef = useRef(0);
  const mediaArtworkCacheRef = useRef(new Map<string, string>());
  const reconcileMediaSnapshotRef = useRef<(snapshot: WinkGoMediaSnapshot | null) => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let notificationTimer: number | undefined;
    let activeNotification: WinkGoCapturedNotification | null = null;
    const notificationQueue: WinkGoCapturedNotification[] = [];

    const showNextNotification = () => {
      if (disposed || activeNotification || notificationQueue.length === 0) return;
      activeNotification = notificationQueue.shift() ?? null;
      setNotification(activeNotification);
      notificationTimer = window.setTimeout(
        () => {
          activeNotification = null;
          setNotification(null);
          showNextNotification();
        },
        activeNotification?.mail ? MAIL_NOTIFICATION_CARD_DURATION_MS : NOTIFICATION_CARD_DURATION_MS
      );
    };

    const reconcileMediaSnapshot = (snapshot: WinkGoMediaSnapshot | null) => {
      if (disposed) return;
      let nextMedia = mediaEnabled && matchesMediaTarget(snapshot, mediaTarget) ? snapshot : null;
      const currentMedia = currentMediaRef.current;
      if (nextMedia && currentMedia && nextMedia.updatedAt < currentMedia.updatedAt) return;
      if (nextMedia) {
        const trackKey = mediaTrackKey(nextMedia);
        if (nextMedia.coverUrl) {
          const artworkCache = mediaArtworkCacheRef.current;
          artworkCache.delete(trackKey);
          artworkCache.set(trackKey, nextMedia.coverUrl);
          if (artworkCache.size > MEDIA_ARTWORK_CACHE_LIMIT) {
            const oldestKey = artworkCache.keys().next().value;
            if (oldestKey) artworkCache.delete(oldestKey);
          }
        } else {
          const cachedCoverUrl = mediaArtworkCacheRef.current.get(trackKey);
          if (cachedCoverUrl) nextMedia = { ...nextMedia, coverUrl: cachedCoverUrl };
        }
      }
      if (
        nextMedia &&
        !nextMedia.coverUrl &&
        currentMedia?.coverUrl &&
        mediaTrackKey(nextMedia) === mediaTrackKey(currentMedia)
      ) {
        nextMedia = { ...nextMedia, coverUrl: currentMedia.coverUrl };
      }
      const optimistic = optimisticPlaybackRef.current;
      if (
        nextMedia &&
        optimistic &&
        optimistic.trackKey === mediaTrackKey(nextMedia) &&
        Date.now() < optimistic.expiresAt &&
        nextMedia.isPlaying !== optimistic.expectedPlaying
      ) {
        const optimisticMedia = {
          ...nextMedia,
          isPlaying: optimistic.expectedPlaying,
        };
        currentMediaRef.current = optimisticMedia;
        renderedMediaRef.current = optimisticMedia;
        lastMediaRenderAtRef.current = Date.now();
        setMedia(optimisticMedia);
        return;
      }
      if (
        !nextMedia ||
        !optimistic ||
        optimistic.trackKey !== mediaTrackKey(nextMedia) ||
        nextMedia.isPlaying === optimistic.expectedPlaying ||
        Date.now() >= optimistic.expiresAt
      ) {
        optimisticPlaybackRef.current = null;
      }
      currentMediaRef.current = nextMedia;
      const renderTimestamp = Date.now();
      if (
        !shouldRenderMediaSnapshot(renderedMediaRef.current, nextMedia, lastMediaRenderAtRef.current, renderTimestamp)
      ) {
        return;
      }
      renderedMediaRef.current = nextMedia;
      lastMediaRenderAtRef.current = renderTimestamp;
      setMedia(nextMedia);
    };
    reconcileMediaSnapshotRef.current = reconcileMediaSnapshot;

    const unsubscribeMedia = ipcBridge.winkGoWindows.mediaChanged.on(reconcileMediaSnapshot);
    const enqueueNotification = (nextNotification: WinkGoCapturedNotification, enabled: boolean) => {
      if (disposed || !enabled) return;
      if (
        activeNotification?.id === nextNotification.id ||
        notificationQueue.some((item) => item.id === nextNotification.id)
      ) {
        return;
      }
      notificationQueue.push(nextNotification);
      if (notificationQueue.length > MAX_NOTIFICATION_QUEUE_SIZE) notificationQueue.shift();
      showNextNotification();
    };
    const unsubscribeNotifications = ipcBridge.winkGoWindows.notificationReceived.on((nextNotification) => {
      enqueueNotification(nextNotification, notificationCardsEnabled);
    });
    const unsubscribeMail = ipcBridge.winkGoMail.messageReceived.on((nextNotification) => {
      enqueueNotification(nextNotification, mailNotificationsEnabled);
    });

    const configureForVisibility = () => {
      const enabled = document.visibilityState === 'visible';
      if (!enabled) return;
      void ipcBridge.winkGoWindows.configure
        .invoke({
          mediaEnabled,
          mediaTarget,
          notificationEnabled,
        })
        .then((state) => {
          if (disposed) return;
          reconcileMediaSnapshot(state.media);
          setNotificationAccess(state.notificationAccess);
        })
        .catch((error) => {
          console.warn('[WINK GO island] Windows runtime is unavailable:', error);
        });
    };

    configureForVisibility();
    document.addEventListener('visibilitychange', configureForVisibility);
    return () => {
      disposed = true;
      if (notificationTimer) window.clearTimeout(notificationTimer);
      if (reconcileMediaSnapshotRef.current === reconcileMediaSnapshot) {
        reconcileMediaSnapshotRef.current = () => {};
      }
      document.removeEventListener('visibilitychange', configureForVisibility);
      unsubscribeMedia();
      unsubscribeNotifications();
      unsubscribeMail();
    };
  }, [mailNotificationsEnabled, mediaEnabled, mediaTarget, notificationCardsEnabled, notificationEnabled]);

  useEffect(() => {
    if (notificationCardsEnabled || mailNotificationsEnabled) return;
    setNotification(null);
  }, [mailNotificationsEnabled, notificationCardsEnabled]);

  const controlMedia = useCallback(
    async (action: WinkGoMediaControlAction): Promise<boolean> => {
      if (!mediaEnabled) return false;
      const refreshGeneration = ++mediaRefreshGenerationRef.current;
      const previousMedia = media;
      const expectedPlaying =
        previousMedia && action === 'play'
          ? true
          : previousMedia && action === 'pause'
            ? false
            : previousMedia && action === 'play_pause'
              ? !previousMedia.isPlaying
              : null;
      if (previousMedia && expectedPlaying !== null) {
        optimisticPlaybackRef.current = {
          expectedPlaying,
          expiresAt: Date.now() + MEDIA_CONTROL_OPTIMISTIC_WINDOW_MS,
          trackKey: mediaTrackKey(previousMedia),
        };
        const optimisticMedia = {
          ...previousMedia,
          isPlaying: expectedPlaying,
          updatedAt: Date.now(),
        };
        currentMediaRef.current = optimisticMedia;
        renderedMediaRef.current = optimisticMedia;
        lastMediaRenderAtRef.current = Date.now();
        setMedia(optimisticMedia);
      }
      try {
        const result = await ipcBridge.winkGoWindows.controlMedia.invoke({ action });
        if (!result.controlled && previousMedia && expectedPlaying !== null) {
          optimisticPlaybackRef.current = null;
          currentMediaRef.current = previousMedia;
          renderedMediaRef.current = previousMedia;
          lastMediaRenderAtRef.current = Date.now();
          setMedia(previousMedia);
        }
        if (result.controlled && previousMedia && (action === 'next' || action === 'previous')) {
          const previousTrackKey = mediaTrackKey(previousMedia);
          void (async () => {
            let retriedPrevious = false;
            for (const [index, delay] of MEDIA_TRACK_REFRESH_DELAYS_MS.entries()) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
              if (mediaRefreshGenerationRef.current !== refreshGeneration) return;
              try {
                const state = await ipcBridge.winkGoWindows.getState.invoke();
                const nextMedia = mediaEnabled && matchesMediaTarget(state.media, mediaTarget) ? state.media : null;
                if (nextMedia && mediaTrackKey(nextMedia) !== previousTrackKey) {
                  optimisticPlaybackRef.current = null;
                  reconcileMediaSnapshotRef.current(state.media);
                  return;
                }
                // Several Windows players interpret the first Previous command
                // as "restart the current track" once playback has advanced.
                // If metadata is still unchanged after the first three reads
                // (~800 ms), send one additional Previous so the user-facing
                // button consistently reaches the prior song.
                if (action === 'previous' && index === 2 && !retriedPrevious) {
                  retriedPrevious = true;
                  const retry = await ipcBridge.winkGoWindows.controlMedia.invoke({ action: 'previous' });
                  if (!retry.controlled) return;
                }
              } catch {
                // The normal mediaChanged event remains the primary path. A
                // failed backstop read should not turn a successful skip into
                // a visible control error.
              }
            }
          })();
        }
        return result.controlled;
      } catch (error) {
        if (previousMedia && expectedPlaying !== null) {
          optimisticPlaybackRef.current = null;
          currentMediaRef.current = previousMedia;
          renderedMediaRef.current = previousMedia;
          lastMediaRenderAtRef.current = Date.now();
          setMedia(previousMedia);
        }
        console.warn('[WINK GO island] Media control failed:', error);
        return false;
      }
    },
    [media, mediaEnabled, mediaTarget]
  );

  const requestNotificationAccess = useCallback(async (): Promise<WinkGoNotificationAccess> => {
    try {
      const result = await ipcBridge.winkGoWindows.requestNotificationAccess.invoke();
      setNotificationAccess(result.status);
      if (result.status === 'Allowed') {
        void ipcBridge.winkGoWindows.configure.invoke({
          mediaEnabled,
          mediaTarget,
          notificationEnabled,
        });
      }
      return result.status;
    } catch (error) {
      console.warn('[WINK GO island] Notification permission request failed:', error);
      setNotificationAccess('Unavailable');
      return 'Unavailable';
    }
  }, [mediaEnabled, mediaTarget, notificationEnabled]);

  const setPrivacyMode = useCallback((enabled: boolean) => {
    setPrivacyModeState(enabled);
    try {
      window.localStorage.setItem(PRIVACY_STORAGE_KEY, String(enabled));
    } catch {
      // Privacy remains enabled for this session when storage is unavailable.
    }
  }, []);

  return {
    media,
    notification,
    notificationAccess,
    privacyMode,
    mediaSource: media ? resolveMediaSourceName(media.appId) : '',
    controlMedia,
    requestNotificationAccess,
    setPrivacyMode,
    dismissNotification: () => setNotification(null),
  };
};
