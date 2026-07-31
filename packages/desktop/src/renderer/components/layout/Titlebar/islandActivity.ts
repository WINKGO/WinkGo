import type { IConversationTurnCompletedEvent, IResponseMessage } from '@/common/adapter/ipcBridge';

export type IslandActivityStatus = 'running' | 'success' | 'error' | 'attention';
export type IslandActivityKind = 'tool' | 'permission' | 'agent' | 'system';

export interface IslandActivity {
  id: string;
  conversationId?: string;
  source: string;
  kind: IslandActivityKind;
  status: IslandActivityStatus;
  title: string;
  detail?: string;
  timestamp: number;
}

// The floating island scrolls overflow text, so keep enough of the original
// status to make long MCP and Agent messages understandable.  Tool arguments
// are still excluded below and secrets/local paths remain redacted.
const MAX_ACTIVITY_TEXT_CHARS = 220;
const SECRET_MARKERS = ['token=', 'token:', 'api_key=', 'api-key:', 'password=', 'bearer '];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stringValue = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Keep island copy compact and privacy-safe. Tool arguments, command bodies and
 * absolute paths never enter the island activity model.
 */
export const sanitizeIslandActivityText = (value: unknown, fallback = ''): string => {
  const compact = stringValue(value)
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = compact.toLocaleLowerCase();

  if (!compact || SECRET_MARKERS.some((marker) => lower.includes(marker))) {
    return fallback;
  }

  // Avoid showing local file locations in the titlebar. The chat transcript
  // remains the source of truth for detailed tool output.
  const withoutPaths = compact
    .replace(/[a-zA-Z]:[\\/](?:[^\\/\s]+[\\/])*[^\\/\s]*/g, '本地文件')
    .replace(/(?:^|\s)\/(?:[^/\s]+\/)+[^/\s]*/g, ' 本地文件');
  return [...withoutPaths].slice(0, MAX_ACTIVITY_TEXT_CHARS).join('').trim() || fallback;
};

const normalizeStatus = (value: unknown, hasError = false): IslandActivityStatus => {
  if (hasError) return 'error';
  switch (stringValue(value).toLocaleLowerCase()) {
    case 'ok':
    case 'success':
    case 'completed':
    case 'complete':
    case 'finish':
    case 'finished':
      return 'success';
    case 'error':
    case 'failed':
    case 'failure':
      return 'error';
    case 'confirming':
    case 'pending_confirmation':
      return 'attention';
    default:
      return 'running';
  }
};

const resolveSource = (value: unknown): string => {
  const normalized = stringValue(value).toLocaleLowerCase();
  if (normalized.includes('wechat') || normalized.includes('weixin')) return '微信';
  if (
    normalized.includes('qqmusic') ||
    normalized.includes('qq_music') ||
    normalized.includes('tencent.qqmusic') ||
    normalized.includes('com.tencent.qqmusic')
  )
    return 'QQ音乐';
  if (
    normalized.includes('soda_music') ||
    normalized.includes('sodamusic') ||
    normalized.includes('qishui') ||
    normalized.includes('luna.music') ||
    normalized.includes('lunamusic') ||
    normalized.includes('bytedance.music') ||
    normalized.includes('com.bytedance.music')
  )
    return '汽水音乐';
  if (
    normalized.includes('netease') ||
    normalized.includes('cloudmusic') ||
    normalized.includes('music.163') ||
    normalized.includes('com.netease')
  )
    return '网易云音乐';
  // The legacy native `music.*` route belongs to the built-in NetEase
  // integration. New multi-provider routes include an explicit provider hint.
  if (normalized.startsWith('music.')) return '网易云音乐';
  if (normalized.includes('bilibili') || normalized.includes('哔哩哔哩')) return '哔哩哔哩';
  if (normalized.includes('iqiyi') || normalized.includes('爱奇艺')) return '爱奇艺';
  if (normalized.includes('youku') || normalized.includes('优酷')) return '优酷';
  if (normalized.includes('tencent_video') || normalized.includes('腾讯视频')) return '腾讯视频';
  if (normalized.includes('doubao') || normalized.includes('豆包')) return '豆包';
  if (normalized.includes('claude')) return 'Claude Code';
  if (normalized.includes('codex')) return 'Codex';
  if (normalized.includes('openclaw')) return 'OpenClaw';
  if (normalized.includes('hermes')) return 'Hermes';
  if (normalized.includes('qclaw')) return 'QClaw';
  if (normalized.includes('workbuddy')) return 'WorkBuddy';
  if (normalized.includes('kiro')) return 'Kiro';
  if (normalized.includes('qoder')) return 'Qoder';
  if (normalized.includes('trae')) return 'Trae';
  if (normalized.includes('vscode') || normalized.includes('visual_studio_code')) return 'VS Code';
  if (normalized.includes('smart_home') || normalized.includes('home_assistant')) return '智能家居';
  if (normalized.includes('browser') || normalized.includes('web_automation')) return '网页自动化';
  if (normalized.includes('mcp')) return 'MCP';
  if (normalized.includes('format') || normalized.includes('convert')) return '格式台';
  if (normalized.includes('file') || normalized.includes('folder') || normalized.includes('organize'))
    return '文件收纳盒';
  return 'WINK GO';
};

export const friendlyIslandToolName = (value: unknown): string => {
  const original = sanitizeIslandActivityText(value, '本地任务');
  const normalized = original.toLocaleLowerCase();
  const source = resolveSource(original);
  const service = /^(?:WINK GO|WINK GO)$/i.test(source) ? '' : source;
  const action =
    normalized.includes('search') && normalized.includes('play')
      ? '搜索播放'
      : normalized.includes('screenshot') || normalized.includes('capture')
        ? '截取画面'
        : normalized.includes('click') || normalized.includes('tap')
          ? '点击操作'
          : normalized.includes('navigate') || normalized.includes('browse')
            ? '浏览网页'
            : normalized.includes('send') && (normalized.includes('message') || normalized.includes('wechat'))
              ? '发送消息'
              : normalized.includes('download')
                ? '下载文件'
                : normalized.includes('upload')
                  ? '上传文件'
                  : normalized.includes('compress')
                    ? '压缩文件'
                    : normalized.includes('convert') || normalized.includes('format')
                      ? '转换格式'
                      : normalized.includes('organize') || normalized.includes('classify')
                        ? '整理文件'
                        : normalized.includes('install') || normalized.includes('import')
                          ? '导入能力'
                          : normalized.includes('connect')
                            ? '连接服务'
                            : normalized.includes('next')
                              ? '下一首'
                              : normalized.includes('previous') || normalized.includes('prev')
                                ? '上一首'
                                : normalized.includes('pause')
                                  ? '暂停'
                                  : normalized.includes('resume') || normalized.includes('play')
                                    ? '播放'
                                    : normalized.includes('volume')
                                      ? '调节音量'
                                      : normalized.includes('edit') ||
                                          normalized.includes('write') ||
                                          normalized.includes('replace')
                                        ? '修改文件'
                                        : normalized.includes('read') || normalized.includes('view')
                                          ? '读取内容'
                                          : normalized.includes('exec') ||
                                              normalized.includes('command') ||
                                              normalized.includes('terminal')
                                            ? '运行命令'
                                            : normalized.includes('search') || normalized.includes('query')
                                              ? '查询'
                                              : normalized.includes('open') || normalized.includes('start')
                                                ? '打开'
                                                : normalized.includes('close') || normalized.includes('stop')
                                                  ? '关闭'
                                                  : normalized.includes('create') || normalized.includes('new')
                                                    ? '创建内容'
                                                    : normalized.includes('analyze') || normalized.includes('inspect')
                                                      ? '分析内容'
                                                      : normalized.includes('device') || normalized.includes('scene')
                                                        ? '控制设备'
                                                        : '';

  if (service && action) return `${service}${action}`;
  if (service && original === '本地任务') return service;
  if (action) return action;
  return original;
};

const activityId = (prefix: string, message: IResponseMessage, suffix: unknown): string =>
  `${prefix}:${message.conversation_id}:${sanitizeIslandActivityText(suffix, message.msg_id || 'event')}`;

const normalizeToolCall = (message: IResponseMessage, data: Record<string, unknown>): IslandActivity => {
  const rawName = data.name ?? data.description;
  const status = normalizeStatus(data.status ?? message.status, Boolean(data.error));
  const title = friendlyIslandToolName(rawName);
  const detail = sanitizeIslandActivityText(data.description);

  return {
    id: activityId('tool', message, data.call_id ?? rawName),
    conversationId: message.conversation_id,
    source: resolveSource(rawName),
    kind: 'tool',
    status,
    title,
    ...(detail && detail !== title ? { detail } : {}),
    timestamp: message.created_at ?? Date.now(),
  };
};

const normalizeToolGroup = (message: IResponseMessage, value: unknown): IslandActivity[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [
      normalizeToolCall(message, {
        call_id: item.call_id,
        name: item.name,
        description: item.description,
        status: item.status,
        error: stringValue(item.status).toLocaleLowerCase() === 'error' ? 'error' : undefined,
      }),
    ];
  });
};

const normalizeAcpToolCall = (message: IResponseMessage, value: unknown): IslandActivity[] => {
  if (!isRecord(value) || !isRecord(value.update)) return [];
  const update = value.update;
  const rawTitle = update.title ?? update.kind;
  const status = normalizeStatus(update.status);
  const title = sanitizeIslandActivityText(rawTitle, friendlyIslandToolName(update.kind));

  return [
    {
      id: activityId('acp-tool', message, update.tool_call_id ?? rawTitle),
      conversationId: message.conversation_id,
      source: resolveSource(rawTitle),
      kind: 'tool',
      status,
      title,
      timestamp: message.created_at ?? Date.now(),
    },
  ];
};

const normalizePermission = (message: IResponseMessage, value: unknown): IslandActivity[] => {
  if (!isRecord(value)) return [];
  const toolCall = isRecord(value.tool_call) ? value.tool_call : undefined;
  const title = sanitizeIslandActivityText(
    value.title ??
      value.description ??
      toolCall?.title ??
      (isRecord(toolCall?.raw_input) ? toolCall.raw_input.description : ''),
    '等待授权'
  );

  return [
    {
      id: activityId('permission', message, value.call_id ?? toolCall?.tool_call_id ?? message.msg_id),
      conversationId: message.conversation_id,
      source: resolveSource(title),
      kind: 'permission',
      status: 'attention',
      title,
      detail: '需要你的确认',
      timestamp: message.created_at ?? Date.now(),
    },
  ];
};

export const normalizeIslandActivities = (message: IResponseMessage): IslandActivity[] => {
  switch (message.type) {
    case 'tool_call':
      return isRecord(message.data) ? [normalizeToolCall(message, message.data)] : [];
    case 'tool_group':
      return normalizeToolGroup(message, message.data);
    case 'acp_tool_call':
      return normalizeAcpToolCall(message, message.data);
    case 'permission':
    case 'acp_permission':
      return normalizePermission(message, message.data);
    case 'error':
      return [
        {
          id: activityId('agent-error', message, message.msg_id),
          conversationId: message.conversation_id,
          source: 'WINK GO',
          kind: 'agent',
          status: 'error',
          title: '任务执行失败',
          timestamp: message.created_at ?? Date.now(),
        },
      ];
    case 'tips': {
      if (!isRecord(message.data) || message.data.type !== 'error') return [];
      return [
        {
          id: activityId('agent-tip', message, message.msg_id),
          conversationId: message.conversation_id,
          source: 'WINK GO',
          kind: 'agent',
          status: 'error',
          title: sanitizeIslandActivityText(message.data.content, '任务执行失败'),
          timestamp: message.created_at ?? Date.now(),
        },
      ];
    }
    default:
      return [];
  }
};

export const normalizeTurnCompletedActivity = (event: IConversationTurnCompletedEvent): IslandActivity => {
  const failed = event.state === 'error';
  const source = sanitizeIslandActivityText(event.model.name || event.model.platform, 'WINK GO');
  return {
    id: `turn:${event.session_id}:${event.turn_id}`,
    conversationId: event.session_id,
    source,
    kind: 'agent',
    status: failed ? 'error' : 'success',
    title: failed ? '任务执行失败' : '任务已完成',
    detail: sanitizeIslandActivityText(event.detail),
    timestamp: event.last_message.created_at || Date.now(),
  };
};

export const upsertIslandActivities = (
  current: IslandActivity[],
  additions: IslandActivity[],
  limit = 12
): IslandActivity[] => {
  const byId = new Map(current.map((activity) => [activity.id, activity]));
  for (const activity of additions) {
    const previous = byId.get(activity.id);
    byId.set(activity.id, previous ? { ...previous, ...activity } : activity);
  }
  return [...byId.values()].toSorted((left, right) => right.timestamp - left.timestamp).slice(0, limit);
};

export const selectPrimaryIslandActivity = (activities: IslandActivity[]): IslandActivity | null => {
  const priority: Record<IslandActivityStatus, number> = {
    attention: 4,
    error: 3,
    running: 2,
    success: 1,
  };
  return (
    [...activities].toSorted((left, right) => {
      const byStatus = priority[right.status] - priority[left.status];
      return byStatus || right.timestamp - left.timestamp;
    })[0] ?? null
  );
};
