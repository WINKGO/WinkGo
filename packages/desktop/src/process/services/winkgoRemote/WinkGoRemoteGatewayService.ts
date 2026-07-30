/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import WebSocket, { type ClientOptions, type RawData } from 'ws';
import type { WinkGoRemoteGatewaySnapshot } from '@/common/adapter/ipcBridge';
import {
  createWinkGoSecureEnvelope,
  normalizeWinkGoRemoteExecutionContext,
  WinkGoReplayGuard,
  WinkGoTaskCoordinator,
  type WinkGoRemoteExecutionContext,
} from './core';
import { RuntimeMcpClient } from './RuntimeMcpClient';
import { WinkGoRemoteIdentityStore, type WinkGoRemoteIdentity } from './WinkGoRemoteIdentityStore';
import { synthesizeWinkGoSpeechProxyWav } from './SpeechProxy';
import { WinkGoWorkspaceTunnel } from './WinkGoWorkspaceTunnel';

const RELAY_PROTOCOL = 'winkgo.desktop.v2';
const DEFAULT_DESKTOP_AGENT_ID = 'winkgo-desktop-agent';
const HANDSHAKE_TIMEOUT_MS = 12_000;
const STATUS_INTERVAL_MS = 20_000;
const COMMAND_TIMEOUT_MS = 60_000;
const MIN_RECONNECT_MS = 1_500;
const MAX_RECONNECT_MS = 30_000;

export type WinkGoRemoteGatewayConfig = {
  enabled: boolean;
  authorized: boolean;
  accountId: string;
  relayUrl: string;
  runtimeApi: string;
  runtimeToken: string | null;
};

type GatewaySocketFactory = (url: string, protocols: string[], options: ClientOptions) => WebSocket;

type GatewayDependencies = {
  identityStore?: WinkGoRemoteIdentityStore;
  socketFactory?: GatewaySocketFactory;
  runtimeClient?: RuntimeMcpClient;
  speechSynthesizer?: (text: string) => Promise<string>;
  clock?: () => number;
  random?: () => number;
};

type RelayPayload = {
  type?: unknown;
  timestamp?: unknown;
  nonce?: unknown;
  messageId?: unknown;
  accountId?: unknown;
  account_id?: unknown;
  installationId?: unknown;
  installation_id?: unknown;
  desktopId?: unknown;
  desktop_id?: unknown;
  agentId?: unknown;
  agent_id?: unknown;
  sessionId?: unknown;
  session_id?: unknown;
  taskId?: unknown;
  task_id?: unknown;
  text?: unknown;
  transcript?: unknown;
  command?: unknown;
  mode?: unknown;
  skillScope?: unknown;
  speak?: unknown;
  deviceId?: unknown;
  deviceName?: unknown;
  bindingCode?: unknown;
  expiresInSeconds?: unknown;
  requestId?: unknown;
};

const text = (value: unknown, max = 1_200): string =>
  (typeof value === 'string' ? value : '')
    .trim()
    .replace(/\p{Cc}/gu, '')
    .slice(0, max);

const parseRelayUrl = (value: string): URL => {
  const endpoint = new URL(value);
  const host = endpoint.hostname.toLowerCase();
  const isProductionHost = host === 'winkgo.top' || host.endsWith('.winkgo.top');
  const isLocalDevelopment =
    !process.env.NODE_ENV?.toLowerCase().includes('production') && ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (endpoint.protocol !== 'wss:' && !(isLocalDevelopment && endpoint.protocol === 'ws:')) {
    throw new Error('手机绑定中转必须使用安全 WSS 地址。');
  }
  if (!isProductionHost && !isLocalDevelopment) {
    throw new Error('手机绑定中转只允许连接 WINK GO 官方域名。');
  }
  endpoint.pathname = '/desktop';
  endpoint.hash = '';
  return endpoint;
};

const rawDataToText = (data: RawData): string => {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
};

const readUnexpectedResponseBody = async (response: IncomingMessage): Promise<string> => {
  if (typeof response?.on !== 'function') return '';
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8').slice(0, 8_192));
    };
    const timer = setTimeout(finish, 1_500);
    response.on('data', (chunk: Buffer | string) => {
      if (size >= 8_192) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = 8_192 - size;
      chunks.push(buffer.subarray(0, remaining));
      size += Math.min(buffer.byteLength, remaining);
    });
    response.once('end', finish);
    response.once('error', finish);
    response.resume();
  });
};

const relayHandshakeError = (
  statusCode: number,
  body: string
): {
  code: string;
  message: string;
  recoverIdentity: boolean;
  state: WinkGoRemoteGatewaySnapshot['state'];
} => {
  let code = '';
  let serverMessage = '';
  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    code = text(payload.error || payload.code, 96).toLowerCase();
    serverMessage = text(payload.message || payload.detail, 220);
  } catch {
    serverMessage = text(body, 220);
  }
  const known: Record<string, { message: string; recoverIdentity?: boolean }> = {
    desktop_license_mismatch: {
      message: '云端授权与本机桌面身份不一致，WINK GO 正在重新签发本机身份。',
      recoverIdentity: true,
    },
    desktop_identity_invalid: {
      message: '本机桌面身份格式已过期，WINK GO 正在迁移为兼容身份并重连。',
      recoverIdentity: true,
    },
    desktop_token_invalid: {
      message: '本机桌面密钥已失效，WINK GO 正在自动更换密钥并重连。',
      recoverIdentity: true,
    },
    license_device_already_enrolled: {
      message: '当前安装授权已被另一台桌面实例占用，请在设备管理中解绑旧实例。',
    },
    license_assertion_expired: {
      message: '登录授权已过期，请退出 WINK GO 账号后重新登录。',
    },
    license_assertion_invalid: {
      message: '登录授权签名无效，请退出 WINK GO 账号后重新登录。',
    },
    desktop_auth_required: {
      message: '云端要求重新验证当前电脑，请退出 WINK GO 账号后重新登录。',
    },
    desktop_enrollment_rate_limited: {
      message: '本机身份重签过于频繁，请稍后再试。',
    },
  };
  const matched = known[code];
  const authorization = statusCode === 401 || statusCode === 403;
  return {
    code,
    message:
      matched?.message ||
      serverMessage ||
      (authorization
        ? '云端拒绝了当前桌面身份，请重新登录或签发授权。'
        : `手机绑定中转握手失败（HTTP ${statusCode || 'unknown'}）。`),
    recoverIdentity: matched?.recoverIdentity === true,
    state: authorization ? 'waiting_authorization' : 'reconnecting',
  };
};

const closeReason = (code: number): { state: WinkGoRemoteGatewaySnapshot['state']; message: string } => {
  if (code === 4401 || code === 4403) {
    return {
      state: 'waiting_authorization',
      message: '云端授权或账号绑定已失效，请重新登录 WINK GO 后再试。',
    };
  }
  if (code === 4408) {
    return {
      state: 'error',
      message: '中转消息安全校验失败，连接已关闭。',
    };
  }
  if (code === 4409) {
    return {
      state: 'stopped',
      message: '另一台 WINK GO 已接管此桌面身份，本实例已停止自动重连。',
    };
  }
  if (code === 4429) {
    return {
      state: 'reconnecting',
      message: '中转连接过于频繁，稍后自动重试。',
    };
  }
  return {
    state: 'reconnecting',
    message: `手机绑定中转已断开（${code || '网络异常'}），正在自动恢复。`,
  };
};

export class WinkGoRemoteGatewayService {
  private readonly events = new EventEmitter();
  private readonly identityStore: WinkGoRemoteIdentityStore;
  private readonly socketFactory: GatewaySocketFactory;
  private readonly replayGuard: WinkGoReplayGuard;
  private readonly clock: () => number;
  private readonly random: () => number;
  private readonly runtimeClient: RuntimeMcpClient;
  private readonly speechSynthesizer: (text: string) => Promise<string>;
  private readonly tasks: WinkGoTaskCoordinator;
  private readonly workspaceTunnel: WinkGoWorkspaceTunnel;
  private config: WinkGoRemoteGatewayConfig;
  private identity: WinkGoRemoteIdentity | null = null;
  private socket: WebSocket | null = null;
  private generation = 0;
  private manualStop = true;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private handshakeTimer: NodeJS.Timeout | null = null;
  private statusTimer: NodeJS.Timeout | null = null;
  private statusBusy = false;
  private bindingCodeExpiresAt = 0;
  private forceBindingCodeRefreshOnNextStart = false;
  private lastStatusLogKey = '';
  private authorizationSyncKey = '';
  private identityRecoveryAttempted = false;
  private state: WinkGoRemoteGatewaySnapshot = {
    state: 'idle',
    enabled: false,
    connected: false,
    connecting: false,
    accountId: '',
    installationId: '',
    desktopId: '',
    deviceName: '',
    bindingCode: '',
    expiresInSeconds: 0,
    lastConnectedAt: '',
    lastSeenAt: '',
    lastError: '',
    relayUrl: '',
    migratedFromLegacy: false,
    enrolled: false,
    runtimeOnline: false,
    mcpReady: false,
  };

  constructor(config: WinkGoRemoteGatewayConfig, dependencies: GatewayDependencies = {}) {
    this.config = { ...config };
    this.identityStore = dependencies.identityStore ?? new WinkGoRemoteIdentityStore();
    this.socketFactory =
      dependencies.socketFactory ?? ((url, protocols, options) => new WebSocket(url, protocols, options));
    this.clock = dependencies.clock ?? Date.now;
    this.random = dependencies.random ?? Math.random;
    this.replayGuard = new WinkGoReplayGuard(undefined, undefined, this.clock);
    this.runtimeClient =
      dependencies.runtimeClient ??
      new RuntimeMcpClient({
        runtimeApi: config.runtimeApi,
        token: config.runtimeToken,
      });
    this.speechSynthesizer = dependencies.speechSynthesizer ?? synthesizeWinkGoSpeechProxyWav;
    this.tasks = new WinkGoTaskCoordinator(
      (command, source, options) => this.runtimeClient.runSkillCommand(command, source, options),
      { timeoutMs: COMMAND_TIMEOUT_MS, clock: this.clock }
    );
    this.workspaceTunnel = new WinkGoWorkspaceTunnel((payload) => this.send(payload));
  }

  subscribe(listener: (snapshot: WinkGoRemoteGatewaySnapshot) => void): () => void {
    this.events.on('status', listener);
    return () => this.events.off('status', listener);
  }

  async getSnapshot(): Promise<WinkGoRemoteGatewaySnapshot> {
    await this.ensureIdentity();
    return this.snapshot();
  }

  async configure(config: WinkGoRemoteGatewayConfig): Promise<WinkGoRemoteGatewaySnapshot> {
    const previousRelayKey = `${this.config.enabled}\u0000${this.config.authorized}\u0000${this.config.accountId}\u0000${this.config.relayUrl}`;
    const nextRelayKey = `${config.enabled}\u0000${config.authorized}\u0000${config.accountId}\u0000${config.relayUrl}`;
    this.config = { ...config };
    this.runtimeClient.updateConfig({
      runtimeApi: config.runtimeApi,
      token: config.runtimeToken,
    });
    this.state.enabled = config.enabled;
    this.state.relayUrl = config.relayUrl;

    if (previousRelayKey === nextRelayKey) {
      this.emit();
      if (this.state.connected) void this.sendStatus();
      return this.snapshot();
    }

    await this.stop({ preserveEnabled: true, reason: '中转配置已更新。' });
    if (config.enabled) return this.start();
    this.state.state = 'stopped';
    this.emit();
    return this.snapshot();
  }

  async start(): Promise<WinkGoRemoteGatewaySnapshot> {
    try {
      await this.ensureAuthorizedIdentity();
    } catch (error) {
      this.manualStop = false;
      this.state.state = 'waiting_authorization';
      this.state.connecting = false;
      this.state.connected = false;
      this.state.lastError = error instanceof Error ? error.message : '无法读取当前 WINK GO 登录授权。';
      this.emit();
      return this.snapshot();
    }
    this.manualStop = false;
    this.state.enabled = this.config.enabled;
    this.state.relayUrl = this.config.relayUrl;
    if (!this.config.enabled) {
      this.state.state = 'stopped';
      this.state.connecting = false;
      this.state.connected = false;
      this.emit();
      return this.snapshot();
    }
    if (this.socket?.readyState === WebSocket.OPEN || this.state.connecting) {
      return this.snapshot();
    }
    if (!this.config.authorized || !this.config.accountId || !this.identity?.licenseAssertion) {
      this.state.state = 'waiting_authorization';
      this.state.connecting = false;
      this.state.connected = false;
      this.state.lastError = '当前安装尚未取得云端账号授权，未创建不安全的共享身份。';
      this.emit();
      return this.snapshot();
    }
    if (this.identity.accountId && this.identity.accountId !== this.config.accountId) {
      this.state.state = 'waiting_authorization';
      this.state.connecting = false;
      this.state.connected = false;
      this.state.lastError = '这台电脑已绑定到其他 WINK GO 账号，已拒绝跨账号接管。';
      this.emit();
      return this.snapshot();
    }

    let endpoint: URL;
    try {
      endpoint = parseRelayUrl(this.config.relayUrl);
      endpoint.searchParams.set('deviceId', this.identity.desktopId);
      endpoint.searchParams.set('deviceName', this.identity.deviceName);
      endpoint.searchParams.set('accountId', this.identity.accountId);
      endpoint.searchParams.set('installationId', this.identity.installationId);
      endpoint.searchParams.set('desktopId', this.identity.desktopId);
      endpoint.searchParams.set('agentId', DEFAULT_DESKTOP_AGENT_ID);
      if (this.forceBindingCodeRefreshOnNextStart) endpoint.searchParams.set('refreshBindingCode', '1');
    } catch (error) {
      this.state.state = 'error';
      this.state.connecting = false;
      this.state.connected = false;
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.emit();
      return this.snapshot();
    }

    this.clearReconnectTimer();
    const generation = ++this.generation;
    this.state.state = this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting';
    this.state.connecting = true;
    this.state.connected = false;
    this.state.lastError = '';
    this.emit();

    const protocols = [
      RELAY_PROTOCOL,
      `auth.${this.identity.deviceToken}`,
      ...(this.identity.licenseAssertion ? [`license.${this.identity.licenseAssertion}`] : []),
    ];
    let socket: WebSocket;
    try {
      socket = this.socketFactory(endpoint.toString(), protocols, {
        handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
        perMessageDeflate: false,
        maxPayload: 16 * 1024 * 1024,
      });
    } catch (error) {
      this.failGeneration(generation, error instanceof Error ? error.message : '无法创建手机绑定中转连接。');
      return this.snapshot();
    }

    this.socket = socket;
    this.clearHandshakeTimer();
    this.handshakeTimer = setTimeout(() => {
      this.failSocket(socket, generation, '连接 WINK GO 手机绑定中转超时。');
    }, HANDSHAKE_TIMEOUT_MS);

    socket.once('open', () => {
      if (!this.isCurrent(socket, generation)) return;
      this.clearHandshakeTimer();
      this.reconnectAttempt = 0;
      // HTTP 101 only proves the encrypted socket is open. The desktop is
      // usable by the mini-program only after the authenticated relay.hello
      // packet has supplied a valid short-lived binding code.
      this.state.state = 'connecting';
      this.state.connecting = true;
      this.state.connected = false;
      this.state.lastError = '云端加密链路已建立，正在获取 10 位设备绑定码。';
      this.emit();
      this.handshakeTimer = setTimeout(() => {
        this.failSocket(socket, generation, '云端已建立连接，但未返回 10 位设备绑定码，正在自动重连。');
      }, HANDSHAKE_TIMEOUT_MS);
    });
    socket.on('message', (data) => {
      if (!this.isCurrent(socket, generation)) return;
      void this.handleMessage(socket, generation, data);
    });
    socket.once('unexpected-response', (_request, response) => {
      void this.handleUnexpectedResponse(socket, generation, response);
    });
    socket.once('error', () => {
      this.failSocket(socket, generation, '无法连接 WINK GO 手机绑定中转服务。');
    });
    socket.once('close', (code) => {
      if (!this.isCurrent(socket, generation)) return;
      const closed = closeReason(code);
      const displacedByAnotherInstance = code === 4409;
      if (displacedByAnotherInstance) this.manualStop = true;
      this.workspaceTunnel.closeAll('workspace_gateway_disconnected');
      this.detachSocket(socket);
      this.state.state = displacedByAnotherInstance ? closed.state : this.manualStop ? 'stopped' : closed.state;
      this.state.connecting = false;
      this.state.connected = false;
      this.state.bindingCode = displacedByAnotherInstance ? '' : this.manualStop ? this.state.bindingCode : '';
      this.bindingCodeExpiresAt = 0;
      this.state.lastError = displacedByAnotherInstance ? closed.message : this.manualStop ? '' : closed.message;
      this.emit();
      if (!this.manualStop) this.scheduleReconnect(closed.state === 'waiting_authorization' ? 30_000 : undefined);
    });
    return this.snapshot();
  }

  async stop(options: { preserveEnabled?: boolean; reason?: string } = {}): Promise<WinkGoRemoteGatewaySnapshot> {
    this.manualStop = true;
    this.generation += 1;
    this.clearReconnectTimer();
    this.clearHandshakeTimer();
    this.clearStatusTimer();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.removeAllListeners();
      try {
        socket.close(1000, 'winkgo_gateway_stop');
      } catch {
        socket.terminate();
      }
    }
    this.runtimeClient.close(options.reason || '手机绑定中转已停止。');
    this.workspaceTunnel.closeAll('workspace_gateway_stopped');
    this.replayGuard.clear();
    this.tasks.clear();
    this.state.state = 'stopped';
    this.state.enabled = options.preserveEnabled ? this.config.enabled : false;
    this.state.connected = false;
    this.state.connecting = false;
    this.state.runtimeOnline = false;
    this.state.mcpReady = false;
    this.state.lastError = '';
    this.emit();
    return this.snapshot();
  }

  async refreshAuthorization(): Promise<WinkGoRemoteGatewaySnapshot> {
    await this.stop({ preserveEnabled: true, reason: 'WINK GO 云账号授权已更新。' });
    this.state.bindingCode = '';
    this.bindingCodeExpiresAt = 0;
    this.authorizationSyncKey = '';
    this.identityRecoveryAttempted = false;
    await this.identityStore.syncLicenseAssertionFromSession(this.config.accountId);
    this.identityStore.clearCache();
    this.identity = null;
    await this.ensureIdentity();
    this.state.state = 'idle';
    this.state.lastError = '';
    this.emit();
    return this.snapshot();
  }

  async refreshBindingCode(): Promise<WinkGoRemoteGatewaySnapshot> {
    this.forceBindingCodeRefreshOnNextStart = true;
    await this.stop({ preserveEnabled: true, reason: '正在重新签发手机小程序绑定码。' });
    this.state.bindingCode = '';
    this.bindingCodeExpiresAt = 0;
    this.state.state = 'idle';
    this.state.lastError = '';
    this.emit();
    return this.snapshot();
  }

  async clearAuthorization(): Promise<WinkGoRemoteGatewaySnapshot> {
    await this.stop({ preserveEnabled: true, reason: 'WINK GO 云账号已退出。' });
    this.authorizationSyncKey = '';
    this.identityRecoveryAttempted = false;
    await this.identityStore.clearLicenseAssertion();
    this.identityStore.clearCache();
    this.identity = null;
    await this.ensureIdentity();
    this.state.state = 'waiting_authorization';
    this.state.enabled = this.config.enabled;
    this.state.connected = false;
    this.state.connecting = false;
    this.state.lastError = '请登录 WINK GO 云账号后再启用手机远程连接。';
    this.emit();
    return this.snapshot();
  }

  private async ensureIdentity(): Promise<void> {
    if (this.identity) return;
    this.identity = await this.identityStore.load();
    this.state.accountId = this.identity.accountId;
    this.state.installationId = this.identity.installationId;
    this.state.desktopId = this.identity.desktopId;
    this.state.deviceName = this.identity.deviceName;
    this.state.migratedFromLegacy = this.identity.migratedFromLegacy;
    this.state.enrolled = this.identity.enrolled;
    this.state.enabled = this.config.enabled;
    this.state.relayUrl = this.config.relayUrl;
  }

  private async ensureAuthorizedIdentity(): Promise<void> {
    const syncKey = this.config.authorized && this.config.accountId ? `${this.config.accountId}\u0000authorized` : '';
    if (syncKey && syncKey !== this.authorizationSyncKey) {
      await this.identityStore.syncLicenseAssertionFromSession(this.config.accountId);
      this.identityStore.clearCache();
      this.identity = null;
      this.authorizationSyncKey = syncKey;
    }
    await this.ensureIdentity();
  }

  private async handleUnexpectedResponse(
    socket: WebSocket,
    generation: number,
    response: IncomingMessage
  ): Promise<void> {
    if (!this.isCurrent(socket, generation)) return;
    const statusCode = Number(response.statusCode || 0);
    const body = await readUnexpectedResponseBody(response);
    if (!this.isCurrent(socket, generation)) return;
    const failure = relayHandshakeError(statusCode, body);
    if (failure.code) {
      console.info('[WINK GO Remote] relay handshake rejected', {
        statusCode,
        serverError: failure.code,
      });
    }
    if (failure.recoverIdentity && !this.identityRecoveryAttempted) {
      this.identityRecoveryAttempted = true;
      try {
        this.identity = await this.identityStore.rotateDesktopIdentity();
        this.state.accountId = this.identity.accountId;
        this.state.installationId = this.identity.installationId;
        this.state.desktopId = this.identity.desktopId;
        this.state.enrolled = false;
        this.failSocket(socket, generation, failure.message, 'reconnecting');
        return;
      } catch (error) {
        this.failSocket(
          socket,
          generation,
          error instanceof Error ? error.message : '本机桌面身份自动修复失败。',
          'waiting_authorization'
        );
        return;
      }
    }
    this.failSocket(socket, generation, failure.message, failure.state);
  }

  private async handleMessage(socket: WebSocket, generation: number, data: RawData): Promise<void> {
    let payload: RelayPayload;
    try {
      payload = JSON.parse(rawDataToText(data)) as RelayPayload;
    } catch {
      this.failSocket(socket, generation, '中转返回了无法解析的消息。', 'error');
      return;
    }
    const type = text(payload.type, 80);
    if (type === 'relay.hello') {
      const localIdentity = this.identity;
      if (!localIdentity) {
        this.failSocket(socket, generation, '本机安装身份尚未准备完成。', 'waiting_authorization', 4403);
        return;
      }
      const relayAccountId = text(payload.accountId || payload.account_id, 64).toLowerCase();
      if (relayAccountId && relayAccountId !== this.config.accountId) {
        this.failSocket(socket, generation, '云端返回的客户账号与当前登录账号不一致。', 'error', 4408);
        return;
      }
      const relayDesktopId = text(payload.desktopId || payload.desktop_id || payload.deviceId, 160);
      const relayInstallationId = text(payload.installationId || payload.installation_id, 180);
      if (relayDesktopId && relayDesktopId !== localIdentity.desktopId) {
        this.failSocket(socket, generation, '云端返回的桌面身份与本机不一致。', 'error', 4408);
        return;
      }
      if (relayInstallationId && relayInstallationId !== localIdentity.installationId) {
        this.failSocket(socket, generation, '云端返回的安装实例与本机不一致。', 'error', 4408);
        return;
      }
      let identity: WinkGoRemoteIdentity;
      try {
        identity = await this.identityStore.markEnrolled(this.config.accountId);
      } catch (error) {
        this.failSocket(
          socket,
          generation,
          error instanceof Error ? error.message : '桌面账号归属校验失败。',
          'waiting_authorization',
          4403
        );
        return;
      }
      this.identity = identity;
      this.state.accountId = identity.accountId;
      this.state.installationId = identity.installationId;
      this.state.desktopId = identity.desktopId;
      this.state.deviceName = text(payload.deviceName, 64) || identity.deviceName;
      const bindingCode = text(payload.bindingCode, 24);
      const expiresInSeconds = Math.max(0, Math.min(3_600, Number(payload.expiresInSeconds || 0)));
      if (!/^\d{10}$/.test(bindingCode) || expiresInSeconds < 1 || expiresInSeconds > 600) {
        this.failSocket(socket, generation, '云端返回的设备绑定码格式无效，正在自动重连。', 'error', 4408);
        return;
      }
      // relay.hello is the authenticated bootstrap packet. Keep it independent
      // from the customer's Windows clock, matching the original Runtime relay.
      this.clearHandshakeTimer();
      this.state.state = 'connected';
      this.state.connecting = false;
      this.state.connected = true;
      this.state.bindingCode = bindingCode;
      this.bindingCodeExpiresAt = this.clock() + expiresInSeconds * 1_000;
      this.forceBindingCodeRefreshOnNextStart = false;
      this.state.enrolled = true;
      this.identityRecoveryAttempted = false;
      this.state.lastConnectedAt = new Date(this.clock()).toISOString();
      this.state.lastSeenAt = this.state.lastConnectedAt;
      this.state.lastError = '';
      this.emit();
      void this.sendStatus();
      this.clearStatusTimer();
      this.statusTimer = setInterval(() => void this.sendStatus(), STATUS_INTERVAL_MS);
      return;
    }
    if (
      !this.replayGuard.accept({
        timestamp: Number(payload.timestamp || 0),
        nonce: text(payload.nonce, 128),
      })
    ) {
      this.failSocket(socket, generation, '中转消息未通过时间戳与防重放校验。', 'error', 4408);
      return;
    }
    this.state.lastSeenAt = new Date(this.clock()).toISOString();
    if (this.workspaceTunnel.accept(payload as Record<string, unknown>)) {
      return;
    }
    if (type === 'miniapp.message.send' || type === 'miniapp.voice.send') {
      await this.handleCommand(payload);
      return;
    }
    if (type === 'miniapp.expression.request') {
      this.send({
        type: 'desktop.expression.result',
        requestId: text(payload.requestId, 180),
        ok: false,
        error: 'expression_https_channel_required',
        message: 'ESP32 动态表情使用独立 HTTPS 设备服务，不经过桌面技能通道。',
        finishedAt: new Date(this.clock()).toISOString(),
      });
    }
  }

  private async handleCommand(payload: RelayPayload): Promise<void> {
    const messageId = text(payload.messageId || payload.taskId || payload.task_id, 180);
    const command = text(payload.text || payload.transcript || payload.command, 6_000);
    let context: WinkGoRemoteExecutionContext | null = null;
    try {
      if (!messageId) throw new Error('中转消息缺少任务身份，未执行指令。');
      context = await this.resolveExecutionContext(payload, messageId);
      if (text(payload.mode, 32) === 'speech_proxy') {
        const audioBase64 = await this.speechSynthesizer(command);
        this.send({
          type: 'desktop.message.result',
          messageId,
          ...context,
          ok: true,
          text: '',
          audioBase64,
          audioFormat: 'wav',
          finishedAt: new Date(this.clock()).toISOString(),
        });
        return;
      }
      if (!command) {
        throw new Error('桌面端已连接；实时语音识别继续由当前 WINK GO 语音 Agent 处理，文字指令会进入技能中心。');
      }
      const result = await this.tasks.run({
        ...context,
        messageId,
        skillScope: context.accountId,
        text: command,
        speak: payload.speak === true,
      });
      this.send({
        type: 'desktop.message.result',
        messageId,
        ...context,
        ok: result.ok,
        text: result.text,
        audioBase64: '',
        audioFormat: 'wav',
        finishedAt: new Date(this.clock()).toISOString(),
      });
      await this.sendStatus();
    } catch (error) {
      this.send({
        type: 'desktop.message.result',
        messageId,
        ...context,
        ok: false,
        text: error instanceof Error ? error.message : String(error || '电脑端执行失败。'),
        audioBase64: '',
        audioFormat: 'wav',
        finishedAt: new Date(this.clock()).toISOString(),
      });
    }
  }

  private async resolveExecutionContext(
    payload: RelayPayload,
    messageId: string
  ): Promise<WinkGoRemoteExecutionContext> {
    let identity = this.identity;
    if (!identity) throw new Error('本机安装身份尚未准备完成，未执行指令。');
    const suppliedInstallationId = text(payload.installationId || payload.installation_id, 180);
    const suppliedDesktopId = text(payload.desktopId || payload.desktop_id || payload.deviceId, 160);
    if (suppliedInstallationId && suppliedInstallationId !== identity.installationId) {
      throw new Error('任务指定的安装实例与本机不一致，已拒绝执行。');
    }
    if (suppliedDesktopId && suppliedDesktopId !== identity.desktopId) {
      throw new Error('任务指定的电脑与本机不一致，已拒绝执行。');
    }
    const context = normalizeWinkGoRemoteExecutionContext({
      accountId: text(payload.accountId || payload.account_id || payload.skillScope, 64),
      installationId: identity.installationId,
      desktopId: identity.desktopId,
      agentId: text(payload.agentId || payload.agent_id, 180) || DEFAULT_DESKTOP_AGENT_ID,
      sessionId: text(payload.sessionId || payload.session_id, 180) || `legacy-session:${messageId}`,
      taskId: text(payload.taskId || payload.task_id, 180) || messageId,
    });
    if (identity.accountId && identity.accountId !== context.accountId) {
      throw new Error('该任务不属于这台电脑绑定的 WINK GO 账号，已拒绝执行。');
    }
    if (context.accountId !== this.config.accountId) {
      throw new Error('该任务不属于当前登录的 WINK GO 账号，已拒绝执行。');
    }
    if (!identity.accountId) {
      identity = await this.identityStore.markEnrolled(context.accountId);
      this.identity = identity;
      this.state.accountId = identity.accountId;
    }
    return context;
  }

  private async sendStatus(): Promise<void> {
    if (this.statusBusy || this.socket?.readyState !== WebSocket.OPEN) return;
    this.statusBusy = true;
    try {
      const runtimeOnline = await this.runtimeClient.ping(1_500);
      this.state.runtimeOnline = runtimeOnline;
      this.state.mcpReady = runtimeOnline;
      this.emit();
      this.send({
        type: 'desktop.status.update',
        accountId: this.identity?.accountId || undefined,
        installationId: this.identity?.installationId || '',
        desktopId: this.identity?.desktopId || this.state.desktopId,
        agentId: DEFAULT_DESKTOP_AGENT_ID,
        runtimeOnline,
        mcpReady: runtimeOnline,
        remoteGatewayReady: this.state.connected,
        deviceName: this.state.deviceName,
        sentAt: new Date(this.clock()).toISOString(),
      });
    } finally {
      this.statusBusy = false;
    }
  }

  private send(payload: Record<string, unknown>): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(createWinkGoSecureEnvelope(payload, this.clock())));
  }

  private failSocket(
    socket: WebSocket,
    generation: number,
    message: string,
    state: WinkGoRemoteGatewaySnapshot['state'] = 'reconnecting',
    closeCode = 1011
  ): void {
    if (!this.isCurrent(socket, generation)) return;
    this.detachSocket(socket);
    try {
      socket.close(closeCode, 'winkgo_gateway_error');
    } catch {
      socket.terminate();
    }
    this.state.state = this.manualStop ? 'stopped' : state;
    this.state.connecting = false;
    this.state.connected = false;
    this.state.lastError = message;
    this.emit();
    if (!this.manualStop) this.scheduleReconnect(state === 'waiting_authorization' ? 30_000 : undefined);
  }

  private failGeneration(
    generation: number,
    message: string,
    state: WinkGoRemoteGatewaySnapshot['state'] = 'reconnecting'
  ): void {
    if (generation !== this.generation) return;
    this.state.state = state;
    this.state.connecting = false;
    this.state.connected = false;
    this.state.lastError = message;
    this.emit();
    if (!this.manualStop) this.scheduleReconnect();
  }

  private detachSocket(socket: WebSocket): void {
    if (this.socket === socket) this.socket = null;
    socket.removeAllListeners();
    this.clearHandshakeTimer();
    this.clearStatusTimer();
  }

  private isCurrent(socket: WebSocket, generation: number): boolean {
    return this.socket === socket && this.generation === generation;
  }

  private scheduleReconnect(delayOverride?: number): void {
    if (this.manualStop || !this.config.enabled || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const base = Math.min(MAX_RECONNECT_MS, MIN_RECONNECT_MS * 2 ** Math.min(5, this.reconnectAttempt - 1));
    const delay = delayOverride ?? Math.round(base * (0.85 + this.random() * 0.3));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start();
    }, delay);
  }

  private snapshot(): WinkGoRemoteGatewaySnapshot {
    return {
      ...this.state,
      expiresInSeconds:
        this.state.bindingCode && this.bindingCodeExpiresAt > this.clock()
          ? Math.ceil((this.bindingCodeExpiresAt - this.clock()) / 1_000)
          : 0,
    };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    const statusLogKey = [
      snapshot.state,
      snapshot.connected,
      snapshot.connecting,
      snapshot.enrolled,
      snapshot.bindingCode ? 'binding-ready' : 'binding-empty',
      snapshot.lastError,
    ].join('\u0000');
    if (statusLogKey !== this.lastStatusLogKey) {
      this.lastStatusLogKey = statusLogKey;
      console.info('[WINK GO Remote]', {
        state: snapshot.state,
        connected: snapshot.connected,
        connecting: snapshot.connecting,
        enrolled: snapshot.enrolled,
        bindingReady: Boolean(snapshot.bindingCode),
        lastError: snapshot.lastError,
      });
    }
    this.events.emit('status', snapshot);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    this.handshakeTimer = null;
  }

  private clearStatusTimer(): void {
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.statusTimer = null;
  }
}
