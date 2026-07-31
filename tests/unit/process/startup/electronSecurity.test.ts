/**
 * @license
 * Copyright 2026 WINK GO contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  getSafeExternalOpenUrl,
  HTML_PREVIEW_WEBVIEW_PARTITION,
  isAllowedWebviewNavigationUrl,
  isTrustedApplicationUrl,
  isTrustedIpcSender,
  PDF_PREVIEW_WEBVIEW_PARTITION,
  registerTrustedWebContents,
  REMOTE_WEBVIEW_PARTITION,
  resolveTrustedDevServerUrl,
  shouldGrantTrustedPermission,
  type TrustedWindowUrlPolicy,
} from '@/common/platform/electronSecurity';

const mainPolicy: TrustedWindowUrlPolicy = {
  role: 'main',
  productionEntryUrl: 'file:///C:/Program%20Files/WINK GO/index.html',
  devOrigin: 'http://localhost:5173',
};

describe('Electron security policy', () => {
  it('only accepts loopback development servers without embedded credentials', () => {
    expect(resolveTrustedDevServerUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
    expect(resolveTrustedDevServerUrl('https://127.0.0.1:5173/app')).toBe('https://127.0.0.1:5173/app');
    expect(resolveTrustedDevServerUrl('http://[::1]:5173/')).toBe('http://[::1]:5173/');
    expect(resolveTrustedDevServerUrl('https://example.com/')).toBeNull();
    expect(resolveTrustedDevServerUrl('http://user:pass@localhost:5173/')).toBeNull();
  });

  it('keeps system-open URLs on an explicit protocol allowlist', () => {
    expect(getSafeExternalOpenUrl('https://example.com/oauth')).toBe('https://example.com/oauth');
    expect(getSafeExternalOpenUrl('mailto:support@example.com')).toBe('mailto:support@example.com');
    expect(getSafeExternalOpenUrl('javascript:alert(1)')).toBeNull();
    expect(getSafeExternalOpenUrl('file:///C:/secret.txt')).toBeNull();
    expect(getSafeExternalOpenUrl('https://user:secret@example.com/')).toBeNull();
  });

  it('isolates remote, HTML, and PDF webview navigation', () => {
    expect(isAllowedWebviewNavigationUrl('https://example.com/app', REMOTE_WEBVIEW_PARTITION)).toBe(true);
    expect(isAllowedWebviewNavigationUrl('http://localhost:18791/app', REMOTE_WEBVIEW_PARTITION)).toBe(true);
    expect(isAllowedWebviewNavigationUrl('http://example.com/app', REMOTE_WEBVIEW_PARTITION)).toBe(false);
    expect(isAllowedWebviewNavigationUrl('file:///C:/secret.txt', REMOTE_WEBVIEW_PARTITION)).toBe(false);

    expect(
      isAllowedWebviewNavigationUrl('data:text/html;charset=utf-8,%3Ch1%3Eok', HTML_PREVIEW_WEBVIEW_PARTITION)
    ).toBe(true);
    expect(isAllowedWebviewNavigationUrl('file:///C:/preview/index.html', HTML_PREVIEW_WEBVIEW_PARTITION)).toBe(true);
    expect(isAllowedWebviewNavigationUrl('https://example.com/', HTML_PREVIEW_WEBVIEW_PARTITION)).toBe(false);

    expect(isAllowedWebviewNavigationUrl('data:application/pdf;base64,JVBERi0=', PDF_PREVIEW_WEBVIEW_PARTITION)).toBe(
      true
    );
    expect(isAllowedWebviewNavigationUrl('data:text/html,test', PDF_PREVIEW_WEBVIEW_PARTITION)).toBe(false);
  });

  it('trusts only the registered local entry file or the exact development origin', () => {
    expect(isTrustedApplicationUrl('file:///C:/Program%20Files/WINK GO/index.html#/guid', mainPolicy)).toBe(true);
    expect(isTrustedApplicationUrl('file:///C:/Program%20Files/WINK GO/other.html', mainPolicy)).toBe(false);
    expect(isTrustedApplicationUrl('http://localhost:5173/#/guid', mainPolicy)).toBe(true);
    expect(isTrustedApplicationUrl('http://localhost:5174/#/guid', mainPolicy)).toBe(false);
  });

  it('allows trusted main-frame audio and notifications while denying video, display, and guests', () => {
    expect(
      shouldGrantTrustedPermission({
        role: 'main',
        permission: 'media',
        mediaTypes: ['audio'],
        isMainFrame: true,
        isTrustedUrl: true,
      })
    ).toBe(true);
    expect(
      shouldGrantTrustedPermission({
        role: 'main',
        permission: 'media',
        mediaTypes: ['audio', 'video'],
        isMainFrame: true,
        isTrustedUrl: true,
      })
    ).toBe(false);
    expect(
      shouldGrantTrustedPermission({
        role: 'main',
        permission: 'display-capture',
        isMainFrame: true,
        isTrustedUrl: true,
      })
    ).toBe(false);
    expect(
      shouldGrantTrustedPermission({
        role: 'main',
        permission: 'notifications',
        isMainFrame: true,
        isTrustedUrl: true,
      })
    ).toBe(true);
    expect(
      shouldGrantTrustedPermission({
        role: 'island',
        permission: 'media',
        mediaTypes: ['audio'],
        isMainFrame: true,
        isTrustedUrl: true,
      })
    ).toBe(false);
    expect(
      shouldGrantTrustedPermission({
        role: 'main',
        permission: 'media',
        mediaTypes: ['audio'],
        isMainFrame: false,
        isTrustedUrl: true,
      })
    ).toBe(false);
  });

  it('rejects IPC from subframes, unregistered contents, and the wrong role', () => {
    const unregister = registerTrustedWebContents(42, mainPolicy);
    const senderFrame = {
      frameTreeNodeId: 10,
      url: 'file:///C:/Program%20Files/WINK GO/index.html#/guid',
    };
    const event = {
      sender: {
        id: 42,
        mainFrame: senderFrame,
      },
      senderFrame,
    };

    expect(isTrustedIpcSender(event as never, ['main'])).toBe(true);
    expect(isTrustedIpcSender(event as never, ['island'])).toBe(false);
    expect(
      isTrustedIpcSender(
        {
          ...event,
          senderFrame: { ...senderFrame, frameTreeNodeId: 11 },
        } as never,
        ['main']
      )
    ).toBe(false);

    unregister();
    expect(isTrustedIpcSender(event as never, ['main'])).toBe(false);
  });

  it('ships restrictive CSP metadata with valid hashes for every inline bootstrap script', () => {
    const rendererDirectory = path.resolve(process.cwd(), 'packages/desktop/src/renderer');
    const mainHtml = readFileSync(path.join(rendererDirectory, 'index.html'), 'utf8');
    const csp = mainHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u)?.[1];
    expect(csp).toBeTruthy();
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp?.match(/script-src ([^;]+)/u)?.[1]).not.toContain("'unsafe-inline'");

    const inlineScripts = [...mainHtml.matchAll(/<script>([\s\S]*?)<\/script>/gu)];
    expect(inlineScripts).toHaveLength(2);
    for (const match of inlineScripts) {
      const hash = createHash('sha256').update(match[1]).digest('base64');
      expect(csp).toContain(`'sha256-${hash}'`);
    }

    for (const fileName of ['pet/pet.html', 'pet/pet-hit.html', 'pet/pet-confirm.html']) {
      const html = readFileSync(path.join(rendererDirectory, fileName), 'utf8');
      expect(html).toContain('http-equiv="Content-Security-Policy"');
      expect(html).not.toContain("'unsafe-eval'");
    }
  });
});
