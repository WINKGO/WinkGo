/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readFile, unlink } from 'node:fs/promises';

export interface WinkGoRuntimeLockRecoveryDependencies {
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  unlink(filePath: string): Promise<void>;
  isProcessAlive(pid: number): boolean;
  isExpectedRuntimeProcess(pid: number, executable: string): boolean;
}

const defaultIsProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EPERM means the process exists but cannot be inspected by this user.
    if (code === 'EPERM') return true;
    if (code === 'ESRCH') return false;
    throw error;
  }
};

const defaultIsExpectedRuntimeProcess = (pid: number, executable: string): boolean => {
  if (process.platform !== 'win32') return true;
  try {
    const output = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction Stop).Path`],
      { encoding: 'utf8', windowsHide: true, timeout: 2_000 }
    ).trim();
    return output.length > 0 && path.resolve(output).toLowerCase() === path.resolve(executable).toLowerCase();
  } catch {
    // Process inspection can be denied by Windows. Preserve the lock when the
    // owner exists but its identity cannot be established safely.
    return true;
  }
};

const defaults: WinkGoRuntimeLockRecoveryDependencies = {
  readFile,
  unlink,
  isProcessAlive: defaultIsProcessAlive,
  isExpectedRuntimeProcess: defaultIsExpectedRuntimeProcess,
};

export async function recoverStaleWinkGoRuntimeLock(
  executable: string,
  dependencies: WinkGoRuntimeLockRecoveryDependencies = defaults
): Promise<{ removed: boolean; lockPath: string; pid: number | null }> {
  const lockPath = path.join(path.dirname(executable), 'runtime.lock');
  let rawPid: string;
  try {
    rawPid = await dependencies.readFile(lockPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed: false, lockPath, pid: null };
    throw error;
  }

  const trimmed = rawPid.trim();
  if (!/^\d+$/.test(trimmed)) return { removed: false, lockPath, pid: null };
  const pid = Number(trimmed);
  if (!Number.isSafeInteger(pid) || pid <= 0) return { removed: false, lockPath, pid: null };
  if (dependencies.isProcessAlive(pid) && dependencies.isExpectedRuntimeProcess(pid, executable)) {
    return { removed: false, lockPath, pid };
  }

  try {
    await dependencies.unlink(lockPath);
    return { removed: true, lockPath, pid };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed: false, lockPath, pid };
    throw error;
  }
}
