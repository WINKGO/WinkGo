/**
 * @license
 * Copyright 2026 WINK GO contributors
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import type { IRuntimeStatusEvent } from '@/common/adapter/ipcBridge';
import type { BackendStartupFailureInfo } from '@/common/types/platform/electron';
import { BackendStartupGate } from '@/renderer/components/layout/AppLoader';
import {
  getInstallationIntegrityModalActions,
  getInstallationIntegrityTitle,
} from '@/renderer/components/layout/InstallationIntegrityDialog';
import {
  createRuntimeInstallationReconciler,
  RUNTIME_RECONCILE_WINDOW_MS,
} from '@/renderer/services/runtimeInstallationReconciler';

const failed = (scopeId: string): IRuntimeStatusEvent => ({
  resource: 'node',
  scope: { kind: 'custom_agent', id: scopeId },
  phase: 'failed',
  failure_kind: 'bundled_resource_invalid',
  message: 'temporary activation failure',
});

const ready = (scopeId: string): IRuntimeStatusEvent => ({
  resource: 'node',
  scope: { kind: 'conversation', id: scopeId },
  phase: 'ready',
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('runtime installation reconciliation', () => {
  it('closes the warning and suppresses diagnostics after a cross-scope recovery', () => {
    const close = vi.fn();
    const report = vi.fn();
    const reconciler = createRuntimeInstallationReconciler({ showDialog: () => ({ close }), report });

    reconciler.handleStatus(failed('startup'));
    reconciler.handleStatus(ready('conversation-9'));
    vi.advanceTimersByTime(RUNTIME_RECONCILE_WINDOW_MS + 100);

    expect(close).toHaveBeenCalledOnce();
    expect(report).not.toHaveBeenCalled();
  });

  it('reports a persistent integrity failure after the reconciliation window', () => {
    const close = vi.fn();
    const report = vi.fn();
    const reconciler = createRuntimeInstallationReconciler({ showDialog: () => ({ close }), report });

    reconciler.handleStatus(failed('startup'));
    vi.advanceTimersByTime(RUNTIME_RECONCILE_WINDOW_MS + 100);

    expect(report).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
  });

  it('flushes pending diagnostics when the window is disposed early', () => {
    const report = vi.fn();
    const reconciler = createRuntimeInstallationReconciler({
      showDialog: () => ({ close: vi.fn() }),
      report,
    });

    reconciler.handleStatus(failed('startup'));
    vi.advanceTimersByTime(5_000);
    reconciler.flushPending();

    expect(report).toHaveBeenCalledOnce();
  });
});

type Bridge = NonNullable<Window['__backendStartupBridge']>;

function installStartupBridge(initial: BackendStartupFailureInfo | null): {
  push: (next: BackendStartupFailureInfo | null) => void;
} {
  let listener: ((state: BackendStartupFailureInfo | null) => void) | undefined;
  const bridge: Bridge = {
    getState: () => initial,
    subscribe: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
  };
  window.__backendStartupBridge = bridge;
  return {
    push: (next) =>
      act(() => {
        listener?.(next);
      }),
  };
}

const gateProps = {
  renderStarting: () => React.createElement('div', { 'data-testid': 'view-starting' }),
  renderFailure: (failure: BackendStartupFailureInfo) =>
    React.createElement('div', { 'data-testid': 'view-failure' }, failure.reason),
  renderApp: () => React.createElement('div', { 'data-testid': 'view-app' }),
};

afterEach(() => {
  cleanup();
  delete window.__backendStartupBridge;
  delete window.__backendStartupFailure;
});

describe('backend startup lifecycle gate', () => {
  it('switches a slow-starting view to the app when WINK GO Core becomes ready', () => {
    const { push } = installStartupBridge({ reason: 'backend_startup_pending_slow' });
    render(React.createElement(BackendStartupGate, gateProps));

    expect(screen.getByTestId('view-starting')).toBeTruthy();
    push(null);

    expect(screen.getByTestId('view-app')).toBeTruthy();
    expect(screen.queryByTestId('view-starting')).toBeNull();
  });

  it('switches a slow-starting view to an honest failure when the process exits', () => {
    const { push } = installStartupBridge({ reason: 'backend_startup_pending_slow' });
    render(React.createElement(BackendStartupGate, gateProps));

    push({ reason: 'backend_startup_exited' });

    expect(screen.getByTestId('view-failure').textContent).toBe('backend_startup_exited');
    expect(screen.queryByTestId('view-app')).toBeNull();
  });

  it('renders the app when startup has no failure state', () => {
    installStartupBridge(null);
    render(React.createElement(BackendStartupGate, gateProps));

    expect(screen.getByTestId('view-app')).toBeTruthy();
    expect(screen.queryByTestId('view-failure')).toBeNull();
  });

  it('treats a missing port report as a fatal startup failure', () => {
    installStartupBridge({ reason: 'backend_startup_port_report_timeout' });
    render(React.createElement(BackendStartupGate, gateProps));

    expect(screen.getByTestId('view-failure').textContent).toBe('backend_startup_port_report_timeout');
    expect(screen.queryByTestId('view-app')).toBeNull();
  });
});

describe('backend startup diagnostic copy routing', () => {
  const t = ((key: string) => key) as never;

  it.each([
    ['backend_exited', 'common.backendStartup.exited.title', 'common.backendStartup.exited.sendDiagnostics'],
    [
      'port_report_timeout',
      'common.backendStartup.portReportTimeout.title',
      'common.backendStartup.portReportTimeout.sendDiagnostics',
    ],
    [
      'startup_failed',
      'common.backendStartup.startupFailed.title',
      'common.backendStartup.startupFailed.sendDiagnostics',
    ],
  ] as const)('uses the dedicated %s message instead of an installation warning', (kind, titleKey, reportKey) => {
    expect(getInstallationIntegrityTitle(t, kind)).toBe(titleKey);
    const actions = getInstallationIntegrityModalActions(t, { diagnosticsKind: kind });
    expect(actions.reportText).toBe(reportKey);
    expect(actions.downloadText).toBeUndefined();
  });
});
