/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export type BrowserBridgeClientOptions = {
  bridgeUrl: string;
  bridgeToken: string;
  conversationId?: string;
  fetchImpl?: typeof fetch;
};

type BridgePayload = { message?: string };

const discoverBridgeToken = async (bridgeUrl: string, fetchImpl: typeof fetch): Promise<string | null> => {
  const response = await fetchImpl(new URL('/json/version', bridgeUrl), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;

  const value = (await response.json()) as { webSocketDebuggerUrl?: unknown };
  if (typeof value.webSocketDebuggerUrl !== 'string') return null;
  try {
    const endpoint = new URL(value.webSocketDebuggerUrl);
    if (endpoint.hostname !== '127.0.0.1' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '::1') {
      return null;
    }
    return endpoint.searchParams.get('token')?.trim() || null;
  } catch {
    return null;
  }
};

export const createBrowserBridgeClient = (options: BrowserBridgeClientOptions) => {
  const fetchImpl = options.fetchImpl ?? fetch;
  let bridgeToken = options.bridgeToken.trim();

  const send = (pathname: string, init?: RequestInit) =>
    fetchImpl(new URL(pathname, options.bridgeUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${bridgeToken}`,
        'Content-Type': 'application/json',
        ...(options.conversationId ? { 'X-WINKGO-Conversation-ID': options.conversationId } : {}),
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(180_000),
    });

  const request = async <T>(pathname: string, init?: RequestInit): Promise<T> => {
    let response = await send(pathname, init);
    if (response.status === 401) {
      const refreshedToken = await discoverBridgeToken(options.bridgeUrl, fetchImpl).catch((_error): null => null);
      if (refreshedToken && refreshedToken !== bridgeToken) {
        bridgeToken = refreshedToken;
        response = await send(pathname, init);
      }
    }

    const responseText = await response.text();
    let value: T & BridgePayload;
    try {
      value = JSON.parse(responseText) as T & BridgePayload;
    } catch {
      throw new Error(
        response.ok
          ? 'Browser Skill bridge returned an invalid response.'
          : responseText.trim() || `Browser Skill bridge returned HTTP ${response.status}.`
      );
    }
    if (!response.ok) throw new Error(value.message || `Browser Skill bridge returned HTTP ${response.status}.`);
    return value;
  };

  return { request };
};
