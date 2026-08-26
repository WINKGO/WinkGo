// Modified from AionUI by WINK GO contributors in 2026.
import type { BackendStartupFailureInfo } from '@/common/types/platform/electron';
import { Spin, Typography } from '@arco-design/web-react';
import type { ReactNode } from 'react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const AppLoader: React.FC = () => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <Spin dot />
    </div>
  );
};

export const BackendStartingView: React.FC = () => {
  const { t } = useTranslation();

  return (
    <div
      className='min-h-screen bg-bg-1 flex flex-col items-center justify-center gap-16px'
      data-testid='backend-starting-view'
    >
      <Spin size={28} />
      <div className='text-center px-24px max-w-480px'>
        <Typography.Title heading={5} className='mb-8px text-t-1'>
          {t('common.backendStartup.pendingSlow.title')}
        </Typography.Title>
        <Typography.Paragraph className='mb-0 text-t-secondary' data-testid='backend-starting-description'>
          {t('common.backendStartup.pendingSlow.description')}
        </Typography.Paragraph>
      </div>
    </div>
  );
};

export function shouldShowBackendStartupFailureDialog(
  reason: BackendStartupFailureInfo['reason'] | undefined
): boolean {
  return (
    reason === 'backend_incompatible_runtime' ||
    reason === 'backend_incomplete_installation' ||
    reason === 'backend_package_architecture_mismatch' ||
    reason === 'backend_data_migration_failed' ||
    reason === 'backend_database_newer_than_app' ||
    reason === 'backend_local_data_repair_failed' ||
    reason === 'backend_recoverable_database_corruption' ||
    reason === 'backend_transient_concurrent_startup' ||
    reason === 'backend_startup_exited' ||
    reason === 'backend_startup_port_report_timeout' ||
    reason === 'backend_startup_failed'
  );
}

export type BackendStartupGateProps = {
  renderStarting: () => ReactNode;
  renderFailure: (failure: BackendStartupFailureInfo) => ReactNode;
  renderApp: () => ReactNode;
};

export const BackendStartupGate: React.FC<BackendStartupGateProps> = ({ renderStarting, renderFailure, renderApp }) => {
  const [state, setState] = useState<BackendStartupFailureInfo | null>(
    () => window.__backendStartupBridge?.getState() ?? window.__backendStartupFailure ?? null
  );

  useEffect(() => {
    const bridge = window.__backendStartupBridge;
    if (!bridge) return;
    setState(bridge.getState());
    return bridge.subscribe(setState);
  }, []);

  if (state?.reason === 'backend_startup_pending_slow') {
    return <>{renderStarting()}</>;
  }

  if (state && shouldShowBackendStartupFailureDialog(state.reason)) {
    return <>{renderFailure(state)}</>;
  }

  return <>{renderApp()}</>;
};

export default AppLoader;
