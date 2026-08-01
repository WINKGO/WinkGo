/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { WinkGoCapturedNotification, WinkGoMediaSnapshot } from '@/common/adapter/ipcBridge';
import dingTalkLogo from '@/renderer/assets/channel-logos/dingtalk.svg';
import discordLogo from '@/renderer/assets/channel-logos/discord.svg';
import larkLogo from '@/renderer/assets/channel-logos/lark.svg';
import mailLogo from '@/renderer/assets/channel-logos/mail.svg';
import qqLogo from '@/renderer/assets/channel-logos/qq.svg';
import slackLogo from '@/renderer/assets/channel-logos/slack.svg';
import telegramLogo from '@/renderer/assets/channel-logos/telegram.svg';
import wecomLogo from '@/renderer/assets/channel-logos/wecom.svg';
import weixinLogo from '@/renderer/assets/channel-logos/weixin.svg';
import winkGoLogo from '@/renderer/assets/logos/brand/app.png?inline';
import appleMusicLogo from '@/renderer/assets/product-logos/apple-music.svg';
import claudeLogo from '@/renderer/assets/product-logos/claude.png';
import codexLogo from '@/renderer/assets/product-logos/codex.png';
import genericMusicLogo from '@/renderer/assets/product-logos/generic-music.svg';
import kugouMusicLogo from '@/renderer/assets/product-logos/kugou-music.svg';
import neteaseMusicLogo from '@/renderer/assets/product-logos/netease-music.svg';
import qqMusicLogo from '@/renderer/assets/product-logos/qq-music.svg';
import sodaMusicLogo from '@/renderer/assets/product-logos/soda-music.svg';
import spotifyLogo from '@/renderer/assets/product-logos/spotify.svg';
import type { IslandActivity } from '@/renderer/components/layout/Titlebar/islandActivity';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

export const WINK_GO_DISPLAY_NAME = 'WINK GO';
export const WINK_GO_CLI_DISPLAY_NAME = 'WINK GO CLI';
export const WINK_GO_BRAND_ICON = winkGoLogo;

/**
 * The WINK GO asset is imported by the renderer, so Electron resolves it to a
 * `file:` URL in development.  It is the only local asset we intentionally
 * surface as an avatar; caller-provided local paths remain blocked.
 */
export const isWinkGoBrandAsset = (value: string | null | undefined): value is string => value === winkGoLogo;

export const isWinkGoCliAssistant = (assistant: Pick<Assistant, 'source' | 'agent'>): boolean =>
  assistant.source === 'generated' && assistant.agent?.type === 'winkgo_agent';

/**
 * Rebrand legacy product names only when rendering text to the user.
 * Internal runtime identifiers and persisted payloads must remain unchanged.
 */
export const brandLegacyTextForDisplay = (value: string): string =>
  value
    .replace(/\bWinkGoAgent\b/gi, WINK_GO_CLI_DISPLAY_NAME)
    .replace(/\bWinkGo\s*CLI\b/gi, WINK_GO_CLI_DISPLAY_NAME)
    .replace(/\bWinkGo\s+UI\b/gi, WINK_GO_DISPLAY_NAME)
    .replace(/\bWinkGo\b/gi, WINK_GO_DISPLAY_NAME)
    .replace(/\.winkgo_agent\b/gi, '.winkgo');

const brandLocalizedText = (values: Record<string, string> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(values ?? {}).map(([locale, value]) => [locale, brandLegacyTextForDisplay(value)]));

const forceLocalizedBrandName = (
  names: Record<string, string> | undefined,
  displayName: string
): Record<string, string> => Object.fromEntries(Object.keys(names ?? {}).map((locale) => [locale, displayName]));

/**
 * Visual-only branding for the generated built-in assistant.
 * Runtime ids, backend names and persisted data remain untouched.
 */
export const brandAssistantForDisplay = (assistant: Assistant): Assistant => {
  const isGeneratedWinkGoAssistant = isWinkGoCliAssistant(assistant);
  const isBuiltinWinkGoButler = assistant.id.replace(/^builtin-/, '') === 'winkgo-assistant';
  const isWinkGoBrandAssistant = isGeneratedWinkGoAssistant || isBuiltinWinkGoButler;
  const displayName = isGeneratedWinkGoAssistant ? WINK_GO_CLI_DISPLAY_NAME : WINK_GO_DISPLAY_NAME;

  return {
    ...assistant,
    name: isWinkGoBrandAssistant ? displayName : brandLegacyTextForDisplay(assistant.name),
    name_i18n: isWinkGoBrandAssistant
      ? forceLocalizedBrandName(assistant.name_i18n, displayName)
      : brandLocalizedText(assistant.name_i18n),
    description: assistant.description ? brandLegacyTextForDisplay(assistant.description) : assistant.description,
    description_i18n: brandLocalizedText(assistant.description_i18n),
    context: assistant.context ? brandLegacyTextForDisplay(assistant.context) : assistant.context,
    context_i18n: brandLocalizedText(assistant.context_i18n),
    prompts: (assistant.prompts ?? []).map(brandLegacyTextForDisplay),
    prompts_i18n: Object.fromEntries(
      Object.entries(assistant.prompts_i18n ?? {}).map(([locale, prompts]) => [
        locale,
        prompts.map(brandLegacyTextForDisplay),
      ])
    ),
    avatar: isWinkGoBrandAssistant ? winkGoLogo : assistant.avatar,
  };
};

/**
 * Visual-only branding for the internal winkgo_agent management row.
 */
export const brandManagedAgentForDisplay = (agent: ManagedAgent): ManagedAgent => {
  const isInternalWinkGoCli = agent.agent_source === 'internal' && agent.agent_type === 'winkgo_agent';
  const brandedAgent: ManagedAgent = {
    ...agent,
    name: isInternalWinkGoCli ? WINK_GO_CLI_DISPLAY_NAME : brandLegacyTextForDisplay(agent.name),
    ...(agent.name_i18n
      ? {
          name_i18n: isInternalWinkGoCli
            ? forceLocalizedBrandName(agent.name_i18n, WINK_GO_CLI_DISPLAY_NAME)
            : brandLocalizedText(agent.name_i18n),
        }
      : {}),
    ...(agent.description ? { description: brandLegacyTextForDisplay(agent.description) } : {}),
    ...(agent.description_i18n ? { description_i18n: brandLocalizedText(agent.description_i18n) } : {}),
    ...(agent.last_check_error_message
      ? { last_check_error_message: brandLegacyTextForDisplay(agent.last_check_error_message) }
      : {}),
    ...(agent.last_check_guidance ? { last_check_guidance: brandLegacyTextForDisplay(agent.last_check_guidance) } : {}),
    ...(agent.last_check_error_details
      ? {
          last_check_error_details: {
            ...agent.last_check_error_details,
            ...(agent.last_check_error_details.agent_name
              ? { agent_name: brandLegacyTextForDisplay(agent.last_check_error_details.agent_name) }
              : {}),
          },
        }
      : {}),
  };

  return isInternalWinkGoCli
    ? {
        ...brandedAgent,
        icon: winkGoLogo,
        avatar: winkGoLogo,
      }
    : brandedAgent;
};

export const brandAssistantsForDisplay = (assistants: Assistant[]): Assistant[] =>
  assistants.map(brandAssistantForDisplay);

export const brandManagedAgentsForDisplay = (agents: ManagedAgent[]): ManagedAgent[] =>
  agents.map(brandManagedAgentForDisplay);

export type IslandDynamicIdentity = {
  key: string;
  label: string;
  source: string;
  fallbackSource: string;
  kind: 'brand' | 'media-cover' | 'media-app' | 'notification-app' | 'activity-app';
};

type IslandIdentityRule = {
  aliases: string[];
  label: string;
  source: string;
};

const NOTIFICATION_IDENTITY_RULES: IslandIdentityRule[] = [
  { aliases: ['wechat', 'weixin', '微信'], label: '微信', source: weixinLogo },
  { aliases: ['wxwork', 'wecom', '企业微信'], label: '企业微信', source: wecomLogo },
  { aliases: ['dingtalk', '钉钉'], label: '钉钉', source: dingTalkLogo },
  { aliases: ['feishu', 'lark', '飞书'], label: '飞书', source: larkLogo },
  { aliases: ['slack'], label: 'Slack', source: slackLogo },
  { aliases: ['discord'], label: 'Discord', source: discordLogo },
  { aliases: ['telegram'], label: 'Telegram', source: telegramLogo },
  { aliases: ['qq'], label: 'QQ', source: qqLogo },
  { aliases: ['outlook', 'mail', '邮件', '邮箱'], label: '邮件', source: mailLogo },
];

const MEDIA_IDENTITY_RULES: IslandIdentityRule[] = [
  {
    aliases: ['cloudmusic', 'netease', 'music.163', 'com.netease', '网易云'],
    label: '网易云音乐',
    source: neteaseMusicLogo,
  },
  {
    aliases: ['qqmusic', 'qq music', 'tencent.qqmusic', 'com.tencent.qqmusic', 'qq 音乐', 'qq音乐'],
    label: 'QQ音乐',
    source: qqMusicLogo,
  },
  {
    aliases: [
      'sodamusic',
      'soda music',
      'soda',
      'qishui',
      'luna.music',
      'lunamusic',
      'bytedance.music',
      'com.bytedance.music',
      '汽水音乐',
      '汽水',
    ],
    label: '汽水音乐',
    source: sodaMusicLogo,
  },
  { aliases: ['spotify'], label: 'Spotify', source: spotifyLogo },
  { aliases: ['kugou', '酷狗'], label: '酷狗音乐', source: kugouMusicLogo },
  { aliases: ['applemusic', 'apple music'], label: 'Apple Music', source: appleMusicLogo },
];

const resolveIslandIdentityRule = (searchable: string, rules: IslandIdentityRule[]): IslandIdentityRule | undefined => {
  const normalized = searchable.toLocaleLowerCase();
  return rules.find((rule) => rule.aliases.some((alias) => normalized.includes(alias)));
};

const winkGoIslandIdentity = (key = 'winkgo'): IslandDynamicIdentity => ({
  key,
  label: WINK_GO_DISPLAY_NAME,
  source: winkGoLogo,
  fallbackSource: winkGoLogo,
  kind: 'brand',
});

export const resolveNotificationIdentity = (notification: WinkGoCapturedNotification): IslandDynamicIdentity => {
  const rule = resolveIslandIdentityRule(
    `${notification.appName} ${notification.appUserModelId}`,
    NOTIFICATION_IDENTITY_RULES
  );
  if (!rule) {
    return {
      key: `notification:${notification.id}:winkgo`,
      label: notification.appName || WINK_GO_DISPLAY_NAME,
      source: winkGoLogo,
      fallbackSource: winkGoLogo,
      kind: 'brand',
    };
  }
  return {
    key: `notification:${notification.id}:${rule.label}`,
    label: rule.label,
    source: rule.source,
    fallbackSource: winkGoLogo,
    kind: 'notification-app',
  };
};

export const resolveMediaIdentity = (media: WinkGoMediaSnapshot): IslandDynamicIdentity => {
  const rule = resolveIslandIdentityRule(`${media.appId} ${media.title} ${media.albumTitle}`, MEDIA_IDENTITY_RULES);
  const appFallback = rule?.source ?? genericMusicLogo;
  if (media.coverUrl) {
    return {
      key: `media:${media.appId}:${media.title}:${media.artist}`,
      label: media.title,
      source: media.coverUrl,
      fallbackSource: appFallback,
      kind: 'media-cover',
    };
  }
  if (rule) {
    return {
      key: `media:${media.appId}:${rule.label}`,
      label: rule.label,
      source: rule.source,
      fallbackSource: rule.source,
      kind: 'media-app',
    };
  }
  if (media.appIconUrl) {
    return {
      key: `media:${media.appId}:application-icon`,
      label: media.appId || media.title,
      source: media.appIconUrl,
      fallbackSource: genericMusicLogo,
      kind: 'media-app',
    };
  }
  return {
    key: `media:${media.appId}:generic-music`,
    label: media.appId || media.title,
    source: genericMusicLogo,
    fallbackSource: genericMusicLogo,
    kind: 'media-app',
  };
};

export const resolveActivityIdentity = (activity: IslandActivity): IslandDynamicIdentity => {
  if (activity.kind === 'agent' || activity.status === 'success' || activity.status === 'error') {
    return winkGoIslandIdentity(`activity:${activity.id}:winkgo`);
  }
  const searchable = `${activity.source} ${activity.title} ${activity.kind}`;
  const notificationRule = resolveIslandIdentityRule(searchable, NOTIFICATION_IDENTITY_RULES);
  if (notificationRule) {
    return {
      key: `activity:${activity.id}:${notificationRule.label}`,
      label: notificationRule.label,
      source: notificationRule.source,
      fallbackSource: winkGoLogo,
      kind: 'activity-app',
    };
  }
  const mediaRule = resolveIslandIdentityRule(searchable, MEDIA_IDENTITY_RULES);
  if (mediaRule) {
    return {
      key: `activity:${activity.id}:${mediaRule.label}`,
      label: mediaRule.label,
      source: mediaRule.source,
      fallbackSource: winkGoLogo,
      kind: 'activity-app',
    };
  }
  const normalized = searchable.toLocaleLowerCase();
  if (normalized.includes('codex')) {
    return {
      key: `activity:${activity.id}:codex`,
      label: 'Codex',
      source: codexLogo,
      fallbackSource: winkGoLogo,
      kind: 'activity-app',
    };
  }
  if (normalized.includes('claude')) {
    return {
      key: `activity:${activity.id}:claude`,
      label: 'Claude',
      source: claudeLogo,
      fallbackSource: winkGoLogo,
      kind: 'activity-app',
    };
  }
  return {
    key: `activity:${activity.id}:winkgo`,
    label: activity.source || WINK_GO_DISPLAY_NAME,
    source: winkGoLogo,
    fallbackSource: winkGoLogo,
    kind: 'brand',
  };
};

export const resolveIslandDynamicIdentity = ({
  activity,
  media,
  notification,
}: {
  activity: IslandActivity | null;
  media: WinkGoMediaSnapshot | null;
  notification: WinkGoCapturedNotification | null;
}): IslandDynamicIdentity => {
  if (notification) return resolveNotificationIdentity(notification);
  if (media) return resolveMediaIdentity(media);
  if (activity) return resolveActivityIdentity(activity);
  return winkGoIslandIdentity();
};
