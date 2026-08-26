import { describe, expect, it } from 'vitest';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import {
  friendlyIslandToolName,
  normalizeIslandActivities,
  sanitizeIslandActivityText,
  selectPrimaryIslandActivity,
  upsertIslandActivities,
  type IslandActivity,
} from '@renderer/components/layout/Titlebar/islandActivity';

const message = (type: string, data: unknown): IResponseMessage => ({
  type,
  data,
  msg_id: 'message-1',
  conversation_id: 'conversation-1',
  created_at: 100,
});

describe('islandActivity', () => {
  it('turns native and ACP tool calls into bounded activity summaries', () => {
    const nativeActivity = normalizeIslandActivities(
      message('tool_call', {
        call_id: 'native-1',
        name: 'music.search_and_play',
        status: 'running',
      })
    );
    const acpActivity = normalizeIslandActivities(
      message('acp_tool_call', {
        update: {
          tool_call_id: 'acp-1',
          status: 'completed',
          title: '读取项目文件',
          kind: 'read',
        },
      })
    );

    expect(nativeActivity[0]).toMatchObject({
      source: '网易云音乐',
      status: 'running',
      title: '网易云音乐搜索播放',
    });
    expect(acpActivity[0]).toMatchObject({
      status: 'success',
      title: '读取项目文件',
    });
  });

  it('does not expose credentials or absolute local paths', () => {
    expect(sanitizeIslandActivityText('token=very-secret', 'safe')).toBe('safe');
    expect(sanitizeIslandActivityText('正在读取 C:\\Users\\Administrator\\secret.txt')).toBe('正在读取 本地文件');
  });

  it('uses attention and error states ahead of normal activity', () => {
    const activities: IslandActivity[] = [
      {
        id: 'running',
        source: 'Codex',
        kind: 'tool',
        status: 'running',
        title: '运行命令',
        timestamp: 3,
      },
      {
        id: 'permission',
        source: 'Codex',
        kind: 'permission',
        status: 'attention',
        title: '等待授权',
        timestamp: 1,
      },
    ];
    expect(selectPrimaryIslandActivity(activities)?.id).toBe('permission');
  });

  it('updates an existing tool lifecycle instead of growing an unbounded list', () => {
    const running: IslandActivity = {
      id: 'tool-1',
      source: 'WINK GO',
      kind: 'tool',
      status: 'running',
      title: friendlyIslandToolName('exec_command'),
      timestamp: 1,
    };
    const completed: IslandActivity = { ...running, status: 'success', timestamp: 2 };

    expect(upsertIslandActivities([running], [completed])).toEqual([completed]);
  });

  it('labels additional WINK GO tools with their real product and action', () => {
    expect(friendlyIslandToolName('wechat.send_message')).toBe('微信发送消息');
    expect(friendlyIslandToolName('web_automation.screenshot')).toBe('网页自动化截取画面');
    expect(friendlyIslandToolName('smart_home.control_device')).toBe('智能家居控制设备');
    expect(friendlyIslandToolName('winkgo.format.convert_document')).toBe('格式台转换格式');
    expect(friendlyIslandToolName('visual_studio_code.open_file')).toBe('打开');
  });
});
