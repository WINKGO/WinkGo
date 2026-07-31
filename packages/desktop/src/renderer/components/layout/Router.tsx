// Modified from AionUI by WINK GO contributors in 2026.
import React, { Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import AppLoader from '@renderer/components/layout/AppLoader';
import { useAuth } from '@renderer/hooks/context/AuthContext';
import { TEAM_MODE_ENABLED } from '@/common/config/constants';
const Conversation = React.lazy(() => import('@renderer/pages/conversation'));
const Guid = React.lazy(() => import('@renderer/pages/guid'));
const AgentSettings = React.lazy(() => import('@renderer/pages/settings/AgentSettings'));
const AgentRepairPage = React.lazy(() => import('@renderer/pages/settings/AgentSettings/AgentRepairPage'));
const loadAssistantSettings = () => import('@renderer/pages/settings/AssistantSettings');
const loadSkillsSettings = () => import('@renderer/pages/settings/SkillsSettings/SkillsHubSettings');
const loadToolsSettings = () => import('@renderer/pages/settings/ToolsSettings');
const loadScheduledTasksPage = () => import('@renderer/pages/cron/ScheduledTasksPage');
const loadFormatStudioPage = () => import('@renderer/pages/winkgo/FormatStudioPage');
const loadInspirationCenterPage = () => import('@renderer/pages/winkgo/InspirationCenterPage');

const AssistantSettings = React.lazy(loadAssistantSettings);
const SkillsSettings = React.lazy(loadSkillsSettings);
const SkillDetailPage = React.lazy(() => import('@renderer/pages/settings/SkillsSettings/SkillDetailPage'));
const ToolsSettings = React.lazy(loadToolsSettings);
const AppearanceSettings = React.lazy(() => import('@renderer/pages/settings/AppearanceSettings'));
const ModeSettings = React.lazy(() => import('@renderer/pages/settings/ModeSettings'));
const SystemSettings = React.lazy(() => import('@renderer/pages/settings/SystemSettings'));
const WebuiSettings = React.lazy(() => import('@renderer/pages/settings/WebuiSettings'));
const PetSettings = React.lazy(() => import('@renderer/pages/settings/PetSettings'));
const IslandFilesSettings = React.lazy(() => import('@renderer/pages/settings/IslandFilesSettings'));
const ExtensionSettingsPage = React.lazy(() => import('@renderer/pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('@renderer/pages/login'));
const ComponentsShowcase = React.lazy(() => import('@renderer/pages/TestShowcase'));
const ScheduledTasksPage = React.lazy(loadScheduledTasksPage);
const TaskDetailPage = React.lazy(() => import('@renderer/pages/cron/ScheduledTasksPage/TaskDetailPage'));
const TeamIndex = React.lazy(() => import('@renderer/pages/team'));
const FormatStudioPage = React.lazy(loadFormatStudioPage);
const InspirationCenterPage = React.lazy(loadInspirationCenterPage);
const KnowledgeCanvasPage = React.lazy(() => import('@renderer/pages/winkgo/KnowledgeCanvasPage'));

const WarmWorkspaceRoutes: React.FC = () => {
  useEffect(() => {
    // Warm high-frequency routes without asking low-end machines to parse six
    // large chunks at once. One chunk is loaded per idle period, leaving input,
    // navigation and the first paint ahead of background preparation.
    const loaders = [
      loadFormatStudioPage,
      loadToolsSettings,
      loadInspirationCenterPage,
      loadSkillsSettings,
      loadScheduledTasksPage,
      loadAssistantSettings,
    ];
    let nextLoaderIndex = 0;
    let cancelled = false;
    let timeoutId: number | undefined;
    let idleId: number | undefined;

    const scheduleNext = (delay = 80) => {
      if (cancelled || nextLoaderIndex >= loaders.length) return;

      timeoutId = window.setTimeout(() => {
        const loadNext = () => {
          if (cancelled) return;
          const loader = loaders[nextLoaderIndex++];
          void loader()
            .catch(() => {
              // A direct route visit will retry through React.lazy.
            })
            .finally(() => scheduleNext());
        };

        if ('requestIdleCallback' in window) {
          idleId = window.requestIdleCallback(loadNext, { timeout: 1200 });
        } else {
          loadNext();
        }
      }, delay);
    };

    scheduleNext(300);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (idleId !== undefined && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
    };
  }, []);

  return null;
};

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <Suspense fallback={<AppLoader />}>
    <Component />
  </Suspense>
);

/**
 * Legacy `/settings/capabilities?tab=tools` deep links now map to the standalone
 * Tools page; everything else (skills tab or no tab) lands on the Skills page.
 */
const CapabilitiesRedirect: React.FC = () => {
  const { search } = useLocation();
  const tab = new URLSearchParams(search).get('tab');
  return <Navigate to={tab === 'tools' ? '/settings/tools' : '/settings/skills'} replace />;
};

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return (
    <>
      <WarmWorkspaceRoutes />
      {React.cloneElement(layout)}
    </>
  );
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  return (
    <HashRouter>
      <Routes>
        <Route
          path='/login'
          element={status === 'authenticated' ? <Navigate to='/guid' replace /> : withRouteFallback(LoginPage)}
        />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<Navigate to='/guid' replace />} />
          <Route path='/guid' element={withRouteFallback(Guid)} />
          <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
          <Route
            path='/team/:id'
            element={TEAM_MODE_ENABLED ? withRouteFallback(TeamIndex) : <Navigate to='/guid' replace />}
          />
          <Route path='/settings/model' element={withRouteFallback(ModeSettings)} />
          <Route path='/assistants' element={withRouteFallback(AssistantSettings)} />
          {/* Assistants moved out of Settings to a top-level entry; keep a redirect
              so old deep links / back-nav still land on the new page. */}
          <Route path='/settings/assistants' element={<Navigate to='/assistants' replace />} />
          <Route path='/settings/agent' element={withRouteFallback(AgentSettings)} />
          <Route path='/settings/agent/:id/repair' element={withRouteFallback(AgentRepairPage)} />
          {/* Skills and Tools are top-level settings entries. */}
          <Route path='/settings/skills' element={withRouteFallback(SkillsSettings)} />
          <Route path='/settings/skills/import-history' element={withRouteFallback(SkillsSettings)} />
          <Route path='/settings/skills/detail/:skillName' element={withRouteFallback(SkillDetailPage)} />
          <Route path='/settings/tools' element={withRouteFallback(ToolsSettings)} />
          {/* Legacy routes — the previous combined "Capabilities" page is now two pages. */}
          <Route path='/settings/capabilities' element={<CapabilitiesRedirect />} />
          <Route
            path='/settings/capabilities/skills/import-history'
            element={<Navigate to='/settings/skills/import-history' replace />}
          />
          <Route path='/settings/skills-hub' element={<Navigate to='/settings/skills' replace />} />
          {/* WINK GO workspace entries keep the main sidebar mounted and reuse
              the existing Skills and MCP implementations where possible. */}
          <Route path='/format-studio' element={withRouteFallback(FormatStudioPage)} />
          <Route path='/mcp' element={withRouteFallback(ToolsSettings)} />
          <Route path='/inspiration' element={withRouteFallback(InspirationCenterPage)} />
          <Route path='/knowledge-canvas' element={withRouteFallback(KnowledgeCanvasPage)} />
          <Route path='/skills' element={withRouteFallback(SkillsSettings)} />
          <Route path='/settings/appearance' element={withRouteFallback(AppearanceSettings)} />
          <Route path='/settings/display' element={<Navigate to='/settings/appearance' replace />} />
          <Route path='/settings/webui' element={withRouteFallback(WebuiSettings)} />
          <Route path='/settings/pet' element={withRouteFallback(PetSettings)} />
          <Route path='/settings/island-files' element={withRouteFallback(IslandFilesSettings)} />
          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/about' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings' element={<Navigate to='/settings/agent' replace />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
          <Route path='/scheduled' element={withRouteFallback(ScheduledTasksPage)} />
          <Route path='/scheduled/:job_id' element={withRouteFallback(TaskDetailPage)} />
        </Route>
        <Route path='*' element={<Navigate to={status === 'authenticated' ? '/guid' : '/login'} replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
