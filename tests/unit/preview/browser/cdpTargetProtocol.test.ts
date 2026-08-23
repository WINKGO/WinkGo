/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  SINGLE_SESSION_ID,
  SINGLE_TARGET_ID,
  buildListPayload,
  buildTargetInfo,
  buildVersionPayload,
  decideCdpCommand,
  isAcceptableSessionId,
  tokensMatch,
} from '@process/resources/builtinMcp/cdpTargetProtocol';

const target = () => buildTargetInfo('WINK GO', 'https://winkgo.top/');

describe('single-target CDP protocol', () => {
  it('advertises exactly one visible page', () => {
    expect(buildVersionPayload('ws://127.0.0.1:9230/x', '120.0').webSocketDebuggerUrl).toContain('ws://');
    const list = buildListPayload('ws://127.0.0.1:9230/x', 'WINK GO', 'https://winkgo.top/');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(SINGLE_TARGET_ID);
  });

  it('creates the events Puppeteer needs for discovery and attachment', () => {
    const discover = decideCdpCommand(
      { id: 1, method: 'Target.setDiscoverTargets', params: { discover: true } },
      target
    );
    expect(discover.kind).toBe('reply-and-emit');
    const attach = decideCdpCommand(
      { id: 2, method: 'Target.attachToTarget', params: { targetId: SINGLE_TARGET_ID, flatten: true } },
      target
    );
    expect(attach.kind).toBe('reply-and-emit');
  });

  it('forwards page operations but rejects destructive browser operations', () => {
    expect(decideCdpCommand({ id: 3, method: 'Page.navigate' }, target).kind).toBe('forward');
    expect(decideCdpCommand({ id: 4, method: 'Browser.close' }, target).kind).toBe('error');
    expect(decideCdpCommand({ id: 5, method: 'Target.createTarget' }, target).kind).toBe('error');
  });

  it('accepts only its own session and constant-time token matches', () => {
    expect(isAcceptableSessionId(SINGLE_SESSION_ID)).toBe(true);
    expect(isAcceptableSessionId('foreign-session')).toBe(false);
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
    expect(tokensMatch('abc123', 'abc')).toBe(false);
  });
});
