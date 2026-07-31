// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BrowserWindow } from 'electron';
import { ipcBridge } from '@/common';
import { hasControlCharacters } from '@/common/platform/electronSecurity';
import { normalizeWinkGoBuildEdition } from '@/common/types/platform/winkGoEdition';

export const PROTOCOL_SCHEME =
  normalizeWinkGoBuildEdition(process.env.WINKGO_EDITION) === 'pro' ? 'winkgopro' : 'winkgo';
const ACCEPTED_PROTOCOL_SCHEMES = new Set([PROTOCOL_SCHEME]);
const MAX_DEEP_LINK_URL_LENGTH = 8 * 1024;
const MAX_DEEP_LINK_DATA_LENGTH = 4 * 1024;
const SENSITIVE_DEEP_LINK_KEYS = new Set(['api_key', 'key', 'access_token', 'password', 'secret', 'token']);
const DANGEROUS_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const ACTION_ALLOWED_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  'add-provider': new Set(['base_url', 'name', 'platform', 'v']),
  'provider/add': new Set(['base_url', 'name', 'platform', 'v']),
  navigate: new Set(['route']),
};

function decodeDeepLinkData(value: string): Record<string, string> | null {
  if (!value || value.length > MAX_DEEP_LINK_DATA_LENGTH) return null;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[a-zA-Z0-9+/]*={0,2}$/u.test(normalized)) return null;

  try {
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    if (Buffer.byteLength(decoded, 'utf8') > MAX_DEEP_LINK_DATA_LENGTH) return null;
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const result: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (DANGEROUS_OBJECT_KEYS.has(key) || SENSITIVE_DEEP_LINK_KEYS.has(key) || typeof entry !== 'string') {
        return null;
      }
      result[key] = entry;
    }
    return result;
  } catch {
    return null;
  }
}

function isValidProviderBaseUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isValidDeepLinkValue(key: string, value: string): boolean {
  if (hasControlCharacters(value)) return false;
  if (key === 'base_url') return isValidProviderBaseUrl(value);
  if (key === 'route') return value.length > 0 && value.length <= 512;
  if (key === 'v') return value.length > 0 && value.length <= 16;
  return value.length > 0 && value.length <= 128;
}

/**
 * Parse a WINK GO deep link into action and params.
 * Supports two formats:
 *   1. winkgo://add-provider?base_url=xxx
 *   2. winkgo://provider/add?v=1&data=<base64 JSON>  (one-api / new-api style)
 *
 * Credentials are deliberately rejected because custom-protocol URLs are
 * exposed to process lists, launch logs, browser history, and crash reports.
 */
export const parseDeepLinkUrl = (url: string): { action: string; params: Record<string, string> } | null => {
  if (!url || url.length > MAX_DEEP_LINK_URL_LENGTH) return null;
  try {
    const parsed = new URL(url);
    if (!ACCEPTED_PROTOCOL_SCHEMES.has(parsed.protocol.replace(/:$/, ''))) return null;
    if (parsed.username || parsed.password || parsed.hash) return null;

    const hostname = parsed.hostname || '';
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const action = pathname ? `${hostname}/${pathname}` : hostname;
    const allowedKeys = ACTION_ALLOWED_KEYS[action];
    if (!allowedKeys) return null;

    const params: Record<string, string> = {};
    let encodedData: string | null = null;
    const seenKeys = new Set<string>();
    parsed.searchParams.forEach((value, key) => {
      if (seenKeys.has(key)) {
        encodedData = null;
        params.__duplicate_key__ = key;
        return;
      }
      seenKeys.add(key);
      if (key === 'data') encodedData = value;
      else params[key] = value;
    });
    if (params.__duplicate_key__) return null;

    if (encodedData !== null) {
      const decodedData = decodeDeepLinkData(encodedData);
      if (!decodedData) return null;
      for (const [key, value] of Object.entries(decodedData)) {
        if (Object.prototype.hasOwnProperty.call(params, key)) return null;
        params[key] = value;
      }
    }

    for (const [key, value] of Object.entries(params)) {
      if (
        DANGEROUS_OBJECT_KEYS.has(key) ||
        SENSITIVE_DEEP_LINK_KEYS.has(key) ||
        !allowedKeys.has(key) ||
        !isValidDeepLinkValue(key, value)
      ) {
        return null;
      }
    }
    return { action, params };
  } catch {
    return null;
  }
};

export const isWinkGoDeepLinkUrl = (url: string): boolean => parseDeepLinkUrl(url) !== null;

let mainWindowRef: BrowserWindow | null = null;
let pendingDeepLinkUrl: string | null = process.argv.find(isWinkGoDeepLinkUrl) || null;

export const setDeepLinkMainWindow = (win: BrowserWindow): void => {
  mainWindowRef = win;
};

export const getPendingDeepLinkUrl = (): string | null => pendingDeepLinkUrl;

export const clearPendingDeepLinkUrl = (): void => {
  pendingDeepLinkUrl = null;
};

/**
 * Send the deep-link payload to the renderer via IPC bridge.
 * If the window isn't ready yet, queue it.
 */
export const handleDeepLinkUrl = (url: string): void => {
  const parsed = parseDeepLinkUrl(url);
  if (!parsed) return;

  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    pendingDeepLinkUrl = url;
    return;
  }

  ipcBridge.deepLink.received.emit(parsed);
};
