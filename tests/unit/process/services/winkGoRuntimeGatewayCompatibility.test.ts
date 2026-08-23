import { describe, expect, it, vi } from 'vitest';

import { loadOptionalWinkGoRuntimeGateways } from '@/process/services/winkGoRuntimeGatewayCompatibility';

describe('WINK GO optional Runtime gateways', () => {
  it('keeps deterministic local tools available when a device gateway route is unavailable', async () => {
    const warning = vi.fn();

    const messages = await loadOptionalWinkGoRuntimeGateways(
      async () => {
        throw new Error('ESP32 小智通道加载返回 HTTP 404。');
      },
      warning
    );

    expect(messages).toEqual([]);
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('ESP32 小智通道加载返回 HTTP 404。')
    );
  });
});
