import { describe, expect, it } from 'vitest';

import { DEFAULT_PET_SIZE, resolvePetSize } from '@/process/pet/petTypes';

describe('desktop pet size defaults', () => {
  it('uses the small size when no preference has been saved', () => {
    expect(DEFAULT_PET_SIZE).toBe(200);
    expect(resolvePetSize(undefined)).toBe(200);
  });

  it('uses the small size for an invalid stored preference', () => {
    expect(resolvePetSize(0)).toBe(200);
    expect(resolvePetSize(500)).toBe(200);
    expect(resolvePetSize('280')).toBe(200);
  });

  it('preserves an existing valid user preference', () => {
    expect(resolvePetSize(200)).toBe(200);
    expect(resolvePetSize(280)).toBe(280);
    expect(resolvePetSize(360)).toBe(360);
  });
});
