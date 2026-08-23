/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  buildMcpSpawnCommand,
  resolveBridgeToken,
  resolveBrowserUrl,
} from '@/process/resources/builtinMcp/browserServerPort';

describe('WINK GO browser bridge environment', () => {
  it('uses only the inherited active bridge port', () => {
    expect(resolveBrowserUrl({ env: { WINKGO_CDP_ACTIVE_PORT: '9230' } })).toBe('http://127.0.0.1:9230');
    expect(resolveBrowserUrl({ env: { WINKGO_CDP_PORT: '9230' } })).toBeNull();
    expect(resolveBrowserUrl({ env: { WINKGO_CDP_ACTIVE_PORT: '70000' } })).toBeNull();
  });

  it('requires and trims the bridge token', () => {
    expect(resolveBridgeToken({ env: { WINKGO_CDP_BRIDGE_TOKEN: ' token\n' } })).toBe('token');
    expect(resolveBridgeToken({ env: {} })).toBeNull();
  });
});

describe('browser MCP spawn command', () => {
  it('routes npx through cmd.exe on Windows', () => {
    const result = buildMcpSpawnCommand({ platform: 'win32', version: '0.16.0', browserUrl: 'http://127.0.0.1:9230' });
    expect(result.command).toBe('cmd.exe');
    expect(result.args.slice(0, 2)).toEqual(['/c', 'npx']);
    expect(result.args).toContain('chrome-devtools-mcp@0.16.0');
  });

  it('keeps URL arguments separate and pins the version', () => {
    const result = buildMcpSpawnCommand({ platform: 'linux', version: '0.16.0', browserUrl: 'http://127.0.0.1:9230' });
    const flag = result.args.indexOf('--browser-url');
    expect(result.command).toBe('npx');
    expect(result.args[flag + 1]).toBe('http://127.0.0.1:9230');
    expect(result.args).not.toContain('chrome-devtools-mcp@latest');
  });
});
