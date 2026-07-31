/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  WinkGoInspirationActionResult,
  WinkGoInspirationProvider,
  WinkGoInspirationProviderId,
  WinkGoInspirationSaveRequest,
  WinkGoInspirationSnapshot,
  WinkGoInspirationTestRecord,
  WinkGoMeituanLinkResult,
} from '@/common/adapter/ipcBridge';

const DIDI_ENDPOINT = 'https://mcp.didichuxing.com/mcp-servers';
const GAODE_ENDPOINT = 'https://restapi.amap.com';
const DIDI_OFFICIAL = 'https://mcp.didichuxing.com/';
const CONFIG_DIRECTORY = 'com.winkgo.desktop';
const CONFIG_FILENAME = 'inspiration-center.json';
const CREDENTIAL_TARGET_PREFIX = 'WINKGO.INSPIRATION';
const REQUEST_TIMEOUT_MS = 12_000;
const PROCESS_TIMEOUT_MS = 15_000;
const MAX_CONFIG_BYTES = 256 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 256 * 1024;

type ProviderSettings = {
  enabled: boolean;
  endpoint: string;
  adapterPath: string;
  defaultCity: string;
  defaultLocation: string;
  lastTest: WinkGoInspirationTestRecord | null;
};

type InspirationConfig = {
  schemaVersion: number;
  selectedProvider: WinkGoInspirationProviderId;
  providers: Record<WinkGoInspirationProviderId, ProviderSettings>;
  lastSavedMs: number;
};

type ProviderSpec = Pick<
  WinkGoInspirationProvider,
  'id' | 'name' | 'subtitle' | 'phase' | 'runtime' | 'risk' | 'capabilities' | 'voiceExamples'
>;

const MEITUAN_SKILL_RELATIVE_PATH = path.join(
  'winkgo',
  'provider-skills',
  'meituan-life-assistant',
  'mtunion-product-ai-all-guide'
);

const PROVIDER_SPECS: ProviderSpec[] = [
  {
    id: 'didi-ride',
    name: '滴滴出行',
    subtitle: '地点搜索、车费预估与安全叫车交接',
    phase: 'available',
    runtime: '官方 MCP · 按需连接',
    risk: '交易确认',
    capabilities: ['地点搜索', '车费预估', '订单状态', '确认后交接'],
    voiceExamples: ['查一下珠海站上车点', '预估从公司到珠海站的快车费用'],
  },
  {
    id: 'meituan-life',
    name: '美团',
    subtitle: '本地生活搜索、优惠与待支付订单预览',
    phase: 'available',
    runtime: '官方 Skill · 用户自行安装',
    risk: '交易确认',
    capabilities: ['本地生活', '优惠搜索', '订单预览', '官方支付交接'],
    voiceExamples: ['找附近评分高的餐厅', '看看今天有什么团购优惠'],
  },
  {
    id: 'gaode-map',
    name: '高德地图',
    subtitle: '地点搜索、周边服务与路线规划',
    phase: 'available',
    runtime: '官方 Web 服务 · 只读',
    risk: '只读查询',
    capabilities: ['地点搜索', '周边 POI', '路线规划', '出行建议'],
    voiceExamples: ['查附近五公里的酒店', '规划去珠海站的路线'],
  },
  {
    id: 'mcdonalds-china',
    name: '麦当劳',
    subtitle: '活动、菜单、优惠与点餐预览',
    phase: 'queued',
    runtime: '官方服务 · 接入计划',
    risk: '交易确认',
    capabilities: ['活动查询', '菜单搜索', '订单预览', '官方支付交接'],
    voiceExamples: ['看看麦当劳今天的活动', '生成一份套餐点餐预览'],
  },
  {
    id: 'luckin-coffee',
    name: '瑞幸咖啡',
    subtitle: '门店、饮品推荐与下单预览',
    phase: 'queued',
    runtime: '官方服务 · 接入计划',
    risk: '交易确认',
    capabilities: ['门店查询', '饮品推荐', '订单预览', '取餐状态'],
    voiceExamples: ['推荐一杯无咖啡因饮品', '查附近的瑞幸门店'],
  },
];

const now = (): number => Date.now();

const bounded = (value: unknown, max: number): string =>
  (typeof value === 'string' ? value : '')
    .trim()
    .replace(/\p{Cc}/gu, '')
    .slice(0, max);

const defaultProviderSettings = (id: WinkGoInspirationProviderId): ProviderSettings => ({
  enabled: id === 'didi-ride',
  endpoint: id === 'didi-ride' ? DIDI_ENDPOINT : id === 'gaode-map' ? GAODE_ENDPOINT : '',
  adapterPath: id === 'meituan-life' ? (findMeituanSkillRoot() ?? '') : '',
  defaultCity: '珠海',
  defaultLocation: '113.519842,22.245553',
  lastTest: null,
});

const defaultConfig = (): InspirationConfig => ({
  schemaVersion: 1,
  selectedProvider: 'didi-ride',
  providers: Object.fromEntries(
    PROVIDER_SPECS.map(({ id }) => [id, defaultProviderSettings(id)])
  ) as InspirationConfig['providers'],
  lastSavedMs: 0,
});

const configPath = (): string => path.join(app.getPath('appData'), CONFIG_DIRECTORY, CONFIG_FILENAME);

const mergeConfig = (input: unknown): InspirationConfig => {
  const defaults = defaultConfig();
  if (!input || typeof input !== 'object') return defaults;
  const raw = input as Partial<InspirationConfig>;
  const rawProviders =
    raw.providers && typeof raw.providers === 'object'
      ? (raw.providers as Partial<Record<WinkGoInspirationProviderId, Partial<ProviderSettings>>>)
      : {};

  for (const spec of PROVIDER_SPECS) {
    const item = rawProviders[spec.id];
    if (!item || typeof item !== 'object') continue;
    defaults.providers[spec.id] = {
      enabled: typeof item.enabled === 'boolean' ? item.enabled : defaults.providers[spec.id].enabled,
      endpoint: bounded(item.endpoint, 520) || defaults.providers[spec.id].endpoint,
      adapterPath: bounded(item.adapterPath, 520) || defaults.providers[spec.id].adapterPath,
      defaultCity: bounded(item.defaultCity, 32) || defaults.providers[spec.id].defaultCity,
      defaultLocation: bounded(item.defaultLocation, 64) || defaults.providers[spec.id].defaultLocation,
      lastTest:
        item.lastTest && typeof item.lastTest.ok === 'boolean' && typeof item.lastTest.message === 'string'
          ? {
              ok: item.lastTest.ok,
              message: bounded(item.lastTest.message, 260),
              latencyMs: Number.isFinite(item.lastTest.latencyMs) ? Number(item.lastTest.latencyMs) : 0,
              testedAtMs: Number.isFinite(item.lastTest.testedAtMs) ? Number(item.lastTest.testedAtMs) : 0,
            }
          : null,
    };
  }

  const selected = PROVIDER_SPECS.some(({ id }) => id === raw.selectedProvider)
    ? raw.selectedProvider
    : defaults.selectedProvider;
  return {
    ...defaults,
    schemaVersion: 1,
    selectedProvider: selected as WinkGoInspirationProviderId,
    lastSavedMs: Number.isFinite(raw.lastSavedMs) ? Number(raw.lastSavedMs) : 0,
  };
};

const loadConfig = async (): Promise<InspirationConfig> => {
  const target = configPath();
  try {
    const payload = await readFile(target);
    if (payload.byteLength > MAX_CONFIG_BYTES) throw new Error('灵感中心配置文件过大。');
    const config = mergeConfig(JSON.parse(payload.toString('utf8')));
    const packagedSkill = findMeituanSkillRoot();
    if (packagedSkill && config.providers['meituan-life'].adapterPath !== packagedSkill) {
      config.providers['meituan-life'].adapterPath = packagedSkill;
      await saveConfig(config);
    }
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`无法读取灵感中心配置：${error instanceof Error ? error.message : String(error)}`);
    }
    const config = defaultConfig();
    await saveConfig(config);
    return config;
  }
};

const saveConfig = async (config: InspirationConfig): Promise<void> => {
  const target = configPath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
};

const credentialTarget = (providerId: WinkGoInspirationProviderId): string =>
  `${CREDENTIAL_TARGET_PREFIX}.${providerId}.token`;

const WIN_CREDENTIAL_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
public static class WinkGoCredentialBridge {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags;
    public UInt32 Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize;
    public IntPtr CredentialBlob;
    public UInt32 Persist;
    public UInt32 AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredRead(string target, UInt32 type, UInt32 flags, out IntPtr credential);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredWrite(ref CREDENTIAL credential, UInt32 flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern bool CredDelete(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr credential);

  public static byte[] Read(string target) {
    IntPtr pointer;
    if (!CredRead(target, 1, 0, out pointer)) return null;
    try {
      var credential = (CREDENTIAL)Marshal.PtrToStructure(pointer, typeof(CREDENTIAL));
      var data = new byte[credential.CredentialBlobSize];
      if (data.Length > 0) Marshal.Copy(credential.CredentialBlob, data, 0, data.Length);
      return data;
    } finally {
      CredFree(pointer);
    }
  }

  public static bool Write(string target, byte[] data) {
    IntPtr targetPointer = Marshal.StringToCoTaskMemUni(target);
    IntPtr userPointer = Marshal.StringToCoTaskMemUni("WINK GO");
    IntPtr dataPointer = Marshal.AllocCoTaskMem(data.Length);
    try {
      if (data.Length > 0) Marshal.Copy(data, 0, dataPointer, data.Length);
      var credential = new CREDENTIAL {
        Type = 1,
        TargetName = targetPointer,
        CredentialBlobSize = (UInt32)data.Length,
        CredentialBlob = dataPointer,
        Persist = 2,
        UserName = userPointer
      };
      return CredWrite(ref credential, 0);
    } finally {
      Marshal.FreeCoTaskMem(targetPointer);
      Marshal.FreeCoTaskMem(userPointer);
      Marshal.FreeCoTaskMem(dataPointer);
    }
  }

  public static bool Delete(string target) {
    if (CredDelete(target, 1, 0)) return true;
    return Marshal.GetLastWin32Error() == 1168;
  }
}`;

const runPowerShell = async (
  body: string,
  options: { input?: string; target?: string; timeoutMs?: number } = {}
): Promise<string> => {
  if (process.platform !== 'win32') throw new Error('灵感服务凭据管理当前只支持 Windows。');
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const script = `$ErrorActionPreference='Stop'\n${body}`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: {
        ...process.env,
        WINKGO_CREDENTIAL_TARGET: options.target ?? '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Windows 凭据管理器响应超时。'));
    }, options.timeoutMs ?? 15_000);
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes <= 16 * 1024) stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (Buffer.concat(stderr).byteLength < 16 * 1024) stderr.push(chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(Buffer.concat(stdout).toString('utf8').trim());
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || 'Windows 凭据操作失败。'));
    });
    child.stdin.end(options.input ?? '');
  });
};

const credentialRead = async (providerId: WinkGoInspirationProviderId): Promise<string | null> => {
  if (process.platform !== 'win32') return null;
  const output = await runPowerShell(
    `Add-Type -TypeDefinition @'\n${WIN_CREDENTIAL_SOURCE}\n'@\n` +
      `$value=[WinkGoCredentialBridge]::Read($env:WINKGO_CREDENTIAL_TARGET)\n` +
      `if ($null -ne $value) { [Console]::Out.Write([Convert]::ToBase64String($value)) }`,
    { target: credentialTarget(providerId) }
  );
  if (!output) return null;
  return Buffer.from(output, 'base64').toString('utf8');
};

const credentialWrite = async (providerId: WinkGoInspirationProviderId, secret: string): Promise<void> => {
  const bytes = Buffer.from(secret, 'utf8');
  if (bytes.byteLength > 2400) throw new Error('灵感服务凭据过长，无法保存。');
  await runPowerShell(
    `Add-Type -TypeDefinition @'\n${WIN_CREDENTIAL_SOURCE}\n'@\n` +
      `$payload=[Console]::In.ReadToEnd().Trim()\n` +
      `$value=[Convert]::FromBase64String($payload)\n` +
      `if (-not [WinkGoCredentialBridge]::Write($env:WINKGO_CREDENTIAL_TARGET,$value)) { throw 'Windows 凭据写入失败。' }`,
    {
      input: bytes.toString('base64'),
      target: credentialTarget(providerId),
    }
  );
};

const credentialDelete = async (providerId: WinkGoInspirationProviderId): Promise<void> => {
  await runPowerShell(
    `Add-Type -TypeDefinition @'\n${WIN_CREDENTIAL_SOURCE}\n'@\n` +
      `if (-not [WinkGoCredentialBridge]::Delete($env:WINKGO_CREDENTIAL_TARGET)) { throw 'Windows 凭据删除失败。' }`,
    { target: credentialTarget(providerId) }
  );
};

const credentialConfiguredMap = async (): Promise<Record<WinkGoInspirationProviderId, boolean>> => {
  const result = Object.fromEntries(PROVIDER_SPECS.map(({ id }) => [id, false])) as Record<
    WinkGoInspirationProviderId,
    boolean
  >;
  if (process.platform !== 'win32') return result;
  const ids: WinkGoInspirationProviderId[] = ['didi-ride', 'gaode-map'];
  const targets = ids.map(credentialTarget);
  const output = await runPowerShell(
    `Add-Type -TypeDefinition @'\n${WIN_CREDENTIAL_SOURCE}\n'@\n` +
      `$targets=$env:WINKGO_CREDENTIAL_TARGET -split '\\|'\n` +
      `foreach($target in $targets) { if ($null -eq [WinkGoCredentialBridge]::Read($target)) { '0' } else { '1' } }`,
    { target: targets.join('|') }
  );
  const values = output.split(/\r?\n/);
  ids.forEach((id, index) => {
    result[id] = values[index]?.trim() === '1';
  });
  return result;
};

export const resolveMeituanSkillRoot = (candidates: string[]): string | null =>
  candidates.find((candidate) => existsSync(path.join(candidate, 'scripts', 'run.js'))) ?? null;

const findMeituanSkillRoot = (): string | null => {
  const candidates = [
    path.join(process.resourcesPath || '', MEITUAN_SKILL_RELATIVE_PATH),
    path.join(app.getAppPath(), 'resources', MEITUAN_SKILL_RELATIVE_PATH),
    path.join(process.cwd(), 'resources', MEITUAN_SKILL_RELATIVE_PATH),
  ];
  return resolveMeituanSkillRoot(candidates);
};

const validateOfficialEndpoint = (providerId: WinkGoInspirationProviderId, value: string): URL => {
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new Error('服务地址格式不正确。');
  }
  if (endpoint.protocol !== 'https:') throw new Error('生活服务只允许 HTTPS 官方地址。');
  const allowed =
    (providerId === 'didi-ride' && endpoint.hostname === 'mcp.didichuxing.com') ||
    (providerId === 'gaode-map' && endpoint.hostname === 'restapi.amap.com');
  if (!allowed) throw new Error('服务地址不是当前适配器允许的官方域名。');
  return endpoint;
};

const validateMeituanSkill = (value: string): string => {
  const root = bounded(value, 520);
  if (!root || path.basename(root) !== 'mtunion-product-ai-all-guide') {
    throw new Error('请选择受支持的美团官方 Skill 文件夹。');
  }
  const runScript = path.join(root, 'scripts', 'run.js');
  if (!existsSync(runScript)) throw new Error('美团官方 Skill 缺少 scripts/run.js。');
  return runScript;
};

const buildSnapshot = async (config: InspirationConfig): Promise<WinkGoInspirationSnapshot> => {
  const credentialStatus = await credentialConfiguredMap();
  return {
    selectedProvider: config.selectedProvider,
    configPath: configPath(),
    legacyCompatible: true,
    providers: PROVIDER_SPECS.map((spec) => ({
      ...spec,
      ...config.providers[spec.id],
      credentialConfigured: credentialStatus[spec.id],
    })),
  };
};

const readResponsePreview = async (response: Response, controller: AbortController): Promise<string> => {
  if (!response.body) return '';
  const reader = response.body.getReader();
  try {
    const first = await reader.read();
    return first.value ? new TextDecoder().decode(first.value).slice(0, 64 * 1024) : '';
  } finally {
    await reader.cancel().catch((): undefined => undefined);
    controller.abort();
  }
};

const testDidi = async (settings: ProviderSettings, secret: string | null): Promise<WinkGoInspirationTestRecord> => {
  const endpoint = validateOfficialEndpoint('didi-ride', settings.endpoint);
  if (!secret?.trim()) throw new Error('请先配置滴滴官方 MCP Key。');
  endpoint.searchParams.set('key', secret.trim());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'WINK GO Inspiration', version: '0.1.0' },
        },
      }),
      signal: controller.signal,
    });
    const preview = await readResponsePreview(response, controller);
    if (!response.ok) throw new Error(`滴滴官方 MCP 初始化失败（HTTP ${response.status}）。`);
    if (!/(jsonrpc|serverInfo|event:|data:)/i.test(preview)) {
      throw new Error('滴滴官方 MCP 响应缺少协议内容。');
    }
    return {
      ok: true,
      message: `滴滴官方 MCP 真实连接成功（HTTP ${response.status}），未创建订单。`,
      latencyMs: now() - started,
      testedAtMs: now(),
    };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
};

const testGaode = async (settings: ProviderSettings, secret: string | null): Promise<WinkGoInspirationTestRecord> => {
  const endpoint = validateOfficialEndpoint('gaode-map', settings.endpoint);
  if (!secret?.trim()) throw new Error('请先配置高德 Web 服务 Key。');
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/v3/place/text`;
  endpoint.searchParams.set('key', secret.trim());
  endpoint.searchParams.set('keywords', '咖啡');
  endpoint.searchParams.set('city', settings.defaultCity.trim());
  endpoint.searchParams.set('citylimit', 'true');
  endpoint.searchParams.set('offset', '1');
  endpoint.searchParams.set('page', '1');
  endpoint.searchParams.set('extensions', 'base');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const started = now();
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`高德官方接口连接失败（HTTP ${response.status}）。`);
    const payload = (await response.json()) as { status?: string; infocode?: string; pois?: unknown[] };
    if (payload.status !== '1') throw new Error(`高德官方接口验证失败（${payload.infocode || 'UNKNOWN'}）。`);
    return {
      ok: true,
      message: `高德官方地点查询成功（返回 ${payload.pois?.length ?? 0} 条受限测试结果），未发起导航。`,
      latencyMs: now() - started,
      testedAtMs: now(),
    };
  } finally {
    clearTimeout(timeout);
  }
};

const runMeituanJson = async (runScript: string, args: string[], timeoutMs = PROCESS_TIMEOUT_MS): Promise<any> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runScript, ...args], {
      cwd: path.dirname(runScript),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('美团官方组件响应超时，已结束临时进程。'));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= MAX_PROCESS_OUTPUT_BYTES) stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (Buffer.concat(stderr).byteLength < 16 * 1024) stderr.push(chunk);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`无法启动美团官方组件：${error.message}`));
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      const text = Buffer.concat(stdout).toString('utf8').trim();
      const payload = text
        .split(/\r?\n/)
        .reverse()
        .find((line) => {
          try {
            JSON.parse(line);
            return true;
          } catch {
            return false;
          }
        });
      if (!payload) {
        reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || '美团官方组件没有返回有效数据。'));
        return;
      }
      const parsed = JSON.parse(payload) as { error?: string };
      if (code !== 0) {
        reject(new Error(`美团官方组件暂时不可用：${parsed.error || 'MEITUAN_COMPONENT_ERROR'}。`));
        return;
      }
      resolve(parsed);
    });
  });

const testMeituan = async (settings: ProviderSettings): Promise<WinkGoInspirationTestRecord> => {
  const runScript = validateMeituanSkill(settings.adapterPath);
  const started = now();
  const payload = (await runMeituanJson(runScript, ['get-token'])) as { ok?: boolean };
  if (!payload.ok) throw new Error('美团账号尚未连接，请先生成二维码并扫码。');
  return {
    ok: true,
    message: '美团账号连接有效，官方登录凭据保存在本机。',
    latencyMs: now() - started,
    testedAtMs: now(),
  };
};

const isAllowedMeituanLink = (value: string, qrImage: boolean): boolean => {
  try {
    const link = new URL(value);
    if (qrImage) return link.protocol === 'https:' && /(^|\.)meituan\.net$/i.test(link.hostname);
    return (
      (/^https?:$/.test(link.protocol) && link.hostname === 'dpurl.cn') ||
      (link.protocol === 'https:' && /(^|\.)meituan\.(com|net)$/i.test(link.hostname))
    );
  } catch {
    return false;
  }
};

export const getWinkGoInspirationSnapshot = async (): Promise<WinkGoInspirationSnapshot> =>
  buildSnapshot(await loadConfig());

export const saveWinkGoInspirationProvider = async (
  request: WinkGoInspirationSaveRequest
): Promise<WinkGoInspirationSnapshot> => {
  const spec = PROVIDER_SPECS.find(({ id }) => id === request.providerId);
  if (!spec) throw new Error('未知的灵感服务。');
  if (spec.phase !== 'available') throw new Error(`${spec.name} 当前仍在接入队列。`);
  const adapterPath =
    request.providerId === 'meituan-life' ? findMeituanSkillRoot() : bounded(request.adapterPath, 520);
  if (request.providerId === 'didi-ride' || request.providerId === 'gaode-map') {
    validateOfficialEndpoint(request.providerId, request.endpoint);
  } else if (request.providerId === 'meituan-life') {
    if (!adapterPath) throw new Error('美团官方 Skill 安装资源缺失，请重新安装 WINK GO。');
    validateMeituanSkill(adapterPath);
  }

  const config = await loadConfig();
  const current = config.providers[request.providerId];
  config.providers[request.providerId] = {
    ...current,
    enabled: request.enabled,
    endpoint: bounded(request.endpoint, 520),
    adapterPath,
    defaultCity: bounded(request.defaultCity, 32),
    defaultLocation: bounded(request.defaultLocation, 64),
    lastTest:
      request.clearCredential || request.credential?.trim() ? null : config.providers[request.providerId].lastTest,
  };
  config.selectedProvider = request.providerId;
  config.lastSavedMs = now();
  if (request.clearCredential) await credentialDelete(request.providerId);
  if (request.credential?.trim()) await credentialWrite(request.providerId, request.credential.trim());
  await saveConfig(config);
  return buildSnapshot(config);
};

export const testWinkGoInspirationProvider = async (
  providerId: WinkGoInspirationProviderId
): Promise<WinkGoInspirationActionResult> => {
  const config = await loadConfig();
  const spec = PROVIDER_SPECS.find(({ id }) => id === providerId);
  if (!spec) throw new Error('未知的灵感服务。');
  if (spec.phase !== 'available') throw new Error(`${spec.name} 当前仍在接入队列。`);
  const settings = config.providers[providerId];
  const secret = await credentialRead(providerId);
  let record: WinkGoInspirationTestRecord;
  try {
    record =
      providerId === 'didi-ride'
        ? await testDidi(settings, secret)
        : providerId === 'gaode-map'
          ? await testGaode(settings, secret)
          : await testMeituan(settings);
  } catch (error) {
    record = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      latencyMs: 0,
      testedAtMs: now(),
    };
  }
  settings.lastTest = record;
  settings.enabled = record.ok || settings.enabled;
  config.selectedProvider = providerId;
  config.lastSavedMs = now();
  await saveConfig(config);
  return {
    snapshot: await buildSnapshot(config),
    message: record.message,
  };
};

export const startMeituanAccountLink = async (): Promise<WinkGoMeituanLinkResult> => {
  const config = await loadConfig();
  const settings = config.providers['meituan-life'];
  const runScript = validateMeituanSkill(settings.adapterPath);
  const cached = (await runMeituanJson(runScript, ['get-token'])) as { ok?: boolean };
  if (cached.ok) {
    settings.enabled = true;
    settings.lastTest = {
      ok: true,
      message: '美团账号已连接，官方登录凭据保存在本机。',
      latencyMs: 0,
      testedAtMs: now(),
    };
    await saveConfig(config);
    return {
      snapshot: await buildSnapshot(config),
      connected: true,
      authUrl: '',
      qrImageUrl: '',
      message: '美团账号已连接，无需重复扫码。',
    };
  }
  let auth = (await runMeituanJson(runScript, ['auth-get-code'])) as {
    ok?: boolean;
    type?: string;
    url?: string;
  };
  if (!auth.ok) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    auth = await runMeituanJson(runScript, ['auth-get-code']);
  }
  if (!auth.ok) throw new Error('美团暂时无法生成登录链接，请稍后重试。');
  if (auth.type === 'token') {
    return {
      snapshot: await buildSnapshot(config),
      connected: true,
      authUrl: '',
      qrImageUrl: '',
      message: '美团账号已连接，无需重复扫码。',
    };
  }
  if (!auth.url || !isAllowedMeituanLink(auth.url, false)) throw new Error('美团返回的登录链接无效。');
  const qr = (await runMeituanJson(runScript, ['qrcode', auth.url])) as { imageUrl?: string };
  const qrImageUrl = qr.imageUrl && isAllowedMeituanLink(qr.imageUrl, true) ? qr.imageUrl : '';
  if (!qrImageUrl) throw new Error('美团登录二维码生成失败，请稍后重试。');
  return {
    snapshot: await buildSnapshot(config),
    connected: false,
    authUrl: auth.url,
    qrImageUrl,
    message: '美团登录二维码已生成，请使用美团 App 扫码。',
  };
};

export const completeMeituanAccountLink = async (): Promise<WinkGoInspirationActionResult> => {
  const config = await loadConfig();
  const settings = config.providers['meituan-life'];
  const runScript = validateMeituanSkill(settings.adapterPath);
  const started = now();
  const result = (await runMeituanJson(runScript, ['auth-poll-token'], 620_000)) as { ok?: boolean };
  if (!result.ok) throw new Error('美团扫码登录未完成或已超时，请重新生成二维码。');
  const verified = (await runMeituanJson(runScript, ['get-token'])) as { ok?: boolean };
  if (!verified.ok) throw new Error('美团登录结果未能保存，请重新扫码。');
  settings.enabled = true;
  settings.lastTest = {
    ok: true,
    message: '美团账号已连接，官方登录凭据保存在本机。',
    latencyMs: now() - started,
    testedAtMs: now(),
  };
  config.lastSavedMs = now();
  await saveConfig(config);
  return {
    snapshot: await buildSnapshot(config),
    message: '美团账号连接成功，可以关闭二维码网页。',
  };
};

export const WINK_GO_INSPIRATION_OFFICIAL_LINKS = {
  didi: DIDI_OFFICIAL,
  gaode: 'https://lbs.amap.com/api/webservice/create-project-and-key',
} as const;
