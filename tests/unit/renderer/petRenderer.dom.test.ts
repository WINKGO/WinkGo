/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('desktop pet renderer', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<img id="pet" alt="" />';
    Object.defineProperty(window, 'petAPI', {
      configurable: true,
      value: {
        onStateChange: vi.fn(),
        onEyeMove: vi.fn(),
      },
    });
  });

  it('keeps every pet state centered at the compact display scale', async () => {
    await import('@/renderer/pet/petRenderer');

    const pet = document.getElementById('pet') as HTMLImageElement;
    expect(pet.style.width).toBe('72%');
    expect(pet.style.height).toBe('72%');
    expect(pet.style.inset).toBe('14%');
  });
});
