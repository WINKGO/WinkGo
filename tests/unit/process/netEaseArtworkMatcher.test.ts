/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { findNetEaseArtworkUrl } from '@process/services/NetEaseArtworkMatcher';

describe('findNetEaseArtworkUrl', () => {
  it('matches the current NetEase track and returns a display-sized HTTPS cover', () => {
    const rows = [
      {
        jsonStr: JSON.stringify({
          name: 'Runway',
          artists: [{ name: 'ROJO.' }],
          album: { picUrl: 'https://p4.music.126.net/cover.jpg' },
        }),
      },
    ];

    expect(findNetEaseArtworkUrl({ title: 'Runway', artist: 'ROJO.' }, rows)).toBe(
      'https://p4.music.126.net/cover.jpg?param=160y160'
    );
  });

  it('prefers an exact title and artist over a loose title match', () => {
    const rows = [
      {
        jsonStr: JSON.stringify({
          name: '木客行',
          artists: [{ name: '其他歌手' }],
          album: { picUrl: 'https://p1.music.126.net/wrong.jpg' },
        }),
      },
      {
        jsonStr: JSON.stringify({
          name: '木客行（《名将杀》牵丝百戏主题曲）',
          artists: [{ name: '司南' }],
          album: { picUrl: 'https://p2.music.126.net/right.jpg?param=160y160' },
        }),
      },
    ];

    expect(findNetEaseArtworkUrl({ title: '木客行（《名将杀》牵丝百戏主题曲）', artist: '司南' }, rows)).toBe(
      'https://p2.music.126.net/right.jpg?param=160y160'
    );
  });

  it('ignores malformed rows and non-HTTPS artwork', () => {
    expect(
      findNetEaseArtworkUrl({ title: 'Runway', artist: 'ROJO.' }, [
        { jsonStr: '{not json' },
        { jsonStr: { name: 'Runway', coverUrl: 'file:///cover.jpg' } },
      ])
    ).toBe('');
  });

  it('upgrades NetEase album artwork from its trusted HTTP CDN to HTTPS', () => {
    expect(
      findNetEaseArtworkUrl({ title: '华语流行金曲2024', artist: 'Vansdaddy' }, [
        {
          jsonStr: JSON.stringify({
            name: '华语流行金曲2024',
            artists: [{ name: 'Vansdaddy' }, { name: '黄格雷' }],
            album: {
              picUrl: 'http://p3.music.126.net/xAjp85Ag-jSknxUuZKHKLg==/109951170201062473.jpg',
            },
          }),
        },
      ])
    ).toBe('https://p3.music.126.net/xAjp85Ag-jSknxUuZKHKLg==/109951170201062473.jpg?param=160y160');
  });

  it('does not upgrade an untrusted HTTP artwork host', () => {
    expect(
      findNetEaseArtworkUrl({ title: 'Runway', artist: 'ROJO.' }, [
        {
          jsonStr: JSON.stringify({
            name: 'Runway',
            artists: [{ name: 'ROJO.' }],
            album: { picUrl: 'http://example.com/cover.jpg' },
          }),
        },
      ])
    ).toBe('');
  });
});
