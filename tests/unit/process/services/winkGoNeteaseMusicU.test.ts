import { describe, expect, it } from 'vitest';
import { normalizeWinkGoNeteaseMusicU } from '@/process/services/WinkGoXiaozhiService';

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
