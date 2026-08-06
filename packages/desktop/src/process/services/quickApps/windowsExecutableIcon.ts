/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFile } from 'node:child_process';
import nodePath from 'node:path';

const MAX_ICON_DATA_URL_LENGTH = 1024 * 1024;
const MAX_ICON_PATH_LENGTH = 2048;
const MAX_CACHE_ENTRIES = 128;
const EXECUTABLE_ICON_EXTENSIONS = new Set(['.cpl', '.dll', '.exe', '.scr']);
const iconCache = new Map<string, Promise<string>>();

const POWERSHELL_ICON_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Drawing',
  '$icon=[System.Drawing.Icon]::ExtractAssociatedIcon($env:WINKGO_ICON_SOURCE)',
  'if($null -eq $icon){exit 2}',
  'try{',
  '$bitmap=$icon.ToBitmap()',
  '$stream=New-Object System.IO.MemoryStream',
  'try{',
  '$bitmap.Save($stream,[System.Drawing.Imaging.ImageFormat]::Png)',
  '[Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))',
  '}finally{$stream.Dispose();$bitmap.Dispose()}',
  '}finally{$icon.Dispose()}',
].join(';');

const runExtraction = (executablePath: string): Promise<string> =>
  new Promise((resolve) => {
    const powershell = nodePath.win32.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    );
    execFile(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_ICON_SCRIPT],
      {
        encoding: 'utf8',
        env: { ...process.env, WINKGO_ICON_SOURCE: executablePath },
        maxBuffer: 2 * 1024 * 1024,
        timeout: 10_000,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          resolve('');
          return;
        }
        const base64 = stdout.trim();
        if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
          resolve('');
          return;
        }
        const dataUrl = `data:image/png;base64,${base64}`;
        resolve(dataUrl.length <= MAX_ICON_DATA_URL_LENGTH ? dataUrl : '');
      }
    );
  });

/** Extracts the embedded Windows PE icon without relying on the stale Shell icon cache. */
export const extractWindowsExecutableIconDataUrl = async (candidate: string): Promise<string> => {
  if (process.platform !== 'win32' || typeof candidate !== 'string' || candidate.length > MAX_ICON_PATH_LENGTH) {
    return '';
  }
  const normalized = nodePath.win32.normalize(candidate);
  if (
    !nodePath.win32.isAbsolute(normalized) ||
    !EXECUTABLE_ICON_EXTENSIONS.has(nodePath.win32.extname(normalized).toLocaleLowerCase())
  ) {
    return '';
  }

  const cacheKey = normalized.toLocaleLowerCase();
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;

  const extraction = runExtraction(normalized).then((dataUrl) => {
    if (!dataUrl) iconCache.delete(cacheKey);
    return dataUrl;
  });
  iconCache.set(cacheKey, extraction);
  if (iconCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = iconCache.keys().next().value;
    if (oldestKey) iconCache.delete(oldestKey);
  }
  return extraction;
};
