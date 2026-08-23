/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let userDataDir = '';
vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir;
      throw new Error(`unexpected getPath: ${name}`);
    },
  },
}));

describe('WINK GO renderer recovery policy', () => {
  let timestamp = 1_000_000;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-renderer-recovery-'));
    timestamp = 1_000_000;
    vi.resetModules();
  });

  afterEach(() => fs.rmSync(userDataDir, { recursive: true, force: true }));

  it('backs off ordinary reloads before escalating', async () => {
    const { createRendererRecoveryPolicy } = await import('@/process/utils/rendererRecovery');
    const policy = createRendererRecoveryPolicy(() => timestamp);
    expect(policy.onCrash('crashed')).toEqual({ kind: 'reload', delayMs: 0 });
    timestamp += 100;
    expect(policy.onCrash('crashed')).toEqual({ kind: 'reload', delayMs: 1000 });
    timestamp += 100;
    expect(policy.onCrash('crashed')).toEqual({ kind: 'reload', delayMs: 3000 });
    expect(policy.onCrash('crashed')).toEqual({ kind: 'relaunch' });
  });

  it('relaunches launch-failed directly and throttles a fresh process', async () => {
    const { createRendererRecoveryPolicy } = await import('@/process/utils/rendererRecovery');
    expect(createRendererRecoveryPolicy(() => timestamp).onCrash('launch-failed')).toEqual({ kind: 'relaunch' });
    expect(createRendererRecoveryPolicy(() => timestamp + 1000).onCrash('launch-failed')).toEqual({ kind: 'give-up' });
  });

  it('resets ordinary crash attempts after a quiet period', async () => {
    const { createRendererRecoveryPolicy, RENDERER_CRASH_RESET_MS } = await import(
      '@/process/utils/rendererRecovery'
    );
    const policy = createRendererRecoveryPolicy(() => timestamp);
    policy.onCrash('crashed');
    policy.onCrash('crashed');
    timestamp += RENDERER_CRASH_RESET_MS + 1;
    expect(policy.onCrash('crashed')).toEqual({ kind: 'reload', delayMs: 0 });
  });

  it('recovers from a corrupt persisted state file', async () => {
    fs.writeFileSync(path.join(userDataDir, 'renderer-recovery.json'), 'not-json');
    const { createRendererRecoveryPolicy } = await import('@/process/utils/rendererRecovery');
    expect(createRendererRecoveryPolicy(() => timestamp).onCrash('launch-failed')).toEqual({ kind: 'relaunch' });
  });
});
