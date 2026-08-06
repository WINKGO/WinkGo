/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WinkGoLyricsService } from '@process/services/media-lyrics/LyricsService';
import { findLyricsCandidate, parseLrc } from '@process/services/media-lyrics/lyricParser';
import { parseSodaTimedLyrics, querySodaLocalLyrics } from '@process/services/media-lyrics/sodaLocalProvider';

const jsonResponse = (payload: unknown): Response =>
  ({
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
  }) as unknown as Response;

describe('WinkGoLyricsService', () => {
  it('parses multiple LRC timestamps, translations, and millisecond fractions', () => {
    expect(parseLrc('[00:01.20][00:03.250]第一句\n[00:05]第二句', '[00:01.20]First line\n[00:05]Second line')).toEqual([
      { timeMs: 1_200, text: '第一句', translation: 'First line' },
      { timeMs: 3_250, text: '第一句' },
      { timeMs: 5_000, text: '第二句', translation: 'Second line' },
    ]);
  });

  it('filters production credits so synchronized playback starts with actual sung lyrics', () => {
    expect(
      parseLrc(
        [
          '[00:00.00] 作词 : 刘昊霖/赵大白',
          '[00:01.20] 曲 : 阿书Veson',
          '[00:02.41] 曲Composer：刘昊霖',
          '[00:02.57] 编曲/吉他Arranger/Guitar：谭侃侃',
          '[00:06.38] 人声录音棚Vocal Recording Studio：好乐无荒录音棚（长沙）',
          '[00:07.41] OP/SP：好乐无荒',
          '[00:17.89] 都怪我 坏了你的心情',
          '[00:25.07] 怪我 还舍不得离开',
        ].join('\n')
      )
    ).toEqual([
      { timeMs: 17_890, text: '都怪我 坏了你的心情' },
      { timeMs: 25_070, text: '怪我 还舍不得离开' },
    ]);
  });

  it('parses the word-timed lyric format stored by Soda Music', () => {
    expect(
      parseSodaTimedLyrics(
        [
          '[2470,4370]<0,210,0>浪<210,200,0>漫<600,290,0>没<890,160,0>天<1050,200,0>份£krc',
          '[2470,4370]<0,210,0>浪<210,200,0>漫<600,290,0>没<890,160,0>天<1050,200,0>份',
          '[7350,3730]<0,290,0>不<290,260,0>够<550,300,0>谨<850,320,0>慎',
        ].join('\n')
      )
    ).toEqual([
      { timeMs: 2_470, text: '浪漫没天份' },
      { timeMs: 7_350, text: '不够谨慎' },
    ]);
  });

  it('reads synchronized lyrics from the installed Soda Music local cache', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'winkgo-soda-lyrics-'));
    const cachePath = path.join(directory, 'entries.db');
    try {
      await writeFile(
        cachePath,
        Buffer.from(
          [
            'binary-prefix 等我官宣一定要用这首歌（只对你有感觉） 鹅大王',
            'contenthide_request_lyricstypelyric',
            '[2470,4370]<0,210,0>浪<210,200,0>漫<600,290,0>没<890,160,0>天<1050,200,0>份',
            '[7350,3730]<0,290,0>不<290,260,0>够<550,300,0>谨<850,320,0>慎',
          ].join('\n'),
          'utf8'
        )
      );

      await expect(
        querySodaLocalLyrics(
          {
            appId: 'SodaMusic.exe',
            title: '等我官宣一定要用这首歌（只对你有感觉）',
            artist: '鹅大王',
            albumTitle: '无尽雨季',
          },
          fetch,
          cachePath
        )
      ).resolves.toEqual({
        source: 'qishui',
        lines: [
          { timeMs: 2_470, text: '浪漫没天份' },
          { timeMs: 7_350, text: '不够谨慎' },
        ],
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rejects a similar title when the artist does not match', () => {
    expect(
      findLyricsCandidate({ title: '同名歌曲', artist: '正确歌手' }, [
        { id: 'wrong', title: '同名歌曲', artists: ['另一位歌手'] },
      ])
    ).toBeNull();
  });

  it('matches a bilingual player artist label to the catalogue artist alias', () => {
    expect(
      findLyricsCandidate({ title: '冰山', artist: '邱锋泽 Feng Ze' }, [
        { id: 'netease-iceberg', title: '冰山', artists: ['邱锋泽'] },
      ])
    ).toEqual({ id: 'netease-iceberg', title: '冰山', artists: ['邱锋泽'] });
  });

  it('rejects another recording version even when its normalized title looks identical', () => {
    expect(
      findLyricsCandidate({ title: '都怪我', artist: '黄建威' }, [
        { id: 'live', title: '都怪我 (Live)', artists: ['黄建威'] },
      ])
    ).toBeNull();
  });

  it('returns synchronized lyrics for a strictly matched NetEase result', async () => {
    const fetchImpl = vi.fn((url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('/api/cloudsearch/pc')) {
        return Promise.resolve(
          jsonResponse({
            result: {
              songs: [{ id: 42, name: '测试歌曲', artists: [{ name: '测试歌手' }] }],
            },
          })
        );
      }
      return Promise.resolve(
        jsonResponse({
          lrc: { lyric: '[00:01.00]第一句\n[00:08.50]第二句' },
          tlyric: { lyric: '[00:01.00]First line' },
        })
      );
    }) as unknown as typeof fetch;
    const service = new WinkGoLyricsService(fetchImpl);

    const result = await service.getLyrics({
      appId: 'cloudmusic.exe',
      title: '测试歌曲',
      artist: '测试歌手',
      albumTitle: '测试专辑',
    });

    expect(result.status).toBe('ok');
    expect(result.source).toBe('netease');
    expect(result.lines).toEqual([
      { timeMs: 1_000, text: '第一句', translation: 'First line' },
      { timeMs: 8_500, text: '第二句' },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('client_search_cp'))).toBe(false);
  });

  it('locks QQ Music to the QQ catalogue instead of querying NetEase', async () => {
    const fetchImpl = vi.fn((url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('client_search_cp')) {
        return Promise.resolve(
          jsonResponse({
            data: {
              song: {
                list: [{ songmid: 'qq-42', songname: '测试歌曲', singer: [{ name: '测试歌手' }] }],
              },
            },
          })
        );
      }
      return Promise.resolve(jsonResponse({ lyric: '[00:01.00]QQ 歌词', trans: '' }));
    }) as unknown as typeof fetch;
    const service = new WinkGoLyricsService(fetchImpl);

    const result = await service.getLyrics({
      appId: 'QQMusic.exe',
      title: '测试歌曲',
      artist: '测试歌手',
      albumTitle: '',
    });

    expect(result.status).toBe('ok');
    expect(result.source).toBe('qqmusic');
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('music.163.com'))).toBe(false);
  });

  it('never queries another catalogue when Soda local lyrics are unavailable', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse({}))) as unknown as typeof fetch;
    const service = new WinkGoLyricsService(fetchImpl);

    const result = await service.getLyrics({
      appId: 'SodaMusic!WinkGoSynthetic',
      title: '未写入本地缓存的歌曲',
      artist: '汽水歌手',
      albumTitle: '',
    });

    expect(result.status).toBe('not_found');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns not_found instead of displaying lyrics from an unrelated search result', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          result: { songs: [{ id: 99, name: '同名歌曲', artists: [{ name: '错误歌手' }] }] },
          data: { song: { list: [] } },
        })
      )
    ) as unknown as typeof fetch;
    const service = new WinkGoLyricsService(fetchImpl);

    const result = await service.getLyrics({
      appId: 'MediaPlayer.exe',
      title: '同名歌曲',
      artist: '正确歌手',
      albumTitle: '',
    });

    expect(result.status).toBe('not_found');
    expect(result.lines).toEqual([]);
  });
});
