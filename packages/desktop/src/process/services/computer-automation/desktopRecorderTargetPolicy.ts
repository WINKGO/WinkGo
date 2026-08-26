/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DesktopRecorderTarget } from '@/common/types/desktopAutomation';

const SYSTEM_SURFACE_PROCESSES = new Set(['textinputhost.exe']);
const SYSTEM_SURFACE_TITLES = new Set(['program manager', 'windows 输入体验']);

export interface DesktopRecorderTargetPolicyOptions {
  hostPid: number;
  blockedPids?: Iterable<number>;
}

/** Keeps recording attached to a real external application, never WINK GO or a desktop compositor surface. */
export const isSafeDesktopRecorderTarget = (
  target: DesktopRecorderTarget,
  { hostPid, blockedPids = [] }: DesktopRecorderTargetPolicyOptions
): boolean => {
  const title = target.title.trim().toLocaleLowerCase();
  const processName = target.processName.trim().toLocaleLowerCase();
  const { x, y, width, height } = target.rect;

  if (
    !title ||
    !Number.isFinite(target.pid) ||
    !Number.isFinite(target.hwnd) ||
    ![x, y, width, height].every(Number.isFinite) ||
    target.pid <= 0 ||
    target.hwnd <= 0 ||
    width <= 0 ||
    height <= 0
  ) {
    return false;
  }
  if (target.pid === hostPid || new Set(blockedPids).has(target.pid)) return false;
  if (x <= -30_000 || y <= -30_000) return false;
  if (SYSTEM_SURFACE_PROCESSES.has(processName) || SYSTEM_SURFACE_TITLES.has(title)) return false;
  if (title.includes('nvidia') && title.includes('overlay')) return false;
  if ((processName === 'electron.exe' || /^wink(?:-|\s*)go\.exe$/.test(processName)) && title.includes('wink go')) {
    return false;
  }
  return true;
};

export const filterDesktopRecorderTargets = (
  targets: DesktopRecorderTarget[],
  options: DesktopRecorderTargetPolicyOptions
): DesktopRecorderTarget[] => targets.filter((target) => isSafeDesktopRecorderTarget(target, options));
