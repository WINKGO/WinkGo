/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/common/adapter/httpBridge', () => ({ getBaseUrl: () => 'http://127.0.0.1:25808' }));

import { buildFileStreamUrl } from '@/renderer/utils/file/fileUrls';

describe('buildFileStreamUrl', () => {
  it('encodes a project file reference for raw-byte download', () => {
    expect(buildFileStreamUrl({ kind: 'project', pe_id: 'demo', relative_path: '文档/a b.docx' })).toBe(
      'http://127.0.0.1:25808/api/fs/stream?kind=project&pe_id=demo&relative_path=%E6%96%87%E6%A1%A3%2Fa+b.docx'
    );
  });
});
