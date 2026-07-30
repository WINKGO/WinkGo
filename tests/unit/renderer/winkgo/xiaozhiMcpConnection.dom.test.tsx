/**
 * @license
 * Copyright 2026 WINK GO
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  saveConfig: vi.fn(),
  testConnections: vi.fn(),
  startRuntime: vi.fn(),
  refreshBindingCode: vi.fn(),
  authorizeFirewall: vi.fn(),
  detectLanIp: vi.fn(),
  statusHandler: undefined as ((snapshot: typeof snapshot) => void) | undefined,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    winkGoXiaozhi: {
      getSnapshot: { invoke: mocks.getSnapshot },
      saveConfig: { invoke: mocks.saveConfig },
      testConnections: { invoke: mocks.testConnections },
      startRuntime: { invoke: mocks.startRuntime },
      refreshBindingCode: { invoke: mocks.refreshBindingCode },
      authorizeFirewall: { invoke: mocks.authorizeFirewall },
      detectLanIp: { invoke: mocks.detectLanIp },
      statusChanged: {
        on: (handler: (next: typeof snapshot) => void) => {
          mocks.statusHandler = handler;
          return () => {
            mocks.statusHandler = undefined;
          };
        },
      },
    },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    },
  };
});

import XiaozhiMcpConnection from '@renderer/pages/settings/ToolsSettings/XiaozhiMcpConnection';

const snapshot = {
  config: {
    schemaVersion: 3,
    runtimeApi: 'http://127.0.0.1:8121',
    lanIp: '192.168.5.16',
    bridgePort: 8776,
    relayUrl: 'wss://winkgo.top/desktop',
    relayEnabled: true,
    desktopId: 'WINKGO-DESKTOP',
    bindingCode: '',
    hardwareEnabled: true,
    mobileEnabled: true,
    hardwareEndpoint: 'wss://api.xiaozhi.me/mcp/',
    mobileEndpoint: 'wss://api.xiaozhi.me/mcp/',
    firewallAuthorized: true,
    lastSavedMs: 1,
    hardwareLastTest: {
      ok: true,
      message: '小智官方 WSS 握手成功。',
      toolCount: null,
      elapsedMs: 557,
      testedAtMs: 1,
    },
    mobileLastTest: {
      ok: true,
      message: '小智官方 WSS 握手成功。',
      toolCount: null,
      elapsedMs: 541,
      testedAtMs: 1,
    },
  },
  runtime: {
    ok: true,
    label: 'Runtime 8121',
    detail: 'Runtime 1.1.2 已就绪 · 424 个工具',
    elapsedMs: 88,
  },
  bridge: {
    ok: false,
    label: 'LAN Bridge 8776',
    detail: '可选端口当前未监听，不影响云端 MCP',
    elapsedMs: 1,
  },
  runtimeTokenConfigured: false,
  bridgeTokenConfigured: false,
  hardwareSecretConfigured: true,
  mobileSecretConfigured: true,
  runtimeInstalled: true,
  configPath: 'C:\\Users\\Administrator\\AppData\\Roaming\\com.winkgo.desktop\\mcp-channels.json',
  legacyCompatible: true,
  remoteGateway: {
    state: 'connected',
    enabled: true,
    connected: true,
    connecting: false,
    accountId: 'qa-account',
    installationId: 'qa-installation',
    desktopId: 'WINKGO-DESKTOP',
    deviceName: 'QA desktop',
    bindingCode: '1234567890',
    expiresInSeconds: 300,
    lastConnectedAt: '',
    lastSeenAt: '',
    lastError: '',
    relayUrl: 'wss://winkgo.top/desktop',
    migratedFromLegacy: false,
    enrolled: true,
    runtimeOnline: true,
    mcpReady: true,
  },
};

describe('XiaozhiMcpConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.statusHandler = undefined;
    mocks.getSnapshot.mockResolvedValue({ success: true, data: snapshot });
    mocks.saveConfig.mockResolvedValue({ success: true, data: snapshot });
    mocks.testConnections.mockResolvedValue({
      success: true,
      data: { message: '全部连接正常。', snapshot },
    });
    mocks.refreshBindingCode.mockResolvedValue({ success: true, data: snapshot });
    mocks.authorizeFirewall.mockResolvedValue({ success: true, data: snapshot });
  });

  it('loads the original dual-channel configuration without testing remote services on mount', async () => {
    render(<XiaozhiMcpConnection />);

    await waitFor(() =>
      expect(screen.getByTestId('xiaozhi-flow-runtime')).toHaveAttribute('title', 'Runtime 1.1.2 已就绪 · 424 个工具')
    );
    expect(screen.getByDisplayValue('192.168.5.16')).toBeTruthy();
    expect(screen.getAllByText('已安全保存').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('xiaozhi-config-runtime')).toBeInTheDocument();
    expect(screen.getByTestId('xiaozhi-config-lan')).toBeInTheDocument();
    expect(screen.getByTestId('xiaozhi-config-relay')).toBeInTheDocument();
    expect(screen.getByTestId('xiaozhi-config-security')).toBeInTheDocument();
    expect(mocks.testConnections).not.toHaveBeenCalled();
    expect(mocks.startRuntime).not.toHaveBeenCalled();
  });

  it('shows cloud mode as healthy when the optional LAN bridge is closed', async () => {
    render(<XiaozhiMcpConnection />);

    await waitFor(() => expect(mocks.getSnapshot).toHaveBeenCalledTimes(1));
    expect(screen.getByText('云端模式正常')).toBeTruthy();
    expect(screen.getByTestId('xiaozhi-flow-bridge')).toHaveAttribute('data-status', 'success');
    expect(screen.getByTestId('xiaozhi-flow-relay')).toHaveAttribute('data-status', 'success');
  });

  it('animates the connection chain immediately after the user starts a connection check', async () => {
    render(<XiaozhiMcpConnection />);

    await waitFor(() => expect(mocks.getSnapshot).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '检测并修复' }));

    await waitFor(() => {
      expect(screen.getByTestId('xiaozhi-connection-flow')).toHaveAttribute('data-animating', 'true');
      expect(screen.getByTestId('xiaozhi-flow-runtime')).toHaveAttribute('data-active', 'true');
    });
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
  });

  it('shows firewall health in the connection chain and requests UAC authorization on demand', async () => {
    const blockedSnapshot = {
      ...snapshot,
      config: { ...snapshot.config, firewallAuthorized: false },
    };
    mocks.getSnapshot.mockResolvedValue({ success: true, data: blockedSnapshot });
    render(<XiaozhiMcpConnection />);

    const firewallStep = await screen.findByTestId('xiaozhi-flow-firewall');
    expect(firewallStep).toHaveAttribute('data-status', 'warning');
    fireEvent.click(screen.getByRole('button', { name: 'LAN 防火墙放行' }));

    await waitFor(() => expect(mocks.authorizeFirewall).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('xiaozhi-flow-firewall')).toHaveAttribute('data-status', 'success');
  });

  it('lets the user recheck firewall rules even when the last snapshot was healthy', async () => {
    render(<XiaozhiMcpConnection />);

    const button = await screen.findByRole('button', { name: 'LAN 防火墙已放行' });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() => expect(mocks.authorizeFirewall).toHaveBeenCalledTimes(1));
  });

  it('marks an expired device code and lets the user request a new one', async () => {
    const expiredSnapshot = {
      ...snapshot,
      remoteGateway: {
        ...snapshot.remoteGateway,
        bindingCode: '6182653614',
        expiresInSeconds: 0,
      },
    };
    mocks.getSnapshot.mockResolvedValue({ success: true, data: expiredSnapshot });
    render(<XiaozhiMcpConnection />);

    expect(await screen.findByText('设备码已失效')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新获取设备码' }));

    await waitFor(() => expect(mocks.refreshBindingCode).toHaveBeenCalledTimes(1));
  });
});
