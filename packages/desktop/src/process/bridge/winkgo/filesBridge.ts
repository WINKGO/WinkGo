/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app, globalShortcut, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import nodePath from 'node:path';
import { ipcBridge } from '@/common';
import type { WinkGoShortcutAction } from '@/common/adapter/ipcBridge';
import { isTrustedIpcSender } from '@/common/platform/electronSecurity';
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
  toggleIsland: 'Alt+6',
} as const;

let shortcutsActivated = false;
const MAX_VIRTUAL_DROP_BYTES = 64 * 1024 * 1024;

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

const registerShortcut = (shortcut: string, type: 'openMemo' | 'openShelf' | 'newCategory' | 'openFormat'): boolean => {
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
    toggleIsland,
  };
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
  ipcBridge.winkGoFiles.activateShortcuts.provider(() => activateShortcuts());
  ipcBridge.winkGoFiles.triggerShortcutAction.provider(({ action }) => triggerShortcutAction(action));

  app.on('will-quit', () => {
    for (const shortcut of Object.values(SHORTCUTS)) {
      if (globalShortcut.isRegistered(shortcut)) globalShortcut.unregister(shortcut);
    }
  });
}
