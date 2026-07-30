/**
 * @license
 * Copyright 2025 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { transformFormatStudioText } from '@renderer/pages/winkgo/FormatStudioPage/transformText';

describe('transformFormatStudioText', () => {
  it('normalizes line endings, trailing spaces and excessive blank lines', () => {
    const result = transformFormatStudioText('  first  \r\n\r\n\r\nsecond\t\r\n', 'cleanText');

    expect(result).toEqual({ ok: true, output: 'first\n\nsecond' });
  });

  it('keeps existing Markdown structure while turning plain lines into an outline', () => {
    const result = transformFormatStudioText('# Topic\nplain item\n- existing item', 'markdownOutline');

    expect(result).toEqual({ ok: true, output: '# Topic\n- plain item\n- existing item' });
  });

  it('formats valid JSON without changing its data', () => {
    const result = transformFormatStudioText('{"name":"WINK GO","enabled":true}', 'formatJson');

    expect(result).toEqual({
      ok: true,
      output: '{\n  "name": "WINK GO",\n  "enabled": true\n}',
    });
  });

  it('rejects invalid JSON instead of returning damaged output', () => {
    expect(transformFormatStudioText('{"name":', 'formatJson')).toEqual({
      ok: false,
      error: 'invalidJson',
    });
  });
});
