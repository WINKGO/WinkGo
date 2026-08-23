/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

/** Coalesces concurrent callers onto one operation and reopens after it settles. */
export class SingleFlight<T> {
  private inFlight: Promise<T> | undefined;

  run(operation: () => Promise<T>): Promise<T> {
    if (this.inFlight) return this.inFlight;

    const current = Promise.resolve().then(operation);
    this.inFlight = current;
    const clear = (): void => {
      if (this.inFlight === current) this.inFlight = undefined;
    };
    void current.then(clear, clear);
    return current;
  }

  /** Detaches a stale request so a newer recorder session can issue its own refresh. */
  invalidate(): void {
    this.inFlight = undefined;
  }
}

/** Invalidates stale async recorder mutations without preventing a cancel from taking effect immediately. */
export class RecorderOperationCoordinator {
  private generation = 0;
  private activeMutation: number | undefined;

  beginMutation(): number | null {
    if (this.activeMutation !== undefined) return null;
    const token = ++this.generation;
    this.activeMutation = token;
    return token;
  }

  invalidate(): void {
    this.generation += 1;
    this.activeMutation = undefined;
  }

  snapshot(): number {
    return this.generation;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  endMutation(token: number): void {
    if (this.activeMutation === token) this.activeMutation = undefined;
  }
}
