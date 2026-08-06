import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronPaths = vi.hoisted(() => ({
  appData: '',
  userData: '',
}));

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'appData' ? electronPaths.appData : electronPaths.userData),
  },
}));

import {
  getWinkGoWechatPreferences,
  listWinkGoSkillsCatalog,
  prepareWinkGoSkillImport,
  saveWinkGoWechatPreferences,
  syncWinkGoSkillBridge,
} from '@/process/services/winkGoSkillsCatalog';

let temporaryDirectory = '';
const bundledSkills = path.join(process.cwd(), 'resources', 'winkgo', 'skills');

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'winkgo-skills-catalog-'));
  electronPaths.appData = temporaryDirectory;
  electronPaths.userData = temporaryDirectory;
  process.env.WINKGO_SKILLS_SOURCE_DIR = bundledSkills;
});

afterEach(async () => {
  delete process.env.WINKGO_SKILLS_SOURCE_DIR;
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('WINK GO Skills catalog', () => {
  it('lists the audited customer skills without desktop agents or Feishu', () => {
    const catalog = listWinkGoSkillsCatalog();

    expect(catalog.available).toBe(true);
    expect(catalog.skills).toHaveLength(23);
    expect(catalog.skills.map((skill) => skill.id)).not.toContain('desktop_agents');
    expect(catalog.skills.map((skill) => skill.id)).not.toContain('feishu');
    expect(catalog.skills.every((skill) => skill.actionCount > 0)).toBe(true);
  });

  it('prepares the WeChat package with local favorites and no developer drive path', () => {
    const prepared = prepareWinkGoSkillImport('wechat');

    expect(prepared.skillPath).toBeTruthy();
    const document = fs.readFileSync(path.join(prepared.skillPath!, 'SKILL.md'), 'utf8');
    expect(document).toContain('winkgo.wechat.list_favorites');
    expect(document).not.toMatch(/[A-Z]:\\/);
    expect(document).not.toMatch(/\bpython(?:3)?\b/i);
  });

  it('normalizes WeChat favorites and includes them in the filtered bridge config', () => {
    const saved = saveWinkGoWechatPreferences({
      favoriteContacts: [
        ' 文件传输助手 ',
        '张三',
        '张三',
        ...Array.from({ length: 12 }, (_, index) => `联系人${index}`),
      ],
      favoriteGroups: ['产品群', ' 产品群 ', '研发群'],
    });

    expect(saved.favoriteContacts).toHaveLength(10);
    expect(saved.favoriteContacts.slice(0, 2)).toEqual(['文件传输助手', '张三']);
    expect(saved.favoriteGroups).toEqual(['产品群', '研发群']);
    expect(getWinkGoWechatPreferences()).toEqual(saved);

    const plan = syncWinkGoSkillBridge(['wechat']);
    expect(plan.enabled).toBe(true);
    expect(plan.enabledSkillIds).toEqual(['wechat']);
    expect(plan.selectorCount).toBeGreaterThan(1);

    const config = JSON.parse(
      fs.readFileSync(path.join(temporaryDirectory, 'winkgo-runtime-skills', 'enabled-skills.json'), 'utf8')
    );
    expect(config.skillPreferences.wechat).toEqual(saved);
    expect(config.allowedToolNames).toContain('winkgo.wechat.list_favorites');
    expect(config.allowedToolPrefixes).toContain('wechat.');
  });

  it('rejects unknown skills instead of exposing their Runtime tools', () => {
    const plan = syncWinkGoSkillBridge(['wechat', 'not-installed', 'feishu']);

    expect(plan.enabledSkillIds).toEqual(['wechat']);
    expect(plan.originalJson).not.toContain('not-installed');
    expect(plan.originalJson).not.toContain('feishu');
  });

  it('includes per-skill compatibility aliases without exposing another skill', () => {
    const plan = syncWinkGoSkillBridge(['netease_music']);
    const config = JSON.parse(
      fs.readFileSync(path.join(temporaryDirectory, 'winkgo-runtime-skills', 'enabled-skills.json'), 'utf8')
    );

    expect(plan.enabledSkillIds).toEqual(['netease_music']);
    expect(config.compatibilityToolAliases['music.launch_netease_music']).toMatchObject({
      canonicalToolName: 'music.station_open',
      defaultArguments: { player: 'cloud', minimize: false },
    });
    expect(config.allowedToolNames).toContain('music.launch_netease_music');
    expect(config.compatibilityToolAliases['desktop_agents.add_workbuddy_skill']).toBeUndefined();
  });

  it('opens Soda Music as a visible window instead of leaving a hidden black host', () => {
    syncWinkGoSkillBridge(['soda_music']);
    const config = JSON.parse(
      fs.readFileSync(path.join(temporaryDirectory, 'winkgo-runtime-skills', 'enabled-skills.json'), 'utf8')
    );

    expect(config.compatibilityToolAliases['music.fizz_app_open']).toMatchObject({
      canonicalToolName: 'music.station_open',
      defaultArguments: { player: 'fizz', minimize: false },
    });
  });

  it('removes ambiguous legacy music aliases when multiple players are enabled', () => {
    const plan = syncWinkGoSkillBridge(['netease_music', 'qq_music', 'soda_music']);
    const config = JSON.parse(
      fs.readFileSync(path.join(temporaryDirectory, 'winkgo-runtime-skills', 'enabled-skills.json'), 'utf8')
    );
    const ambiguousAliases = [
      'music.like_current_song',
      'music.open_music_app',
      'music.search_and_play',
      'music.station_play_toggle',
      'music.toggle_lyrics',
    ];
    const canonicalToolsThatMustNotBeRewritten = [
      'music.station_lyrics_toggle',
      'music.track_heart_toggle',
      'music.track_resolve_and_start',
    ];

    expect(plan.enabledSkillIds).toEqual(['netease_music', 'qq_music', 'soda_music']);
    for (const aliasName of ambiguousAliases) {
      expect(config.compatibilityToolAliases[aliasName]).toBeUndefined();
      expect(config.allowedToolNames).not.toContain(aliasName);
    }
    for (const toolName of canonicalToolsThatMustNotBeRewritten) {
      expect(config.compatibilityToolAliases[toolName]).toBeUndefined();
      expect(config.allowedToolNames).toContain(toolName);
    }
    expect(config.allowedToolNames).toContain('music.track_resolve_and_start');
    expect(config.allowedToolNames).toContain('music.fizz_search_play');
    expect(config.allowedToolNames).toContain('music.qq_lyrics_toggle');
  });
});
