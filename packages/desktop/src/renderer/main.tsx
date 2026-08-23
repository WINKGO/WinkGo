// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

// Sentry must be initialized first
// Use electron-specific renderer package only inside Electron; fall back to the
// browser SDK when running as a web server (no window.electronAPI).
if ((window as { electronAPI?: unknown }).electronAPI) {
  // Dynamic import avoids bundling sentry-ipc:// protocol code into the web build
  import('@sentry/electron/renderer')
    .then((Sentry) =>
      Sentry.init({
        // Manual feedback uses captureEvent directly. Automatic browser error,
        // session, breadcrumb and performance integrations stay disabled.
        defaultIntegrations: [],
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend(event) {
          const isUserInitiatedFeedback =
            event.tags?.type === 'user-feedback' ||
            event.tags?.['winkgo.installation_integrity.user_report'] === 'true';
          if (!isUserInitiatedFeedback) {
            return null;
          }
          if (!(window as { __backendStartupFailed?: boolean }).__backendStartupFailed) {
            return event;
          }
          const haystacks: string[] = [];
          if (event.message) haystacks.push(event.message);
          const exceptions = event.exception?.values ?? [];
          for (const ex of exceptions) {
            if (ex.value) haystacks.push(ex.value);
          }
          if (haystacks.some((h) => /Failed to fetch|window\.__backendPort|__backendPort unset/.test(h))) {
            return null;
          }
          return event;
        },
      })
    )
    .catch(() => {});
}

// Runtime patches must be imported early
import './utils/ui/runtimePatches';

// Browser adapter setup
import '@/common/adapter/browser';

// React and core dependencies
import type { PropsWithChildren } from 'react';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { TFunction } from 'i18next';
import { SWRConfig } from 'swr';

// Context providers
import { AuthProvider } from './hooks/context/AuthContext';
import { FeedbackProvider } from './hooks/context/FeedbackContext';
import { ThemeProvider } from './hooks/context/ThemeContext';
import { PreviewProvider } from './pages/conversation/Preview/context/PreviewContext';

// Arco Design
import { ConfigProvider, Modal, Typography } from '@arco-design/web-react';
// Configure Arco Design to use React 18's createRoot, fixing Message component's CopyReactDOM.render error
import '@arco-design/web-react/es/_util/react-19-adapter';
import '@arco-design/web-react/dist/css/arco.css';
import enUS from '@arco-design/web-react/es/locale/en-US';
import jaJP from '@arco-design/web-react/es/locale/ja-JP';
import zhCN from '@arco-design/web-react/es/locale/zh-CN';
import zhTW from '@arco-design/web-react/es/locale/zh-TW';
import koKR from '@arco-design/web-react/es/locale/ko-KR';
import { useTranslation } from 'react-i18next';

// Styles
import 'uno.css';
import './styles/arco-override.css';
import './styles/themes/index.css';
import './styles/markdown.css';

// Config service — kick off initialization before i18n / theme modules load,
// so their startup paths (which await configService.whenReady()) observe the
// authoritative settings from the backend instead of the empty cache.
import { configService } from '@/common/config/configService';
configService.initialize().catch((err) => {
  console.error('Failed to initialize config:', err);
});

// i18n
import { i18nStartup } from './services/i18n';
import { registerPwa } from './services/registerPwa';
import { createRuntimeInstallationReconciler } from './services/runtimeInstallationReconciler';

import { ipcBridge } from '@/common';
import { repairAllCronJobTimeZonesOnce } from '@renderer/pages/cron/repairCronJobTimeZone';
import { bootstrapRendererConfig } from '@renderer/services/bootstrapRenderer';

// Components and utilities
import Layout from './components/layout/Layout';
import { BackendStartingView, BackendStartupGate } from './components/layout/AppLoader';
import Router from './components/layout/Router';
import Sider from './components/layout/Sider';
import DesktopIslandWindow from './components/layout/Titlebar/DesktopIslandWindow';
import { useAuth } from './hooks/context/AuthContext';
import { ConversationHistoryProvider } from './hooks/context/ConversationHistoryContext';
import HOC from './utils/ui/HOC';
import type { BackendStartupFailureInfo } from '@/common/types/platform/electron';

const UpdateModal = React.lazy(() => import('@/renderer/components/settings/UpdateModal'));
import type { IRuntimeStatusEvent, RuntimeFailureKind } from '@/common/adapter/ipcBridge';
import {
  InstallationIntegrityContent,
  InstallationIntegrityModalHost,
  type InstallationIntegrityDiagnostics,
  getBackendStartupInstallationDescription,
  getDownloadLatestModalActionProps,
  getRuntimeComponentInstallationDescription,
  showInstallationIntegrityModal,
} from './components/layout/InstallationIntegrityDialog';

// Patch Korean locale with missing properties from English locale
const koKRComplete = {
  ...koKR,
  Calendar: {
    ...koKR.Calendar,
    monthFormat: enUS.Calendar.monthFormat,
    yearFormat: enUS.Calendar.yearFormat,
  },
  DatePicker: {
    ...koKR.DatePicker,
    Calendar: {
      ...koKR.DatePicker.Calendar,
      monthFormat: enUS.Calendar.monthFormat,
      yearFormat: enUS.Calendar.yearFormat,
    },
  },
  Form: enUS.Form,
  ColorPicker: enUS.ColorPicker,
};

const arcoLocales: Record<string, typeof enUS> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'ja-JP': jaJP,
  'ko-KR': koKRComplete,
  'en-US': enUS,
};

const INSTALLATION_INTEGRITY_FAILURES = new Set<RuntimeFailureKind>([
  'bundled_resource_missing',
  'bundled_resource_invalid',
  'validation_failed',
]);

function isInstallationIntegrityFailure(kind: RuntimeFailureKind | undefined): boolean {
  return INSTALLATION_INTEGRITY_FAILURES.has(kind ?? 'unknown');
}

const BACKGROUND_STARTUP_TRANSIENT_FAILURES = new Set<RuntimeFailureKind>([
  'timeout',
  'download_failed',
  'http_status',
  'unknown',
]);

function isBackgroundStartupTransientFailure(event: IRuntimeStatusEvent): boolean {
  return (
    event.scope.kind === 'custom_agent' &&
    event.scope.id === 'startup' &&
    BACKGROUND_STARTUP_TRANSIENT_FAILURES.has(event.failure_kind ?? 'unknown')
  );
}

function captureRuntimeInstallationIntegrityFailure(event: IRuntimeStatusEvent): void {
  if (!isInstallationIntegrityFailure(event.failure_kind)) {
    return;
  }

  void import('@sentry/electron/renderer')
    .then((Sentry) => {
      Sentry.withScope((scope) => {
        scope.setTag('winkgo.installation_integrity', event.failure_kind ?? 'unknown');
        scope.setTag('winkgo.runtime_resource', event.resource);
        scope.setTag('winkgo.runtime_resource_id', event.resource_id ?? '');
        scope.setTag('winkgo.runtime_scope', event.scope.kind);
        Sentry.captureMessage('runtime-installation-integrity-failure', 'error');
      });
    })
    .catch(() => {});
}

function buildRuntimeInstallationDiagnostics(
  event: IRuntimeStatusEvent,
  description: string
): InstallationIntegrityDiagnostics {
  return {
    source: 'runtime_status',
    description,
    runtime: {
      failureKind: event.failure_kind,
      message: event.message,
      phase: event.phase,
      resource: event.resource,
      resourceId: event.resource_id,
      scopeId: event.scope.id,
      scopeKind: event.scope.kind,
    },
  };
}

function resolveRuntimeResourceLabel(event: IRuntimeStatusEvent, t: TFunction): string {
  if (event.resource === 'node') {
    return t('settings.runtimeResource.node');
  }
  if (event.resource_id === 'codex-acp') {
    return t('settings.runtimeResource.codexAcp');
  }
  if (event.resource_id === 'claude-agent-acp') {
    return t('settings.runtimeResource.claudeAgentAcp');
  }
  return t('settings.runtimeResource.acpTool');
}

const RuntimeFailureDialogs: React.FC = () => {
  const { t } = useTranslation();
  const [modal, modalContextHolder] = Modal.useModal();
  const shownFailuresRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const reconciler = createRuntimeInstallationReconciler({
      showDialog: (event) => {
        const resource = resolveRuntimeResourceLabel(event, t);
        const description = getRuntimeComponentInstallationDescription(t, resource);
        const controller = showInstallationIntegrityModal(
          modal,
          t,
          description,
          buildRuntimeInstallationDiagnostics(event, description)
        );
        return { close: () => controller.close() };
      },
      report: captureRuntimeInstallationIntegrityFailure,
    });

    const offStatus = ipcBridge.runtime.statusChanged.on((event: IRuntimeStatusEvent) => {
      // Startup runtime preparation is best-effort. Network failures must not
      // block the whole desktop app; an actual Agent/MCP launch will retry and
      // surface the scoped error if the runtime is still unavailable.
      if (isBackgroundStartupTransientFailure(event)) {
        console.warn('[WinkGo] Background Node runtime preparation deferred:', event);
        return;
      }

      if (
        (event.phase === 'failed' && isInstallationIntegrityFailure(event.failure_kind)) ||
        (event.phase === 'ready' && event.resource === 'node')
      ) {
        reconciler.handleStatus(event);
        return;
      }

      if (event.phase !== 'failed') {
        return;
      }

      const signature = [
        event.resource,
        event.resource_id ?? '',
        event.scope.kind,
        event.scope.id,
        event.failure_kind ?? 'unknown',
        event.message ?? '',
      ].join('|');
      if (shownFailuresRef.current.has(signature)) {
        return;
      }
      shownFailuresRef.current.add(signature);

      const resource = resolveRuntimeResourceLabel(event, t);
      modal.error({
        title: t('common.error'),
        content: <InstallationIntegrityContent description={t('settings.runtimeStatus.failedUnknown', { resource })} />,
        okText: t('common.confirm'),
        closable: false,
        maskClosable: false,
      });
    });

    const onBeforeUnload = () => reconciler.flushPending();
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      offStatus();
      reconciler.flushPending();
      reconciler.dispose();
    };
  }, [modal, t]);

  return <>{modalContextHolder}</>;
};

const SWR_DEFAULTS = { revalidateOnFocus: false } as const;

const AppProviders: React.FC<PropsWithChildren> = ({ children }) =>
  React.createElement(
    SWRConfig,
    { value: SWR_DEFAULTS },
    React.createElement(
      AuthProvider,
      null,
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          PreviewProvider,
          null,
          React.createElement(
            FeedbackProvider,
            null,
            React.createElement(React.Fragment, null, React.createElement(RuntimeFailureDialogs, null), children)
          )
        )
      )
    )
  );

const Config: React.FC<PropsWithChildren> = ({ children }) => {
  const {
    i18n: { language },
  } = useTranslation();
  const arcoLocale = arcoLocales[language] ?? enUS;

  return React.createElement(ConfigProvider, { theme: { primaryColor: '#4E5969' }, locale: arcoLocale }, children);
};

const Main = () => {
  const { ready } = useAuth();
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => {
    if (!ready) return;
    void bootstrapRendererConfig().finally(() => setConfigReady(true));
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    void repairAllCronJobTimeZonesOnce();
  }, [ready]);

  if (!ready || !configReady) {
    return null;
  }

  return (
    <>
      <Router
        layout={
          <ConversationHistoryProvider>
            <Layout sider={<Sider />} />
          </ConversationHistoryProvider>
        }
      />
      <Suspense fallback={null}>
        <UpdateModal />
      </Suspense>
    </>
  );
};

const App = HOC.Wrapper(Config)(Main);
const DesktopIslandApp = HOC.Wrapper(Config)(DesktopIslandWindow);

const BackendStartupFailureDialog: React.FC<{ failure: BackendStartupFailureInfo }> = ({ failure }) => {
  const { t } = useTranslation();

  const isIncompatibleRuntime = failure.reason === 'backend_incompatible_runtime';
  const isPackageArchitectureMismatch = failure.reason === 'backend_package_architecture_mismatch';
  const isDataMigrationFailure = failure.reason === 'backend_data_migration_failed';
  const isDatabaseNewerThanApp = failure.reason === 'backend_database_newer_than_app';
  const isLocalDataRepairFailure = failure.reason === 'backend_local_data_repair_failed';
  const isRecoverableDatabaseCorruption = failure.reason === 'backend_recoverable_database_corruption';
  const isTransientConcurrentStartup = failure.reason === 'backend_transient_concurrent_startup';
  const isStartupDirectoryFailure = failure.reason === 'backend_startup_directory_unavailable';
  const isStartupExited = failure.reason === 'backend_startup_exited';
  const isPortReportTimeout = failure.reason === 'backend_startup_port_report_timeout';
  const isStartupFailed = failure.reason === 'backend_startup_failed';
  const title = t('common.backendStartup.incompatibleRuntime.title');
  const description = isIncompatibleRuntime
    ? t('common.backendStartup.incompatibleRuntime.description')
    : isPackageArchitectureMismatch
      ? t('common.backendStartup.packageArchitectureMismatch.description', {
          packageArch: failure.packageArch ?? 'x64',
          deviceArch: failure.deviceArch ?? 'arm64',
          expectedArch: failure.expectedDownloadArch ?? 'arm64',
        })
      : isDatabaseNewerThanApp
        ? failure.appVersion
          ? t('common.backendStartup.databaseNewerThanApp.descriptionWithVersion', {
              currentVersion: failure.appVersion,
            })
          : t('common.backendStartup.databaseNewerThanApp.description')
        : isDataMigrationFailure
          ? t('common.backendStartup.dataMigration.description')
          : isLocalDataRepairFailure
          ? t('common.backendStartup.localDataRepair.description')
          : isTransientConcurrentStartup
            ? t('common.backendStartup.transientConcurrentStartup.description')
            : isStartupExited
              ? t('common.backendStartup.exited.description')
              : isPortReportTimeout
                ? t('common.backendStartup.portReportTimeout.description')
                : isStartupFailed
                  ? t('common.backendStartup.startupFailed.description')
                  : isStartupDirectoryFailure
                    ? t('common.backendStartup.startupDirectory.description')
                    : isRecoverableDatabaseCorruption
                      ? t('common.backendStartup.recoverableDatabaseCorruption.description')
                      : getBackendStartupInstallationDescription(t);
  const requiredVersions = failure.requiredVersions?.map((version) => `GLIBC_${version}`).join(', ');

  if (!isIncompatibleRuntime && !isPackageArchitectureMismatch) {
    return (
      <div className='min-h-screen bg-bg-1'>
        <InstallationIntegrityModalHost
          description={description}
          diagnosticsKind={
            isTransientConcurrentStartup
              ? 'transient_concurrent_startup'
              : isStartupExited
                ? 'backend_exited'
                : isPortReportTimeout
                  ? 'port_report_timeout'
                  : isStartupFailed
                    ? 'startup_failed'
                    : isRecoverableDatabaseCorruption
                      ? 'recoverable_database_corruption'
                      : isStartupDirectoryFailure
                        ? 'startup_directory'
                        : isLocalDataRepairFailure
                          ? 'local_data_repair'
                          : isDatabaseNewerThanApp
                            ? 'database_newer_than_app'
                            : isDataMigrationFailure
                              ? 'data_migration'
                              : 'incomplete_installation'
          }
          diagnostics={{
            source: 'backend_startup_failure',
            description,
            backendStartupFailure: failure as unknown as Record<string, unknown>,
          }}
        />
      </div>
    );
  }

  if (isPackageArchitectureMismatch) {
    return (
      <div className='min-h-screen bg-bg-1'>
        <Modal
          visible
          closable={false}
          maskClosable={false}
          title={t('common.backendStartup.packageArchitectureMismatch.title')}
          {...getDownloadLatestModalActionProps(t)}
        >
          <InstallationIntegrityContent description={description} />
        </Modal>
      </div>
    );
  }

  return (
    <div className='min-h-screen bg-bg-1'>
      <Modal visible closable={false} maskClosable={false} footer={null} title={title}>
        <div className='text-t-1'>
          <Typography.Paragraph className='mb-0 text-t-secondary'>{description}</Typography.Paragraph>
          {requiredVersions ? (
            <Typography.Paragraph className='mt-12px mb-0 text-12px text-t-tertiary'>
              {t('common.backendStartup.incompatibleRuntime.requiredVersions', { versions: requiredVersions })}
            </Typography.Paragraph>
          ) : null}
        </div>
      </Modal>
    </div>
  );
};

void registerPwa();

function renderRoot(): void {
  const root = createRoot(document.getElementById('root')!);
  const isDesktopIslandWindow = window.location.hash === '#/desktop-island';
  if (isDesktopIslandWindow) {
    root.render(
      <ThemeProvider>
        <DesktopIslandApp />
      </ThemeProvider>
    );
    return;
  }

  root.render(
    <BackendStartupGate
      renderStarting={() => (
        <Config>
          <BackendStartingView />
        </Config>
      )}
      renderFailure={(failure) => (
        <Config>
          <BackendStartupFailureDialog failure={failure} />
        </Config>
      )}
      renderApp={() => (
        <AppProviders>
          <App />
        </AppProviders>
      )}
    />
  );
}

void i18nStartup.catch(() => {}).finally(renderRoot);
