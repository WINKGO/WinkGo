/**
 * @license
 * Copyright 2025 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import {
  brandAssistantForDisplay,
  brandLegacyTextForDisplay,
  brandManagedAgentForDisplay,
  WINK_GO_BRAND_ICON,
  resolveIslandDynamicIdentity,
  resolveMediaIdentity,
  resolveNotificationIdentity,
  WINK_GO_CLI_DISPLAY_NAME,
} from '@/renderer/utils/model/winkGoBranding';

describe('WINK GO visible branding', () => {
  it('keeps the currently open desktop surfaces free of edition sales gates', () => {
    const publicUiFiles = [
      'packages/desktop/src/renderer/pages/settings/ToolsSettings/index.tsx',
      'packages/desktop/src/renderer/pages/settings/SkillsSettings/SkillsHubSettings.tsx',
      'packages/desktop/src/renderer/pages/winkgo/InspirationCenterPage/index.tsx',
      'packages/desktop/src/renderer/components/layout/Router.tsx',
      'packages/desktop/src/renderer/pages/winkgo/KnowledgeCanvasPage/knowledgeCanvasAiBridge.ts',
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/WebuiModalContent.tsx',
      'packages/desktop/src/renderer/components/layout/Sider/index.tsx',
      'packages/desktop/src/process/services/winkGoEditionGuard.ts',
    ];
    const salesGate = /WinkGoProFeatureCard|WINK GO Pro|WINK GO 免费版|解锁 Pro|属于 Pro|需安装 Pro 客户端|· PRO/;
    const rendererCapabilityGate =
      /can\(['"](?:mcp\.miniapp|skills\.premium|inspiration\.full|canvas\.ai|remote\.desktop)['"]\)|winkGoAuth\.getSession/;

    for (const file of publicUiFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, `${file} contains an edition sales prompt`).not.toMatch(salesGate);
      expect(source, `${file} blocks an open feature in the renderer`).not.toMatch(rendererCapabilityGate);
    }
  });

  it('shows the WINK GO mini-program code whenever WebUI is running', () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        'packages/desktop/src/renderer/components/settings/SettingsModal/contents/WebuiModalContent.tsx'
      ),
      'utf8'
    );

    expect(source).toContain('{status?.running && (');
    expect(source).not.toContain('{status?.running && status.allowRemote && (');
    expect(source).toContain('src={winkGoMiniAppCode}');
    expect(source).toContain("data-testid='webui-generated-login-qr-hidden'");
  });

  it('replaces legacy product names in provider and runtime messages', () => {
    expect(
      brandLegacyTextForDisplay('WinkGoAgent agent error. Send message to WinkGo CLI from WinkGo or WinkGo UI.')
    ).toBe('WINK GO CLI agent error. Send message to WINK GO CLI from WINK GO or WINK GO.');
  });

  it('rebrands the built-in assistant greeting used in conversations', () => {
    expect(brandLegacyTextForDisplay('你好！我是你的 WinkGo 管家。')).toBe('你好！我是你的 WINK GO 管家。');
  });

  it('presents the built-in butler as WINK GO without changing its runtime id', () => {
    const assistant = {
      id: 'builtin-winkgo-assistant',
      source: 'builtin',
      name: 'WinkGo Butler',
      name_i18n: { 'zh-CN': 'WinkGo 管家' },
      description: 'Your WinkGo assistant',
      description_i18n: { 'zh-CN': '你的 WinkGo 助手' },
      context_i18n: {},
      prompts: [],
      prompts_i18n: {},
    } as unknown as Assistant;

    const branded = brandAssistantForDisplay(assistant);

    expect(branded.id).toBe('builtin-winkgo-assistant');
    expect(branded.name).toBe('WINK GO');
    expect(branded.name_i18n['zh-CN']).toBe('WINK GO');
    expect(branded.description).toBe('Your WINK GO assistant');
    expect(branded.description_i18n['zh-CN']).toBe('你的 WINK GO 助手');
    expect(branded.avatar).toBe(WINK_GO_BRAND_ICON);
  });

  it('presents the generated WinkGo CLI assistant as WINK GO CLI with the WINK GO mark', () => {
    const assistant = {
      id: 'bare-winkgo_agent',
      source: 'generated',
      name: 'WinkGo CLI',
      name_i18n: { 'zh-CN': 'WinkGo CLI' },
      description_i18n: {},
      context_i18n: {},
      prompts: [],
      prompts_i18n: {},
      agent: { type: 'winkgo_agent', source: 'internal' },
    } as unknown as Assistant;

    const branded = brandAssistantForDisplay(assistant);

    expect(branded.name).toBe(WINK_GO_CLI_DISPLAY_NAME);
    expect(branded.name_i18n['zh-CN']).toBe(WINK_GO_CLI_DISPLAY_NAME);
    expect(branded.avatar).toBe(WINK_GO_BRAND_ICON);
  });

  it('brands the WINK GO CLI management row and its visible diagnostics without adding absent fields', () => {
    const agent = {
      id: 'winkgo_agent',
      name: 'WinkGo CLI',
      agent_type: 'winkgo_agent',
      agent_source: 'internal',
      enabled: true,
      installed: true,
      status: 'offline',
      last_check_error_message: 'WinkGo could not start WinkGo CLI',
      last_check_error_details: {
        agent_name: 'WinkGo CLI',
      },
    } as ManagedAgent;

    const branded = brandManagedAgentForDisplay(agent);

    expect(branded.name).toBe('WINK GO CLI');
    expect(branded.icon).toBe(WINK_GO_BRAND_ICON);
    expect(branded.avatar).toBe(WINK_GO_BRAND_ICON);
    expect(branded.last_check_error_message).toBe('WINK GO could not start WINK GO CLI');
    expect(branded.last_check_error_details?.agent_name).toBe('WINK GO CLI');
    expect(branded).not.toHaveProperty('description');
    expect(branded).not.toHaveProperty('description_i18n');
  });

  it('preserves unrelated provider error details', () => {
    const providerError = 'API error 503: {"message":"Service temporarily unavailable"}';

    expect(brandLegacyTextForDisplay(providerError)).toBe(providerError);
  });

  it('rebrands an internal temporary folder without changing its surrounding path', () => {
    expect(brandLegacyTextForDisplay('temporary/.winkgo_agent/config.json')).toBe('temporary/.winkgo/config.json');
  });

  it('handles empty visible text without inventing a label', () => {
    expect(brandLegacyTextForDisplay('')).toBe('');
  });

  it('uses the current album cover as the island identity when media metadata provides one', () => {
    const identity = resolveMediaIdentity({
      appId: 'QQMusic.exe',
      title: 'Zoo',
      artist: 'Ga$h Baby',
      albumTitle: '',
      isPlaying: true,
      canPlayPause: true,
      canGoNext: true,
      canGoPrevious: true,
      coverUrl: 'data:image/png;base64,album-cover',
      updatedAt: 1,
    });

    expect(identity.kind).toBe('media-cover');
    expect(identity.source).toBe('data:image/png;base64,album-cover');
  });

  it('falls back to the matching media application logo when album artwork is unavailable', () => {
    const identity = resolveMediaIdentity({
      appId: 'QQMusic.exe',
      title: 'Paused track',
      artist: '',
      albumTitle: '',
      isPlaying: false,
      canPlayPause: true,
      canGoNext: false,
      canGoPrevious: false,
      coverUrl: '',
      updatedAt: 1,
    });

    expect(identity.kind).toBe('media-app');
    expect(identity.label).toBe('QQ音乐');
  });

  it('recognizes packaged Soda Music identities when artwork is published late', () => {
    const identity = resolveMediaIdentity({
      appId: 'com.bytedance.music_luna.music',
      title: 'Current track',
      artist: '',
      albumTitle: '',
      isPlaying: true,
      canPlayPause: true,
      canGoNext: true,
      canGoPrevious: true,
      coverUrl: '',
      appIconUrl: '',
      updatedAt: 1,
    });

    expect(identity.kind).toBe('media-app');
    expect(identity.label).toBe('汽水音乐');
    expect(identity.source).toBeTruthy();
  });

  it('recognizes packaged NetEase identities when artwork is unavailable', () => {
    const identity = resolveMediaIdentity({
      appId: 'com.netease.music.163',
      title: 'Current track',
      artist: '',
      albumTitle: '',
      isPlaying: true,
      canPlayPause: true,
      canGoNext: true,
      canGoPrevious: true,
      coverUrl: '',
      appIconUrl: '',
      updatedAt: 1,
    });

    expect(identity.kind).toBe('media-app');
    expect(identity.label).toBe('网易云音乐');
    expect(identity.source).toBeTruthy();
  });

  it('uses the Windows media application icon when a player does not publish album artwork', () => {
    const identity = resolveMediaIdentity({
      appId: '汽水音乐',
      title: '樱花草',
      artist: 'D J 匆匆',
      albumTitle: '',
      isPlaying: true,
      canPlayPause: true,
      canGoNext: true,
      canGoPrevious: true,
      coverUrl: '',
      appIconUrl: 'data:image/png;base64,soda-executable-icon',
      updatedAt: 1,
    });

    expect(identity.kind).toBe('media-app');
    expect(identity.source).toBe('data:image/png;base64,soda-executable-icon');
  });

  it('keeps an unknown Windows media player visible when neither artwork nor an application icon is available', () => {
    const identity = resolveMediaIdentity({
      appId: 'FutureMusicPlayer.exe',
      title: 'Future track',
      artist: '',
      albumTitle: '',
      isPlaying: true,
      canPlayPause: true,
      canGoNext: false,
      canGoPrevious: false,
      coverUrl: '',
      appIconUrl: '',
      updatedAt: 1,
    });

    expect(identity.kind).toBe('media-app');
    expect(identity.source).toBeTruthy();
    expect(identity.label).toBe('FutureMusicPlayer.exe');
  });

  it('uses the exact Windows notification icon before bundled application fallbacks', () => {
    const identity = resolveNotificationIdentity({
      id: 'mail-1',
      appName: 'Outlook',
      title: 'New mail',
      body: '',
      appUserModelId: 'Microsoft.Office.OUTLOOK.EXE',
      iconUrl: 'data:image/png;base64,windows-app-icon',
      createdAt: 1,
    });

    expect(identity.label).toBe('Outlook');
    expect(identity.source).toBe('data:image/png;base64,windows-app-icon');
  });

  it('lets a new app notification temporarily take priority over playing media and tool activity', () => {
    const identity = resolveIslandDynamicIdentity({
      notification: {
        id: 'qq-1',
        appName: 'QQ',
        title: 'New message',
        body: '',
        appUserModelId: 'Tencent.QQ',
        createdAt: 3,
      },
      media: {
        appId: 'Spotify.exe',
        title: 'Track',
        artist: 'Artist',
        albumTitle: '',
        isPlaying: true,
        canPlayPause: true,
        canGoNext: true,
        canGoPrevious: true,
        coverUrl: 'data:image/png;base64,cover',
        updatedAt: 2,
      },
      activity: {
        id: 'activity-1',
        source: 'Codex',
        kind: 'tool',
        status: 'running',
        title: 'Running command',
        timestamp: 1,
      },
    });

    expect(identity.kind).toBe('notification-app');
    expect(identity.label).toBe('QQ');
  });
});
