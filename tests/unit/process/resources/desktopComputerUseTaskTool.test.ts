/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createRunDesktopTaskHandler } from '@process/resources/builtinMcp/desktopComputerUseTaskTool';

describe('run_desktop_task MCP tool', () => {
  it('delegates one complete goal to the dedicated visual controller', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: true,
      status: { phase: 'completed', stepCount: 3, message: '已在记事本中看到目标文字。' },
    });
    const handler = createRunDesktopTaskHandler(request);

    const result = await handler({ goal: '打开记事本并输入 WINK GO', max_steps: 9 });

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('/winkgo/desktop-computer-use/run', {
      method: 'POST',
      body: JSON.stringify({ goal: '打开记事本并输入 WINK GO', maxSteps: 9 }),
    });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: '已在记事本中看到目标文字。' }]);
    expect(result.structuredContent).toEqual(expect.objectContaining({ ok: true }));
  });

  it('surfaces a truthful terminal failure instead of claiming the task succeeded', async () => {
    const request = vi.fn().mockResolvedValue({
      ok: false,
      status: { phase: 'failed', stepCount: 0, message: '没有可用的视觉模型。' },
    });
    const handler = createRunDesktopTaskHandler(request);

    const result = await handler({ goal: '打开记事本' });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: 'text', text: '没有可用的视觉模型。' });
  });
});
