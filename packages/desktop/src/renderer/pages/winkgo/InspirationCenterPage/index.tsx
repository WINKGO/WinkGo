/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type {
  WinkGoInspirationProvider,
  WinkGoInspirationProviderId,
  WinkGoInspirationSnapshot,
} from '@/common/adapter/ipcBridge';
import { openExternalUrl } from '@/renderer/utils/platform';
import { useAuth } from '@/renderer/hooks/context/AuthContext';
import SettingsPageHeader from '@renderer/pages/settings/components/SettingsPageHeader';
import SettingsPageWrapper from '@renderer/pages/settings/components/SettingsPageWrapper';
import {
  ArrowRight,
  Check,
  CheckOne,
  Copy,
  FileText,
  FolderOpen,
  Link,
  Lock,
  Magic,
  Refresh,
  Shield,
  TipsOne,
} from '@icon-park/react';
import { Button, Input, Message, Tag } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { INSPIRATION_TEMPLATES, type InspirationTemplate } from './catalog';

const OFFICIAL_LINKS: Partial<Record<WinkGoInspirationProviderId, string>> = {
  'didi-ride': 'https://mcp.didichuxing.com/',
  'gaode-map': 'https://lbs.amap.com/api/webservice/create-project-and-key',
};

const PROVIDER_LOGOS: Record<WinkGoInspirationProviderId, string> = {
  'didi-ride': 'https://m.didi.cn/favicon.ico',
  'meituan-life': 'https://www.meituan.com/favicon.ico',
  'gaode-map': 'https://www.amap.com/favicon.ico',
  'mcdonalds-china': 'https://www.mcdonalds.com.cn/favicon.ico',
  'luckin-coffee': 'https://www.lkcoffee.com/favicon.ico',
};

const FALLBACK_PROVIDERS: WinkGoInspirationProvider[] = [
  {
    id: 'didi-ride',
    name: '滴滴出行',
    subtitle: '地点搜索、车费预估与安全叫车交接',
    phase: 'available',
    runtime: '官方 MCP · 按需连接',
    risk: '交易确认',
    enabled: true,
    credentialConfigured: false,
    endpoint: 'https://mcp.didichuxing.com/mcp-servers',
    adapterPath: '',
    defaultCity: '珠海',
    defaultLocation: '113.519842,22.245553',
    capabilities: ['地点搜索', '车费预估', '订单状态', '确认后交接'],
    voiceExamples: ['查一下珠海站上车点', '预估从公司到珠海站的快车费用'],
    lastTest: null,
  },
  {
    id: 'meituan-life',
    name: '美团',
    subtitle: '本地生活搜索、优惠与待支付订单预览',
    phase: 'available',
    runtime: '官方 Skill · 按需启动',
    risk: '交易确认',
    enabled: false,
    credentialConfigured: false,
    endpoint: '',
    adapterPath: '',
    defaultCity: '珠海',
    defaultLocation: '113.519842,22.245553',
    capabilities: ['本地生活', '优惠搜索', '订单预览', '官方支付交接'],
    voiceExamples: ['找附近评分高的餐厅', '看看今天有什么团购优惠'],
    lastTest: null,
  },
  {
    id: 'gaode-map',
    name: '高德地图',
    subtitle: '地点搜索、周边服务与路线规划',
    phase: 'available',
    runtime: '官方 Web 服务 · 只读',
    risk: '只读查询',
    enabled: false,
    credentialConfigured: false,
    endpoint: 'https://restapi.amap.com',
    adapterPath: '',
    defaultCity: '珠海',
    defaultLocation: '113.519842,22.245553',
    capabilities: ['地点搜索', '周边 POI', '路线规划', '出行建议'],
    voiceExamples: ['查附近五公里的酒店', '规划去珠海站的路线'],
    lastTest: null,
  },
  {
    id: 'mcdonalds-china',
    name: '麦当劳',
    subtitle: '活动、菜单、优惠与点餐预览',
    phase: 'queued',
    runtime: '官方服务 · 接入计划',
    risk: '交易确认',
    enabled: false,
    credentialConfigured: false,
    endpoint: '',
    adapterPath: '',
    defaultCity: '珠海',
    defaultLocation: '113.519842,22.245553',
    capabilities: ['活动查询', '菜单搜索', '订单预览', '官方支付交接'],
    voiceExamples: ['看看麦当劳今天的活动', '生成一份套餐点餐预览'],
    lastTest: null,
  },
  {
    id: 'luckin-coffee',
    name: '瑞幸咖啡',
    subtitle: '门店、饮品推荐与下单预览',
    phase: 'queued',
    runtime: '官方服务 · 接入计划',
    risk: '交易确认',
    enabled: false,
    credentialConfigured: false,
    endpoint: '',
    adapterPath: '',
    defaultCity: '珠海',
    defaultLocation: '113.519842,22.245553',
    capabilities: ['门店查询', '饮品推荐', '订单预览', '取餐状态'],
    voiceExamples: ['推荐一杯无咖啡因饮品', '查附近的瑞幸门店'],
    lastTest: null,
  },
];

const FALLBACK_SNAPSHOT: WinkGoInspirationSnapshot = {
  selectedProvider: 'didi-ride',
  providers: FALLBACK_PROVIDERS,
  configPath: '',
  legacyCompatible: true,
};

const PROVIDER_COLORS: Record<WinkGoInspirationProviderId, { background: string; color: string }> = {
  'didi-ride': { background: '#fff4df', color: '#f29b18' },
  'meituan-life': { background: '#fff7d6', color: '#eba900' },
  'gaode-map': { background: '#e8f7ff', color: '#168de2' },
  'mcdonalds-china': { background: '#fff1ed', color: '#db2b22' },
  'luckin-coffee': { background: '#eef1ff', color: '#3159a7' },
};

const ProviderLogo: React.FC<{ provider: WinkGoInspirationProvider; large?: boolean }> = ({
  provider,
  large = false,
}) => {
  const [failed, setFailed] = useState(false);
  const size = large ? 'size-54px rd-15px' : 'size-42px rd-12px';
  const fallback = provider.name.slice(0, provider.id === 'gaode-map' ? 2 : 1);
  return (
    <span
      className={`${size} shrink-0 flex items-center justify-center overflow-hidden border border-border-2 font-700`}
      style={PROVIDER_COLORS[provider.id]}
    >
      {!failed ? (
        <img
          alt={`${provider.name} Logo`}
          className={`${large ? 'size-39px' : 'size-29px'} object-contain`}
          loading='lazy'
          referrerPolicy='no-referrer'
          src={PROVIDER_LOGOS[provider.id]}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={large ? 'text-18px' : 'text-14px'}>{fallback}</span>
      )}
    </span>
  );
};

type ProviderForm = {
  endpoint: string;
  adapterPath: string;
  defaultCity: string;
  defaultLocation: string;
  credential: string;
};

const BASIC_TEMPLATE_ICONS: Record<
  InspirationTemplate['icon'],
  React.ComponentType<{ size?: string | number; theme?: 'outline'; fill?: string }>
> = {
  folder: FolderOpen,
  file: FileText,
  magic: Magic,
};

/**
 * The Free edition keeps a useful local prompt library. It never touches the
 * managed provider bridge, downloads service adapters or asks for credentials.
 */
const BasicInspirationCenter: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const useTemplate = (template: InspirationTemplate) => {
    const prompt = t(`common.inspiration.templates.${template.id}.description`);
    void navigate('/guid', {
      state: {
        prefillPrompt: prompt,
        preservePrefillDraft: true,
        focusPrefill: true,
      },
    });
  };

  return (
    <SettingsPageWrapper contentClassName='md:max-w-1120px'>
      <SettingsPageHeader
        title={t('common.winkGoWorkspace.inspirationCenter')}
        description={t('common.inspiration.sourceNote')}
        data-testid='inspiration-center-basic-header'
        actions={
          <Button type='primary' onClick={() => void openExternalUrl('https://winkgo.top/')}>
            解锁 Pro 生活服务
          </Button>
        }
      />
      <section className='mt-18px rd-18px border border-border-2 bg-2 p-16px'>
        <div className='mb-14px flex items-center justify-between gap-12px'>
          <div>
            <h2 className='m-0 text-16px text-t-primary'>{t('common.inspiration.templateLibrary')}</h2>
            <p className='m-0 mt-4px text-12px text-t-tertiary'>
              免费版可直接使用这些本地模板；不会连接滴滴、美团、高德或其他托管服务。
            </p>
          </div>
          <Tag color='gray'>FREE</Tag>
        </div>
        <div className='grid grid-cols-3 gap-12px max-lg:grid-cols-2 max-sm:grid-cols-1'>
          {INSPIRATION_TEMPLATES.map((template) => {
            const Icon = BASIC_TEMPLATE_ICONS[template.icon];
            return (
              <button
                key={template.id}
                type='button'
                className='min-h-176px flex flex-col rd-15px border border-border-2 bg-1 p-16px text-left transition-colors hover:border-primary-4 hover:bg-primary-1'
                data-testid={`basic-inspiration-${template.id}`}
                onClick={() => useTemplate(template)}
              >
                <span className='size-39px flex items-center justify-center rd-11px bg-fill-2 text-t-secondary'>
                  <Icon theme='outline' size='20' fill='currentColor' />
                </span>
                <strong className='mt-14px text-14px text-t-primary'>
                  {t(`common.inspiration.templates.${template.id}.title`)}
                </strong>
                <span className='mt-7px line-clamp-3 text-11px leading-19px text-t-tertiary'>
                  {t(`common.inspiration.templates.${template.id}.description`)}
                </span>
                <span className='mt-auto pt-12px text-11px text-primary-6'>
                  {t('common.inspiration.useTemplate')} →
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </SettingsPageWrapper>
  );
};

const toForm = (provider: WinkGoInspirationProvider): ProviderForm => ({
  endpoint: provider.endpoint,
  adapterPath: provider.adapterPath,
  defaultCity: provider.defaultCity,
  defaultLocation: provider.defaultLocation,
  credential: '',
});

const FullInspirationCenterPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState(FALLBACK_SNAPSHOT);
  const [selectedId, setSelectedId] = useState<WinkGoInspirationProviderId>('didi-ride');
  const [form, setForm] = useState<ProviderForm>(() => toForm(FALLBACK_PROVIDERS[0]));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [linking, setLinking] = useState(false);

  const selected = useMemo(
    () => snapshot.providers.find((provider) => provider.id === selectedId) ?? snapshot.providers[0],
    [selectedId, snapshot.providers]
  );
  const passedCount = snapshot.providers.filter((provider) => provider.lastTest?.ok).length;
  const availableCount = snapshot.providers.filter((provider) => provider.phase === 'available').length;
  const busy = loading || saving || testing || linking;
  const connectedMeituan =
    selected.id === 'meituan-life' && Boolean(selected.lastTest?.ok && selected.lastTest.message.includes('账号'));

  const hydrate = (next: WinkGoInspirationSnapshot, preserveSelection = true) => {
    const nextId =
      preserveSelection && next.providers.some((provider) => provider.id === selectedId)
        ? selectedId
        : next.selectedProvider;
    setSnapshot(next);
    setSelectedId(nextId);
    const provider = next.providers.find((item) => item.id === nextId) ?? next.providers[0];
    if (provider) setForm(toForm(provider));
  };

  const loadSnapshot = async () => {
    setLoading(true);
    const result = await ipcBridge.winkGoInspiration.getSnapshot.invoke();
    setLoading(false);
    if (!result.success || !result.data) {
      Message.error(result.error || '无法读取生活服务状态。');
      return;
    }
    hydrate(result.data, false);
  };

  useEffect(() => {
    const timer = window.setTimeout((): void => {
      void loadSnapshot();
    }, 80);
    return () => window.clearTimeout(timer);
    // The bridge is intentionally queried once when this on-demand page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectProvider = (provider: WinkGoInspirationProvider) => {
    setSelectedId(provider.id);
    setForm(toForm(provider));
  };

  const saveProvider = async (quiet = false): Promise<WinkGoInspirationSnapshot | null> => {
    setSaving(true);
    const result = await ipcBridge.winkGoInspiration.saveProvider.invoke({
      providerId: selected.id,
      enabled: true,
      endpoint: form.endpoint,
      adapterPath: form.adapterPath,
      defaultCity: form.defaultCity,
      defaultLocation: form.defaultLocation,
      credential: form.credential,
    });
    setSaving(false);
    if (!result.success || !result.data) {
      Message.error(result.error || '配置保存失败。');
      return null;
    }
    hydrate(result.data);
    if (!quiet) Message.success(`${selected.name} 配置已安全保存。`);
    return result.data;
  };

  const testProvider = async () => {
    setTesting(true);
    const saved = await saveProvider(true);
    if (!saved) {
      setTesting(false);
      return;
    }
    const result = await ipcBridge.winkGoInspiration.testProvider.invoke({ providerId: selected.id });
    setTesting(false);
    if (!result.success || !result.data) {
      Message.error(result.error || '服务测试失败。');
      return;
    }
    hydrate(result.data.snapshot);
    const tested = result.data.snapshot.providers.find((provider) => provider.id === selected.id)?.lastTest;
    (tested?.ok ? Message.success : Message.error)(result.data.message);
  };

  const linkMeituan = async () => {
    setLinking(true);
    const saved = await saveProvider(true);
    if (!saved) {
      setLinking(false);
      return;
    }
    const started = await ipcBridge.winkGoInspiration.startMeituanLink.invoke();
    if (!started.success || !started.data) {
      setLinking(false);
      Message.error(started.error || '无法生成美团登录二维码。');
      return;
    }
    hydrate(started.data.snapshot);
    if (started.data.connected) {
      setLinking(false);
      Message.success(started.data.message);
      return;
    }
    const page = started.data.qrImageUrl || started.data.authUrl;
    try {
      await openExternalUrl(page);
      Message.info('扫码网页已打开，请使用美团 App 扫码。');
    } catch {
      setLinking(false);
      Message.error('无法打开美团扫码网页。');
      return;
    }
    const completed = await ipcBridge.winkGoInspiration.completeMeituanLink.invoke();
    setLinking(false);
    if (!completed.success || !completed.data) {
      Message.error(completed.error || '美团扫码登录未完成。');
      return;
    }
    hydrate(completed.data.snapshot);
    Message.success(completed.data.message);
  };

  const openOfficial = async () => {
    const url = OFFICIAL_LINKS[selected.id];
    if (!url) return;
    try {
      await openExternalUrl(url);
    } catch {
      Message.error('无法打开官方服务页面。');
    }
  };

  const useExample = (example: string) => {
    void navigate('/guid', {
      state: {
        prefillPrompt: example,
        preservePrefillDraft: true,
        focusPrefill: true,
      },
    });
  };

  const copyExample = async (example: string) => {
    try {
      await navigator.clipboard.writeText(example);
      Message.success('示例口令已复制。');
    } catch {
      Message.error('复制失败。');
    }
  };

  return (
    <SettingsPageWrapper contentClassName='md:max-w-1280px'>
      <SettingsPageHeader
        title={t('common.winkGoWorkspace.inspirationCenter')}
        description='连接滴滴、美团、高德等原 WINK GO 生活服务技能；查询可直接执行，交易操作必须再次确认。'
        data-testid='inspiration-center-header'
        actions={
          <div className='flex gap-8px'>
            <Button icon={<Refresh theme='outline' size='15' />} loading={loading} onClick={() => void loadSnapshot()}>
              刷新
            </Button>
            <Button type='primary' onClick={() => void navigate('/mcp')}>
              管理 MCP
            </Button>
          </div>
        }
      />

      <section
        className='mt-18px flex items-center justify-between gap-20px rd-17px border border-border-2 bg-2 px-18px py-15px'
        data-testid='inspiration-service-status'
      >
        <div className='flex items-center gap-12px'>
          <span className='size-43px shrink-0 flex items-center justify-center rd-13px bg-primary-1 text-primary-6'>
            <TipsOne theme='outline' size='22' fill='currentColor' />
          </span>
          <div>
            <strong className='block text-15px text-t-primary'>服务连接状态</strong>
            <span className='mt-3px block text-12px text-t-tertiary'>
              本机轻量执行 · 官方 Skill 按需启动 · 密钥保存在 Windows 凭据管理器
            </span>
          </div>
        </div>
        <div className='flex shrink-0 items-center divide-x divide-border-2'>
          <span className='min-w-70px px-14px text-center'>
            <b className='block text-18px text-t-primary'>{passedCount}</b>
            <small className='text-10px text-t-tertiary'>真实通过</small>
          </span>
          <span className='min-w-70px px-14px text-center'>
            <b className='block text-18px text-t-primary'>{availableCount}</b>
            <small className='text-10px text-t-tertiary'>当前开放</small>
          </span>
          <span className='min-w-70px px-14px text-center'>
            <b className='block text-18px text-t-primary'>{snapshot.providers.length}</b>
            <small className='text-10px text-t-tertiary'>接入计划</small>
          </span>
        </div>
      </section>

      <div className='mt-14px grid grid-cols-[290px_minmax(0,1fr)] items-start gap-14px max-lg:grid-cols-1'>
        <aside className='rd-17px border border-border-2 bg-2 p-13px' data-testid='inspiration-provider-list'>
          <div className='mb-8px flex items-start justify-between border-b border-border-2 px-4px pb-12px'>
            <div>
              <h2 className='m-0 text-16px text-t-primary'>服务接入队列</h2>
              <p className='m-0 mt-3px text-11px text-t-tertiary'>一次只验证一个品牌</p>
            </div>
            <b className='text-13px text-primary-6'>
              {passedCount}/{snapshot.providers.length}
            </b>
          </div>
          <div className='grid gap-6px max-lg:grid-cols-2 max-sm:grid-cols-1'>
            {snapshot.providers.map((provider, index) => (
              <button
                key={provider.id}
                type='button'
                className={`min-h-72px w-full flex items-center gap-10px rd-12px border px-9px py-8px text-left transition-colors ${
                  provider.id === selectedId
                    ? 'border-primary-4 bg-primary-1'
                    : 'border-transparent bg-transparent hover:bg-fill-1'
                } ${provider.phase === 'queued' ? 'opacity-68' : ''}`}
                data-testid={`inspiration-provider-${provider.id}`}
                onClick={() => selectProvider(provider)}
              >
                <span className='w-18px shrink-0 text-10px text-t-tertiary'>{String(index + 1).padStart(2, '0')}</span>
                <ProviderLogo provider={provider} />
                <span className='min-w-0 flex-1'>
                  <b className='block text-13px text-t-primary'>{provider.name}</b>
                  <small className='mt-3px block truncate text-10px text-t-tertiary'>{provider.runtime}</small>
                </span>
                {provider.lastTest?.ok ? (
                  <CheckOne theme='filled' size='16' fill='rgb(var(--green-6))' />
                ) : provider.phase === 'queued' ? (
                  <Lock theme='outline' size='15' />
                ) : (
                  <span className='size-9px rd-full border-2 border-border-3' />
                )}
              </button>
            ))}
          </div>
        </aside>

        <main className='rd-17px border border-border-2 bg-2 p-18px' data-testid='inspiration-provider-workbench'>
          <div className='min-h-74px flex items-center gap-12px border-b border-border-2 pb-15px'>
            <ProviderLogo large provider={selected} />
            <div className='min-w-0 flex-1'>
              <span className='text-10px font-600 tracking-wide text-primary-6'>{selected.runtime}</span>
              <h2 className='m-0 mt-2px text-21px text-t-primary'>{selected.name}</h2>
              <p className='m-0 mt-3px text-12px text-t-tertiary'>{selected.subtitle}</p>
            </div>
            {selected.id === 'meituan-life' ? (
              <Button
                disabled={busy || connectedMeituan}
                loading={linking}
                type={connectedMeituan ? 'secondary' : 'outline'}
                onClick={() => void linkMeituan()}
              >
                {connectedMeituan ? '美团账号已连接' : '生成二维码链接'}
              </Button>
            ) : OFFICIAL_LINKS[selected.id] ? (
              <Button icon={<Link theme='outline' size='14' />} onClick={() => void openOfficial()}>
                {selected.id === 'didi-ride' ? '滴滴 MCP 官网' : '申请 Web Key'}
              </Button>
            ) : (
              <Tag className='!rd-full'>顺序待接入</Tag>
            )}
          </div>

          <div className='flex flex-wrap gap-7px py-11px'>
            {selected.capabilities.map((capability) => (
              <Tag key={capability} icon={<Check theme='outline' size='12' />} className='!rd-8px'>
                {capability}
              </Tag>
            ))}
          </div>

          {selected.phase === 'available' ? (
            <>
              <section className='rd-14px border border-border-2 bg-1 p-15px'>
                <div className='flex items-start justify-between gap-12px'>
                  <div>
                    <h3 className='m-0 text-14px text-t-primary'>官方连接配置</h3>
                    <p className='m-0 mt-3px text-11px text-t-tertiary'>当前只做连接与只读能力验证，不会创建订单。</p>
                  </div>
                  <span className='flex items-center gap-5px text-11px text-green-6'>
                    <Shield theme='outline' size='14' />
                    {selected.id === 'meituan-life' ? '按需启动' : '本机加密'}
                  </span>
                </div>

                <div className='mt-13px grid grid-cols-2 gap-10px max-sm:grid-cols-1'>
                  {selected.id === 'meituan-life' ? (
                    <label className='col-span-2 max-sm:col-span-1'>
                      <span className='mb-6px block text-12px font-600 text-t-primary'>美团官方 Skill</span>
                      <Input value='WINK GO 内置 · 美团官方 Skill' readOnly />
                    </label>
                  ) : (
                    <label className='col-span-2 max-sm:col-span-1'>
                      <span className='mb-6px block text-12px font-600 text-t-primary'>
                        {selected.id === 'gaode-map' ? '高德 Web 服务地址' : '官方 MCP 地址'}
                      </span>
                      <Input
                        value={form.endpoint}
                        onChange={(endpoint) => setForm((current) => ({ ...current, endpoint }))}
                      />
                    </label>
                  )}
                  <label>
                    <span className='mb-6px block text-12px font-600 text-t-primary'>
                      {selected.id === 'meituan-life' ? '城市名称或 ID' : '默认城市'}
                    </span>
                    <Input
                      maxLength={32}
                      value={form.defaultCity}
                      onChange={(defaultCity) => setForm((current) => ({ ...current, defaultCity }))}
                    />
                  </label>
                  <label>
                    <span className='mb-6px block text-12px font-600 text-t-primary'>默认坐标</span>
                    <Input
                      maxLength={64}
                      placeholder='经度,纬度'
                      value={form.defaultLocation}
                      onChange={(defaultLocation) => setForm((current) => ({ ...current, defaultLocation }))}
                    />
                  </label>
                  {selected.id !== 'meituan-life' && (
                    <label className='col-span-2 max-sm:col-span-1'>
                      <span className='mb-6px flex items-center gap-7px text-12px font-600 text-t-primary'>
                        {selected.id === 'gaode-map' ? '高德 Web 服务 Key' : '滴滴 MCP Key'}
                        <em className='text-10px font-400 not-italic text-t-tertiary'>
                          {selected.credentialConfigured ? '已安全保存，留空不修改' : '尚未配置'}
                        </em>
                      </span>
                      <Input.Password
                        autoComplete='new-password'
                        placeholder={selected.credentialConfigured ? '••••••••••••' : '粘贴官网签发的 Key'}
                        value={form.credential}
                        onChange={(credential) => setForm((current) => ({ ...current, credential }))}
                      />
                    </label>
                  )}
                </div>

                <div className='mt-13px flex justify-end gap-8px'>
                  <Button disabled={busy} loading={saving} onClick={() => void saveProvider()}>
                    保存
                  </Button>
                  <Button disabled={busy} loading={testing} type='primary' onClick={() => void testProvider()}>
                    运行安全测试
                  </Button>
                </div>
              </section>

              <section
                className={`mt-10px min-h-66px flex items-center gap-10px rd-12px border p-11px ${
                  selected.lastTest?.ok
                    ? 'border-green-2 bg-green-1'
                    : selected.lastTest
                      ? 'border-red-2 bg-red-1'
                      : 'border-border-2 bg-fill-1'
                }`}
                data-testid='inspiration-test-result'
              >
                <span
                  className={`size-38px shrink-0 flex items-center justify-center rd-11px ${
                    selected.lastTest?.ok ? 'bg-green-2 text-green-7' : 'bg-fill-2 text-t-secondary'
                  }`}
                >
                  {selected.lastTest?.ok ? (
                    <CheckOne theme='filled' size='19' fill='currentColor' />
                  ) : (
                    <TipsOne theme='outline' size='19' />
                  )}
                </span>
                <div className='min-w-0 flex-1'>
                  <strong className='block text-12px text-t-primary'>
                    {selected.lastTest?.ok ? '官方连接已验证' : selected.lastTest ? '连接测试未通过' : '等待真实测试'}
                  </strong>
                  <p className='m-0 mt-3px text-11px text-t-tertiary'>
                    {selected.lastTest?.message || '保存官方凭据后，运行一次不下单的安全测试。'}
                  </p>
                </div>
                {selected.lastTest && (
                  <time className='shrink-0 text-10px text-t-tertiary'>{selected.lastTest.latencyMs} ms</time>
                )}
              </section>
            </>
          ) : (
            <section className='min-h-100px flex items-center gap-12px rd-14px border border-border-2 bg-fill-1 p-16px'>
              <span className='size-42px flex items-center justify-center rd-12px bg-fill-2 text-t-secondary'>
                <Lock theme='outline' size='21' />
              </span>
              <div>
                <strong className='text-13px text-t-primary'>按顺序等待开放</strong>
                <p className='m-0 mt-4px text-11px leading-19px text-t-tertiary'>
                  旧工程中该服务本来就是接入计划项。先完成官方接口、超时与低资源验证，再开放真实操作。
                </p>
              </div>
            </section>
          )}

          <div className='mt-10px grid grid-cols-2 gap-10px max-sm:grid-cols-1'>
            <section className='rd-12px border border-border-2 bg-1 p-13px'>
              <h3 className='m-0 text-13px text-t-primary'>自然语言示例</h3>
              <div className='mt-9px grid gap-7px'>
                {selected.voiceExamples.map((example) => (
                  <div key={example} className='flex items-center gap-6px rd-8px bg-fill-1 px-9px py-7px'>
                    <button
                      type='button'
                      className='min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-11px text-t-secondary'
                      data-testid={`inspiration-example-${selected.id}`}
                      onClick={() => useExample(example)}
                    >
                      “{example}”
                    </button>
                    <Button
                      aria-label='复制示例'
                      icon={<Copy theme='outline' size='12' />}
                      size='mini'
                      type='text'
                      onClick={() => void copyExample(example)}
                    />
                  </div>
                ))}
              </div>
            </section>
            <section className='rd-12px border border-border-2 bg-1 p-13px'>
              <h3 className='m-0 flex items-center gap-6px text-13px text-t-primary'>
                <Shield theme='outline' size='15' />
                {selected.risk}
              </h3>
              <ul className='mb-0 mt-8px pl-18px text-11px leading-23px text-t-tertiary'>
                <li>查询和预览可以直接执行</li>
                <li>叫车、下单前必须再次确认</li>
                <li>付款永远交给官方应用完成</li>
              </ul>
              {selected.phase === 'available' && (
                <Button
                  className='!mt-5px !px-0'
                  icon={<ArrowRight theme='outline' size='13' />}
                  type='text'
                  onClick={() => useExample(selected.voiceExamples[0])}
                >
                  带入聊天
                </Button>
              )}
            </section>
          </div>
        </main>
      </div>
    </SettingsPageWrapper>
  );
};

const InspirationCenterPage: React.FC = () => {
  const { can } = useAuth();
  return can('inspiration.full') ? <FullInspirationCenterPage /> : <BasicInspirationCenter />;
};

export default InspirationCenterPage;
