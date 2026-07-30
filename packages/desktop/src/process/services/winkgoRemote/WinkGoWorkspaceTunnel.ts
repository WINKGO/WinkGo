/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import http, { type ClientRequest, type IncomingHttpHeaders } from 'node:http';
import WebSocket, { type RawData } from 'ws';

const MAX_HTTP_BODY_BYTES = 32 * 1024 * 1024;
const MAX_HTTP_CHUNK_BYTES = 256 * 1024;
const MAX_RELAY_CHUNK_BYTES = 192 * 1024;
const MAX_SOCKET_MESSAGE_BYTES = 8 * 1024 * 1024;
const HTTP_CHANNEL_IDLE_MS = 90_000;
const SOCKET_CHANNEL_IDLE_MS = 10 * 60 * 1000;

type WorkspacePayload = Record<string, unknown> & {
  type?: unknown;
  channelId?: unknown;
  method?: unknown;
  path?: unknown;
  headers?: unknown;
  data?: unknown;
  binary?: unknown;
  protocols?: unknown;
};

type HttpChannel = {
  chain: Promise<void>;
  request: ClientRequest | null;
  bytes: number;
  timer: NodeJS.Timeout | null;
};

type SocketChannel = {
  socket: WebSocket;
  timer: NodeJS.Timeout | null;
};

type DesktopWebUIStatus = {
  running: boolean;
  port: number;
};

const text = (value: unknown, max = 2_048): string => (typeof value === 'string' ? value : '').trim().slice(0, max);

const channelId = (value: unknown): string => {
  const normalized = text(value, 160);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/.test(normalized) ? normalized : '';
};

const safePath = (value: unknown): string => {
  const normalized = text(value, 12_000);
  if (
    !normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    normalized.includes('\0') ||
    /[\r\n\\]/.test(normalized)
  ) {
    return '';
  }
  try {
    const parsed = new URL(normalized, 'http://127.0.0.1');
    const decoded = decodeURIComponent(parsed.pathname);
    if (/(^|\/)\.\.?($|\/)/.test(decoded)) return '';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '';
  }
};

const safeMethod = (value: unknown): string => {
  const normalized = text(value, 16).toUpperCase();
  return ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(normalized) ? normalized : '';
};

const blockedHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'sec-websocket-accept',
  'sec-websocket-extensions',
  'sec-websocket-key',
  'sec-websocket-protocol',
  'sec-websocket-version',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const normalizeHeaders = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim().toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]{1,80}$/.test(name) || blockedHeaders.has(name)) continue;
    const headerValue = Array.isArray(rawValue)
      ? rawValue.map((item) => String(item ?? '')).join(', ')
      : String(rawValue ?? '');
    if (headerValue.includes('\0') || /[\r\n]/.test(headerValue) || headerValue.length > 16_384) continue;
    result[name] = headerValue;
  }
  return result;
};

const responseHeaders = (headers: IncomingHttpHeaders): Record<string, string | string[]> => {
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (blockedHeaders.has(normalized) || value === undefined) continue;
    result[normalized] = Array.isArray(value) ? value.map(String) : String(value);
  }
  return result;
};

const parseProtocols = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => text(item, 128))
    .filter((item) => /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,128}$/.test(item))
    .slice(0, 8);
};

export class WinkGoWorkspaceTunnel {
  private readonly httpChannels = new Map<string, HttpChannel>();
  private readonly socketChannels = new Map<string, SocketChannel>();

  constructor(private readonly send: (payload: Record<string, unknown>) => void) {}

  accept(payload: WorkspacePayload): boolean {
    const type = text(payload.type, 80);
    if (!type.startsWith('workspace.')) return false;
    const id = channelId(payload.channelId);
    if (!id) return true;

    if (type === 'workspace.http.start') {
      this.startHttp(id, payload);
      return true;
    }
    if (type === 'workspace.http.chunk') {
      this.enqueueHttp(id, async (channel) => {
        const chunk = this.decodeChunk(payload.data, MAX_HTTP_CHUNK_BYTES);
        if (!chunk) throw new Error('workspace_http_chunk_invalid');
        channel.bytes += chunk.byteLength;
        if (channel.bytes > MAX_HTTP_BODY_BYTES) throw new Error('workspace_http_body_too_large');
        channel.request?.write(chunk);
      });
      return true;
    }
    if (type === 'workspace.http.end') {
      this.enqueueHttp(id, async (channel) => {
        channel.request?.end();
      });
      return true;
    }
    if (type === 'workspace.http.cancel') {
      this.closeHttp(id, 'workspace_http_cancelled');
      return true;
    }
    if (type === 'workspace.socket.open') {
      void this.openSocket(id, payload);
      return true;
    }
    if (type === 'workspace.socket.data') {
      this.writeSocket(id, payload);
      return true;
    }
    if (type === 'workspace.socket.close') {
      this.closeSocket(id, Number(payload.code || 1000), text(payload.reason, 120));
      return true;
    }
    return true;
  }

  closeAll(reason = 'workspace_tunnel_closed'): void {
    for (const id of this.httpChannels.keys()) this.closeHttp(id, reason);
    for (const id of this.socketChannels.keys()) this.closeSocket(id, 1012, reason);
  }

  private startHttp(id: string, payload: WorkspacePayload): void {
    if (this.httpChannels.has(id)) {
      this.sendError('desktop.workspace.http.error', id, 'workspace_http_channel_conflict');
      return;
    }
    const channel: HttpChannel = {
      chain: Promise.resolve(),
      request: null,
      bytes: 0,
      timer: null,
    };
    this.httpChannels.set(id, channel);
    this.resetHttpTimer(id, channel);
    channel.chain = this.createHttpRequest(id, channel, payload).catch((error) => {
      this.sendError(
        'desktop.workspace.http.error',
        id,
        error instanceof Error ? error.message : 'workspace_http_start_failed'
      );
      this.closeHttp(id, 'workspace_http_start_failed', false);
    });
  }

  private async createHttpRequest(id: string, channel: HttpChannel, payload: WorkspacePayload): Promise<void> {
    const method = safeMethod(payload.method);
    const requestPath = safePath(payload.path);
    if (!method || !requestPath) throw new Error('workspace_http_request_invalid');
    const port = await this.ensureWebUI();
    if (this.httpChannels.get(id) !== channel) return;
    const headers = normalizeHeaders(payload.headers);
    headers.host = `127.0.0.1:${port}`;
    headers.origin = `http://127.0.0.1:${port}`;
    if (headers.referer) headers.referer = `http://127.0.0.1:${port}/`;

    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: requestPath,
        headers,
      },
      (response) => {
        this.send({
          type: 'desktop.workspace.http.start',
          channelId: id,
          statusCode: Number(response.statusCode || 502),
          statusMessage: text(response.statusMessage, 120),
          headers: responseHeaders(response.headers),
        });
        response.on('data', (rawChunk: Buffer | string) => {
          const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
          for (let offset = 0; offset < chunk.byteLength; offset += MAX_RELAY_CHUNK_BYTES) {
            this.send({
              type: 'desktop.workspace.http.chunk',
              channelId: id,
              data: chunk.subarray(offset, offset + MAX_RELAY_CHUNK_BYTES).toString('base64'),
            });
          }
        });
        response.once('end', () => {
          this.send({ type: 'desktop.workspace.http.end', channelId: id });
          this.closeHttp(id, 'workspace_http_complete', false);
        });
        response.once('error', (error) => {
          this.sendError('desktop.workspace.http.error', id, error.message || 'workspace_http_response_failed');
          this.closeHttp(id, 'workspace_http_response_failed', false);
        });
      }
    );
    channel.request = request;
    request.once('error', (error) => {
      if (this.httpChannels.get(id) !== channel) return;
      this.sendError('desktop.workspace.http.error', id, error.message || 'workspace_http_request_failed');
      this.closeHttp(id, 'workspace_http_request_failed', false);
    });
  }

  private enqueueHttp(id: string, action: (channel: HttpChannel) => Promise<void>): void {
    const channel = this.httpChannels.get(id);
    if (!channel) return;
    this.resetHttpTimer(id, channel);
    channel.chain = channel.chain
      .then(() => {
        if (this.httpChannels.get(id) !== channel) return;
        return action(channel);
      })
      .catch((error) => {
        if (this.httpChannels.get(id) !== channel) return;
        this.sendError(
          'desktop.workspace.http.error',
          id,
          error instanceof Error ? error.message : 'workspace_http_stream_failed'
        );
        this.closeHttp(id, 'workspace_http_stream_failed', false);
      });
  }

  private closeHttp(id: string, reason: string, destroy = true): void {
    const channel = this.httpChannels.get(id);
    if (!channel) return;
    this.httpChannels.delete(id);
    if (channel.timer) clearTimeout(channel.timer);
    if (destroy) channel.request?.destroy(new Error(reason));
  }

  private resetHttpTimer(id: string, channel: HttpChannel): void {
    if (channel.timer) clearTimeout(channel.timer);
    channel.timer = setTimeout(() => {
      this.sendError('desktop.workspace.http.error', id, 'workspace_http_timeout');
      this.closeHttp(id, 'workspace_http_timeout');
    }, HTTP_CHANNEL_IDLE_MS);
  }

  private async openSocket(id: string, payload: WorkspacePayload): Promise<void> {
    if (this.socketChannels.has(id)) {
      this.sendError('desktop.workspace.socket.error', id, 'workspace_socket_channel_conflict');
      return;
    }
    const requestPath = safePath(payload.path);
    if (!requestPath || (!requestPath.startsWith('/ws') && !requestPath.startsWith('/api/stt/stream'))) {
      this.sendError('desktop.workspace.socket.error', id, 'workspace_socket_path_invalid');
      return;
    }
    try {
      const port = await this.ensureWebUI();
      const headers = normalizeHeaders(payload.headers);
      headers.host = `127.0.0.1:${port}`;
      headers.origin = `http://127.0.0.1:${port}`;
      const protocols = parseProtocols(payload.protocols);
      const socket = new WebSocket(`ws://127.0.0.1:${port}${requestPath}`, protocols.length ? protocols : undefined, {
        headers,
        perMessageDeflate: false,
        maxPayload: MAX_SOCKET_MESSAGE_BYTES,
      });
      const channel: SocketChannel = { socket, timer: null };
      this.socketChannels.set(id, channel);
      this.resetSocketTimer(id, channel);
      socket.once('open', () => {
        this.send({
          type: 'desktop.workspace.socket.opened',
          channelId: id,
          protocol: socket.protocol || '',
        });
      });
      socket.on('message', (data: RawData, binary: boolean) => {
        this.resetSocketTimer(id, channel);
        const buffer = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data as ArrayBuffer);
        if (buffer.byteLength > MAX_SOCKET_MESSAGE_BYTES) {
          this.sendError('desktop.workspace.socket.error', id, 'workspace_socket_message_too_large');
          this.closeSocket(id, 1009, 'workspace_socket_message_too_large');
          return;
        }
        this.send({
          type: 'desktop.workspace.socket.data',
          channelId: id,
          data: buffer.toString('base64'),
          binary,
        });
      });
      socket.once('close', (code, reason) => {
        this.send({
          type: 'desktop.workspace.socket.closed',
          channelId: id,
          code,
          reason: reason.toString('utf8').slice(0, 120),
        });
        this.deleteSocket(id);
      });
      socket.once('error', (error) => {
        this.sendError('desktop.workspace.socket.error', id, error.message || 'workspace_socket_failed');
      });
    } catch (error) {
      this.sendError(
        'desktop.workspace.socket.error',
        id,
        error instanceof Error ? error.message : 'workspace_socket_open_failed'
      );
    }
  }

  private writeSocket(id: string, payload: WorkspacePayload): void {
    const channel = this.socketChannels.get(id);
    if (!channel || channel.socket.readyState !== WebSocket.OPEN) return;
    const chunk = this.decodeChunk(payload.data, MAX_SOCKET_MESSAGE_BYTES);
    if (!chunk || chunk.byteLength > MAX_SOCKET_MESSAGE_BYTES) {
      this.sendError('desktop.workspace.socket.error', id, 'workspace_socket_message_invalid');
      return;
    }
    this.resetSocketTimer(id, channel);
    channel.socket.send(chunk, { binary: payload.binary === true });
  }

  private closeSocket(id: string, code = 1000, reason = ''): void {
    const channel = this.socketChannels.get(id);
    if (!channel) return;
    const safeCode = Number.isInteger(code) && code >= 1000 && code <= 4999 ? code : 1000;
    try {
      channel.socket.close(safeCode, reason.slice(0, 120));
    } catch {
      channel.socket.terminate();
    }
    this.deleteSocket(id);
  }

  private deleteSocket(id: string): void {
    const channel = this.socketChannels.get(id);
    if (!channel) return;
    this.socketChannels.delete(id);
    if (channel.timer) clearTimeout(channel.timer);
  }

  private resetSocketTimer(id: string, channel: SocketChannel): void {
    if (channel.timer) clearTimeout(channel.timer);
    channel.timer = setTimeout(() => this.closeSocket(id, 1001, 'workspace_socket_idle'), SOCKET_CHANNEL_IDLE_MS);
  }

  private decodeChunk(value: unknown, maxBytes: number): Buffer | null {
    const encoded = text(value, Math.ceil(maxBytes * 1.4) + 8);
    if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
    try {
      const decoded = Buffer.from(encoded, 'base64');
      return decoded.byteLength <= maxBytes ? decoded : null;
    } catch {
      return null;
    }
  }

  private async ensureWebUI(): Promise<number> {
    const { getDesktopWebUIStatus, startDesktopWebUI } = await import('../../utils/webuiConfig');
    let status = getDesktopWebUIStatus() as DesktopWebUIStatus;
    if (!status.running) {
      await startDesktopWebUI({ port: status.port, allowRemote: false });
      status = getDesktopWebUIStatus() as DesktopWebUIStatus;
    }
    if (!status.running || !Number.isInteger(status.port) || status.port < 1 || status.port > 65_535) {
      throw new Error('workspace_webui_unavailable');
    }
    return status.port;
  }

  private sendError(type: string, id: string, error: string): void {
    this.send({
      type,
      channelId: id,
      error: text(error, 240) || 'workspace_tunnel_error',
    });
  }
}
