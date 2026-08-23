// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { configureBrandedAppPaths } from '@/common/platform';
import { applyGpuRecoveryFlags } from './gpuRecovery';

// ============ E2E test isolation ============
// When running under E2E with an explicit sandbox dir, redirect userData there
// BEFORE any getPath() call so the whole data tree (config, winkgo_core DB, logs)
// lives in a disposable directory. This keeps tests off the developer's real
// database — critical because WinkGoCore refuses to boot when a shared DB fails
// migration. Guarded by WINKGO_E2E_TEST so it never affects dev/production.
// 仅 E2E：把 userData 指向一次性沙箱目录，避免测试读写真实数据库。
const e2eUserDataDir = process.env.WINKGO_E2E_TEST === '1' ? process.env.WINKGO_E2E_USER_DATA_DIR : undefined;
if (e2eUserDataDir && e2eUserDataDir.trim() !== '') {
  fs.mkdirSync(e2eUserDataDir, { recursive: true });
  app.setPath('userData', e2eUserDataDir);
}

// ============ Branded application directories ============
// Set app name and userData before any later getPath() call. Existing WinkGo
// data is migrated in place so rebranding never resets the user's workspace.
// Note: getPlatformServices() auto-registration also applies this as a safety net
// in case Rollup loads initStorage's chunk before this module runs.
// 开发模式下使用独立目录，正式版和开发版都使用 WINK GO 品牌名称。
// E2E 沙箱已显式设置 userData 时跳过，避免被 dev app 名覆盖。
if (!e2eUserDataDir) {
  configureBrandedAppPaths(app);
}

// app.disableHardwareAcceleration() must run before app is ready.
applyGpuRecoveryFlags();

// Configure Chromium command-line flags for WebUI and CLI modes
// 为 WebUI 和 CLI 模式配置 Chromium 命令行参数

const isWebUI = process.argv.some((arg) => arg === '--webui');
const isResetPassword = process.argv.includes('--resetpass');

// Only configure flags for WebUI and --resetpass modes
// 仅为 WebUI 和重置密码模式配置参数
if (isWebUI || isResetPassword) {
  // In WebUI/reset-password mode on Linux, force headless Ozone backend.
  // This mode should never depend on X11/Wayland availability.
  // 在 Linux 的 WebUI/重置密码模式下，强制使用 headless Ozone 后端，
  // 避免因 DISPLAY 变量存在但显示服务不可用导致平台初始化失败。
  // Note: Do NOT use --headless (browser automation mode that causes auto-exit).
  // Instead, use --ozone-platform=headless which provides a proper display backend
  // without requiring a display server, keeping the Electron process alive.
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('ozone-platform', 'headless');
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-software-rasterizer');
  }

  // Never bypass Chromium's sandbox. Headless services must run as an
  // unprivileged account; the Linux installer creates one for this purpose.
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    console.error('[Security] WINK GO WebUI/reset-password mode refuses to run as root.');
    app.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Agent browser control (CDP) — persisted user switch only.
//
// The bridge no longer enables Chromium's application-wide remote debugging
// port. A random localhost port is opened later by cdpBridge.ts and exposes only
// the active browser webview. WINKGO_CDP_PORT remains a compatibility switch:
// "0"/"false" disables, any other non-empty value enables.
// ---------------------------------------------------------------------------

const CDP_CONFIG_FILE = 'cdp.config.json';

/** CDP configuration stored in userData directory */
export interface CdpConfig {
  /** Whether browser control is enabled. */
  enabled?: boolean;
  /** Legacy field retained so older configuration remains readable. */
  port?: number;
}

/** CDP status information exposed to renderer */
export interface CdpStatus {
  /** Whether CDP is currently enabled */
  enabled: boolean;
  /** Current CDP port (null if disabled or not started) */
  port: number | null;
  /** Whether CDP was enabled at startup (requires restart to change) */
  startupEnabled: boolean;
  /** Whether CDP is enabled in the persisted config file (may differ from runtime) */
  configEnabled: boolean;
  /** Whether the app is running in development mode */
  isDevMode: boolean;
}

/**
 * Load CDP configuration from userData directory.
 * This must be called before app.ready, so we use synchronous file operations.
 */
function loadCdpConfig(): CdpConfig {
  try {
    // Try to get userData path - this works even before app.ready
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, CDP_CONFIG_FILE);

    if (!fs.existsSync(configPath)) {
      return {};
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as CdpConfig;
    }
  } catch {
    // Ignore errors when loading config
  }
  return {};
}

/**
 * Save CDP configuration to userData directory.
 */
export function saveCdpConfig(config: CdpConfig): void {
  try {
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, CDP_CONFIG_FILE);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.warn('[CDP] Failed to save CDP config:', error);
  }
}

/**
 * Determine if CDP should be enabled at startup.
 * Priority: env variable > config file > default enabled.
 */
function shouldEnableCdp(config: CdpConfig): boolean {
  const envVal = process.env.WINKGO_CDP_PORT;
  if (envVal === '0' || envVal === 'false') return false;
  if (envVal) return true;

  if (config.enabled !== undefined) {
    return config.enabled;
  }

  return true;
}

/** The random localhost bridge port, backfilled once the bridge is listening. */
export let cdpPort: number | null = null;

export function setActiveCdpPort(port: number | null): void {
  cdpPort = port;
}

/** Whether CDP was enabled at startup (requires restart to change). */
export let cdpStartupEnabled: boolean = false;

// Load config and initialize CDP at startup
const cdpConfig = loadCdpConfig();
cdpStartupEnabled = shouldEnableCdp(cdpConfig);

if (cdpStartupEnabled) {
  console.log('[CDP] WINK GO browser control enabled (single-target bridge)');
} else {
  console.log('[CDP] WINK GO browser control disabled');
}

/**
 * Get current CDP status for display in UI.
 */
export function getCdpStatus(): CdpStatus {
  const config = loadCdpConfig();
  return {
    enabled: cdpPort !== null,
    port: cdpPort,
    startupEnabled: cdpStartupEnabled,
    configEnabled: config.enabled ?? cdpStartupEnabled,
    isDevMode: !app.isPackaged,
  };
}

/**
 * Update CDP configuration and save to disk.
 * Note: Changing the enabled state requires app restart to take effect.
 */
export function updateCdpConfig(newConfig: Partial<CdpConfig>): CdpConfig {
  const currentConfig = loadCdpConfig();
  const updatedConfig = { ...currentConfig, ...newConfig };
  saveCdpConfig(updatedConfig);
  return updatedConfig;
}
