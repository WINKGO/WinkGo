/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, InputNumber, Progress, Radio, Switch } from '@arco-design/web-react';
import {
  AlarmClock,
  ApplicationMenu,
  Browser,
  CloseSmall,
  Computer,
  Compression,
  Delete,
  Download,
  FileCollection,
  FolderOpen,
  FolderPlus,
  FolderUpload,
  GoEnd,
  GoStart,
  Lock,
  Message,
  Music,
  PauseOne,
  Picture,
  PlayOne,
  Plus,
  Refresh,
  Undo,
  Video,
} from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ipcBridge } from '@/common';
import type {
  ICronJob,
  WinkGoFormatEngineStatus,
  WinkGoFormatPreset,
  WinkGoMailDownloadResult,
  WinkGoMailMessage,
  WinkGoMailPreviewResult,
  WinkGoMailStatus,
} from '@/common/adapter/ipcBridge';
import documentConvertIcon from '@renderer/assets/format-tools/document-convert.png';
import winkGoMailLogo from '@renderer/assets/mail/winkgo-mail-logo.png';
import winkGoMailMessageIcon from '@renderer/assets/mail/winkgo-mail-message.png';
import FileTypeIcon from '@renderer/pages/conversation/Workspace/components/FileTypeIcon';
import { useWinkGoIslandFilePreferences } from '@renderer/hooks/system/useWinkGoIslandFilePreferences';
import {
  WINK_GO_BRAND_ICON as winkGoWordmark,
  resolveIslandDynamicIdentity,
  resolveMediaIdentity,
  resolveNotificationIdentity,
  type IslandDynamicIdentity,
} from '@renderer/utils/model/winkGoBranding';
import { playWinkGoInteractionSound } from '@renderer/utils/winkgo/islandFilePreferences';
import { useAddEventListener } from '@renderer/utils/emitter';
import type { IslandActivity, IslandActivityStatus } from './islandActivity';
import { extractMailVerificationCode, isLikelyVerificationMail } from './mailVerificationCode';
import ComputerUsePanel from './ComputerUsePanel';
import MediaLyrics from './MediaLyrics';
import { useIslandActivityFeed } from './useIslandActivityFeed';
import { useIslandFileOrganizer, type IslandRecentFile } from './useIslandFileOrganizer';
import { useIslandFocusTimer } from './useIslandFocusTimer';
import { useIslandWindowsRuntime } from './useIslandWindowsRuntime';

type IslandPanel =
  | 'activity'
  | 'media'
  | 'notification'
  | 'tools'
  | 'mail'
  | 'browserComputerUse'
  | 'desktopComputerUse'
  | 'timer'
  | 'files'
  | 'category'
  | 'destination'
  | 'drop'
  | 'format'
  | 'apps'
  | 'toast'
  | null;

type TitlebarDynamicIslandProps = {
  floating?: boolean;
};

type MediaView = 'controls' | 'lyrics';

const applyWinkGoImageFallback = (event: React.SyntheticEvent<HTMLImageElement>) => {
  const image = event.currentTarget;
  if (image.dataset.winkgoFallbackApplied === 'true') return;
  image.dataset.winkgoFallbackApplied = 'true';
  image.dataset.winkgoBrand = 'true';
  image.src = winkGoWordmark;
};

const StableIslandIdentityImage: React.FC<{
  identity: IslandDynamicIdentity;
  className?: string;
}> = ({ identity, className = '' }) => {
  const [visibleSource, setVisibleSource] = useState(identity.source);
  const [visibleLoaded, setVisibleLoaded] = useState(identity.source === identity.fallbackSource);
  const [previousSource, setPreviousSource] = useState<string | null>(null);
  const visibleIdentityKeyRef = useRef(identity.key);

  useEffect(() => {
    if (!previousSource) return undefined;
    const timer = window.setTimeout(() => setPreviousSource(null), 240);
    return () => window.clearTimeout(timer);
  }, [previousSource]);

  useEffect(() => {
    if (identity.source === visibleSource) return undefined;
    let cancelled = false;
    let graceTimer = 0;
    const previous = visibleSource;
    const previousIdentityKey = visibleIdentityKeyRef.current;
    visibleIdentityKeyRef.current = identity.key;
    const mediaAppKey = (key: string): string => (key.startsWith('media:') ? key.split(':')[1] || '' : '');
    const previousMediaApp = mediaAppKey(previousIdentityKey);
    const nextMediaApp = mediaAppKey(identity.key);
    const preservePrevious = !previousMediaApp || !nextMediaApp || previousMediaApp === nextMediaApp;

    const promote = (source: string) => {
      if (cancelled || source === visibleSource) return;
      setPreviousSource(preservePrevious && previous !== identity.fallbackSource ? previous : null);
      setVisibleSource(source);
      // The image is decoded before promotion, so it can be painted on the
      // first composited frame instead of flashing the provider icon.
      setVisibleLoaded(source === identity.fallbackSource);
    };

    const prepare = (source: string, fallback = false) => {
      if (source === identity.fallbackSource) {
        promote(source);
        return;
      }
      if (/^(?:data:|blob:)/i.test(source)) {
        // The bytes are already local. Mount the new layer immediately while
        // keeping the old decoded layer beneath it; its DOM onLoad drives the
        // opacity crossfade without a second base64 decode in JavaScript.
        promote(source);
        return;
      }
      const image = new Image();
      let ready = false;
      image.decoding = 'async';
      const reveal = (): void => {
        if (ready) return;
        ready = true;
        const decoded: Promise<void> =
          typeof image.decode === 'function' ? image.decode().catch((): void => undefined) : Promise.resolve();
        void decoded.then((): void => promote(source));
      };
      image.onload = reveal;
      image.onerror = () => {
        if (!fallback) prepare(identity.fallbackSource, true);
      };
      image.src = source;
      if (image.complete && image.naturalWidth > 0) reveal();
    };

    // A new track normally arrives once without artwork and is enriched a
    // fraction of a second later. Preserve the old decoded cover during that
    // grace period so the compact island never flashes a generic app logo.
    const deferProviderFallback =
      identity.kind === 'media-app' && preservePrevious && previous !== identity.fallbackSource;
    if (deferProviderFallback) {
      graceTimer = window.setTimeout(() => prepare(identity.source), 260);
    } else {
      prepare(identity.source);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(graceTimer);
    };
  }, [identity.fallbackSource, identity.key, identity.kind, identity.source, visibleSource]);

  const showPrimary = visibleSource !== identity.fallbackSource;

  return (
    <span
      className={`titlebar-dynamic-island__stable-image ${className}`.trim()}
      data-primary-loaded={showPrimary && visibleLoaded ? 'true' : 'false'}
    >
      {showPrimary && (
        <img
          key={`primary:${visibleSource}`}
          className='titlebar-dynamic-island__stable-image-primary'
          src={visibleSource}
          alt=''
          draggable={false}
          data-loaded={visibleLoaded ? 'true' : 'false'}
          data-winkgo-brand={visibleSource === winkGoWordmark ? 'true' : 'false'}
          onLoad={() => setVisibleLoaded(true)}
          onError={() => {
            setPreviousSource(null);
            setVisibleSource(identity.fallbackSource);
            setVisibleLoaded(true);
          }}
        />
      )}
      {previousSource && previousSource !== visibleSource && (
        <img
          key={`previous:${previousSource}`}
          className='titlebar-dynamic-island__stable-image-previous'
          src={previousSource}
          alt=''
          draggable={false}
          aria-hidden='true'
          onAnimationEnd={() => setPreviousSource(null)}
        />
      )}
      <img
        className='titlebar-dynamic-island__stable-image-fallback'
        src={identity.fallbackSource}
        alt=''
        draggable={false}
        data-winkgo-brand={identity.fallbackSource === winkGoWordmark ? 'true' : 'false'}
        onError={applyWinkGoImageFallback}
      />
    </span>
  );
};

const IslandLoopText: React.FC<{ text: string }> = ({ text }) => {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const [travel, setTravel] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    // Never let a new title inherit the translateX position of the previous
    // marquee. Layout effects run before paint, removing the visible snap.
    setTravel(0);

    const measure = () => {
      const nextTravel = Math.max(0, Math.ceil(track.scrollWidth - viewport.clientWidth));
      setTravel((current) => (current === nextTravel ? current : nextTravel));
    };
    const frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(track);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [text]);

  const duration = Math.min(12, Math.max(5.6, 5 + travel / 26));

  return (
    <span className='titlebar-dynamic-island__summary' ref={viewportRef}>
      <span key={text} className='titlebar-dynamic-island__summary-transition'>
        <span
          className={`titlebar-dynamic-island__summary-track${
            travel > 1 ? ' titlebar-dynamic-island__summary-track--overflowing' : ''
          }`}
          ref={trackRef}
          style={
            {
              '--titlebar-island-summary-travel': `${travel}px`,
              '--titlebar-island-summary-duration': `${duration}s`,
            } as React.CSSProperties
          }
        >
          {text}
        </span>
      </span>
    </span>
  );
};

const floatingWindowSizes: Record<Exclude<IslandPanel, null> | 'collapsed', { height: number; width: number }> = {
  collapsed: { width: 294, height: 38 },
  activity: { width: 440, height: 300 },
  media: { width: 320, height: 115 },
  notification: { width: 410, height: 238 },
  tools: { width: 250, height: 46 },
  mail: { width: 440, height: 458 },
  browserComputerUse: { width: 440, height: 370 },
  desktopComputerUse: { width: 440, height: 370 },
  timer: { width: 440, height: 128 },
  files: { width: 470, height: 132 },
  category: { width: 470, height: 132 },
  destination: { width: 590, height: 206 },
  drop: { width: 500, height: 108 },
  format: { width: 590, height: 190 },
  apps: { width: 500, height: 164 },
  toast: { width: 460, height: 44 },
};

export const calculateFloatingIslandHeight = (
  plannedHeight: number,
  panelBottom: number,
  maximumHeight = 500
): number => Math.min(maximumHeight, Math.max(plannedHeight, Math.ceil(panelBottom + 8)));

type IslandToast = {
  id: string;
  source: string;
  text: string;
  activityId?: string;
};

const getIslandToastDisplayText = (toast: IslandToast | null): string =>
  toast?.text.replace(/^(?:WINK GO|WINK GO)\s*·\s*/i, '') ?? '';

type IslandFormatPreset = {
  id: WinkGoFormatPreset;
  title: string;
  subtitle: string;
  engine: 'builtin' | 'ffmpeg' | 'office';
  icon: React.ReactNode;
};

const ISLAND_FORMAT_PRESETS: IslandFormatPreset[] = [
  {
    id: 'ncm_to_mp3',
    title: 'NCM 转 MP3',
    subtitle: '网易云音频',
    engine: 'builtin',
    icon: <Music theme='outline' size='18' fill='currentColor' />,
  },
  {
    id: 'video_to_mp4',
    title: '视频转 MP4',
    subtitle: '通用格式',
    engine: 'ffmpeg',
    icon: <Video theme='outline' size='18' fill='currentColor' />,
  },
  {
    id: 'video_compress',
    title: '视频压缩',
    subtitle: '减小体积',
    engine: 'ffmpeg',
    icon: <Compression theme='outline' size='18' fill='currentColor' />,
  },
  {
    id: 'gif_compress',
    title: 'GIF 压缩',
    subtitle: '聊天网页',
    engine: 'ffmpeg',
    icon: <Picture theme='outline' size='18' fill='currentColor' />,
  },
  {
    id: 'audio_to_mp3',
    title: '音频转 MP3',
    subtitle: '常用音频',
    engine: 'ffmpeg',
    icon: <Music theme='outline' size='18' fill='currentColor' />,
  },
  {
    id: 'image_compress',
    title: '图片压缩',
    subtitle: '清晰 JPG',
    engine: 'ffmpeg',
    icon: <Picture theme='outline' size='18' fill='currentColor' />,
  },
  {
    id: 'document_to_pdf',
    title: '文档转 PDF',
    subtitle: '办公文档',
    engine: 'office',
    icon: <img src={documentConvertIcon} alt='' draggable={false} />,
  },
];

const EMPTY_FORMAT_ENGINES: WinkGoFormatEngineStatus = {
  ffmpegAvailable: false,
  ffmpegPath: null,
  officeAvailable: false,
  officePath: null,
  officeEngine: null,
  ncmAvailable: true,
};

const QUICK_APP_LONG_PRESS_MS = 420;
const QUICK_APP_PRESS_CANCEL_DISTANCE = 7;

const upsertJob = (jobs: ICronJob[], nextJob: ICronJob): ICronJob[] => {
  const index = jobs.findIndex((job) => job.id === nextJob.id);
  if (index < 0) return [...jobs, nextJob];
  const nextJobs = [...jobs];
  nextJobs[index] = nextJob;
  return nextJobs;
};

const useTitlebarCronSummary = () => {
  const [jobs, setJobs] = useState<ICronJob[]>([]);

  useEffect(() => {
    let cancelled = false;
    void ipcBridge.cron.listJobs
      .invoke()
      .then((result) => {
        if (!cancelled) setJobs(result ?? []);
      })
      .catch((error) => {
        console.error('[TitlebarDynamicIsland] Failed to load scheduled tasks:', error);
      });

    const unsubscribeCreated = ipcBridge.cron.onJobCreated.on((job) => {
      setJobs((current) => upsertJob(current, job));
    });
    const unsubscribeUpdated = ipcBridge.cron.onJobUpdated.on((job) => {
      setJobs((current) => upsertJob(current, job));
    });
    const unsubscribeRemoved = ipcBridge.cron.onJobRemoved.on(({ job_id }) => {
      setJobs((current) => current.filter((job) => job.id !== job_id));
    });

    return () => {
      cancelled = true;
      unsubscribeCreated();
      unsubscribeUpdated();
      unsubscribeRemoved();
    };
  }, []);

  return jobs;
};

const getNextJob = (jobs: ICronJob[]): ICronJob | null => {
  let nextJob: ICronJob | null = null;
  for (const job of jobs) {
    if (!job.enabled || !job.state.next_run_at_ms) continue;
    if (!nextJob || job.state.next_run_at_ms < (nextJob.state.next_run_at_ms ?? Number.POSITIVE_INFINITY)) {
      nextJob = job;
    }
  }
  return nextJob;
};

const formatRelativeTime = (target: number, now: number, locale: string): string => {
  const seconds = Math.max(0, Math.round((target - now) / 1000));
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 90) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return formatter.format(minutes, 'minute');
  return formatter.format(Math.round(minutes / 60), 'hour');
};

const activityStatusKey: Record<IslandActivityStatus, string> = {
  running: 'common.winkGoWorkspace.activityRunning',
  success: 'common.winkGoWorkspace.activitySuccess',
  error: 'common.winkGoWorkspace.activityError',
  attention: 'common.winkGoWorkspace.activityAttention',
};

const activityStatusClass = (activity: IslandActivity): string =>
  `titlebar-dynamic-island__activity-dot titlebar-dynamic-island__activity-dot--${activity.status}`;

const fileCategoryKey: Record<string, string> = {
  folders: 'common.winkGoWorkspace.fileCategories.folders',
  documents: 'common.winkGoWorkspace.fileCategories.documents',
  images: 'common.winkGoWorkspace.fileCategories.images',
  audio: 'common.winkGoWorkspace.fileCategories.audio',
  video: 'common.winkGoWorkspace.fileCategories.video',
  archives: 'common.winkGoWorkspace.fileCategories.archives',
  installers: 'common.winkGoWorkspace.fileCategories.installers',
  code: 'common.winkGoWorkspace.fileCategories.code',
  other: 'common.winkGoWorkspace.fileCategories.other',
};

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`;
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`;
};

const hasDroppedFileContent = (dataTransfer: DataTransfer): boolean => {
  const types = Array.from(dataTransfer.types);
  return (
    dataTransfer.files.length > 0 ||
    Array.from(dataTransfer.items).some((item) => item.kind === 'file') ||
    types.some((type) => /file|image|uri|download/i.test(type)) ||
    types.includes('text/html') ||
    types.includes('text/plain')
  );
};

const localPathFromDroppedText = (value: string): string => {
  const candidate = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (!candidate) return '';
  if (/^[a-z]:[\\/]/i.test(candidate) || candidate.startsWith('\\\\')) return candidate;
  if (!candidate.toLocaleLowerCase().startsWith('file:')) return '';
  try {
    const url = new URL(candidate);
    let pathname = decodeURIComponent(url.pathname);
    if (/^\/[a-z]:\//i.test(pathname)) pathname = pathname.slice(1);
    return pathname.replaceAll('/', '\\');
  } catch {
    return '';
  }
};

const resolveDroppedPaths = async (dataTransfer: DataTransfer): Promise<string[]> => {
  const getPathForFile = window.electronAPI?.getPathForFile;
  const persistDroppedFile = window.electronAPI?.persistDroppedFile;
  if (!getPathForFile) return [];

  // Capture everything synchronously before awaiting: Chromium may clear DataTransfer after the drop handler yields.
  const transferFiles = Array.from(dataTransfer.files);
  const droppedFiles =
    transferFiles.length > 0
      ? transferFiles
      : Array.from(dataTransfer.items)
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter((file): file is File => Boolean(file));
  const uriList = dataTransfer.getData('text/uri-list');
  const plainText = dataTransfer.getData('text/plain');
  const downloadUrl = dataTransfer.getData('DownloadURL');
  const html = dataTransfer.getData('text/html');
  const resolved: string[] = [];

  for (const file of droppedFiles) {
    let localPath = '';
    try {
      localPath = getPathForFile(file);
    } catch {
      localPath = '';
    }
    if (localPath) {
      resolved.push(localPath);
      continue;
    }
    if (!persistDroppedFile) continue;
    try {
      // WeChat exposes received images and documents as Windows virtual files.
      // Chromium may report `size === 0` until FileContents is requested, so do
      // not discard the file before attempting to read its lazy byte stream.
      const data = await file.arrayBuffer();
      if (data.byteLength === 0) continue;
      resolved.push(
        await persistDroppedFile({
          data,
          name: file.name || `微信图片_${Date.now()}`,
          type: file.type,
        })
      );
    } catch {
      // Fall through to URI/HTML recovery below.
    }
  }

  const directPath =
    localPathFromDroppedText(uriList) ||
    localPathFromDroppedText(plainText) ||
    localPathFromDroppedText(downloadUrl.split(':').slice(2).join(':'));
  if (directPath) resolved.push(directPath);

  if (resolved.length === 0 && persistDroppedFile && html) {
    const imageSource =
      new DOMParser().parseFromString(html, 'text/html').querySelector('img')?.getAttribute('src') || '';
    const htmlPath = localPathFromDroppedText(imageSource);
    if (htmlPath) {
      resolved.push(htmlPath);
    } else if (
      imageSource.startsWith('blob:') ||
      imageSource.startsWith('data:image/') ||
      /^https?:\/\//i.test(imageSource)
    ) {
      try {
        const blob = await fetch(imageSource).then((response) => response.blob());
        if (!blob.type.startsWith('image/')) throw new Error('DROPPED_CONTENT_IS_NOT_IMAGE');
        resolved.push(
          await persistDroppedFile({
            data: await blob.arrayBuffer(),
            name: `微信图片_${Date.now()}`,
            type: blob.type,
          })
        );
      } catch {
        // Unsupported virtual image source.
      }
    }
  }

  return [...new Set(resolved.filter(Boolean))].slice(0, 64);
};

const TitlebarDynamicIsland: React.FC<TitlebarDynamicIslandProps> = ({ floating = false }) => {
  const { t, i18n } = useTranslation();
  const routerNavigate = useNavigate();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const formatPresetsRef = useRef<HTMLDivElement | null>(null);
  const destinationDragRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);
  const suppressDestinationClickRef = useRef(false);
  const quickAppsTrackRef = useRef<HTMLDivElement | null>(null);
  const quickAppPressRef = useRef<{
    pointerId: number;
    path: string;
    startX: number;
    startY: number;
    element: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
    dragging: boolean;
  } | null>(null);
  const suppressQuickAppClickRef = useRef(false);
  const toolWheelRef = useRef<HTMLElement | null>(null);
  const toolWheelDeltaRef = useRef(0);
  const [draggingQuickAppPath, setDraggingQuickAppPath] = useState<string | null>(null);
  const [panel, setPanel] = useState<IslandPanel>(null);
  useAddEventListener(
    'dynamic-island.open-panel',
    (nextPanel) => {
      setPanel(nextPanel);
    },
    []
  );
  useEffect(() => {
    return window.electronAPI?.desktopIsland?.onOpenPanel?.((nextPanel) => setPanel(nextPanel));
  }, []);
  const [mediaView, setMediaView] = useState<MediaView>('controls');
  const [toolWheelIndex, setToolWheelIndex] = useState(0);
  const [categoryName, setCategoryName] = useState('');
  const [categoryFeedback, setCategoryFeedback] = useState<string | null>(null);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const displayedNotificationRef = useRef<string | null>(null);
  const completedActivityRef = useRef<string | null>(null);
  const displayedActivityRef = useRef<string | null>(null);
  const toastViewportRef = useRef<HTMLSpanElement | null>(null);
  const toastTextRef = useRef<HTMLSpanElement | null>(null);
  const [toastQueue, setToastQueue] = useState<IslandToast[]>([]);
  const [activeToast, setActiveToast] = useState<IslandToast | null>(null);
  const [toastTravel, setToastTravel] = useState(0);
  const [formatPreset, setFormatPreset] = useState<WinkGoFormatPreset>('ncm_to_mp3');
  const [formatEngines, setFormatEngines] = useState<WinkGoFormatEngineStatus>(EMPTY_FORMAT_ENGINES);
  const [formatFiles, setFormatFiles] = useState<string[]>([]);
  const [formatOutputFolder, setFormatOutputFolder] = useState('');
  const [formatBusy, setFormatBusy] = useState(false);
  const [formatProgress, setFormatProgress] = useState(0);
  const [formatFeedback, setFormatFeedback] = useState('选择转换类型，然后添加文件');
  const [mailDownloadBusy, setMailDownloadBusy] = useState(false);
  const [mailDownloadResult, setMailDownloadResult] = useState<WinkGoMailDownloadResult | null>(null);
  const [mailDownloadError, setMailDownloadError] = useState<string | null>(null);
  const [mailStatus, setMailStatus] = useState<WinkGoMailStatus | null>(null);
  const [mailStatusBusy, setMailStatusBusy] = useState(false);
  const [mailMessages, setMailMessages] = useState<WinkGoMailMessage[]>([]);
  const [mailListBusy, setMailListBusy] = useState(false);
  const [expandedMailUid, setExpandedMailUid] = useState<number | null>(null);
  const [mailPreviewBusyUid, setMailPreviewBusyUid] = useState<number | null>(null);
  const [mailPreviews, setMailPreviews] = useState<Record<number, WinkGoMailPreviewResult>>({});
  const mailPreviewRequestsRef = useRef(new Map<number, Promise<WinkGoMailPreviewResult>>());
  const [mailSaveBusyUid, setMailSaveBusyUid] = useState<number | null>(null);
  const [mailSavedResults, setMailSavedResults] = useState<Record<number, WinkGoMailDownloadResult>>({});
  const [mailSaveError, setMailSaveError] = useState<{ uid: number; message: string } | null>(null);
  const preferences = useWinkGoIslandFilePreferences();
  const jobs = useTitlebarCronSummary();
  const { activities, primaryActivity, publish } = useIslandActivityFeed(preferences.activityEnabled);
  const windowsRuntime = useIslandWindowsRuntime({
    mediaEnabled: preferences.mediaControllerEnabled,
    mediaTarget: preferences.mediaTarget,
    notificationCardsEnabled: preferences.wechatNotificationCardsEnabled,
    notificationEnabled: preferences.notificationReceiveEnabled,
    mailNotificationsEnabled: true,
  });
  const islandTools = useMemo(
    () => [
      {
        id: 'timer' as const,
        label: t('common.winkGoWorkspace.focusTimer'),
        hint: t('common.winkGoWorkspace.focusTimerHint'),
        icon: <AlarmClock theme='outline' size='21' fill='currentColor' strokeWidth={3} />,
      },
      {
        id: 'mail' as const,
        label: t('common.winkGoWorkspace.mailNotifications'),
        hint: t('common.winkGoWorkspace.mailToolHint'),
        icon: <Message theme='outline' size='21' fill='currentColor' strokeWidth={3} />,
      },
    ],
    [t]
  );
  const openMainRoute = useCallback(
    (route: string) => {
      if (floating && window.electronAPI?.desktopIsland) {
        void window.electronAPI.desktopIsland.navigateMain(route);
        return;
      }
      void routerNavigate(route);
    },
    [floating, routerNavigate]
  );
  const handleHorizontalWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    if (scroller.scrollWidth <= scroller.clientWidth) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (!delta) return;
    event.preventDefault();
    scroller.scrollLeft += delta;
  }, []);
  const cancelQuickAppPress = useCallback((releaseCapture = true) => {
    const press = quickAppPressRef.current;
    if (!press) return;
    clearTimeout(press.timer);
    if (releaseCapture && press.element.hasPointerCapture?.(press.pointerId)) {
      press.element.releasePointerCapture(press.pointerId);
    }
    quickAppPressRef.current = null;
    setDraggingQuickAppPath(null);
  }, []);
  const handleQuickAppPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, appPath: string) => {
      if (event.button !== 0 || (event.target as HTMLElement).closest('.titlebar-dynamic-island__quick-app-remove')) {
        return;
      }
      cancelQuickAppPress();
      suppressQuickAppClickRef.current = false;
      const element = event.currentTarget;
      const press = {
        pointerId: event.pointerId,
        path: appPath,
        startX: event.clientX,
        startY: event.clientY,
        element,
        timer: 0 as unknown as ReturnType<typeof setTimeout>,
        dragging: false,
      };
      press.timer = setTimeout(() => {
        if (quickAppPressRef.current !== press) return;
        press.dragging = true;
        suppressQuickAppClickRef.current = true;
        element.setPointerCapture?.(press.pointerId);
        setDraggingQuickAppPath(press.path);
      }, QUICK_APP_LONG_PRESS_MS);
      quickAppPressRef.current = press;
    },
    [cancelQuickAppPress]
  );
  const handleQuickAppPointerEnd = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const press = quickAppPressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      const wasDragging = press.dragging;
      cancelQuickAppPress();
      if (wasDragging) suppressQuickAppClickRef.current = true;
    },
    [cancelQuickAppPress]
  );
  const handleDestinationPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    destinationDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft,
      moved: false,
    };
    suppressDestinationClickRef.current = false;
  }, []);
  const handleDestinationPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = destinationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(distance) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = 'true';
    }
    event.preventDefault();
    event.currentTarget.scrollLeft = drag.startScrollLeft - distance;
  }, []);
  const finishDestinationPointerDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = destinationDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressDestinationClickRef.current = drag.moved;
    destinationDragRef.current = null;
    delete event.currentTarget.dataset.dragging;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    window.setTimeout(() => {
      suppressDestinationClickRef.current = false;
    }, 0);
  }, []);
  const handleDestinationClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressDestinationClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressDestinationClickRef.current = false;
  }, []);
  useEffect(
    () =>
      ipcBridge.winkGoFormat.progress.on((progress) => {
        setFormatProgress((current) => Math.max(current, Math.min(100, progress.percent)));
        setFormatFeedback(`${progress.fileName} · ${progress.message}`);
        publish({
          id: `format:${progress.jobId}:${progress.index}`,
          source: '格式台',
          kind: 'tool',
          status: progress.status === 'completed' ? 'success' : progress.status === 'failed' ? 'error' : 'running',
          title:
            progress.status === 'running'
              ? `${progress.fileName} · ${progress.percent}%`
              : `${progress.fileName} · ${progress.message}`,
          timestamp: Date.now(),
        });
      }),
    [publish]
  );
  useEffect(() => {
    if (!floating) return undefined;
    let cancelled = false;
    void Promise.all([
      ipcBridge.winkGoFormat.detectEngines.invoke(),
      ipcBridge.winkGoFormat.getDefaultOutputFolder.invoke(),
    ])
      .then(([engines, defaultFolder]) => {
        if (cancelled) return;
        setFormatEngines(engines);
        setFormatOutputFolder(window.localStorage.getItem('winkgo_format_output_folder') || defaultFolder);
      })
      .catch((): void => undefined);
    return () => {
      cancelled = true;
    };
  }, [floating]);
  const handleFileCommand = useCallback(
    (command: 'openMemo' | 'openShelf' | 'newCategory' | 'openFormat' | 'openApps') => {
      if (command === 'openMemo') {
        setPanel(null);
        openMainRoute('/scheduled');
        return;
      }
      if (command === 'openFormat') {
        setPanel('format');
        return;
      }
      if (command === 'openApps') {
        setPanel((current) => (current === 'apps' ? null : 'apps'));
        return;
      }
      setPanel(command === 'openShelf' ? 'files' : 'category');
    },
    [openMainRoute]
  );
  const organizer = useIslandFileOrganizer({
    enabled: preferences.organizerEnabled,
    onCommand: handleFileCommand,
  });
  const reorderQuickApp = organizer.reorderQuickApp;
  const handleQuickAppPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const press = quickAppPressRef.current;
      if (!press || press.pointerId !== event.pointerId) return;
      if (!press.dragging) {
        if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) >= QUICK_APP_PRESS_CANCEL_DISTANCE) {
          cancelQuickAppPress(false);
        }
        return;
      }
      event.preventDefault();
      const cards = Array.from(quickAppsTrackRef.current?.querySelectorAll<HTMLElement>('[data-quick-app-path]') ?? []);
      const target = cards.reduce<HTMLElement | null>((closest, card) => {
        const rect = card.getBoundingClientRect();
        const distance = Math.abs(event.clientX - (rect.left + rect.width / 2));
        if (!closest) return card;
        const closestRect = closest.getBoundingClientRect();
        const closestDistance = Math.abs(event.clientX - (closestRect.left + closestRect.width / 2));
        return distance < closestDistance ? card : closest;
      }, null);
      const targetPath = target?.dataset.quickAppPath;
      if (targetPath && targetPath !== press.path) reorderQuickApp(press.path, targetPath);
    },
    [cancelQuickAppPress, reorderQuickApp]
  );
  const nativeDropPanelRef = useRef<IslandPanel>(panel);
  const nativeStagePathsRef = useRef(organizer.stagePaths);
  nativeDropPanelRef.current = panel;
  nativeStagePathsRef.current = organizer.stagePaths;

  useEffect(() => {
    if (!floating || !preferences.organizerEnabled) return undefined;
    const subscribe = window.electronAPI?.onNativeFileDrop;
    if (!subscribe) return undefined;
    let leaveTimer: number | undefined;
    const cancelPendingLeave = () => {
      if (leaveTimer === undefined) return;
      window.clearTimeout(leaveTimer);
      leaveTimer = undefined;
    };
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'enter') {
        cancelPendingLeave();
        void window.electronAPI?.desktopIsland?.setFileDragActive?.(true);
        setIsFileDragActive(true);
        if (nativeDropPanelRef.current !== 'format') setPanel('drop');
        return;
      }
      if (event.kind === 'over') {
        cancelPendingLeave();
        void window.electronAPI?.desktopIsland?.setFileDragActive?.(true);
        setIsFileDragActive(true);
        return;
      }
      if (event.kind === 'leave') {
        cancelPendingLeave();
        // Transparent frameless windows can emit a short leave/over pair while
        // their drop panel grows. Delay the collapse so that resize noise does
        // not make the island bounce under the cursor.
        leaveTimer = window.setTimeout(() => {
          leaveTimer = undefined;
          void window.electronAPI?.desktopIsland?.setFileDragActive?.(false);
          setIsFileDragActive(false);
          setPanel((current) => (current === 'drop' ? null : current));
        }, 140);
        return;
      }

      cancelPendingLeave();
      void window.electronAPI?.desktopIsland?.setFileDragActive?.(false);
      setIsFileDragActive(false);
      const paths = event.paths.filter(Boolean).slice(0, 64);
      if (paths.length === 0) {
        setPanel(null);
        setToastQueue((current) => [
          ...current,
          {
            id: `native-drop-error:${Date.now()}`,
            source: '文件收纳',
            text: '微信文件接收失败，请重新拖入',
          },
        ]);
        return;
      }
      if (nativeDropPanelRef.current === 'format') {
        setFormatFiles(paths);
        setFormatProgress(0);
        setFormatFeedback(`已加入 ${paths.length} 个文件，点击开始转换`);
        return;
      }
      void nativeStagePathsRef.current(paths).then((accepted) => {
        if (accepted) setPanel('destination');
      });
    });
    return () => {
      cancelPendingLeave();
      unsubscribe();
    };
  }, [floating, preferences.organizerEnabled]);
  const timer = useIslandFocusTimer(
    useCallback(() => {
      const timestamp = Date.now();
      publish({
        id: `focus-completed:${timestamp}`,
        source: 'WINK GO',
        kind: 'system',
        status: 'success',
        title: t('common.winkGoWorkspace.focusCompleted'),
        timestamp,
      });
      void ipcBridge.notification.show
        .invoke({
          title: t('common.winkGoWorkspace.focusTimer'),
          body: t('common.winkGoWorkspace.focusCompletedBody'),
        })
        .catch((_error: unknown): undefined => undefined);
    }, [publish, t])
  );

  const activeJobs = useMemo(() => jobs.filter((job) => job.enabled), [jobs]);
  const hasCronError = useMemo(
    () => jobs.some((job) => job.state.last_status === 'error' || job.state.last_status === 'missed'),
    [jobs]
  );
  const nextJob = useMemo(() => getNextJob(activeJobs), [activeJobs]);
  const nextRunAt = nextJob?.state.next_run_at_ms ?? null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!nextRunAt) return undefined;
    let cancelled = false;
    let timerId = 0;
    const updateNow = () => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (cancelled) return;
      const remaining = nextRunAt - currentTime;
      const delay = remaining > 120_000 ? 15_000 : remaining > 60_000 ? 5_000 : 1_000;
      timerId = window.setTimeout(updateNow, delay);
    };
    updateNow();
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [nextRunAt]);

  useEffect(() => {
    if (!panel) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setPanel(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [panel]);

  useEffect(() => {
    if (panel !== 'media') setMediaView('controls');
  }, [panel]);

  useEffect(() => {
    if (!floating) return undefined;
    const bridge = window.electronAPI?.desktopIsland;
    if (!bridge) return undefined;

    const basePlanned =
      panel === 'media' && mediaView === 'lyrics'
        ? { width: 620, height: 330 }
        : floatingWindowSizes[panel || 'collapsed'];
    const toastDisplayText = getIslandToastDisplayText(activeToast);
    const planned =
      panel === 'toast' && activeToast ? { width: toastDisplayText.length > 16 ? 460 : 300, height: 44 } : basePlanned;
    void bridge.setSize(planned);

    if (!panel || panel === 'toast') return undefined;

    let frame = 0;
    let setupFrame = 0;
    let observer: ResizeObserver | undefined;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const panelElement = containerRef.current?.querySelector<HTMLElement>('.titlebar-dynamic-island__panel');
        if (!panelElement) return;
        const panelBounds = panelElement.getBoundingClientRect();
        const measuredHeight = calculateFloatingIslandHeight(planned.height, panelBounds.bottom);
        void bridge.setSize({ width: planned.width, height: measuredHeight });
      });
    };

    setupFrame = window.requestAnimationFrame(() => {
      const panelElement = containerRef.current?.querySelector<HTMLElement>('.titlebar-dynamic-island__panel');
      measure();
      if (panelElement && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(panelElement);
      }
    });

    return () => {
      window.cancelAnimationFrame(setupFrame);
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [activeToast, floating, mediaView, panel]);

  useEffect(() => {
    if (!floating) return;
    void window.electronAPI?.desktopIsland?.applySettings?.({
      autoHideFullscreen: preferences.autoHideFullscreen,
      opacity: preferences.opacity,
      visible: preferences.islandVisible,
    });
  }, [floating, preferences.autoHideFullscreen, preferences.islandVisible, preferences.opacity]);

  useEffect(() => {
    if (!preferences.interactionSoundEnabled || !primaryActivity) return;
    if (primaryActivity.status !== 'success' && primaryActivity.status !== 'error') return;
    const completionKey = `${primaryActivity.id}:${primaryActivity.status}:${primaryActivity.timestamp}`;
    if (completedActivityRef.current === completionKey) return;
    completedActivityRef.current = completionKey;
    playWinkGoInteractionSound('complete');
  }, [preferences.interactionSoundEnabled, primaryActivity]);

  useEffect(() => {
    if (!floating) return;
    const notification = windowsRuntime.notification;
    if (!notification || displayedNotificationRef.current === notification.id) return;
    displayedNotificationRef.current = notification.id;
    const identity = resolveNotificationIdentity(notification);
    const detail =
      windowsRuntime.privacyMode || !notification.body
        ? notification.title
        : `${notification.title} · ${notification.body}`;
    const appName = notification.mail ? t('common.winkGoWorkspace.mailNotifications') : notification.appName;
    setToastQueue((current) => [
      ...current,
      {
        id: `notification:${notification.id}`,
        source: identity.source,
        text: `${appName} · ${detail}`,
      },
    ]);
  }, [floating, t, windowsRuntime.notification, windowsRuntime.privacyMode]);

  useEffect(() => {
    setMailDownloadBusy(false);
    setMailDownloadResult(null);
    setMailDownloadError(null);
  }, [windowsRuntime.notification?.id]);

  useEffect(() => {
    if (!floating || !primaryActivity) return;
    const eventKey = `${primaryActivity.id}:${primaryActivity.status}`;
    if (displayedActivityRef.current === eventKey) return;
    displayedActivityRef.current = eventKey;
    const identity = resolveIslandDynamicIdentity({
      activity: primaryActivity,
      media: null,
      notification: null,
    });
    const nextToast: IslandToast = {
      id: `activity:${eventKey}:${primaryActivity.timestamp}`,
      activityId: primaryActivity.id,
      source: identity.source,
      text: `${primaryActivity.source} · ${t(activityStatusKey[primaryActivity.status])} · ${primaryActivity.title}`,
    };
    if (activeToast?.activityId === primaryActivity.id) {
      setActiveToast(nextToast);
      setToastQueue((current) => current.filter((toast) => toast.activityId !== primaryActivity.id));
      return;
    }
    setToastQueue((current) => [...current.filter((toast) => toast.activityId !== primaryActivity.id), nextToast]);
  }, [activeToast?.activityId, floating, primaryActivity, t]);

  useEffect(() => {
    if (!floating || activeToast || toastQueue.length === 0) return undefined;
    if (panel && panel !== 'toast') return undefined;
    const [nextToast, ...remaining] = toastQueue;
    setToastQueue(remaining);
    setActiveToast(nextToast);
    setPanel('toast');
    return undefined;
  }, [activeToast, floating, panel, toastQueue]);

  useEffect(() => {
    if (!activeToast) return undefined;
    const displayText = getIslandToastDisplayText(activeToast);
    const needsMarquee = toastTravel > 4;
    const animationSeconds = Math.max(5, Math.min(14, 3.2 + toastTravel / 22));
    const duration = needsMarquee
      ? Math.ceil((animationSeconds + 0.45) * 1_000)
      : displayText.length > 16
        ? 3_600
        : 2_600;
    const timerId = window.setTimeout(() => {
      setActiveToast(null);
      setPanel((current) => (current === 'toast' ? null : current));
    }, duration);
    return () => window.clearTimeout(timerId);
  }, [activeToast, toastTravel]);

  useEffect(() => {
    setToastTravel(0);
    if (!activeToast) return undefined;

    let frame = 0;
    const measure = () => {
      const viewport = toastViewportRef.current;
      const text = toastTextRef.current;
      if (!viewport || !text) return;
      setToastTravel(Math.max(0, Math.ceil(text.scrollWidth - viewport.clientWidth + 6)));
    };
    frame = window.requestAnimationFrame(measure);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(measure);
          });
    if (toastViewportRef.current) observer?.observe(toastViewportRef.current);
    if (toastTextRef.current) observer?.observe(toastTextRef.current);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [activeToast]);

  const loadMailMessages = useCallback(async (showLoading = true) => {
    const listMessages = ipcBridge.winkGoMail.listMessages?.invoke;
    if (!listMessages) return;
    if (showLoading) setMailListBusy(true);
    try {
      setMailMessages(await listMessages({ limit: 16 }));
    } catch {
      // Connection state and actionable errors are already exposed by mailStatus.
    } finally {
      if (showLoading) setMailListBusy(false);
    }
  }, []);

  const requestMailPreview = useCallback((uid: number): Promise<WinkGoMailPreviewResult> => {
    const pendingRequest = mailPreviewRequestsRef.current.get(uid);
    if (pendingRequest) return pendingRequest;

    const request = ipcBridge.winkGoMail.previewMessage
      .invoke({ uid })
      .catch(
        (): WinkGoMailPreviewResult => ({
          ok: false,
          attachmentNames: [],
          errorCode: 'download_failed',
        })
      )
      .finally(() => mailPreviewRequestsRef.current.delete(uid));
    mailPreviewRequestsRef.current.set(uid, request);
    return request;
  }, []);

  useEffect(() => {
    const getStatus = ipcBridge.winkGoMail.getStatus?.invoke;
    const onStatusChanged = ipcBridge.winkGoMail.statusChanged?.on;
    if (!getStatus) return undefined;

    let disposed = false;
    void getStatus()
      .then((status) => {
        if (!disposed) setMailStatus(status);
      })
      .catch((): void => undefined);
    const unsubscribe = onStatusChanged?.((status) => {
      if (!disposed) {
        setMailStatus(status);
        if (!status.account) setMailMessages([]);
      }
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const notification = windowsRuntime.notification;
    const mail = notification?.mail;
    if (!notification || !mail) return;
    const message: WinkGoMailMessage = {
      id: notification.id,
      uid: mail.uid,
      accountEmail: mail.accountEmail,
      senderName: notification.title,
      senderAddress: '',
      subject: notification.body,
      receivedAt: notification.createdAt,
      hasAttachments: mail.hasAttachments,
      attachmentCount: mail.attachmentCount,
      isUnread: true,
    };
    setMailMessages((current) => [message, ...current.filter((item) => item.uid !== message.uid)].slice(0, 16));
  }, [windowsRuntime.notification]);

  useEffect(() => {
    if (panel === 'mail') void loadMailMessages();
  }, [loadMailMessages, panel]);

  useEffect(() => {
    if (panel !== 'mail' || mailMessages.length === 0) return undefined;
    let disposed = false;
    const candidates = mailMessages
      .filter((message) => isLikelyVerificationMail(message))
      .filter((message) => !mailPreviews[message.uid] && !extractMailVerificationCode(message.subject))
      .slice(0, 8);

    void candidates.reduce<Promise<void>>(
      (queue, message) =>
        queue.then(async () => {
          if (disposed) return;
          const result = await requestMailPreview(message.uid);
          if (!disposed) setMailPreviews((current) => ({ ...current, [message.uid]: result }));
        }),
      Promise.resolve()
    );
    return () => {
      disposed = true;
    };
    // Preview changes should not restart the queue; new message lists do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailMessages, panel, requestMailPreview]);

  useEffect(() => {
    if (panel !== 'tools') return;
    const frame = window.requestAnimationFrame(() => toolWheelRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [panel]);

  const cronSummary = useMemo(() => {
    if (hasCronError) return t('common.winkGoWorkspace.taskNeedsAttention');
    if (nextJob && nextRunAt) {
      const relativeTime = formatRelativeTime(nextRunAt, now, i18n.resolvedLanguage || i18n.language || 'en-US');
      return `${nextJob.name} · ${relativeTime}`;
    }
    if (activeJobs.length > 0) {
      return t('common.winkGoWorkspace.activeTasks', { count: activeJobs.length });
    }
    return t('common.winkGoWorkspace.ready');
  }, [activeJobs.length, hasCronError, i18n.language, i18n.resolvedLanguage, nextJob, nextRunAt, now, t]);

  const downloadCurrentMail = useCallback(async () => {
    const mail = windowsRuntime.notification?.mail;
    if (!mail || mailDownloadBusy) return;
    setMailDownloadBusy(true);
    setMailDownloadError(null);
    try {
      const result = await ipcBridge.winkGoMail.downloadMessage.invoke({ uid: mail.uid });
      setMailDownloadResult(result.ok ? result : null);
      if (!result.ok) {
        setMailDownloadError(t(`settings.imap.errors.${result.errorCode || 'download_failed'}`));
      }
    } catch {
      setMailDownloadResult(null);
      setMailDownloadError(t('settings.imap.errors.download_failed'));
    } finally {
      setMailDownloadBusy(false);
    }
  }, [mailDownloadBusy, t, windowsRuntime.notification?.mail]);

  const revealDownloadedMail = useCallback(() => {
    const path = mailDownloadResult?.bodyPath || mailDownloadResult?.directory;
    if (path) void ipcBridge.winkGoFiles.showItemInFolder.invoke({ path });
  }, [mailDownloadResult]);

  const saveMailMessage = useCallback(
    async (message: WinkGoMailMessage) => {
      if (mailSaveBusyUid !== null) return;
      setMailSaveBusyUid(message.uid);
      setMailSaveError(null);
      try {
        const result = await ipcBridge.winkGoMail.downloadMessage.invoke({ uid: message.uid });
        if (!result.ok) {
          setMailSaveError({
            uid: message.uid,
            message: t(`settings.imap.errors.${result.errorCode || 'download_failed'}`),
          });
          return;
        }
        setMailSavedResults((current) => ({ ...current, [message.uid]: result }));
      } catch {
        setMailSaveError({ uid: message.uid, message: t('settings.imap.errors.download_failed') });
      } finally {
        setMailSaveBusyUid(null);
      }
    },
    [mailSaveBusyUid, t]
  );

  const toggleMailMessage = useCallback(
    async (message: WinkGoMailMessage) => {
      if (expandedMailUid === message.uid) {
        setExpandedMailUid(null);
        return;
      }
      setExpandedMailUid(message.uid);
      if (mailPreviews[message.uid] || mailPreviewBusyUid === message.uid) return;

      setMailPreviewBusyUid(message.uid);
      try {
        const result = await requestMailPreview(message.uid);
        setMailPreviews((current) => ({ ...current, [message.uid]: result }));
      } finally {
        setMailPreviewBusyUid(null);
      }
    },
    [expandedMailUid, mailPreviewBusyUid, mailPreviews, requestMailPreview]
  );

  const revealSavedMail = useCallback(
    (uid: number) => {
      const result = mailSavedResults[uid];
      const path = result?.bodyPath || result?.directory;
      if (path) void ipcBridge.winkGoFiles.showItemInFolder.invoke({ path });
    },
    [mailSavedResults]
  );

  const summary = useMemo(() => {
    if (organizer.busy) {
      return t('common.winkGoWorkspace.organizingFiles', { count: organizer.pendingPaths.length });
    }
    if (isFileDragActive) {
      return t('common.winkGoWorkspace.dropFilesHere');
    }
    if (windowsRuntime.notification) {
      const appName = windowsRuntime.notification.mail
        ? t('common.winkGoWorkspace.mailNotifications')
        : windowsRuntime.notification.appName;
      return `${appName} · ${windowsRuntime.notification.title}`;
    }
    if (windowsRuntime.media) {
      return `${windowsRuntime.media.title}${windowsRuntime.media.artist ? ` · ${windowsRuntime.media.artist}` : ''}`;
    }
    if (primaryActivity) {
      return `${primaryActivity.source} · ${t(activityStatusKey[primaryActivity.status])} · ${primaryActivity.title}`;
    }
    if (timer.running) {
      return t('common.winkGoWorkspace.focusRunning', { time: timer.formattedRemaining });
    }
    return cronSummary;
  }, [
    cronSummary,
    isFileDragActive,
    organizer.busy,
    organizer.pendingPaths.length,
    primaryActivity,
    t,
    timer.formattedRemaining,
    timer.running,
    windowsRuntime.media,
    windowsRuntime.notification,
  ]);
  const visibleSummary = floating ? summary.replace(/^(?:WINK GO|WINK GO)(?:\s*[·•-]\s*|\s+)/i, '') : summary;
  const capsuleLabel = floating ? `WINK GO ${visibleSummary}`.trim() : summary;
  const dynamicIdentity = useMemo(
    () =>
      resolveIslandDynamicIdentity({
        activity: primaryActivity ?? null,
        media: windowsRuntime.media,
        notification: windowsRuntime.notification,
      }),
    [primaryActivity, windowsRuntime.media, windowsRuntime.notification]
  );
  const notificationIdentity = useMemo(
    () => (windowsRuntime.notification ? resolveNotificationIdentity(windowsRuntime.notification) : null),
    [windowsRuntime.notification]
  );
  const mediaIdentity = useMemo(
    () => (windowsRuntime.media ? resolveMediaIdentity(windowsRuntime.media) : null),
    [windowsRuntime.media]
  );
  const isDynamicIdentityPlaying =
    Boolean(windowsRuntime.media?.isPlaying) &&
    (dynamicIdentity.kind === 'media-cover' || dynamicIdentity.kind === 'media-app');

  const hasError = hasCronError || primaryActivity?.status === 'error' || organizer.status.type === 'error';
  const isActive =
    timer.running ||
    organizer.busy ||
    isFileDragActive ||
    activeJobs.length > 0 ||
    Boolean(primaryActivity) ||
    Boolean(windowsRuntime.notification) ||
    Boolean(windowsRuntime.media?.isPlaying);
  const openScheduledTasks = () => {
    setPanel(null);
    openMainRoute('/scheduled');
  };

  const toggleActivityPanel = () => {
    const contextualPanel = windowsRuntime.notification ? 'notification' : windowsRuntime.media ? 'media' : 'activity';
    setPanel((current) => (current === contextualPanel ? null : contextualPanel));
  };
  const toggleToolWheel = () => {
    toolWheelDeltaRef.current = 0;
    setPanel((current) => (current === 'tools' ? null : 'tools'));
  };

  const openIslandTool = useCallback((tool: (typeof islandTools)[number]['id']) => {
    setPanel(tool);
  }, []);

  const selectNextIslandTool = useCallback(
    (direction: 1 | -1) => {
      setToolWheelIndex((current) => (current + direction + islandTools.length) % islandTools.length);
    },
    [islandTools.length]
  );

  const handleToolWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      toolWheelDeltaRef.current += delta;
      if (Math.abs(toolWheelDeltaRef.current) < 24) return;
      selectNextIslandTool(toolWheelDeltaRef.current > 0 ? 1 : -1);
      toolWheelDeltaRef.current = 0;
    },
    [selectNextIslandTool]
  );

  const handleToolWheelKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPanel(null);
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault();
        selectNextIslandTool(1);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault();
        selectNextIslandTool(-1);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const selected = islandTools[toolWheelIndex];
        if (selected) openIslandTool(selected.id);
      }
    },
    [islandTools, openIslandTool, selectNextIslandTool, toolWheelIndex]
  );

  const checkMailNow = useCallback(async () => {
    if (mailStatusBusy) return;
    setMailStatusBusy(true);
    try {
      setMailStatus(await ipcBridge.winkGoMail.checkNow.invoke());
      await loadMailMessages(false);
    } finally {
      setMailStatusBusy(false);
    }
  }, [loadMailMessages, mailStatusBusy]);

  const chooseFilesForOrganizer = async () => {
    const paths = await organizer.chooseFiles();
    if (paths.length > 0) setPanel('destination');
  };

  const confirmFileDestination = async (manualClassification?: string) => {
    const pendingCount = organizer.pendingPaths.length;
    const organized = await organizer.organizePending(manualClassification);
    const timestamp = Date.now();
    publish({
      id: `file-organizer:${timestamp}`,
      source: 'WINK GO',
      kind: 'tool',
      status: organized ? 'success' : 'error',
      title: organized
        ? t('common.winkGoWorkspace.organizedFiles', { count: pendingCount })
        : t('common.winkGoWorkspace.organizerFailed'),
      timestamp,
    });
    setPanel('files');
  };

  const undoLastFileBatch = async () => {
    const restored = await organizer.undoLastBatch();
    const timestamp = Date.now();
    publish({
      id: `file-organizer-undo:${timestamp}`,
      source: 'WINK GO',
      kind: 'tool',
      status: restored ? 'success' : 'error',
      title: restored
        ? t('common.winkGoWorkspace.restoredFiles', { count: organizer.lastBatch.length })
        : t('common.winkGoWorkspace.organizerFailed'),
      timestamp,
    });
  };

  const saveCategory = () => {
    const result = organizer.addCategory(categoryName);
    setCategoryFeedback(`common.winkGoWorkspace.categoryFeedback.${result}`);
    if (result === 'added') {
      setCategoryName('');
      if (organizer.pendingPaths.length > 0) setPanel('destination');
    }
  };

  const formatPresetAvailable = useCallback(
    (preset: IslandFormatPreset): boolean => {
      if (preset.engine === 'builtin') return formatEngines.ncmAvailable;
      if (preset.engine === 'ffmpeg') return formatEngines.ffmpegAvailable;
      return formatEngines.officeAvailable;
    },
    [formatEngines]
  );

  const chooseIslandFormatFiles = async () => {
    const selected = await ipcBridge.winkGoFormat.selectFiles.invoke({ preset: formatPreset });
    if (selected.length === 0) return;
    setFormatFiles(selected.slice(0, 64));
    setFormatProgress(0);
    setFormatFeedback(`已加入 ${selected.length} 个文件，点击开始转换`);
  };

  const chooseIslandFormatOutput = async () => {
    const selected = await ipcBridge.winkGoFormat.chooseOutputFolder.invoke({
      defaultPath: formatOutputFolder || undefined,
    });
    if (!selected) return;
    setFormatOutputFolder(selected);
    window.localStorage.setItem('winkgo_format_output_folder', selected);
    setFormatFeedback(`输出到 ${selected.split(/[\\/]/).pop() || selected}`);
  };

  const startIslandFormatConversion = async () => {
    if (formatBusy || formatFiles.length === 0 || !formatOutputFolder) return;
    setFormatBusy(true);
    setFormatProgress(4);
    setFormatFeedback('任务已开始，文件只在本机处理');
    try {
      const report = await ipcBridge.winkGoFormat.startConversion.invoke({
        jobId: `island-format-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        preset: formatPreset,
        paths: [...formatFiles],
        outputFolder: formatOutputFolder,
      });
      const successful = report.items.filter((item) => item.success);
      const failed = report.items.filter((item) => !item.success);
      setFormatProgress(100);
      setFormatFiles(failed.map((item) => item.sourcePath));
      setFormatFeedback(
        successful.length
          ? `已完成 ${successful.length} 个${failed.length ? `，${failed.length} 个失败` : ''}`
          : failed[0]?.message || report.error || '转换失败，请重新选择文件'
      );
    } catch (error) {
      setFormatFeedback(`转换任务无法启动 · ${String(error)}`);
    } finally {
      setFormatBusy(false);
    }
  };

  const handleFileDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!preferences.organizerEnabled) return;
    if (!hasDroppedFileContent(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    void window.electronAPI?.desktopIsland?.setFileDragActive?.(true);
    setIsFileDragActive(true);
    if (panel === 'format') return;
    setPanel('drop');
  };

  const handleFileDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!preferences.organizerEnabled) return;
    if (!hasDroppedFileContent(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    void window.electronAPI?.desktopIsland?.setFileDragActive?.(true);
    event.dataTransfer.dropEffect = 'move';
  };

  const handleFileDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && containerRef.current?.contains(nextTarget)) return;
    void window.electronAPI?.desktopIsland?.setFileDragActive?.(false);
    setIsFileDragActive(false);
    setPanel((current) => (current === 'drop' ? null : current));
  };

  const handleFileDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (!preferences.organizerEnabled) return;
    event.preventDefault();
    event.stopPropagation();
    void window.electronAPI?.desktopIsland?.setFileDragActive?.(false);
    setIsFileDragActive(false);
    const paths = await resolveDroppedPaths(event.dataTransfer);
    if (paths.length === 0) {
      setPanel(null);
      return;
    }
    if (panel === 'format') {
      setFormatFiles(paths.slice(0, 64));
      setFormatProgress(0);
      setFormatFeedback(`已加入 ${paths.length} 个文件，点击开始转换`);
      return;
    }
    if (await organizer.stagePaths(paths)) setPanel('destination');
  };

  const fileCategoryLabel = (file: IslandRecentFile): string =>
    t(fileCategoryKey[file.category] || 'common.winkGoWorkspace.fileCategories.other');

  const panelTitle =
    panel === 'timer'
      ? t('common.winkGoWorkspace.focusTimer')
      : panel === 'mail'
        ? t('common.winkGoWorkspace.mailNotifications')
        : panel === 'browserComputerUse'
          ? t('common.browserComputerUse.title', { defaultValue: 'WINK GO 浏览器 Computer Use' })
          : panel === 'desktopComputerUse'
            ? t('common.desktopComputerUse.title', { defaultValue: '桌面 Computer Use' })
            : panel === 'media'
              ? mediaView === 'lyrics'
                ? t('common.winkGoWorkspace.lyrics')
                : t('common.winkGoWorkspace.mediaControl')
              : panel === 'notification'
                ? windowsRuntime.notification?.mail
                  ? t('common.winkGoWorkspace.mailNotifications')
                  : t('common.winkGoWorkspace.wechatNotifications')
                : panel === 'files'
                  ? t('common.winkGoWorkspace.fileShelf')
                  : panel === 'apps'
                    ? t('common.winkGoWorkspace.quickAppsTitle')
                    : panel === 'category'
                      ? t('common.winkGoWorkspace.newCategory')
                      : panel === 'destination'
                        ? t('common.winkGoWorkspace.chooseDestination')
                        : panel === 'drop'
                          ? t('common.winkGoWorkspace.dropFilesHere')
                          : panel === 'format'
                            ? '格式快转'
                            : t('common.winkGoWorkspace.realtimeActivity');
  const panelHint =
    panel === 'timer'
      ? t('common.winkGoWorkspace.focusTimerHint')
      : panel === 'mail'
        ? mailStatus?.account?.email
          ? t('common.winkGoWorkspace.mailPanelHint', { account: mailStatus.account.email })
          : t('common.winkGoWorkspace.mailNotConfigured')
        : panel === 'browserComputerUse'
          ? t('common.browserComputerUse.hint', { defaultValue: '使用模型操作软件内置浏览器' })
          : panel === 'desktopComputerUse'
            ? t('common.desktopComputerUse.hint', { defaultValue: '使用视觉模型操作 Windows 软件' })
            : panel === 'media'
              ? mediaView === 'lyrics'
                ? t('common.winkGoWorkspace.lyricsHint')
                : t('common.winkGoWorkspace.mediaControlHint')
              : panel === 'notification'
                ? windowsRuntime.notification?.mail
                  ? t('common.winkGoWorkspace.mailNotificationsHint', {
                      account: windowsRuntime.notification.mail.accountEmail,
                    })
                  : t('common.winkGoWorkspace.wechatNotificationsHint')
                : panel === 'files'
                  ? t('common.winkGoWorkspace.fileShelfHint')
                  : panel === 'apps'
                    ? t('common.winkGoWorkspace.quickAppsHint')
                    : panel === 'category'
                      ? t('common.winkGoWorkspace.categoryHint')
                      : panel === 'destination'
                        ? t('common.winkGoWorkspace.chooseDestinationHint', { count: organizer.pendingPaths.length })
                        : panel === 'drop'
                          ? t('common.winkGoWorkspace.chooseDestinationHint', { count: 1 })
                          : panel === 'format'
                            ? 'Alt + 4 · 本机快速转换'
                            : t('common.winkGoWorkspace.activityHint');
  const quickAppStatusText =
    organizer.quickAppStatus.type === 'error'
      ? organizer.quickAppStatus.code === 'not_found'
        ? t('common.winkGoWorkspace.quickAppMissing')
        : organizer.quickAppStatus.code === 'unsupported' || organizer.quickAppStatus.code === 'invalid_path'
          ? t('common.winkGoWorkspace.quickAppUnsupported')
          : organizer.quickAppStatus.code === 'limit'
            ? t('common.winkGoWorkspace.quickAppsLimit', { count: 18 })
            : organizer.quickAppStatus.code === 'select_failed'
              ? t('common.winkGoWorkspace.quickAppAddFailed')
              : t('common.winkGoWorkspace.quickAppOpenFailed')
      : '';
  const expandedMailMessage =
    expandedMailUid === null ? null : mailMessages.find((message) => message.uid === expandedMailUid) || null;
  const expandedMailPreview = expandedMailMessage ? mailPreviews[expandedMailMessage.uid] : undefined;

  return (
    <div
      ref={containerRef}
      className={`titlebar-dynamic-island${floating ? ' titlebar-dynamic-island--floating' : ''}`}
      data-testid='titlebar-dynamic-island'
      data-floating={floating ? 'true' : 'false'}
      data-status={hasError ? 'error' : isActive ? 'active' : 'idle'}
      data-expanded={panel ? 'true' : 'false'}
      data-panel={panel || 'none'}
      data-media-view={mediaView}
      data-island-theme={preferences.islandTheme}
      data-identity-kind={dynamicIdentity.kind}
      data-identity-label={dynamicIdentity.label}
      data-file-dragging={isFileDragActive ? 'true' : 'false'}
      style={floating ? { opacity: preferences.opacity / 100 } : undefined}
      onClickCapture={(event) => {
        if (!preferences.interactionSoundEnabled) return;
        if ((event.target as HTMLElement).closest('button')) playWinkGoInteractionSound('click');
      }}
      onDragEnter={handleFileDragEnter}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      <Button
        type='text'
        className='titlebar-dynamic-island__capsule'
        aria-label={capsuleLabel}
        title={capsuleLabel}
        aria-expanded={panel === 'activity' || panel === 'media' || panel === 'notification'}
        onClick={toggleActivityPanel}
      >
        <span
          className={`titlebar-dynamic-island__brand titlebar-dynamic-island__brand--${dynamicIdentity.kind}${
            isDynamicIdentityPlaying ? ' titlebar-dynamic-island__brand--playing' : ''
          }`}
          aria-hidden='true'
        >
          <StableIslandIdentityImage identity={dynamicIdentity} className='titlebar-dynamic-island__identity' />
        </span>
        <IslandLoopText text={visibleSummary} />
        <span className='titlebar-dynamic-island__pulse' aria-hidden='true'>
          <i />
          <i />
          <i />
          <i />
        </span>
      </Button>
      {floating && <span className='titlebar-dynamic-island__capsule-drag-handle' aria-hidden='true' />}
      <Button
        type='text'
        className='titlebar-dynamic-island__alarm'
        aria-label={t('common.winkGoWorkspace.openUtilityWheel')}
        title={t('common.winkGoWorkspace.openUtilityWheel')}
        aria-expanded={panel === 'tools'}
        onClick={toggleToolWheel}
      >
        <ApplicationMenu theme='outline' size='18' fill='currentColor' strokeWidth={3} />
        {timer.running && <span className='titlebar-dynamic-island__timer-dot' aria-hidden='true' />}
      </Button>

      {panel === 'toast' && activeToast && (
        <section
          className='titlebar-dynamic-island__toast'
          data-testid='titlebar-dynamic-island-toast-panel'
          aria-label={activeToast.text}
          onClick={() => {
            setActiveToast(null);
            setPanel(null);
          }}
        >
          <span className='titlebar-dynamic-island__toast-icon' aria-hidden='true'>
            <img src={activeToast.source} alt='' draggable={false} onError={applyWinkGoImageFallback} />
          </span>
          <span
            ref={toastViewportRef}
            className={`titlebar-dynamic-island__toast-viewport${
              toastTravel > 4 ? ' titlebar-dynamic-island__toast-viewport--scrolling' : ''
            }`}
          >
            <span
              ref={toastTextRef}
              style={
                {
                  '--toast-travel': toastTravel > 4 ? `${toastTravel}px` : '0px',
                  '--toast-duration': `${Math.max(5, Math.min(14, 3.2 + toastTravel / 22))}s`,
                } as React.CSSProperties
              }
            >
              {getIslandToastDisplayText(activeToast)}
            </span>
          </span>
          <span className='titlebar-dynamic-island__toast-bars' aria-hidden='true'>
            <i />
            <i />
            <i />
            <i />
          </span>
        </section>
      )}

      {panel === 'tools' && (
        <section
          ref={toolWheelRef}
          className='titlebar-dynamic-island__panel titlebar-dynamic-island__panel--tools'
          data-testid='titlebar-dynamic-island-tools-panel'
          aria-label={t('common.winkGoWorkspace.utilityWheel')}
          tabIndex={0}
          onWheel={handleToolWheel}
          onKeyDown={handleToolWheelKeyDown}
        >
          <div className='titlebar-dynamic-island__tool-wheel' role='listbox'>
            {islandTools.map((tool, index) => {
              const selected = index === toolWheelIndex;
              return (
                <button
                  type='button'
                  key={tool.id}
                  data-tool={tool.id}
                  className={`titlebar-dynamic-island__tool-wheel-item${
                    selected ? ' titlebar-dynamic-island__tool-wheel-item--selected' : ''
                  }`}
                  style={
                    {
                      '--tool-offset': `${-(islandTools.length - index) * 48}px`,
                      '--tool-index': index,
                    } as React.CSSProperties
                  }
                  role='option'
                  aria-selected={selected}
                  aria-label={tool.label}
                  title={tool.hint}
                  onMouseEnter={() => setToolWheelIndex(index)}
                  onClick={() => openIslandTool(tool.id)}
                >
                  <span aria-hidden='true'>{tool.icon}</span>
                  <small>{tool.label}</small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {panel && panel !== 'toast' && panel !== 'tools' && (
        <section
          className={`titlebar-dynamic-island__panel titlebar-dynamic-island__panel--${panel}`}
          data-testid={`titlebar-dynamic-island-${panel}-panel`}
          aria-label={panelTitle}
          onClick={(event) => {
            if (panel !== 'media' || mediaView !== 'controls') return;
            const target = event.target as HTMLElement;
            if (target.closest('button, [data-keep-media-panel-open="true"]')) return;
            setPanel(null);
          }}
        >
          <header className='titlebar-dynamic-island__panel-header'>
            <span className='titlebar-dynamic-island__panel-icon' aria-hidden='true'>
              {panel === 'timer' ? (
                <AlarmClock theme='outline' size='18' fill='currentColor' />
              ) : panel === 'mail' ? (
                <img
                  className='titlebar-dynamic-island__mail-brand-icon'
                  src={winkGoMailLogo}
                  alt=''
                  draggable={false}
                />
              ) : panel === 'browserComputerUse' ? (
                <Browser theme='outline' size='19' fill='currentColor' />
              ) : panel === 'desktopComputerUse' ? (
                <Computer theme='outline' size='19' fill='currentColor' />
              ) : panel === 'media' ? (
                <Music theme='outline' size='19' fill='currentColor' />
              ) : panel === 'notification' ? (
                notificationIdentity ? (
                  <StableIslandIdentityImage
                    identity={notificationIdentity}
                    className='titlebar-dynamic-island__panel-identity'
                  />
                ) : (
                  <Message theme='outline' size='19' fill='currentColor' />
                )
              ) : panel === 'files' || panel === 'destination' || panel === 'drop' ? (
                <FileCollection theme='outline' size='19' fill='currentColor' />
              ) : panel === 'apps' ? (
                <ApplicationMenu theme='outline' size='19' fill='currentColor' />
              ) : panel === 'category' ? (
                <FolderPlus theme='outline' size='19' fill='currentColor' />
              ) : panel === 'format' ? (
                <Compression theme='outline' size='19' fill='currentColor' />
              ) : (
                <img src={winkGoWordmark} alt='' draggable={false} />
              )}
            </span>
            <span>
              <strong>{panelTitle}</strong>
              <small>{panelHint}</small>
            </span>
            <Button
              type='text'
              size='mini'
              className='titlebar-dynamic-island__panel-close'
              aria-label={t('common.close')}
              icon={<CloseSmall theme='outline' size='17' fill='currentColor' />}
              onClick={() => setPanel(null)}
            />
          </header>

          {panel === 'browserComputerUse' ? (
            <ComputerUsePanel kind='browser' />
          ) : panel === 'desktopComputerUse' ? (
            <ComputerUsePanel kind='desktop' />
          ) : panel === 'mail' ? (
            <div className='titlebar-dynamic-island__mail-panel'>
              <div className='titlebar-dynamic-island__mail-list' aria-busy={mailListBusy}>
                {mailMessages.length > 0 ? (
                  mailMessages.map((message) => {
                    const saved = mailSavedResults[message.uid];
                    const saveBusy = mailSaveBusyUid === message.uid;
                    const expanded = expandedMailUid === message.uid;
                    const preview = mailPreviews[message.uid];
                    const verificationCode = extractMailVerificationCode(
                      message.subject,
                      preview?.ok ? preview.body : ''
                    );
                    return (
                      <article
                        key={`${message.accountEmail}:${message.uid}`}
                        className='titlebar-dynamic-island__mail-item'
                        data-unread={message.isUnread ? 'true' : 'false'}
                        data-expanded={expanded ? 'true' : 'false'}
                        data-has-attachments={message.hasAttachments ? 'true' : 'false'}
                        tabIndex={0}
                        title={
                          message.hasAttachments
                            ? t('common.winkGoWorkspace.mailOpenOrRightClickSave')
                            : t('common.winkGoWorkspace.mailOpenFullText')
                        }
                        onClick={() => void toggleMailMessage(message)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          void toggleMailMessage(message);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          if (!message.hasAttachments) return;
                          if (saved) revealSavedMail(message.uid);
                          else void saveMailMessage(message);
                        }}
                      >
                        <span className='titlebar-dynamic-island__mail-message-icon' aria-hidden='true'>
                          <img src={winkGoMailMessageIcon} alt='' draggable={false} />
                        </span>
                        <span className='titlebar-dynamic-island__mail-item-content'>
                          <strong>
                            {message.senderName ||
                              message.senderAddress ||
                              t('common.winkGoWorkspace.mailUnknownSender')}
                          </strong>
                          <small>{message.subject || t('common.winkGoWorkspace.mailNoSubject')}</small>
                        </span>
                        <span className='titlebar-dynamic-island__mail-item-meta'>
                          <time dateTime={new Date(message.receivedAt).toISOString()}>
                            {new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || 'zh-CN', {
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            }).format(message.receivedAt)}
                          </time>
                          {verificationCode ? (
                            <button
                              type='button'
                              className='titlebar-dynamic-island__mail-code'
                              aria-label={t('common.winkGoWorkspace.mailCopyVerificationCode', {
                                code: verificationCode,
                              })}
                              title={t('common.winkGoWorkspace.mailCopyVerificationCode', {
                                code: verificationCode,
                              })}
                              onClick={(event) => {
                                event.stopPropagation();
                                void navigator.clipboard?.writeText(verificationCode);
                              }}
                            >
                              <small>{t('common.winkGoWorkspace.mailVerificationCodeLabel')}</small>
                              <strong>{verificationCode}</strong>
                            </button>
                          ) : (
                            <em>
                              {message.hasAttachments
                                ? t('common.winkGoWorkspace.mailAttachmentCountShort', {
                                    count: message.attachmentCount,
                                  })
                                : t('common.winkGoWorkspace.mailClickRead')}
                            </em>
                          )}
                        </span>
                        {message.hasAttachments && (
                          <Button
                            type={saved ? 'secondary' : 'primary'}
                            size='mini'
                            className='titlebar-dynamic-island__mail-save'
                            loading={saveBusy}
                            aria-label={
                              saved
                                ? t('common.winkGoWorkspace.openMailFolder')
                                : t('common.winkGoWorkspace.downloadMailAttachments')
                            }
                            title={
                              saved
                                ? t('common.winkGoWorkspace.openMailFolder')
                                : t('common.winkGoWorkspace.mailSaveEverything')
                            }
                            icon={
                              saved ? (
                                <FolderOpen theme='outline' size='15' fill='currentColor' />
                              ) : (
                                <Download theme='outline' size='15' fill='currentColor' />
                              )
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              if (saved) revealSavedMail(message.uid);
                              else void saveMailMessage(message);
                            }}
                          />
                        )}
                        {mailSaveError?.uid === message.uid && (
                          <small className='titlebar-dynamic-island__mail-item-error' role='alert'>
                            {mailSaveError.message}
                          </small>
                        )}
                      </article>
                    );
                  })
                ) : (
                  <div className='titlebar-dynamic-island__mail-empty'>
                    <img src={winkGoMailLogo} alt='' draggable={false} />
                    <strong>
                      {mailListBusy
                        ? t('common.winkGoWorkspace.mailLoadingMessages')
                        : t('common.winkGoWorkspace.mailNoMessages')}
                    </strong>
                    <small>{t('common.winkGoWorkspace.mailNoMessagesHint')}</small>
                  </div>
                )}
              </div>
              <div className='titlebar-dynamic-island__mail-toolbar'>
                <small>
                  {mailStatus?.lastCheckedAt
                    ? t('common.winkGoWorkspace.mailLastChecked', {
                        time: new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || 'zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(mailStatus.lastCheckedAt),
                      })
                    : t('common.winkGoWorkspace.mailWaitingForCheck')}
                </small>
                <div>
                  <Button
                    size='mini'
                    loading={mailStatusBusy}
                    disabled={!mailStatus?.account}
                    icon={<Refresh theme='outline' size='14' fill='currentColor' />}
                    onClick={() => void checkMailNow()}
                  >
                    {t('common.winkGoWorkspace.mailCheckNow')}
                  </Button>
                  <Button size='mini' type='primary' onClick={() => openMainRoute('/settings/island-files')}>
                    {t('common.winkGoWorkspace.mailOpenSettings')}
                  </Button>
                </div>
              </div>
              {expandedMailMessage && (
                <div className='titlebar-dynamic-island__mail-reader-backdrop' onClick={() => setExpandedMailUid(null)}>
                  <section
                    className='titlebar-dynamic-island__mail-reader'
                    role='dialog'
                    aria-modal='true'
                    aria-label={t('common.winkGoWorkspace.mailReaderTitle')}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <header className='titlebar-dynamic-island__mail-reader-header'>
                      <span aria-hidden='true'>
                        <img src={winkGoMailMessageIcon} alt='' draggable={false} />
                      </span>
                      <div>
                        <strong>
                          {expandedMailMessage.senderName ||
                            expandedMailMessage.senderAddress ||
                            t('common.winkGoWorkspace.mailUnknownSender')}
                        </strong>
                        <small>{expandedMailMessage.senderAddress || expandedMailMessage.accountEmail}</small>
                      </div>
                      <Button
                        type='text'
                        size='mini'
                        aria-label={t('common.close')}
                        icon={<CloseSmall theme='outline' size='17' fill='currentColor' />}
                        onClick={() => setExpandedMailUid(null)}
                      />
                    </header>
                    <div className='titlebar-dynamic-island__mail-reader-subject'>
                      <strong>{expandedMailMessage.subject || t('common.winkGoWorkspace.mailNoSubject')}</strong>
                      <time dateTime={new Date(expandedMailMessage.receivedAt).toISOString()}>
                        {new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || 'zh-CN', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(expandedMailMessage.receivedAt)}
                      </time>
                    </div>
                    <div className='titlebar-dynamic-island__mail-reader-body' aria-live='polite'>
                      {mailPreviewBusyUid === expandedMailMessage.uid ? (
                        <span>{t('common.winkGoWorkspace.mailLoadingFullText')}</span>
                      ) : expandedMailPreview?.ok ? (
                        <p>{expandedMailPreview.body}</p>
                      ) : (
                        <span className='titlebar-dynamic-island__mail-preview-error'>
                          {t(`settings.imap.errors.${expandedMailPreview?.errorCode || 'download_failed'}`)}
                        </span>
                      )}
                    </div>
                    {expandedMailMessage.hasAttachments && (
                      <footer className='titlebar-dynamic-island__mail-reader-footer'>
                        <span>
                          {expandedMailPreview?.attachmentNames.length
                            ? t('common.winkGoWorkspace.mailAttachmentNames', {
                                names: expandedMailPreview.attachmentNames.join('、'),
                              })
                            : t('common.winkGoWorkspace.mailAttachmentCountShort', {
                                count: expandedMailMessage.attachmentCount,
                              })}
                        </span>
                        <Button
                          size='mini'
                          type='primary'
                          loading={mailSaveBusyUid === expandedMailMessage.uid}
                          icon={
                            mailSavedResults[expandedMailMessage.uid] ? (
                              <FolderOpen theme='outline' size='15' fill='currentColor' />
                            ) : (
                              <Download theme='outline' size='15' fill='currentColor' />
                            )
                          }
                          onClick={() => {
                            if (mailSavedResults[expandedMailMessage.uid]) {
                              revealSavedMail(expandedMailMessage.uid);
                            } else {
                              void saveMailMessage(expandedMailMessage);
                            }
                          }}
                        >
                          {mailSavedResults[expandedMailMessage.uid]
                            ? t('common.winkGoWorkspace.openMailFolder')
                            : t('common.winkGoWorkspace.downloadMailAttachments')}
                        </Button>
                      </footer>
                    )}
                  </section>
                </div>
              )}
            </div>
          ) : panel === 'media' && windowsRuntime.media && mediaView === 'lyrics' ? (
            <MediaLyrics
              media={windowsRuntime.media}
              mediaSource={windowsRuntime.mediaSource}
              backdropUrl={mediaIdentity?.source}
              cover={
                mediaIdentity ? (
                  <StableIslandIdentityImage identity={mediaIdentity} />
                ) : (
                  <img src={winkGoWordmark} alt='' draggable={false} />
                )
              }
              onBack={() => setMediaView('controls')}
              onControl={windowsRuntime.controlMedia}
            />
          ) : panel === 'media' ? (
            <div
              className='titlebar-dynamic-island__media-panel'
              data-testid={floating ? 'titlebar-dynamic-island-compact-media' : undefined}
            >
              {windowsRuntime.media ? (
                <>
                  <Button
                    type='text'
                    className='titlebar-dynamic-island__media-track'
                    aria-label={t('common.winkGoWorkspace.openLyrics')}
                    onClick={() => setMediaView('lyrics')}
                  >
                    <span
                      className={`titlebar-dynamic-island__media-cover${
                        mediaIdentity?.kind === 'media-cover'
                          ? ' titlebar-dynamic-island__media-cover--artwork'
                          : ' titlebar-dynamic-island__media-cover--app'
                      }${windowsRuntime.media.isPlaying ? ' titlebar-dynamic-island__media-cover--playing' : ''}`}
                      aria-hidden='true'
                    >
                      {mediaIdentity ? (
                        <StableIslandIdentityImage identity={mediaIdentity} />
                      ) : (
                        <img src={winkGoWordmark} alt='' draggable={false} />
                      )}
                    </span>
                    <span>
                      <strong>{windowsRuntime.media.title}</strong>
                      <small>
                        {windowsRuntime.media.artist || windowsRuntime.mediaSource}
                        {windowsRuntime.media.artist ? ` · ${windowsRuntime.mediaSource}` : ''}
                      </small>
                    </span>
                    <span className='titlebar-dynamic-island__media-bars' aria-hidden='true'>
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                  </Button>
                  <div className='titlebar-dynamic-island__media-controls'>
                    <button
                      type='button'
                      className='titlebar-dynamic-island__media-control titlebar-dynamic-island__media-control--secondary'
                      aria-label={t('common.winkGoWorkspace.previousTrack')}
                      onClick={() => void windowsRuntime.controlMedia('previous')}
                    >
                      <GoStart theme='filled' size='17' fill='currentColor' />
                    </button>
                    <button
                      type='button'
                      className='titlebar-dynamic-island__media-control titlebar-dynamic-island__media-control--primary'
                      aria-label={
                        windowsRuntime.media.isPlaying
                          ? t('common.winkGoWorkspace.pauseMedia')
                          : t('common.winkGoWorkspace.playMedia')
                      }
                      onClick={() => void windowsRuntime.controlMedia('play_pause')}
                    >
                      {windowsRuntime.media.isPlaying ? (
                        <span className='titlebar-dynamic-island__media-icon-pause' aria-hidden='true'>
                          <i />
                          <i />
                        </span>
                      ) : (
                        <span className='titlebar-dynamic-island__media-icon-play' aria-hidden='true' />
                      )}
                    </button>
                    <button
                      type='button'
                      className='titlebar-dynamic-island__media-control titlebar-dynamic-island__media-control--secondary'
                      aria-label={t('common.winkGoWorkspace.nextTrack')}
                      onClick={() => void windowsRuntime.controlMedia('next')}
                    >
                      <GoEnd theme='filled' size='17' fill='currentColor' />
                    </button>
                  </div>
                </>
              ) : (
                <div className='titlebar-dynamic-island__runtime-empty'>
                  <Music theme='outline' size='28' fill='currentColor' />
                  <strong>{t('common.winkGoWorkspace.noActiveMedia')}</strong>
                  <small>{t('common.winkGoWorkspace.noActiveMediaHint')}</small>
                </div>
              )}
            </div>
          ) : panel === 'notification' ? (
            <div className='titlebar-dynamic-island__notification-panel'>
              {windowsRuntime.notification ? (
                <article className='titlebar-dynamic-island__notification-card'>
                  {notificationIdentity ? (
                    <StableIslandIdentityImage
                      identity={notificationIdentity}
                      className='titlebar-dynamic-island__notification-identity'
                    />
                  ) : (
                    <img src={winkGoWordmark} alt='' draggable={false} />
                  )}
                  <span>
                    <small>
                      {windowsRuntime.notification.mail
                        ? t('common.winkGoWorkspace.mailNotifications')
                        : windowsRuntime.notification.appName}
                    </small>
                    <strong>
                      {windowsRuntime.notification.title || t('common.winkGoWorkspace.mailUnknownSender')}
                    </strong>
                    <p>
                      {windowsRuntime.privacyMode
                        ? t('common.winkGoWorkspace.notificationBodyHidden')
                        : windowsRuntime.notification.body ||
                          (windowsRuntime.notification.mail
                            ? t('common.winkGoWorkspace.mailNoSubject')
                            : t('common.winkGoWorkspace.notificationWithoutBody'))}
                    </p>
                  </span>
                </article>
              ) : (
                <div className='titlebar-dynamic-island__runtime-empty'>
                  <Message theme='outline' size='28' fill='currentColor' />
                  <strong>{t('common.winkGoWorkspace.noWechatNotification')}</strong>
                  <small>
                    {windowsRuntime.notificationAccess === 'Allowed'
                      ? t('common.winkGoWorkspace.waitingWechatNotification')
                      : t('common.winkGoWorkspace.notificationAccessRequired')}
                  </small>
                </div>
              )}
              {windowsRuntime.notification?.mail?.hasAttachments && (
                <div className='titlebar-dynamic-island__mail-actions'>
                  <span aria-live='polite'>
                    {mailDownloadError ||
                      (mailDownloadResult?.ok
                        ? t('common.winkGoWorkspace.mailDownloaded')
                        : t('common.winkGoWorkspace.mailAttachmentCount', {
                            count: windowsRuntime.notification.mail.attachmentCount,
                          }))}
                  </span>
                  <div>
                    {mailDownloadResult?.ok && (
                      <Button size='mini' onClick={revealDownloadedMail}>
                        {t('common.winkGoWorkspace.openMailFolder')}
                      </Button>
                    )}
                    <Button
                      size='mini'
                      type='primary'
                      loading={mailDownloadBusy}
                      onClick={() => void downloadCurrentMail()}
                    >
                      {mailDownloadBusy
                        ? t('common.winkGoWorkspace.downloadingMailContent')
                        : t('common.winkGoWorkspace.downloadMailContent')}
                    </Button>
                  </div>
                </div>
              )}
              <footer className='titlebar-dynamic-island__notification-settings'>
                <label>
                  <span>
                    <Lock theme='outline' size='14' fill='currentColor' />
                    {t('common.winkGoWorkspace.hideNotificationBody')}
                  </span>
                  <Switch size='small' checked={windowsRuntime.privacyMode} onChange={windowsRuntime.setPrivacyMode} />
                </label>
                {!windowsRuntime.notification?.mail && windowsRuntime.notificationAccess !== 'Allowed' && (
                  <Button size='mini' type='primary' onClick={() => void windowsRuntime.requestNotificationAccess()}>
                    {t('common.winkGoWorkspace.allowNotificationAccess')}
                  </Button>
                )}
              </footer>
            </div>
          ) : panel === 'apps' ? (
            <div className='titlebar-dynamic-island__quick-apps-panel'>
              <div
                className='titlebar-dynamic-island__quick-apps'
                ref={quickAppsTrackRef}
                onWheel={handleHorizontalWheel}
              >
                {organizer.quickApps.map((quickApp) => (
                  <article
                    className={`titlebar-dynamic-island__quick-app${
                      draggingQuickAppPath === quickApp.path ? ' titlebar-dynamic-island__quick-app--dragging' : ''
                    }`}
                    key={quickApp.path}
                    data-quick-app-path={quickApp.path}
                    onPointerDown={(event) => handleQuickAppPointerDown(event, quickApp.path)}
                    onPointerMove={handleQuickAppPointerMove}
                    onPointerUp={handleQuickAppPointerEnd}
                    onPointerCancel={handleQuickAppPointerEnd}
                  >
                    <Button
                      type='text'
                      className='titlebar-dynamic-island__quick-app-launch'
                      aria-label={quickApp.name}
                      title={quickApp.name}
                      onClick={(event) => {
                        if (suppressQuickAppClickRef.current) {
                          suppressQuickAppClickRef.current = false;
                          event.preventDefault();
                          return;
                        }
                        void organizer.launchQuickApp(quickApp).then((launched) => {
                          if (launched) setPanel(null);
                        });
                      }}
                    >
                      <span className='titlebar-dynamic-island__quick-app-icon' aria-hidden='true'>
                        <ApplicationMenu theme='outline' size='24' fill='currentColor' />
                        {quickApp.iconDataUrl ? (
                          <img
                            src={quickApp.iconDataUrl}
                            alt=''
                            draggable={false}
                            onError={() => organizer.retryQuickAppIcon(quickApp.path)}
                          />
                        ) : null}
                      </span>
                      <span className='titlebar-dynamic-island__quick-app-name'>{quickApp.name}</span>
                    </Button>
                    <Button
                      type='text'
                      size='mini'
                      className='titlebar-dynamic-island__quick-app-remove'
                      aria-label={t('common.winkGoWorkspace.removeQuickApp', { name: quickApp.name })}
                      icon={<CloseSmall theme='outline' size='12' fill='currentColor' />}
                      onClick={() => organizer.removeQuickApp(quickApp.path)}
                    />
                  </article>
                ))}
                <Button
                  type='text'
                  className='titlebar-dynamic-island__quick-app-add'
                  aria-label={t('common.winkGoWorkspace.addQuickApps')}
                  loading={organizer.quickAppsBusy}
                  onClick={() => void organizer.chooseQuickApps()}
                >
                  <span aria-hidden='true'>
                    <Plus theme='outline' size='21' fill='currentColor' />
                  </span>
                  <strong>{t('common.winkGoWorkspace.addQuickApps')}</strong>
                </Button>
              </div>
              {organizer.quickApps.length === 0 && !quickAppStatusText ? (
                <p className='titlebar-dynamic-island__quick-apps-empty'>
                  {t('common.winkGoWorkspace.noQuickAppsHint')}
                </p>
              ) : null}
              {quickAppStatusText ? (
                <p className='titlebar-dynamic-island__quick-apps-status' role='status'>
                  {quickAppStatusText}
                </p>
              ) : null}
            </div>
          ) : panel === 'activity' ? (
            <>
              <div className='titlebar-dynamic-island__activity-list'>
                {activities.length === 0 ? (
                  <div className='titlebar-dynamic-island__activity-empty'>
                    <span className='titlebar-dynamic-island__activity-empty-bars' aria-hidden='true'>
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <strong>{t('common.winkGoWorkspace.ready')}</strong>
                    <small>{t('common.winkGoWorkspace.noRecentActivity')}</small>
                  </div>
                ) : (
                  activities.slice(0, 4).map((activity) => (
                    <article className='titlebar-dynamic-island__activity-item' key={activity.id}>
                      <i className={activityStatusClass(activity)} aria-hidden='true' />
                      <span>
                        <strong>{activity.title}</strong>
                        <small>
                          {activity.source} · {t(activityStatusKey[activity.status])}
                        </small>
                      </span>
                      <time>
                        {new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language || 'zh-CN', {
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(activity.timestamp)}
                      </time>
                    </article>
                  ))
                )}
              </div>
              <footer className='titlebar-dynamic-island__panel-footer'>
                <Button
                  size='mini'
                  type='text'
                  icon={<AlarmClock theme='outline' size='17' fill='currentColor' />}
                  onClick={openScheduledTasks}
                >
                  {t('common.winkGoWorkspace.openScheduledTasks')}
                </Button>
                <Button
                  size='mini'
                  type='text'
                  icon={<FileCollection theme='outline' size='14' fill='currentColor' />}
                  onClick={() => setPanel('files')}
                >
                  {t('common.winkGoWorkspace.fileShelf')}
                </Button>
                <Button
                  size='mini'
                  type='text'
                  icon={<Music theme='outline' size='14' fill='currentColor' />}
                  onClick={() => setPanel('media')}
                >
                  {t('common.winkGoWorkspace.media')}
                </Button>
                <Button size='mini' type='outline' onClick={() => setPanel('notification')}>
                  {t('common.winkGoWorkspace.wechat')}
                </Button>
              </footer>
            </>
          ) : panel === 'timer' ? (
            <div className='titlebar-dynamic-island__timer-panel'>
              <div className='titlebar-dynamic-island__timer-time'>{timer.formattedRemaining}</div>
              <Progress
                className='titlebar-dynamic-island__timer-progress'
                percent={timer.progress}
                showText={false}
                size='small'
                status={timer.running ? 'normal' : undefined}
              />
              <div className='titlebar-dynamic-island__timer-controls'>
                <label>
                  <span>{t('common.winkGoWorkspace.focusMinutes')}</span>
                  <InputNumber
                    size='small'
                    min={1}
                    max={180}
                    precision={0}
                    value={timer.minutes}
                    disabled={timer.running}
                    onChange={(value) => timer.setMinutes(Number(value))}
                  />
                </label>
                <Button
                  type='primary'
                  size='small'
                  icon={
                    timer.running ? (
                      <PauseOne theme='filled' size='14' fill='currentColor' />
                    ) : (
                      <PlayOne theme='filled' size='14' fill='currentColor' />
                    )
                  }
                  onClick={timer.startOrPause}
                >
                  {timer.running ? t('common.winkGoWorkspace.pauseFocus') : t('common.winkGoWorkspace.startFocus')}
                </Button>
                <Button
                  type='secondary'
                  size='small'
                  icon={<Refresh theme='outline' size='14' fill='currentColor' />}
                  onClick={timer.reset}
                >
                  {t('common.winkGoWorkspace.resetFocus')}
                </Button>
              </div>
            </div>
          ) : panel === 'drop' ? (
            <div className='titlebar-dynamic-island__drop-notice'>
              <span className='titlebar-dynamic-island__drop-mark' aria-hidden='true'>
                <img src={winkGoWordmark} alt='' draggable={false} />
              </span>
              <span>
                <small>下一步</small>
                <strong>{t('common.winkGoWorkspace.dropFilesHere')}</strong>
                <em>{t('common.winkGoWorkspace.chooseDestinationHint', { count: 1 })}</em>
              </span>
              <b>{Math.max(1, organizer.pendingPaths.length || 1)}</b>
            </div>
          ) : panel === 'format' ? (
            <div className='titlebar-dynamic-island__format-quick'>
              <div className='titlebar-dynamic-island__format-presets-shell'>
                <div
                  ref={formatPresetsRef}
                  className='titlebar-dynamic-island__format-presets'
                  onWheel={handleHorizontalWheel}
                >
                  {ISLAND_FORMAT_PRESETS.map((preset) => {
                    const available = formatPresetAvailable(preset);
                    return (
                      <button
                        type='button'
                        key={preset.id}
                        className={formatPreset === preset.id ? 'active' : ''}
                        disabled={formatBusy}
                        data-preset={preset.id}
                        data-available={available ? 'true' : 'false'}
                        onClick={() => {
                          setFormatPreset(preset.id);
                          setFormatFiles([]);
                          setFormatProgress(0);
                          setFormatFeedback(
                            available ? `${preset.title} · ${preset.subtitle}` : '本机尚未安装所需转换引擎'
                          );
                        }}
                      >
                        <em aria-hidden='true'>{preset.icon}</em>
                        <span>
                          <strong>{preset.title}</strong>
                          <small>{available ? preset.subtitle : '引擎未安装'}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <button
                  type='button'
                  className='titlebar-dynamic-island__format-scroll-next'
                  aria-label='查看更多转换工具'
                  onClick={() => formatPresetsRef.current?.scrollBy({ left: 238, behavior: 'smooth' })}
                >
                  <span aria-hidden='true'>›</span>
                </button>
              </div>
              <div className='titlebar-dynamic-island__format-controls'>
                <button type='button' disabled={formatBusy} onClick={() => void chooseIslandFormatFiles()}>
                  <FolderUpload theme='outline' size='19' fill='currentColor' />
                  <span>
                    <strong>
                      {formatFiles.length
                        ? `${formatFiles[0].split(/[\\/]/).pop()}${formatFiles.length > 1 ? ` 等 ${formatFiles.length} 个` : ''}`
                        : '选择或拖入文件'}
                    </strong>
                    <small>{isFileDragActive ? '松开即可加入' : '所有文件只在本机处理'}</small>
                  </span>
                </button>
                <button
                  type='button'
                  disabled={formatBusy}
                  title={formatOutputFolder}
                  onClick={() => void chooseIslandFormatOutput()}
                >
                  <FolderOpen theme='outline' size='17' fill='currentColor' />
                  <span>输出</span>
                </button>
                <button
                  type='button'
                  disabled={
                    formatBusy ||
                    formatFiles.length === 0 ||
                    !formatOutputFolder ||
                    !formatPresetAvailable(
                      ISLAND_FORMAT_PRESETS.find((preset) => preset.id === formatPreset) || ISLAND_FORMAT_PRESETS[0]
                    )
                  }
                  onClick={() => void startIslandFormatConversion()}
                >
                  {formatBusy ? `${formatProgress}%` : '开始转换'}
                </button>
              </div>
              <div className='titlebar-dynamic-island__format-progress'>
                <i style={{ width: `${formatProgress}%` }} />
                <span>{formatFeedback}</span>
              </div>
            </div>
          ) : panel === 'files' ? (
            <div className='titlebar-dynamic-island__file-panel'>
              <div
                className={`titlebar-dynamic-island__file-drop${isFileDragActive ? ' titlebar-dynamic-island__file-drop--active' : ''}`}
              >
                <FolderUpload theme='outline' size='22' fill='currentColor' />
                <span>
                  <strong>{t('common.winkGoWorkspace.dropFilesHere')}</strong>
                  <small>{t('common.winkGoWorkspace.shortcutsHint')}</small>
                </span>
                <Button type='primary' size='small' loading={organizer.busy} onClick={chooseFilesForOrganizer}>
                  {t('common.winkGoWorkspace.chooseFiles')}
                </Button>
              </div>
              <div className='titlebar-dynamic-island__file-settings'>
                <Radio.Group
                  type='button'
                  size='mini'
                  value={organizer.mode}
                  onChange={(value) => organizer.setMode(value as 'move' | 'copy')}
                  options={[
                    { label: t('common.winkGoWorkspace.moveMode'), value: 'move' },
                    { label: t('common.winkGoWorkspace.copyMode'), value: 'copy' },
                  ]}
                />
                <label>
                  <span>{t('common.winkGoWorkspace.autoRename')}</span>
                  <Switch size='small' checked={organizer.autoRename} onChange={organizer.setAutoRename} />
                </label>
                <Button
                  type='text'
                  size='mini'
                  icon={<FolderOpen theme='outline' size='14' fill='currentColor' />}
                  onClick={organizer.chooseRoot}
                >
                  {t('common.winkGoWorkspace.chooseRoot')}
                </Button>
              </div>
              <div className='titlebar-dynamic-island__recent-heading'>
                <strong>{t('common.winkGoWorkspace.recentFiles')}</strong>
                <span>
                  <Button
                    type='text'
                    size='mini'
                    icon={<FolderPlus theme='outline' size='14' fill='currentColor' />}
                    onClick={() => setPanel('category')}
                  >
                    {t('common.winkGoWorkspace.newCategory')}
                  </Button>
                  <Button
                    type='text'
                    size='mini'
                    disabled={organizer.lastBatch.length === 0 || organizer.busy}
                    icon={<Undo theme='outline' size='14' fill='currentColor' />}
                    onClick={undoLastFileBatch}
                  >
                    {t('common.winkGoWorkspace.undoLast')}
                  </Button>
                </span>
              </div>
              <div className='titlebar-dynamic-island__recent-files' onWheel={handleHorizontalWheel}>
                {organizer.recentFiles.length === 0 ? (
                  <div className='titlebar-dynamic-island__file-empty'>
                    <FileCollection theme='outline' size='24' fill='currentColor' />
                    <span>{t('common.winkGoWorkspace.noRecentFiles')}</span>
                  </div>
                ) : (
                  organizer.recentFiles.map((file) => (
                    <Button
                      type='text'
                      className='titlebar-dynamic-island__recent-file'
                      key={`${file.destination}:${file.organizedAt}`}
                      title={file.destination}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void organizer.revealRecentFile(file);
                      }}
                      onClick={() => void organizer.openRecentFile(file)}
                    >
                      <span className='titlebar-dynamic-island__file-type'>
                        <FileTypeIcon
                          node={{
                            name: file.finalName,
                            relativePath: file.destination,
                            isFile: file.category !== 'folders',
                          }}
                          expanded={file.category === 'folders'}
                          size={28}
                        />
                      </span>
                      <span>
                        <strong>{file.finalName}</strong>
                        <small>
                          {fileCategoryLabel(file)}
                          {file.category === 'folders' ? '' : ` · ${formatFileSize(file.sizeBytes)}`}
                        </small>
                      </span>
                    </Button>
                  ))
                )}
              </div>
              {organizer.status.type !== 'idle' && (
                <div
                  className={`titlebar-dynamic-island__file-status titlebar-dynamic-island__file-status--${organizer.status.type}`}
                >
                  {organizer.status.type === 'success'
                    ? organizer.status.restored
                      ? t('common.winkGoWorkspace.restoredFiles', { count: organizer.status.restored })
                      : t('common.winkGoWorkspace.organizedFiles', { count: organizer.status.organized ?? 0 })
                    : t('common.winkGoWorkspace.organizerFailed')}
                </div>
              )}
            </div>
          ) : panel === 'category' ? (
            <div className='titlebar-dynamic-island__category-panel'>
              <div className='titlebar-dynamic-island__category-form'>
                <Input
                  value={categoryName}
                  maxLength={32}
                  allowClear
                  placeholder={t('common.winkGoWorkspace.categoryPlaceholder')}
                  aria-label={t('common.winkGoWorkspace.categoryName')}
                  onChange={(value) => {
                    setCategoryName(value);
                    setCategoryFeedback(null);
                  }}
                  onPressEnter={saveCategory}
                />
                <Button type='primary' disabled={categoryName.trim().length < 2} onClick={saveCategory}>
                  {t('common.winkGoWorkspace.addCategory')}
                </Button>
              </div>
              <div className='titlebar-dynamic-island__category-feedback'>
                {categoryFeedback
                  ? t(categoryFeedback)
                  : t('common.winkGoWorkspace.categoryCreateHint', { count: organizer.rules.length })}
              </div>
              <div className='titlebar-dynamic-island__category-list'>
                {organizer.rules.map((rule) => (
                  <div key={rule.id}>
                    <span>
                      <FolderOpen theme='outline' size='15' fill='currentColor' />
                      <strong>{rule.name}</strong>
                    </span>
                    <Button
                      type='text'
                      size='mini'
                      aria-label={t('common.delete')}
                      icon={<Delete theme='outline' size='14' fill='currentColor' />}
                      onClick={() => {
                        organizer.removeCategory(rule.id);
                        setCategoryFeedback(null);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div
              className='titlebar-dynamic-island__destination-panel'
              data-has-custom-destinations={organizer.rules.length > 0 ? 'true' : 'false'}
            >
              <div
                className='titlebar-dynamic-island__destination-track'
                data-testid='titlebar-dynamic-island-destination-track'
                onWheel={handleHorizontalWheel}
                onPointerDown={handleDestinationPointerDown}
                onPointerMove={handleDestinationPointerMove}
                onPointerUp={finishDestinationPointerDrag}
                onPointerCancel={finishDestinationPointerDrag}
                onClickCapture={handleDestinationClickCapture}
              >
                <Button
                  type='text'
                  className='titlebar-dynamic-island__destination-card titlebar-dynamic-island__destination-card--smart'
                  disabled={organizer.busy}
                  onClick={() => void confirmFileDestination()}
                >
                  <span className='titlebar-dynamic-island__destination-icon'>
                    <img src={winkGoWordmark} alt='' draggable={false} />
                  </span>
                  <span>
                    <strong>{t('common.winkGoWorkspace.smartOrganize')}</strong>
                  </span>
                </Button>
                {organizer.rules.map((rule) => (
                  <Button
                    type='text'
                    className='titlebar-dynamic-island__destination-card'
                    key={rule.id}
                    disabled={organizer.busy}
                    onClick={() => void confirmFileDestination(rule.name)}
                  >
                    <span className='titlebar-dynamic-island__destination-icon'>
                      <FolderOpen theme='outline' size='20' fill='currentColor' />
                    </span>
                    <span>
                      <strong>{rule.name}</strong>
                    </span>
                  </Button>
                ))}
              </div>
              <footer className='titlebar-dynamic-island__destination-footer'>
                <span>
                  <strong>{t('common.winkGoWorkspace.organizerRoot')}</strong>
                  <small title={organizer.destinationRoot}>{organizer.destinationRoot}</small>
                </span>
                <span className='titlebar-dynamic-island__destination-actions'>
                  <Button
                    type='text'
                    size='mini'
                    icon={<FolderOpen theme='outline' size='13' fill='currentColor' />}
                    onClick={() => void organizer.chooseRoot()}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    type='text'
                    size='mini'
                    onClick={() => {
                      organizer.clearPending();
                      setPanel('files');
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                </span>
              </footer>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default TitlebarDynamicIsland;
