// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildDisplayMessage } from '@/renderer/utils/file/messageFiles';

describe('buildDisplayMessage', () => {
  const workspace = '/tmp/winkgo/workspace-1';

  it('stores workspace files with workspace prefix', () => {
    const files = [`${workspace}/uploads/photo.jpg`];
    const result = buildDisplayMessage('hello', files, workspace);
    expect(result).toContain(`${workspace}/uploads/photo.jpg`);
  });

  it('preserves nested subdirectories inside workspace with prefix', () => {
    const files = [`${workspace}/uploads/subdir/doc.pdf`];
    const result = buildDisplayMessage('hello', files, workspace);
    expect(result).toContain(`${workspace}/uploads/subdir/doc.pdf`);
  });

  it('keeps absolute paths outside workspace unchanged', () => {
    const files = ['/other/path/external.txt'];
    const result = buildDisplayMessage('hello', files, workspace);
    expect(result).toContain('/other/path/external.txt');
    expect(result).not.toContain(`${workspace}/external.txt`);
  });

  it('converts relative paths into workspace-prefixed paths', () => {
    const files = ['relative/file.txt'];
    const result = buildDisplayMessage('hello', files, workspace);
    expect(result).toContain(`${workspace}/relative/file.txt`);
  });

  it('returns input unchanged when no files', () => {
    const result = buildDisplayMessage('hello', [], workspace);
    expect(result).toBe('hello');
  });

  it('strips WINKGO timestamp separators from filenames while keeping prefix', () => {
    const files = [`${workspace}/uploads/photo_winkgo_1234567890123.jpg`];
    const result = buildDisplayMessage('hello', files, workspace);
    expect(result).toContain(`${workspace}/uploads/photo.jpg`);
  });
});
