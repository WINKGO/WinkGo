/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import type {
  WinkGoXiaozhiActionResult,
  WinkGoXiaozhiConfig,
  WinkGoXiaozhiLocalProbe,
  WinkGoXiaozhiSaveRequest,
  WinkGoXiaozhiSecretKind,
  WinkGoXiaozhiSnapshot,
  WinkGoXiaozhiTestRecord,
} from '@/common/adapter/ipcBridge';
import { getWinkGoCredentialStatus, readWinkGoCredential, writeWinkGoCredential } from './WinkGoCredentialService';
import { winkGoCloudAuthService } from './WinkGoCloudAuthService';
import { WinkGoRemoteGatewayService, type WinkGoRemoteGatewayConfig } from './winkgoRemote';

const CONFIG_DIRECTORY = 'com.winkgo.desktop';
const CONFIG_FILENAME = 'mcp-channels.json';
const DEFAULT_RUNTIME_API = 'http://127.0.0.1:8121';
const DEFAULT_BRIDGE_PORT = 8776;
const DEFAULT_RELAY_URL = 'wss://winkgo.top/desktop';
const XIAOZHI_MCP_BASE = 'wss://api.xiaozhi.me/mcp/';
const CREDENTIAL_PREFIX = 'WINKGO.CHANNEL';
const MAX_CONFIG_BYTES = 256 * 1024;
const LOCAL_TIMEOUT_MS = 1_800;
const REMOTE_TIMEOUT_MS = 10_000;
const FIREWALL_RUNTIME_RULE = 'WINK GO Runtime';
const FIREWALL_BRIDGE_RULE = 'WINK GO Voice Bridge';
const CURRENT_CONFIG_SCHEMA_VERSION = 5;
const CURRENT_RELAY_CONSENT_VERSION = 1;
const remoteGateway = new WinkGoRemoteGatewayService({
  enabled: false,
  authorized: false,
  accountId: '',
  relayUrl: DEFAULT_RELAY_URL,
  runtimeApi: DEFAULT_RUNTIME_API,
  runtimeToken: null,
});
const remoteStatusListeners = new Set<(snapshot: WinkGoXiaozhiSnapshot) => void>();
let cachedSnapshot: WinkGoXiaozhiSnapshot | null = null;

const credentialTarget = (kind: WinkGoXiaozhiSecretKind | 'runtime'): string => `${CREDENTIAL_PREFIX}.${kind}.token`;

const now = (): number => Date.now();
const bounded = (value: unknown, max: number): string =>
  (typeof value === 'string' ? value : '')
    .trim()
    .replace(/\p{Cc}/gu, '')
    .slice(0, max);

const defaultConfig = (): WinkGoXiaozhiConfig => ({
  schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
  relayConsentVersion: 0,
  runtimeApi: DEFAULT_RUNTIME_API,
  lanIp: detectWinkGoLanIp() || '127.0.0.1',
  bridgePort: DEFAULT_BRIDGE_PORT,
  relayUrl: DEFAULT_RELAY_URL,
  desktopId: '',
  bindingCode: '',
  relayEnabled: false,
  hardwareEnabled: true,
  mobileEnabled: false,
  hardwareEndpoint: XIAOZHI_MCP_BASE,
  mobileEndpoint: XIAOZHI_MCP_BASE,
  firewallAuthorized: false,
  lastSavedMs: 0,
  hardwareLastTest: null,
  mobileLastTest: null,
});

const normalizeTest = (value: unknown): WinkGoXiaozhiTestRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<WinkGoXiaozhiTestRecord>;
  if (typeof record.ok !== 'boolean' || typeof record.message !== 'string') return null;
  return {
    ok: record.ok,
    message: bounded(record.message, 260),
    toolCount: Number.isFinite(record.toolCount) ? Number(record.toolCount) : null,
    elapsedMs: Number.isFinite(record.elapsedMs) ? Number(record.elapsedMs) : 0,
    testedAtMs: Number.isFinite(record.testedAtMs) ? Number(record.testedAtMs) : 0,
  };
};

const mergeConfig = (value: unknown): WinkGoXiaozhiConfig => {
  const defaults = defaultConfig();
  if (!value || typeof value !== 'object') return defaults;
  const raw = value as Partial<WinkGoXiaozhiConfig>;
  const hasCurrentRelayConsent =
    Number(raw.schemaVersion) >= CURRENT_CONFIG_SCHEMA_VERSION &&
    raw.relayConsentVersion === CURRENT_RELAY_CONSENT_VERSION;
  return {
    schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
    relayConsentVersion: hasCurrentRelayConsent ? CURRENT_RELAY_CONSENT_VERSION : 0,
    runtimeApi: bounded(raw.runtimeApi, 300) || defaults.runtimeApi,
    lanIp: bounded(raw.lanIp, 64) || defaults.lanIp,
    bridgePort:
      Number.isInteger(raw.bridgePort) && Number(raw.bridgePort) > 0 && Number(raw.bridgePort) <= 65_535
        ? Number(raw.bridgePort)
        : defaults.bridgePort,
    relayUrl: bounded(raw.relayUrl, 500) || defaults.relayUrl,
    desktopId: bounded(raw.desktopId, 120),
    bindingCode: bounded(raw.bindingCode, 120),
    relayEnabled: hasCurrentRelayConsent && raw.relayEnabled === true,
    hardwareEnabled: typeof raw.hardwareEnabled === 'boolean' ? raw.hardwareEnabled : defaults.hardwareEnabled,
    mobileEnabled: typeof raw.mobileEnabled === 'boolean' ? raw.mobileEnabled : defaults.mobileEnabled,
    hardwareEndpoint: bounded(raw.hardwareEndpoint, 500) || defaults.hardwareEndpoint,
    mobileEndpoint: bounded(raw.mobileEndpoint, 500) || defaults.mobileEndpoint,
    firewallAuthorized: raw.firewallAuthorized === true,
    lastSavedMs: Number.isFinite(raw.lastSavedMs) ? Number(raw.lastSavedMs) : 0,
    hardwareLastTest: normalizeTest(raw.hardwareLastTest),
    mobileLastTest: normalizeTest(raw.mobileLastTest),
  };
};

const configPath = (): string => path.join(app.getPath('appData'), CONFIG_DIRECTORY, CONFIG_FILENAME);

const saveConfigFile = async (config: WinkGoXiaozhiConfig): Promise<void> => {
  const target = configPath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, target);
};

const loadConfigFile = async (): Promise<WinkGoXiaozhiConfig> => {
  try {
    const data = await readFile(configPath());
    if (data.byteLength > MAX_CONFIG_BYTES) throw new Error('小智 MCP 配置文件过大。');
    const raw = JSON.parse(data.toString('utf8')) as Partial<WinkGoXiaozhiConfig>;
    const config = mergeConfig(raw);
    if (
      raw.schemaVersion !== CURRENT_CONFIG_SCHEMA_VERSION ||
      raw.relayConsentVersion !== config.relayConsentVersion ||
      raw.relayEnabled !== config.relayEnabled
    ) {
      await saveConfigFile(config);
    }
    return config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`无法读取小智 MCP 配置：${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    const config = defaultConfig();
    await saveConfigFile(config);
    return config;
  }
};

const assertLocalRuntime = (value: string): URL => {
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new Error('Runtime 本地 API 格式不正确。');
  }
  const host = endpoint.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('为保护本机数据，Runtime 只允许连接 localhost。');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('Runtime 地址只允许 HTTP 或 HTTPS。');
  return endpoint;
};

const resolveRuntimePort = (value: string, fallback = 8121): number => {
  try {
    const endpoint = assertLocalRuntime(value);
    return Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  } catch {
    return fallback;
  }
};

const assertOfficialXiaozhiEndpoint = (value: string): URL => {
  let endpoint: URL;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new Error('小智 MCP 地址格式不正确。');
  }
  if (endpoint.protocol !== 'wss:' || endpoint.hostname !== 'api.xiaozhi.me') {
    throw new Error('只允许小智官方 api.xiaozhi.me WSS 地址。');
  }
  return endpoint;
};

const validateSaveRequest = (request: WinkGoXiaozhiSaveRequest): void => {
  assertLocalRuntime(request.runtimeApi);
  if (!isIP(request.lanIp.trim())) throw new Error('LAN IP 格式不正确。');
  if (!Number.isInteger(request.bridgePort) || request.bridgePort < 1 || request.bridgePort > 65_535) {
    throw new Error('Bridge 端口必须在 1–65535 之间。');
  }
  let relay: URL;
  try {
    relay = new URL(request.relayUrl.trim());
  } catch {
    throw new Error('设备中转地址格式不正确。');
  }
  const relayHost = relay.hostname.toLowerCase();
  const localDevelopment =
    !app.isPackaged && ['127.0.0.1', 'localhost', '::1'].includes(relayHost) && relay.protocol === 'ws:';
  if (relay.protocol !== 'wss:' && !localDevelopment) {
    throw new Error('设备中转地址必须使用安全 WSS。');
  }
  if (relayHost !== 'winkgo.top' && !relayHost.endsWith('.winkgo.top') && !localDevelopment) {
    throw new Error('设备中转地址只允许 WINK GO 官方域名。');
  }
};

const prepareChannelSecret = async (
  kind: 'hardware' | 'mobile',
  input: string | undefined,
  currentEndpoint: string
): Promise<string> => {
  const value = input?.trim() ?? '';
  if (!value) return currentEndpoint || XIAOZHI_MCP_BASE;
  if (!value.startsWith('ws://') && !value.startsWith('wss://')) {
    await writeWinkGoCredential(credentialTarget(kind), value);
    return XIAOZHI_MCP_BASE;
  }
  const endpoint = assertOfficialXiaozhiEndpoint(value);
  const tokenKeys = Array.from(new Set(endpoint.searchParams.keys())).filter((key) =>
    key.toLowerCase().includes('token')
  );
  const tokens = tokenKeys.map((key) => endpoint.searchParams.get(key)?.trim() ?? '').filter(Boolean);
  tokenKeys.forEach((key) => endpoint.searchParams.delete(key));
  const token = tokens[tokens.length - 1];
  if (token) await writeWinkGoCredential(credentialTarget(kind), token);
  return endpoint.toString();
};

const endpointWithStoredToken = async (kind: 'hardware' | 'mobile', endpointValue: string): Promise<string> => {
  const endpoint = assertOfficialXiaozhiEndpoint(endpointValue || XIAOZHI_MCP_BASE);
  const hasToken = [...endpoint.searchParams.keys()].some((key) => key.toLowerCase().includes('token'));
  if (!hasToken) {
    const token = await readWinkGoCredential(credentialTarget(kind));
    if (!token) throw new Error(kind === 'hardware' ? '尚未保存 ESP32 小智 Token。' : '尚未保存手机小程序 Token。');
    endpoint.searchParams.set('token', token);
  }
  return endpoint.toString();
};

const runtimeHeaders = async (): Promise<Record<string, string>> => {
  const token = await readWinkGoCredential(credentialTarget('runtime'));
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token.replace(/^Bearer\s+/i, '')}` } : {}),
  };
};

const reconfigureRuntimeGateway = async (config: WinkGoXiaozhiConfig, kind: 'hardware' | 'mobile'): Promise<string> => {
  const enabled = kind === 'hardware' ? config.hardwareEnabled : config.mobileEnabled;
  const endpointValue = kind === 'hardware' ? config.hardwareEndpoint : config.mobileEndpoint;
  const label = kind === 'hardware' ? 'ESP32 小智' : '手机小程序';
  const runtimeEndpoint = assertLocalRuntime(config.runtimeApi);
  runtimeEndpoint.pathname = `/api/gateways/${kind}`;
  runtimeEndpoint.search = '';
  runtimeEndpoint.hash = '';
  const endpoint = enabled ? await endpointWithStoredToken(kind, endpointValue) : endpointValue;
  const response = await fetch(runtimeEndpoint, {
    method: 'POST',
    headers: await runtimeHeaders(),
    body: JSON.stringify({ enabled, endpoint }),
    signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS * 2),
  });
  if (!response.ok) throw new Error(`${label}通道加载返回 HTTP ${response.status}。`);
  const payload = (await response.json()) as { ok?: boolean; detail?: string; message?: string };
  if (payload.ok !== true) {
    throw new Error(bounded(payload.detail || payload.message, 260) || `${label}通道未确认加载成功。`);
  }
  return `${label}通道已加载到 Runtime`;
};

const reconfigureRuntimeGateways = async (config: WinkGoXiaozhiConfig): Promise<string[]> => {
  const runtime = await probeRuntime(config.runtimeApi);
  if (!runtime.ok) throw new Error(`Runtime 尚未就绪：${runtime.detail}`);
  return Promise.all([reconfigureRuntimeGateway(config, 'hardware'), reconfigureRuntimeGateway(config, 'mobile')]);
};

const probeRuntime = async (runtimeApi: string): Promise<WinkGoXiaozhiLocalProbe> => {
  const started = now();
  try {
    const endpoint = assertLocalRuntime(runtimeApi);
    endpoint.pathname = '/api/status';
    endpoint.search = '?view=connectivity';
    const token = await readWinkGoCredential(credentialTarget('runtime'));
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token.replace(/^Bearer\s+/i, '')}` } : {}),
      },
      signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`状态接口返回 HTTP ${response.status}`);
    const payload = (await response.json()) as {
      status?: string;
      running?: boolean;
      version?: string;
      tools_count?: number;
    };
    if (!['ready', 'ok'].includes(payload.status || '') && payload.running !== true) {
      throw new Error(`Runtime 尚未就绪（${payload.status || 'unknown'}）`);
    }
    const version = bounded(payload.version, 32);
    const count = Number.isFinite(payload.tools_count) ? ` · ${payload.tools_count} 个工具` : '';
    return {
      ok: true,
      label: 'Runtime 8121',
      detail: `Runtime${version ? ` ${version}` : ''} 已就绪${count}`,
      elapsedMs: now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      label: 'Runtime 8121',
      detail: error instanceof Error ? error.message : String(error),
      elapsedMs: now() - started,
    };
  }
};

const probeTcpPort = async (host: string, port: number): Promise<WinkGoXiaozhiLocalProbe> => {
  const started = now();
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        ok,
        label: `LAN Bridge ${port}`,
        detail: ok ? `${host}:${port} 已监听` : '可选端口当前未监听，不影响云端 MCP',
        elapsedMs: now() - started,
      });
    };
    socket.setTimeout(450, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
};

const runHiddenPowerShell = async (args: string[]): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', args, {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });

const firewallRulesAuthorized = async (runtimePort: number, bridgePort: number): Promise<boolean> => {
  if (process.platform !== 'win32') return false;
  const script =
    `$ErrorActionPreference='SilentlyContinue';` +
    `$policy=New-Object -ComObject HNetCfg.FwPolicy2;` +
    `$runtime=$false;$bridge=$false;` +
    `foreach($rule in $policy.Rules){` +
    `if($rule.Enabled -and $rule.Direction -eq 1 -and $rule.Action -eq 1 -and ($rule.Profiles -band 2) -ne 0 -and $rule.Protocol -eq 6){` +
    `if($rule.Name -eq '${FIREWALL_RUNTIME_RULE}' -and [string]$rule.LocalPorts -eq '${runtimePort}'){$runtime=$true};` +
    `if($rule.Name -eq '${FIREWALL_BRIDGE_RULE}' -and [string]$rule.LocalPorts -eq '${bridgePort}'){$bridge=$true}` +
    `}};if($runtime -and $bridge){exit 0}else{exit 1}`;
  try {
    return (await runHiddenPowerShell(['-NoProfile', '-NonInteractive', '-Command', script])) === 0;
  } catch {
    return false;
  }
};

const ensureFirewallRules = async (runtimePort: number, bridgePort: number): Promise<void> => {
  if (process.platform !== 'win32') throw new Error('当前版本只支持 Windows 防火墙授权。');
  const scriptPath = path.join(app.getPath('temp'), `winkgo-firewall-${process.pid}-${now()}.ps1`);
  const elevatedScript = [
    "$ErrorActionPreference='Stop'",
    `Get-NetFirewallRule -DisplayName '${FIREWALL_RUNTIME_RULE}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop`,
    `Get-NetFirewallRule -DisplayName '${FIREWALL_BRIDGE_RULE}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop`,
    `New-NetFirewallRule -DisplayName '${FIREWALL_RUNTIME_RULE}' -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort ${runtimePort} | Out-Null`,
    `New-NetFirewallRule -DisplayName '${FIREWALL_BRIDGE_RULE}' -Direction Inbound -Action Allow -Enabled True -Profile Private -Protocol TCP -LocalPort ${bridgePort} | Out-Null`,
  ].join('\r\n');
  await writeFile(scriptPath, `${elevatedScript}\r\n`, { encoding: 'utf8', mode: 0o600 });
  const escapedPath = scriptPath.replaceAll("'", "''");
  const launcher =
    `$ErrorActionPreference='Stop';try{` +
    `$p=Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -PassThru ` +
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${escapedPath}');exit $p.ExitCode` +
    `}catch{exit 1223}`;
  try {
    const exitCode = await runHiddenPowerShell(['-NoProfile', '-NonInteractive', '-Command', launcher]);
    if (exitCode !== 0) {
      throw new Error('防火墙授权未完成。请在 Windows 用户账户控制窗口中选择“是”，然后重试。');
    }
  } finally {
    await unlink(scriptPath).catch((): void => undefined);
  }
  if (!(await firewallRulesAuthorized(runtimePort, bridgePort))) {
    throw new Error('没有检测到完整的 Runtime 8121 与 Bridge 8776 专用网络放行规则。');
  }
};

const findRuntimeExecutable = (): string | null => {
  const root = process.env.LOCALAPPDATA || '';
  const executableName = 'SparkBot-MCP-Hub-v1.1.0.exe';
  const candidates = [
    path.join(root, 'Wink Go', 'winkgo-runtime', executableName),
    path.join(process.resourcesPath, 'winkgo-runtime', executableName),
  ];
  const releasesRoot = path.join(root, 'Wink Go', 'data', 'runtime', 'xiaozhi');
  if (existsSync(releasesRoot)) {
    for (const directory of readdirSync(releasesRoot).toSorted((left, right) => right.localeCompare(left))) {
      candidates.push(path.join(releasesRoot, directory, executableName));
    }
  }
  return candidates.find(existsSync) ?? null;
};

const buildSnapshot = async (config: WinkGoXiaozhiConfig): Promise<WinkGoXiaozhiSnapshot> => {
  const runtimePort = resolveRuntimePort(config.runtimeApi);
  const targets = ['runtime', 'bridge', 'hardware', 'mobile'].map((kind) =>
    credentialTarget(kind as WinkGoXiaozhiSecretKind | 'runtime')
  );
  const [statuses, runtime, bridge, remoteGatewaySnapshot, firewallAuthorized] = await Promise.all([
    getWinkGoCredentialStatus(targets),
    probeRuntime(config.runtimeApi),
    probeTcpPort(config.lanIp, config.bridgePort),
    remoteGateway.getSnapshot(),
    firewallRulesAuthorized(runtimePort, config.bridgePort),
  ]);
  if (config.firewallAuthorized !== firewallAuthorized) {
    config.firewallAuthorized = firewallAuthorized;
    await saveConfigFile(config);
  }
  const snapshot: WinkGoXiaozhiSnapshot = {
    config: {
      ...config,
      desktopId: remoteGatewaySnapshot.desktopId,
      bindingCode: remoteGatewaySnapshot.bindingCode,
    },
    runtime,
    bridge,
    remoteGateway: remoteGatewaySnapshot,
    runtimeTokenConfigured: statuses[credentialTarget('runtime')] === true,
    bridgeTokenConfigured: statuses[credentialTarget('bridge')] === true,
    hardwareSecretConfigured: statuses[credentialTarget('hardware')] === true,
    mobileSecretConfigured: statuses[credentialTarget('mobile')] === true,
    runtimeInstalled: findRuntimeExecutable() !== null,
    configPath: configPath(),
    legacyCompatible: true,
  };
  cachedSnapshot = snapshot;
  return snapshot;
};

const remoteGatewayConfig = async (config: WinkGoXiaozhiConfig): Promise<WinkGoRemoteGatewayConfig> => {
  const authSession = winkGoCloudAuthService.getSession();
  return {
    enabled: config.relayEnabled,
    authorized: authSession.authenticated,
    accountId: authSession.user?.id || '',
    relayUrl: config.relayUrl,
    runtimeApi: config.runtimeApi,
    runtimeToken: await readWinkGoCredential(credentialTarget('runtime')),
  };
};

const syncRemoteGateway = async (config: WinkGoXiaozhiConfig): Promise<void> => {
  await remoteGateway.configure(await remoteGatewayConfig(config));
};

remoteGateway.subscribe((gatewaySnapshot) => {
  if (!cachedSnapshot) return;
  cachedSnapshot = {
    ...cachedSnapshot,
    config: {
      ...cachedSnapshot.config,
      desktopId: gatewaySnapshot.desktopId,
      bindingCode: gatewaySnapshot.bindingCode,
    },
    remoteGateway: gatewaySnapshot,
  };
  for (const listener of remoteStatusListeners) listener(cachedSnapshot);
});

const testOfficialChannel = async (
  kind: 'hardware' | 'mobile',
  endpointValue: string
): Promise<WinkGoXiaozhiTestRecord> => {
  const started = now();
  try {
    const endpoint = new URL(await endpointWithStoredToken(kind, endpointValue));
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(endpoint, { handshakeTimeout: REMOTE_TIMEOUT_MS });
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error('小智官方 WSS 握手超时。'));
      }, REMOTE_TIMEOUT_MS);
      socket.once('open', () => {
        clearTimeout(timeout);
        socket.close(1000);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
    return {
      ok: true,
      message: '小智官方 WSS 握手成功，未执行任何设备指令。',
      toolCount: null,
      elapsedMs: now() - started,
      testedAtMs: now(),
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      toolCount: null,
      elapsedMs: now() - started,
      testedAtMs: now(),
    };
  }
};

export const detectWinkGoLanIp = (): string => {
  const virtualAdapter =
    /(?:virtual|vmware|virtualbox|vethernet|hyper-v|wsl|docker|tun|tap|singbox|tailscale|zerotier)/i;
  const candidates: Array<{ address: string; score: number; order: number }> = [];
  let order = 0;
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const item of entries ?? []) {
      if (item.family !== 'IPv4' || item.internal || isIP(item.address) !== 4) continue;
      if (item.address.startsWith('169.254.') || item.address === '0.0.0.0') continue;
      let score = item.address.startsWith('192.168.') ? 300 : item.address.startsWith('10.') ? 200 : 100;
      if (virtualAdapter.test(name)) score -= 250;
      if (/\s\d+$/.test(name)) score -= 10;
      candidates.push({ address: item.address, score, order: order++ });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  return candidates[0]?.address || '';
};

export const getWinkGoXiaozhiSnapshot = async (): Promise<WinkGoXiaozhiSnapshot> => {
  const config = await loadConfigFile();
  const runtime = await probeRuntime(config.runtimeApi);
  if (runtime.ok) {
    try {
      await reconfigureRuntimeGateways(config);
    } catch (error) {
      console.warn(
        '[WINK GO Xiaozhi] Runtime 通道自动加载失败：',
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  await syncRemoteGateway(config);
  return buildSnapshot(config);
};

export const startWinkGoRemoteGateway = async (): Promise<WinkGoXiaozhiSnapshot> => {
  const config = await loadConfigFile();
  await remoteGateway.configure(await remoteGatewayConfig(config));
  await remoteGateway.start();
  return buildSnapshot(config);
};

export const stopWinkGoRemoteGateway = async (): Promise<void> => {
  await remoteGateway.stop();
};

export const refreshWinkGoRemoteAuthorization = async (): Promise<WinkGoXiaozhiSnapshot> => {
  const config = await loadConfigFile();
  await remoteGateway.configure(await remoteGatewayConfig(config));
  await remoteGateway.refreshAuthorization();
  await remoteGateway.start();
  return buildSnapshot(config);
};

export const refreshWinkGoBindingCode = async (): Promise<WinkGoXiaozhiSnapshot> => {
  const config = await loadConfigFile();
  await remoteGateway.configure(await remoteGatewayConfig(config));
  await remoteGateway.refreshBindingCode();
  await remoteGateway.start();
  return buildSnapshot(config);
};

export const clearWinkGoRemoteAuthorization = async (): Promise<void> => {
  await remoteGateway.clearAuthorization();
};

export const subscribeWinkGoXiaozhiStatus = (listener: (snapshot: WinkGoXiaozhiSnapshot) => void): (() => void) => {
  remoteStatusListeners.add(listener);
  return () => remoteStatusListeners.delete(listener);
};

export const saveWinkGoXiaozhiConfig = async (request: WinkGoXiaozhiSaveRequest): Promise<WinkGoXiaozhiSnapshot> => {
  validateSaveRequest(request);
  const config = await loadConfigFile();
  config.schemaVersion = CURRENT_CONFIG_SCHEMA_VERSION;
  config.relayConsentVersion = request.relayEnabled ? CURRENT_RELAY_CONSENT_VERSION : 0;
  config.runtimeApi = request.runtimeApi.trim().replace(/\/+$/, '');
  config.lanIp = request.lanIp.trim();
  config.bridgePort = request.bridgePort;
  config.relayUrl = request.relayUrl.trim();
  config.relayEnabled = request.relayEnabled;
  config.hardwareEnabled = request.hardwareEnabled;
  config.mobileEnabled = request.mobileEnabled;
  if (request.bridgeToken?.trim()) {
    await writeWinkGoCredential(credentialTarget('bridge'), request.bridgeToken.trim());
  }
  config.hardwareEndpoint = await prepareChannelSecret('hardware', request.hardwareAddress, config.hardwareEndpoint);
  config.mobileEndpoint = await prepareChannelSecret('mobile', request.mobileAddress, config.mobileEndpoint);
  config.lastSavedMs = now();
  await saveConfigFile(config);
  await syncRemoteGateway(config);
  const runtime = await probeRuntime(config.runtimeApi);
  if (runtime.ok) await reconfigureRuntimeGateways(config);
  return buildSnapshot(config);
};

export const testWinkGoXiaozhiConnections = async (): Promise<WinkGoXiaozhiActionResult> => {
  const config = await loadConfigFile();
  const messages: string[] = [];
  const runtime = await probeRuntime(config.runtimeApi);
  messages.push(`Runtime：${runtime.detail}`);
  if (runtime.ok) {
    messages.push(...(await reconfigureRuntimeGateways(config)));
  }
  if (config.hardwareEnabled) {
    config.hardwareLastTest = await testOfficialChannel('hardware', config.hardwareEndpoint);
    messages.push(`ESP32：${config.hardwareLastTest.message}`);
  }
  if (config.mobileEnabled) {
    config.mobileLastTest = await testOfficialChannel('mobile', config.mobileEndpoint);
    messages.push(`手机：${config.mobileLastTest.message}`);
  }
  await saveConfigFile(config);
  return {
    snapshot: await buildSnapshot(config),
    message: messages.join('；'),
  };
};

export const authorizeWinkGoXiaozhiFirewall = async (): Promise<WinkGoXiaozhiSnapshot> => {
  const config = await loadConfigFile();
  const runtimeEndpoint = assertLocalRuntime(config.runtimeApi);
  const runtimePort = Number(runtimeEndpoint.port || (runtimeEndpoint.protocol === 'https:' ? 443 : 80));
  const alreadyAuthorized = await firewallRulesAuthorized(runtimePort, config.bridgePort);
  if (!alreadyAuthorized) await ensureFirewallRules(runtimePort, config.bridgePort);
  config.firewallAuthorized = true;
  await saveConfigFile(config);
  if (cachedSnapshot) {
    cachedSnapshot = {
      ...cachedSnapshot,
      config: {
        ...cachedSnapshot.config,
        ...config,
        desktopId: cachedSnapshot.remoteGateway.desktopId,
        bindingCode: cachedSnapshot.remoteGateway.bindingCode,
      },
    };
    return cachedSnapshot;
  }
  return buildSnapshot(config);
};

export const startWinkGoXiaozhiRuntime = async (): Promise<WinkGoXiaozhiActionResult> => {
  const config = await loadConfigFile();
  const current = await probeRuntime(config.runtimeApi);
  if (current.ok) {
    await syncRemoteGateway(config);
    const loaded = await reconfigureRuntimeGateways(config);
    return { snapshot: await buildSnapshot(config), message: [current.detail, ...loaded].join('；') };
  }
  const executable = findRuntimeExecutable();
  if (!executable) throw new Error('没有找到已安装的 WINK GO Runtime。');
  const endpoint = assertLocalRuntime(config.runtimeApi);
  const port = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const runtimeConfigCandidates = [
    path.join(app.getPath('appData'), CONFIG_DIRECTORY, 'inspiration-runtime.yaml'),
    path.join(path.dirname(executable), 'config.local.yaml'),
    path.join(path.dirname(executable), 'config.bundle-local.yaml'),
  ];
  const runtimeConfig = runtimeConfigCandidates.find(existsSync);
  if (!runtimeConfig) throw new Error('没有找到 Runtime 配置文件。');
  const bridgeToken = (await readWinkGoCredential(credentialTarget('bridge'))) || '';
  const hardwareEndpoint = config.hardwareEnabled
    ? await endpointWithStoredToken('hardware', config.hardwareEndpoint)
    : config.hardwareEndpoint;
  const mobileEndpoint = config.mobileEnabled
    ? await endpointWithStoredToken('mobile', config.mobileEndpoint)
    : config.mobileEndpoint;
  const runtimeToken = await readWinkGoCredential(credentialTarget('runtime'));
  const child = spawn(executable, ['--all', '--port', String(port), '--config', runtimeConfig], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    cwd: path.dirname(executable),
    env: {
      ...process.env,
      SPARKBOT_MCP_WS_TOKEN: '',
      SPARKBOT_XIAOZHI_AUTH_TOKEN: bridgeToken,
      SPARKBOT_REMOTE_GATEWAY_ENDPOINT: hardwareEndpoint,
      SPARKBOT_REMOTE_GATEWAY_ENABLED: config.hardwareEnabled ? '1' : '0',
      SPARKBOT_MOBILE_REMOTE_GATEWAY_ENDPOINT: mobileEndpoint,
      SPARKBOT_MOBILE_REMOTE_GATEWAY_ENABLED: config.mobileEnabled ? '1' : '0',
      WINKGO_OWNER_PID: String(process.pid),
      WINKGO_EXIT_WHEN_OWNER_GONE: '1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      ...(runtimeToken ? { WINKGO_RUNTIME_ACCESS_TOKEN: runtimeToken } : {}),
    },
  });
  child.unref();
  const waitForRuntime = async (attemptsRemaining: number): Promise<WinkGoXiaozhiLocalProbe> => {
    if (attemptsRemaining <= 0) return current;
    await new Promise((resolve) => setTimeout(resolve, 300));
    const probe = await probeRuntime(config.runtimeApi);
    return probe.ok ? probe : waitForRuntime(attemptsRemaining - 1);
  };
  const probe = await waitForRuntime(90);
  if (!probe.ok) throw new Error(`Runtime 启动后仍未就绪：${probe.detail}`);
  const loaded = await reconfigureRuntimeGateways(config);
  await syncRemoteGateway(config);
  return {
    snapshot: await buildSnapshot(config),
    message: [probe.detail, ...loaded].join('；'),
  };
};
