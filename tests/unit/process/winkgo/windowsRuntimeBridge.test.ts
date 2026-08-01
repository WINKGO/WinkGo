/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const bridgeSource = fs.readFileSync(
  path.resolve(process.cwd(), 'resources', 'winkgo', 'windows-runtime-bridge.ps1'),
  'utf8'
);

const sodaTransportSource = (): string => {
  const start = bridgeSource.indexOf('public static bool SendSodaTransport');
  const end = bridgeSource.indexOf('public static class WinkGoMediaKeyNative', start);
  return start >= 0 && end > start ? bridgeSource.slice(start, end) : '';
};

describe('WINK GO Windows media control bridge', () => {
  it('controls Soda Music through a background window message without activating or clicking its UI', () => {
    const source = sodaTransportSource();

    expect(source).toContain('PostMessage');
    expect(source).toContain('WM_APPCOMMAND');
    expect(source).not.toContain('SetForegroundWindow');
    expect(source).not.toContain('BringWindowToTop');
    expect(source).not.toContain('ShowWindowAsync');
    expect(source).not.toContain('SetCursorPos');
    expect(source).not.toContain('mouse_event');
  });

  it('keeps the PowerShell workers hidden when Windows media control is unavailable', () => {
    expect(bridgeSource).toContain('UseShellExecute = false');
    expect(bridgeSource).toContain('CreateNoWindow = true');
  });
});
