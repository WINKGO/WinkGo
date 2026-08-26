/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { RecorderOperationCoordinator, SingleFlight } from '@process/services/computer-automation/singleFlight';

describe('desktop automation single-flight gate', () => {
  it('shares one pending operation across concurrent callers', async () => {
    let finish: ((value: number) => void) | undefined;
    const operation = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        })
    );
    const gate = new SingleFlight<number>();

    const first = gate.run(operation);
    const second = gate.run(operation);
    expect(first).toBe(second);
    expect(operation).toHaveBeenCalledTimes(0);

    await Promise.resolve();
    expect(operation).toHaveBeenCalledTimes(1);
    finish?.(42);
    await expect(first).resolves.toBe(42);
    await expect(second).resolves.toBe(42);
  });

  it('allows a fresh operation after success or failure', async () => {
    const gate = new SingleFlight<number>();

    await expect(gate.run(async () => 1)).resolves.toBe(1);
    await expect(gate.run(async () => Promise.reject(new Error('expected')))).rejects.toThrow('expected');
    await expect(gate.run(async () => 3)).resolves.toBe(3);
  });

  it('lets a new session start without waiting for an invalidated request', async () => {
    let finishOld: ((value: number) => void) | undefined;
    const gate = new SingleFlight<number>();
    const oldRequest = gate.run(
      () =>
        new Promise<number>((resolve) => {
          finishOld = resolve;
        })
    );
    await Promise.resolve();

    gate.invalidate();
    const newRequest = gate.run(async () => 2);

    await expect(newRequest).resolves.toBe(2);
    finishOld?.(1);
    await expect(oldRequest).resolves.toBe(1);
  });
});

describe('desktop recorder operation coordinator', () => {
  it('rejects a concurrent mutation and invalidates a late result after cancel', () => {
    const coordinator = new RecorderOperationCoordinator();
    const first = coordinator.beginMutation();

    expect(first).toBeTypeOf('number');
    expect(coordinator.beginMutation()).toBeNull();
    coordinator.invalidate();
    expect(coordinator.isCurrent(first as number)).toBe(false);

    const next = coordinator.beginMutation();
    expect(next).toBeTypeOf('number');
    coordinator.endMutation(first as number);
    expect(coordinator.isCurrent(next as number)).toBe(true);
  });
});
