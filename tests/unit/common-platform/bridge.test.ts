// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

type TransportEmitter = {
  emit: (name: string, data: unknown) => unknown;
};

const loadLoopbackBridge = async () => {
  vi.resetModules();
  const { bridge } = await import('@/common/platform/bridge');
  let incoming: TransportEmitter | undefined;
  const outbound: Array<{ name: string; data: unknown }> = [];

  bridge.adapter({
    emit(name, data) {
      outbound.push({ name, data });
      return incoming?.emit(name, data);
    },
    on(emitter) {
      incoming = emitter;
    },
  });

  return { bridge, getIncoming: () => incoming, outbound };
};

/**
 * Loopback bridge that JSON round-trips every message, mirroring the real
 * Electron IPC / WebSocket transports (adapter/main.ts serializes with
 * JSON.stringify, which silently drops `undefined` values).
 */
const loadSerializingBridge = async () => {
  vi.resetModules();
  const { bridge } = await import('@/common/platform/bridge');
  let incoming: TransportEmitter | undefined;

  bridge.adapter({
    emit(name, data) {
      const wire = JSON.stringify({ name, data });
      const parsed = JSON.parse(wire) as { name: string; data: unknown };
      return incoming?.emit(parsed.name, parsed.data);
    },
    on(emitter) {
      incoming = emitter;
    },
  });

  return { bridge };
};

describe('local bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('routes provider requests and replies through the subscribe protocol', async () => {
    const { bridge, outbound } = await loadLoopbackBridge();
    const provider = bridge.buildProvider<string, { value: string }>('test.echo');
    provider.provider(({ value }) => value.toUpperCase());

    await expect(provider.invoke({ value: 'hello' })).resolves.toBe('HELLO');
    expect(outbound[0]?.name).toBe('subscribe-test.echo');
    expect(outbound[1]?.name).toMatch(/^subscribe\.callback-test\.echo/);
  });

  it('replaces the previous provider for the same key', async () => {
    const { bridge } = await loadLoopbackBridge();
    const endpoint = bridge.buildProvider<string, void>('test.replace');
    const first = vi.fn(() => 'first');
    endpoint.provider(first);
    endpoint.provider(() => 'second');

    await expect(endpoint.invoke()).resolves.toBe('second');
    expect(first).not.toHaveBeenCalled();
  });

  it('ignores malformed requests without invoking the provider', async () => {
    const { bridge, getIncoming } = await loadLoopbackBridge();
    const handler = vi.fn(() => 'unused');
    bridge.buildProvider<string, string>('test.invalid').provider(handler);

    getIncoming()?.emit('subscribe-test.invalid', { data: 'missing-id' });
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
  });

  // Regression: void-param invokes (e.g. window-controls:minimize) send
  // `data: undefined`, which JSON serialization strips from the wire payload.
  // The subscribe guard must not require the `data` key or those requests
  // are silently dropped after crossing a real IPC/WebSocket transport.
  it('handles void-param invokes across a JSON-serializing transport', async () => {
    const { bridge } = await loadSerializingBridge();
    const handler = vi.fn(() => undefined);
    const endpoint = bridge.buildProvider<void, void>('window-controls.test');
    endpoint.provider(handler);

    await expect(endpoint.invoke()).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns rejected providers to the caller instead of leaving invoke pending', async () => {
    const { bridge, outbound } = await loadLoopbackBridge();
    const sensitiveMessage = 'provider failed at C:\\Users\\Alice\\secret with sk-live-secret';
    const error = new Error(sensitiveMessage);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const endpoint = bridge.buildProvider<string, void>('test.failure');
    endpoint.provider(() => Promise.reject(error));

    await expect(endpoint.invoke()).rejects.toThrow('BRIDGE_PROVIDER_FAILED');

    expect(console.error).toHaveBeenCalledWith('[bridge] Provider "test.failure" failed:', error);
    const failure = outbound.find(({ name }) => /^subscribe\.callback-test\.failure.+\.error$/.test(name));
    expect(failure?.data).toEqual({ code: 'BRIDGE_PROVIDER_FAILED' });
    expect(JSON.stringify(failure)).not.toContain(sensitiveMessage);
  });
});
