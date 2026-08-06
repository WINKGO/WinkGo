/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GoEnd, GoStart, PauseOne, PlayOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { WinkGoLyricsResult, WinkGoMediaControlAction, WinkGoMediaSnapshot } from '@/common/adapter/ipcBridge';
import styles from './MediaLyrics.module.css';

type MediaLyricsProps = {
  media: WinkGoMediaSnapshot;
  mediaSource: string;
  cover: React.ReactNode;
  backdropUrl?: string;
  onBack: () => void;
  onControl: (action: WinkGoMediaControlAction) => Promise<boolean>;
};

export const resolveMediaPositionMs = (media: WinkGoMediaSnapshot, now = Date.now()): number => {
  const duration = Math.max(0, media.durationMs ?? 0);
  const baseline = Math.max(0, media.positionMs ?? 0);
  if (!media.isPlaying || !media.timelineUpdatedAt) return duration ? Math.min(baseline, duration) : baseline;
  const elapsed = Math.max(0, now - media.timelineUpdatedAt) * Math.max(0, media.playbackRate ?? 1);
  const current = baseline + elapsed;
  return duration ? Math.min(current, duration) : current;
};

const NATIVE_LYRIC_LEAD_MS = 100;
const ESTIMATED_LYRIC_LEAD_MS = 260;

export const findActiveLyricIndex = (
  lines: WinkGoLyricsResult['lines'],
  positionMs: number,
  leadMs = NATIVE_LYRIC_LEAD_MS
): number => {
  let low = 0;
  let high = lines.length - 1;
  let answer = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].timeMs <= positionMs + leadMs) {
      answer = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
};

export const resolveActiveLyricProgress = (
  lines: WinkGoLyricsResult['lines'],
  activeIndex: number,
  positionMs: number,
  leadMs = NATIVE_LYRIC_LEAD_MS
): number => {
  if (activeIndex < 0 || activeIndex >= lines.length) return 0;
  const currentTime = lines[activeIndex].timeMs;
  const nextTime = lines[activeIndex + 1]?.timeMs ?? currentTime + 5_000;
  const duration = Math.max(500, nextTime - currentTime);
  return Math.max(0, Math.min(1, (positionMs + leadMs - currentTime) / duration));
};

const resolveMediaPlatform = (appId: string): 'netease' | 'qqmusic' | 'qishui' | 'generic' => {
  if (/cloudmusic|netease|music\.163|com\.netease|网易云/i.test(appId)) return 'netease';
  if (/qqmusic|qq music|tencent\.qqmusic|com\.tencent\.qqmusic|qq音乐/i.test(appId)) return 'qqmusic';
  if (/sodamusic|soda music|qishui|luna\.music|lunamusic|bytedance\.music|汽水/i.test(appId)) return 'qishui';
  return 'generic';
};

const emptyLyrics = (trackKey: string): WinkGoLyricsResult => ({
  status: 'not_found',
  trackKey,
  lines: [],
  fetchedAt: Date.now(),
});

const MediaLyrics: React.FC<MediaLyricsProps> = ({ media, mediaSource, cover, backdropUrl, onBack, onControl }) => {
  const { t } = useTranslation();
  const [lyrics, setLyrics] = useState<WinkGoLyricsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const trackKey = `${media.appId}\u0000${media.title}\u0000${media.artist}`.toLocaleLowerCase();

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;
    let attempt = 0;
    setLoading(true);
    setLyrics(null);
    const lookup = () => {
      void ipcBridge.winkGoWindows.getLyrics
        .invoke({
          appId: media.appId,
          title: media.title,
          artist: media.artist,
          albumTitle: media.albumTitle,
        })
        .then((result) => {
          if (disposed || result.trackKey !== trackKey) return;
          setLyrics(result);
          setLoading(false);
          if (result.status !== 'ok') {
            attempt += 1;
            retryTimer = window.setTimeout(lookup, attempt <= 4 ? 3_500 : 15_000);
          }
        })
        .catch(() => {
          if (disposed) return;
          setLyrics(emptyLyrics(trackKey));
          setLoading(false);
          attempt += 1;
          retryTimer = window.setTimeout(lookup, attempt <= 4 ? 3_500 : 15_000);
        });
    };
    lookup();
    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [media.albumTitle, media.appId, media.artist, media.title, trackKey]);

  useEffect(() => {
    setClock(Date.now());
    if (!media.isPlaying || !media.timelineUpdatedAt) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 120);
    return () => window.clearInterval(timer);
  }, [media.isPlaying, media.timelineUpdatedAt]);

  const positionMs = resolveMediaPositionMs(media, clock);
  const hasTimelinePosition = Number.isFinite(media.positionMs) && Number.isFinite(media.durationMs);
  const lyricLeadMs = media.timelineEstimated ? ESTIMATED_LYRIC_LEAD_MS : NATIVE_LYRIC_LEAD_MS;
  const activeIndex = useMemo(
    () =>
      lyrics?.status === 'ok' && hasTimelinePosition ? findActiveLyricIndex(lyrics.lines, positionMs, lyricLeadMs) : -1,
    [hasTimelinePosition, lyricLeadMs, lyrics, positionMs]
  );
  const activeProgress = useMemo(
    () =>
      lyrics?.status === 'ok' ? resolveActiveLyricProgress(lyrics.lines, activeIndex, positionMs, lyricLeadMs) : 0,
    [activeIndex, lyricLeadMs, lyrics, positionMs]
  );

  useEffect(() => {
    activeLineRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  const mediaPlatform = resolveMediaPlatform(media.appId);
  const backgroundArtwork = media.coverUrl || backdropUrl;
  const handleBackgroundClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, [data-keep-player-expanded="true"]')) return;
    onBack();
  };
  return (
    <div
      className={styles.root}
      data-testid='titlebar-dynamic-island-lyrics-view'
      data-platform={mediaPlatform}
      onClick={handleBackgroundClick}
    >
      {backgroundArtwork && (
        <span
          className={styles.backdrop}
          data-testid='titlebar-dynamic-island-lyrics-backdrop'
          aria-hidden='true'
          style={{ backgroundImage: `url(${JSON.stringify(backgroundArtwork)})` }}
        />
      )}
      <span className={styles.lightFlow} data-testid='titlebar-dynamic-island-light-flow' aria-hidden='true' />
      <button
        type='button'
        className={styles.collapseHitArea}
        aria-label={t('common.winkGoWorkspace.backToPlayer')}
        title={t('common.winkGoWorkspace.backToPlayer')}
        onClick={onBack}
      />

      <div className={styles.stage}>
        <section className={styles.albumColumn}>
          <div
            className={`${styles.turntable}${media.isPlaying ? ` ${styles.turntablePlaying}` : ''}`}
            data-testid='titlebar-dynamic-island-vinyl'
            data-playing={media.isPlaying ? 'true' : 'false'}
            aria-hidden='true'
          >
            <span className={styles.vinyl}>
              <span className={styles.vinylLabel}>{cover}</span>
              <span className={styles.spindle} />
            </span>
            <svg className={styles.tonearm} viewBox='0 0 218 218' focusable='false' aria-hidden='true'>
              <circle className={styles.tonearmPivotRing} cx='153' cy='12' r='11' />
              <circle className={styles.tonearmPivot} cx='153' cy='12' r='5.5' />
              <path className={styles.tonearmStem} d='M153 18 C156 58 160 88 176 107 L199 127' />
              <rect className={styles.tonearmHead} x='193' y='119' width='25' height='14' rx='3' />
            </svg>
          </div>
          <strong className={styles.title} title={media.title}>
            {media.title}
          </strong>
          <small className={styles.artist} title={media.artist || mediaSource}>
            {media.artist || mediaSource} · {mediaSource}
          </small>
        </section>

        <section className={styles.lyricsColumn} aria-live='polite'>
          <div
            className={styles.lyricsViewport}
            data-testid='titlebar-dynamic-island-lyrics-lines'
            data-keep-player-expanded='true'
          >
            {loading ? (
              <div className={styles.status}>{t('common.winkGoWorkspace.lyricsLoading')}</div>
            ) : lyrics?.status === 'ok' ? (
              <>
                {lyrics.lines.map((line, index) => {
                  const active = index === activeIndex;
                  const distance = activeIndex < 0 ? 3 : Math.min(3, Math.abs(index - activeIndex));
                  return (
                    <div
                      key={`${line.timeMs}:${line.text}`}
                      ref={active ? activeLineRef : undefined}
                      className={`${styles.line}${active ? ` ${styles.activeLine}` : ''}`}
                      data-active={active ? 'true' : 'false'}
                      data-distance={distance}
                      data-phase={active ? 'active' : index < activeIndex ? 'past' : 'future'}
                    >
                      <span
                        className={active ? styles.activeText : undefined}
                        style={
                          active
                            ? ({ '--lyric-progress': `${Math.round(activeProgress * 100)}%` } as React.CSSProperties)
                            : undefined
                        }
                      >
                        {line.text}
                      </span>
                      {line.translation && <small>{line.translation}</small>}
                    </div>
                  );
                })}
              </>
            ) : (
              <div className={styles.status}>
                <strong>{t('common.winkGoWorkspace.lyricsUnavailable')}</strong>
                <small>{t('common.winkGoWorkspace.lyricsUnavailableHint')}</small>
              </div>
            )}
          </div>
          <div className={styles.compactControls}>
            <button
              type='button'
              className={`${styles.controlButton} ${styles.previousButton}`}
              aria-label={t('common.winkGoWorkspace.previousTrack')}
              onClick={() => void onControl('previous')}
            >
              <GoStart theme='filled' size='17' fill='currentColor' />
            </button>
            <button
              type='button'
              className={`${styles.playButton}${media.isPlaying ? '' : ` ${styles.playButtonPaused}`}`}
              aria-label={
                media.isPlaying ? t('common.winkGoWorkspace.pauseMedia') : t('common.winkGoWorkspace.playMedia')
              }
              onClick={() => void onControl('play_pause')}
            >
              {media.isPlaying ? (
                <PauseOne theme='filled' size='18' fill='currentColor' />
              ) : (
                <PlayOne theme='filled' size='18' fill='currentColor' />
              )}
            </button>
            <button
              type='button'
              className={`${styles.controlButton} ${styles.nextButton}`}
              aria-label={t('common.winkGoWorkspace.nextTrack')}
              onClick={() => void onControl('next')}
            >
              <GoEnd theme='filled' size='17' fill='currentColor' />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default MediaLyrics;
