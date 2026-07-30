import { Dropdown, Menu, Message } from '@arco-design/web-react';
import {
  AddOne,
  AlarmClock,
  ApplicationMenu,
  Brain,
  FileCollection,
  FolderOpen,
  FolderPlus,
  Shield,
  SettingTwo,
} from '@icon-park/react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { isMacOS } from '@/renderer/utils/platform';
import {
  dismissTitlebarQuickActionTargets,
  dispatchTitlebarQuickAction,
  type TitlebarQuickAction,
} from '@/renderer/utils/quickActions/titlebarQuickActions';
import { isPrimaryApplicationShortcut } from '@/renderer/utils/ui/keyboardShortcuts';
import { ipcBridge } from '@/common';
import type { WinkGoShortcutAction } from '@/common/adapter/ipcBridge';

type QuickActionLocationState = {
  resetAssistant?: boolean;
  titlebarQuickAction?: TitlebarQuickAction;
};

type TitlebarQuickActionsProps = {
  iconSize: number;
  iconStrokeWidth?: number;
  isMobile?: boolean;
};

const QUICK_ACTION_SELECTORS: Record<TitlebarQuickAction, string> = {
  workspace: '[data-winkgo-quick-action="workspace"]',
  model: '[data-winkgo-quick-action="model"]',
  permission: '[data-winkgo-quick-action="permission"]',
};

const QUICK_ACTION_SHORTCUT_KEYS: Record<TitlebarQuickAction, string> = {
  workspace: 'o',
  model: 'm',
  permission: 'a',
};

const runQuickAction = (action: TitlebarQuickAction): boolean => {
  const target = document.querySelector<HTMLElement>(QUICK_ACTION_SELECTORS[action]);
  if (!target || target.matches(':disabled, [aria-disabled="true"]')) return false;
  dispatchTitlebarQuickAction(action);
  return true;
};

const TitlebarQuickActions: React.FC<TitlebarQuickActionsProps> = ({ iconSize, iconStrokeWidth, isMobile = false }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuVisible, setMenuVisible] = useState(false);
  const quickActionsTitle = t('common.quickActions.title');

  const clearPendingAction = useCallback(() => {
    const state = (location.state || {}) as QuickActionLocationState;
    if (!state.titlebarQuickAction) return;
    const { titlebarQuickAction: _titlebarQuickAction, ...restState } = state;
    void navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: restState,
    });
  }, [location.hash, location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    const pendingAction = ((location.state || {}) as QuickActionLocationState).titlebarQuickAction;
    if (!pendingAction) return undefined;

    let attempt = 0;
    let timer: number | undefined;
    const tryOpen = () => {
      if (document.querySelector<HTMLElement>(QUICK_ACTION_SELECTORS[pendingAction])) {
        clearPendingAction();
        window.setTimeout(() => {
          if (!runQuickAction(pendingAction)) {
            Message.warning(t('common.quickActions.unavailable'));
          }
        }, 160);
        return;
      }
      attempt += 1;
      if (attempt >= 20) {
        clearPendingAction();
        Message.warning(t('common.quickActions.unavailable'));
        return;
      }
      timer = window.setTimeout(tryOpen, 100);
    };

    timer = window.setTimeout(tryOpen, 60);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [clearPendingAction, location.state, t]);

  const openAction = useCallback(
    (action: TitlebarQuickAction) => {
      setMenuVisible(false);
      if (document.querySelector<HTMLElement>(QUICK_ACTION_SELECTORS[action])) {
        window.setTimeout(() => {
          if (!runQuickAction(action)) {
            Message.warning(t('common.quickActions.unavailable'));
          }
        }, 120);
        return;
      }
      void navigate('/guid', {
        state: {
          titlebarQuickAction: action,
        } satisfies QuickActionLocationState,
      });
    },
    [navigate, t]
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const action = (Object.entries(QUICK_ACTION_SHORTCUT_KEYS) as [TitlebarQuickAction, string][]).find(([, key]) =>
        isPrimaryApplicationShortcut(event, {
          key,
          shiftKey: true,
          targetGuard: 'embedded-editor',
        })
      )?.[0];

      if (!action) return;
      event.preventDefault();
      openAction(action);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openAction]);

  const createConversation = useCallback(() => {
    setMenuVisible(false);
    void navigate('/guid', {
      state: {
        resetAssistant: true,
      } satisfies QuickActionLocationState,
    });
  }, [navigate]);

  const triggerIslandShortcut = useCallback((action: WinkGoShortcutAction) => {
    setMenuVisible(false);
    void ipcBridge.winkGoFiles.triggerShortcutAction.invoke({ action }).catch(() => {
      Message.warning('快捷操作暂时不可用，请稍后重试。');
    });
  }, []);

  const handleMenuVisibleChange = useCallback((visible: boolean) => {
    setMenuVisible(visible);
    if (visible) dismissTitlebarQuickActionTargets();
  }, []);

  const primaryShortcutLabel = isMacOS() ? '⌘' : 'Ctrl';
  const shiftedShortcutLabel = isMacOS() ? '⌘ ⇧' : 'Ctrl Shift';

  const menu = (
    <Menu className='titlebar-quick-actions__menu'>
      <Menu.Item key='new-conversation' onClick={createConversation}>
        <span className='titlebar-quick-actions__item'>
          <span className='titlebar-quick-actions__icon'>
            <AddOne theme='outline' size='18' fill='currentColor' />
          </span>
          <span>{t('common.quickActions.newConversation')}</span>
          <kbd>{primaryShortcutLabel} T</kbd>
        </span>
      </Menu.Item>
      <Menu.Item key='workspace' onClick={() => openAction('workspace')}>
        <span className='titlebar-quick-actions__item'>
          <span className='titlebar-quick-actions__icon'>
            <FolderOpen theme='outline' size='18' fill='currentColor' />
          </span>
          <span>{t('common.quickActions.switchFolder')}</span>
          <kbd>{shiftedShortcutLabel} O</kbd>
        </span>
      </Menu.Item>
      <Menu.Item key='model' onClick={() => openAction('model')}>
        <span className='titlebar-quick-actions__item'>
          <span className='titlebar-quick-actions__icon'>
            <Brain theme='outline' size='18' fill='currentColor' />
          </span>
          <span>{t('common.quickActions.switchModel')}</span>
          <kbd>{shiftedShortcutLabel} M</kbd>
        </span>
      </Menu.Item>
      <Menu.Item key='permission' onClick={() => openAction('permission')}>
        <span className='titlebar-quick-actions__item'>
          <span className='titlebar-quick-actions__icon'>
            <Shield theme='outline' size='18' fill='currentColor' />
          </span>
          <span>{t('common.quickActions.switchPermission')}</span>
          <kbd>{shiftedShortcutLabel} A</kbd>
        </span>
      </Menu.Item>
      <Menu.Item key='memo' onClick={() => triggerIslandShortcut('openMemo')}>
        <span className='titlebar-quick-actions__item'>
          <span className='titlebar-quick-actions__icon'>
            <AlarmClock theme='outline' size='18' fill='currentColor' />
          </span>
          <span>打开定时任务</span>
          <kbd>Alt 1</kbd>
        </span>
      </Menu.Item>
      <Menu.Item key='file-shelf' onClick={() => triggerIslandShortcut('openShelf')}>
        <span className='titlebar-quick-actions__item'>
          <span className='titlebar-quick-actions__icon'>
            <FileCollection theme='outline' size='18' fill='currentColor' />
          </span>
          <span>文件收纳盒</span>
          <kbd>Alt 2</kbd>
        </span>
      </Menu.Item>
      <Menu.Item key='file-category' onClick={() => triggerIslandShortcut('newCategory')}>
        <span className='titlebar-quick-actions__item'>
          <span className='titlebar-quick-actions__icon'>
            <FolderPlus theme='outline' size='18' fill='currentColor' />
          </span>
          <span>新建收纳分类</span>
          <kbd>Alt 3</kbd>
        </span>
      </Menu.Item>
      <Menu.Item key='format-workbench' onClick={() => triggerIslandShortcut('openFormat')}>
        <span className='titlebar-quick-actions__item'>
          <span className='titlebar-quick-actions__icon'>
            <SettingTwo theme='outline' size='18' fill='currentColor' />
          </span>
          <span>格式快转</span>
          <kbd>Alt 4</kbd>
        </span>
      </Menu.Item>
      <Menu.Item key='toggle-island' onClick={() => triggerIslandShortcut('toggleIsland')}>
        <span className='titlebar-quick-actions__item'>
          <span className='titlebar-quick-actions__icon'>
            <ApplicationMenu theme='outline' size='18' fill='currentColor' />
          </span>
          <span>隐藏或显示灵动岛</span>
          <kbd>Alt 6</kbd>
        </span>
      </Menu.Item>
    </Menu>
  );

  return (
    <Dropdown
      trigger='click'
      position='br'
      droplist={menu}
      popupVisible={menuVisible}
      onVisibleChange={handleMenuVisibleChange}
    >
      <button
        type='button'
        className={classNames('app-titlebar__button', isMobile && 'app-titlebar__button--mobile')}
        aria-label={quickActionsTitle}
        title={quickActionsTitle}
        data-testid='titlebar-quick-actions'
      >
        <ApplicationMenu
          theme='outline'
          size={iconSize}
          fill='currentColor'
          strokeWidth={iconStrokeWidth}
          className='block leading-none'
        />
      </button>
    </Dropdown>
  );
};

export default TitlebarQuickActions;
