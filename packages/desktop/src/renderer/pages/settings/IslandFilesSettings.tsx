/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Input, Message as ArcoMessage, Select, Slider, Switch } from '@arco-design/web-react';
import {
  Delete,
  FileCollection,
  FolderOpen,
  Keyboard,
  Message as MessageIcon,
  Plus,
  SettingTwo,
  Sound,
  TagOne,
  Undo,
} from '@icon-park/react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type {
  IStartOnBootStatus,
  WinkGoOrganizeOperation,
  WinkGoOrganizerMode,
  WinkGoOrganizerRule,
} from '@/common/adapter/ipcBridge';
import PreferenceRow from '@/renderer/components/settings/SettingsModal/contents/SystemModalContent/PreferenceRow';
import { useWinkGoIslandFilePreferences } from '@/renderer/hooks/system/useWinkGoIslandFilePreferences';
import {
  notifyWinkGoOrganizerSettingsChanged,
  WINK_GO_ORGANIZER_STORAGE_KEYS,
  writeWinkGoIslandFilePreferences,
  type WinkGoIslandFilePreferences,
} from '@/renderer/utils/winkgo/islandFilePreferences';
import SettingsPageHeader from './components/SettingsPageHeader';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const MAX_CUSTOM_RULES = 32;
const HOTKEYS = {
  memo: 'Alt + 1',
  fileShelf: 'Alt + 2',
  fileCategory: 'Alt + 3',
  formatWorkbench: 'Alt + 4',
  toggleIsland: 'Alt + 6',
  newConversation: 'Ctrl + T',
  switchFolder: 'Ctrl + Shift + O',
  switchModel: 'Ctrl + Shift + M',
  switchPermission: 'Ctrl + Shift + A',
} as const;

const readStorageArray = <T,>(key: string): T[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const writeStorage = (key: string, value: unknown): void => {
  window.localStorage.setItem(key, JSON.stringify(value));
  notifyWinkGoOrganizerSettingsChanged();
};

const sanitizeRuleName = (value: string): string =>
  value
    .replace(/[\p{Cc}<>:"/\\|?*]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .slice(0, 32);

const parseKeywords = (value: string): string[] =>
  [
    ...new Set(
      value
        .split(/[,，;；\n]/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 2)
    ),
  ].slice(0, 24);

type SettingsCardProps = {
  children: React.ReactNode;
  description: string;
  icon: React.ReactElement;
  title: string;
};

const SettingsCard: React.FC<SettingsCardProps> = ({ children, description, icon, title }) => (
  <section className='overflow-hidden rd-16px border border-border-2 bg-2 shadow-sm'>
    <header className='flex items-center gap-12px border-b border-border-2 px-18px py-16px md:px-24px'>
      <span className='size-38px shrink-0 flex items-center justify-center rd-12px bg-primary-1 text-primary-6'>
        {React.cloneElement(
          icon as React.ReactElement<{ fill?: string; size?: number; strokeWidth?: number; theme?: string }>,
          {
            fill: 'currentColor',
            size: 19,
            strokeWidth: 3,
            theme: 'outline',
          }
        )}
      </span>
      <span className='min-w-0'>
        <strong className='block text-15px leading-22px text-t-primary'>{title}</strong>
        <small className='block mt-2px text-12px leading-18px text-t-tertiary'>{description}</small>
      </span>
    </header>
    <div className='divide-y divide-border-2 px-18px md:px-24px'>{children}</div>
  </section>
);

const ShortcutBadge: React.FC<{ value: string }> = ({ value }) => (
  <kbd className='inline-flex h-28px items-center rd-8px border border-primary-3 bg-primary-1 px-10px font-mono text-12px text-primary-6'>
    {value}
  </kbd>
);

const IslandFilesSettings: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const preferences = useWinkGoIslandFilePreferences();
  const [startOnBoot, setStartOnBoot] = useState<IStartOnBootStatus>({
    supported: false,
    enabled: false,
    isPackaged: false,
    platform: 'web',
  });
  const [destinationRoot, setDestinationRoot] = useState(
    () => window.localStorage.getItem(WINK_GO_ORGANIZER_STORAGE_KEYS.root) || ''
  );
  const [mode, setMode] = useState<WinkGoOrganizerMode>(() =>
    window.localStorage.getItem(WINK_GO_ORGANIZER_STORAGE_KEYS.mode) === 'copy' ? 'copy' : 'move'
  );
  const [autoRename, setAutoRename] = useState(
    () => window.localStorage.getItem(WINK_GO_ORGANIZER_STORAGE_KEYS.autoRename) !== 'false'
  );
  const [recentFiles, setRecentFiles] = useState(() =>
    readStorageArray<{ destination: string }>(WINK_GO_ORGANIZER_STORAGE_KEYS.recentFiles)
  );
  const [lastBatch, setLastBatch] = useState(() =>
    readStorageArray<WinkGoOrganizeOperation>(WINK_GO_ORGANIZER_STORAGE_KEYS.lastBatch)
  );
  const [rules, setRules] = useState(() =>
    readStorageArray<WinkGoOrganizerRule>(WINK_GO_ORGANIZER_STORAGE_KEYS.rules).slice(0, MAX_CUSTOM_RULES)
  );
  const [ruleName, setRuleName] = useState('');
  const [ruleKeywords, setRuleKeywords] = useState('');

  useEffect(() => {
    void ipcBridge.application.getStartOnBootStatus
      .invoke()
      .then((result) => {
        if (result.data) setStartOnBoot(result.data);
      })
      .catch((): undefined => undefined);
  }, []);

  useEffect(() => {
    if (destinationRoot) return;
    void ipcBridge.winkGoFiles.getDefaultFolder
      .invoke()
      .then((defaultRoot) => {
        setDestinationRoot(defaultRoot);
        window.localStorage.setItem(WINK_GO_ORGANIZER_STORAGE_KEYS.root, defaultRoot);
        notifyWinkGoOrganizerSettingsChanged();
      })
      .catch((): undefined => undefined);
  }, [destinationRoot]);

  const applyIslandPreferences = useCallback((patch: Partial<WinkGoIslandFilePreferences>) => {
    const next = writeWinkGoIslandFilePreferences(patch);
    void window.electronAPI?.desktopIsland?.applySettings?.({
      autoHideFullscreen: next.autoHideFullscreen,
      opacity: next.opacity,
      visible: next.islandVisible,
    });
  }, []);

  const updateStartOnBoot = useCallback(
    (enabled: boolean) => {
      const previous = startOnBoot;
      setStartOnBoot((current) => ({ ...current, enabled }));
      void ipcBridge.application.setStartOnBoot
        .invoke({ enabled })
        .then((result) => {
          if (result.success && result.data) {
            setStartOnBoot(result.data);
            return;
          }
          setStartOnBoot(previous);
          ArcoMessage.warning(result.msg || '当前运行方式暂不支持开机自启动，安装正式版后即可启用。');
        })
        .catch(() => {
          setStartOnBoot(previous);
          ArcoMessage.error('开机自启动设置失败，请稍后重试。');
        });
    },
    [startOnBoot]
  );

  const updateNotificationReceive = useCallback(
    async (enabled: boolean) => {
      if (!enabled) {
        applyIslandPreferences({ notificationReceiveEnabled: false });
        return;
      }
      const result = await ipcBridge.winkGoWindows.requestNotificationAccess.invoke().catch((): null => null);
      const allowed = result?.status === 'Allowed';
      applyIslandPreferences({ notificationReceiveEnabled: allowed });
      if (!allowed) ArcoMessage.warning('Windows 通知访问尚未允许，已保持关闭。');
    },
    [applyIslandPreferences]
  );

  const chooseDestinationRoot = useCallback(async () => {
    const selected = await ipcBridge.dialog.showOpen.invoke({
      defaultPath: destinationRoot || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    const nextRoot = selected?.[0];
    if (!nextRoot) return;
    setDestinationRoot(nextRoot);
    window.localStorage.setItem(WINK_GO_ORGANIZER_STORAGE_KEYS.root, nextRoot);
    notifyWinkGoOrganizerSettingsChanged();
  }, [destinationRoot]);

  const updateMode = useCallback((nextMode: WinkGoOrganizerMode) => {
    setMode(nextMode);
    window.localStorage.setItem(WINK_GO_ORGANIZER_STORAGE_KEYS.mode, nextMode);
    notifyWinkGoOrganizerSettingsChanged();
  }, []);

  const updateAutoRename = useCallback((enabled: boolean) => {
    setAutoRename(enabled);
    window.localStorage.setItem(WINK_GO_ORGANIZER_STORAGE_KEYS.autoRename, String(enabled));
    notifyWinkGoOrganizerSettingsChanged();
  }, []);

  const undoLastOrganization = useCallback(async () => {
    if (lastBatch.length === 0) return;
    const result = await ipcBridge.winkGoFiles.undo.invoke({ operations: lastBatch }).catch((): null => null);
    if (!result) {
      ArcoMessage.error('撤销失败，请确认原文件位置仍然可用。');
      return;
    }
    const organizedPaths = new Set(lastBatch.map((operation) => operation.destination));
    const nextRecent = recentFiles.filter((file) => !organizedPaths.has(file.destination));
    setRecentFiles(nextRecent);
    setLastBatch([]);
    writeStorage(WINK_GO_ORGANIZER_STORAGE_KEYS.recentFiles, nextRecent);
    writeStorage(WINK_GO_ORGANIZER_STORAGE_KEYS.lastBatch, []);
    ArcoMessage.success(`已恢复 ${result.restored.length} 个文件。`);
  }, [lastBatch, recentFiles]);

  const persistRules = useCallback((nextRules: WinkGoOrganizerRule[]) => {
    const normalized = nextRules.slice(0, MAX_CUSTOM_RULES);
    setRules(normalized);
    writeStorage(WINK_GO_ORGANIZER_STORAGE_KEYS.rules, normalized);
  }, []);

  const addRule = useCallback(() => {
    const name = sanitizeRuleName(ruleName);
    const keywords = parseKeywords(ruleKeywords);
    if (name.length < 2 || keywords.length === 0) {
      ArcoMessage.warning('请填写分类名称，并至少填写一个不少于 2 个字的识别关键词。');
      return;
    }
    if (rules.some((rule) => rule.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      ArcoMessage.warning('已经存在同名分类。');
      return;
    }
    if (rules.length >= MAX_CUSTOM_RULES) {
      ArcoMessage.warning(`最多可以保存 ${MAX_CUSTOM_RULES} 个自定义分类。`);
      return;
    }
    persistRules([...rules, { id: `settings-${Date.now().toString(36)}`, name, keywords }]);
    setRuleName('');
    setRuleKeywords('');
  }, [persistRules, ruleKeywords, ruleName, rules]);

  const shortcutStatus = useMemo(
    () => `${recentFiles.length} 条本机索引${lastBatch.length > 0 ? ' · 可撤销上次整理' : ''}`,
    [lastBatch.length, recentFiles.length]
  );

  return (
    <SettingsPageWrapper contentClassName='md:max-w-1100px'>
      <SettingsPageHeader
        data-testid='island-files-settings-header'
        title='灵动岛与文件收纳'
        description='控制桌面灵动岛、系统通知、全局快捷键和本地文件收纳；所有设置只保存在这台电脑。'
      />

      <div className='mt-18px space-y-16px pb-24px' data-testid='island-files-settings'>
        <SettingsCard icon={<SettingTwo />} title='灵动岛与交互' description={t('settings.islandFilesExperienceDesc')}>
          <PreferenceRow label='轻量交互音效' description='只在点击和任务完成时播放，不常驻音频服务'>
            <Switch
              checked={preferences.interactionSoundEnabled}
              onChange={(enabled) => applyIslandPreferences({ interactionSoundEnabled: enabled })}
            />
          </PreferenceRow>
          <PreferenceRow label='岛屿颜色' description='切换亮色或暗色胶囊，内容面板保持清晰可读'>
            <Select
              className='w-150px'
              size='small'
              value={preferences.islandTheme}
              onChange={(value) =>
                applyIslandPreferences({ islandTheme: value as WinkGoIslandFilePreferences['islandTheme'] })
              }
            >
              <Select.Option value='white'>亮色</Select.Option>
              <Select.Option value='black'>暗色</Select.Option>
            </Select>
          </PreferenceRow>
          <PreferenceRow label='目标媒体平台' description='使用 Windows SMTC 匹配指定播放器'>
            <Select
              className='w-150px'
              size='small'
              value={preferences.mediaTarget}
              onChange={(value) =>
                applyIslandPreferences({ mediaTarget: value as WinkGoIslandFilePreferences['mediaTarget'] })
              }
            >
              <Select.Option value='system'>通用媒体</Select.Option>
              <Select.Option value='netease'>网易云音乐</Select.Option>
              <Select.Option value='qqmusic'>QQ 音乐</Select.Option>
              <Select.Option value='kugou'>酷狗音乐</Select.Option>
              <Select.Option value='spotify'>Spotify</Select.Option>
              <Select.Option value='apple'>Apple Music</Select.Option>
              <Select.Option value='echo'>EchoMusic</Select.Option>
              <Select.Option value='lx-music'>洛雪音乐</Select.Option>
            </Select>
          </PreferenceRow>
          <PreferenceRow label='媒体控制器' description='在灵动岛显示歌曲封面、播放信息与控制按钮'>
            <Switch
              checked={preferences.mediaControllerEnabled}
              onChange={(enabled) => applyIslandPreferences({ mediaControllerEnabled: enabled })}
            />
          </PreferenceRow>
          <PreferenceRow label='灵动岛不透明度' description={`${preferences.opacity}% · 支持 20% 到 100%`}>
            <div className='w-180px flex items-center gap-10px'>
              <Slider
                className='min-w-0 flex-1'
                min={20}
                max={100}
                value={preferences.opacity}
                onChange={(value) => applyIslandPreferences({ opacity: Number(value) })}
              />
              <span className='w-36px text-right text-12px text-t-secondary'>{preferences.opacity}%</span>
            </div>
          </PreferenceRow>
          <PreferenceRow
            label='开机自启动'
            description={startOnBoot.supported ? t('settings.startOnBootDesc') : t('settings.startOnBootUnsupported')}
          >
            <Switch checked={startOnBoot.enabled} disabled={!startOnBoot.supported} onChange={updateStartOnBoot} />
          </PreferenceRow>
          <PreferenceRow label='通知接收' description='读取 Windows 通知状态，用于微信和其他应用卡片'>
            <Switch checked={preferences.notificationReceiveEnabled} onChange={updateNotificationReceive} />
          </PreferenceRow>
          <PreferenceRow label='全屏自动隐藏' description='游戏或视频进入全屏空间时不覆盖画面'>
            <Switch
              checked={preferences.autoHideFullscreen}
              onChange={(enabled) => applyIslandPreferences({ autoHideFullscreen: enabled })}
            />
          </PreferenceRow>
          <PreferenceRow label='隐藏或显示灵动岛' description='开关会立即作用于电脑顶部的独立灵动岛'>
            <div className='flex items-center gap-10px'>
              <ShortcutBadge value={HOTKEYS.toggleIsland} />
              <Switch
                checked={preferences.islandVisible}
                onChange={(visible) => applyIslandPreferences({ islandVisible: visible })}
              />
            </div>
          </PreferenceRow>
          <PreferenceRow label='活动上岛' description='显示收到、执行、完成或失败，不读取工具参数与结果正文'>
            <Switch
              checked={preferences.activityEnabled}
              onChange={(enabled) => applyIslandPreferences({ activityEnabled: enabled })}
            />
          </PreferenceRow>
        </SettingsCard>

        <SettingsCard icon={<FileCollection />} title='文件收纳' description='本机识别、本机整理，文件不会上传到云端'>
          <PreferenceRow label='启用文件投递' description='允许把文件拖入灵动岛并自动分类'>
            <Switch
              checked={preferences.organizerEnabled}
              onChange={(enabled) => applyIslandPreferences({ organizerEnabled: enabled })}
            />
          </PreferenceRow>
          <PreferenceRow label='收纳目录' description={destinationRoot || '尚未设置收纳目录'}>
            <Button
              size='small'
              icon={<FolderOpen theme='outline' size='15' fill='currentColor' />}
              onClick={() => void chooseDestinationRoot()}
            >
              选择文件夹
            </Button>
          </PreferenceRow>
          <PreferenceRow label='投递方式' description='移动模式支持一键撤销；复制模式保留原文件'>
            <Select
              className='w-150px'
              size='small'
              value={mode}
              disabled={!preferences.organizerEnabled}
              onChange={(value) => updateMode(value as WinkGoOrganizerMode)}
            >
              <Select.Option value='move'>移动并整理</Select.Option>
              <Select.Option value='copy'>复制并整理</Select.Option>
            </Select>
          </PreferenceRow>
          <PreferenceRow label='内容识别与智能文件名' description='在本机识别用途、分类并生成更易读的文件名'>
            <Switch checked={autoRename} disabled={!preferences.organizerEnabled} onChange={updateAutoRename} />
          </PreferenceRow>
          <PreferenceRow label='文件收纳盒快捷键' description='在任何软件中打开最近整理的文件'>
            <ShortcutBadge value={HOTKEYS.fileShelf} />
          </PreferenceRow>
          <PreferenceRow label='新建分类快捷键' description='直接在灵动岛创建自定义收纳分类'>
            <ShortcutBadge value={HOTKEYS.fileCategory} />
          </PreferenceRow>
          <PreferenceRow label='格式快转快捷键' description='展开本地格式台，继续使用完整转换能力'>
            <ShortcutBadge value={HOTKEYS.formatWorkbench} />
          </PreferenceRow>
          <PreferenceRow label='最近文件' description={shortcutStatus}>
            <Button
              size='small'
              disabled={lastBatch.length === 0}
              icon={<Undo theme='outline' size='15' fill='currentColor' />}
              onClick={() => void undoLastOrganization()}
            >
              撤销上次移动
            </Button>
          </PreferenceRow>
        </SettingsCard>

        <SettingsCard icon={<MessageIcon />} title='快捷备忘与通知' description='全局快捷键和微信通知卡片'>
          <PreferenceRow label='快速新建会话' description='随时回到聊天首页并开始一个新会话'>
            <ShortcutBadge value={HOTKEYS.newConversation} />
          </PreferenceRow>
          <PreferenceRow label='快速切换文件夹' description='打开当前会话的项目文件夹选择器'>
            <ShortcutBadge value={HOTKEYS.switchFolder} />
          </PreferenceRow>
          <PreferenceRow label='快速切换模型' description='打开当前 Agent 的模型选择器'>
            <ShortcutBadge value={HOTKEYS.switchModel} />
          </PreferenceRow>
          <PreferenceRow label='快速切换授权模式' description='打开当前会话的权限模式选择器'>
            <ShortcutBadge value={HOTKEYS.switchPermission} />
          </PreferenceRow>
          <PreferenceRow label='备忘录快捷键' description='打开定时任务，可继续记录提醒与计划'>
            <div className='flex items-center gap-10px'>
              <ShortcutBadge value={HOTKEYS.memo} />
              <Button size='small' onClick={() => void navigate('/scheduled')}>
                立即打开
              </Button>
            </div>
          </PreferenceRow>
          <PreferenceRow label='微信通知卡片' description='收到微信通知时显示应用图标、标题和灵动岛动画'>
            <Switch
              checked={preferences.wechatNotificationCardsEnabled}
              disabled={!preferences.notificationReceiveEnabled}
              onChange={(enabled) => applyIslandPreferences({ wechatNotificationCardsEnabled: enabled })}
            />
          </PreferenceRow>
        </SettingsCard>

        <SettingsCard icon={<TagOne />} title='自定义文件分类' description='用户规则优先匹配，最多保存 32 类'>
          <div className='py-14px'>
            <div className='grid gap-8px md:grid-cols-[180px_minmax(0,1fr)_auto]'>
              <Input
                maxLength={32}
                placeholder='分类名称，如：客户合同'
                prefix={<TagOne theme='outline' size='14' fill='currentColor' />}
                value={ruleName}
                onChange={setRuleName}
              />
              <Input
                maxLength={300}
                placeholder='识别关键词，用逗号分隔'
                prefix={<Sound theme='outline' size='14' fill='currentColor' />}
                value={ruleKeywords}
                onChange={setRuleKeywords}
                onPressEnter={addRule}
              />
              <Button type='primary' icon={<Plus theme='outline' size='15' fill='currentColor' />} onClick={addRule}>
                添加分类
              </Button>
            </div>
            <div className='mt-12px space-y-8px' aria-label='自定义文件分类规则'>
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className='grid items-center gap-8px rd-10px bg-fill-1 px-12px py-10px md:grid-cols-[180px_minmax(0,1fr)_auto]'
                >
                  <strong className='truncate text-13px text-t-primary'>{rule.name}</strong>
                  <span className='truncate text-12px text-t-tertiary'>{rule.keywords.join('、')}</span>
                  <Button
                    type='text'
                    status='danger'
                    size='mini'
                    aria-label={`删除 ${rule.name}`}
                    icon={<Delete theme='outline' size='15' fill='currentColor' />}
                    onClick={() => persistRules(rules.filter((item) => item.id !== rule.id))}
                  />
                </div>
              ))}
              {rules.length === 0 && (
                <div className='rd-10px bg-fill-1 px-12px py-16px text-center text-12px text-t-tertiary'>
                  暂无自定义分类，程序仍会继续使用内置分类。
                </div>
              )}
            </div>
            <footer className='mt-10px flex items-center justify-between text-11px text-t-quaternary'>
              <span>
                已启用 {rules.length} / {MAX_CUSTOM_RULES} 类 · 规则仅保存在本机
              </span>
              <span className='inline-flex items-center gap-5px'>
                <Keyboard theme='outline' size='13' fill='currentColor' />
                快捷键在全局生效
              </span>
            </footer>
          </div>
        </SettingsCard>
      </div>
    </SettingsPageWrapper>
  );
};

export default IslandFilesSettings;
