/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveRelativePath } from '@/renderer/pages/conversation/Preview/components/renderers/HTMLRenderer';

describe('HTML preview workspace path boundary', () => {
  const workspace = '/home/user/workspace';

  it('allows resources that remain inside the workspace', () => {
    expect(resolveRelativePath(`${workspace}/sub/index.html`, '../img.png', workspace)).toBe(
      `${workspace}/img.png`
    );
  });

  it('blocks relative traversal outside the workspace', () => {
    expect(() => resolveRelativePath(`${workspace}/index.html`, '../../../../etc/passwd', workspace)).toThrow(
      'Path traversal blocked'
    );
  });

  it('blocks absolute paths outside the workspace', () => {
    expect(() => resolveRelativePath(`${workspace}/index.html`, '/etc/passwd', workspace)).toThrow(
      'Path traversal blocked'
    );
  });

  it('normalizes an absolute path before checking the boundary', () => {
    expect(() =>
      resolveRelativePath(`${workspace}/index.html`, `${workspace}/../../secret`, workspace)
    ).toThrow('Path traversal blocked');
    expect(resolveRelativePath(`${workspace}/index.html`, `${workspace}/sub/../img.png`, workspace)).toBe(
      `${workspace}/img.png`
    );
  });

  it('blocks Windows paths outside the workspace case-insensitively', () => {
    const winWorkspace = 'C:/Users/me/workspace';
    expect(resolveRelativePath(`${winWorkspace}/index.html`, 'img.png', 'c:/users/ME/workspace')).toBe(
      `${winWorkspace}/img.png`
    );
    expect(() =>
      resolveRelativePath(`${winWorkspace}/index.html`, '..\\..\\Windows\\system.ini', winWorkspace)
    ).toThrow('Path traversal blocked');
  });

  it('preserves legacy behavior when no workspace boundary is supplied', () => {
    expect(resolveRelativePath(`${workspace}/index.html`, '../../../../etc/passwd')).toBe('/etc/passwd');
  });
});
