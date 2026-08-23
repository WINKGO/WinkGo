/**
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isForkEnabled } from '@/common/chat/forkConversation';
import { describe, expect, it } from 'vitest';

describe('isForkEnabled', () => {
  it('stays hidden without a declared capability', () => {
    expect(isForkEnabled(undefined, { isLastMessage: true, hasTurnAnchor: true })).toBe(false);
  });

  it('allows every persisted message for WINK GO local-history branches', () => {
    expect(isForkEnabled({ at_turn: true }, { isLastMessage: false, hasTurnAnchor: false })).toBe(true);
    expect(isForkEnabled({ at_turn: true }, { isLastMessage: true, hasTurnAnchor: false })).toBe(true);
  });

  it('keeps HEAD-only capability on the latest message', () => {
    expect(isForkEnabled({ at_turn: false }, { isLastMessage: true, hasTurnAnchor: false })).toBe(true);
    expect(isForkEnabled({ at_turn: false }, { isLastMessage: false, hasTurnAnchor: true })).toBe(false);
  });
});
