import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const webUIState = vi.hoisted(() => ({
  port: 0,
  start: vi.fn(),
}));

vi.mock('@process/utils/webuiConfig', () => ({
  getDesktopWebUIStatus: () => ({ running: true, port: webUIState.port }),
  startDesktopWebUI: webUIState.start,
}));

import { WinkGoWorkspaceTunnel } from '@process/services/winkgoRemote/WinkGoWorkspaceTunnel';

type TunnelMessage = Record<string, unknown>;

const waitForMessage = (
  messages: TunnelMessage[],
  predicate: (message: TunnelMessage) => boolean,
  timeoutMs = 2_000
): Promise<TunnelMessage> =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const poll = (): void => {
      const message = messages.find(predicate);
      if (message) {
        resolve(message);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('workspace_tunnel_test_timeout'));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });

describe('WinkGoWorkspaceTunnel', () => {
  let server: http.Server;
  let receivedHost = '';
  let receivedOrigin = '';

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      receivedHost = String(request.headers.host || '');
      receivedOrigin = String(request.headers.origin || '');
      response.setHeader('set-cookie', ['winkgo_session=desktop-only; HttpOnly']);
      response.end('WINK GO workspace');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('workspace_test_server_unavailable');
    webUIState.port = address.port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      })
    );
  });

  it('proxies a workspace request only to the loopback WebUI', async () => {
    const messages: TunnelMessage[] = [];
    const tunnel = new WinkGoWorkspaceTunnel((message) => messages.push(message));

    expect(
      tunnel.accept({
        type: 'workspace.http.start',
        channelId: 'channel-1234',
        method: 'GET',
        path: '/login',
        headers: {
          host: 'attacker.example',
          origin: 'https://attacker.example',
        },
      })
    ).toBe(true);
    tunnel.accept({ type: 'workspace.http.end', channelId: 'channel-1234' });

    const completed = await waitForMessage(messages, (message) => message.type === 'desktop.workspace.http.end');

    expect(completed.channelId).toBe('channel-1234');
    expect(receivedHost).toBe(`127.0.0.1:${webUIState.port}`);
    expect(receivedOrigin).toBe(`http://127.0.0.1:${webUIState.port}`);
  });

  it('fails closed for an invalid path without contacting an external host', async () => {
    const messages: TunnelMessage[] = [];
    const tunnel = new WinkGoWorkspaceTunnel((message) => messages.push(message));

    tunnel.accept({
      type: 'workspace.http.start',
      channelId: 'channel-5678',
      method: 'GET',
      path: '//attacker.example/steal',
    });

    const failed = await waitForMessage(messages, (message) => message.type === 'desktop.workspace.http.error');

    expect(failed.channelId).toBe('channel-5678');
    expect(failed.error).toBe('workspace_http_request_invalid');
  });
});
