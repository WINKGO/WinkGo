/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  WinkGoCapturedNotification,
  WinkGoMediaControlAction,
  WinkGoMediaSnapshot,
  WinkGoMediaTarget,
  WinkGoNotificationAccess,
  WinkGoWindowsRuntimeState,
} from '@/common/adapter/ipcBridge';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { resolveNetEaseArtworkUrl } from './NetEaseArtworkService';
import { resolveQqMusicArtworkDataUrl } from './QqMusicArtworkService';

type RuntimeCommandResult = {
  type: 'command-result';
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

type RuntimeEvent =
  | RuntimeCommandResult
  | { type: 'ready'; data: WinkGoWindowsRuntimeState }
  | { type: 'media-snapshot'; data: WinkGoMediaSnapshot | null }
  | { type: 'notification'; data: WinkGoCapturedNotification }
  | { type: 'runtime-warning'; scope: string; message: string };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type RuntimeCallbacks = {
  onMedia: (snapshot: WinkGoMediaSnapshot | null) => void;
  onNotification: (notification: WinkGoCapturedNotification) => void;
};

const STOP_DELAY_MS = 20_000;
const REQUEST_TIMEOUT_MS = 8_000;
const CONTROL_REQUEST_TIMEOUT_MS = 4_000;

const unavailableState = (): WinkGoWindowsRuntimeState => ({
  available: false,
  mediaEnabled: false,
  notificationEnabled: false,
  notificationAccess: 'Unavailable',
  media: null,
  notification: null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const resolveRuntimeScript = (): string => {
  const candidates = [
    path.join(process.resourcesPath, 'winkgo', 'windows-runtime-bridge.ps1'),
    path.join(process.cwd(), 'resources', 'winkgo', 'windows-runtime-bridge.ps1'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};

const resolveWindowsPowerShell = (): string => {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (systemRoot) {
    const systemPowerShell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (fs.existsSync(systemPowerShell)) return systemPowerShell;
  }
  return 'powershell.exe';
};

export class WinkGoWindowsRuntimeService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private controlChild: ChildProcessWithoutNullStreams | null = null;
  private state: WinkGoWindowsRuntimeState = unavailableState();
  private requestCounter = 0;
  private pending = new Map<string, PendingRequest>();
  private controlPending = new Map<string, PendingRequest>();
  private stopTimer: NodeJS.Timeout | null = null;
  private disposing = false;

  constructor(private readonly callbacks: RuntimeCallbacks) {}

  async configure(options: {
    mediaEnabled: boolean;
    mediaTarget?: WinkGoMediaTarget;
    notificationEnabled: boolean;
  }): Promise<WinkGoWindowsRuntimeState> {
    if (process.platform !== 'win32') {
      this.state = unavailableState();
      return this.state;
    }
    if (options.mediaEnabled) {
      // Keep transport controls on a dedicated process. Media metadata and
      // artwork probing can be slow for some players and must never block a
      // pause/previous/next click.
      this.ensureControlStarted();
    }
    if (!options.mediaEnabled && !options.notificationEnabled && !this.child) {
      this.state = {
        ...this.state,
        mediaEnabled: false,
        notificationEnabled: false,
      };
      return this.state;
    }

    const state = await this.request<WinkGoWindowsRuntimeState>({
      type: 'configure',
      ...options,
      mediaTarget: options.mediaTarget ?? 'system',
    });
    this.state = state;
    if (options.mediaEnabled || options.notificationEnabled) {
      this.cancelScheduledStop();
    } else {
      this.scheduleStop();
    }
    return state;
  }

  async getState(): Promise<WinkGoWindowsRuntimeState> {
    if (process.platform !== 'win32') return unavailableState();
    if (!this.child) return this.state;
    const state = await this.request<WinkGoWindowsRuntimeState>({ type: 'get-state' });
    this.state = state;
    return state;
  }

  async controlMedia(action: WinkGoMediaControlAction): Promise<{ controlled: boolean }> {
    if (process.platform !== 'win32') return { controlled: false };
    return this.requestControl<{ controlled: boolean }>({
      type: 'media-control',
      action,
      appId: this.state.media?.appId ?? '',
    });
  }

  async requestNotificationAccess(): Promise<{ status: WinkGoNotificationAccess }> {
    if (process.platform !== 'win32') return { status: 'Unavailable' };
    const result = await this.request<{ status: WinkGoNotificationAccess }>({
      type: 'request-notification-access',
    });
    this.state = { ...this.state, notificationAccess: result.status };
    return result;
  }

  dispose(): void {
    this.disposing = true;
    this.cancelScheduledStop();
    const child = this.child;
    this.child = null;
    const controlChild = this.controlChild;
    this.controlChild = null;
    if (child && !child.killed) {
      try {
        child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`);
      } catch {
        // The process may already be closing.
      }
      child.kill();
    }
    if (controlChild && !controlChild.killed) {
      try {
        controlChild.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`);
      } catch {
        // The process may already be closing.
      }
      controlChild.kill();
    }
    this.rejectPending(new Error('WINK_GO_WINDOWS_RUNTIME_STOPPED'));
    this.rejectControlPending(new Error('WINK_GO_WINDOWS_CONTROL_STOPPED'));
  }

  private async request<T>(command: Record<string, unknown>): Promise<T> {
    const child = this.ensureStarted();
    const requestId = `winkgo-${Date.now()}-${++this.requestCounter}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('WINK_GO_WINDOWS_RUNTIME_TIMEOUT'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        child.stdin.write(`${JSON.stringify({ ...command, requestId })}\n`, 'utf8');
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) return this.child;
    const scriptPath = resolveRuntimeScript();
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`WINK_GO_WINDOWS_RUNTIME_SCRIPT_NOT_FOUND:${scriptPath}`);
    }

    this.disposing = false;
    const child = spawn(
      resolveWindowsPowerShell(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.handleLine(line));
    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      if (!line || /Preparing modules for first use/i.test(line)) return;
      console.warn('[WinkGoWindowsRuntime]', line);
    });
    child.once('error', (error) => {
      console.error('[WinkGoWindowsRuntime] Process error:', error);
    });
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      this.state = unavailableState();
      this.rejectPending(new Error(`WINK_GO_WINDOWS_RUNTIME_EXITED:${code ?? 'unknown'}:${signal ?? 'none'}`));
      if (!this.disposing && code !== 0) {
        console.warn('[WinkGoWindowsRuntime] Bridge exited unexpectedly:', { code, signal });
      }
    });
    return child;
  }

  private async requestControl<T>(command: Record<string, unknown>): Promise<T> {
    const child = this.ensureControlStarted();
    const requestId = `winkgo-control-${Date.now()}-${++this.requestCounter}`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.controlPending.delete(requestId);
        reject(new Error('WINK_GO_WINDOWS_CONTROL_TIMEOUT'));
      }, CONTROL_REQUEST_TIMEOUT_MS);
      this.controlPending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        child.stdin.write(`${JSON.stringify({ ...command, requestId })}\n`, 'utf8');
      } catch (error) {
        clearTimeout(timeout);
        this.controlPending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private ensureControlStarted(): ChildProcessWithoutNullStreams {
    if (this.controlChild && !this.controlChild.killed) return this.controlChild;
    const scriptPath = resolveRuntimeScript();
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`WINK_GO_WINDOWS_RUNTIME_SCRIPT_NOT_FOUND:${scriptPath}`);
    }

    const child = spawn(
      resolveWindowsPowerShell(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-ControlWorker'],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    this.controlChild = child;
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.handleControlLine(line));
    readline.createInterface({ input: child.stderr }).on('line', (line) => {
      if (!line || /Preparing modules for first use/i.test(line)) return;
      console.warn('[WinkGoWindowsControl]', line);
    });
    child.once('error', (error) => {
      console.error('[WinkGoWindowsControl] Process error:', error);
    });
    child.once('exit', (code, signal) => {
      if (this.controlChild === child) this.controlChild = null;
      this.rejectControlPending(new Error(`WINK_GO_WINDOWS_CONTROL_EXITED:${code ?? 'unknown'}:${signal ?? 'none'}`));
      if (!this.disposing && code !== 0) {
        console.warn('[WinkGoWindowsControl] Bridge exited unexpectedly:', { code, signal });
      }
    });
    return child;
  }

  private handleControlLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let event: RuntimeCommandResult;
    try {
      event = JSON.parse(trimmed) as RuntimeCommandResult;
    } catch {
      return;
    }
    if (event.type !== 'command-result') return;
    const request = this.controlPending.get(event.requestId);
    if (!request) return;
    this.controlPending.delete(event.requestId);
    clearTimeout(request.timeout);
    if (event.ok) request.resolve(event.data);
    else request.reject(new Error(event.error || 'WINK_GO_WINDOWS_CONTROL_COMMAND_FAILED'));
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) return;
    let event: RuntimeEvent;
    try {
      event = JSON.parse(trimmed) as RuntimeEvent;
    } catch {
      return;
    }

    if (event.type === 'command-result') {
      const request = this.pending.get(event.requestId);
      if (!request) return;
      this.pending.delete(event.requestId);
      clearTimeout(request.timeout);
      if (event.ok) request.resolve(event.data);
      else request.reject(new Error(event.error || 'WINK_GO_WINDOWS_RUNTIME_COMMAND_FAILED'));
      return;
    }
    if (event.type === 'ready') {
      this.state = event.data;
      return;
    }
    if (event.type === 'media-snapshot') {
      this.state = { ...this.state, media: event.data };
      this.callbacks.onMedia(event.data);
      if (event.data && !event.data.coverUrl) {
        const snapshot = event.data;
        const localCoverUrl = resolveNetEaseArtworkUrl(snapshot);
        if (localCoverUrl) this.publishArtworkIfCurrent(snapshot, localCoverUrl);
        else {
          void resolveQqMusicArtworkDataUrl(snapshot).then((coverUrl) => {
            if (coverUrl) this.publishArtworkIfCurrent(snapshot, coverUrl);
          });
        }
      }
      return;
    }
    if (event.type === 'notification') {
      this.state = { ...this.state, notification: event.data };
      this.callbacks.onNotification(event.data);
      return;
    }
    if (event.type === 'runtime-warning' && isRecord(event)) {
      console.warn(`[WinkGoWindowsRuntime:${event.scope}]`, event.message);
    }
  }

  private publishArtworkIfCurrent(source: WinkGoMediaSnapshot, coverUrl: string): void {
    const currentMedia = this.state.media;
    if (
      !currentMedia ||
      currentMedia.appId !== source.appId ||
      currentMedia.title !== source.title ||
      currentMedia.artist !== source.artist ||
      currentMedia.coverUrl
    ) {
      return;
    }

    const enriched = { ...currentMedia, coverUrl, updatedAt: Date.now() };
    this.state = { ...this.state, media: enriched };
    this.callbacks.onMedia(enriched);
  }

  private scheduleStop(): void {
    this.cancelScheduledStop();
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      if (this.state.mediaEnabled || this.state.notificationEnabled) return;
      this.dispose();
    }, STOP_DELAY_MS);
  }

  private cancelScheduledStop(): void {
    if (!this.stopTimer) return;
    clearTimeout(this.stopTimer);
    this.stopTimer = null;
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }

  private rejectControlPending(error: Error): void {
    for (const request of this.controlPending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.controlPending.clear();
  }
}
