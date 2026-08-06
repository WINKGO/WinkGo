/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import nodePath from 'node:path';

const MAX_ICON_PATH_LENGTH = 2048;
const MAX_ICON_DATA_URL_LENGTH = 1024 * 1024;

export type QuickAppIconImage = {
  isEmpty: () => boolean;
  resize?: (options: { height: number; quality?: 'best' | 'better' | 'good'; width: number }) => QuickAppIconImage;
  toDataURL: () => string;
};

type QuickAppShortcutDetails = {
  icon?: string;
  target?: string;
};

type QuickAppIconDependencies = {
  createImageFromPath: (path: string) => QuickAppIconImage;
  env: Record<string, string | undefined>;
  extractExecutableIconDataUrl?: (path: string) => Promise<string>;
  getFileIcon: (path: string) => Promise<QuickAppIconImage>;
  platform: NodeJS.Platform;
  readShortcutLink: (path: string) => QuickAppShortcutDetails;
};

type QuickAppIconCandidate = {
  path: string;
  shellFirst: boolean;
};

const WINDOWS_SHELL_ICON_EXTENSIONS = new Set(['.cpl', '.dll', '.exe', '.lnk', '.msi', '.scr']);

const expandWindowsEnvironmentVariables = (value: string, env: QuickAppIconDependencies['env']): string =>
  value.replace(/%([^%]+)%/g, (match, requestedName: string) => {
    const key = Object.keys(env).find(
      (candidate) => candidate.toLocaleUpperCase() === requestedName.toLocaleUpperCase()
    );
    return key && env[key] ? env[key] : match;
  });

const normalizeIconPath = (
  value: unknown,
  { env, platform }: Pick<QuickAppIconDependencies, 'env' | 'platform'>
): string => {
  if (typeof value !== 'string') return '';
  let normalizedValue = value.trim();
  if (platform === 'win32') {
    // Windows shortcut icon locations commonly use `"C:\\app.exe",0` or
    // `C:\\app.exe,-32512`. The suffix is a PE resource index, not part of
    // the filesystem path, so passing it to nativeImage/app.getFileIcon makes
    // Electron return an empty or generic application image.
    const quotedLocation = normalizedValue.match(/^"([^"]+)"(?:,\s*-?\d+)?$/);
    normalizedValue = quotedLocation?.[1] || normalizedValue.replace(/,\s*-?\d+\s*$/, '').replace(/^"|"$/g, '');
  }
  const expanded = platform === 'win32' ? expandWindowsEnvironmentVariables(normalizedValue, env) : normalizedValue;
  if (!expanded || expanded.length > MAX_ICON_PATH_LENGTH) return '';
  const paths = platform === 'win32' ? nodePath.win32 : nodePath;
  return paths.isAbsolute(expanded) ? paths.normalize(expanded) : '';
};

const shouldPreferShellIcon = (candidate: string, platform: NodeJS.Platform): boolean =>
  platform === 'win32' && WINDOWS_SHELL_ICON_EXTENSIONS.has(nodePath.win32.extname(candidate).toLocaleLowerCase());

const imageDataUrl = (source: QuickAppIconImage): string => {
  if (source.isEmpty()) return '';
  let image = source;
  try {
    image = source.resize?.({ width: 64, height: 64, quality: 'best' }) || source;
  } catch {
    image = source;
  }
  if (image.isEmpty()) return '';
  const dataUrl = image.toDataURL();
  return dataUrl.startsWith('data:image/') && dataUrl.length <= MAX_ICON_DATA_URL_LENGTH ? dataUrl : '';
};

/** Resolves real application artwork for executables and Windows shortcuts. */
export async function loadQuickAppIconDataUrl(
  appPath: string,
  dependencies: QuickAppIconDependencies
): Promise<string> {
  const normalizedAppPath = normalizeIconPath(appPath, dependencies);
  if (!normalizedAppPath) return '';

  const candidates: QuickAppIconCandidate[] = [];
  const addCandidate = (rawPath: unknown) => {
    const candidate = normalizeIconPath(rawPath, dependencies);
    if (!candidate) return;
    candidates.push({
      path: candidate,
      shellFirst: shouldPreferShellIcon(candidate, dependencies.platform),
    });
  };
  if (dependencies.platform === 'win32' && nodePath.win32.extname(normalizedAppPath).toLocaleLowerCase() === '.lnk') {
    try {
      const shortcut = dependencies.readShortcutLink(normalizedAppPath);
      addCandidate(shortcut.icon);
      addCandidate(shortcut.target);
    } catch {
      // Some shell shortcuts cannot be decoded; the shortcut itself remains a valid fallback.
    }
  }
  addCandidate(normalizedAppPath);

  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = dependencies.platform === 'win32' ? candidate.path.toLocaleLowerCase() : candidate.path;
    if (seen.has(key)) continue;
    seen.add(key);

    const loaders = candidate.shellFirst
      ? [
          async () => dependencies.extractExecutableIconDataUrl?.(candidate.path),
          async () => dependencies.getFileIcon(candidate.path),
          async () => dependencies.createImageFromPath(candidate.path),
        ]
      : [
          async () => dependencies.createImageFromPath(candidate.path),
          async () => dependencies.getFileIcon(candidate.path),
        ];
    for (const load of loaders) {
      try {
        // Executables, DLLs and shortcuts must go through the Windows Shell
        // first. nativeImage.createFromPath is for image files and may expose a
        // generic placeholder for PE files instead of their embedded artwork.
        // eslint-disable-next-line no-await-in-loop
        const loaded = await load();
        const icon = typeof loaded === 'string' ? loaded : loaded ? imageDataUrl(loaded) : '';
        if (icon) return icon;
      } catch {
        // Continue through the direct-image and OS-shell fallbacks.
      }
    }
  }
  return '';
}
