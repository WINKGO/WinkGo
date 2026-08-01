/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { findQqMusicArtworkUrl } from '@process/services/QqMusicArtworkMatcher';

describe('findQqMusicArtworkUrl', () => {
  it('selects the exact QQ Music song and constructs its HTTPS album cover', () => {
    const songs = [
      {
        songname: '지나갈 테니 (Been Through) (Live)',
        singer: [{ name: 'EXO (엑소)' }],
        albummid: '004PfE8A4bK6sN',
      },
      {
        songname: '지나갈 테니 (顺其自然) (Been Through)',
        singer: [{ name: 'EXO (엑소)' }],
        albummid: '003UGjMD2pfIlS',
      },
    ];

    expect(
      findQqMusicArtworkUrl(
        {
          title: '지나갈 테니 (顺其自然) (Been Through)',
          artist: 'EXO (엑소)',
        },
        songs
      )
    ).toBe('https://y.gtimg.cn/music/photo_new/T002R300x300M000003UGjMD2pfIlS.jpg');
  });

  it('rejects a loose result and an invalid album identifier', () => {
    expect(
      findQqMusicArtworkUrl({ title: 'Been Through', artist: 'EXO' }, [
        {
          songname: 'Been Through Remix',
          singer: [{ name: 'Someone Else' }],
          albummid: '../bad',
        },
      ])
    ).toBe('');
  });
});
