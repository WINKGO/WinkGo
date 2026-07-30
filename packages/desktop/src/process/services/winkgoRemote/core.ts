/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomBytes } from 'node:crypto';

export const WINKGO_REMOTE_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const WINKGO_REMOTE_SCOPE_PATTERN =
  /^(?:u_[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
const WINKGO_REMOTE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,180}$/;

export type WinkGoSecureEnvelope = {
  type: string;
  timestamp: number;
  nonce: string;
  [key: string]: unknown;
};

export type WinkGoRemoteExecutionContext = {
  accountId: string;
  installationId: string;
  desktopId: string;
  agentId: string;
  sessionId: string;
  taskId: string;
};

export type WinkGoRemoteCommand = WinkGoRemoteExecutionContext & {
  /** Legacy relay correlation field. It remains available while old mini-program clients migrate to taskId. */
  messageId: string;
  /** Legacy account field. It must resolve to the same value as accountId. */
  skillScope: string;
  text: string;
  speak?: boolean;
};

export type WinkGoRemoteCommandResult = {
  ok: boolean;
  text: string;
  raw?: unknown;
};

export type WinkGoRemoteCommandExecutor = (
  command: string,
  source: string,
  options: {
    signal: AbortSignal;
    timeoutMs: number;
    context: WinkGoRemoteExecutionContext;
  }
) => Promise<WinkGoRemoteCommandResult>;

const boundedText = (value: unknown, max: number): string =>
  (typeof value === 'string' ? value : '')
    .trim()
    .replace(/\p{Cc}/gu, '')
    .slice(0, max);

export const normalizeWinkGoRemoteExecutionContext = (
  input: WinkGoRemoteExecutionContext
): WinkGoRemoteExecutionContext => {
  const accountId = boundedText(input.accountId, 64).toLowerCase();
  const installationId = boundedText(input.installationId, 180);
  const desktopId = boundedText(input.desktopId, 160);
  const agentId = boundedText(input.agentId, 180);
  const sessionId = boundedText(input.sessionId, 180);
  const taskId = boundedText(input.taskId, 180);
  if (!WINKGO_REMOTE_SCOPE_PATTERN.test(accountId)) {
    throw new Error('客户账号身份无效，未执行指令。');
  }
  if (!WINKGO_REMOTE_ID_PATTERN.test(installationId)) {
    throw new Error('安装实例身份无效，未执行指令。');
  }
  if (!/^[A-Za-z0-9._:-]{3,160}$/.test(desktopId)) {
    throw new Error('桌面身份无效，未执行指令。');
  }
  if (!WINKGO_REMOTE_ID_PATTERN.test(agentId)) throw new Error('Agent 身份无效，未执行指令。');
  if (!WINKGO_REMOTE_ID_PATTERN.test(sessionId)) throw new Error('会话身份无效，未执行指令。');
  if (!WINKGO_REMOTE_ID_PATTERN.test(taskId)) throw new Error('任务身份无效，未执行指令。');
  return { accountId, installationId, desktopId, agentId, sessionId, taskId };
};

export const createWinkGoRemoteSource = (input: WinkGoRemoteExecutionContext): string => {
  const context = normalizeWinkGoRemoteExecutionContext(input);
  const conversationScope = createHash('sha256')
    .update([context.installationId, context.desktopId, context.agentId, context.sessionId].join('\u0000'), 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `mobile_miniapp:${context.accountId}:${conversationScope}`;
};

export const createWinkGoSecureEnvelope = <T extends Record<string, unknown>>(
  payload: T,
  timestamp = Date.now()
): T & { timestamp: number; nonce: string } => ({
  ...payload,
  timestamp,
  nonce: randomBytes(18).toString('base64url'),
});

export class WinkGoReplayGuard {
  private readonly nonces = new Map<string, number>();

  constructor(
    private readonly clockSkewMs = WINKGO_REMOTE_CLOCK_SKEW_MS,
    private readonly maxEntries = 2_000,
    private readonly clock: () => number = Date.now
  ) {}

  accept(payload: Pick<WinkGoSecureEnvelope, 'timestamp' | 'nonce'>): boolean {
    const current = this.clock();
    const timestamp = Number(payload.timestamp || 0);
    const nonce = boundedText(payload.nonce, 128);
    this.prune(current);
    if (!timestamp || Math.abs(current - timestamp) > this.clockSkewMs) return false;
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, current + this.clockSkewMs);
    this.prune(current);
    return true;
  }

  clear(): void {
    this.nonces.clear();
  }

  private prune(current: number): void {
    for (const [nonce, expiresAt] of this.nonces) {
      if (expiresAt <= current || this.nonces.size > this.maxEntries) this.nonces.delete(nonce);
    }
  }
}

type TaskAssignment = {
  scope: string;
  expiresAt: number;
};

type CompletedTask = {
  result: WinkGoRemoteCommandResult;
  expiresAt: number;
};

export class WinkGoTaskCoordinator {
  private readonly active = new Map<string, Promise<WinkGoRemoteCommandResult>>();
  private readonly assignments = new Map<string, TaskAssignment>();
  private readonly completed = new Map<string, CompletedTask>();

  constructor(
    private readonly execute: WinkGoRemoteCommandExecutor,
    private readonly options: {
      timeoutMs?: number;
      completionTtlMs?: number;
      maxCompleted?: number;
      clock?: () => number;
    } = {}
  ) {}

  run(input: WinkGoRemoteCommand): Promise<WinkGoRemoteCommandResult> {
    const command = this.normalize(input);
    const current = this.clock();
    this.prune(current);

    const assignmentKey = [command.installationId, command.desktopId, command.taskId].join('\u0000');
    const assignmentScope = [command.accountId, command.agentId, command.sessionId].join('\u0000');
    const taskKey = `${assignmentKey}\u0000${assignmentScope}`;
    const assignment = this.assignments.get(assignmentKey);
    if (assignment && assignment.scope !== assignmentScope) {
      return Promise.resolve({
        ok: false,
        text: '该任务不属于当前账号、Agent 或会话，已拒绝执行。',
      });
    }

    const cached = this.completed.get(taskKey);
    if (cached && cached.expiresAt > current) return Promise.resolve(cached.result);
    const existing = this.active.get(taskKey);
    if (existing) return existing;

    const ttl = this.completionTtlMs;
    this.assignments.set(assignmentKey, {
      scope: assignmentScope,
      expiresAt: current + ttl,
    });

    const controller = new AbortController();
    const timeoutMs = this.timeoutMs;
    const task = this.withTimeout(
      this.execute(command.text, createWinkGoRemoteSource(command), {
        signal: controller.signal,
        timeoutMs,
        context: {
          accountId: command.accountId,
          installationId: command.installationId,
          desktopId: command.desktopId,
          agentId: command.agentId,
          sessionId: command.sessionId,
          taskId: command.taskId,
        },
      }),
      timeoutMs,
      controller
    )
      .catch(
        (error): WinkGoRemoteCommandResult => ({
          ok: false,
          text: error instanceof Error ? error.message : String(error || '电脑端执行失败。'),
        })
      )
      .then((result) => {
        this.completed.set(taskKey, { result, expiresAt: this.clock() + ttl });
        this.trimCompleted();
        return result;
      })
      .finally(() => {
        this.active.delete(taskKey);
      });
    this.active.set(taskKey, task);
    return task;
  }

  clear(): void {
    this.active.clear();
    this.assignments.clear();
    this.completed.clear();
  }

  private normalize(input: WinkGoRemoteCommand): WinkGoRemoteCommand {
    const accountId = boundedText(input.accountId || input.skillScope, 64).toLowerCase();
    const installationId = boundedText(input.installationId, 180);
    const desktopId = boundedText(input.desktopId, 160);
    const messageId = boundedText(input.messageId, 180);
    const skillScope = boundedText(input.skillScope || input.accountId, 64).toLowerCase();
    const agentId = boundedText(input.agentId, 180);
    const sessionId = boundedText(input.sessionId, 180);
    const taskId = boundedText(input.taskId || input.messageId, 180);
    const text = boundedText(input.text, 6_000);
    if (skillScope !== accountId) {
      throw new Error('客户账号身份无效，未执行指令。');
    }
    if (!messageId || !/^[A-Za-z0-9._:-]{3,180}$/.test(messageId)) {
      throw new Error('消息身份无效，未执行指令。');
    }
    const context = normalizeWinkGoRemoteExecutionContext({
      accountId,
      installationId,
      desktopId,
      agentId,
      sessionId,
      taskId,
    });
    if (!text) throw new Error('没有收到可执行的指令。');
    return {
      ...input,
      ...context,
      messageId,
      skillScope,
      text,
    };
  }

  private withTimeout(
    task: Promise<WinkGoRemoteCommandResult>,
    timeoutMs: number,
    controller: AbortController
  ): Promise<WinkGoRemoteCommandResult> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        callback();
      };
      timer = setTimeout(() => {
        controller.abort();
        finish(() => reject(new Error('电脑端执行超时，请确认 Runtime 正常后重试。')));
      }, timeoutMs);
      task.then(
        (result) => finish(() => resolve(result)),
        (error) => finish(() => reject(error))
      );
    });
  }

  private prune(current: number): void {
    for (const [key, assignment] of this.assignments) {
      if (assignment.expiresAt <= current) this.assignments.delete(key);
    }
    for (const [key, completed] of this.completed) {
      if (completed.expiresAt <= current) this.completed.delete(key);
    }
  }

  private trimCompleted(): void {
    while (this.completed.size > this.maxCompleted) {
      const oldest = this.completed.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.completed.delete(oldest);
    }
  }

  private get timeoutMs(): number {
    return Math.max(1_000, Math.min(120_000, this.options.timeoutMs ?? 60_000));
  }

  private get completionTtlMs(): number {
    return Math.max(10_000, Math.min(30 * 60_000, this.options.completionTtlMs ?? 10 * 60_000));
  }

  private get maxCompleted(): number {
    return Math.max(50, Math.min(10_000, this.options.maxCompleted ?? 2_000));
  }

  private get clock(): () => number {
    return this.options.clock ?? Date.now;
  }
}
