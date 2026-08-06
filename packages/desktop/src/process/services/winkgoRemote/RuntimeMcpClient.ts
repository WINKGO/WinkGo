/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket, { type RawData } from 'ws';
import type { WinkGoRemoteCommandResult, WinkGoRemoteExecutionContext } from './core';

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export type WinkGoRuntimeMcpConfig = {
  runtimeApi: string;
  token: string | null;
};

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toMcpEndpoint = (runtimeApi: string): URL => {
  const endpoint = new URL(runtimeApi);
  if (!['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname.toLowerCase())) {
    throw new Error('Runtime MCP 只允许连接本机。');
  }
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  endpoint.pathname = '/mcp';
  endpoint.search = '';
  endpoint.hash = '';
  return endpoint;
};

const extractText = (value: unknown): string => {
  if (!value || typeof value !== 'object') return asText(value);
  const record = value as Record<string, unknown>;
  const content = Array.isArray(record.content) ? record.content : [];
  const combined = content
    .map((item) => {
      if (!item || typeof item !== 'object') return '';
      return asText((item as Record<string, unknown>).text);
    })
    .filter(Boolean)
    .join('\n')
    .trim();
  if (combined) return combined;
  return asText(record.text) || asText(record.message);
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const normalizeRuntimeCommandResult = (value: unknown): WinkGoRemoteCommandResult => {
  const result = asRecord(value);
  const rawText = extractText(result) || '电脑端已执行，但没有返回可展示的结果。';
  let payload = asRecord(result?.structuredContent);
  if (!payload) {
    try {
      payload = asRecord(JSON.parse(rawText));
    } catch {
      payload = null;
    }
  }
  const executionStatus = asText(payload?.execution_status ?? payload?.status).toLowerCase();
  const failed =
    result?.isError === true ||
    payload?.success === false ||
    payload?.ok === false ||
    payload?.handled === false ||
    ['error', 'failed', 'failure', 'timeout'].includes(executionStatus);
  const spoken = asText(payload?.spoken_summary ?? payload?.message ?? payload?.error);
  const text = spoken || rawText;
  return {
    ok: !failed,
    text: text.length > 1_200 ? `${text.slice(0, 1_200)}...` : text,
    raw: value,
  };
};

type ExecutionContextArgument = 'execution_context' | 'context' | null;

export const detectExecutionContextArgument = (value: unknown): ExecutionContextArgument => {
  if (!value || typeof value !== 'object') return null;
  const tools = (value as Record<string, unknown>).tools;
  if (!Array.isArray(tools)) return null;
  const commandTool = tools.find(
    (tool) =>
      tool && typeof tool === 'object' && asText((tool as Record<string, unknown>).name) === 'tools.run_skill_command'
  );
  if (!commandTool || typeof commandTool !== 'object') return null;
  const tool = commandTool as Record<string, unknown>;
  const schemaCandidate = tool.inputSchema ?? tool.input_schema;
  if (!schemaCandidate || typeof schemaCandidate !== 'object') return null;
  const properties = (schemaCandidate as Record<string, unknown>).properties;
  if (!properties || typeof properties !== 'object') return null;
  const record = properties as Record<string, unknown>;
  if ('execution_context' in record) return 'execution_context';
  if ('context' in record) return 'context';
  return null;
};

const serializeExecutionContext = (context: WinkGoRemoteExecutionContext): Record<string, string> => ({
  account_id: context.accountId,
  installation_id: context.installationId,
  desktop_id: context.desktopId,
  agent_id: context.agentId,
  session_id: context.sessionId,
  task_id: context.taskId,
});

export class RuntimeMcpClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private config: WinkGoRuntimeMcpConfig;
  private nextId = 1;
  private generation = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private executionContextArgument: ExecutionContextArgument = null;

  constructor(config: WinkGoRuntimeMcpConfig) {
    this.config = { ...config };
  }

  updateConfig(config: WinkGoRuntimeMcpConfig): void {
    const previous = `${this.config.runtimeApi}\u0000${this.config.token || ''}`;
    const next = `${config.runtimeApi}\u0000${config.token || ''}`;
    this.config = { ...config };
    if (previous !== next) this.close('Runtime 配置已更新。');
  }

  async runSkillCommand(
    command: string,
    source: string,
    options: {
      signal?: AbortSignal;
      timeoutMs?: number;
      context?: WinkGoRemoteExecutionContext;
    } = {}
  ): Promise<WinkGoRemoteCommandResult> {
    await this.ensureConnected();
    const toolArguments: Record<string, unknown> = { command, source };
    if (options.context && this.executionContextArgument) {
      toolArguments[this.executionContextArgument] = serializeExecutionContext(options.context);
    }
    const result = (await this.request(
      'tools/call',
      {
        name: 'tools.run_skill_command',
        arguments: toolArguments,
      },
      options.timeoutMs ?? 60_000,
      options.signal
    )) as Record<string, unknown> | null;
    return normalizeRuntimeCommandResult(result);
  }

  async ping(timeoutMs = 1_500): Promise<boolean> {
    try {
      await this.ensureConnected();
      await this.request('ping', {}, timeoutMs);
      return true;
    } catch {
      return false;
    }
  }

  close(reason = 'Runtime MCP 已关闭。'): void {
    this.generation += 1;
    this.connectPromise = null;
    this.executionContextArgument = null;
    const current = this.socket;
    this.socket = null;
    if (current) {
      current.removeAllListeners();
      try {
        current.close(1000, 'client_close');
      } catch {
        current.terminate();
      }
    }
    this.rejectPending(new Error(reason));
  }

  private async ensureConnected(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    const generation = ++this.generation;
    const endpoint = toMcpEndpoint(this.config.runtimeApi);
    const token = asText(this.config.token).replace(/^Bearer\s+/i, '');
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(endpoint, {
        handshakeTimeout: 3_500,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      this.socket = socket;
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(() => {
        socket.terminate();
        finish(() => reject(new Error('Runtime MCP 连接超时。')));
      }, 4_000);
      socket.on('message', (data) => this.handleMessage(data));
      socket.once('open', () => finish(resolve));
      socket.once('error', (error) => {
        if (generation === this.generation) this.socket = null;
        finish(() => reject(error));
      });
      socket.once('close', () => {
        if (generation !== this.generation) return;
        this.socket = null;
        this.connectPromise = null;
        this.rejectPending(new Error('Runtime MCP 连接已断开。'));
      });
    })
      .then(async () => {
        await this.request(
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'WINK GO Desktop Gateway', version: '1.0.0' },
          },
          4_000
        );
        this.sendNotification('notifications/initialized', {});
        try {
          const tools = await this.request('tools/list', {}, 4_000);
          this.executionContextArgument = detectExecutionContextArgument(tools);
        } catch {
          // Older Runtime versions do not expose tools/list. Keep the exact
          // legacy command shape instead of sending an unsupported field.
          this.executionContextArgument = null;
        }
      })
      .catch((error) => {
        if (generation === this.generation) {
          this.socket?.terminate();
          this.socket = null;
        }
        throw error;
      })
      .finally(() => {
        if (generation === this.generation) this.connectPromise = null;
      });
    return this.connectPromise;
  }

  private request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Runtime MCP 尚未连接。'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const finish = (callback: () => void): void => {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        signal?.removeEventListener('abort', onAbort);
        callback();
      };
      const onAbort = (): void => finish(() => reject(new Error('Runtime 指令已取消。')));
      const timer = setTimeout(
        () => finish(() => reject(new Error('Runtime 指令执行超时。'))),
        Math.max(500, timeoutMs)
      );
      this.pending.set(id, {
        resolve: (value) => finish(() => resolve(value)),
        reject: (error) => finish(() => reject(error)),
        timer,
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      try {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (error) {
        finish(() => reject(error instanceof Error ? error : new Error(String(error))));
      }
    });
  }

  private sendNotification(method: string, params: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
  }

  private handleMessage(data: RawData): void {
    let payload: JsonRpcResponse;
    try {
      payload = JSON.parse(Buffer.isBuffer(data) ? data.toString('utf8') : String(data)) as JsonRpcResponse;
    } catch {
      return;
    }
    if (!Number.isInteger(payload.id)) return;
    const pending = this.pending.get(Number(payload.id));
    if (!pending) return;
    if (payload.error) {
      pending.reject(new Error(asText(payload.error.message) || `Runtime MCP 错误 ${payload.error.code || ''}`));
    } else {
      pending.resolve(payload.result);
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
