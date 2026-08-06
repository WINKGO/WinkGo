import { describe, expect, it } from 'vitest';
import { WinkGoXiaozhiActivityParser } from '@/process/services/WinkGoXiaozhiActivityService';

describe('WINK GO ESP32 activity parser', () => {
  it('tracks a hardware command from the original utterance to the real Runtime tool result', () => {
    const parser = new WinkGoXiaozhiActivityParser();
    const started = parser.feed(
      "[2026-08-05 21:44:31] INFO [sparkbot.plugin_manager] 调用工具: tools.run_skill_command, 参数: {'command': '打开网易云', 'source': 'xiaozhi_hardware'}"
    );
    const routed = parser.feed(
      "[2026-08-05 21:44:31] INFO [sparkbot.plugin_manager] 调用工具: music.station_open, 参数: {'player': 'cloud'}"
    );
    const completed = parser.feed(
      '[2026-08-05 21:44:39] INFO [sparkbot.plugin_manager] 工具 [tools.run_skill_command] 执行成功 (7452ms)'
    );

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      source: 'xiaozhi_hardware',
      sourceLabel: 'ESP32 小智',
      command: '打开网易云',
      status: 'running',
    });
    expect(routed[0]).toMatchObject({ toolName: 'music.station_open', status: 'running' });
    expect(completed[0]).toMatchObject({
      id: started[0].id,
      toolName: 'music.station_open',
      status: 'success',
      elapsedMs: 7452,
    });
  });

  it('reports Runtime failures without leaking credentials and ignores unrelated callers', () => {
    const parser = new WinkGoXiaozhiActivityParser();
    expect(
      parser.feed(
        "[2026-08-05 21:44:31] INFO [sparkbot.plugin_manager] 调用工具: tools.run_skill_command, 参数: {'command': '打开网易云', 'source': 'desktop_test'}"
      )
    ).toEqual([]);

    parser.feed(
      "[2026-08-05 21:44:31] INFO [sparkbot.plugin_manager] 调用工具: tools.run_skill_command, 参数: {'command': '打开微信', 'source': 'xiaozhi_hardware'}"
    );
    const failed = parser.feed(
      '[2026-08-05 21:44:32] ERROR [sparkbot.plugin_manager] 工具 [tools.run_skill_command] 执行失败 (9ms): token=secret Skill package root does not exist'
    );

    expect(failed[0].status).toBe('error');
    expect(failed[0].message).toContain('[已隐藏]');
    expect(failed[0].message).not.toContain('secret');
  });
});
