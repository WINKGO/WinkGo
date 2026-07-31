// Modified from AionUI by WINK GO contributors in 2026.
import classNames from 'classnames';
import React, { Suspense, startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, type NavigateOptions } from 'react-router';
import { ConnectionPointTwo, Down, FileConversion, Lightning, Tips } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { usePreviewContext } from '@renderer/pages/conversation/Preview/context/PreviewContext';
import { cleanupSiderTooltips, getSiderTooltipProps } from '@renderer/utils/ui/siderTooltip';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { useLayoutContext } from '@renderer/hooks/context/LayoutContext';
import { blurActiveElement } from '@renderer/utils/ui/focus';
import {
  SiderToolbar,
  SiderSearchEntry,
  SiderScheduledEntry,
  SiderAssistantEntry,
  SiderFeatureEntry,
} from './SiderNav';
import SiderFooter from './SiderFooter';
import TeamSiderSection from './TeamSiderSection';
import siderStyles from './Sider.module.css';

const WorkspaceGroupedHistory = React.lazy(() => import('@renderer/pages/conversation/GroupedHistory'));
const loadSettingsSider = () => import('@renderer/pages/settings/components/SettingsSider');
const SettingsSider = React.lazy(loadSettingsSider);
const WORKSPACE_TOOLS_EXPANDED_KEY = 'winkgo.sidebar.workspace-tools-expanded';

const preloadSettingsShell = () => {
  void loadSettingsSider();
  void import('@renderer/pages/settings/AgentSettings');
};

interface SiderProps {
  onSessionClick?: () => void;
  collapsed?: boolean;
}

const Sider: React.FC<SiderProps> = ({ onSessionClick, collapsed = false }) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const location = useLocation();
  const { pathname, search, hash } = location;

  const navigate = useNavigate();
  const navigateWithoutBlockingInput = useCallback(
    (target: string, options?: NavigateOptions) => {
      startTransition(() => {
        void navigate(target, options);
      });
    },
    [navigate]
  );
  const { closePreview } = usePreviewContext();
  const { logout, status, user } = useAuth();
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [workspaceToolsExpanded, setWorkspaceToolsExpanded] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(WORKSPACE_TOOLS_EXPANDED_KEY) !== 'false';
  });
  const isSettings = pathname.startsWith('/settings');
  const isWorkspaceFeatureRoute = ['/format-studio', '/mcp', '/inspiration', '/skills'].some((route) =>
    pathname.startsWith(route)
  );
  const lastNonSettingsPathRef = useRef('/guid');
  const authenticatedUser = status === 'authenticated' && user ? user : undefined;

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  useEffect(() => {
    if (isWorkspaceFeatureRoute) {
      setWorkspaceToolsExpanded(true);
    }
  }, [isWorkspaceFeatureRoute]);

  useEffect(() => {
    window.localStorage.setItem(WORKSPACE_TOOLS_EXPANDED_KEY, String(workspaceToolsExpanded));
  }, [workspaceToolsExpanded]);

  const handleNewChat = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    navigateWithoutBlockingInput('/guid', { state: { resetAssistant: true } });
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleSettingsClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    if (isSettings) {
      const target = lastNonSettingsPathRef.current || '/guid';
      navigateWithoutBlockingInput(target);
    } else {
      navigateWithoutBlockingInput('/settings/agent');
    }
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleConversationSelect = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    // Do NOT call closePreview() here. conversation/index.tsx calls
    // closePreviewIfWorkspaceChanged() once the conversation data loads, which
    // keeps the preview open when switching between conversations of the same
    // project and closes it only when the workspace actually changes.
    setIsBatchMode(false);
  };

  const handleScheduledClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    navigateWithoutBlockingInput('/scheduled');
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleAssistantClick = () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    setIsBatchMode(false);
    navigateWithoutBlockingInput('/assistants');
    if (onSessionClick) {
      onSessionClick();
    }
  };

  const handleWorkspaceFeatureClick = useCallback(
    (target: string) => {
      cleanupSiderTooltips();
      blurActiveElement();
      closePreview();
      setIsBatchMode(false);
      navigateWithoutBlockingInput(target);
      onSessionClick?.();
    },
    [closePreview, navigateWithoutBlockingInput, onSessionClick]
  );

  const handleLogout = useCallback(async () => {
    cleanupSiderTooltips();
    blurActiveElement();
    closePreview();
    try {
      await logout();
    } catch (error) {
      console.error('Logout failed:', error);
      return; // logout 失败时不执行后续操作
    }
    if (onSessionClick) {
      onSessionClick();
    }
  }, [closePreview, logout, onSessionClick]);

  useEffect(() => {
    if (!authenticatedUser) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        handleLogout();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [authenticatedUser, handleLogout]);

  const tooltipEnabled = collapsed && !isMobile;
  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);

  const workspaceHistoryProps = {
    collapsed,
    tooltipEnabled,
    onSessionClick,
    batchMode: isBatchMode,
    onBatchModeChange: setIsBatchMode,
  };

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-hidden'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider collapsed={collapsed} tooltipEnabled={tooltipEnabled} />
          </Suspense>
        ) : (
          <div className='size-full flex flex-col gap-2px'>
            <SiderToolbar
              isMobile={isMobile}
              isBatchMode={isBatchMode}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onNewChat={handleNewChat}
              onToggleBatchMode={() => setIsBatchMode((prev) => !prev)}
            />
            {/* Search entry — desktop moves this into the titlebar toolbar;
                mobile keeps it here in the sidebar. */}
            {isMobile && (
              <SiderSearchEntry
                isMobile={isMobile}
                collapsed={collapsed}
                siderTooltipProps={siderTooltipProps}
                onConversationSelect={handleConversationSelect}
                onSessionClick={onSessionClick}
              />
            )}
            {/* Assistant nav entry - fixed above Scheduled */}
            <SiderAssistantEntry
              isMobile={isMobile}
              isActive={pathname.startsWith('/assistants')}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleAssistantClick}
            />
            {/* Scheduled tasks nav entry - fixed above scroll */}
            <SiderScheduledEntry
              isMobile={isMobile}
              isActive={pathname === '/scheduled'}
              collapsed={collapsed}
              siderTooltipProps={siderTooltipProps}
              onClick={handleScheduledClick}
            />
            <section
              className={classNames(siderStyles.workspaceToolsSection, collapsed && siderStyles.isCompact)}
              data-testid='sider-workspace-tools'
            >
              <button
                type='button'
                aria-controls='sider-workspace-tools-content'
                aria-expanded={workspaceToolsExpanded}
                aria-label={
                  workspaceToolsExpanded
                    ? t('common.winkGoWorkspace.collapseTools')
                    : t('common.winkGoWorkspace.expandTools')
                }
                className={siderStyles.workspaceToolsToggle}
                data-testid='sider-workspace-tools-toggle'
                onClick={() => setWorkspaceToolsExpanded((expanded) => !expanded)}
              >
                {!collapsed && (
                  <>
                    <span className={siderStyles.workspaceToolsBrand}>
                      <span className={siderStyles.workspaceToolsLabel}>{t('common.winkGoWorkspace.toolsGroup')}</span>
                    </span>
                    <span className={siderStyles.workspaceToolsCount}>4</span>
                  </>
                )}
                <Down
                  className={classNames(
                    siderStyles.workspaceToolsChevron,
                    workspaceToolsExpanded && siderStyles.isExpanded
                  )}
                  theme='outline'
                  size='14'
                  fill='currentColor'
                />
              </button>
              <div
                id='sider-workspace-tools-content'
                aria-hidden={!workspaceToolsExpanded}
                className={classNames(
                  siderStyles.workspaceToolsContent,
                  workspaceToolsExpanded && siderStyles.isExpanded
                )}
              >
                <div className={siderStyles.workspaceToolsInner}>
                  <SiderFeatureEntry
                    label={t('common.winkGoWorkspace.formatStudio')}
                    icon={<FileConversion theme='outline' size='17' fill='currentColor' />}
                    isMobile={isMobile}
                    isActive={pathname.startsWith('/format-studio')}
                    collapsed={collapsed}
                    siderTooltipProps={siderTooltipProps}
                    testId='sider-format-studio'
                    onClick={() => handleWorkspaceFeatureClick('/format-studio')}
                  />
                  <SiderFeatureEntry
                    label={t('common.winkGoWorkspace.mcpConfiguration')}
                    icon={<ConnectionPointTwo theme='outline' size='17' fill='currentColor' />}
                    isMobile={isMobile}
                    isActive={pathname.startsWith('/mcp')}
                    collapsed={collapsed}
                    siderTooltipProps={siderTooltipProps}
                    testId='sider-mcp-configuration'
                    onClick={() => handleWorkspaceFeatureClick('/mcp')}
                  />
                  <SiderFeatureEntry
                    label={t('common.winkGoWorkspace.inspirationCenter')}
                    icon={<Tips theme='outline' size='17' fill='currentColor' />}
                    isMobile={isMobile}
                    isActive={pathname.startsWith('/inspiration')}
                    collapsed={collapsed}
                    siderTooltipProps={siderTooltipProps}
                    testId='sider-inspiration-center'
                    onClick={() => handleWorkspaceFeatureClick('/inspiration')}
                  />
                  <SiderFeatureEntry
                    label={t('common.winkGoWorkspace.skillCenter')}
                    icon={<Lightning theme='outline' size='16' fill='currentColor' />}
                    isMobile={isMobile}
                    isActive={pathname.startsWith('/skills')}
                    collapsed={collapsed}
                    siderTooltipProps={siderTooltipProps}
                    testId='sider-skill-center'
                    onClick={() => handleWorkspaceFeatureClick('/skills')}
                  />
                </div>
              </div>
            </section>
            {/* Divider between fixed top nav and scrollable content area */}
            <div
              className={classNames(
                'shrink-0 mt-6px mb-2px h-1px bg-[var(--color-border-2)]',
                collapsed ? 'mx-6px' : 'mx-10px'
              )}
            />
            {/* Scrollable content: pinned → team (slot) → projects → conversations */}
            <div className={classNames('flex-1 min-h-0 overflow-y-auto', siderStyles.scrollArea)}>
              <Suspense fallback={<div className='min-h-200px' />}>
                <WorkspaceGroupedHistory
                  {...workspaceHistoryProps}
                  afterPinnedContent={
                    <>
                      <TeamSiderSection
                        collapsed={collapsed}
                        pathname={pathname}
                        siderTooltipProps={siderTooltipProps}
                        onSessionClick={onSessionClick}
                      />
                    </>
                  }
                />
              </Suspense>
            </div>
          </div>
        )}
      </div>
      {/* Footer */}
      <SiderFooter
        isMobile={isMobile}
        isSettings={isSettings}
        collapsed={collapsed}
        siderTooltipProps={siderTooltipProps}
        onSettingsClick={handleSettingsClick}
        onSettingsIntent={preloadSettingsShell}
        user={authenticatedUser}
        onLogoutClick={handleLogout}
      />
    </div>
  );
};

export default Sider;
