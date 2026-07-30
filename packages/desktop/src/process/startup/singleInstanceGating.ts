/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Decide whether this process is allowed to register the backend startup flow
 * (whenReady -> handleAppReady -> startBackendOrExit).
 *
 * Only the instance that owns the single-instance lock may spawn winkgo_core. A
 * lock-losing instance must never register backend startup; otherwise it races
 * the first instance's winkgo_core over the same data directory, which produced
 * the "local data repair failed" false alarm in Sentry 135525166.
 *
 * Extracted as a pure function so the gating decision is unit-testable without
 * importing index.ts (whose module top-level runs heavy Electron side effects).
 */
export function shouldRegisterBackendStartup(gotTheLock: boolean): boolean {
  return gotTheLock === true;
}
