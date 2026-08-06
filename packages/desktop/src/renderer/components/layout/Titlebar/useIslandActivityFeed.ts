import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ipcBridge } from '@/common';
import type { WinkGoXiaozhiActivity, WinkGoXiaozhiSnapshot } from '@/common/adapter/ipcBridge';
import {
  normalizeIslandActivities,
  normalizeTurnCompletedActivity,
  sanitizeIslandActivityText,
  selectPrimaryIslandActivity,
  upsertIslandActivities,
  type IslandActivity,
} from './islandActivity';

const TRANSIENT_ACTIVITY_MAX_AGE_MS = 12_000;
const ERROR_ACTIVITY_MAX_AGE_MS = 24_000;
const ATTENTION_ACTIVITY_MAX_AGE_MS = 60_000;
const XIAOZHI_ACTIVITY_MAX_AGE_MS = 5 * 60_000;

const xiaozhiSignature = (snapshot: WinkGoXiaozhiSnapshot): string =>
  [
    snapshot.runtime.ok,
    snapshot.bridge.ok,
    snapshot.remoteGateway.state,
    snapshot.remoteGateway.connected,
    snapshot.remoteGateway.lastError,
  ].join('|');

const normalizeXiaozhiActivity = (snapshot: WinkGoXiaozhiSnapshot): IslandActivity => {
  const timestamp = Date.now();
  const remote = snapshot.remoteGateway;

  if (remote.state === 'error') {
    return {
      id: `xiaozhi:remote:error:${timestamp}`,
      source: '小智 MCP',
      kind: 'system',
      status: 'error',
      title: sanitizeIslandActivityText(remote.lastError, '云端转发连接失败'),
      timestamp,
    };
  }
  if (remote.connecting || remote.state === 'connecting' || remote.state === 'reconnecting') {
    return {
      id: `xiaozhi:remote:connecting:${timestamp}`,
      source: '小智 MCP',
      kind: 'system',
      status: 'running',
      title: remote.state === 'reconnecting' ? '正在重新连接云端转发' : '正在连接云端转发',
      timestamp,
    };
  }
  if (remote.connected) {
    return {
      id: `xiaozhi:remote:connected:${timestamp}`,
      source: '小智 MCP',
      kind: 'system',
      status: 'success',
      title: '云端转发已连接',
      timestamp,
    };
  }
  if (snapshot.runtime.ok && snapshot.bridge.ok) {
    return {
      id: `xiaozhi:local:ready:${timestamp}`,
      source: '小智 MCP',
      kind: 'system',
      status: 'success',
      title: '本机 Runtime 与 LAN Bridge 已就绪',
      timestamp,
    };
  }
  return {
    id: `xiaozhi:local:attention:${timestamp}`,
    source: '小智 MCP',
    kind: 'system',
    status: 'attention',
    title: snapshot.runtime.ok ? 'LAN Bridge 尚未连接' : '本机 Runtime 尚未连接',
    timestamp,
  };
};

const normalizeXiaozhiCommandActivity = (activity: WinkGoXiaozhiActivity): IslandActivity => ({
  id: activity.id,
  source: activity.sourceLabel,
  kind: 'tool',
  status: activity.status,
  title: sanitizeIslandActivityText(activity.command, '硬件控制指令'),
  detail: sanitizeIslandActivityText(
    activity.toolName ? `${activity.message} · ${activity.toolName}` : activity.message,
    activity.message
  ),
  timestamp: activity.updatedAtMs,
});

export const useIslandActivityFeed = (enabled = true) => {
  const [activities, setActivities] = useState<IslandActivity[]>([]);
  const xiaozhiSignatureRef = useRef('');

  const publish = useCallback(
    (activity: IslandActivity) => {
      if (!enabled) return;
      setActivities((current) => upsertIslandActivities(current, [activity]));
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled) {
      setActivities([]);
      return undefined;
    }
    const unsubscribeMessages = ipcBridge.conversation.responseStream.on((message) => {
      const additions = normalizeIslandActivities(message);
      if (additions.length > 0) {
        setActivities((current) => upsertIslandActivities(current, additions));
      }
    });
    const unsubscribeTurns = ipcBridge.conversation.turnCompleted.on((event) => {
      const timestamp = event.last_message.created_at || Date.now();
      setActivities((current) => {
        const completed = current.map((activity) =>
          activity.conversationId === event.session_id &&
          (activity.status === 'running' || activity.status === 'attention')
            ? { ...activity, status: 'success' as const, timestamp }
            : activity
        );
        return upsertIslandActivities(completed, [normalizeTurnCompletedActivity(event)]);
      });
    });
    const unsubscribeXiaozhi = ipcBridge.winkGoXiaozhi.statusChanged.on((snapshot) => {
      const signature = xiaozhiSignature(snapshot);
      if (xiaozhiSignatureRef.current === signature) return;
      xiaozhiSignatureRef.current = signature;
      setActivities((current) => upsertIslandActivities(current, [normalizeXiaozhiActivity(snapshot)]));
    });
    const unsubscribeXiaozhiActivity =
      ipcBridge.winkGoXiaozhi.activityChanged?.on?.((activity) => {
        setActivities((current) => upsertIslandActivities(current, [normalizeXiaozhiCommandActivity(activity)]));
      }) ?? (() => undefined);

    return () => {
      unsubscribeMessages();
      unsubscribeTurns();
      unsubscribeXiaozhi();
      unsubscribeXiaozhiActivity();
    };
  }, [enabled]);

  useEffect(() => {
    if (!activities.some((activity) => activity.status !== 'running')) return undefined;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setActivities((current) => {
        const filtered = current.filter((activity) => {
          const age = now - activity.timestamp;
          if (activity.id.startsWith('xiaozhi-command:')) return age < XIAOZHI_ACTIVITY_MAX_AGE_MS;
          if (activity.status === 'success') return age < TRANSIENT_ACTIVITY_MAX_AGE_MS;
          if (activity.status === 'error') return age < ERROR_ACTIVITY_MAX_AGE_MS;
          if (activity.status === 'attention') return age < ATTENTION_ACTIVITY_MAX_AGE_MS;
          return true;
        });
        return filtered.length === current.length ? current : filtered;
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [activities]);

  const primaryActivity = useMemo(() => selectPrimaryIslandActivity(activities), [activities]);

  return {
    activities,
    primaryActivity,
    publish,
  };
};
