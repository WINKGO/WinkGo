// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_FILE = 'renderer-recovery.json';
export const RENDERER_RELOAD_BACKOFF_MS = [0, 1000, 3000] as const;
export const RENDERER_CRASH_RESET_MS = 60 * 1000;
export const RENDERER_RELAUNCH_THROTTLE_MS = 5 * 60 * 1000;

export type RendererCrashAction = { kind: 'reload'; delayMs: number } | { kind: 'relaunch' } | { kind: 'give-up' };

export interface RendererRecoveryPolicy {
  onCrash(reason: string): RendererCrashAction;
}

interface RecoveryState {
  lastRelaunchAt?: number;
}

function getStatePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE);
}

function readState(): RecoveryState {
  try {
    const statePath = getStatePath();
    if (!fs.existsSync(statePath)) return {};
    const parsed: unknown = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as RecoveryState) : {};
  } catch {
    return {};
  }
}

function writeState(state: RecoveryState): void {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.warn('[WinkGoRendererRecovery] Failed to persist recovery state:', error);
  }
}

/**
 * Ordinary crashes reload with bounded backoff. A renderer that cannot launch
 * escalates directly to one throttled app relaunch, preventing a reload storm.
 */
export function createRendererRecoveryPolicy(now: () => number = Date.now): RendererRecoveryPolicy {
  let attempts = 0;
  let lastCrashAt = 0;

  const escalate = (timestamp: number): RendererCrashAction => {
    const state = readState();
    if (state.lastRelaunchAt && timestamp - state.lastRelaunchAt < RENDERER_RELAUNCH_THROTTLE_MS) {
      return { kind: 'give-up' };
    }
    writeState({ ...state, lastRelaunchAt: timestamp });
    return { kind: 'relaunch' };
  };

  return {
    onCrash(reason: string): RendererCrashAction {
      const timestamp = now();
      if (timestamp - lastCrashAt > RENDERER_CRASH_RESET_MS) attempts = 0;
      lastCrashAt = timestamp;

      if (reason === 'launch-failed') return escalate(timestamp);
      if (attempts >= RENDERER_RELOAD_BACKOFF_MS.length) return escalate(timestamp);
      const delayMs = RENDERER_RELOAD_BACKOFF_MS[attempts];
      attempts += 1;
      return { kind: 'reload', delayMs };
    },
  };
}
