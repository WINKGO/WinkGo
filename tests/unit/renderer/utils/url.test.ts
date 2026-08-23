/**
 * @vitest-environment jsdom
 *
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { parseHttpUrl, resolveSelectionHttpUrl } from '@/renderer/utils/url';

describe('parseHttpUrl', () => {
  it('accepts only one complete http(s) URL', () => {
    expect(parseHttpUrl(' https://winkgo.top/docs ')).toBe('https://winkgo.top/docs');
    expect(parseHttpUrl('http://winkgo.top')).toBe('http://winkgo.top/');
    expect(parseHttpUrl('see https://winkgo.top')).toBeNull();
    expect(parseHttpUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('resolveSelectionHttpUrl', () => {
  it('resolves a rich-text selection only when both ends share one link', () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://winkgo.top/';
    const first = document.createTextNode('WINK ');
    const second = document.createTextNode('GO');
    anchor.append(first, second);

    expect(resolveSelectionHttpUrl('WINK GO', first, second)).toBe('https://winkgo.top/');
  });

  it('rejects a non-http anchor even when the selected label looks actionable', () => {
    const anchor = document.createElement('a');
    anchor.href = 'mailto:support@winkgo.top';
    const text = document.createTextNode('联系支持');
    anchor.append(text);

    expect(resolveSelectionHttpUrl('联系支持', text, text)).toBeNull();
  });

  it('rejects a selection spanning different links', () => {
    const firstAnchor = document.createElement('a');
    firstAnchor.href = 'https://winkgo.top/docs';
    const first = document.createTextNode('文档');
    firstAnchor.append(first);
    const secondAnchor = document.createElement('a');
    secondAnchor.href = 'https://winkgo.top/download';
    const second = document.createTextNode('下载');
    secondAnchor.append(second);

    expect(resolveSelectionHttpUrl('文档 下载', first, second)).toBeNull();
  });

  it('rejects plain selected text that is neither a URL nor inside a link', () => {
    const text = document.createTextNode('WINK GO');

    expect(resolveSelectionHttpUrl('WINK GO', text, text)).toBeNull();
  });
});
