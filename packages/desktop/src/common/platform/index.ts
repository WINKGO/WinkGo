// Modified from AionUI by WINK GO contributors in 2026.
import { existsSync, renameSync } from 'fs';
import path from 'path';
import type { App } from 'electron';
import type { IPlatformServices } from './IPlatformServices';
import { NodePlatformServices } from './NodePlatformServices';
import { normalizeWinkGoBuildEdition } from '../types/platform/winkGoEdition';

let _services: IPlatformServices | null = null;

export const APP_DISPLAY_NAME = 'WINK GO';
export const PRO_APP_DISPLAY_NAME = 'WINK GO Pro';
export const DEFAULT_WORK_DIR_NAME = 'WINK GO';
const APP_STORAGE_NAME = 'WINK GO';
const PRO_APP_STORAGE_NAME = 'WINK GO Pro';

export function getAppDisplayName(): string {
  return normalizeWinkGoBuildEdition(process.env.WINKGO_EDITION) === 'pro' ? PRO_APP_DISPLAY_NAME : APP_DISPLAY_NAME;
}

/**
 * Resolve the dev-mode app name for environment isolation.
 * Centralised so that every call-site stays in sync.
 */
export function getDevAppName(): string {
  const isMultiInstance = process.env.WINKGO_MULTI_INSTANCE === '1';
  const baseName = `${getAppDisplayName()}-Dev`;
  return isMultiInstance ? `${baseName}-2` : baseName;
}

function getStorageAppName(isPackaged: boolean): string {
  const isPro = normalizeWinkGoBuildEdition(process.env.WINKGO_EDITION) === 'pro';
  if (isPackaged) return isPro ? PRO_APP_STORAGE_NAME : APP_STORAGE_NAME;
  const suffix = process.env.WINKGO_MULTI_INSTANCE === '1' ? '-Dev-2' : '-Dev';
  return `${isPro ? PRO_APP_STORAGE_NAME : APP_STORAGE_NAME}${suffix}`;
}

function getLegacyAppName(isPackaged: boolean): string {
  if (isPackaged) return 'WinkGo';
  return process.env.WINKGO_MULTI_INSTANCE === '1' ? 'WinkGo-Dev-2' : 'WinkGo-Dev';
}

function renameDirectoryIfTargetIsFree(sourcePath: string, targetPath: string): void {
  if (path.resolve(sourcePath) === path.resolve(targetPath)) return;
  if (!existsSync(sourcePath) || existsSync(targetPath)) return;

  try {
    renameSync(sourcePath, targetPath);
  } catch (error) {
    console.warn(`[WINK GO] Could not migrate data directory from ${sourcePath} to ${targetPath}:`, error);
  }
}

/**
 * Apply the public product name to Electron's real on-disk directories.
 *
 * Existing WinkGo data is moved in place before Electron opens it, preserving
 * conversations, provider configuration, skills, Chromium state, and logs.
 */
export function configureBrandedAppPaths(
  electronApp: Pick<App, 'getPath' | 'isPackaged' | 'setAppLogsPath' | 'setName' | 'setPath'>
): string {
  const currentUserDataPath = electronApp.getPath('userData');
  const appDataRoot = path.dirname(currentUserDataPath);
  const buildEdition = normalizeWinkGoBuildEdition(process.env.WINKGO_EDITION);
  const appName = electronApp.isPackaged ? getAppDisplayName() : getDevAppName();
  const storageAppName = getStorageAppName(electronApp.isPackaged);
  const legacyAppName = getLegacyAppName(electronApp.isPackaged);
  const legacyUserDataPath = path.join(appDataRoot, legacyAppName);
  const brandedUserDataPath = path.join(appDataRoot, storageAppName);

  // Only the Free edition inherits the historic WinkGo profile. Pro is a
  // separate product and must start with its own login/session directory;
  // otherwise a customer could silently inherit another edition's tokens.
  if (buildEdition === 'free') {
    renameDirectoryIfTargetIsFree(legacyUserDataPath, brandedUserDataPath);
  }

  // If Windows still has a handle open inside the legacy directory, keep
  // using that directory for this launch instead of silently starting with
  // an empty profile. The migration will be retried on the next launch.
  const effectiveUserDataPath =
    buildEdition === 'free' && !existsSync(brandedUserDataPath) && existsSync(legacyUserDataPath)
      ? legacyUserDataPath
      : brandedUserDataPath;

  // The default project/workspace directory used to be named "winkgo".
  // Rename it before getDataPath() is first evaluated so no empty duplicate
  // directory is created alongside the user's existing projects.
  renameDirectoryIfTargetIsFree(
    path.join(effectiveUserDataPath, 'winkgo'),
    path.join(effectiveUserDataPath, DEFAULT_WORK_DIR_NAME)
  );

  electronApp.setName(appName);
  electronApp.setPath('userData', effectiveUserDataPath);
  electronApp.setAppLogsPath(path.join(effectiveUserDataPath, 'logs'));
  return effectiveUserDataPath;
}

export function registerPlatformServices(services: IPlatformServices): void {
  _services = services;
}

export function getPlatformServices(): IPlatformServices {
  if (!_services) {
    // In Electron, module-level code in initStorage.ts may execute before the
    // explicit registerPlatformServices(new ElectronPlatformServices()) call
    // because Rollup places the shared chunk require() ahead of side-effect
    // imports in the bundled output. Auto-register an inline implementation using
    // electron.app directly so that all platform API callers work regardless of
    // call order. This will be replaced by the proper ElectronPlatformServices
    // once registerPlatformServices() is called.
    if (process.versions?.electron) {
      // In Electron utility processes process.type === 'utility' and app is not
      // accessible. Fall back to NodePlatformServices (DATA_DIR is injected by
      // ElectronPlatformServices.fork so paths still resolve correctly).
      const processType = (process as NodeJS.Process & { type?: string }).type;
      if (processType !== 'browser') {
        _services = new NodePlatformServices();
      } else {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app, net } = require('electron') as typeof import('electron');
        // Dev isolation: set app name before any getPath('userData') call.
        // Rollup may load this chunk before configureChromium.ts runs, so we
        // must apply the dev name here as a safety net.
        if (process.env.WINKGO_E2E_TEST !== '1') {
          configureBrandedAppPaths(app);
        }
        // Typed as IPlatformPaths so tsc enforces completeness: any new method
        // added to the interface will cause a compile error here if omitted below.
        const paths: import('./IPlatformServices').IPlatformPaths = {
          getDataDir: () => app.getPath('userData'),
          getTempDir: () => app.getPath('temp'),
          getHomeDir: () => app.getPath('home'),
          getLogsDir: () => {
            try {
              return app.getPath('logs');
            } catch {
              return path.join(app.getPath('userData'), 'logs');
            }
          },
          getAppPath: () => app.getAppPath(),
          isPackaged: () => app.isPackaged,
          getSystemPath: (name) => app.getPath(name),
          getName: () => app.getName(),
          getVersion: () => app.getVersion(),
          needsCliSafeSymlinks: () => process.platform === 'darwin',
        };
        _services = {
          paths,
          worker: {
            fork: () => {
              throw new Error('[Platform] Worker not available before registerPlatformServices()');
            },
          },
          power: { preventSleep: () => null, allowSleep: () => {}, preventDisplaySleep: () => null },
          notification: { send: () => {} },
          network: {
            fetch: (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
              net.fetch(input instanceof URL ? input.toString() : input, init),
          },
        };
      }
    } else {
      throw new Error(
        '[Platform] Services not registered. Call registerPlatformServices() before using platform APIs.'
      );
    }
  }
  return _services;
}

export type {
  IPlatformServices,
  IPlatformPaths,
  IWorkerProcess,
  IWorkerProcessFactory,
  IPowerManager,
  INotificationService,
  INetworkService,
} from './IPlatformServices';
