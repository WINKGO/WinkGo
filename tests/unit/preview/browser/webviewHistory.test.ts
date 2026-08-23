/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { InternalNavTracker, shouldResetHistoryForUrlProp } from '@/renderer/components/media/webviewHistory';

describe('webview URL echo tracking', () => {
  it('does not reload for an internal navigation echo', () => {
    const tracker = new InternalNavTracker();
    tracker.record('https://example.com/b');
    expect(shouldResetHistoryForUrlProp('https://example.com/b', tracker)).toBe(false);
    expect(shouldResetHistoryForUrlProp('https://example.com/b', tracker)).toBe(true);
  });

  it('recognises redirect echoes in either arrival order', () => {
    const tracker = new InternalNavTracker();
    tracker.record('https://example.com/search');
    tracker.record('https://example.com/redirect');
    expect(shouldResetHistoryForUrlProp('https://example.com/search', tracker)).toBe(false);
    expect(shouldResetHistoryForUrlProp('https://example.com/redirect', tracker)).toBe(false);
  });

  it('clears old echoes and bounds memory', () => {
    const tracker = new InternalNavTracker();
    for (let index = 0; index < 40; index += 1) tracker.record(`https://example.com/${index}`);
    expect(shouldResetHistoryForUrlProp('https://example.com/39', tracker)).toBe(false);
    expect(shouldResetHistoryForUrlProp('https://example.com/0', tracker)).toBe(true);
    tracker.clear();
    expect(shouldResetHistoryForUrlProp('https://example.com/38', tracker)).toBe(true);
  });
});
