import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeMcpClient } from '@process/services/winkgoRemote/RuntimeMcpClient';
import { detectExecutionContextArgument } from '@process/services/winkgoRemote/RuntimeMcpClient';
import { createWinkGoRemoteSource } from '@process/services/winkgoRemote/core';
import {
  WinkGoRemoteGatewayService,
  type WinkGoRemoteGatewayConfig,
} from '@process/services/winkgoRemote/WinkGoRemoteGatewayService';
import type {
  WinkGoRemoteIdentity,
  WinkGoRemoteIdentityStore,
} from '@process/services/winkgoRemote/WinkGoRemoteIdentityStore';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.cwd(),
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
  },
}));

const NOW = 1_800_000_000_000;
const SCOPE = 'u_aaaaaaaaaaaaaaaaaaaaaaaa';
const DESKTOP_ID = '727bbff8-e0c9-4754-bb6c-4fc17024afcc';
const services: WinkGoRemoteGatewayService[] = [];

class FakeSocket extends EventEmitter {
  readyState = WebSocket.CONNECTING;
  readonly sent: string[] = [];
  closed = false;
  terminated = false;

  open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit('open');
  }

  send(payload: string | Buffer): void {
    this.sent.push(payload.toString());
  }

  close(): void {
    this.closed = true;
    this.readyState = WebSocket.CLOSED;
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = WebSocket.CLOSED;
  }
}

class FakeUnexpectedResponse extends EventEmitter {
  constructor(
    readonly statusCode: number,
    private readonly body: string
  ) {
    super();
  }

  resume(): void {
    queueMicrotask(() => {
      this.emit('data', Buffer.from(this.body));
      this.emit('end');
    });
  }
}

const identity = (overrides: Partial<WinkGoRemoteIdentity> = {}): WinkGoRemoteIdentity => ({
  schemaVersion: 2,
  accountId: SCOPE,
  installationId: 'installation-001',
  desktopId: DESKTOP_ID,
  deviceName: '测试电脑的 WINK GO',
  enrolled: true,
  migratedFromLegacy: false,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  deviceToken: 'desktop-token-001',
  licenseAssertion: 'signed-license-001',
  ...overrides,
});

const config: WinkGoRemoteGatewayConfig = {
  enabled: true,
  authorized: true,
  accountId: SCOPE,
  relayUrl: 'wss://winkgo.top/desktop',
  runtimeApi: 'http://127.0.0.1:8121',
  runtimeToken: null,
};

const createGateway = ({
  remoteIdentity = identity(),
  runtimeResult = { ok: true, text: '已经打开网易云音乐。' },
  gatewayConfig = config,
}: {
  remoteIdentity?: WinkGoRemoteIdentity;
  runtimeResult?: { ok: boolean; text: string };
  gatewayConfig?: WinkGoRemoteGatewayConfig;
} = {}) => {
  const socket = new FakeSocket();
  const socketFactory = vi.fn(() => socket as unknown as WebSocket);
  let currentIdentity = { ...remoteIdentity };
  const identityStore = {
    load: vi.fn(async () => ({ ...currentIdentity })),
    markEnrolled: vi.fn(async (accountId: string) => {
      if (currentIdentity.accountId && currentIdentity.accountId !== accountId) {
        throw new Error('这台电脑已经绑定到其他 WINK GO 账号，已拒绝静默迁移。');
      }
      currentIdentity = {
        ...currentIdentity,
        accountId,
        enrolled: true,
      };
      return { ...currentIdentity };
    }),
    syncLicenseAssertionFromSession: vi.fn(async () => currentIdentity.licenseAssertion),
    rotateDesktopIdentity: vi.fn(async () => {
      currentIdentity = {
        ...currentIdentity,
        desktopId: '6254633f-5ca0-491d-a5a2-d2491ee74044',
        deviceToken: 'rotated-desktop-token',
        enrolled: false,
      };
      return { ...currentIdentity };
    }),
    clearLicenseAssertion: vi.fn(async () => {
      currentIdentity = { ...currentIdentity, licenseAssertion: '' };
    }),
    clearCache: vi.fn(),
  } as unknown as WinkGoRemoteIdentityStore;
  const runtimeClient = {
    updateConfig: vi.fn(),
    runSkillCommand: vi.fn(async () => runtimeResult),
    ping: vi.fn(async () => true),
    close: vi.fn(),
  } as unknown as RuntimeMcpClient;
  const service = new WinkGoRemoteGatewayService(gatewayConfig, {
    identityStore,
    runtimeClient,
    socketFactory,
    speechSynthesizer: vi.fn(async () => 'd2F2'),
    clock: () => NOW,
    random: () => 0.5,
  });
  services.push(service);
  return { service, socket, socketFactory, runtimeClient, identityStore };
};

const incoming = (nonce: string, overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'miniapp.message.send',
    timestamp: NOW,
    nonce,
    messageId: 'message-001',
    skillScope: SCOPE,
    text: '打开网易云音乐',
    ...overrides,
  });

const relayHello = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: 'relay.hello',
    bindingCode: '0123456789',
    expiresInSeconds: 300,
    ...overrides,
  });

const completeRelayHandshake = async (service: WinkGoRemoteGatewayService, socket: FakeSocket): Promise<void> => {
  socket.open();
  socket.emit('message', relayHello());
  await vi.waitFor(async () => {
    expect(await service.getSnapshot()).toMatchObject({
      state: 'connected',
      connected: true,
      connecting: false,
      bindingCode: '0123456789',
    });
  });
};

const currentProtocolContext = {
  accountId: SCOPE,
  installationId: 'installation-001',
  desktopId: DESKTOP_ID,
  agentId: 'agent-main',
  sessionId: 'session-001',
  taskId: 'task-001',
};

const sentPayloads = (socket: FakeSocket): Array<Record<string, unknown>> =>
  socket.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>);

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  vi.restoreAllMocks();
});

describe('WINK GO remote gateway authorization', () => {
  it('does not create a relay socket for a fresh installation without signed authorization', async () => {
    const { service, socketFactory } = createGateway({
      remoteIdentity: identity({
        accountId: '',
        enrolled: false,
        deviceToken: '',
        licenseAssertion: '',
      }),
      gatewayConfig: {
        ...config,
        authorized: false,
        accountId: '',
      },
    });

    const snapshot = await service.start();

    expect(snapshot).toMatchObject({
      state: 'waiting_authorization',
      connected: false,
      connecting: false,
      enrolled: false,
    });
    expect(snapshot.lastError).toContain('未创建不安全的共享身份');
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it('revokes the signed relay assertion and disconnects immediately on logout', async () => {
    const { service, socket, identityStore } = createGateway();
    await service.start();
    await completeRelayHandshake(service, socket);

    const snapshot = await service.clearAuthorization();

    expect(identityStore.clearLicenseAssertion).toHaveBeenCalledTimes(1);
    expect(socket.closed).toBe(true);
    expect(snapshot).toMatchObject({
      state: 'waiting_authorization',
      connected: false,
      connecting: false,
      enabled: true,
    });
    expect(snapshot.lastError).toContain('请登录 WINK GO 云账号');
  });

  it('clears an expired binding code before requesting a fresh relay handshake', async () => {
    const { service, socket } = createGateway();
    await service.start();
    await completeRelayHandshake(service, socket);

    const snapshot = await service.refreshAuthorization();

    expect(socket.closed).toBe(true);
    expect(snapshot).toMatchObject({
      state: 'idle',
      connected: false,
      connecting: false,
      bindingCode: '',
      expiresInSeconds: 0,
    });
  });

  it('stops reconnecting when another WINK GO instance takes over the desktop identity', async () => {
    const { service, socket, socketFactory } = createGateway();
    await service.start();
    await completeRelayHandshake(service, socket);

    socket.emit('close', 4409);

    await vi.waitFor(async () => {
      expect(await service.getSnapshot()).toMatchObject({
        state: 'stopped',
        connected: false,
        connecting: false,
        bindingCode: '',
      });
    });
    expect((await service.getSnapshot()).lastError).toContain('已停止自动重连');
    expect(socketFactory).toHaveBeenCalledTimes(1);
    expect((service as unknown as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer).toBeNull();
  });

  it('requests a new binding code only after an explicit manual refresh', async () => {
    const { service, socket, socketFactory } = createGateway();
    await service.start();
    await completeRelayHandshake(service, socket);

    await service.refreshBindingCode();
    await service.start();

    const endpoint = new URL(String(socketFactory.mock.calls[1]?.[0]));
    expect(endpoint.searchParams.get('refreshBindingCode')).toBe('1');
  });

  it('rejects a different cloud account before opening the relay socket', async () => {
    const { service, socketFactory } = createGateway({
      remoteIdentity: identity({ accountId: 'u_bbbbbbbbbbbbbbbbbbbbbbbb' }),
    });

    const snapshot = await service.start();

    expect(snapshot).toMatchObject({
      state: 'waiting_authorization',
      connected: false,
      connecting: false,
    });
    expect(snapshot.lastError).toContain('拒绝跨账号接管');
    expect(socketFactory).not.toHaveBeenCalled();
  });

  it('uses the production relay query and authenticated subprotocols during connection', async () => {
    const { service, socketFactory } = createGateway();
    await service.start();

    const endpoint = new URL(String(socketFactory.mock.calls[0]?.[0]));
    expect(endpoint.searchParams.get('deviceId')).toBe(DESKTOP_ID);
    expect(endpoint.searchParams.get('deviceName')).toBe('测试电脑的 WINK GO');
    expect(endpoint.searchParams.get('accountId')).toBe(SCOPE);
    expect(endpoint.searchParams.get('installationId')).toBe('installation-001');
    expect(endpoint.searchParams.get('desktopId')).toBe(DESKTOP_ID);
    expect(endpoint.searchParams.get('agentId')).toBe('winkgo-desktop-agent');
    expect([...endpoint.searchParams.keys()].toSorted()).toEqual([
      'accountId',
      'agentId',
      'desktopId',
      'deviceId',
      'deviceName',
      'installationId',
    ]);
    expect(socketFactory.mock.calls[0]?.[1]).toEqual([
      'winkgo.desktop.v2',
      'auth.desktop-token-001',
      'license.signed-license-001',
    ]);
  });

  it('clears the connecting state and closes a rejected handshake', async () => {
    const { service, socket } = createGateway();
    await service.start();

    socket.emit('unexpected-response', {}, { statusCode: 401 });
    const snapshot = await service.getSnapshot();

    expect(snapshot).toMatchObject({
      state: 'waiting_authorization',
      connected: false,
      connecting: false,
    });
    expect(snapshot.lastError).toContain('云端拒绝');
    expect(socket.closed).toBe(true);
  });

  it('rotates an invalid desktop identity once and reconnects automatically', async () => {
    const { service, socket, socketFactory, identityStore } = createGateway();
    await service.start();

    socket.emit(
      'unexpected-response',
      {},
      new FakeUnexpectedResponse(401, JSON.stringify({ error: 'desktop_identity_invalid' }))
    );

    await vi.waitFor(
      () => {
        expect(identityStore.rotateDesktopIdentity).toHaveBeenCalledTimes(1);
        expect(socketFactory).toHaveBeenCalledTimes(2);
      },
      { timeout: 3_000 }
    );
  });

  it('does not report a usable relay until a valid ten-digit binding code arrives', async () => {
    const { service, socket } = createGateway();
    await service.start();
    socket.open();

    expect(await service.getSnapshot()).toMatchObject({
      state: 'connecting',
      connected: false,
      connecting: true,
      bindingCode: '',
    });

    socket.emit('message', relayHello({ bindingCode: '123456' }));
    await vi.waitFor(async () => {
      expect(await service.getSnapshot()).toMatchObject({
        state: 'error',
        connected: false,
        connecting: false,
      });
    });
  });
});

describe('WINK GO remote gateway task isolation', () => {
  it('executes duplicate relay deliveries once and returns a terminal result to each delivery', async () => {
    const { service, socket, runtimeClient } = createGateway();
    await service.start();
    await completeRelayHandshake(service, socket);

    socket.emit('message', incoming('nonce_command_000001'));
    socket.emit('message', incoming('nonce_command_000002'));

    await vi.waitFor(() => {
      const results = sentPayloads(socket).filter((payload) => payload.type === 'desktop.message.result');
      expect(results).toHaveLength(2);
      expect(results.every((payload) => payload.ok === true)).toBe(true);
    });

    expect(runtimeClient.runSkillCommand).toHaveBeenCalledTimes(1);
    expect(runtimeClient.runSkillCommand).toHaveBeenCalledWith(
      '打开网易云音乐',
      createWinkGoRemoteSource({
        accountId: SCOPE,
        installationId: 'installation-001',
        desktopId: DESKTOP_ID,
        agentId: 'winkgo-desktop-agent',
        sessionId: 'legacy-session:message-001',
        taskId: 'message-001',
      }),
      expect.objectContaining({
        timeoutMs: 60_000,
        context: {
          accountId: SCOPE,
          installationId: 'installation-001',
          desktopId: DESKTOP_ID,
          agentId: 'winkgo-desktop-agent',
          sessionId: 'legacy-session:message-001',
          taskId: 'message-001',
        },
      })
    );
  });

  it('passes the complete multi-tenant context to MCP and echoes it in the result', async () => {
    const { service, socket, runtimeClient } = createGateway();
    await service.start();
    await completeRelayHandshake(service, socket);

    socket.emit('message', incoming('nonce_command_000004', currentProtocolContext));

    await vi.waitFor(() => {
      const result = sentPayloads(socket).find((payload) => payload.type === 'desktop.message.result');
      expect(result).toMatchObject({
        messageId: 'message-001',
        ...currentProtocolContext,
        ok: true,
      });
    });
    expect(runtimeClient.runSkillCommand).toHaveBeenCalledWith(
      '打开网易云音乐',
      createWinkGoRemoteSource(currentProtocolContext),
      expect.objectContaining({ context: currentProtocolContext })
    );
  });

  it('accepts the mini-program snake_case routing contract without legacy fields', async () => {
    const { service, socket, runtimeClient } = createGateway();
    await service.start();
    await completeRelayHandshake(service, socket);

    socket.emit(
      'message',
      incoming('nonce_command_000007', {
        messageId: undefined,
        skillScope: undefined,
        account_id: SCOPE,
        installation_id: 'installation-001',
        desktop_id: DESKTOP_ID,
        agent_id: 'agent-miniapp',
        session_id: 'session-miniapp-001',
        task_id: 'task-miniapp-001',
      })
    );

    await vi.waitFor(() => {
      const result = sentPayloads(socket).find((payload) => payload.type === 'desktop.message.result');
      expect(result).toMatchObject({
        messageId: 'task-miniapp-001',
        accountId: SCOPE,
        installationId: 'installation-001',
        desktopId: DESKTOP_ID,
        agentId: 'agent-miniapp',
        sessionId: 'session-miniapp-001',
        taskId: 'task-miniapp-001',
        ok: true,
      });
    });
    expect(runtimeClient.runSkillCommand).toHaveBeenCalledWith(
      '打开网易云音乐',
      createWinkGoRemoteSource({
        accountId: SCOPE,
        installationId: 'installation-001',
        desktopId: DESKTOP_ID,
        agentId: 'agent-miniapp',
        sessionId: 'session-miniapp-001',
        taskId: 'task-miniapp-001',
      }),
      expect.objectContaining({
        context: {
          accountId: SCOPE,
          installationId: 'installation-001',
          desktopId: DESKTOP_ID,
          agentId: 'agent-miniapp',
          sessionId: 'session-miniapp-001',
          taskId: 'task-miniapp-001',
        },
      })
    );
  });

  it('rejects a task routed to a different installation before invoking Runtime', async () => {
    const { service, socket, runtimeClient } = createGateway();
    await service.start();
    await completeRelayHandshake(service, socket);

    socket.emit(
      'message',
      incoming('nonce_command_000005', {
        ...currentProtocolContext,
        installationId: 'installation-other',
      })
    );

    await vi.waitFor(() => {
      const result = sentPayloads(socket).find((payload) => payload.type === 'desktop.message.result');
      expect(result).toMatchObject({
        ok: false,
        text: '任务指定的安装实例与本机不一致，已拒绝执行。',
      });
    });
    expect(runtimeClient.runSkillCommand).not.toHaveBeenCalled();
  });

  it('rejects a valid task that belongs to another bound customer account', async () => {
    const { service, socket, runtimeClient } = createGateway();
    await service.start();
    await completeRelayHandshake(service, socket);

    socket.emit(
      'message',
      incoming('nonce_command_000006', {
        ...currentProtocolContext,
        accountId: 'u_bbbbbbbbbbbbbbbbbbbbbbbb',
        skillScope: 'u_bbbbbbbbbbbbbbbbbbbbbbbb',
      })
    );

    await vi.waitFor(() => {
      const result = sentPayloads(socket).find((payload) => payload.type === 'desktop.message.result');
      expect(result).toMatchObject({
        ok: false,
        text: '该任务不属于这台电脑绑定的 WINK GO 账号，已拒绝执行。',
      });
    });
    expect(runtimeClient.runSkillCommand).not.toHaveBeenCalled();
  });

  it('returns a terminal failure for a malformed customer scope without invoking Runtime', async () => {
    const { service, socket, runtimeClient } = createGateway();
    await service.start();
    await completeRelayHandshake(service, socket);

    socket.emit('message', incoming('nonce_command_000003', { skillScope: 'shared-customer' }));

    await vi.waitFor(() => {
      const result = sentPayloads(socket).find((payload) => payload.type === 'desktop.message.result');
      expect(result).toMatchObject({
        ok: false,
        text: '客户账号身份无效，未执行指令。',
      });
    });
    expect(runtimeClient.runSkillCommand).not.toHaveBeenCalled();
  });
});

describe('WINK GO Runtime MCP compatibility', () => {
  it('detects only an execution-context field explicitly advertised by Runtime', () => {
    expect(
      detectExecutionContextArgument({
        tools: [
          {
            name: 'tools.run_skill_command',
            inputSchema: {
              properties: {
                command: { type: 'string' },
                source: { type: 'string' },
                execution_context: { type: 'object' },
              },
            },
          },
        ],
      })
    ).toBe('execution_context');
    expect(
      detectExecutionContextArgument({
        tools: [
          {
            name: 'tools.run_skill_command',
            inputSchema: { properties: { command: { type: 'string' } } },
          },
        ],
      })
    ).toBeNull();
  });
});
