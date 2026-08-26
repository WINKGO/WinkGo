// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { classifyBackendStartupFailure } from '@/process/startup/backendStartupFailure';

// T-L3a — transient concurrent-startup classification (Sentry 135525166).
// A brief two-instance bootstrap race over the same data directory is
// self-recoverable and must NOT be reported as local data corruption.
describe('classifyBackendStartupFailure — transient concurrent startup', () => {
  it('classifies the benign peer-yield boundary code as a transient concurrent startup', () => {
    const result = classifyBackendStartupFailure({
      details: {
        backendBoundaryCode: 'BOOTSTRAP_PEER_ALREADY_RUNNING',
        backendBoundaryStage: 'instance_guard.acquire',
        causeMessage: 'another winkgo_core already owns this data directory',
      },
      message: 'winkgo_core exited before health check passed',
      name: 'BackendStartupError',
    });

    expect(result).toEqual({
      reason: 'backend_transient_concurrent_startup',
      backendBoundaryCode: 'BOOTSTRAP_PEER_ALREADY_RUNNING',
      backendBoundaryStage: 'instance_guard.acquire',
    });
  });

  it('classifies assistant bootstrap contention stage as a transient concurrent startup', () => {
    const result = classifyBackendStartupFailure({
      details: {
        backendBoundaryCode: 'BOOTSTRAP_SERVER_FAILED',
        backendBoundaryStage: 'router.assistant.bootstrap.concurrency_contended',
        causeMessage: 'assistant storage bootstrap contended under concurrent startup',
      },
      message: 'winkgo_core exited before health check passed',
      name: 'BackendStartupError',
    });

    expect(result).toEqual({
      reason: 'backend_transient_concurrent_startup',
      backendBoundaryCode: 'BOOTSTRAP_SERVER_FAILED',
      backendBoundaryStage: 'router.assistant.bootstrap.concurrency_contended',
    });
  });

  // Regression guard: the old code unconditionally mapped
  // BOOTSTRAP_SERVER_FAILED + router.assistant.bootstrap to
  // backend_local_data_repair_failed. A plain (non-contended) bootstrap failure
  // must now fall through to the generic bucket, never the panic-inducing
  // "local data repair" copy.
  it('does not misclassify a plain assistant bootstrap failure as local data repair', () => {
    const result = classifyBackendStartupFailure({
      details: {
        backendBoundaryCode: 'BOOTSTRAP_SERVER_FAILED',
        backendBoundaryStage: 'router.assistant.bootstrap',
        causeMessage: 'failed to bootstrap assistant storage',
      },
      message: 'winkgo_core exited before health check passed',
      name: 'BackendStartupError',
    });

    expect(result).toEqual({
      reason: 'backend_startup_failed',
      backendBoundaryCode: 'BOOTSTRAP_SERVER_FAILED',
      backendBoundaryStage: 'router.assistant.bootstrap',
    });
    expect(result.reason).not.toBe('backend_local_data_repair_failed');
  });
});

// C2 — genuine data corruption paths must keep their severe classification.
describe('classifyBackendStartupFailure — genuine data damage still severe', () => {
  it('still classifies the 4-signal agent metadata corruption as local data repair', () => {
    const result = classifyBackendStartupFailure({
      details: {
        stage: 'early_exit',
        backendBoundaryCode: 'BOOTSTRAP_SERVICE_INIT_FAILED',
        backendBoundaryStage: 'services.init',
        stderrTail:
          'Failed to hydrate agent registry: Internal error: load agent_metadata: Database query failed: error occurred while decoding column "config_options": invalid utf-8 sequence of 1 bytes from index 793',
      },
      message: 'winkgo_core exited before health check passed',
      name: 'BackendStartupError',
    });

    expect(result).toEqual({
      reason: 'backend_local_data_repair_failed',
      backendBoundaryCode: 'BOOTSTRAP_SERVICE_INIT_FAILED',
      backendBoundaryStage: 'services.init',
      localDataIssueKind: 'agent_metadata_invalid_utf8',
    });
  });

  it('still classifies recoverable database corruption separately', () => {
    const result = classifyBackendStartupFailure({
      details: {
        stage: 'early_exit',
        backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
        backendBoundaryStage: 'database.recoverable_corruption',
        stderrTail:
          'BOOTSTRAP_DATA_INIT_FAILED stage=database.recoverable_corruption databasePath=/db/winkgo-backend.db: failed to initialize application data',
      },
      message: 'winkgo_core exited before health check passed',
      name: 'BackendStartupError',
    });

    expect(result).toEqual({
      reason: 'backend_recoverable_database_corruption',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.recoverable_corruption',
    });
  });
});

describe('classifyBackendStartupFailure — database newer than WINK GO', () => {
  it('classifies database.newer_than_app as an update-required state', () => {
    const result = classifyBackendStartupFailure({
      details: {
        backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
        backendBoundaryStage: 'database.newer_than_app',
        stderrTail: 'BOOTSTRAP_DATA_INIT_FAILED stage=database.newer_than_app databasePath=/db/winkgo-backend.db',
      },
      message: 'WINK GO Core exited before health check passed',
      name: 'BackendStartupError',
    });

    expect(result).toEqual({
      reason: 'backend_database_newer_than_app',
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.newer_than_app',
    });
  });

  it('does not use the update-required reason for other boundary codes', () => {
    const result = classifyBackendStartupFailure({
      details: {
        backendBoundaryCode: 'BOOTSTRAP_SERVICE_INIT_FAILED',
        backendBoundaryStage: 'database.newer_than_app',
      },
      message: 'WINK GO Core exited before health check passed',
      name: 'BackendStartupError',
    });

    expect(result.reason).not.toBe('backend_database_newer_than_app');
  });
});

describe('classifyBackendStartupFailure — honest startup states', () => {
  it('classifies a listening process kept alive after health timeout as a pending slow startup', () => {
    const result = classifyBackendStartupFailure({
      details: {
        stage: 'health_timeout',
        serverListeningObserved: true,
        healthTimeoutKeptAlive: true,
      },
      message: 'WINK GO Core failed to become healthy within timeout',
      name: 'BackendStartupError',
    });

    expect(result.reason).toBe('backend_startup_pending_slow');
  });

  it('does not classify a killed health-timeout process as pending', () => {
    const result = classifyBackendStartupFailure({
      details: {
        stage: 'health_timeout',
        serverListeningObserved: true,
      },
      message: 'WINK GO Core failed to become healthy within timeout',
      name: 'BackendStartupError',
    });

    expect(result.reason).toBe('backend_startup_failed');
  });

  it('classifies a listening process that exits before readiness as an honest startup exit', () => {
    const result = classifyBackendStartupFailure({
      details: {
        stage: 'early_exit',
        serverListeningObserved: true,
      },
      message: 'WINK GO Core exited before health check passed',
      name: 'BackendStartupError',
    });

    expect(result.reason).toBe('backend_startup_exited');
  });

  it('keeps an early exit that never listened in the generic failure bucket', () => {
    const result = classifyBackendStartupFailure({
      details: {
        stage: 'early_exit',
        serverListeningObserved: false,
      },
      message: 'WINK GO Core exited immediately',
      name: 'BackendStartupError',
    });

    expect(result.reason).toBe('backend_startup_failed');
  });

  it('classifies a missing port report as a startup timeout, not an incomplete installation', () => {
    const result = classifyBackendStartupFailure({
      details: {
        stage: 'listen_timeout',
        serverListeningObserved: false,
      },
      message: 'WINK GO Core did not report its listening port before timeout',
      name: 'BackendStartupError',
    });

    expect(result).toEqual({ reason: 'backend_startup_port_report_timeout' });
  });
});
