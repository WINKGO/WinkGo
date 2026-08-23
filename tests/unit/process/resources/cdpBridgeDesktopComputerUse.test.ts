/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  webContents: { fromId: vi.fn(() => null) },
}));

import { startCdpBridge, type CdpBridgeHandle } from '@process/resources/builtinMcp/cdpBridge';

describe('WINK GO desktop Computer Use bridge', () => {
  let bridge: CdpBridgeHandle | undefined;

  afterEach(async () => {
    await bridge?.close();
    bridge = undefined;
  });

  it('routes an authenticated Agent desktop goal to the independent desktop Computer Use dispatcher', async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, status: { phase: 'completed', stepCount: 2 } });
    bridge = await startCdpBridge(undefined, undefined, { run });

    const response = await fetch(`http://127.0.0.1:${bridge.port}/winkgo/desktop-computer-use/run`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        'Content-Type': 'application/json',
        'X-WINKGO-Conversation-ID': 'conversation-1',
      },
      body: JSON.stringify({ goal: '打开记事本并输入 WINK GO', maxSteps: 6 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: { phase: 'completed', stepCount: 2 } });
    expect(run).toHaveBeenCalledWith({
      goal: '打开记事本并输入 WINK GO',
      maxSteps: 6,
      conversationId: 'conversation-1',
    });
  });

  it('rejects an empty desktop goal before invoking the dispatcher', async () => {
    const run = vi.fn();
    bridge = await startCdpBridge(undefined, undefined, { run });

    const response = await fetch(`http://127.0.0.1:${bridge.port}/winkgo/desktop-computer-use/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: '   ' }),
    });

    expect(response.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
  });

  it('exposes an authenticated observe and single-action loop for the current Agent model', async () => {
    const run = vi.fn();
    const observe = vi.fn().mockResolvedValue({
      ok: true,
      observation: {
        target: { hwnd: 101, pid: 202, title: 'Untitled - Notepad' },
        screenshotPath: 'C:\\evidence\\observe.png',
        controls: [],
        ocr: [],
        text: '',
      },
    });
    const act = vi.fn().mockResolvedValue({ ok: true, observation: { target: { hwnd: 303, pid: 404 } } });
    const cancel = vi.fn().mockResolvedValue({ ok: true });
    bridge = await startCdpBridge(undefined, undefined, { run, observe, act, cancel });

    const headers = {
      Authorization: `Bearer ${bridge.token}`,
      'Content-Type': 'application/json',
      'X-WINKGO-Conversation-ID': 'conversation-agent-loop',
    };
    const observed = await fetch(`http://127.0.0.1:${bridge.port}/winkgo/desktop-computer-use/observe`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId: 'desktop-session-1' }),
    });
    const acted = await fetch(`http://127.0.0.1:${bridge.port}/winkgo/desktop-computer-use/act`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId: 'desktop-session-1',
        target: { hwnd: 101, pid: 202 },
        action: { kind: 'hotkey', keys: ['WIN', 'R'], label: 'Open Run' },
      }),
    });

    expect(observed.status).toBe(200);
    expect(acted.status).toBe(200);
    expect(observe).toHaveBeenCalledWith({
      sessionId: 'desktop-session-1',
      conversationId: 'conversation-agent-loop',
      target: undefined,
    });
    expect(act).toHaveBeenCalledWith({
      sessionId: 'desktop-session-1',
      conversationId: 'conversation-agent-loop',
      target: { hwnd: 101, pid: 202 },
      action: { kind: 'hotkey', keys: ['WIN', 'R'], label: 'Open Run' },
      confirmed: false,
    });
  });

  it('lets the Agent safely launch an application before any external window can be observed', async () => {
    const launch = vi.fn().mockResolvedValue({
      ok: true,
      observation: {
        target: { hwnd: 501, pid: 502, title: 'Untitled - Notepad', processName: 'Notepad.exe' },
        screenshotPath: 'C:\\evidence\\launched.png',
      },
    });
    bridge = await startCdpBridge(undefined, undefined, { run: vi.fn(), launch });

    const response = await fetch(`http://127.0.0.1:${bridge.port}/winkgo/desktop-computer-use/launch`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        'Content-Type': 'application/json',
        'X-WINKGO-Conversation-ID': 'conversation-launch',
      },
      body: JSON.stringify({ sessionId: 'desktop-session-launch', appName: '记事本' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ ok: true }));
    expect(launch).toHaveBeenCalledWith({
      sessionId: 'desktop-session-launch',
      appName: '记事本',
      conversationId: 'conversation-launch',
    });
  });

  it('accepts the public MCP action type field and normalizes it for the Runtime dispatcher', async () => {
    const run = vi.fn();
    const observe = vi.fn();
    const act = vi.fn().mockResolvedValue({ ok: true });
    const cancel = vi.fn();
    bridge = await startCdpBridge(undefined, undefined, { run, observe, act, cancel });

    const response = await fetch(`http://127.0.0.1:${bridge.port}/winkgo/desktop-computer-use/act`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        'Content-Type': 'application/json',
        'X-WINKGO-Conversation-ID': 'conversation-public-action',
      },
      body: JSON.stringify({
        sessionId: 'desktop-session-public-action',
        target: { hwnd: 101, pid: 202 },
        action: { type: 'press', key: 'WIN', label: 'Open Start' },
      }),
    });

    expect(response.status).toBe(200);
    expect(act).toHaveBeenCalledWith({
      sessionId: 'desktop-session-public-action',
      conversationId: 'conversation-public-action',
      target: { hwnd: 101, pid: 202 },
      action: { kind: 'press', key: 'WIN', label: 'Open Start' },
      confirmed: false,
    });
  });

  it('accepts focused text input without coordinates as advertised by the MCP tool', async () => {
    const act = vi.fn().mockResolvedValue({ ok: true });
    bridge = await startCdpBridge(undefined, undefined, { run: vi.fn(), observe: vi.fn(), act, cancel: vi.fn() });

    const response = await fetch(`http://127.0.0.1:${bridge.port}/winkgo/desktop-computer-use/act`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'desktop-session-focused-input',
        target: { hwnd: 8720982, pid: 4640 },
        action: { type: 'type', text: 'notepad', label: '在当前焦点输入' },
      }),
    });

    expect(response.status).toBe(200);
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({
        action: { kind: 'type', text: 'notepad', label: '在当前焦点输入' },
      })
    );
  });

  it('routes a bounded desktop wait and returns a fresh observation', async () => {
    const run = vi.fn();
    const observe = vi.fn();
    const act = vi.fn();
    const wait = vi.fn().mockResolvedValue({
      ok: true,
      observation: { target: { hwnd: 303, pid: 404 }, text: ['Ready'] },
    });
    const cancel = vi.fn();
    bridge = await startCdpBridge(undefined, undefined, { run, observe, act, wait, cancel });

    const response = await fetch(`http://127.0.0.1:${bridge.port}/winkgo/desktop-computer-use/wait`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bridge.token}`,
        'Content-Type': 'application/json',
        'X-WINKGO-Conversation-ID': 'conversation-wait',
      },
      body: JSON.stringify({ sessionId: 'desktop-session-wait', milliseconds: 850 }),
    });

    expect(response.status).toBe(200);
    expect(wait).toHaveBeenCalledWith({
      sessionId: 'desktop-session-wait',
      milliseconds: 850,
      conversationId: 'conversation-wait',
    });
  });

  it('rejects malformed Agent desktop actions before invoking the Runtime dispatcher', async () => {
    const run = vi.fn();
    const observe = vi.fn();
    const act = vi.fn();
    const cancel = vi.fn();
    bridge = await startCdpBridge(undefined, undefined, { run, observe, act, cancel });

    const response = await fetch(`http://127.0.0.1:${bridge.port}/winkgo/desktop-computer-use/act`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's', target: { hwnd: 0, pid: 0 }, action: { kind: 'launch_process' } }),
    });

    expect(response.status).toBe(400);
    expect(act).not.toHaveBeenCalled();
  });

  it('aborts an autonomous browser task when its HTTP caller disconnects', async () => {
    let taskAborted = false;
    const runAgentTask = vi.fn(
      (_request: unknown, options?: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener(
            'abort',
            () => {
              taskAborted = true;
              resolve({ ok: false, status: 'blocked', message: 'cancelled' });
            },
            { once: true }
          );
          setTimeout(() => resolve({ ok: true, status: 'completed' }), 300);
        })
    );
    bridge = await startCdpBridge({
      list: vi.fn(),
      status: vi.fn(),
      run: vi.fn(),
      snapshot: vi.fn(),
      act: vi.fn(),
      runAgentTask,
    });
    const controller = new AbortController();
    const pending = fetch(`http://127.0.0.1:${bridge.port}/winkgo/browser-agent/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'Fill the form' }),
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(runAgentTask).toHaveBeenCalledOnce());

    controller.abort();
    await expect(pending).rejects.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(taskAborted).toBe(true);
  });
});
