/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  WinkGoNeteaseAccountStatus,
  WinkGoQqMusicAccountStatus,
  WinkGoXiaozhiConfig,
  WinkGoXiaozhiSaveRequest,
  WinkGoXiaozhiSnapshot,
} from '@/common/adapter/ipcBridge';
import { WINK_GO_BRAND_ICON as winkGoLogo, WINK_GO_DISPLAY_NAME } from '@/renderer/utils/model/winkGoBranding';
import { openExternalUrl } from '@/renderer/utils/platform';
import { Button, Input, InputNumber, Message, Popconfirm, Switch, Tag, Tooltip } from '@arco-design/web-react';
import {
  Api,
  Broadcast,
  CheckOne,
  Connection,
  Cpu,
  Help,
  Key,
  LinkCloud,
  Music,
  Phone,
  Play,
  Refresh,
  Server,
  Shield,
} from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import './xiaozhi-mcp-connection.css';

type FormState = Pick<
  WinkGoXiaozhiSaveRequest,
  'runtimeApi' | 'lanIp' | 'bridgePort' | 'relayUrl' | 'relayEnabled' | 'hardwareEnabled' | 'mobileEnabled'
> & {
  bridgeToken: string;
  hardwareAddress: string;
  mobileAddress: string;
};

const DEFAULT_CONFIG: WinkGoXiaozhiConfig = {
  schemaVersion: 6,
  relayConsentVersion: 1,
  runtimeApi: 'http://127.0.0.1:8121',
  lanIp: '127.0.0.1',
  bridgePort: 8776,
  relayUrl: 'wss://winkgo.top/desktop',
  desktopId: '',
  bindingCode: '',
  relayEnabled: true,
  hardwareEnabled: true,
  mobileEnabled: false,
  hardwareEndpoint: 'wss://api.xiaozhi.me/mcp/',
  mobileEndpoint: 'wss://api.xiaozhi.me/mcp/',
  firewallAuthorized: false,
  lastSavedMs: 0,
  hardwareLastTest: null,
  mobileLastTest: null,
};

const toForm = (config: WinkGoXiaozhiConfig): FormState => ({
  runtimeApi: config.runtimeApi,
  lanIp: config.lanIp,
  bridgePort: config.bridgePort,
  relayUrl: config.relayUrl,
  relayEnabled: config.relayEnabled,
  hardwareEnabled: config.hardwareEnabled,
  mobileEnabled: config.mobileEnabled,
  bridgeToken: '',
  hardwareAddress: '',
  mobileAddress: '',
});

type ConnectionTone = 'success' | 'checking' | 'warning' | 'error' | 'muted';

type ConnectionStep = {
  detail: string;
  icon: React.ReactNode;
  id: string;
  optional?: boolean;
  title: string;
  status: string;
  tone: ConnectionTone;
};

const connectionToneClass: Record<ConnectionTone, string> = {
  success: 'border-green-6 bg-green-6 text-white shadow-[0_0_0_5px_rgba(22,136,95,.10)]',
  checking: 'border-primary-5 bg-1 text-primary-6 shadow-[0_0_0_5px_rgba(52,124,245,.14)] animate-pulse',
  warning: 'border-orange-4 bg-orange-1 text-orange-6',
  error: 'border-red-6 bg-red-6 text-white',
  muted: 'border-border-2 bg-fill-2 text-t-tertiary',
};

const ConnectionFlow: React.FC<{ steps: ConnectionStep[]; testing: boolean }> = ({ steps, testing }) => {
  const [activeIndex, setActiveIndex] = useState(-1);
  const required = steps.filter((step) => !step.optional);
  const completed = required.filter((step) => step.tone === 'success').length;
  const hasError = required.some((step) => step.tone === 'error');
  const progress = required.length > 0 ? Math.max(4, (completed / required.length) * 86) : 0;

  useEffect(() => {
    if (!testing) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex(0);
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % steps.length);
    }, 420);
    return () => window.clearInterval(timer);
  }, [steps.length, testing]);

  return (
    <section
      className='xiaozhi-panel xiaozhi-flow-panel rd-20px bg-1 px-18px pb-17px pt-16px'
      data-animating={testing ? 'true' : 'false'}
      data-testid='xiaozhi-connection-flow'
    >
      <div className='flex items-center justify-between gap-12px'>
        <div>
          <h3 className='m-0 flex items-center gap-8px text-15px text-t-primary'>
            <span className='size-28px flex items-center justify-center rd-9px bg-primary-1 text-primary-6'>
              <Connection theme='outline' size='16' />
            </span>
            实时连接链路
          </h3>
          <p className='m-0 ml-36px mt-2px text-10px text-t-tertiary'>逐段检测，出错会准确停在对应节点</p>
        </div>
        <Tag color={hasError ? 'red' : completed === required.length ? 'green' : 'arcoblue'}>
          {testing ? '正在检测连接' : `${completed}/${required.length} 条必要链路已就绪`}
        </Tag>
      </div>
      <div className='mt-14px overflow-x-auto pb-2px'>
        <div className='relative grid min-w-760px grid-cols-7 gap-8px pt-7px'>
          <span className='absolute left-[7%] right-[7%] top-29px h-2px rd-full bg-fill-3' aria-hidden='true' />
          <span
            className={`absolute left-[7%] top-29px h-2px rd-full bg-gradient-to-r from-primary-5 via-cyan-5 to-green-5 transition-all duration-500 ${
              testing ? 'animate-pulse' : ''
            }`}
            style={{ width: `${progress}%` }}
            aria-hidden='true'
          />
          {testing ? (
            <span className='xiaozhi-flow-packets' aria-hidden='true'>
              <i />
              <i />
              <i />
            </span>
          ) : null}
          {steps.map((step, index) => (
            <article
              className='xiaozhi-flow-node relative z-1 min-w-0 flex flex-col items-center rd-12px px-3px pb-7px pt-7px text-center'
              data-active={testing && index === activeIndex ? 'true' : 'false'}
              data-status={step.tone}
              data-testid={`xiaozhi-flow-${step.id}`}
              key={step.id}
              title={step.detail}
            >
              <span
                className={`xiaozhi-flow-icon size-42px flex items-center justify-center rd-full border-3 transition-all duration-300 ${connectionToneClass[step.tone]}`}
              >
                {step.icon}
              </span>
              <strong className='mt-8px max-w-98px truncate text-11px text-t-primary'>{step.title}</strong>
              <small
                className={`mt-3px max-w-100px truncate text-9px ${
                  step.tone === 'error'
                    ? 'text-red-6'
                    : step.tone === 'warning'
                      ? 'text-orange-6'
                      : step.tone === 'success'
                        ? 'text-green-7'
                        : 'text-t-tertiary'
                }`}
              >
                {step.status}
              </small>
              {step.optional ? <small className='mt-2px text-8px text-t-tertiary'>可选直连</small> : null}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

const XiaozhiMcpConnection: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<WinkGoXiaozhiSnapshot | null>(null);
  const [form, setForm] = useState<FormState>(() => toForm(DEFAULT_CONFIG));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [firewallBusy, setFirewallBusy] = useState(false);
  const [refreshingBindingCode, setRefreshingBindingCode] = useState(false);
  const [bindingSeconds, setBindingSeconds] = useState(0);
  const activeBindingCodeRef = useRef('');
  const [flowAnimating, setFlowAnimating] = useState(false);
  const [neteaseAccount, setNeteaseAccount] = useState<WinkGoNeteaseAccountStatus | null>(null);
  const [neteaseMusicU, setNeteaseMusicU] = useState('');
  const [neteaseBusy, setNeteaseBusy] = useState(false);
  const [neteaseError, setNeteaseError] = useState('');
  const [qqMusicAccount, setQqMusicAccount] = useState<WinkGoQqMusicAccountStatus | null>(null);
  const [qqMusicCookie, setQqMusicCookie] = useState('');
  const [qqMusicBusy, setQqMusicBusy] = useState(false);
  const [qqMusicError, setQqMusicError] = useState('');
  const flowAnimationTimerRef = useRef<number | null>(null);

  const config = snapshot?.config ?? DEFAULT_CONFIG;
  const busy = loading || saving || testing || starting || firewallBusy || refreshingBindingCode;
  const hardwareOk = Boolean(config.hardwareEnabled && config.hardwareLastTest?.ok);
  const mobileOk = Boolean(config.mobileEnabled && config.mobileLastTest?.ok);
  const relayOk = snapshot?.remoteGateway.connected === true;
  const relayStatus = !form.relayEnabled
    ? '当前已关闭'
    : relayOk
      ? '云端在线'
      : snapshot?.remoteGateway.state === 'waiting_authorization'
        ? '等待账号授权'
        : snapshot?.remoteGateway.connecting || snapshot?.remoteGateway.state === 'reconnecting'
          ? '正在连接'
          : snapshot?.remoteGateway.state === 'error'
            ? '连接异常'
            : '等待启动';
  const cloudChannelOk =
    (!config.hardwareEnabled || hardwareOk) && (!config.mobileEnabled || mobileOk) && (hardwareOk || mobileOk);
  const runtimePending = !snapshot || loading || testing || starting;
  const connectionSteps = useMemo<ConnectionStep[]>(
    () => [
      {
        id: 'runtime',
        title: 'Runtime',
        status: snapshot?.runtime.ok
          ? '已就绪'
          : runtimePending
            ? '正在检测'
            : snapshot?.runtimeInstalled
              ? '等待启动'
              : '尚未安装',
        detail: snapshot?.runtime.detail || '等待检测本机 8121',
        icon: <Server theme='outline' size='18' />,
        tone: snapshot?.runtime.ok ? 'success' : runtimePending ? 'checking' : 'error',
      },
      {
        id: 'host',
        title: '技能主机',
        status: snapshot?.runtime.ok ? '已就绪' : '等待 Runtime',
        detail: snapshot?.runtime.ok ? '本机技能调度已就绪' : 'Runtime 就绪后自动连接',
        icon: <Api theme='outline' size='18' />,
        tone: snapshot?.runtime.ok ? 'success' : testing ? 'checking' : 'muted',
      },
      {
        id: 'firewall',
        optional: true,
        title: '防火墙',
        status: config.firewallAuthorized ? '专用网络已放行' : 'LAN 尚未放行',
        detail: config.firewallAuthorized
          ? 'Runtime 与 Bridge 入站规则完整'
          : cloudChannelOk
            ? '云端 WSS 正常；LAN 直连仍需放行'
            : '点击 LAN 防火墙放行并允许一次 UAC',
        icon: <Shield theme='outline' size='18' />,
        tone: config.firewallAuthorized ? 'success' : firewallBusy ? 'checking' : 'warning',
      },
      {
        id: 'bridge',
        optional: true,
        title: 'LAN Bridge',
        status: snapshot?.bridge.ok ? `${config.bridgePort} 已监听` : cloudChannelOk ? '云端模式正常' : '可选 · 未监听',
        detail: snapshot?.bridge.detail || '可选 LAN 直连端口',
        icon: <Broadcast theme='outline' size='18' />,
        tone: snapshot?.bridge.ok || cloudChannelOk ? 'success' : 'muted',
      },
      {
        id: 'relay',
        title: '设备中转',
        status: relayStatus,
        detail: snapshot?.remoteGateway.lastError || snapshot?.remoteGateway.desktopId || '等待创建独立桌面身份',
        icon: <LinkCloud theme='outline' size='18' />,
        tone: relayOk
          ? 'success'
          : snapshot?.remoteGateway.connecting || snapshot?.remoteGateway.state === 'reconnecting'
            ? 'checking'
            : snapshot?.remoteGateway.state === 'error' || snapshot?.remoteGateway.state === 'waiting_authorization'
              ? 'error'
              : 'warning',
      },
      {
        id: 'hardware',
        title: 'ESP32 小智',
        status: !config.hardwareEnabled ? '已关闭' : hardwareOk ? '云端已连接' : '等待检测',
        detail: config.hardwareLastTest?.message || '等待独立 Agent Token',
        icon: <Cpu theme='outline' size='18' />,
        tone: !config.hardwareEnabled ? 'muted' : hardwareOk ? 'success' : testing ? 'checking' : 'warning',
      },
      {
        id: 'mobile',
        title: '手机小程序',
        status: !config.mobileEnabled ? '已关闭' : mobileOk ? '云端已连接' : '等待检测',
        detail: config.mobileLastTest?.message || '与 ESP32 分开配置',
        icon: <Phone theme='outline' size='18' />,
        tone: !config.mobileEnabled ? 'muted' : mobileOk ? 'success' : testing ? 'checking' : 'warning',
      },
    ],
    [
      cloudChannelOk,
      config,
      firewallBusy,
      hardwareOk,
      mobileOk,
      relayOk,
      relayStatus,
      runtimePending,
      snapshot,
      testing,
    ]
  );

  const connectionIssue = !snapshot
    ? '正在读取本机与云端状态…'
    : !snapshot.runtime.ok
      ? snapshot.runtime.detail
      : form.relayEnabled && !relayOk
        ? snapshot.remoteGateway.lastError || '云端设备中转尚未连接，请执行一次检测与修复。'
        : config.hardwareEnabled && !hardwareOk
          ? config.hardwareLastTest?.message || 'ESP32 小智通道尚未验证。'
          : config.mobileEnabled && !mobileOk
            ? config.mobileLastTest?.message || '手机小程序通道尚未验证。'
            : '';
  const connectionHealthy = Boolean(snapshot?.runtime.ok && (!form.relayEnabled || relayOk) && cloudChannelOk);

  const applySnapshot = useCallback((next: WinkGoXiaozhiSnapshot) => {
    setSnapshot(next);
    setForm(toForm(next.config));
  }, []);

  const neteaseErrorMessage = useCallback(
    (error: string): string => {
      if (error.includes('winkgo_account_login_required')) {
        return t('settings.mcpWorkspace.neteaseAccount.loginRequired');
      }
      if (error.includes('desktop_miniapp_binding_required')) {
        return t('settings.mcpWorkspace.neteaseAccount.desktopBindingRequired');
      }
      if (error.includes('netease_music_u_invalid')) {
        return t('settings.mcpWorkspace.neteaseAccount.inputInvalid');
      }
      if (error.includes('needs_rebind') || error.includes('登录已失效')) {
        return t('settings.mcpWorkspace.neteaseAccount.statusNeedsRebind');
      }
      return t('settings.mcpWorkspace.neteaseAccount.serviceUnavailable');
    },
    [t]
  );

  const runNeteaseAccountAction = useCallback(
    async (
      action: () => Promise<{
        success: boolean;
        data?: WinkGoNeteaseAccountStatus | null;
        error?: string;
      }>,
      options: {
        fallbackError: string;
        notifyError?: boolean;
        successMessage?: string;
      }
    ): Promise<void> => {
      setNeteaseBusy(true);
      setNeteaseError('');
      try {
        const result = await action();
        if (!result.success || !result.data) {
          throw new Error(result.error || options.fallbackError);
        }
        setNeteaseAccount(result.data);
        if (options.successMessage) Message.success(options.successMessage);
      } catch (error) {
        const message = neteaseErrorMessage(error instanceof Error ? error.message : String(error));
        setNeteaseError(message);
        if (options.notifyError) Message.error(message);
      } finally {
        setNeteaseBusy(false);
      }
    },
    [neteaseErrorMessage]
  );

  const loadNeteaseAccount = useCallback(
    async (notify = false): Promise<void> => {
      await runNeteaseAccountAction(() => ipcBridge.winkGoXiaozhi.getNeteaseAccount.invoke(), {
        fallbackError: 'music_account_status_failed',
        notifyError: notify,
      });
    },
    [runNeteaseAccountAction]
  );

  const qqMusicErrorMessage = useCallback(
    (error: string): string => {
      if (error.includes('winkgo_account_login_required')) {
        return t('settings.mcpWorkspace.qqMusicAccount.loginRequired');
      }
      if (error.includes('desktop_miniapp_binding_required')) {
        return t('settings.mcpWorkspace.qqMusicAccount.desktopBindingRequired');
      }
      if (error.includes('qq_music_cookie_invalid')) {
        return t('settings.mcpWorkspace.qqMusicAccount.inputInvalid');
      }
      if (error.includes('needs_rebind') || error.includes('登录已失效')) {
        return t('settings.mcpWorkspace.qqMusicAccount.statusNeedsRebind');
      }
      return t('settings.mcpWorkspace.qqMusicAccount.serviceUnavailable');
    },
    [t]
  );

  const runQqMusicAccountAction = useCallback(
    async (
      action: () => Promise<{
        success: boolean;
        data?: WinkGoQqMusicAccountStatus | null;
        error?: string;
      }>,
      options: {
        fallbackError: string;
        notifyError?: boolean;
        successMessage?: string;
      }
    ): Promise<void> => {
      setQqMusicBusy(true);
      setQqMusicError('');
      try {
        const result = await action();
        if (!result.success || !result.data) {
          throw new Error(result.error || options.fallbackError);
        }
        setQqMusicAccount(result.data);
        if (options.successMessage) Message.success(options.successMessage);
      } catch (error) {
        const message = qqMusicErrorMessage(error instanceof Error ? error.message : String(error));
        setQqMusicError(message);
        if (options.notifyError) Message.error(message);
      } finally {
        setQqMusicBusy(false);
      }
    },
    [qqMusicErrorMessage]
  );

  const loadQqMusicAccount = useCallback(
    async (notify = false): Promise<void> => {
      await runQqMusicAccountAction(() => ipcBridge.winkGoXiaozhi.getQqMusicAccount.invoke(), {
        fallbackError: 'music_account_status_failed',
        notifyError: notify,
      });
    },
    [runQqMusicAccountAction]
  );

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    const result = await ipcBridge.winkGoXiaozhi.getSnapshot.invoke();
    setLoading(false);
    if (!result.success || !result.data) {
      Message.error(result.error || '无法读取小智 MCP 状态。');
      return;
    }
    applySnapshot(result.data);
  }, [applySnapshot]);

  useEffect(() => {
    const timer = window.setTimeout((): void => {
      void loadSnapshot();
    }, 60);
    return () => window.clearTimeout(timer);
  }, [loadSnapshot]);

  useEffect(() => {
    const timer = window.setTimeout((): void => {
      void loadNeteaseAccount();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [loadNeteaseAccount]);

  useEffect(() => {
    const timer = window.setTimeout((): void => {
      void loadQqMusicAccount();
    }, 160);
    return () => window.clearTimeout(timer);
  }, [loadQqMusicAccount]);

  useEffect(
    () =>
      ipcBridge.winkGoXiaozhi.statusChanged.on((next) => {
        setSnapshot(next);
        setForm((current) => ({
          ...current,
          relayUrl: next.config.relayUrl,
          relayEnabled: next.config.relayEnabled,
        }));
      }),
    []
  );

  useEffect(() => {
    const nextCode = snapshot?.remoteGateway.bindingCode ?? '';
    const nextSeconds = snapshot?.remoteGateway.expiresInSeconds ?? 0;
    if (nextCode !== activeBindingCodeRef.current) {
      activeBindingCodeRef.current = nextCode;
      setBindingSeconds(nextSeconds);
      return;
    }
    if (!nextCode || nextSeconds <= 0) setBindingSeconds(0);
  }, [snapshot?.remoteGateway.bindingCode, snapshot?.remoteGateway.expiresInSeconds]);

  useEffect(() => {
    if (bindingSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setBindingSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [bindingSeconds > 0]);

  useEffect(
    () => () => {
      if (flowAnimationTimerRef.current !== null) window.clearTimeout(flowAnimationTimerRef.current);
    },
    []
  );

  const animateConnectionFlow = useCallback((duration = 3_200) => {
    if (flowAnimationTimerRef.current !== null) window.clearTimeout(flowAnimationTimerRef.current);
    setFlowAnimating(true);
    flowAnimationTimerRef.current = window.setTimeout(() => {
      setFlowAnimating(false);
      flowAnimationTimerRef.current = null;
    }, duration);
  }, []);

  const save = async (quiet = false): Promise<WinkGoXiaozhiSnapshot | null> => {
    setSaving(true);
    const result = await ipcBridge.winkGoXiaozhi.saveConfig.invoke(form);
    setSaving(false);
    if (!result.success || !result.data) {
      Message.error(result.error || '小智 MCP 配置保存失败。');
      return null;
    }
    applySnapshot(result.data);
    if (!quiet) Message.success('小智 MCP 配置已保存，敏感凭据只存放在 Windows 凭据管理器。');
    return result.data;
  };

  const testConnections = async () => {
    animateConnectionFlow();
    setTesting(true);
    const saved = await save(true);
    if (!saved) {
      setTesting(false);
      return;
    }
    const result = await ipcBridge.winkGoXiaozhi.testConnections.invoke();
    setTesting(false);
    if (!result.success || !result.data) {
      Message.error(result.error || '小智 MCP 检测失败。');
      return;
    }
    applySnapshot(result.data.snapshot);
    const failed =
      !result.data.snapshot.runtime.ok ||
      (result.data.snapshot.config.hardwareEnabled && !result.data.snapshot.config.hardwareLastTest?.ok) ||
      (result.data.snapshot.config.mobileEnabled && !result.data.snapshot.config.mobileLastTest?.ok);
    (failed ? Message.warning : Message.success)(result.data.message);
  };

  const startRuntime = async () => {
    animateConnectionFlow();
    setStarting(true);
    const result = await ipcBridge.winkGoXiaozhi.startRuntime.invoke();
    setStarting(false);
    if (!result.success || !result.data) {
      Message.error(result.error || 'Runtime 启动失败。');
      return;
    }
    applySnapshot(result.data.snapshot);
    Message.success(result.data.message);
  };

  const detectLan = async () => {
    const result = await ipcBridge.winkGoXiaozhi.detectLanIp.invoke();
    if (!result.success || !result.data) {
      Message.error(result.error || '没有识别到可用的 LAN IP。');
      return;
    }
    setForm((current) => ({ ...current, lanIp: result.data || current.lanIp }));
    Message.success(`已识别本机 LAN IP：${result.data}`);
  };

  const authorizeFirewall = async () => {
    animateConnectionFlow();
    const wasAuthorized = config.firewallAuthorized;
    setFirewallBusy(true);
    const result = await ipcBridge.winkGoXiaozhi.authorizeFirewall.invoke();
    setFirewallBusy(false);
    if (!result.success || !result.data) {
      Message.error(result.error || 'Windows 防火墙授权未完成。');
      return;
    }
    applySnapshot(result.data);
    Message.success(
      wasAuthorized
        ? '已重新核验 Windows 专用网络防火墙规则。'
        : 'Runtime 8121 与 Bridge 8776 已在 Windows 专用网络放行。'
    );
  };

  const refreshBindingCode = async () => {
    animateConnectionFlow();
    setRefreshingBindingCode(true);
    const result = await ipcBridge.winkGoXiaozhi.refreshBindingCode.invoke();
    setRefreshingBindingCode(false);
    if (!result.success || !result.data) {
      Message.error(result.error || '设备绑定码刷新失败。');
      return;
    }
    applySnapshot(result.data);
    Message.success('正在向云端申请新的 10 位设备绑定码。');
  };

  const bindNeteaseAccount = async (): Promise<void> => {
    const musicU = neteaseMusicU;
    setNeteaseMusicU('');
    await runNeteaseAccountAction(() => ipcBridge.winkGoXiaozhi.bindNeteaseAccount.invoke({ musicU }), {
      fallbackError: 'music_account_bind_failed',
      notifyError: true,
      successMessage: t('settings.mcpWorkspace.neteaseAccount.bindSuccess'),
    });
  };

  const unbindNeteaseAccount = async (): Promise<void> => {
    await runNeteaseAccountAction(() => ipcBridge.winkGoXiaozhi.unbindNeteaseAccount.invoke(), {
      fallbackError: 'music_account_unbind_failed',
      notifyError: true,
      successMessage: t('settings.mcpWorkspace.neteaseAccount.unbindSuccess'),
    });
  };

  const bindQqMusicAccount = async (): Promise<void> => {
    const cookie = qqMusicCookie;
    setQqMusicCookie('');
    await runQqMusicAccountAction(() => ipcBridge.winkGoXiaozhi.bindQqMusicAccount.invoke({ cookie }), {
      fallbackError: 'music_account_bind_failed',
      notifyError: true,
      successMessage: t('settings.mcpWorkspace.qqMusicAccount.bindSuccess'),
    });
  };

  const unbindQqMusicAccount = async (): Promise<void> => {
    await runQqMusicAccountAction(() => ipcBridge.winkGoXiaozhi.unbindQqMusicAccount.invoke(), {
      fallbackError: 'music_account_unbind_failed',
      notifyError: true,
      successMessage: t('settings.mcpWorkspace.qqMusicAccount.unbindSuccess'),
    });
  };

  const bindingCodeValid = Boolean(snapshot?.remoteGateway.bindingCode && bindingSeconds > 0);

  return (
    <div className='xiaozhi-mcp-page flex flex-col gap-16px' data-testid='xiaozhi-mcp-connection'>
      <section className='xiaozhi-panel xiaozhi-hero relative overflow-hidden rd-22px bg-gradient-to-br from-primary-1 via-1 to-cyan-1 p-20px'>
        <span className='pointer-events-none absolute -right-65px -top-80px size-210px rd-full border border-primary-2 opacity-70' />
        <span className='pointer-events-none absolute -right-20px top-18px size-105px rd-full bg-primary-2 opacity-35 blur-3xl' />
        <div className='relative flex items-center justify-between gap-22px max-md:flex-col max-md:items-stretch'>
          <div className='flex min-w-0 items-center gap-14px'>
            <span className='size-58px shrink-0 flex items-center justify-center rd-17px border border-border-2 bg-1 shadow-md'>
              <img alt={WINK_GO_DISPLAY_NAME} className='size-46px object-contain' src={winkGoLogo} />
            </span>
            <div>
              <span className='text-10px font-700 tracking-1.4px text-primary-6'>
                {t('settings.mcpWorkspace.deviceBridgeEyebrow', { brand: WINK_GO_DISPLAY_NAME })}
              </span>
              <h2 className='m-0 mt-3px text-21px text-t-primary'>{t('settings.mcpWorkspace.connectionCenter')}</h2>
              <p className='m-0 mt-4px max-w-560px text-11px leading-18px text-t-secondary'>
                一套界面管理本机 Runtime、云端设备中转、ESP32 与手机小程序；每个账号、每台电脑独立隔离。
              </p>
            </div>
          </div>
          <div className='flex shrink-0 flex-col items-end gap-9px max-md:items-stretch'>
            <div className='flex items-center justify-end gap-7px'>
              <span
                className={`size-8px rd-full ${connectionHealthy ? 'bg-green-6 shadow-[0_0_0_5px_rgba(22,136,95,.12)]' : 'bg-orange-5 animate-pulse'}`}
              />
              <strong className='text-12px text-t-primary'>
                {connectionHealthy ? '全部必要链路正常' : '有链路需要处理'}
              </strong>
            </div>
            <div className='flex gap-7px'>
              <Button
                icon={<LinkCloud theme='outline' size='14' />}
                onClick={() => void openExternalUrl('https://xiaozhi.me/console/agents')}
              >
                小智控制台
              </Button>
              <Button
                disabled={busy}
                icon={<Refresh theme='outline' size='14' />}
                loading={testing || loading}
                type='primary'
                onClick={() => void testConnections()}
              >
                检测并修复
              </Button>
            </div>
          </div>
        </div>
        <div
          className={`relative mt-15px flex items-center justify-between gap-12px rd-12px border px-12px py-9px ${
            connectionHealthy
              ? 'border-green-2 bg-green-1 text-green-7'
              : connectionIssue
                ? 'border-orange-2 bg-orange-1 text-orange-7'
                : 'border-border-2 bg-1 text-t-secondary'
          }`}
        >
          <span className='min-w-0 truncate text-10px'>
            {connectionHealthy ? 'Runtime、账号中转和已启用的小智通道均已完成验证。' : connectionIssue}
          </span>
          <div className='flex shrink-0 items-center gap-7px text-10px'>
            <span>{snapshot?.runtime.elapsedMs ?? 0} ms 本机响应</span>
            <Button
              icon={<Refresh theme='outline' size='12' />}
              loading={loading}
              size='mini'
              type='text'
              onClick={() => void loadSnapshot()}
            >
              刷新
            </Button>
          </div>
        </div>
      </section>

      <ConnectionFlow steps={connectionSteps} testing={flowAnimating || testing || loading || firewallBusy} />

      <section className='xiaozhi-panel xiaozhi-config-panel rd-20px bg-1 p-18px'>
        <div className='flex items-start justify-between gap-16px border-b border-border-2 pb-12px'>
          <div>
            <h3 className='m-0 flex items-center gap-7px text-15px text-t-primary'>
              <Api theme='outline' size='18' />
              Runtime 与通道配置
            </h3>
            <p className='m-0 mt-3px text-10px text-t-tertiary'>
              读取旧 WINK GO 的同一份 mcp-channels.json；页面关闭后不会继续轮询。
            </p>
          </div>
          <Button
            disabled={busy}
            icon={<Shield theme='outline' size='14' />}
            loading={firewallBusy}
            status={config.firewallAuthorized ? 'success' : 'warning'}
            title={config.firewallAuthorized ? '点击重新核验 Windows 防火墙规则' : '点击并允许 UAC 以创建防火墙规则'}
            onClick={() => void authorizeFirewall()}
          >
            {config.firewallAuthorized ? 'LAN 防火墙已放行' : 'LAN 防火墙放行'}
          </Button>
        </div>

        <div className='mt-14px grid grid-cols-2 gap-12px max-md:grid-cols-1'>
          <article
            className='xiaozhi-subcard col-span-2 rd-16px p-13px max-md:col-span-1'
            data-testid='xiaozhi-config-runtime'
          >
            <div className='mb-10px flex items-start gap-9px'>
              <span className='size-31px shrink-0 flex items-center justify-center rd-9px border border-primary-2 bg-primary-1 text-primary-6'>
                <Server theme='outline' size='16' />
              </span>
              <div>
                <strong className='block text-12px text-t-primary'>本机 Runtime 服务</strong>
                <small className='mt-2px block text-10px text-t-tertiary'>
                  {t('settings.mcpWorkspace.runtimeServiceDescription', { brand: WINK_GO_DISPLAY_NAME })}
                </small>
              </div>
            </div>
            <label className='block'>
              <span className='mb-6px block text-11px font-600 text-t-secondary'>Runtime 本地 API</span>
              <div className='xiaozhi-input-shell rd-10px bg-1 p-2px'>
                <Input
                  className='!border-transparent !bg-transparent'
                  value={form.runtimeApi}
                  onChange={(runtimeApi) => setForm((current) => ({ ...current, runtimeApi }))}
                />
              </div>
            </label>
          </article>

          <article
            className='xiaozhi-subcard col-span-2 rd-16px p-13px max-md:col-span-1'
            data-testid='xiaozhi-config-lan'
          >
            <div className='mb-10px flex items-start gap-9px'>
              <span className='size-31px shrink-0 flex items-center justify-center rd-9px border border-cyan-2 bg-cyan-1 text-cyan-7'>
                <Broadcast theme='outline' size='16' />
              </span>
              <div>
                <strong className='block text-12px text-t-primary'>局域网与语音桥接</strong>
                <small className='mt-2px block text-10px text-t-tertiary'>
                  用于局域网设备直连；云端模式可在 Bridge 未监听时继续工作
                </small>
              </div>
            </div>
            <div className='grid grid-cols-2 gap-10px max-md:grid-cols-1'>
              <label className='block'>
                <span className='mb-6px flex items-center gap-6px text-11px font-600 text-t-secondary'>
                  <Connection theme='outline' size='13' /> 当前设备 LAN IP
                </span>
                <div className='xiaozhi-input-shell flex rd-10px bg-1 p-2px'>
                  <Input
                    className='!border-transparent !bg-transparent'
                    value={form.lanIp}
                    onChange={(lanIp) => setForm((current) => ({ ...current, lanIp }))}
                  />
                  <Button className='shrink-0' type='text' onClick={() => void detectLan()}>
                    自动识别
                  </Button>
                </div>
              </label>
              <label className='block'>
                <span className='mb-6px flex items-center gap-6px text-11px font-600 text-t-secondary'>
                  <Broadcast theme='outline' size='13' /> 语音 Bridge 端口
                </span>
                <div className='xiaozhi-input-shell rd-10px bg-1 p-2px'>
                  <InputNumber
                    className='w-full !border-transparent !bg-transparent'
                    max={65_535}
                    min={1}
                    value={form.bridgePort}
                    onChange={(bridgePort) =>
                      setForm((current) => ({ ...current, bridgePort: Number(bridgePort) || 8776 }))
                    }
                  />
                </div>
              </label>
            </div>
          </article>

          <article className='xiaozhi-subcard rd-16px p-13px' data-testid='xiaozhi-config-relay'>
            <div className='mb-10px flex items-start justify-between gap-10px'>
              <div className='flex min-w-0 items-start gap-9px'>
                <span className='size-31px shrink-0 flex items-center justify-center rd-9px border border-green-2 bg-green-1 text-green-7'>
                  <LinkCloud theme='outline' size='16' />
                </span>
                <div>
                  <strong className='block text-12px text-t-primary'>云端设备转发</strong>
                  <small className='mt-2px block text-10px text-t-tertiary'>连接手机小程序和这台电脑</small>
                </div>
              </div>
              <Switch
                aria-describedby='winkgo-cloud-relay-disclosure'
                aria-label={t('settings.mcpWorkspace.relayToggleLabel')}
                checked={form.relayEnabled}
                onChange={(relayEnabled) => setForm((current) => ({ ...current, relayEnabled }))}
              />
            </div>
            <div
              className='mb-10px rd-10px border border-orange-3 bg-orange-1 px-10px py-9px text-10px leading-16px text-t-secondary'
              data-testid='xiaozhi-relay-disclosure'
              id='winkgo-cloud-relay-disclosure'
            >
              <strong className='mb-3px block text-11px text-orange-7'>
                {t('settings.mcpWorkspace.relayDisclosureTitle')}
              </strong>
              <span>
                {t('settings.mcpWorkspace.relayDisclosureBody', {
                  domain: 'wss://winkgo.top/desktop',
                })}
              </span>
            </div>
            <label className='block'>
              <span className='mb-6px block text-11px font-600 text-t-secondary'>
                {t('settings.mcpWorkspace.relayServiceLabel', { brand: WINK_GO_DISPLAY_NAME })}
              </span>
              <div className='xiaozhi-input-shell rd-10px bg-1 p-2px'>
                <Input
                  className='!border-transparent !bg-transparent'
                  value={form.relayUrl}
                  onChange={(relayUrl) => setForm((current) => ({ ...current, relayUrl }))}
                />
              </div>
            </label>
          </article>

          <article className='xiaozhi-subcard rd-16px p-13px' data-testid='xiaozhi-config-security'>
            <div className='mb-10px flex items-start gap-9px'>
              <span className='size-31px shrink-0 flex items-center justify-center rd-9px border border-orange-2 bg-orange-1 text-orange-7'>
                <Key theme='outline' size='16' />
              </span>
              <div>
                <strong className='block text-12px text-t-primary'>本地访问保护</strong>
                <small className='mt-2px block text-10px text-t-tertiary'>
                  {snapshot?.bridgeTokenConfigured ? 'Token 已安全保存，留空不会覆盖' : '仅在需要本地鉴权时填写'}
                </small>
              </div>
            </div>
            <label className='block'>
              <span className='mb-6px block text-11px font-600 text-t-secondary'>
                本地 {form.bridgePort} 鉴权 Token
              </span>
              <div className='xiaozhi-input-shell rd-10px bg-1 p-2px'>
                <Input.Password
                  autoComplete='new-password'
                  className='!border-transparent !bg-transparent'
                  placeholder={snapshot?.bridgeTokenConfigured ? '••••••••••••' : '未启用本地鉴权时可留空'}
                  value={form.bridgeToken}
                  onChange={(bridgeToken) => setForm((current) => ({ ...current, bridgeToken }))}
                />
              </div>
            </label>
          </article>
        </div>
      </section>

      <section
        className='xiaozhi-panel xiaozhi-binding-panel rd-20px bg-gradient-to-br from-1 to-primary-1 p-18px'
        data-testid='winkgo-mobile-binding'
      >
        <div className='flex items-start justify-between gap-12px border-b border-border-2 pb-11px'>
          <div>
            <h3 className='m-0 flex flex-wrap items-center gap-7px text-15px text-t-primary'>
              <Phone theme='outline' size='18' />
              <span>手机小程序设备绑定</span>
              <Tooltip content={t('settings.mcpWorkspace.bindingHelp')}>
                <button
                  aria-label={t('settings.mcpWorkspace.bindingHelpLabel')}
                  className='size-20px flex items-center justify-center rd-full border border-border-2 bg-1 p-0 text-t-secondary transition-colors hover:border-primary-4 hover:text-primary-6'
                  type='button'
                >
                  <Help theme='outline' size='13' />
                </button>
              </Tooltip>
              <Button
                className='!h-24px !px-7px !text-11px'
                size='mini'
                type='text'
                onClick={() => navigate('/settings/webui')}
              >
                {t('settings.mcpWorkspace.webuiConfiguration')}
              </Button>
            </h3>
            <p className='m-0 mt-3px text-10px text-t-tertiary'>
              {t('settings.mcpWorkspace.pairingCodeDescription', { brand: WINK_GO_DISPLAY_NAME })}
            </p>
          </div>
          <div className='flex shrink-0 items-center gap-8px'>
            <Tag
              color={relayOk ? 'green' : snapshot?.remoteGateway.state === 'waiting_authorization' ? 'orange' : 'gray'}
            >
              {relayStatus}
            </Tag>
            <Button
              disabled={!form.relayEnabled || refreshingBindingCode}
              icon={<Refresh theme='outline' size='13' />}
              loading={refreshingBindingCode}
              size='small'
              onClick={() => void refreshBindingCode()}
            >
              重新获取设备码
            </Button>
          </div>
        </div>
        <div className='mt-12px grid grid-cols-2 gap-10px max-md:grid-cols-1'>
          <div className='xiaozhi-binding-value rd-12px bg-1 px-13px py-11px'>
            <small className='block text-10px text-t-tertiary'>云端一次性绑定码</small>
            <div className='mt-5px flex items-center justify-between gap-8px'>
              <strong className='font-mono text-18px tracking-2px text-t-primary'>
                {bindingCodeValid
                  ? snapshot?.remoteGateway.bindingCode
                  : refreshingBindingCode || snapshot?.remoteGateway.connecting
                    ? '正在签发新设备码'
                    : snapshot?.remoteGateway.bindingCode
                      ? '设备码已失效'
                      : '等待云端签发'}
              </strong>
              {bindingCodeValid ? (
                <span className='text-10px text-green-7'>
                  {Math.floor(bindingSeconds / 60)
                    .toString()
                    .padStart(2, '0')}
                  :{(bindingSeconds % 60).toString().padStart(2, '0')} 后失效
                </span>
              ) : snapshot?.remoteGateway.bindingCode ? (
                <Tag color='red' size='small'>
                  已失效
                </Tag>
              ) : null}
            </div>
          </div>
          <div className='xiaozhi-binding-value rd-12px bg-1 px-13px py-11px'>
            <small className='block text-10px text-t-tertiary'>独立桌面身份</small>
            <strong className='mt-5px block truncate font-mono text-12px text-t-primary'>
              {snapshot?.remoteGateway.desktopId || '正在初始化'}
            </strong>
          </div>
        </div>
        {snapshot?.remoteGateway.lastError ? (
          <p className='m-0 mt-9px text-10px text-orange-6'>{snapshot.remoteGateway.lastError}</p>
        ) : (
          <p className='m-0 mt-9px text-10px text-t-tertiary'>
            手机 Agent MCP、ESP32 MCP 与设备绑定中转彼此独立；这里不会读取或展示任何小智 Token。
          </p>
        )}
      </section>

      <section className='xiaozhi-panel rd-20px bg-1 p-18px' data-testid='winkgo-netease-account'>
        <div className='flex items-start justify-between gap-12px border-b border-border-2 pb-11px'>
          <div className='flex min-w-0 items-start gap-10px'>
            <span className='size-38px shrink-0 flex items-center justify-center rd-12px bg-red-1 text-red-6'>
              <Music theme='outline' size='20' fill='currentColor' />
            </span>
            <div className='min-w-0'>
              <h3 className='m-0 text-15px text-t-primary'>{t('settings.mcpWorkspace.neteaseAccount.title')}</h3>
              <p className='m-0 mt-3px text-10px leading-16px text-t-tertiary'>
                {t('settings.mcpWorkspace.neteaseAccount.description')}
              </p>
            </div>
          </div>
          <Tag
            color={
              neteaseAccount?.state === 'active'
                ? 'green'
                : neteaseAccount?.state === 'needs_rebind'
                  ? 'orange'
                  : 'gray'
            }
          >
            {neteaseAccount?.state === 'active'
              ? t('settings.mcpWorkspace.neteaseAccount.statusActive')
              : neteaseAccount?.state === 'needs_rebind'
                ? t('settings.mcpWorkspace.neteaseAccount.statusNeedsRebind')
                : t('settings.mcpWorkspace.neteaseAccount.statusUnbound')}
          </Tag>
        </div>

        {neteaseAccount?.state === 'active' ? (
          <div className='mt-12px grid grid-cols-3 gap-10px max-md:grid-cols-1'>
            <div className='xiaozhi-binding-value rd-12px bg-2 px-13px py-11px'>
              <small className='block text-10px text-t-tertiary'>
                {t('settings.mcpWorkspace.neteaseAccount.accountLabel')}
              </small>
              <strong className='mt-4px block truncate text-12px text-t-primary'>{neteaseAccount.displayName}</strong>
            </div>
            <div className='xiaozhi-binding-value rd-12px bg-2 px-13px py-11px'>
              <small className='block text-10px text-t-tertiary'>
                {t('settings.mcpWorkspace.neteaseAccount.uidLabel')}
              </small>
              <strong className='mt-4px block truncate font-mono text-12px text-t-primary'>{neteaseAccount.uid}</strong>
            </div>
            <div className='xiaozhi-binding-value rd-12px bg-2 px-13px py-11px'>
              <small className='block text-10px text-t-tertiary'>
                {t('settings.mcpWorkspace.neteaseAccount.membershipLabel')}
              </small>
              <strong className='mt-4px block truncate text-12px text-t-primary'>
                {neteaseAccount.membershipLevel || t('settings.mcpWorkspace.neteaseAccount.unknownMembership')}
              </strong>
            </div>
          </div>
        ) : null}

        <div className='mt-12px grid grid-cols-[minmax(0,1fr)_auto] items-end gap-10px max-md:grid-cols-1'>
          <label className='block min-w-0'>
            <span className='mb-6px block text-11px font-600 text-t-secondary'>
              {t('settings.mcpWorkspace.neteaseAccount.inputLabel')}
            </span>
            <Input.Password
              autoComplete='off'
              className='xiaozhi-secret-input'
              maxLength={8 * 1024}
              placeholder={t('settings.mcpWorkspace.neteaseAccount.placeholder')}
              value={neteaseMusicU}
              onChange={setNeteaseMusicU}
            />
          </label>
          <div className='flex flex-wrap justify-end gap-8px max-md:justify-start'>
            <Button loading={neteaseBusy} onClick={() => void loadNeteaseAccount(true)}>
              {t('settings.mcpWorkspace.neteaseAccount.refresh')}
            </Button>
            <Button
              disabled={neteaseMusicU.trim().length < 64}
              loading={neteaseBusy}
              type='primary'
              onClick={() => void bindNeteaseAccount()}
            >
              {neteaseAccount?.state === 'active'
                ? t('settings.mcpWorkspace.neteaseAccount.rebind')
                : t('settings.mcpWorkspace.neteaseAccount.bind')}
            </Button>
            {neteaseAccount?.state === 'active' ? (
              <Popconfirm
                content={t('settings.mcpWorkspace.neteaseAccount.unbindConfirm')}
                onOk={() => void unbindNeteaseAccount()}
              >
                <Button status='danger'>{t('settings.mcpWorkspace.neteaseAccount.unbind')}</Button>
              </Popconfirm>
            ) : null}
          </div>
        </div>
        <p className='m-0 mt-9px text-10px leading-16px text-t-tertiary'>
          {t('settings.mcpWorkspace.neteaseAccount.disclosure')}
        </p>
        {neteaseError ? <p className='m-0 mt-7px text-10px text-red-6'>{neteaseError}</p> : null}
      </section>

      <section className='xiaozhi-panel rd-20px bg-1 p-18px' data-testid='winkgo-qq-music-account'>
        <div className='flex items-start justify-between gap-12px border-b border-border-2 pb-11px'>
          <div className='flex min-w-0 items-start gap-10px'>
            <span className='size-38px shrink-0 flex items-center justify-center rd-12px bg-green-1 text-green-6'>
              <Music theme='outline' size='20' fill='currentColor' />
            </span>
            <div className='min-w-0'>
              <h3 className='m-0 text-15px text-t-primary'>{t('settings.mcpWorkspace.qqMusicAccount.title')}</h3>
              <p className='m-0 mt-3px text-10px leading-16px text-t-tertiary'>
                {t('settings.mcpWorkspace.qqMusicAccount.description')}
              </p>
            </div>
          </div>
          <Tag
            color={
              qqMusicAccount?.state === 'active'
                ? 'green'
                : qqMusicAccount?.state === 'needs_rebind'
                  ? 'orange'
                  : 'gray'
            }
          >
            {qqMusicAccount?.state === 'active'
              ? t('settings.mcpWorkspace.qqMusicAccount.statusActive')
              : qqMusicAccount?.state === 'needs_rebind'
                ? t('settings.mcpWorkspace.qqMusicAccount.statusNeedsRebind')
                : t('settings.mcpWorkspace.qqMusicAccount.statusUnbound')}
          </Tag>
        </div>

        {qqMusicAccount?.state === 'active' ? (
          <div className='mt-12px grid grid-cols-3 gap-10px max-md:grid-cols-1'>
            <div className='xiaozhi-binding-value rd-12px bg-2 px-13px py-11px'>
              <small className='block text-10px text-t-tertiary'>
                {t('settings.mcpWorkspace.qqMusicAccount.accountLabel')}
              </small>
              <strong className='mt-4px block truncate text-12px text-t-primary'>{qqMusicAccount.displayName}</strong>
            </div>
            <div className='xiaozhi-binding-value rd-12px bg-2 px-13px py-11px'>
              <small className='block text-10px text-t-tertiary'>
                {t('settings.mcpWorkspace.qqMusicAccount.uidLabel')}
              </small>
              <strong className='mt-4px block truncate font-mono text-12px text-t-primary'>{qqMusicAccount.uid}</strong>
            </div>
            <div className='xiaozhi-binding-value rd-12px bg-2 px-13px py-11px'>
              <small className='block text-10px text-t-tertiary'>
                {t('settings.mcpWorkspace.qqMusicAccount.membershipLabel')}
              </small>
              <strong className='mt-4px block truncate text-12px text-t-primary'>
                {qqMusicAccount.membershipLevel || t('settings.mcpWorkspace.qqMusicAccount.unknownMembership')}
              </strong>
            </div>
          </div>
        ) : null}

        <div className='mt-12px grid grid-cols-[minmax(0,1fr)_auto] items-end gap-10px max-md:grid-cols-1'>
          <label className='block min-w-0'>
            <span className='mb-6px block text-11px font-600 text-t-secondary'>
              {t('settings.mcpWorkspace.qqMusicAccount.inputLabel')}
            </span>
            <Input.Password
              autoComplete='off'
              className='xiaozhi-secret-input'
              maxLength={16 * 1024}
              placeholder={t('settings.mcpWorkspace.qqMusicAccount.placeholder')}
              value={qqMusicCookie}
              onChange={setQqMusicCookie}
            />
          </label>
          <div className='flex flex-wrap justify-end gap-8px max-md:justify-start'>
            <Button loading={qqMusicBusy} onClick={() => void loadQqMusicAccount(true)}>
              {t('settings.mcpWorkspace.qqMusicAccount.refresh')}
            </Button>
            <Button
              disabled={qqMusicCookie.trim().length < 32}
              loading={qqMusicBusy}
              type='primary'
              onClick={() => void bindQqMusicAccount()}
            >
              {qqMusicAccount?.state === 'active'
                ? t('settings.mcpWorkspace.qqMusicAccount.rebind')
                : t('settings.mcpWorkspace.qqMusicAccount.bind')}
            </Button>
            {qqMusicAccount?.state === 'active' ? (
              <Popconfirm
                content={t('settings.mcpWorkspace.qqMusicAccount.unbindConfirm')}
                onOk={() => void unbindQqMusicAccount()}
              >
                <Button status='danger'>{t('settings.mcpWorkspace.qqMusicAccount.unbind')}</Button>
              </Popconfirm>
            ) : null}
          </div>
        </div>
        <p className='m-0 mt-9px text-10px leading-16px text-t-tertiary'>
          {t('settings.mcpWorkspace.qqMusicAccount.disclosure')}
        </p>
        {qqMusicError ? <p className='m-0 mt-7px text-10px text-red-6'>{qqMusicError}</p> : null}
      </section>

      <section className='grid grid-cols-2 gap-12px max-md:grid-cols-1'>
        <article className='xiaozhi-panel xiaozhi-agent-card rd-18px bg-1 p-16px'>
          <div className='flex items-center justify-between gap-10px'>
            <div className='flex items-center gap-9px'>
              <span className='size-37px flex items-center justify-center rd-11px bg-primary-1 text-primary-6'>
                <Cpu theme='outline' size='19' />
              </span>
              <div>
                <strong className='block text-13px text-t-primary'>ESP32 小智硬件 MCP</strong>
                <small className='text-10px text-t-tertiary'>小智官方云端 Agent 专用</small>
              </div>
            </div>
            <Switch
              checked={form.hardwareEnabled}
              onChange={(hardwareEnabled) => setForm((current) => ({ ...current, hardwareEnabled }))}
            />
          </div>
          <label className='mt-12px block'>
            <span className='mb-6px flex items-center gap-6px text-11px font-600 text-t-primary'>
              独立 MCP 地址或 Token
              <em className='text-9px font-400 not-italic text-t-tertiary'>
                {snapshot?.hardwareSecretConfigured ? '已安全保存' : '尚未配置'}
              </em>
            </span>
            <Input.Password
              autoComplete='new-password'
              className='xiaozhi-secret-input'
              disabled={!form.hardwareEnabled}
              placeholder={snapshot?.hardwareSecretConfigured ? '••••••••••••  留空不修改' : '粘贴 ESP32 独立地址'}
              value={form.hardwareAddress}
              onChange={(hardwareAddress) => setForm((current) => ({ ...current, hardwareAddress }))}
            />
          </label>
          <div className='mt-10px flex items-center gap-7px text-10px text-t-tertiary'>
            {hardwareOk ? <CheckOne theme='filled' size='14' fill='rgb(var(--green-6))' /> : <Shield size='14' />}
            {config.hardwareLastTest?.message || '检测只进行官方 WSS 握手，不执行设备指令。'}
          </div>
        </article>

        <article className='xiaozhi-panel xiaozhi-agent-card rd-18px bg-1 p-16px'>
          <div className='flex items-center justify-between gap-10px'>
            <div className='flex items-center gap-9px'>
              <span className='size-37px flex items-center justify-center rd-11px bg-purple-1 text-purple-6'>
                <Phone theme='outline' size='19' />
              </span>
              <div>
                <strong className='block text-13px text-t-primary'>手机小程序智能体 MCP</strong>
                <small className='text-10px text-t-tertiary'>独立 Agent，不与 ESP32 共用 Token</small>
              </div>
            </div>
            <Switch
              checked={form.mobileEnabled}
              onChange={(mobileEnabled) => setForm((current) => ({ ...current, mobileEnabled }))}
            />
          </div>
          <label className='mt-12px block'>
            <span className='mb-6px flex items-center gap-6px text-11px font-600 text-t-primary'>
              独立 MCP 地址或 Token
              <em className='text-9px font-400 not-italic text-t-tertiary'>
                {snapshot?.mobileSecretConfigured ? '已安全保存' : '尚未配置'}
              </em>
            </span>
            <Input.Password
              autoComplete='new-password'
              className='xiaozhi-secret-input'
              disabled={!form.mobileEnabled}
              placeholder={snapshot?.mobileSecretConfigured ? '••••••••••••  留空不修改' : '粘贴手机智能体独立地址'}
              value={form.mobileAddress}
              onChange={(mobileAddress) => setForm((current) => ({ ...current, mobileAddress }))}
            />
          </label>
          <div className='mt-10px flex items-center gap-7px text-10px text-t-tertiary'>
            {mobileOk ? <CheckOne theme='filled' size='14' fill='rgb(var(--green-6))' /> : <Shield size='14' />}
            {config.mobileLastTest?.message || '检测只进行官方 WSS 握手，不执行设备指令。'}
          </div>
        </article>
      </section>

      <div className='xiaozhi-panel xiaozhi-footer flex items-center justify-between gap-12px rd-14px bg-1 px-14px py-11px max-sm:flex-col max-sm:items-stretch'>
        <div className='flex items-center gap-8px text-10px text-t-tertiary'>
          <Shield theme='outline' size='16' />
          Token 不写入 JSON、不返回前端；只保存在 Windows 凭据管理器。
        </div>
        <div className='flex justify-end gap-7px'>
          <Button
            disabled={!snapshot?.runtimeInstalled || snapshot?.runtime.ok || busy}
            icon={<Play theme='outline' size='14' />}
            loading={starting}
            onClick={() => void startRuntime()}
          >
            启动 Runtime
          </Button>
          <Button disabled={busy} loading={saving} onClick={() => void save()}>
            保存配置
          </Button>
          <Button disabled={busy} loading={testing} type='primary' onClick={() => void testConnections()}>
            保存并检测
          </Button>
        </div>
      </div>
    </div>
  );
};

export default XiaozhiMcpConnection;
