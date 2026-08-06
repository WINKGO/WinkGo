// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { localFileRef, projectFileRef, uploadFileRef } from '@/common/types/chatFile';
import { collectChatFileRefs, splitChatFileRefs } from '@/renderer/utils/file/messageFiles';

describe('collectChatFileRefs', () => {
  it('collects uploaded paths as upload references', () => {
    expect(collectChatFileRefs(['/uploads/photo.jpg'], [])).toEqual([uploadFileRef('/uploads/photo.jpg')]);
  });

  it('preserves a Windows backend-local reference verbatim', () => {
    const path = String.raw`\\?\C:\workspace\src\main.ts`;
    expect(
      collectChatFileRefs(
        [],
        [
          {
            path,
            name: 'main.ts',
            isFile: true,
            chatRef: localFileRef(path),
          },
        ]
      )
    ).toEqual([localFileRef(path)]);
  });

  it('preserves a project-scoped reference from Explorer', () => {
    const ref = projectFileRef('pe-1', 'src/main.ts');
    expect(
      collectChatFileRefs(
        [],
        [
          {
            path: 'src/main.ts',
            name: 'main.ts',
            isFile: true,
            chatRef: ref,
          },
        ]
      )
    ).toEqual([ref]);
  });

  it('deduplicates identical references without merging different sources', () => {
    const path = '/uploads/a.txt';
    expect(collectChatFileRefs([path, path], [{ path, name: 'a.txt', isFile: true }])).toEqual([uploadFileRef(path)]);
    expect(collectChatFileRefs([path], [{ path, name: 'a.txt', isFile: true, chatRef: localFileRef(path) }])).toEqual([
      uploadFileRef(path),
      localFileRef(path),
    ]);
  });
});

describe('splitChatFileRefs', () => {
  it('restores uploads to the upload lane', () => {
    expect(splitChatFileRefs([uploadFileRef('/uploads/a.txt')])).toEqual({
      uploadFiles: ['/uploads/a.txt'],
      atPath: [],
    });
  });

  it('restores project and local references to the selection lane', () => {
    const project = projectFileRef('pe-1', 'src/main.ts');
    const local = localFileRef(String.raw`C:\workspace\README.md`);
    const result = splitChatFileRefs([project, local]);

    expect(result.uploadFiles).toEqual([]);
    expect(result.atPath).toEqual([
      {
        path: 'src/main.ts',
        name: 'main.ts',
        isFile: true,
        chatRef: project,
      },
      {
        path: String.raw`C:\workspace\README.md`,
        name: 'README.md',
        isFile: true,
        chatRef: local,
      },
    ]);
  });

  it('returns empty lanes for an empty queue', () => {
    expect(splitChatFileRefs([])).toEqual({ uploadFiles: [], atPath: [] });
  });
});
