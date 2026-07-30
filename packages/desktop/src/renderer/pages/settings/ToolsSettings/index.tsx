/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ToolsSettings — standalone settings page for MCP servers and built-in tools
 * (e.g. image generation). Split out of the former combined "Capabilities" page
 * so Tools has its own top-level entry in the settings sidebar.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Button } from '@arco-design/web-react';
import { Api, Cpu } from '@icon-park/react';
import ToolsModalContent from '@/renderer/components/settings/SettingsModal/contents/ToolsModalContent';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import SettingsPageHeader from '../components/SettingsPageHeader';
import XiaozhiMcpConnection from './XiaozhiMcpConnection';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import WinkGoProFeatureCard from '@/renderer/components/winkgo/WinkGoProFeatureCard';

const ToolsSettings: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const { can } = useAuth();
  const isMcpWorkspace = location.pathname === '/mcp';
  const [workspace, setWorkspace] = React.useState<'servers' | 'xiaozhi'>('servers');

  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      <div className='flex flex-col gap-16px'>
        <SettingsPageHeader
          data-testid='tools-header'
          sticky={!isMcpWorkspace}
          title={isMcpWorkspace ? 'MCP 配置' : t('settings.tools', { defaultValue: 'Tools' })}
          description={
            isMcpWorkspace
              ? '管理通用 MCP 服务，以及 ESP32 小智与手机小程序的独立设备通道。'
              : t('settings.toolsDescription', {
                  defaultValue: 'Configure MCP servers and built-in tools such as image generation.',
                })
          }
          actions={
            isMcpWorkspace ? (
              <div
                className='flex items-center gap-4px rd-10px border border-border-2 bg-fill-1 p-3px'
                data-testid='mcp-workspace-switch'
              >
                <Button
                  className={workspace === 'servers' ? '!bg-1 !shadow-sm' : ''}
                  icon={<Api theme='outline' size='14' />}
                  size='small'
                  type={workspace === 'servers' ? 'secondary' : 'text'}
                  onClick={() => setWorkspace('servers')}
                >
                  通用 MCP
                </Button>
                <Button
                  className={workspace === 'xiaozhi' ? '!bg-1 !shadow-sm' : ''}
                  icon={<Cpu theme='outline' size='14' />}
                  size='small'
                  type={workspace === 'xiaozhi' ? 'secondary' : 'text'}
                  onClick={() => setWorkspace('xiaozhi')}
                >
                  小智 MCP 连接 {!can('mcp.miniapp') && <span className='ml-4px text-10px'>PRO</span>}
                </Button>
              </div>
            ) : undefined
          }
        />
        {!isMcpWorkspace || workspace === 'servers' ? (
          <ToolsModalContent />
        ) : (
          <WinkGoProFeatureCard
            capability='mcp.miniapp'
            title='小智与手机小程序连接属于 WINK GO Pro'
            description='升级后可使用独立设备身份、手机绑定转发、ESP32 小智通道和远程连接诊断。'
          >
            <XiaozhiMcpConnection />
          </WinkGoProFeatureCard>
        )}
      </div>
    </SettingsPageWrapper>
  );
};

export default ToolsSettings;
