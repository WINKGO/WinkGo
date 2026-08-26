/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

const executedScripts: string[] = [];
const sentInputs: unknown[] = [];
let currentUrl = 'https://example.com/form';
let loadUrlCalls = 0;
let abortNextNavigation = false;
let abortRedirectUrl = '';
let attachedBrowserId: number | null = 92;
let sensitiveSnapshot = false;
const attachmentListeners = new Set<(webContentsId: number | null) => void>();
const previewOpen = vi.fn((payload: { content?: string }) => {
  if (payload.content) currentUrl = payload.content;
  attachedBrowserId = fakeBrowser.id;
  queueMicrotask(() => {
    for (const listener of attachmentListeners) listener(attachedBrowserId);
  });
});
const previewRequestOpen = vi.fn(async (payload: { content?: string }) => {
  previewOpen(payload);
  return { accepted: true };
});
const fakeImage = {
  isEmpty: () => false,
  getSize: () => ({ width: 800, height: 600 }),
  resize: () => fakeImage,
  toJPEG: () => Buffer.from('browser-jpeg-fixture'),
};

const fakeBrowser = {
  id: 92,
  getType: (): string => 'webview',
  getURL: (): string => currentUrl,
  getTitle: (): string => 'Example form',
  isDestroyed: (): boolean => false,
  capturePage: vi.fn(async () => fakeImage),
  executeJavaScript: (script: string): Promise<unknown> => {
    executedScripts.push(script);
    if (script.includes('interactiveSelector')) {
      return Promise.resolve({
        text: sensitiveSnapshot ? '扫码登录 验证码' : 'Example form Submit',
        viewport: { width: 800, height: 600 },
        elements: [
          {
            ref: 'snapshot-e1',
            tag: 'button',
            role: 'button',
            name: 'Submit',
            text: 'Submit',
            disabled: false,
            ...(sensitiveSnapshot ? { sensitive: true } : {}),
          },
        ],
      });
    }
    if (script.includes('window.innerWidth')) return Promise.resolve({ width: 800, height: 600 });
    return Promise.resolve({ ok: true });
  },
  loadURL: (url: string): Promise<void> => {
    loadUrlCalls += 1;
    currentUrl = url;
    if (abortNextNavigation) {
      abortNextNavigation = false;
      if (abortRedirectUrl) {
        currentUrl = abortRedirectUrl;
        abortRedirectUrl = '';
      }
      return Promise.reject(new Error(`ERR_ABORTED (-3) loading '${url}'`));
    }
    return Promise.resolve();
  },
  reload: vi.fn(),
  sendInputEvent: (input: unknown): void => {
    sentInputs.push(input);
  },
  navigationHistory: {
    canGoBack: (): boolean => true,
    canGoForward: (): boolean => true,
    goBack: vi.fn(),
    goForward: vi.fn(),
  },
};

const fakeBridge = {
  attachedWebContentsId: (): number | null => attachedBrowserId,
  onAttached: (listener: (webContentsId: number | null) => void): (() => void) => {
    attachmentListeners.add(listener);
    return () => attachmentListeners.delete(listener);
  },
};

vi.mock('electron', () => ({
  webContents: { fromId: (id: number): typeof fakeBrowser | null => (id === fakeBrowser.id ? fakeBrowser : null) },
}));
vi.mock('@process/utils/cdpBridgeRegistry', () => ({ getCdpBridgeHandle: () => fakeBridge }));
vi.mock('@/common', () => ({
  ipcBridge: {
    preview: {
      open: { emit: previewOpen },
      requestOpen: { invoke: previewRequestOpen },
    },
  },
}));

describe('WINK GO browser control service', () => {
  let service: typeof import('@process/services/winkGoBrowserControlService');

  beforeAll(async () => {
    service = await import('@process/services/winkGoBrowserControlService');
  });

  it('returns structured page state with actionable element refs', async () => {
    const snapshot = await service.inspectWinkGoBrowserPage(80);
    expect(snapshot.ok).toBe(true);
    expect(snapshot.attached).toBe(true);
    expect(snapshot.url).toBe('https://example.com/form');
    expect(snapshot.elements).toEqual([
      expect.objectContaining({ ref: 'snapshot-e1', role: 'button', name: 'Submit' }),
    ]);
    expect(executedScripts.some((script) => script.includes('data-winkgo-agent-ref'))).toBe(true);
    expect(executedScripts.some((script) => script.includes("'canvas'"))).toBe(true);
  });

  it('captures the visible browser pixels only when a visual snapshot is requested', async () => {
    fakeBrowser.capturePage.mockClear();
    const textOnly = await service.inspectWinkGoBrowserPage(80);
    expect(textOnly.screenshot).toBeUndefined();
    expect(fakeBrowser.capturePage).not.toHaveBeenCalled();

    const visual = await service.inspectWinkGoBrowserPage(80, undefined, { includeScreenshot: true });
    expect(fakeBrowser.capturePage).toHaveBeenCalledOnce();
    expect(visual.screenshot).toMatchObject({
      dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
      width: 800,
      height: 600,
      viewportWidth: 800,
      viewportHeight: 600,
    });
  });

  it('does not send screenshots of password, OTP, CAPTCHA, or QR-login pages to the model', async () => {
    fakeBrowser.capturePage.mockClear();
    sensitiveSnapshot = true;
    try {
      const protectedSnapshot = await service.inspectWinkGoBrowserPage(80, undefined, { includeScreenshot: true });
      expect(protectedSnapshot.screenshot).toBeUndefined();
      expect(fakeBrowser.capturePage).not.toHaveBeenCalled();
    } finally {
      sensitiveSnapshot = false;
    }
  });

  it('rejects navigation outside HTTP and HTTPS', async () => {
    const result = await service.executeWinkGoBrowserAction({ action: 'navigate', url: 'file:///C:/secret.txt' });
    expect(result.ok).toBe(false);
    expect(currentUrl).toBe('https://example.com/form');
  });

  it('opens and attaches the visible in-app browser before the first AI navigation', async () => {
    attachedBrowserId = null;
    previewOpen.mockClear();

    const result = await service.executeWinkGoBrowserAction({
      action: 'navigate',
      url: 'https://example.com/opened-by-ai',
    });

    expect(result.ok).toBe(true);
    expect(previewOpen).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'https://example.com/opened-by-ai', content_type: 'browser' })
    );
    expect(previewRequestOpen).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'https://example.com/opened-by-ai', content_type: 'browser' })
    );
    expect(attachedBrowserId).toBe(fakeBrowser.id);
    expect(currentUrl).toBe('https://example.com/opened-by-ai');
  });

  it('navigates, acts by ref, and sends keyboard chords to the visible browser', async () => {
    const navigation = await service.executeWinkGoBrowserAction({
      action: 'navigate',
      url: 'https://example.com/next',
    });
    expect(navigation.ok).toBe(true);
    expect(currentUrl).toBe('https://example.com/next');

    const click = await service.executeWinkGoBrowserAction({ action: 'click', ref: 'snapshot-e1' });
    expect(click.ok).toBe(true);

    const press = await service.executeWinkGoBrowserAction({
      action: 'press',
      ref: 'snapshot-e1',
      key: 'Control+Enter',
    });
    expect(press.ok).toBe(true);
    expect(sentInputs).toEqual([
      expect.objectContaining({ type: 'keyDown', keyCode: 'Enter', modifiers: ['control'] }),
      expect.objectContaining({ type: 'keyUp', keyCode: 'Enter', modifiers: ['control'] }),
    ]);
  });

  it('clicks canvas pixels with bounded viewport coordinates', async () => {
    const before = sentInputs.length;
    const result = await service.executeWinkGoBrowserAction({ action: 'click', x: 320, y: 240 });
    expect(result.ok).toBe(true);
    expect(sentInputs.slice(before)).toEqual([
      { type: 'mouseMove', x: 320, y: 240 },
      { type: 'mouseDown', x: 320, y: 240, button: 'left', clickCount: 1 },
      { type: 'mouseUp', x: 320, y: 240, button: 'left', clickCount: 1 },
    ]);

    const outside = await service.executeWinkGoBrowserAction({ action: 'click', x: 900, y: 240 });
    expect(outside.ok).toBe(false);
    expect(outside.message).toContain('超出');
  });

  it('does not reload the page already shown and accepts only a verified ERR_ABORTED navigation', async () => {
    currentUrl = 'https://example.com/already-open';
    const before = loadUrlCalls;
    const samePage = await service.executeWinkGoBrowserAction({
      action: 'navigate',
      url: 'https://example.com/already-open',
    });
    expect(samePage.ok).toBe(true);
    expect(loadUrlCalls).toBe(before);

    abortNextNavigation = true;
    const superseded = await service.executeWinkGoBrowserAction({
      action: 'navigate',
      url: 'https://example.com/reached-despite-abort',
    });
    expect(superseded.ok).toBe(true);
    expect(currentUrl).toBe('https://example.com/reached-despite-abort');
  });

  it('continues after an ERR_ABORTED server redirect reaches a different valid HTTPS page', async () => {
    currentUrl = 'https://example.com/form';
    abortNextNavigation = true;
    abortRedirectUrl = 'https://auth.example.net/login?return_to=https%3A%2F%2Fexample.com%2Fconsole';

    const redirected = await service.executeWinkGoBrowserAction({
      action: 'navigate',
      url: 'https://example.com/console',
    });

    expect(redirected).toEqual(
      expect.objectContaining({
        ok: true,
        url: 'https://auth.example.net/login?return_to=https%3A%2F%2Fexample.com%2Fconsole',
      })
    );
  });

  it('accepts an ERR_ABORTED redirect when the visible login page already points back to the requested page', async () => {
    currentUrl = 'https://auth.example.net/login?return_to=https%3A%2F%2Fexample.com%2Fconsole';
    abortNextNavigation = true;
    abortRedirectUrl = currentUrl;

    const redirected = await service.executeWinkGoBrowserAction({
      action: 'navigate',
      url: 'https://example.com/console',
    });

    expect(redirected.ok).toBe(true);
    expect(redirected.url).toBe(currentUrl);
  });
});
