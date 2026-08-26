/**
 * @license
 * Copyright 2026 WINK GO contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { BROWSER_SESSION_PARTITION } from '@/common/config/constants';

export const REMOTE_WEBVIEW_PARTITION = 'winkgo-remote-webview';
export const HTML_PREVIEW_WEBVIEW_PARTITION = 'winkgo-local-html-preview';
export const PDF_PREVIEW_WEBVIEW_PARTITION = 'winkgo-local-pdf-preview';
export const EXTENSION_SETTINGS_PARTITION_PREFIX = 'persist:ext-settings-';

const PDF_VIEWER_EXTENSION_ORIGIN = 'chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai';
const MAX_EXTERNAL_URL_LENGTH = 8 * 1024;
const MAX_EXTENSION_PARTITION_SUFFIX_LENGTH = 128;

export type TrustedWindowRole = 'main' | 'island' | 'automation-overlay' | 'pet-render' | 'pet-hit' | 'pet-confirm';

export type TrustedWindowUrlPolicy = {
  devOrigin?: string;
  productionEntryUrl: string;
  role: TrustedWindowRole;
};

type IpcSenderEvent = Pick<IpcMainEvent | IpcMainInvokeEvent, 'sender' | 'senderFrame'>;

const trustedWindowPolicies = new Map<number, TrustedWindowUrlPolicy>();

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizedUrlWithoutDocumentLocation(value: string): string | null {
  const parsed = parseUrl(value);
  if (!parsed) return null;
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString();
}

export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function resolveTrustedDevServerUrl(value?: string): string | null {
  if (!value || value.length > MAX_EXTERNAL_URL_LENGTH) return null;
  const parsed = parseUrl(value.trim());
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) return null;
  if (!isLoopbackHostname(parsed.hostname) || parsed.username || parsed.password) return null;
  parsed.hash = '';
  return parsed.toString();
}

export function getSafeExternalOpenUrl(value: string): string | null {
  if (!value || value.length > MAX_EXTERNAL_URL_LENGTH || hasControlCharacters(value)) return null;
  const parsed = parseUrl(value.trim());
  if (!parsed || !['http:', 'https:', 'mailto:'].includes(parsed.protocol)) return null;
  if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && (parsed.username || parsed.password)) {
    return null;
  }
  return parsed.toString();
}

export function isSafeExternalOpenUrl(value: string): boolean {
  return getSafeExternalOpenUrl(value) !== null;
}

export function isExtensionSettingsPartition(partition: string): boolean {
  if (!partition.startsWith(EXTENSION_SETTINGS_PARTITION_PREFIX)) return false;
  const suffix = partition.slice(EXTENSION_SETTINGS_PARTITION_PREFIX.length);
  return (
    suffix.length > 0 && suffix.length <= MAX_EXTENSION_PARTITION_SUFFIX_LENGTH && /^[a-zA-Z0-9._-]+$/u.test(suffix)
  );
}

export function isAllowedWebviewPartition(partition: string): boolean {
  return (
    partition === REMOTE_WEBVIEW_PARTITION ||
    partition === BROWSER_SESSION_PARTITION ||
    partition === HTML_PREVIEW_WEBVIEW_PARTITION ||
    partition === PDF_PREVIEW_WEBVIEW_PARTITION ||
    isExtensionSettingsPartition(partition)
  );
}

function isBlankUrl(parsed: URL): boolean {
  return parsed.protocol === 'about:' && parsed.pathname === 'blank';
}

function isAllowedRemoteWebviewUrl(parsed: URL): boolean {
  if (isBlankUrl(parsed)) return true;
  if (parsed.protocol === 'https:') return !parsed.username && !parsed.password;
  return parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname) && !parsed.username && !parsed.password;
}

function isAllowedLocalPreviewUrl(parsed: URL, partition: string): boolean {
  if (isBlankUrl(parsed) || parsed.protocol === 'file:' || parsed.protocol === 'blob:') return true;
  if (parsed.protocol === 'data:') {
    const mimePrefix = partition === PDF_PREVIEW_WEBVIEW_PARTITION ? 'data:application/pdf' : 'data:text/html';
    return parsed.href.toLowerCase().startsWith(mimePrefix);
  }
  return (
    partition === PDF_PREVIEW_WEBVIEW_PARTITION &&
    parsed.protocol === 'chrome-extension:' &&
    parsed.origin === PDF_VIEWER_EXTENSION_ORIGIN
  );
}

export function isAllowedWebviewNavigationUrl(value: string, partition: string): boolean {
  if (!isAllowedWebviewPartition(partition)) return false;
  const parsed = parseUrl(value);
  if (!parsed) return false;

  if (
    partition === REMOTE_WEBVIEW_PARTITION ||
    partition === BROWSER_SESSION_PARTITION ||
    isExtensionSettingsPartition(partition)
  ) {
    return isAllowedRemoteWebviewUrl(parsed);
  }
  return isAllowedLocalPreviewUrl(parsed, partition);
}

export function isTrustedApplicationUrl(value: string, policy: TrustedWindowUrlPolicy): boolean {
  const parsed = parseUrl(value);
  if (!parsed) return false;

  if (parsed.protocol === 'file:') {
    return (
      normalizedUrlWithoutDocumentLocation(value) === normalizedUrlWithoutDocumentLocation(policy.productionEntryUrl)
    );
  }

  return (
    Boolean(policy.devOrigin) &&
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.origin === policy.devOrigin
  );
}

export function registerTrustedWebContents(webContentsId: number, policy: TrustedWindowUrlPolicy): () => void {
  trustedWindowPolicies.set(webContentsId, policy);
  return () => {
    if (trustedWindowPolicies.get(webContentsId) === policy) {
      trustedWindowPolicies.delete(webContentsId);
    }
  };
}

export function isTrustedWebContentsUrl(
  webContentsId: number,
  value: string,
  allowedRoles: readonly TrustedWindowRole[]
): boolean {
  const policy = trustedWindowPolicies.get(webContentsId);
  return Boolean(policy && allowedRoles.includes(policy.role) && isTrustedApplicationUrl(value, policy));
}

export function isTrustedIpcSender(event: IpcSenderEvent, allowedRoles: readonly TrustedWindowRole[]): boolean {
  const senderFrame = event.senderFrame;
  const mainFrame = event.sender.mainFrame;
  if (!senderFrame || !mainFrame || senderFrame.frameTreeNodeId !== mainFrame.frameTreeNodeId) return false;

  return isTrustedWebContentsUrl(event.sender.id, senderFrame.url, allowedRoles);
}

export type TrustedPermissionDecision = {
  isMainFrame: boolean;
  isTrustedUrl: boolean;
  mediaType?: 'audio' | 'unknown' | 'video';
  mediaTypes?: readonly ('audio' | 'video')[];
  permission: string;
  role: TrustedWindowRole;
};

export function shouldGrantTrustedPermission({
  isMainFrame,
  isTrustedUrl,
  mediaType,
  mediaTypes,
  permission,
  role,
}: TrustedPermissionDecision): boolean {
  if (role !== 'main' || !isMainFrame || !isTrustedUrl) return false;
  if (permission === 'notifications' || permission === 'clipboard-sanitized-write') return true;
  if (permission !== 'media') return false;
  if (mediaTypes) return mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio');
  return mediaType === 'audio';
}

export function getTrustedWindowPolicy(webContentsId: number): TrustedWindowUrlPolicy | undefined {
  return trustedWindowPolicies.get(webContentsId);
}
