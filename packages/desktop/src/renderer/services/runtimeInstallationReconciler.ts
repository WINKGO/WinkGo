/**
 * @license
 * Copyright 2026 WINK GO contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IRuntimeStatusEvent, RuntimeFailureKind } from '@/common/adapter/ipcBridge';

export const RUNTIME_RECONCILE_WINDOW_MS = 15_000;

const INSTALLATION_INTEGRITY_FAILURES = new Set<RuntimeFailureKind>([
  'bundled_resource_missing',
  'bundled_resource_invalid',
  'validation_failed',
]);

function isInstallationIntegrityFailure(kind: RuntimeFailureKind | undefined): boolean {
  return INSTALLATION_INTEGRITY_FAILURES.has(kind ?? 'unknown');
}

export type ReconcilerDialogHandle = { close: () => void };

export type RuntimeInstallationReconcilerCallbacks = {
  showDialog: (event: IRuntimeStatusEvent) => ReconcilerDialogHandle;
  report: (event: IRuntimeStatusEvent) => void;
};

export type RuntimeInstallationReconciler = {
  handleStatus: (event: IRuntimeStatusEvent) => void;
  flushPending: () => void;
  dispose: () => void;
};

type PendingEntry = {
  event: IRuntimeStatusEvent;
  dialog: ReconcilerDialogHandle;
  timer: ReturnType<typeof setTimeout>;
};

function resourceKey(event: IRuntimeStatusEvent): string {
  return event.resource;
}

export function createRuntimeInstallationReconciler(
  callbacks: RuntimeInstallationReconcilerCallbacks
): RuntimeInstallationReconciler {
  const pending = new Map<string, PendingEntry>();

  const settle = (entry: PendingEntry): void => {
    entry.dialog.close();
    clearTimeout(entry.timer);
  };

  const handleFailed = (event: IRuntimeStatusEvent): void => {
    if (!isInstallationIntegrityFailure(event.failure_kind)) return;
    const key = resourceKey(event);
    if (pending.has(key)) return;

    const dialog = callbacks.showDialog(event);
    const timer = setTimeout(() => {
      pending.delete(key);
      clearTimeout(timer);
      callbacks.report(event);
    }, RUNTIME_RECONCILE_WINDOW_MS);
    pending.set(key, { event, dialog, timer });
  };

  const handleReady = (event: IRuntimeStatusEvent): void => {
    const key = resourceKey(event);
    const entry = pending.get(key);
    if (!entry) return;

    pending.delete(key);
    settle(entry);
  };

  return {
    handleStatus(event: IRuntimeStatusEvent): void {
      if (event.phase === 'failed') {
        handleFailed(event);
      } else if (event.phase === 'ready') {
        handleReady(event);
      }
    },
    flushPending(): void {
      for (const [key, entry] of pending) {
        clearTimeout(entry.timer);
        pending.delete(key);
        callbacks.report(entry.event);
      }
    },
    dispose(): void {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
      }
      pending.clear();
    },
  };
}
