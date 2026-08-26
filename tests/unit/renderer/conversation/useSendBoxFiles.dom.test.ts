/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { localFileRef } from '@/common/types/chatFile';
import { useSendBoxFiles } from '@/renderer/hooks/chat/useSendBoxFiles';

describe('useSendBoxFiles source identity', () => {
  it('keeps an Electron desktop drop in the local-selection lane', () => {
    const setAtPath = vi.fn();
    const setUploadFile = vi.fn();
    const { result } = renderHook(() => useSendBoxFiles({ atPath: [], uploadFile: [], setAtPath, setUploadFile }));
    const path = String.raw`C:\Users\Administrator\Desktop\plasma one表格.xlsx`;

    act(() => {
      result.current.handleFilesAdded([
        {
          name: 'plasma one表格.xlsx',
          path,
          size: 10,
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          lastModified: 1,
          chatRef: localFileRef(path),
        },
      ]);
    });

    expect(setAtPath).toHaveBeenCalledTimes(1);
    expect(setAtPath).toHaveBeenCalledWith([
      {
        name: 'plasma one表格.xlsx',
        path,
        isFile: true,
        chatRef: localFileRef(path),
      },
    ]);
    expect(setUploadFile).not.toHaveBeenCalled();
  });

  it('keeps a managed paste/upload in the upload lane', () => {
    const setAtPath = vi.fn();
    const setUploadFile = vi.fn();
    const { result } = renderHook(() => useSendBoxFiles({ atPath: [], uploadFile: [], setAtPath, setUploadFile }));

    act(() => {
      result.current.handleFilesAdded([
        {
          name: 'image.png',
          path: 'C:\\managed-uploads\\image.png',
          size: 10,
          type: 'image/png',
          lastModified: 1,
        },
      ]);
    });

    expect(setUploadFile).toHaveBeenCalledTimes(1);
    expect(setAtPath).not.toHaveBeenCalled();
  });
});
