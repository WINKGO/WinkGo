import { describe, expect, it } from 'vitest';
import { normalizeRuntimeCommandResult } from '@process/services/winkgoRemote/RuntimeMcpClient';

describe('Runtime MCP command result normalization', () => {
  it('returns the verified spoken summary instead of raw JSON', () => {
    const result = normalizeRuntimeCommandResult({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: true,
            handled: true,
            execution_status: 'completed',
            spoken_summary: '已经打开网易云。',
          }),
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('已经打开网易云。');
  });

  it('does not report a handled Runtime failure as a successful remote command', () => {
    const result = normalizeRuntimeCommandResult({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            handled: true,
            execution_status: 'failed',
            message: '网易云音乐尚未安装。',
          }),
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.text).toBe('网易云音乐尚未安装。');
  });
});
