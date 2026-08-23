/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { localFileRef } from '@/common/types/chatFile';
import { FileService } from '@/renderer/services/FileService';

const asFileList = (files: File[]): FileList =>
  Object.assign(files, {
    item: (index: number) => files[index] ?? null,
  }) as unknown as FileList;

describe('FileService.processDroppedFiles', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses Electron webUtils to resolve a Windows desktop file path', async () => {
    const getPathForFile = vi.fn(() => 'C:\\Users\\Administrator\\Desktop\\photo.png');
    vi.stubGlobal('window', { electronAPI: { getPathForFile } });
    const file = new File(['image'], 'photo.png', { type: 'image/png', lastModified: 123 });

    const result = await FileService.processDroppedFiles(asFileList([file]));

    expect(getPathForFile).toHaveBeenCalledWith(file);
    expect(result).toEqual([
      expect.objectContaining({
        name: 'photo.png',
        path: 'C:\\Users\\Administrator\\Desktop\\photo.png',
        chatRef: localFileRef('C:\\Users\\Administrator\\Desktop\\photo.png'),
      }),
    ]);
  });
});
