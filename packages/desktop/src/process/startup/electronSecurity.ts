/**
 * @license
 * Copyright 2026 WINK GO contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { App, BrowserWindow, Session, WebContents, WebPreferences } from 'electron';
import { shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  getSafeExternalOpenUrl,
  getTrustedWindowPolicy,
  isAllowedWebviewNavigationUrl,
  isAllowedWebviewPartition,
  isTrustedApplicationUrl,
  isTrustedWebContentsUrl,
  PDF_PREVIEW_WEBVIEW_PARTITION,
  registerTrustedWebContents,
  resolveTrustedDevServerUrl,
  shouldGrantTrustedPermission,
  type TrustedWindowRole,
  type TrustedWindowUrlPolicy,
} from '@/common/platform/electronSecurity';

type TrustedWindowRegistration = {
  devServerUrl?: string | null;
  productionEntryFile: string;
  role: TrustedWindowRole;
};

type PendingGuestPolicy = {
  partition: string;
};

const configuredSessions = new WeakSet<Session>();
const installedApps = new WeakSet<App>();
const guestNavigationInstalled = new WeakSet<WebContents>();
const pendingGuestPolicies = new WeakMap<WebContents, PendingGuestPolicy[]>();

function openExternalSafely(value: string): void {
  const safeUrl = getSafeExternalOpenUrl(value);
  if (!safeUrl) return;
  void shell.openExternal(safeUrl).catch((error: unknown) => {
    console.warn('[ElectronSecurity] Failed to open external URL:', error);
  });
}

function installPopupPolicy(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });
}

function installTrustedNavigationPolicy(contents: WebContents, policy: TrustedWindowUrlPolicy): void {
  const handleNavigation = (event: Electron.Event<Electron.WebContentsWillNavigateEventParams>): void => {
    if (isTrustedApplicationUrl(event.url, policy)) return;
    event.preventDefault();
    openExternalSafely(event.url);
  };

  const handleRedirect = (event: Electron.Event<Electron.WebContentsWillRedirectEventParams>): void => {
    if (isTrustedApplicationUrl(event.url, policy)) return;
    event.preventDefault();
    openExternalSafely(event.url);
  };

  contents.on('will-navigate', handleNavigation);
  contents.on('will-redirect', handleRedirect);
}

function installGuestNavigationPolicy(contents: WebContents, partition: string): void {
  if (guestNavigationInstalled.has(contents)) return;
  guestNavigationInstalled.add(contents);

  const handleNavigation = (event: Electron.Event<Electron.WebContentsWillNavigateEventParams>): void => {
    if (isAllowedWebviewNavigationUrl(event.url, partition)) return;
    event.preventDefault();
    openExternalSafely(event.url);
  };

  const handleRedirect = (event: Electron.Event<Electron.WebContentsWillRedirectEventParams>): void => {
    if (isAllowedWebviewNavigationUrl(event.url, partition)) return;
    event.preventDefault();
    openExternalSafely(event.url);
  };

  contents.on('will-navigate', handleNavigation);
  contents.on('will-redirect', handleRedirect);
}

function hardenGuestPreferences(webPreferences: WebPreferences, partition: string): void {
  delete webPreferences.preload;
  webPreferences.allowRunningInsecureContent = false;
  webPreferences.contextIsolation = true;
  webPreferences.javascript = true;
  webPreferences.navigateOnDragDrop = false;
  webPreferences.nodeIntegration = false;
  webPreferences.nodeIntegrationInSubFrames = false;
  webPreferences.nodeIntegrationInWorker = false;
  webPreferences.partition = partition;
  webPreferences.plugins = partition === PDF_PREVIEW_WEBVIEW_PARTITION;
  webPreferences.safeDialogs = true;
  webPreferences.sandbox = true;
  webPreferences.webSecurity = true;
  webPreferences.webviewTag = false;
}

function configurePermissionHandlers(targetSession: Session): void {
  if (configuredSessions.has(targetSession)) return;
  configuredSessions.add(targetSession);

  targetSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const policy = getTrustedWindowPolicy(contents.id);
    const requestingUrl = details.requestingUrl || contents.getURL();
    const isTrustedUrl = isTrustedWebContentsUrl(contents.id, requestingUrl, ['main']);
    const granted = Boolean(
      policy &&
      shouldGrantTrustedPermission({
        role: policy.role,
        permission,
        isMainFrame: details.isMainFrame,
        isTrustedUrl,
        mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
      })
    );
    callback(granted);
  });

  targetSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    if (!contents) return false;
    const policy = getTrustedWindowPolicy(contents.id);
    const requestingUrl = details.requestingUrl || contents.getURL() || requestingOrigin;
    const isTrustedUrl = isTrustedWebContentsUrl(contents.id, requestingUrl, ['main']);
    return Boolean(
      policy &&
      shouldGrantTrustedPermission({
        role: policy.role,
        permission,
        isMainFrame: details.isMainFrame,
        isTrustedUrl,
        mediaType: details.mediaType,
      })
    );
  });

  targetSession.setDevicePermissionHandler(() => false);
  targetSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));
}

function installWebviewAttachmentPolicy(embedder: WebContents): void {
  embedder.on('will-attach-webview', (event, webPreferences, params) => {
    const partition = params.partition || webPreferences.partition || '';
    const sourceUrl = params.src || 'about:blank';
    if (!isAllowedWebviewPartition(partition) || !isAllowedWebviewNavigationUrl(sourceUrl, partition)) {
      event.preventDefault();
      return;
    }

    delete params.allowpopups;
    delete params.preload;
    delete params.webpreferences;
    params.partition = partition;
    hardenGuestPreferences(webPreferences, partition);

    const queue = pendingGuestPolicies.get(embedder) ?? [];
    queue.push({ partition });
    pendingGuestPolicies.set(embedder, queue);
  });

  embedder.on('did-attach-webview', (_event, guestContents) => {
    const queue = pendingGuestPolicies.get(embedder);
    const policy = queue?.shift();
    if (!policy) {
      guestContents.close();
      return;
    }
    configurePermissionHandlers(guestContents.session);
    installPopupPolicy(guestContents);
    installGuestNavigationPolicy(guestContents, policy.partition);
  });
}

export function installElectronSecurityPolicy(electronApp: App): void {
  if (installedApps.has(electronApp)) return;
  installedApps.add(electronApp);

  electronApp.on('web-contents-created', (_event, contents) => {
    configurePermissionHandlers(contents.session);
    installPopupPolicy(contents);
    if (contents.getType() !== 'webview') {
      installWebviewAttachmentPolicy(contents);
    }
  });
}

export function registerTrustedWindowSecurity(window: BrowserWindow, registration: TrustedWindowRegistration): void {
  const devServerUrl = resolveTrustedDevServerUrl(registration.devServerUrl ?? undefined);
  const policy: TrustedWindowUrlPolicy = {
    role: registration.role,
    productionEntryUrl: pathToFileURL(path.resolve(registration.productionEntryFile)).toString(),
    ...(devServerUrl ? { devOrigin: new URL(devServerUrl).origin } : {}),
  };

  const unregister = registerTrustedWebContents(window.webContents.id, policy);
  window.webContents.once('destroyed', unregister);
  configurePermissionHandlers(window.webContents.session);
  installPopupPolicy(window.webContents);
  installTrustedNavigationPolicy(window.webContents, policy);
}
