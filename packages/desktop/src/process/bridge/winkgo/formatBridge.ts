/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WinkGoFormatEngineStatus, WinkGoFormatPreset } from '@/common/adapter/ipcBridge';
import { ipcBridge } from '@/common';
import {
  detectWinkGoFormatEngines,
  ensureWinkGoFormatOutputFolder,
  runWinkGoFormatConversion,
} from '@process/services/WinkGoFormatConverterService';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const extensionsByPreset: Record<WinkGoFormatPreset, string[]> = {
  ncm_to_mp3: ['ncm'],
  video_to_mp4: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'ts'],
  video_compress: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v', 'ts'],
  gif_compress: ['gif'],
  audio_to_mp3: ['wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'mp3'],
  image_compress: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'tif', 'tiff'],
  document_to_pdf: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp'],
};

const filterNameByPreset: Record<WinkGoFormatPreset, string> = {
  ncm_to_mp3: '网易云 NCM 音频',
  video_to_mp4: '视频文件',
  video_compress: '视频文件',
  gif_compress: 'GIF 动图',
  audio_to_mp3: '音频文件',
  image_compress: '图片文件',
  document_to_pdf: '办公文档',
};

const mainWindow = (): BrowserWindow | undefined =>
  BrowserWindow.getAllWindows()
    .filter((window) => !window.isDestroyed())
    .toSorted((left, right) => {
      const leftBounds = left.getBounds();
      const rightBounds = right.getBounds();
      return rightBounds.width * rightBounds.height - leftBounds.width * leftBounds.height;
    })[0];

const resolveDefaultFormatOutputFolder = (): string => {
  const documents = app.getPath('documents');
  const current = path.join(documents, 'WINK GO 格式转换');
  const legacy = path.join(documents, 'WINK GO 格式转换');
  return existsSync(legacy) && !existsSync(current) ? legacy : current;
};

/** Registers the local-only WINK GO format workbench bridge. */
export function initWinkGoFormatBridge(): void {
  ipcBridge.winkGoFormat.detectEngines.provider(() =>
    detectWinkGoFormatEngines().catch(
      (): WinkGoFormatEngineStatus => ({
        ffmpegAvailable: false,
        ffmpegPath: null,
        officeAvailable: false,
        officePath: null,
        officeEngine: null,
        ncmAvailable: true,
      })
    )
  );
  ipcBridge.winkGoFormat.getDefaultOutputFolder.provider(() =>
    ensureWinkGoFormatOutputFolder(resolveDefaultFormatOutputFolder()).catch(() => '')
  );
  ipcBridge.winkGoFormat.selectFiles.provider(async ({ preset }): Promise<string[]> => {
    try {
      const owner = mainWindow();
      const options: Electron.OpenDialogOptions = {
        title: '选择需要转换的文件',
        buttonLabel: '添加到格式台',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: filterNameByPreset[preset], extensions: extensionsByPreset[preset] },
          { name: '所有文件', extensions: ['*'] },
        ],
      };
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
      return result.canceled ? [] : result.filePaths.slice(0, 64);
    } catch {
      return [];
    }
  });
  ipcBridge.winkGoFormat.chooseOutputFolder.provider(async ({ defaultPath }): Promise<string | null> => {
    try {
      const owner = mainWindow();
      const options: Electron.OpenDialogOptions = {
        title: '选择 WINK GO 转换输出目录',
        buttonLabel: '选择此文件夹',
        defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      };
      const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    } catch {
      return null;
    }
  });
  ipcBridge.winkGoFormat.openOutput.provider(async ({ path: targetPath }) => {
    const info = await stat(targetPath).catch((): null => null);
    if (!info) return;
    if (info.isDirectory()) {
      await shell.openPath(targetPath);
      return;
    }
    shell.showItemInFolder(targetPath);
  });
  ipcBridge.winkGoFormat.startConversion.provider(async (request) => {
    try {
      return await runWinkGoFormatConversion(request, (progress) => ipcBridge.winkGoFormat.progress.emit(progress));
    } catch (error) {
      return {
        jobId: request.jobId,
        preset: request.preset,
        outputFolder: request.outputFolder,
        items: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
