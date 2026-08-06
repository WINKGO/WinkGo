/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, nativeImage, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { ipcBridge } from '@/common';
import type { WinkGoQuickApp, WinkGoQuickAppLaunchResult, WinkGoShortcutAction } from '@/common/adapter/ipcBridge';
import { isTrustedIpcSender } from '@/common/platform/electronSecurity';
import { loadQuickAppIconDataUrl } from '@process/services/quickApps/quickAppIcon';
import { extractWindowsExecutableIconDataUrl } from '@process/services/quickApps/windowsExecutableIcon';
import {
  canRevealWinkGoFile,
  organizeWinkGoFiles,
  undoWinkGoFiles,
  uniqueWinkGoDestination,
} from '@process/services/WinkGoFileOrganizerService';
import { getDesktopIslandWindow, toggleDesktopIslandVisibility } from '@process/winkgo/desktopIslandWindow';

const SHORTCUTS = {
  memo: 'Alt+1',
  fileShelf: 'Alt+2',
  fileCategory: 'Alt+3',
  formatWorkbench: 'Alt+4',
  quickApps: 'Alt+5',
  toggleIsland: 'Alt+6',
} as const;

let shortcutsActivated = false;
const MAX_VIRTUAL_DROP_BYTES = 64 * 1024 * 1024;
const MAX_QUICK_APP_PATH_LENGTH = 2048;
const MAX_SELECTED_QUICK_APPS = 32;
const QUICK_APP_EXTENSIONS = new Set(['.exe', '.lnk', '.app', '.desktop', '.appimage']);

type VirtualDroppedFile = {
  data: ArrayBuffer;
  name: string;
  type?: string;
};

const virtualFileExtension = (mimeType = ''): string => {
  const normalized = mimeType.split(';', 1)[0].trim().toLocaleLowerCase();
  const known: Record<string, string> = {
    'image/avif': '.avif',
    'image/bmp': '.bmp',
    'image/gif': '.gif',
    'image/heic': '.heic',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/svg+xml': '.svg',
    'image/webp': '.webp',
  };
  return known[normalized] || '';
};

const sanitizeVirtualFileName = (name: string, mimeType?: string): string => {
  const original = nodePath
    .basename(name || '')
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  const extension = nodePath.extname(original) || virtualFileExtension(mimeType);
  const stem = nodePath.basename(original, nodePath.extname(original)).slice(0, 96);
  return `${stem || `微信图片_${Date.now()}`}${extension || '.bin'}`;
};

const persistVirtualDroppedFile = async ({ data, name, type }: VirtualDroppedFile): Promise<string> => {
  const bytes = Buffer.from(data);
  if (bytes.length === 0) throw new Error('EMPTY_DROPPED_FILE');
  if (bytes.length > MAX_VIRTUAL_DROP_BYTES) throw new Error('DROPPED_FILE_TOO_LARGE');
  const stagingDirectory = nodePath.join(app.getPath('temp'), 'WINK GO', 'drag-inbox');
  await mkdir(stagingDirectory, { recursive: true });
  const fileName = sanitizeVirtualFileName(name, type);
  const destination = uniqueWinkGoDestination(stagingDirectory, fileName);
  await writeFile(destination, bytes, { flag: 'wx' });
  return destination;
};

const showDesktopIsland = (): void => {
  const islandWindow = getDesktopIslandWindow();
  if (!islandWindow || islandWindow.isDestroyed()) return;
  islandWindow.showInactive();
};

const registerShortcut = (
  shortcut: string,
  type: 'openMemo' | 'openShelf' | 'newCategory' | 'openFormat' | 'openApps'
): boolean => {
  if (globalShortcut.isRegistered(shortcut)) return true;
  return globalShortcut.register(shortcut, () => {
    showDesktopIsland();
    ipcBridge.winkGoFiles.command.emit({ type });
  });
};

const activateShortcuts = () => {
  if (shortcutsActivated) {
    return {
      fileShelf: globalShortcut.isRegistered(SHORTCUTS.fileShelf),
      fileCategory: globalShortcut.isRegistered(SHORTCUTS.fileCategory),
      formatWorkbench: globalShortcut.isRegistered(SHORTCUTS.formatWorkbench),
      quickApps: globalShortcut.isRegistered(SHORTCUTS.quickApps),
      memo: globalShortcut.isRegistered(SHORTCUTS.memo),
      toggleIsland: globalShortcut.isRegistered(SHORTCUTS.toggleIsland),
    };
  }
  shortcutsActivated = true;
  const toggleIsland = globalShortcut.isRegistered(SHORTCUTS.toggleIsland)
    ? true
    : globalShortcut.register(SHORTCUTS.toggleIsland, () => {
        toggleDesktopIslandVisibility();
      });
  return {
    memo: registerShortcut(SHORTCUTS.memo, 'openMemo'),
    fileShelf: registerShortcut(SHORTCUTS.fileShelf, 'openShelf'),
    fileCategory: registerShortcut(SHORTCUTS.fileCategory, 'newCategory'),
    formatWorkbench: registerShortcut(SHORTCUTS.formatWorkbench, 'openFormat'),
    quickApps: registerShortcut(SHORTCUTS.quickApps, 'openApps'),
    toggleIsland,
  };
};

const isSupportedQuickAppPath = (candidate: unknown): candidate is string =>
  typeof candidate === 'string' &&
  candidate.length > 0 &&
  candidate.length <= MAX_QUICK_APP_PATH_LENGTH &&
  nodePath.isAbsolute(candidate) &&
  QUICK_APP_EXTENSIONS.has(nodePath.extname(candidate).toLocaleLowerCase());

const describeQuickApp = async (appPath: string): Promise<WinkGoQuickApp | null> => {
  if (!isSupportedQuickAppPath(appPath)) return null;
  try {
    const info = await stat(appPath);
    if (!info.isFile() && !(process.platform === 'darwin' && info.isDirectory())) return null;
    const extension = nodePath.extname(appPath);
    return {
      name: nodePath.basename(appPath, extension).trim() || nodePath.basename(appPath),
      path: appPath,
      iconDataUrl: await loadQuickAppIconDataUrl(appPath, {
        platform: process.platform,
        env: process.env,
        extractExecutableIconDataUrl: extractWindowsExecutableIconDataUrl,
        readShortcutLink: (shortcutPath) => shell.readShortcutLink(shortcutPath),
        createImageFromPath: (imagePath) => nativeImage.createFromPath(imagePath),
        getFileIcon: (imagePath) => app.getFileIcon(imagePath, { size: 'large' }),
      }),
    };
  } catch {
    return null;
  }
};

const selectQuickApps = async (): Promise<WinkGoQuickApp[]> => {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    filters:
      process.platform === 'win32'
        ? [{ name: 'Applications', extensions: ['exe', 'lnk'] }]
        : process.platform === 'darwin'
          ? [{ name: 'Applications', extensions: ['app'] }]
          : [{ name: 'Applications', extensions: ['desktop', 'appimage'] }],
  };
  const owner = BrowserWindow.getFocusedWindow();
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
  if (result.canceled) return [];
  const uniquePaths = [
    ...new Map(
      result.filePaths
        .filter(isSupportedQuickAppPath)
        .map((appPath) => [process.platform === 'win32' ? appPath.toLocaleLowerCase() : appPath, appPath])
    ).values(),
  ].slice(0, MAX_SELECTED_QUICK_APPS);
  const apps = await Promise.all(uniquePaths.map(describeQuickApp));
  return apps.filter((candidate): candidate is WinkGoQuickApp => candidate !== null);
};

const refreshQuickApps = async ({ paths }: { paths: string[] }): Promise<WinkGoQuickApp[]> => {
  if (!Array.isArray(paths)) return [];
  const uniquePaths = [
    ...new Map(
      paths
        .filter(isSupportedQuickAppPath)
        .map((appPath) => [process.platform === 'win32' ? appPath.toLocaleLowerCase() : appPath, appPath])
    ).values(),
  ].slice(0, MAX_SELECTED_QUICK_APPS);
  const apps = await Promise.all(uniquePaths.map(describeQuickApp));
  return apps.filter((candidate): candidate is WinkGoQuickApp => candidate !== null);
};

const launchQuickApp = async ({ path: appPath }: { path: string }): Promise<WinkGoQuickAppLaunchResult> => {
  if (typeof appPath !== 'string' || !nodePath.isAbsolute(appPath) || appPath.length > MAX_QUICK_APP_PATH_LENGTH) {
    return { launched: false, error: 'invalid_path' };
  }
  if (!QUICK_APP_EXTENSIONS.has(nodePath.extname(appPath).toLocaleLowerCase())) {
    return { launched: false, error: 'unsupported' };
  }
  try {
    const info = await stat(appPath);
    if (!info.isFile() && !(process.platform === 'darwin' && info.isDirectory())) {
      return { launched: false, error: 'unsupported' };
    }
  } catch {
    return { launched: false, error: 'not_found' };
  }
  const errorMessage = await shell.openPath(appPath);
  return errorMessage ? { launched: false, error: 'open_failed' } : { launched: true };
};

const triggerShortcutAction = (action: WinkGoShortcutAction): boolean => {
  if (action === 'toggleIsland') {
    toggleDesktopIslandVisibility();
    return true;
  }
  showDesktopIsland();
  ipcBridge.winkGoFiles.command.emit({ type: action });
  return true;
};

const resolveDefaultFileShelfFolder = (): string => {
  const documents = app.getPath('documents');
  const current = nodePath.join(documents, process.platform === 'win32' ? 'WINK GO 收纳箱' : 'WINK GO Inbox');
  const legacy = nodePath.join(documents, process.platform === 'win32' ? 'WINK GO 收纳箱' : 'WINK GO Inbox');
  return existsSync(legacy) && !existsSync(current) ? legacy : current;
};

/** Registers local file organizer IPC and its opt-in desktop shortcuts. */
export function initWinkGoFilesBridge(): void {
  ipcMain.handle('winkgo-files:persist-dropped-file', (event, payload: VirtualDroppedFile) => {
    if (!isTrustedIpcSender(event, ['main', 'island'])) throw new Error('IPC_FORBIDDEN');
    if (
      !payload ||
      typeof payload !== 'object' ||
      !(payload.data instanceof ArrayBuffer) ||
      typeof payload.name !== 'string' ||
      payload.name.length > 512 ||
      (payload.type !== undefined && (typeof payload.type !== 'string' || payload.type.length > 256))
    ) {
      throw new Error('INVALID_DROPPED_FILE');
    }
    return persistVirtualDroppedFile(payload);
  });
  ipcBridge.winkGoFiles.getDefaultFolder.provider(resolveDefaultFileShelfFolder);
  ipcBridge.winkGoFiles.organize.provider((request) => organizeWinkGoFiles(request));
  ipcBridge.winkGoFiles.undo.provider(({ operations }) => undoWinkGoFiles(operations));
  ipcBridge.winkGoFiles.showItemInFolder.provider(async ({ path: filePath }) => {
    if (!(await canRevealWinkGoFile(filePath))) throw new Error('FILE_NOT_FOUND');
    shell.showItemInFolder(filePath);
  });
  ipcBridge.winkGoFiles.selectQuickApps.provider(() => selectQuickApps());
  ipcBridge.winkGoFiles.refreshQuickApps.provider((payload) => refreshQuickApps(payload));
  ipcBridge.winkGoFiles.launchQuickApp.provider((payload) => launchQuickApp(payload));
  ipcBridge.winkGoFiles.activateShortcuts.provider(() => activateShortcuts());
  ipcBridge.winkGoFiles.triggerShortcutAction.provider(({ action }) => triggerShortcutAction(action));

  app.on('will-quit', () => {
    for (const shortcut of Object.values(SHORTCUTS)) {
      if (globalShortcut.isRegistered(shortcut)) globalShortcut.unregister(shortcut);
    }
  });
}
