// Modified from AionUI by WINK GO contributors in 2026.
/**
 * Resolve the winkgo_core binary path.
 *
 * Search order:
 *  1. Bundled with app (production)
 *  2. System PATH
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const BINARY_NAME = 'winkgo_core';
const MAX_DIR_ENTRIES = 20;
const MAX_LOOKUP_TEXT_LENGTH = 1000;

type BackendBinaryResolveDiagnostics = {
  resourcesPath?: string;
  runtimeKey: string;
  binaryName: string;
  checkedBundledPath?: string;
  checkedDevelopmentOverridePath?: string;
  checkedDevelopmentBundledPath?: string;
  bundledDirExists?: boolean;
  runtimeDirExists?: boolean;
  developmentBundledDirExists?: boolean;
  developmentRuntimeDirExists?: boolean;
  resourcesDirEntries?: string[];
  runtimeDirEntries?: string[];
  pathLookupCommand: string;
  pathLookupResult?: string;
  pathLookupError?: string;
};

class BackendBinaryResolveError extends Error {
  readonly diagnostics: BackendBinaryResolveDiagnostics;

  constructor(message: string, diagnostics: BackendBinaryResolveDiagnostics) {
    super(message);
    this.name = 'BackendBinaryResolveError';
    this.diagnostics = diagnostics;
  }
}

function getBinaryName(): string {
  return process.platform === 'win32' ? `${BINARY_NAME}.exe` : BINARY_NAME;
}

function getRuntimeKey(): string {
  return `${process.platform}-${process.arch}`;
}

function listDirEntries(dirPath: string): string[] | undefined {
  try {
    return readdirSync(dirPath, { withFileTypes: true })
      .slice(0, MAX_DIR_ENTRIES)
      .map((entry) => `${entry.name}${entry.isDirectory() ? '/' : ''}`);
  } catch {
    return undefined;
  }
}

function trimLookupText(text: string): string {
  return text.trim().slice(0, MAX_LOOKUP_TEXT_LENGTH);
}

function isSourceCheckoutRuntime(): boolean {
  const electronProcess = process as NodeJS.Process & { defaultApp?: boolean };
  return (
    Boolean(process.env.ELECTRON_RENDERER_URL) ||
    process.env.WINKGO_E2E_TEST === '1' ||
    electronProcess.defaultApp === true
  );
}

/**
 * Resolve the winkgo_core binary path.
 * Returns the absolute path to the binary, or throws if not found.
 */
export function resolveBinaryPath(): string {
  const runtimeKey = getRuntimeKey();
  const binaryName = getBinaryName();
  const diagnostics: BackendBinaryResolveDiagnostics = {
    runtimeKey,
    binaryName,
    pathLookupCommand: process.platform === 'win32' ? `where ${BINARY_NAME}` : `which ${BINARY_NAME}`,
  };

  const developmentOverride = developmentOverridePath(diagnostics);
  if (developmentOverride) return developmentOverride;

  const bundled = bundledPath(runtimeKey, binaryName, diagnostics);
  if (bundled) return bundled;

  const developmentBundled = developmentBundledPath(runtimeKey, binaryName, diagnostics);
  if (developmentBundled) return developmentBundled;

  const fromPath = resolveFromSystemPATH(diagnostics);
  if (fromPath) return fromPath;

  throw new BackendBinaryResolveError(
    `Cannot find "${BINARY_NAME}" binary. Checked bundled location and system PATH.`,
    diagnostics
  );
}

/**
 * Allow a source checkout to run a freshly compiled Core without replacing the
 * repository's bundled binary. The renderer URL is injected by electron-vite;
 * Electron also sets process.defaultApp when a checkout is launched directly
 * with `electron .`. Packaged applications never enter either source mode.
 */
function developmentOverridePath(diagnostics: BackendBinaryResolveDiagnostics): string | null {
  if (!isSourceCheckoutRuntime()) return null;
  const configured = process.env.WINKGO_BACKEND_BIN?.trim();
  if (!configured) return null;

  const candidate = resolve(configured);
  diagnostics.checkedDevelopmentOverridePath = candidate;
  return existsSync(candidate) ? candidate : null;
}

/**
 * Resolve the repository-local runtime while electron-vite is serving the
 * renderer or when Electron directly runs this checkout. Packaged builds never
 * enter this branch, so installation integrity checks continue to require
 * resources from process.resourcesPath.
 */
function developmentBundledPath(
  runtimeKey: string,
  binaryName: string,
  diagnostics: BackendBinaryResolveDiagnostics
): string | null {
  if (!isSourceCheckoutRuntime()) return null;

  const bundledDir = join(process.cwd(), 'resources', 'bundled-winkgo-core');
  const runtimeDir = join(bundledDir, runtimeKey);
  const candidate = join(runtimeDir, binaryName);
  diagnostics.checkedDevelopmentBundledPath = candidate;
  diagnostics.developmentBundledDirExists = existsSync(bundledDir);
  diagnostics.developmentRuntimeDirExists = existsSync(runtimeDir);

  return existsSync(candidate) ? candidate : null;
}

/**
 * Check bundled binary in resources directory.
 * Layout: bundled-winkgo-core/{platform}-{arch}/winkgo_core[.exe]
 */
function bundledPath(
  runtimeKey: string,
  binaryName: string,
  diagnostics: BackendBinaryResolveDiagnostics
): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return null;
  diagnostics.resourcesPath = resourcesPath;

  const bundledDir = join(resourcesPath, 'bundled-winkgo-core');
  const runtimeDir = join(bundledDir, runtimeKey);
  const candidate = join(runtimeDir, binaryName);
  diagnostics.checkedBundledPath = candidate;
  diagnostics.bundledDirExists = existsSync(bundledDir);
  diagnostics.runtimeDirExists = existsSync(runtimeDir);
  diagnostics.resourcesDirEntries = listDirEntries(resourcesPath);
  diagnostics.runtimeDirEntries = listDirEntries(runtimeDir);

  if (existsSync(candidate)) return candidate;
  return null;
}

/**
 * Try to find the binary on the system PATH.
 */
function resolveFromSystemPATH(diagnostics: BackendBinaryResolveDiagnostics): string | null {
  try {
    const result = execSync(diagnostics.pathLookupCommand, { encoding: 'utf-8', timeout: 5000 }).trim();
    diagnostics.pathLookupResult = trimLookupText(result);
    const firstMatch = result.split(/\r?\n/).find((line) => line.trim());
    if (firstMatch && existsSync(firstMatch.trim())) return firstMatch.trim();
  } catch (error) {
    diagnostics.pathLookupError = error instanceof Error ? trimLookupText(error.message) : String(error);
    return null;
  }
  return null;
}

export type { BackendBinaryResolveDiagnostics };
