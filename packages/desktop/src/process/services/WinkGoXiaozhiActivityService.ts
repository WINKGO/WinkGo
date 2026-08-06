/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import type { WinkGoXiaozhiActivity } from '@/common/adapter/ipcBridge';

const POLL_INTERVAL_MS = 350;
const COMMAND_TIMEOUT_MS = 3 * 60_000;
const MAX_SAFE_TEXT_LENGTH = 180;

type SupportedSource = 'xiaozhi_hardware' | 'mobile_miniapp';

type PendingActivity = WinkGoXiaozhiActivity & {
  source: SupportedSource;
};

const compactSafeText = (value: unknown, fallback = ''): string => {
  const text = (typeof value === 'string' ? value : '')
    .replace(/(?:token|password|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, '[已隐藏]')
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [...text].slice(0, MAX_SAFE_TEXT_LENGTH).join('') || fallback;
};

const decodePythonString = (value: string): string =>
  value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\');

const extractQuotedField = (argumentsText: string, field: string): string => {
  const single = argumentsText.match(new RegExp(`["']${field}["']\\s*:\\s*'((?:\\\\.|[^'])*)'`));
  if (single) return decodePythonString(single[1]);
  const double = argumentsText.match(new RegExp(`["']${field}["']\\s*:\\s*"((?:\\\\.|[^"])*)"`));
  return double ? decodePythonString(double[1]) : '';
};

const activityTimestamp = (line: string): number => {
  const match = line.match(/^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\]/);
  if (!match) return Date.now();
  const parsed = Date.parse(`${match[1]}T${match[2]}`);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

const sourceLabel = (source: SupportedSource): string => (source === 'xiaozhi_hardware' ? 'ESP32 小智' : '手机小程序');

/** Pure log parser used by both the live tailer and unit tests. */
export class WinkGoXiaozhiActivityParser {
  private pending: PendingActivity[] = [];
  private sequence = 0;

  feed(line: string): WinkGoXiaozhiActivity[] {
    const outerCall = line.match(/调用工具:\s*tools\.run_skill_command,\s*参数:\s*\{(.*)\}\s*$/);
    if (outerCall) {
      const command = compactSafeText(extractQuotedField(outerCall[1], 'command'));
      const rawSource = extractQuotedField(outerCall[1], 'source').trim().toLowerCase();
      if (!command || (rawSource !== 'xiaozhi_hardware' && rawSource !== 'mobile_miniapp')) return [];
      const source = rawSource as SupportedSource;
      const timestamp = activityTimestamp(line);
      const activity: PendingActivity = {
        id: `xiaozhi-command:${source}:${timestamp}:${++this.sequence}`,
        source,
        sourceLabel: sourceLabel(source),
        command,
        status: 'running',
        message: '指令已进入 WINK GO Runtime',
        startedAtMs: timestamp,
        updatedAtMs: timestamp,
      };
      this.pending.push(activity);
      return [activity];
    }

    const innerCall = line.match(/调用工具:\s*([\w.-]+),\s*参数:/);
    if (innerCall && innerCall[1] !== 'tools.run_skill_command') {
      const active = this.pending.at(-1);
      if (!active) return [];
      active.toolName = compactSafeText(innerCall[1]);
      active.message = '已匹配本机技能，正在执行';
      active.updatedAtMs = activityTimestamp(line);
      return [{ ...active }];
    }

    const completion = line.match(/工具 \[tools\.run_skill_command\] 执行(成功|失败) \((\d+)ms\)(?::\s*(.*))?$/);
    if (!completion) return [];
    const active = this.pending.shift();
    if (!active) return [];
    const succeeded = completion[1] === '成功';
    const updatedAtMs = activityTimestamp(line);
    const detail = compactSafeText(completion[3]);
    return [
      {
        ...active,
        status: succeeded ? 'success' : 'error',
        message: succeeded ? 'WINK GO Runtime 已确认执行完成' : detail || 'WINK GO Runtime 执行失败',
        elapsedMs: Number(completion[2]) || Math.max(0, updatedAtMs - active.startedAtMs),
        updatedAtMs,
      },
    ];
  }

  expire(nowMs = Date.now()): WinkGoXiaozhiActivity[] {
    const expired = this.pending.filter((activity) => nowMs - activity.startedAtMs >= COMMAND_TIMEOUT_MS);
    if (expired.length === 0) return [];
    const expiredIds = new Set(expired.map((activity) => activity.id));
    this.pending = this.pending.filter((activity) => !expiredIds.has(activity.id));
    return expired.map((activity) => ({
      ...activity,
      status: 'error',
      message: '硬件指令执行超时，请检查 Runtime 和对应软件',
      updatedAtMs: nowMs,
      elapsedMs: Math.max(0, nowMs - activity.startedAtMs),
    }));
  }
}

export class WinkGoXiaozhiActivityMonitor {
  private timer: NodeJS.Timeout | null = null;
  private offset = 0;
  private initialized = false;
  private reading = false;
  private carry = '';
  private decoder = new StringDecoder('utf8');
  private readonly parser = new WinkGoXiaozhiActivityParser();

  constructor(
    private readonly resolveLogPath: () => string | null,
    private readonly onActivity: (activity: WinkGoXiaozhiActivity) => void
  ) {}

  start(): () => void {
    if (this.timer) return () => this.stop();
    void this.poll(true);
    this.timer = setInterval(() => void this.poll(false), POLL_INTERVAL_MS);
    this.timer.unref?.();
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(activities: WinkGoXiaozhiActivity[]): void {
    for (const activity of activities) this.onActivity(activity);
  }

  private async poll(initial: boolean): Promise<void> {
    if (this.reading) return;
    const logPath = this.resolveLogPath();
    if (!logPath) return;
    this.reading = true;
    try {
      const file = await stat(logPath);
      if (!this.initialized) {
        this.initialized = true;
        this.offset = initial ? file.size : 0;
        return;
      }
      if (file.size < this.offset) {
        this.offset = 0;
        this.carry = '';
        this.decoder = new StringDecoder('utf8');
      }
      if (file.size > this.offset) {
        const length = file.size - this.offset;
        const buffer = Buffer.allocUnsafe(length);
        const handle = await open(logPath, 'r');
        try {
          const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
          this.offset += bytesRead;
          const text = this.carry + this.decoder.write(buffer.subarray(0, bytesRead));
          const lines = text.split(/\r?\n/);
          this.carry = lines.pop() ?? '';
          for (const line of lines) this.emit(this.parser.feed(line));
        } finally {
          await handle.close();
        }
      }
      this.emit(this.parser.expire());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[WINK GO Xiaozhi] 读取 Runtime 活动日志失败：', error);
      }
    } finally {
      this.reading = false;
    }
  }
}
