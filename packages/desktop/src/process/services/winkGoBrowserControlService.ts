/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { webContents, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { getCdpBridgeHandle } from '@process/utils/cdpBridgeRegistry';

const MAX_PAGE_TEXT_LENGTH = 12_000;
const MAX_INTERACTIVE_ELEMENTS = 220;
const DEFAULT_WAIT_TIMEOUT_MS = 10_000;
// The first browser request may also route the renderer to the originating
// conversation before its webview can mount. On slower Windows machines that
// transition can legitimately take a little over eight seconds, so keep the
// initial attach window generous while retaining one shared pending request.
const BROWSER_ATTACH_TIMEOUT_MS = 15_000;
const PREVIEW_ACK_TIMEOUT_MS = 2_000;
const VISUAL_SNAPSHOT_MAX_WIDTH = 1_440;
const VISUAL_SNAPSHOT_JPEG_QUALITY = 82;

let pendingBrowserOpen: Promise<WebContents | null> | null = null;

export type WinkGoBrowserElement = {
  ref: string;
  tag: string;
  role: string;
  name: string;
  text: string;
  disabled: boolean;
  checked?: boolean;
  value?: string;
  placeholder?: string;
  href?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  sensitive?: boolean;
};

export type WinkGoBrowserPageSnapshot = {
  ok: boolean;
  attached: boolean;
  snapshotId?: string;
  url?: string;
  title?: string;
  text?: string;
  elements?: WinkGoBrowserElement[];
  viewport?: { width: number; height: number };
  screenshot?: {
    dataUrl: string;
    width: number;
    height: number;
    viewportWidth: number;
    viewportHeight: number;
  };
  message?: string;
};

export type WinkGoBrowserActionType =
  | 'navigate'
  | 'click'
  | 'submit'
  | 'fill'
  | 'select'
  | 'press'
  | 'wait'
  | 'scroll'
  | 'back'
  | 'forward'
  | 'reload';

export type WinkGoBrowserActionRequest = {
  action: WinkGoBrowserActionType;
  ref?: string;
  selector?: string;
  role?: string;
  name?: string;
  value?: string;
  url?: string;
  key?: string;
  text?: string;
  timeoutMs?: number;
  deltaX?: number;
  deltaY?: number;
  /** Viewport coordinates. Autonomous vision plans are normalized to this space before execution. */
  x?: number;
  y?: number;
};

export type WinkGoBrowserActionResult = {
  ok: boolean;
  action: WinkGoBrowserActionType;
  url?: string;
  title?: string;
  message?: string;
};

type PageActionResult = { ok?: boolean; reason?: string };

const cleanText = (value: unknown, maximum = 500): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';

const getAttachedBrowser = (): WebContents | null => {
  const id = getCdpBridgeHandle()?.attachedWebContentsId() ?? null;
  if (id === null) return null;
  const contents = webContents.fromId(id);
  return contents && !contents.isDestroyed() && contents.getType() === 'webview' ? contents : null;
};

/**
 * Ask the renderer to expose the visible in-app browser and wait until its
 * webview is attached to the single-target bridge.  Browser tools are invoked
 * from an MCP child process, so merely returning "open the browser first"
 * leaves the model in a dead end.  This turns the first browser action into the
 * same user-visible flow as Codex: the browser panel opens inside the current
 * conversation and that exact webview becomes the control target.
 */
const ensureAttachedBrowser = async (
  initialUrl = 'about:blank',
  conversationId?: string
): Promise<WebContents | null> => {
  const current = getAttachedBrowser();
  if (current) return current;
  if (pendingBrowserOpen) return pendingBrowserOpen;

  pendingBrowserOpen = (async () => {
    const handle = getCdpBridgeHandle();
    if (!handle) return null;

    const waitForAttachment = new Promise<WebContents | null>((resolve) => {
      let settled = false;
      let unsubscribe: (() => void) | undefined;
      const finish = (value: WebContents | null) => {
        if (settled) return;
        settled = true;
        unsubscribe?.();
        resolve(value);
      };
      unsubscribe = handle.onAttached((webContentsId) => {
        if (webContentsId === null) return;
        const contents = webContents.fromId(webContentsId);
        if (contents && !contents.isDestroyed() && contents.getType() === 'webview') finish(contents);
      });
      setTimeout(() => finish(getAttachedBrowser()), BROWSER_ATTACH_TIMEOUT_MS);
    });

    try {
      const { ipcBridge } = await import('@/common');
      const request = {
        content: initialUrl,
        content_type: 'browser' as const,
        metadata: {
          title: 'WINK GO Browser',
          ...(conversationId ? { conversation_id: conversationId } : {}),
        },
      };
      const acknowledgement = await Promise.race([
        ipcBridge.preview.requestOpen.invoke(request).catch(() => ({ accepted: false })),
        new Promise<{ accepted: false }>((resolve) =>
          setTimeout(() => resolve({ accepted: false }), PREVIEW_ACK_TIMEOUT_MS)
        ),
      ]);
      console.info('[WINK GO browser] Preview open acknowledgement.', {
        accepted: acknowledgement.accepted,
        routedConversation: Boolean(conversationId),
      });
      if (!acknowledgement.accepted) {
        // Compatibility fallback for an older renderer during hot reload. The
        // attachment wait below remains the source of truth, so a false ack can
        // never be reported as a successful browser connection.
        ipcBridge.preview.open.emit(request);
      }
    } catch (error) {
      console.warn('[WINK GO browser] Failed to request the in-app browser panel:', error);
      return null;
    }

    return await waitForAttachment;
  })().finally(() => {
    pendingBrowserOpen = null;
  });

  return pendingBrowserOpen;
};

const safeNavigationUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().slice(0, 2_048);
  } catch {
    return '';
  }
};

const currentPage = (target: WebContents): Pick<WinkGoBrowserActionResult, 'url' | 'title'> => ({
  url: target.getURL(),
  title: target.getTitle(),
});

const comparableUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    if (parsed.pathname === '/') parsed.pathname = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return value.replace(/\/$/, '');
  }
};

const navigationReachedTarget = (current: string, requested: string): boolean => {
  if (comparableUrl(current) === comparableUrl(requested)) return true;
  try {
    const currentUrl = new URL(current);
    const requestedUrl = new URL(requested);
    return currentUrl.origin === requestedUrl.origin && currentUrl.pathname === requestedUrl.pathname;
  } catch {
    return false;
  }
};

const navigationReachedWebRedirect = (current: string, previous: string): boolean => {
  if (!safeNavigationUrl(current) || comparableUrl(current) === comparableUrl(previous)) return false;
  try {
    const protocol = new URL(current).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

const navigationRedirectPointsToRequested = (current: string, requested: string): boolean => {
  try {
    const currentUrl = new URL(current);
    for (const key of ['return_to', 'returnTo', 'redirect_uri', 'redirect', 's_url', 'url', 'next', 'continue']) {
      const value = currentUrl.searchParams.get(key);
      if (value && navigationReachedTarget(new URL(value, currentUrl).toString(), requested)) return true;
    }
  } catch {
    return false;
  }
  return false;
};

const isAbortedNavigationError = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; errno?: unknown; message?: unknown };
  return (
    candidate?.code === 'ERR_ABORTED' ||
    candidate?.errno === -3 ||
    (typeof candidate?.message === 'string' && /ERR_ABORTED|\(-3\)/i.test(candidate.message))
  );
};

const buildSnapshotScript = (snapshotId: string, maximumElements: number): string => `
(() => {
  const snapshotId = ${JSON.stringify(snapshotId)};
  const maximumElements = ${maximumElements};
  const normalize = (value, maximum = 500) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, maximum);
  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 &&
      rect.width > 0 && rect.height > 0;
  };
  const implicitRole = (element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === 'a' && element.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'canvas') return 'application';
    if (tag === 'input') {
      const type = String(element.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      return 'textbox';
    }
    if (element.hasAttribute('contenteditable')) return 'textbox';
    return '';
  };
  const labelText = (element) => {
    const aria = element.getAttribute('aria-label');
    if (aria) return normalize(aria, 240);
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
      if (normalize(text)) return normalize(text, 240);
    }
    if (element.id) {
      try {
        const explicit = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
        if (explicit && normalize(explicit.textContent)) return normalize(explicit.textContent, 240);
      } catch {}
    }
    const parentLabel = element.closest('label');
    if (parentLabel && normalize(parentLabel.textContent)) return normalize(parentLabel.textContent, 240);
    return normalize(
      element.getAttribute('alt') || element.getAttribute('title') || element.getAttribute('placeholder') ||
        element.textContent || element.getAttribute('value'),
      240
    );
  };
  const interactiveSelector = [
    'a[href]', 'button', 'input', 'textarea', 'select', 'summary', '[contenteditable="true"]',
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="checkbox"]', '[role="radio"]',
    '[role="combobox"]', '[tabindex]:not([tabindex="-1"])', 'canvas'
  ].join(',');
  document.querySelectorAll('[data-winkgo-agent-ref]').forEach((element) => {
    element.removeAttribute('data-winkgo-agent-ref');
  });
  const elements = [];
  for (const element of Array.from(document.querySelectorAll(interactiveSelector))) {
    if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
    if (elements.length >= maximumElements) break;
    const ref = snapshotId + '-e' + (elements.length + 1);
    element.setAttribute('data-winkgo-agent-ref', ref);
    const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement ? element : null;
    const inputType = element instanceof HTMLInputElement ? String(element.type || '').toLowerCase() : '';
    const bounds = element.getBoundingClientRect();
    const sensitive = inputType === 'password' || /password|passwd|token|secret|otp|验证码|密码/i.test(
      [element.id, element.getAttribute('name'), element.getAttribute('autocomplete'), element.getAttribute('aria-label')]
        .filter(Boolean).join(' ')
    );
    elements.push({
      ref,
      tag: element.tagName.toLowerCase(),
      role: normalize(element.getAttribute('role') || implicitRole(element), 60),
      name: labelText(element),
      text: normalize(element.textContent, 240),
      disabled: Boolean(element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true'),
      ...(sensitive ? { sensitive: true } : {}),
      ...(element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(inputType)
        ? { checked: element.checked } : {}),
      ...(input && !sensitive && normalize(input.value, 240) ? { value: normalize(input.value, 240) } : {}),
      ...(normalize(element.getAttribute('placeholder'), 160)
        ? { placeholder: normalize(element.getAttribute('placeholder'), 160) } : {}),
      ...(element instanceof HTMLAnchorElement && element.href ? { href: element.href.slice(0, 2048) } : {}),
      bounds: {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.round(bounds.width),
        height: Math.round(bounds.height)
      }
    });
  }
  return {
    text: normalize(document.body?.innerText || '', ${MAX_PAGE_TEXT_LENGTH}),
    elements,
    viewport: { width: Math.max(1, Math.round(window.innerWidth)), height: Math.max(1, Math.round(window.innerHeight)) }
  };
})()`;

const captureVisualSnapshot = async (
  target: WebContents,
  viewport: { width: number; height: number }
): Promise<WinkGoBrowserPageSnapshot['screenshot'] | undefined> => {
  try {
    const source = await target.capturePage();
    if (source.isEmpty()) return undefined;
    const sourceSize = source.getSize();
    const image =
      sourceSize.width > VISUAL_SNAPSHOT_MAX_WIDTH
        ? source.resize({ width: VISUAL_SNAPSHOT_MAX_WIDTH, quality: 'good' })
        : source;
    const size = image.getSize();
    const jpeg = image.toJPEG(VISUAL_SNAPSHOT_JPEG_QUALITY);
    if (jpeg.length === 0) return undefined;
    return {
      dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      width: size.width,
      height: size.height,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
    };
  } catch (error) {
    console.warn('[WINK GO browser] Failed to capture visual browser snapshot:', error);
    return undefined;
  }
};

export const inspectWinkGoBrowserPage = async (
  maximumElements?: number,
  conversationId?: string,
  options: { includeScreenshot?: boolean } = {}
): Promise<WinkGoBrowserPageSnapshot> => {
  const target = await ensureAttachedBrowser('about:blank', conversationId);
  if (!target) {
    return {
      ok: false,
      attached: false,
      message: 'WINK GO 已请求打开内置浏览器，但浏览器视图未能在 15 秒内连接。请保持当前对话页面可见后重试。',
    };
  }
  const snapshotId = randomUUID().replace(/-/g, '').slice(0, 12);
  const safeMaximum = Math.max(20, Math.min(MAX_INTERACTIVE_ELEMENTS, Math.trunc(maximumElements || 120)));
  try {
    const snapshot = (await target.executeJavaScript(buildSnapshotScript(snapshotId, safeMaximum), true)) as {
      text?: unknown;
      elements?: unknown;
      viewport?: { width?: unknown; height?: unknown };
    };
    const elements = Array.isArray(snapshot?.elements) ? (snapshot.elements as WinkGoBrowserElement[]) : [];
    const viewport = {
      width: Math.max(1, Math.trunc(Number(snapshot?.viewport?.width) || 1)),
      height: Math.max(1, Math.trunc(Number(snapshot?.viewport?.height) || 1)),
    };
    const protectedPage =
      elements.some((element) => element.sensitive) ||
      /二维码|扫码登录|图形验证码|captcha|qr\s*(?:code|login)/i.test(
        [target.getURL(), target.getTitle(), cleanText(snapshot?.text, 2_000)].join(' ')
      );
    const screenshot =
      options.includeScreenshot && !protectedPage ? await captureVisualSnapshot(target, viewport) : undefined;
    return {
      ok: true,
      attached: true,
      snapshotId,
      url: target.getURL(),
      title: target.getTitle(),
      text: cleanText(snapshot?.text, MAX_PAGE_TEXT_LENGTH),
      elements,
      viewport,
      ...(screenshot ? { screenshot } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      attached: true,
      ...currentPage(target),
      message: error instanceof Error ? error.message : '读取浏览器页面失败。',
    };
  }
};

const buildElementActionScript = (request: WinkGoBrowserActionRequest): string => `
(async () => {
  const request = ${JSON.stringify(request)};
  const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const implicitRole = (element) => {
    const tag = element.tagName.toLowerCase();
    if (tag === 'a' && element.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'input') {
      const type = String(element.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      return 'textbox';
    }
    return element.hasAttribute('contenteditable') ? 'textbox' : '';
  };
  const accessibleName = (element) => normalize(
    element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') ||
      element.textContent || element.getAttribute('value')
  );
  const find = () => {
    if (request.ref) {
      const direct = document.querySelector('[data-winkgo-agent-ref="' + CSS.escape(request.ref) + '"]');
      if (direct) return direct;
    }
    if (request.selector) {
      try {
        const direct = document.querySelector(request.selector);
        if (direct) return direct;
      } catch {}
    }
    if (request.role || request.name) {
      return Array.from(document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"]'))
        .find((element) => {
          const roleMatches = !request.role || normalize(element.getAttribute('role') || implicitRole(element)) === normalize(request.role);
          const nameMatches = !request.name || accessibleName(element) === normalize(request.name);
          return roleMatches && nameMatches;
        }) || null;
    }
    return null;
  };
  const timeout = Math.max(0, Math.min(60000, Number(request.timeoutMs) || ${DEFAULT_WAIT_TIMEOUT_MS}));
  const deadline = Date.now() + timeout;
  let element = find();
  while (!element && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    element = find();
  }
  if (!element) return { ok: false, reason: 'target-not-found' };
  if (!(element instanceof HTMLElement)) return { ok: false, reason: 'target-not-interactive' };
  element.scrollIntoView({ block: 'center', inline: 'center' });
  element.focus({ preventScroll: true });
  if (request.action === 'click') {
    element.click();
    return { ok: true };
  }
  if (request.action === 'submit') {
    const form = element instanceof HTMLFormElement ? element : element.closest('form');
    if (form) form.requestSubmit();
    else element.click();
    return { ok: true };
  }
  if (request.action === 'fill') {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
      return { ok: false, reason: 'target-not-editable' };
    }
    if (element.isContentEditable) {
      element.textContent = String(request.value || '');
    } else {
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, String(request.value || ''));
      else element.value = String(request.value || '');
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(request.value || '') }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }
  if (request.action === 'select') {
    if (!(element instanceof HTMLSelectElement)) return { ok: false, reason: 'target-not-select' };
    element.value = String(request.value || '');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }
  if (request.action === 'press') return { ok: true };
  return { ok: false, reason: 'unsupported-element-action' };
})()`;

const waitForPageCondition = async (
  target: WebContents,
  request: WinkGoBrowserActionRequest
): Promise<PageActionResult> => {
  const timeout = Math.max(0, Math.min(60_000, request.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS));
  const script = `
  (async () => {
    const selector = ${JSON.stringify(request.selector || '')};
    const text = ${JSON.stringify(cleanText(request.text, 500))};
    const deadline = Date.now() + ${timeout};
    const ready = () => {
      if (selector) {
        try { if (document.querySelector(selector)) return true; } catch {}
      }
      if (text && String(document.body?.innerText || '').includes(text)) return true;
      return !selector && !text && document.readyState === 'complete';
    };
    while (!ready() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    return ready() ? { ok: true } : { ok: false, reason: 'wait-timeout' };
  })()`;
  return (await target.executeJavaScript(script, true)) as PageActionResult;
};

const keyInput = (key: string): { keyCode: string; modifiers?: Array<'shift' | 'control' | 'alt' | 'meta'> } => {
  const parts = key
    .split('+')
    .map((item) => item.trim())
    .filter(Boolean);
  const main = parts.pop() || 'Enter';
  const modifiers = parts.flatMap((part) => {
    const normalized = part.toLowerCase();
    if (normalized === 'ctrl' || normalized === 'control') return ['control' as const];
    if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') return ['meta' as const];
    if (normalized === 'shift') return ['shift' as const];
    if (normalized === 'alt' || normalized === 'option') return ['alt' as const];
    return [];
  });
  return { keyCode: main, ...(modifiers.length > 0 ? { modifiers } : {}) };
};

export const executeWinkGoBrowserAction = async (
  request: WinkGoBrowserActionRequest,
  conversationId?: string
): Promise<WinkGoBrowserActionResult> => {
  const action = request.action;
  const requestedNavigationUrl = action === 'navigate' ? safeNavigationUrl(request.url || '') : '';
  if (action === 'navigate' && !requestedNavigationUrl) {
    return { ok: false, action, message: '只允许打开 HTTP 或 HTTPS 地址。' };
  }
  const target = await ensureAttachedBrowser(requestedNavigationUrl || 'about:blank', conversationId);
  if (!target) {
    return {
      ok: false,
      action,
      message: 'WINK GO 已请求打开内置浏览器，但浏览器视图未能在 15 秒内连接。请保持当前对话页面可见后重试。',
    };
  }
  try {
    if (action === 'navigate') {
      const url = requestedNavigationUrl;
      const previousUrl = target.getURL();
      // Electron rejects loadURL with ERR_ABORTED when a pending navigation is
      // superseded, and also when the requested URL is already being shown.
      // Treat it as success only after verifying that the visible page reached
      // the requested target; all other failures remain visible to the caller.
      if (navigationReachedTarget(target.getURL(), url)) {
        return { ok: true, action, ...currentPage(target) };
      }
      try {
        await target.loadURL(url);
      } catch (error) {
        if (!isAbortedNavigationError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
        const currentUrl = target.getURL();
        if (
          !navigationReachedTarget(currentUrl, url) &&
          !navigationReachedWebRedirect(currentUrl, previousUrl) &&
          !navigationRedirectPointsToRequested(currentUrl, url)
        ) {
          throw error;
        }
      }
      return { ok: true, action, ...currentPage(target) };
    }
    if (action === 'back') {
      if (target.navigationHistory.canGoBack()) await target.navigationHistory.goBack();
      return { ok: true, action, ...currentPage(target) };
    }
    if (action === 'forward') {
      if (target.navigationHistory.canGoForward()) await target.navigationHistory.goForward();
      return { ok: true, action, ...currentPage(target) };
    }
    if (action === 'reload') {
      target.reload();
      return { ok: true, action, ...currentPage(target) };
    }
    if (action === 'scroll') {
      await target.executeJavaScript(
        `window.scrollBy({ left: ${Number(request.deltaX) || 0}, top: ${Number(request.deltaY) || 600}, behavior: 'smooth' }); true;`,
        true
      );
      return { ok: true, action, ...currentPage(target) };
    }
    if (action === 'wait') {
      const execution = await waitForPageCondition(target, request);
      return execution?.ok
        ? { ok: true, action, ...currentPage(target) }
        : { ok: false, action, ...currentPage(target), message: execution?.reason || '等待页面超时。' };
    }
    if (action === 'click' && Number.isFinite(request.x) && Number.isFinite(request.y)) {
      const viewport = (await target.executeJavaScript(
        '({ width: Math.max(1, Math.round(window.innerWidth)), height: Math.max(1, Math.round(window.innerHeight)) })',
        true
      )) as { width?: unknown; height?: unknown };
      const width = Math.max(1, Math.trunc(Number(viewport?.width) || 1));
      const height = Math.max(1, Math.trunc(Number(viewport?.height) || 1));
      const x = Math.round(Number(request.x));
      const y = Math.round(Number(request.y));
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return { ok: false, action, ...currentPage(target), message: '视觉点击坐标超出当前浏览器可视区域。' };
      }
      target.sendInputEvent({ type: 'mouseMove', x, y });
      target.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      target.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      return { ok: true, action, ...currentPage(target) };
    }
    const execution = (await target.executeJavaScript(buildElementActionScript(request), true)) as PageActionResult;
    if (!execution?.ok) {
      return {
        ok: false,
        action,
        ...currentPage(target),
        message: execution?.reason || '浏览器操作失败。',
      };
    }
    if (action === 'press') {
      const input = keyInput(cleanText(request.key, 80) || 'Enter');
      target.sendInputEvent({ type: 'keyDown', ...input });
      target.sendInputEvent({ type: 'keyUp', ...input });
    }
    return { ok: true, action, ...currentPage(target) };
  } catch (error) {
    return {
      ok: false,
      action,
      ...currentPage(target),
      message: error instanceof Error ? error.message : '浏览器操作失败。',
    };
  }
};
