/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  BROWSER_BLANK_URL,
  BROWSER_TAB_FALLBACK_TITLE,
  browserTabLabelFromUrl,
  resolveAddressBarInput,
} from '@/renderer/pages/conversation/Preview/browser/constants';

describe('browser address input', () => {
  it('accepts URLs and upgrades hostnames', () => {
    expect(resolveAddressBarInput('https://example.com/a')).toBe('https://example.com/a');
    expect(resolveAddressBarInput('example.com')).toBe('https://example.com');
    expect(resolveAddressBarInput('localhost:3000')).toBe('https://localhost:3000');
  });

  it('turns plain text into an encoded search', () => {
    expect(resolveAddressBarInput('WINK GO browser')).toBe('https://www.bing.com/search?q=WINK%20GO%20browser');
    expect(resolveAddressBarInput('a&b=c')).toBe('https://www.bing.com/search?q=a%26b%3Dc');
  });

  it('uses compact and safe tab labels', () => {
    expect(browserTabLabelFromUrl('https://example.com/long/path')).toBe('example.com');
    expect(browserTabLabelFromUrl(BROWSER_BLANK_URL)).toBe(BROWSER_TAB_FALLBACK_TITLE);
    expect(browserTabLabelFromUrl('not a url')).toBe(BROWSER_TAB_FALLBACK_TITLE);
  });
});
