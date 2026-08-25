import { describe, expect, it } from 'vitest';
import { normalizeWinkGoNeteaseMusicU, normalizeWinkGoQqMusicCookie } from '@/process/services/WinkGoXiaozhiService';

describe('WINK GO NetEase MUSIC_U normalization', () => {
  it('accepts a single MUSIC_U value', () => {
    expect(normalizeWinkGoNeteaseMusicU(`MUSIC_U=${'m'.repeat(64)}`)).toBe('m'.repeat(64));
  });

  it('rejects a complete Cookie', () => {
    expect(() => normalizeWinkGoNeteaseMusicU(`MUSIC_U=${'m'.repeat(64)}; __csrf=secret`)).toThrow(
      'netease_music_u_invalid'
    );
  });

  it('rejects the DEL control character before sending MUSIC_U to the server', () => {
    expect(() => normalizeWinkGoNeteaseMusicU(`${'m'.repeat(64)}\u007f`)).toThrow('netease_music_u_invalid');
  });
});

describe('WINK GO QQ Music Cookie normalization', () => {
  it('keeps only the QQ Music identity and playback keys', () => {
    expect(
      normalizeWinkGoQqMusicCookie(
        `uin=o12345678; qm_keyst=${'k'.repeat(32)}; p_skey=must-not-leave-desktop; unrelated=value`
      )
    ).toBe(`uin=o12345678; qqmusic_uin=12345678; qm_keyst=${'k'.repeat(32)}; qqmusic_key=${'k'.repeat(32)}`);
  });

  it('accepts the QQ Music alias field names', () => {
    expect(normalizeWinkGoQqMusicCookie(`qqmusic_uin=87654321; qqmusic_key=${'z'.repeat(32)}`)).toContain(
      'uin=o87654321'
    );
  });

  it('rejects cookies missing uin or qm_keyst', () => {
    expect(() => normalizeWinkGoQqMusicCookie(`uin=o12345678; p_skey=${'s'.repeat(32)}`)).toThrow(
      'qq_music_cookie_invalid'
    );
  });
});
