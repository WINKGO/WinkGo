/**
 * @license
 * Copyright 2026 WINK GO
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  saveConfig: vi.fn(),
  testConnections: vi.fn(),
  startRuntime: vi.fn(),
  refreshBindingCode: vi.fn(),
  authorizeFirewall: vi.fn(),
  detectLanIp: vi.fn(),
  getNeteaseAccount: vi.fn(),
  bindNeteaseAccount: vi.fn(),
  unbindNeteaseAccount: vi.fn(),
  statusHandler: undefined as ((snapshot: typeof snapshot) => void) | undefined,
  navigate: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
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
      getNeteaseAccount: { invoke: mocks.getNeteaseAccount },
      bindNeteaseAccount: { invoke: mocks.bindNeteaseAccount },
      unbindNeteaseAccount: { invoke: mocks.unbindNeteaseAccount },
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { domain?: string }) => {
      const translations: Record<string, string> = {
        'settings.mcpWorkspace.relayToggleLabel': '启用云端设备中转',
        'settings.mcpWorkspace.relayDisclosureTitle': '启用云端设备中转前请确认',
        'settings.mcpWorkspace.relayDisclosureBody':
          '通过 {{domain}} 传输必要数据；第三方服务可能收费；你可以随时关闭本开关。',
        'settings.mcpWorkspace.bindingHelp': '如果设备码显示失效，请重新获取设备码，同时确认电脑防火墙和WebUI已开启。',
        'settings.mcpWorkspace.bindingHelpLabel': '查看设备绑定帮助',
        'settings.mcpWorkspace.webuiConfiguration': 'WebUI 配置',
        'settings.mcpWorkspace.neteaseAccount.title': '网易云音乐账号',
        'settings.mcpWorkspace.neteaseAccount.description': '绑定自己的网易云账号',
        'settings.mcpWorkspace.neteaseAccount.statusUnbound': '未绑定',
        'settings.mcpWorkspace.neteaseAccount.statusActive': '已绑定',
        'settings.mcpWorkspace.neteaseAccount.statusNeedsRebind': '登录已失效',
        'settings.mcpWorkspace.neteaseAccount.accountLabel': '网易云账号',
        'settings.mcpWorkspace.neteaseAccount.uidLabel': 'UID',
        'settings.mcpWorkspace.neteaseAccount.membershipLabel': '会员状态',
        'settings.mcpWorkspace.neteaseAccount.inputLabel': 'MUSIC_U',
        'settings.mcpWorkspace.neteaseAccount.placeholder': '只粘贴 MUSIC_U 的值',
        'settings.mcpWorkspace.neteaseAccount.disclosure': '凭据会加密保存，且不得填写密码或整段 Cookie。',
        'settings.mcpWorkspace.neteaseAccount.bind': '验证并绑定',
        'settings.mcpWorkspace.neteaseAccount.rebind': '重新绑定',
        'settings.mcpWorkspace.neteaseAccount.unbind': '解除绑定',
        'settings.mcpWorkspace.neteaseAccount.refresh': '刷新状态',
        'settings.mcpWorkspace.neteaseAccount.unbindConfirm': '确认解除绑定？',
        'settings.mcpWorkspace.neteaseAccount.bindSuccess': '网易云账号验证并绑定成功。',
        'settings.mcpWorkspace.neteaseAccount.unbindSuccess': '网易云账号已解除绑定。',
        'settings.mcpWorkspace.neteaseAccount.inputInvalid': '请输入有效的 MUSIC_U。',
        'settings.mcpWorkspace.neteaseAccount.loginRequired': '请先登录 WINK GO 账号。',
        'settings.mcpWorkspace.neteaseAccount.desktopBindingRequired': '请先绑定同一个小程序账号。',
        'settings.mcpWorkspace.neteaseAccount.serviceUnavailable': '网易云账号服务暂不可用。',
        'settings.mcpWorkspace.neteaseAccount.unknownMembership': '未知',
      };
      return (translations[key] ?? key).replace('{{domain}}', options?.domain ?? '');
    },
  }),
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
    Popconfirm: ({ children, onOk }: { children: React.ReactElement; onOk?: () => void }) =>
      React.cloneElement(children, { onClick: () => void onOk?.() }),
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
    mocks.getNeteaseAccount.mockResolvedValue({
      success: true,
      data: {
        configured: false,
        state: 'unbound',
        uid: '',
        displayName: '',
        membershipLevel: '',
        verifiedAt: null,
        updatedAt: null,
        lastErrorCode: '',
      },
    });
    mocks.bindNeteaseAccount.mockResolvedValue({
      success: true,
      data: {
        configured: true,
        state: 'active',
        uid: '123456',
        displayName: '测试账号',
        membershipLevel: '网易云会员',
        verifiedAt: 1,
        updatedAt: 1,
        lastErrorCode: '',
      },
    });
  });

  const triggerRejectedBinding = async (): Promise<HTMLInputElement> => {
    mocks.bindNeteaseAccount.mockRejectedValueOnce(new Error('ipc unavailable'));
    render(<XiaozhiMcpConnection />);
    const input = await screen.findByPlaceholderText('只粘贴 MUSIC_U 的值');
    fireEvent.change(input, { target: { value: 'm'.repeat(64) } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '验证并绑定' }));
      await Promise.resolve();
    });
    return input as HTMLInputElement;
  };

  it('shows a neutral detection state before the first Runtime snapshot arrives', () => {
    mocks.getSnapshot.mockImplementation(() => new Promise(() => undefined));

    render(<XiaozhiMcpConnection />);

    expect(screen.getByTestId('xiaozhi-flow-runtime')).toHaveAttribute('data-status', 'checking');
    expect(screen.getByText('正在检测')).toBeInTheDocument();
    expect(screen.queryByText('尚未安装')).toBeNull();
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

  it('shows the cloud-relay disclosure and preserves an explicit opt-out', async () => {
    const disabledSnapshot = {
      ...snapshot,
      config: { ...snapshot.config, relayEnabled: false },
      remoteGateway: {
        ...snapshot.remoteGateway,
        state: 'stopped',
        enabled: false,
        connected: false,
      },
    };
    mocks.getSnapshot.mockResolvedValue({ success: true, data: disabledSnapshot });

    render(<XiaozhiMcpConnection />);

    const disclosure = await screen.findByTestId('xiaozhi-relay-disclosure');
    expect(disclosure).toHaveTextContent('启用云端设备中转前请确认');
    expect(disclosure).toHaveTextContent('wss://winkgo.top/desktop');
    expect(disclosure).toHaveTextContent('你可以随时关闭');
    await waitFor(() => expect(screen.getByRole('switch', { name: '启用云端设备中转' })).not.toBeChecked());
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

  it('links device binding help to the WebUI settings page', async () => {
    render(<XiaozhiMcpConnection />);

    expect(await screen.findByRole('button', { name: '查看设备绑定帮助' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'WebUI 配置' }));

    expect(mocks.navigate).toHaveBeenCalledWith('/settings/webui');
  });

  it('shows only sanitized NetEase account metadata after status refresh', async () => {
    mocks.getNeteaseAccount.mockResolvedValue({
      success: true,
      data: {
        configured: true,
        state: 'active',
        uid: '123456',
        displayName: '测试账号',
        membershipLevel: '网易云会员',
        verifiedAt: 1,
        updatedAt: 1,
        lastErrorCode: '',
      },
    });

    render(<XiaozhiMcpConnection />);

    expect(await screen.findByText('测试账号')).toBeInTheDocument();
    expect(screen.getByText('123456')).toBeInTheDocument();
    expect(screen.getByText('网易云会员')).toBeInTheDocument();
    expect(screen.queryByText(/MUSIC_U=/)).toBeNull();
  });

  it('submits MUSIC_U once and clears the secret input after binding', async () => {
    render(<XiaozhiMcpConnection />);
    const input = await screen.findByPlaceholderText('只粘贴 MUSIC_U 的值');
    const musicU = 'm'.repeat(64);
    fireEvent.change(input, { target: { value: musicU } });
    fireEvent.click(screen.getByRole('button', { name: '验证并绑定' }));

    await waitFor(() => expect(mocks.bindNeteaseAccount).toHaveBeenCalledWith({ musicU }));
    expect(input).toHaveValue('');
    expect(await screen.findByText('测试账号')).toBeInTheDocument();
  });

  it('clears the secret when binding IPC rejects', async () => {
    const input = await triggerRejectedBinding();

    expect(input).toHaveValue('');
  });

  it('releases the loading state when binding IPC rejects', async () => {
    await triggerRejectedBinding();

    await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled());
  });

  it('shows a safe service error when binding IPC rejects', async () => {
    await triggerRejectedBinding();

    expect(await screen.findByText('网易云账号服务暂不可用。')).toBeInTheDocument();
  });

  it('releases the loading state when account status IPC rejects', async () => {
    mocks.getNeteaseAccount.mockRejectedValueOnce(new Error('ipc unavailable'));
    render(<XiaozhiMcpConnection />);

    expect(await screen.findByText('网易云账号服务暂不可用。')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled());
  });

  it('releases the loading state when account unbinding IPC rejects', async () => {
    mocks.getNeteaseAccount.mockResolvedValueOnce({
      success: true,
      data: {
        configured: true,
        state: 'active',
        uid: '123456',
        displayName: '测试账号',
        membershipLevel: '网易云会员',
        verifiedAt: 1,
        updatedAt: 1,
        lastErrorCode: '',
      },
    });
    mocks.unbindNeteaseAccount.mockRejectedValueOnce(new Error('ipc unavailable'));
    render(<XiaozhiMcpConnection />);

    expect(await screen.findByText('测试账号')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '解除绑定' }));

    await waitFor(() => expect(mocks.unbindNeteaseAccount).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('网易云账号服务暂不可用。')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新状态' })).toBeEnabled());
  });

  it('shows a safe binding requirement without exposing a raw server response', async () => {
    mocks.getNeteaseAccount.mockResolvedValue({
      success: false,
      error: 'desktop_miniapp_binding_required',
    });

    render(<XiaozhiMcpConnection />);

    expect(await screen.findByText('请先绑定同一个小程序账号。')).toBeInTheDocument();
    expect(screen.queryByText('desktop_miniapp_binding_required')).toBeNull();
  });
});
