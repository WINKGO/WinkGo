/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tracks fire-and-forget persistence writes so they can finish flushing to
 * disk before the app exits. Without this, the last write triggered by an
 * action right before quit (e.g. ⌘Q immediately after a window resize or
 * a ⌘+ zoom shortcut) routinely loses the race against process teardown,
 * which manifests to the user as the setting "not being remembered".
 */

import { app } from 'electron';

const pending = new Set<Promise<unknown>>();
let installed = false;
let flushing = false;
let flushFinished = false;

export const PERSIST_ON_QUIT_TIMEOUT_MS = 1_200;

const flushPendingWrites = async (): Promise<void> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<void>((resolve) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      console.warn(`[WINK GO] Persistence flush exceeded ${PERSIST_ON_QUIT_TIMEOUT_MS}ms; continuing shutdown`);
      resolve();
    }, PERSIST_ON_QUIT_TIMEOUT_MS);
  });
  const writes = Promise.allSettled(Array.from(pending)).then(() => {});

  await Promise.race([writes, timeout]);
  if (!timedOut && timeoutId) clearTimeout(timeoutId);
};

const ensureHandlerInstalled = (): void => {
  if (installed) return;
  installed = true;
  app.on('before-quit', (event) => {
    if (flushFinished) return;
    if (flushing) {
      event.preventDefault();
      return;
    }
    if (pending.size === 0) return;
    flushing = true;
    event.preventDefault();
    void flushPendingWrites().finally(() => {
      flushFinished = true;
      app.quit();
    });
  });
};

/**
 * Register a write so the app waits for it on quit. Errors are swallowed —
 * persistence callers are expected to log their own failures; the only role
 * here is to keep the process alive long enough for the write to land.
 */
export const trackPersistedWrite = (promise: Promise<unknown>): Promise<unknown> => {
  ensureHandlerInstalled();
  const tracked = promise.catch(() => {});
  pending.add(tracked);
  tracked.finally(() => pending.delete(tracked));
  return promise;
};

/** Test-only helper to reset module state between cases. */
export const __resetPersistOnQuitForTests = (): void => {
  pending.clear();
  installed = false;
  flushing = false;
  flushFinished = false;
};
