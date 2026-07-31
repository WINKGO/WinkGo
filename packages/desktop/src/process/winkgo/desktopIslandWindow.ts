/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'path';
import { initMainAdapterWithWindow } from '@/common/adapter/main';
import { isTrustedIpcSender, resolveTrustedDevServerUrl } from '@/common/platform/electronSecurity';
import { registerTrustedWindowSecurity } from '@process/startup/electronSecurity';

const ISLAND_TOP_MARGIN = 10;
const COLLAPSED_WIDTH = 250;
const COLLAPSED_HEIGHT = 38;
const MIN_WIDTH = 250;
const MAX_WIDTH = 620;
const MIN_HEIGHT = 38;
const MAX_HEIGHT = 520;
const RESIZE_DURATION_MS = 170;
const RESIZE_STEPS = 8;

const allowedMainRoutes = new Set([
  '/guid',
  '/scheduled',
  '/format-studio',
  '/mcp',
  '/inspiration',
  '/skills',
  '/settings/island-files',
  '/settings/system',
]);

type DesktopIslandWindowOptions = {
  fallbackFile: string;
  getMainWindow: () => BrowserWindow | null | undefined;
  rendererUrl?: string;
};

type DesktopIslandSize = {
  height: number;
  width: number;
};

let islandWindow: BrowserWindow | null = null;
let autoHideFullscreen = false;
let islandOpacity = 100;
let islandVisible = true;
let resizeRevision = 0;
let handlersRegistered = false;
let currentOptions: DesktopIslandWindowOptions | null = null;
let displayListenersRegistered = false;
let preferredIslandPosition: { centerX: number; y: number } | null = null;
let suppressPositionTrackingUntil = 0;
let nativeDropPoller: NodeJS.Timeout | null = null;

type NativeDropEvent =
  | { kind: 'enter'; names: string[]; position: [number, number] }
  | { kind: 'over'; position: [number, number] }
  | { kind: 'leave' }
  | { kind: 'drop'; paths: string[]; position: [number, number] };

type NativeDropAddon = {
  installWindow: (hwnd: number) => number;
  takeEventsJson: () => string;
};

let nativeDropAddon: NativeDropAddon | null | undefined;
let nativeDropInstallTimers: NodeJS.Timeout[] = [];

const loadNativeDropAddon = (): NativeDropAddon | null => {
  if (process.platform !== 'win32') return null;
  if (nativeDropAddon !== undefined) return nativeDropAddon;
  const candidates = [
    path.join(process.resourcesPath, 'native', 'winkgo_native_drop.node'),
    path.join(app.getAppPath(), 'packages', 'desktop', 'native', 'winkgo_native_drop.node'),
    path.join(process.cwd(), 'packages', 'desktop', 'native', 'winkgo_native_drop.node'),
  ];
  const addonPath = candidates.find((candidate) => existsSync(candidate));
  if (!addonPath) {
    console.warn('[WINK GO native drop] addon was not found');
    nativeDropAddon = null;
    return null;
  }
  try {
    const requireNative = createRequire(path.join(app.getAppPath(), 'package.json'));
    nativeDropAddon = requireNative(addonPath) as NativeDropAddon;
  } catch (error) {
    console.error('[WINK GO native drop] failed to load addon:', error);
    nativeDropAddon = null;
  }
  return nativeDropAddon;
};

const installNativeDropTarget = (targetWindow: BrowserWindow): void => {
  const addon = loadNativeDropAddon();
  if (!addon || targetWindow.isDestroyed()) return;
  const handle = targetWindow.getNativeWindowHandle();
  const hwnd =
    handle.byteLength >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.byteLength >= 4 ? handle.readUInt32LE(0) : 0;
  if (!hwnd) return;
  const installed = addon.installWindow(hwnd);
  console.info(`[WINK GO native drop] installed ${installed} OLE target(s)`);

  if (nativeDropPoller) clearTimeout(nativeDropPoller);
  let fastPollingUntil = 0;
  const pollNativeDropEvents = () => {
    if (!islandWindow || islandWindow.isDestroyed()) {
      nativeDropPoller = null;
      return;
    }
    try {
      const events = JSON.parse(addon.takeEventsJson()) as NativeDropEvent[];
      if (events.length > 0) {
        fastPollingUntil = Date.now() + 1_500;
      }
      for (const event of events) {
        islandWindow.webContents.send('winkgo-native-file-drop:event', event);
      }
    } catch (error) {
      console.warn('[WINK GO native drop] event decode failed:', error);
    }
    // Stay highly responsive during an active drag, but stop parsing an empty
    // native queue ~30 times per second while the machine is idle.
    const nextDelay = Date.now() < fastPollingUntil ? 32 : 140;
    nativeDropPoller = setTimeout(pollNativeDropEvents, nextDelay);
    nativeDropPoller.unref();
  };
  nativeDropPoller = setTimeout(pollNativeDropEvents, 60);
  nativeDropPoller.unref();
};

const scheduleNativeDropTargetInstall = (targetWindow: BrowserWindow): void => {
  for (const timer of nativeDropInstallTimers) clearTimeout(timer);
  nativeDropInstallTimers = [80, 360, 1_100].map((delay) =>
    setTimeout(() => {
      if (!targetWindow.isDestroyed()) installNativeDropTarget(targetWindow);
    }, delay)
  );
  for (const timer of nativeDropInstallTimers) timer.unref();
};

const clampInteger = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)));

const normalizedSize = ({ width, height }: DesktopIslandSize): DesktopIslandSize => ({
  width: clampInteger(width, MIN_WIDTH, MAX_WIDTH),
  height: clampInteger(height, MIN_HEIGHT, MAX_HEIGHT),
});

const isDesktopIslandSize = (value: unknown): value is DesktopIslandSize => {
  if (!value || typeof value !== 'object') return false;
  const size = value as Partial<DesktopIslandSize>;
  return (
    typeof size.width === 'number' &&
    Number.isFinite(size.width) &&
    typeof size.height === 'number' &&
    Number.isFinite(size.height)
  );
};

const isDesktopIslandSettings = (value: unknown): value is DesktopIslandSettings => {
  if (!value || typeof value !== 'object') return false;
  const settings = value as Partial<DesktopIslandSettings>;
  return (
    typeof settings.autoHideFullscreen === 'boolean' &&
    typeof settings.opacity === 'number' &&
    Number.isFinite(settings.opacity) &&
    typeof settings.visible === 'boolean'
  );
};

const centeredBounds = ({ width, height }: DesktopIslandSize): Electron.Rectangle => {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay();
  const workArea = display.workArea;
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + ISLAND_TOP_MARGIN,
    width,
    height,
  };
};

const resizedBoundsKeepingPosition = (
  currentBounds: Electron.Rectangle,
  { width, height }: DesktopIslandSize
): Electron.Rectangle => {
  const display = screen.getDisplayMatching(currentBounds) || screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const centerX = preferredIslandPosition?.centerX ?? currentBounds.x + currentBounds.width / 2;
  const desiredY = preferredIslandPosition?.y ?? currentBounds.y;
  const desiredX = Math.round(centerX - width / 2);
  const maxX = workArea.x + Math.max(0, workArea.width - width);
  const maxY = workArea.y + Math.max(0, workArea.height - height);

  return {
    x: Math.min(maxX, Math.max(workArea.x, desiredX)),
    y: Math.min(maxY, Math.max(workArea.y, desiredY)),
    width,
    height,
  };
};

const rememberIslandPosition = (bounds: Electron.Rectangle): void => {
  preferredIslandPosition = {
    centerX: bounds.x + bounds.width / 2,
    y: bounds.y,
  };
};

const recenterIsland = (): void => {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  const bounds = islandWindow.getBounds();
  const centered = centeredBounds(bounds);
  suppressPositionTrackingUntil = Date.now() + 250;
  islandWindow.setBounds(centered);
  rememberIslandPosition(centered);
};

type DesktopIslandSettings = {
  autoHideFullscreen: boolean;
  opacity: number;
  visible: boolean;
};

const applyIslandSettings = (settings: DesktopIslandSettings): boolean => {
  autoHideFullscreen = settings.autoHideFullscreen === true;
  islandOpacity = clampInteger(settings.opacity, 20, 100);
  islandVisible = settings.visible !== false;
  if (!islandWindow || islandWindow.isDestroyed()) return false;

  islandWindow.setOpacity(islandOpacity / 100);
  islandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !autoHideFullscreen });
  if (islandVisible) islandWindow.showInactive();
  else islandWindow.hide();
  return true;
};

const resizeIsland = ({ width, height }: DesktopIslandSize): void => {
  if (!islandWindow || islandWindow.isDestroyed()) return;
  const start = islandWindow.getBounds();
  const target = resizedBoundsKeepingPosition(start, normalizedSize({ width, height }));
  const revision = ++resizeRevision;

  if (start.width === target.width && start.height === target.height) {
    islandWindow.setPosition(target.x, target.y, false);
    return;
  }

  // Windows keeps a stale DWM surface for transparent, frameless Electron
  // windows when they are resized repeatedly while visible. The native bounds
  // change, but Chromium can remain clipped to the old 250×38 surface (the
  // file shelf then looks like a single header strip). Releasing the surface
  // before applying the new bounds is the same reliable workaround already
  // used by the desktop-pet window.
  if (process.platform === 'win32') {
    const wasVisible = islandWindow.isVisible();
    if (wasVisible) islandWindow.hide();
    suppressPositionTrackingUntil = Date.now() + 250;
    islandWindow.setBounds(target, false);
    if (wasVisible && islandVisible) islandWindow.showInactive();
    return;
  }

  for (let step = 1; step <= RESIZE_STEPS; step += 1) {
    const progress = step / RESIZE_STEPS;
    const eased = 1 - Math.pow(1 - progress, 3);
    setTimeout(
      () => {
        if (revision !== resizeRevision || !islandWindow || islandWindow.isDestroyed()) return;
        suppressPositionTrackingUntil = Date.now() + 250;
        islandWindow.setBounds(
          {
            x: Math.round(start.x + (target.x - start.x) * eased),
            y: Math.round(start.y + (target.y - start.y) * eased),
            width: Math.round(start.width + (target.width - start.width) * eased),
            height: Math.round(start.height + (target.height - start.height) * eased),
          },
          false
        );
      },
      Math.round((RESIZE_DURATION_MS / RESIZE_STEPS) * step)
    );
  }
};

const showMainWindowAtRoute = async (route: string): Promise<boolean> => {
  if (!allowedMainRoutes.has(route)) return false;
  const mainWindow = currentOptions?.getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  await mainWindow.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(`#${route}`)}`);
  return true;
};

const registerHandlers = (): void => {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle('winkgo-desktop-island:set-size', (event, size: DesktopIslandSize) => {
    if (
      !isTrustedIpcSender(event, ['island']) ||
      !isDesktopIslandSize(size) ||
      !islandWindow ||
      islandWindow.isDestroyed() ||
      event.sender.id !== islandWindow.webContents.id
    ) {
      return false;
    }
    resizeIsland(size);
    return true;
  });
  ipcMain.handle('winkgo-desktop-island:ready', (event) => {
    if (
      !isTrustedIpcSender(event, ['island']) ||
      !islandWindow ||
      islandWindow.isDestroyed() ||
      event.sender.id !== islandWindow.webContents.id
    ) {
      return false;
    }
    islandWindow.setOpacity(islandOpacity / 100);
    if (islandVisible) islandWindow.showInactive();
    return true;
  });
  ipcMain.handle('winkgo-desktop-island:apply-settings', (event, settings: DesktopIslandSettings) => {
    if (!isTrustedIpcSender(event, ['main', 'island']) || !isDesktopIslandSettings(settings)) return false;
    return applyIslandSettings(settings);
  });
  ipcMain.handle('winkgo-desktop-island:navigate-main', (event, route: string) => {
    if (!isTrustedIpcSender(event, ['main', 'island']) || typeof route !== 'string' || route.length > 128) {
      return false;
    }
    return showMainWindowAtRoute(route);
  });
};

const registerDisplayListeners = (): void => {
  if (displayListenersRegistered) return;
  displayListenersRegistered = true;
  screen.on('display-added', recenterIsland);
  screen.on('display-removed', recenterIsland);
  screen.on('display-metrics-changed', recenterIsland);
};

export const createDesktopIslandWindow = (options: DesktopIslandWindowOptions): BrowserWindow => {
  const trustedRendererUrl = resolveTrustedDevServerUrl(options.rendererUrl);
  currentOptions = { ...options, rendererUrl: trustedRendererUrl ?? undefined };
  registerHandlers();
  registerDisplayListeners();

  if (islandWindow && !islandWindow.isDestroyed()) {
    if (islandVisible) islandWindow.showInactive();
    return islandWindow;
  }

  const initialBounds = centeredBounds({ width: COLLAPSED_WIDTH, height: COLLAPSED_HEIGHT });
  rememberIslandPosition(initialBounds);
  islandWindow = new BrowserWindow({
    ...initialBounds,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    focusable: true,
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    maximizable: false,
    minimizable: false,
    movable: true,
    resizable: false,
    roundedCorners: false,
    show: false,
    skipTaskbar: true,
    title: 'WINK GO 灵动岛',
    transparent: true,
    type: process.platform === 'darwin' ? 'panel' : 'toolbar',
    webPreferences: {
      allowRunningInsecureContent: false,
      contextIsolation: true,
      navigateOnDragDrop: false,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js'),
      safeDialogs: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  registerTrustedWindowSecurity(islandWindow, {
    role: 'island',
    productionEntryFile: options.fallbackFile,
    devServerUrl: trustedRendererUrl,
  });

  islandWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    islandWindow?.setTitle('WINK GO 灵动岛');
  });
  islandWindow.on('moved', () => {
    if (!islandWindow || islandWindow.isDestroyed() || Date.now() < suppressPositionTrackingUntil) return;
    rememberIslandPosition(islandWindow.getBounds());
  });
  islandWindow.setAlwaysOnTop(true, 'screen-saver');
  islandWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: !autoHideFullscreen });
  islandWindow.setOpacity(islandOpacity / 100);
  islandWindow.setMenuBarVisibility(false);
  islandWindow.webContents.setZoomFactor(1);
  initMainAdapterWithWindow(islandWindow);
  islandWindow.webContents.on('did-finish-load', () => {
    if (!islandWindow || islandWindow.isDestroyed()) return;
    // Chromium can recreate/re-register its WebView drop target shortly after
    // did-finish-load. Re-apply the original WINK GO/Wry target during that
    // short stabilization window so WeChat virtual FILECONTENTS reaches us.
    scheduleNativeDropTargetInstall(islandWindow);
  });

  const rendererUrl = trustedRendererUrl;
  if (!process.env.WINKGO_E2E_TEST && !islandWindow.isDestroyed()) {
    islandWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12') _event.preventDefault();
    });
  }

  if (!BrowserWindow.getAllWindows().includes(islandWindow)) {
    throw new Error('Failed to register WINK GO desktop island window');
  }

  if (!rendererUrl) {
    void islandWindow.loadFile(options.fallbackFile, { hash: '/desktop-island' });
  } else {
    void islandWindow.loadURL(`${rendererUrl.replace(/\/$/, '')}/#/desktop-island`).catch((error) => {
      console.error('[WINK GO island] loadURL failed, falling back to packaged renderer:', error);
      if (!islandWindow || islandWindow.isDestroyed()) return;
      void islandWindow.loadFile(options.fallbackFile, { hash: '/desktop-island' });
    });
  }

  islandWindow.once('ready-to-show', () => {
    if (!islandWindow || islandWindow.isDestroyed()) return;
    scheduleNativeDropTargetInstall(islandWindow);
    if (islandVisible) islandWindow.showInactive();
  });
  islandWindow.on('closed', () => {
    resizeRevision += 1;
    for (const timer of nativeDropInstallTimers) clearTimeout(timer);
    nativeDropInstallTimers = [];
    if (nativeDropPoller) {
      clearTimeout(nativeDropPoller);
      nativeDropPoller = null;
    }
    preferredIslandPosition = null;
    islandWindow = null;
  });

  return islandWindow;
};

export const destroyDesktopIslandWindow = (): void => {
  resizeRevision += 1;
  for (const timer of nativeDropInstallTimers) clearTimeout(timer);
  nativeDropInstallTimers = [];
  if (islandWindow && !islandWindow.isDestroyed()) {
    islandWindow.destroy();
  }
  preferredIslandPosition = null;
  islandWindow = null;
};

export const getDesktopIslandWindow = (): BrowserWindow | null => islandWindow;

export const toggleDesktopIslandVisibility = (): boolean => {
  islandVisible = !islandVisible;
  if (!islandWindow || islandWindow.isDestroyed()) return islandVisible;
  if (islandVisible) islandWindow.showInactive();
  else islandWindow.hide();
  return islandVisible;
};
