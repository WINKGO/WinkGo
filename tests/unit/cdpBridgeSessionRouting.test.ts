/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  SINGLE_SESSION_ID,
  SINGLE_TARGET_ID,
  buildTargetInfo,
  decideCdpCommand,
  isAcceptableSessionId,
  tokensMatch,
} from '@process/resources/builtinMcp/cdpTargetProtocol';

const targetInfo = () => buildTargetInfo('Example', 'https://example.com');

describe('WINK GO CDP session routing contract', () => {
  it('accepts only browser-level commands and the single page session', () => {
    expect(isAcceptableSessionId(undefined)).toBe(true);
    expect(isAcceptableSessionId('')).toBe(true);
    expect(isAcceptableSessionId(SINGLE_SESSION_ID)).toBe(true);
    expect(isAcceptableSessionId('another-session')).toBe(false);
  });

  it('backfills attachedToTarget only for browser-level setAutoAttach', () => {
    const browserLevel = decideCdpCommand(
      { id: 1, method: 'Target.setAutoAttach', params: { autoAttach: true } },
      targetInfo
    );
    expect(browserLevel.kind).toBe('reply-and-emit');
    if (browserLevel.kind === 'reply-and-emit') {
      expect(browserLevel.emit.map((event) => event.method)).toContain('Target.attachedToTarget');
    }

    const sessionLevel = decideCdpCommand(
      { id: 2, method: 'Target.setAutoAttach', params: { autoAttach: true }, sessionId: SINGLE_SESSION_ID },
      targetInfo
    );
    expect(sessionLevel.kind).toBe('reply');
  });

  it('forwards page commands and rejects unsupported browser commands', () => {
    expect(decideCdpCommand({ id: 3, method: 'Network.enable', sessionId: SINGLE_SESSION_ID }, targetInfo).kind).toBe(
      'forward'
    );
    expect(decideCdpCommand({ id: 4, method: 'Target.createTarget' }, targetInfo).kind).toBe('error');
    expect(decideCdpCommand({ id: 5, method: 'Browser.close' }, targetInfo).kind).toBe('error');
  });

  it('attaches only to the exposed target with the fixed session id', () => {
    const accepted = decideCdpCommand(
      { id: 6, method: 'Target.attachToTarget', params: { targetId: SINGLE_TARGET_ID } },
      targetInfo
    );
    expect(accepted.kind).toBe('reply-and-emit');
    if (accepted.kind === 'reply-and-emit') {
      expect(accepted.payload).toEqual({ sessionId: SINGLE_SESSION_ID });
    }

    expect(
      decideCdpCommand({ id: 7, method: 'Target.attachToTarget', params: { targetId: 'not-ours' } }, targetInfo).kind
    ).toBe('error');
  });

  it('suppresses duplicate attachedToTarget announcements per connection', () => {
    const announced = new Set<string>();
    const collect = (decision: ReturnType<typeof decideCdpCommand>): string[] => {
      if (decision.kind !== 'reply-and-emit') return [];
      const sent: string[] = [];
      for (const event of decision.emit) {
        if (event.method === 'Target.attachedToTarget') {
          const sessionId = (event.params as { sessionId?: string }).sessionId;
          if (sessionId && announced.has(sessionId)) continue;
          if (sessionId) announced.add(sessionId);
        }
        sent.push(event.method);
      }
      return sent;
    };

    expect(
      collect(decideCdpCommand({ id: 8, method: 'Target.setAutoAttach', params: { autoAttach: true } }, targetInfo))
    ).toContain('Target.attachedToTarget');
    expect(
      collect(
        decideCdpCommand({ id: 9, method: 'Target.attachToTarget', params: { targetId: SINGLE_TARGET_ID } }, targetInfo)
      )
    ).not.toContain('Target.attachedToTarget');
  });

  it('compares bridge tokens safely', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
    expect(tokensMatch('abc123', 'abc124')).toBe(false);
    expect(tokensMatch('abc', 'abcdef')).toBe(false);
  });
});
