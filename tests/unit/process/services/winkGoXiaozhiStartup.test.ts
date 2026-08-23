import { describe, expect, it, vi } from 'vitest';
import { startWinkGoXiaozhiAtLaunch } from '@/process/bridge/winkgo/xiaozhiBridge';
import { normalizeWinkGoNeteaseMusicU } from '@/process/services/WinkGoXiaozhiService';

describe('WINK GO XiaoZhi desktop startup', () => {
  it('starts and upgrades the local Runtime when the signed-in account has XiaoZhi access', async () => {
    const startRuntime = vi.fn(async () => undefined);

    const started = await startWinkGoXiaozhiAtLaunch({
      hasUsableSession: true,
      hasXiaozhiCapability: true,
      startRuntime,
    });

    expect(started).toBe(true);
    expect(startRuntime).toHaveBeenCalledOnce();
  });

  it('does not start the local Runtime when XiaoZhi access is unavailable', async () => {
    const startRuntime = vi.fn(async () => undefined);

    const started = await startWinkGoXiaozhiAtLaunch({
      hasUsableSession: true,
      hasXiaozhiCapability: false,
      startRuntime,
    });

    expect(started).toBe(false);
    expect(startRuntime).not.toHaveBeenCalled();
  });

  it('accepts only one MUSIC_U value and rejects a complete Cookie', () => {
    expect(normalizeWinkGoNeteaseMusicU(`MUSIC_U=${'m'.repeat(64)}`)).toBe('m'.repeat(64));
    expect(() => normalizeWinkGoNeteaseMusicU(`MUSIC_U=${'m'.repeat(64)}; __csrf=secret`)).toThrow(
      'netease_music_u_invalid'
    );
  });
});
