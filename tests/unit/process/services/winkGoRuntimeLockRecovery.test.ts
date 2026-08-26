/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { recoverStaleWinkGoRuntimeLock } from '@process/services/winkGoRuntimeLockRecovery';

describe('WINK GO Runtime stale lock recovery', () => {
  const executable = path.join('C:', 'WINK GO', 'runtime', 'SparkBot-MCP-Hub-v1.1.0.exe');
  const lockPath = path.join(path.dirname(executable), 'runtime.lock');

  it('removes a lock only after its owner pid is confirmed dead', async () => {
    const unlink = vi.fn().mockResolvedValue(undefined);

    await expect(
      recoverStaleWinkGoRuntimeLock(executable, {
        readFile: vi.fn().mockResolvedValue('29048\n'),
        unlink,
        isProcessAlive: vi.fn().mockReturnValue(false),
        isExpectedRuntimeProcess: vi.fn(),
      })
    ).resolves.toEqual({ removed: true, lockPath, pid: 29048 });

    expect(unlink).toHaveBeenCalledWith(lockPath);
  });

  it('preserves a lock when its owner is still alive', async () => {
    const unlink = vi.fn();

    await expect(
      recoverStaleWinkGoRuntimeLock(executable, {
        readFile: vi.fn().mockResolvedValue('31200'),
        unlink,
        isProcessAlive: vi.fn().mockReturnValue(true),
        isExpectedRuntimeProcess: vi.fn().mockReturnValue(true),
      })
    ).resolves.toEqual({ removed: false, lockPath, pid: 31200 });

    expect(unlink).not.toHaveBeenCalled();
  });

  it('removes a lock when Windows has reused the pid for another executable', async () => {
    const unlink = vi.fn().mockResolvedValue(undefined);

    await expect(
      recoverStaleWinkGoRuntimeLock(executable, {
        readFile: vi.fn().mockResolvedValue('52520'),
        unlink,
        isProcessAlive: vi.fn().mockReturnValue(true),
        isExpectedRuntimeProcess: vi.fn().mockReturnValue(false),
      })
    ).resolves.toEqual({ removed: true, lockPath, pid: 52520 });

    expect(unlink).toHaveBeenCalledWith(lockPath);
  });

  it('does nothing when there is no Runtime lock', async () => {
    const unlink = vi.fn();

    await expect(
      recoverStaleWinkGoRuntimeLock(executable, {
        readFile: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' })),
        unlink,
        isProcessAlive: vi.fn(),
        isExpectedRuntimeProcess: vi.fn(),
      })
    ).resolves.toEqual({ removed: false, lockPath, pid: null });

    expect(unlink).not.toHaveBeenCalled();
  });

  it('fails closed when lock ownership cannot be parsed', async () => {
    const unlink = vi.fn();

    await expect(
      recoverStaleWinkGoRuntimeLock(executable, {
        readFile: vi.fn().mockResolvedValue('not-a-pid'),
        unlink,
        isProcessAlive: vi.fn(),
        isExpectedRuntimeProcess: vi.fn(),
      })
    ).resolves.toEqual({ removed: false, lockPath, pid: null });

    expect(unlink).not.toHaveBeenCalled();
  });
});
