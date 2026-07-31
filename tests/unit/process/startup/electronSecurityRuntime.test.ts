/**
 * @license
 * Copyright 2026 WINK GO contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HTML_PREVIEW_WEBVIEW_PARTITION } from '@/common/platform/electronSecurity';

const openExternal = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('electron', () => ({
  shell: {
    openExternal,
  },
}));

type Listener = (...args: unknown[]) => unknown;

function createFakeSession() {
  const handlers: Record<string, Listener> = {};
  return {
    handlers,
    setDevicePermissionHandler: (handler: Listener) => {
      handlers.device = handler;
    },
    setDisplayMediaRequestHandler: (handler: Listener) => {
      handlers.display = handler;
    },
    setPermissionCheckHandler: (handler: Listener) => {
      handlers.check = handler;
    },
    setPermissionRequestHandler: (handler: Listener) => {
      handlers.request = handler;
    },
  };
}

function createFakeWebContents(
  id: number,
  url: string,
  type: 'webview' | 'window' = 'window',
  targetSession = createFakeSession()
) {
  const listeners = new Map<string, Listener[]>();
  const mainFrame = { frameTreeNodeId: id * 10, url };
  let windowOpenHandler: Listener | undefined;
  return {
    id,
    listeners,
    mainFrame,
    session: targetSession,
    close: vi.fn(),
    getType: () => type,
    getURL: () => url,
    on: (event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    once: (event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    },
    setWindowOpenHandler: (handler: Listener) => {
      windowOpenHandler = handler;
    },
    getWindowOpenHandler: () => windowOpenHandler,
  };
}

describe('Electron security runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    openExternal.mockClear();
  });

  it('allows trusted main-window audio but denies video, display capture, and unregistered guests', async () => {
    const appListeners = new Map<string, Listener>();
    const fakeApp = {
      on: (event: string, listener: Listener) => appListeners.set(event, listener),
    };
    const mainSession = createFakeSession();
    const entryFile = path.resolve('out/renderer/index.html');
    const entryUrl = pathToFileURL(entryFile).toString();
    const contents = createFakeWebContents(7, entryUrl, 'window', mainSession);
    const { installElectronSecurityPolicy, registerTrustedWindowSecurity } =
      await import('@/process/startup/electronSecurity');

    installElectronSecurityPolicy(fakeApp as never);
    appListeners.get('web-contents-created')?.({}, contents);
    registerTrustedWindowSecurity({ webContents: contents } as never, {
      role: 'main',
      productionEntryFile: entryFile,
    });

    const audioDecision = vi.fn();
    mainSession.handlers.request(contents, 'media', audioDecision, {
      isMainFrame: true,
      requestingUrl: entryUrl,
      mediaTypes: ['audio'],
    });
    expect(audioDecision).toHaveBeenCalledWith(true);

    const videoDecision = vi.fn();
    mainSession.handlers.request(contents, 'media', videoDecision, {
      isMainFrame: true,
      requestingUrl: entryUrl,
      mediaTypes: ['video'],
    });
    expect(videoDecision).toHaveBeenCalledWith(false);

    const guestDecision = vi.fn();
    const guestContents = createFakeWebContents(8, 'https://example.com', 'webview', mainSession);
    mainSession.handlers.request(guestContents, 'media', guestDecision, {
      isMainFrame: true,
      requestingUrl: 'https://example.com',
      mediaTypes: ['audio'],
    });
    expect(guestDecision).toHaveBeenCalledWith(false);
    expect(mainSession.handlers.device({ deviceType: 'usb' })).toBe(false);

    const displayDecision = vi.fn();
    mainSession.handlers.display({}, displayDecision);
    expect(displayDecision).toHaveBeenCalledWith({});
  });

  it('strips dangerous webview preferences and blocks invalid initial URLs', async () => {
    const appListeners = new Map<string, Listener>();
    const fakeApp = {
      on: (event: string, listener: Listener) => appListeners.set(event, listener),
    };
    const embedder = createFakeWebContents(10, 'file:///app/index.html');
    const { installElectronSecurityPolicy } = await import('@/process/startup/electronSecurity');

    installElectronSecurityPolicy(fakeApp as never);
    appListeners.get('web-contents-created')?.({}, embedder);

    const attachHandler = embedder.listeners.get('will-attach-webview')?.[0];
    expect(attachHandler).toBeTypeOf('function');

    const invalidEvent = { preventDefault: vi.fn() };
    attachHandler?.(
      invalidEvent,
      {},
      {
        partition: 'winkgo-remote-webview',
        src: 'http://example.com/insecure',
      }
    );
    expect(invalidEvent.preventDefault).toHaveBeenCalledOnce();

    const validEvent = { preventDefault: vi.fn() };
    const preferences: Record<string, unknown> = {
      allowRunningInsecureContent: true,
      contextIsolation: false,
      nodeIntegration: true,
      preload: 'C:/malicious.js',
      sandbox: false,
      webSecurity: false,
    };
    const params: Record<string, string> = {
      allowpopups: '',
      partition: HTML_PREVIEW_WEBVIEW_PARTITION,
      preload: 'file:///C:/malicious.js',
      src: 'data:text/html,%3Ch1%3EPreview',
      webpreferences: 'nodeIntegration=yes',
    };
    attachHandler?.(validEvent, preferences, params);

    expect(validEvent.preventDefault).not.toHaveBeenCalled();
    expect(preferences).toMatchObject({
      allowRunningInsecureContent: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
    expect(preferences).not.toHaveProperty('preload');
    expect(params).not.toHaveProperty('allowpopups');
    expect(params).not.toHaveProperty('preload');
    expect(params).not.toHaveProperty('webpreferences');
  });

  it('denies in-app popups while forwarding only safe external URLs to the OS', async () => {
    const appListeners = new Map<string, Listener>();
    const fakeApp = {
      on: (event: string, listener: Listener) => appListeners.set(event, listener),
    };
    const contents = createFakeWebContents(12, 'file:///app/index.html');
    const { installElectronSecurityPolicy } = await import('@/process/startup/electronSecurity');

    installElectronSecurityPolicy(fakeApp as never);
    appListeners.get('web-contents-created')?.({}, contents);
    const handler = contents.getWindowOpenHandler();

    expect(handler?.({ url: 'https://example.com/oauth' })).toEqual({ action: 'deny' });
    expect(handler?.({ url: 'javascript:alert(1)' })).toEqual({ action: 'deny' });
    await Promise.resolve();

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/oauth');
  });
});
