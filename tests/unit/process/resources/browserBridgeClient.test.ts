/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createBrowserBridgeClient } from '@process/resources/builtinMcp/browserBridgeClient';

describe('WINK GO browser bridge client', () => {
  it('re-discovers the current local bridge token and retries once after a stale-token 401', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, message: 'Unauthorized.' }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:50311/winkgo-cdp?token=fresh-token' }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, value: 'done' }), { status: 200 }));
    const client = createBrowserBridgeClient({
      bridgeUrl: 'http://127.0.0.1:50311',
      bridgeToken: 'stale-token',
      conversationId: 'conversation-1',
      fetchImpl,
    });

    await expect(client.request<{ ok: boolean; value: string }>('/winkgo/desktop-computer-use/run')).resolves.toEqual({
      ok: true,
      value: 'done',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchImpl.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer stale-token');
    expect(fetchImpl.mock.calls[1][0].toString()).toBe('http://127.0.0.1:50311/json/version');
    expect(new Headers(fetchImpl.mock.calls[2][1]?.headers).get('Authorization')).toBe('Bearer fresh-token');
    expect(new Headers(fetchImpl.mock.calls[2][1]?.headers).get('X-WINKGO-Conversation-ID')).toBe('conversation-1');
  });

  it('does not accept a discovery token from a non-loopback websocket endpoint', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, message: 'Unauthorized.' }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ webSocketDebuggerUrl: 'wss://example.com/winkgo-cdp?token=remote-token' }), {
          status: 200,
        })
      );
    const client = createBrowserBridgeClient({
      bridgeUrl: 'http://127.0.0.1:50311',
      bridgeToken: 'stale-token',
      fetchImpl,
    });

    await expect(client.request('/winkgo/desktop-computer-use/run')).rejects.toThrow('Unauthorized.');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
