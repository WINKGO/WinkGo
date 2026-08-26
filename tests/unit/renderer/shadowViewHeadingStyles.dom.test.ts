/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createInitStyle } from '@/renderer/components/Markdown/ShadowView';

describe('Markdown heading inline styles', () => {
  it('keeps bold, links and emphasis at the heading size', () => {
    const css = createInitStyle().textContent ?? '';
    const headingRule = css.indexOf(':is(h1, h2, h3, h4, h5, h6) *');
    expect(headingRule).toBeGreaterThan(css.indexOf('strong {'));
    expect(css.slice(headingRule)).toContain('font-size: inherit');
    expect(css.slice(headingRule)).toContain('line-height: inherit');
    expect(css.slice(headingRule)).toContain('font-weight: inherit');
  });
});
