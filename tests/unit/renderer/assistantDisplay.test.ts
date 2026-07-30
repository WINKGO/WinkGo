/**
 * @license
 * Copyright 2025 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveAssistantName } from '@/renderer/utils/model/assistantDisplay';

describe('resolveAssistantName visible branding', () => {
  it('rebrands localized legacy assistant names', () => {
    expect(
      resolveAssistantName(
        {
          id: 'generated-winkgo_agent',
          name: 'WinkGo CLI',
          name_i18n: { 'zh-CN': 'WinkGo CLI' },
        },
        'zh-CN'
      )
    ).toBe('WINK GO CLI');
  });

  it('leaves unrelated assistant names unchanged', () => {
    expect(
      resolveAssistantName(
        {
          id: 'writer',
          name: 'Writer',
          name_i18n: {},
        },
        'zh-CN'
      )
    ).toBe('Writer');
  });
});
