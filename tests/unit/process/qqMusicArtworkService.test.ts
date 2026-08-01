/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveQqMusicArtworkDataUrl } from '@process/services/QqMusicArtworkService';

const snapshot = {
  appId: 'QQMusic.exe',
  title: '지나갈 테니 (顺其自然) (Been Through)',
  artist: 'EXO (엑소)',
  albumTitle: '',
  isPlaying: true,
  canPlayPause: true,
  canGoNext: true,
  canGoPrevious: true,
  coverUrl: '',
  appIconUrl: '',
  updatedAt: 1,
};

describe('resolveQqMusicArtworkDataUrl', () => {
  it('downloads the exact QQ Music album cover into a renderer-safe data URL', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 0,
            data: {
              song: {
                list: [
                  {
                    songname: snapshot.title,
                    singer: [{ name: snapshot.artist }],
                    albummid: '003UGjMD2pfIlS',
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg' },
        })
      );

    await expect(resolveQqMusicArtworkDataUrl(snapshot, fetchMock)).resolves.toBe('data:image/jpeg;base64,/9j/2Q==');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('c.y.qq.com/soso/fcgi-bin/client_search_cp');
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://y.gtimg.cn/music/photo_new/T002R300x300M000003UGjMD2pfIlS.jpg'
    );
  });

  it('does not send metadata from another media application to QQ Music', async () => {
    const fetchMock = vi.fn<typeof fetch>();

    await expect(
      resolveQqMusicArtworkDataUrl({ ...snapshot, appId: 'Spotify.exe', title: 'Different track' }, fetchMock)
    ).resolves.toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
