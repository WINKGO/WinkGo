import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWinkGoRemoteSource,
  WinkGoReplayGuard,
  WinkGoTaskCoordinator,
  type WinkGoRemoteCommandResult,
} from '@process/services/winkgoRemote/core';

const SCOPE_A = 'u_aaaaaaaaaaaaaaaaaaaaaaaa';
const SCOPE_B = 'u_bbbbbbbbbbbbbbbbbbbbbbbb';

const command = (overrides: Partial<Parameters<WinkGoTaskCoordinator['run']>[0]> = {}) => ({
  accountId: SCOPE_A,
  installationId: 'installation-001',
  desktopId: 'WINKGO-DESKTOP-TEST',
  agentId: 'winkgo-desktop-agent',
  sessionId: 'session-001',
  taskId: 'task-001',
  messageId: 'message-001',
  skillScope: SCOPE_A,
  text: '打开网易云音乐',
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WINK GO remote replay protection', () => {
  it('accepts one current nonce and rejects replay, expired, and future envelopes', () => {
    let now = 10_000;
    const guard = new WinkGoReplayGuard(1_000, 100, () => now);

    expect(guard.accept({ timestamp: now, nonce: 'nonce_abcdefghijklmnop' })).toBe(true);
    expect(guard.accept({ timestamp: now, nonce: 'nonce_abcdefghijklmnop' })).toBe(false);
    expect(guard.accept({ timestamp: now - 1_001, nonce: 'nonce_expired_123456' })).toBe(false);
    expect(guard.accept({ timestamp: now + 1_001, nonce: 'nonce_future_1234567' })).toBe(false);

    now += 1_001;
    expect(guard.accept({ timestamp: now, nonce: 'nonce_abcdefghijklmnop' })).toBe(true);
  });
});

describe('WINK GO remote task isolation', () => {
  it('accepts the UUID account ids issued by the current WINK GO cloud', () => {
    const uuidScope = '5a180b33-fb45-4d4d-8312-4a93a3b1e4a7';
    expect(
      createWinkGoRemoteSource(
        command({
          accountId: uuidScope,
          skillScope: uuidScope,
        })
      )
    ).toContain(`mobile_miniapp:${uuidScope}:`);
  });

  it('executes duplicate deliveries once and shares the terminal result', async () => {
    let resolveExecution!: (result: WinkGoRemoteCommandResult) => void;
    const execution = new Promise<WinkGoRemoteCommandResult>((resolve) => {
      resolveExecution = resolve;
    });
    const executor = vi.fn(() => execution);
    const coordinator = new WinkGoTaskCoordinator(executor);

    const first = coordinator.run(command());
    const duplicate = coordinator.run(command());
    resolveExecution({ ok: true, text: '已经打开网易云音乐。' });

    await expect(first).resolves.toEqual({ ok: true, text: '已经打开网易云音乐。' });
    await expect(duplicate).resolves.toEqual({ ok: true, text: '已经打开网易云音乐。' });
    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(
      '打开网易云音乐',
      createWinkGoRemoteSource(command()),
      expect.objectContaining({
        timeoutMs: 60_000,
        context: {
          accountId: SCOPE_A,
          installationId: 'installation-001',
          desktopId: 'WINKGO-DESKTOP-TEST',
          agentId: 'winkgo-desktop-agent',
          sessionId: 'session-001',
          taskId: 'task-001',
        },
      })
    );
  });

  it('returns the cached terminal result without executing a completed task twice', async () => {
    const executor = vi.fn(async () => ({ ok: true, text: '执行完成。' }));
    const coordinator = new WinkGoTaskCoordinator(executor);

    await expect(coordinator.run(command())).resolves.toEqual({ ok: true, text: '执行完成。' });
    await expect(coordinator.run(command())).resolves.toEqual({ ok: true, text: '执行完成。' });

    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('rejects the same device task when another account claims it', async () => {
    let resolveExecution!: (result: WinkGoRemoteCommandResult) => void;
    const executor = vi.fn(
      () =>
        new Promise<WinkGoRemoteCommandResult>((resolve) => {
          resolveExecution = resolve;
        })
    );
    const coordinator = new WinkGoTaskCoordinator(executor);

    const first = coordinator.run(command());
    await expect(coordinator.run(command({ accountId: SCOPE_B, skillScope: SCOPE_B }))).resolves.toEqual({
      ok: false,
      text: '该任务不属于当前账号、Agent 或会话，已拒绝执行。',
    });
    resolveExecution({ ok: true, text: '执行完成。' });
    await first;

    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('allows the same task id on a different installation and desktop', async () => {
    const executor = vi.fn(async () => ({ ok: true, text: '执行完成。' }));
    const coordinator = new WinkGoTaskCoordinator(executor);

    await coordinator.run(command());
    await coordinator.run(
      command({
        installationId: 'installation-002',
        desktopId: 'WINKGO-DESKTOP-TEST-002',
      })
    );

    expect(executor).toHaveBeenCalledTimes(2);
  });

  it('isolates legacy Runtime conversation sources by computer, Agent, and phone session', () => {
    const baseline = createWinkGoRemoteSource(command());

    expect(createWinkGoRemoteSource(command())).toBe(baseline);
    expect(createWinkGoRemoteSource(command({ desktopId: 'WINKGO-DESKTOP-TEST-002' }))).not.toBe(baseline);
    expect(createWinkGoRemoteSource(command({ agentId: 'agent-002' }))).not.toBe(baseline);
    expect(createWinkGoRemoteSource(command({ sessionId: 'session-002' }))).not.toBe(baseline);
  });

  it('rejects a task id reused by another session on the same installation', async () => {
    const executor = vi.fn(async () => ({ ok: true, text: '执行完成。' }));
    const coordinator = new WinkGoTaskCoordinator(executor);

    await coordinator.run(command());
    await expect(coordinator.run(command({ sessionId: 'session-002' }))).resolves.toEqual({
      ok: false,
      text: '该任务不属于当前账号、Agent 或会话，已拒绝执行。',
    });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled command and always returns a terminal timeout result', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | null = null;
    const executor = vi.fn((_text: string, _source: string, options: { signal: AbortSignal }) => {
      observedSignal = options.signal;
      return new Promise<WinkGoRemoteCommandResult>(() => undefined);
    });
    const coordinator = new WinkGoTaskCoordinator(executor, { timeoutMs: 1_000 });
    const result = coordinator.run(command());

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toEqual({
      ok: false,
      text: '电脑端执行超时，请确认 Runtime 正常后重试。',
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('refuses malformed customer accounts before invoking Runtime', () => {
    const executor = vi.fn(async () => ({ ok: true, text: '不应执行。' }));
    const coordinator = new WinkGoTaskCoordinator(executor);

    expect(() => coordinator.run(command({ accountId: 'shared-user', skillScope: 'shared-user' }))).toThrow(
      '客户账号身份无效，未执行指令。'
    );
    expect(executor).not.toHaveBeenCalled();
  });
});
