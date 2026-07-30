#!/usr/bin/env node
/**
 * WINK GO Runtime Skills MCP proxy.
 *
 * This intentionally uses Node/Electron built-ins only. It exposes just the
 * Runtime tools selected by the user in Skills Center and reads the Runtime
 * credential directly from Windows Credential Manager at process startup.
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const nativeSmartHome = require('./winkgo-native-smart-home.cjs');

const MAX_CONFIG_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 90_000;
const WECHAT_FAVORITES_TOOL = 'winkgo.wechat.list_favorites';
const configPath = process.argv[2];

if (!configPath) {
  process.stderr.write('[WINK GO Skills] Missing bridge config path.\n');
  process.exit(2);
}

const readConfig = () => {
  const data = fs.readFileSync(configPath);
  if (data.byteLength > MAX_CONFIG_BYTES) throw new Error('Runtime skill bridge config is too large.');
  const value = JSON.parse(data.toString('utf8'));
  const enabledSkillIds = Array.isArray(value.enabledSkillIds) ? value.enabledSkillIds : [];
  const allowedToolNames = Array.isArray(value.allowedToolNames) ? value.allowedToolNames : [];
  const allowedToolPrefixes = Array.isArray(value.allowedToolPrefixes) ? value.allowedToolPrefixes : [];
  const rawAliases =
    value.compatibilityToolAliases && typeof value.compatibilityToolAliases === 'object'
      ? value.compatibilityToolAliases
      : {};
  const compatibilityToolAliases = {};
  for (const [aliasName, rawAlias] of Object.entries(rawAliases)) {
    if (!aliasName || !rawAlias || typeof rawAlias !== 'object') continue;
    const canonicalToolName = typeof rawAlias.canonicalToolName === 'string' ? rawAlias.canonicalToolName.trim() : '';
    if (!canonicalToolName) continue;
    const argumentRenames = {};
    for (const [source, target] of Object.entries(
      rawAlias.argumentRenames && typeof rawAlias.argumentRenames === 'object' ? rawAlias.argumentRenames : {}
    )) {
      if (source && typeof target === 'string' && target.trim()) argumentRenames[source] = target.trim();
    }
    const argumentTransforms = {};
    for (const [source, transform] of Object.entries(
      rawAlias.argumentTransforms && typeof rawAlias.argumentTransforms === 'object' ? rawAlias.argumentTransforms : {}
    )) {
      if (
        source &&
        transform &&
        typeof transform === 'object' &&
        typeof transform.target === 'string' &&
        transform.target.trim() &&
        transform.operation === 'not'
      ) {
        argumentTransforms[source] = { target: transform.target.trim(), operation: 'not' };
      }
    }
    compatibilityToolAliases[aliasName] = {
      canonicalToolName,
      defaultArguments:
        rawAlias.defaultArguments && typeof rawAlias.defaultArguments === 'object' ? rawAlias.defaultArguments : {},
      argumentRenames,
      dropArguments: (Array.isArray(rawAlias.dropArguments) ? rawAlias.dropArguments : []).filter(
        (item) => typeof item === 'string'
      ),
      argumentTransforms,
    };
  }
  const wechatPreferences =
    value.skillPreferences && value.skillPreferences.wechat && typeof value.skillPreferences.wechat === 'object'
      ? value.skillPreferences.wechat
      : {};
  const smartHomePreferences =
    value.skillPreferences && value.skillPreferences.smartHome && typeof value.skillPreferences.smartHome === 'object'
      ? value.skillPreferences.smartHome
      : {};
  const normalizeTargets = (items) =>
    (Array.isArray(items) ? items : [])
      .filter((item) => typeof item === 'string' && item.trim())
      .map((item) => item.trim().slice(0, 48))
      .slice(0, 10);
  return {
    runtimeApi: typeof value.runtimeApi === 'string' ? value.runtimeApi : 'http://127.0.0.1:8121',
    runtimeLaunch:
      value.runtimeLaunch && typeof value.runtimeLaunch === 'object'
        ? {
            executablePath:
              typeof value.runtimeLaunch.executablePath === 'string' ? value.runtimeLaunch.executablePath : '',
            configPath: typeof value.runtimeLaunch.configPath === 'string' ? value.runtimeLaunch.configPath : '',
            workingDirectory:
              typeof value.runtimeLaunch.workingDirectory === 'string' ? value.runtimeLaunch.workingDirectory : '',
            ownerPid: Number.isInteger(value.runtimeLaunch.ownerPid) ? value.runtimeLaunch.ownerPid : process.ppid,
          }
        : null,
    enabledSkillIds: enabledSkillIds.filter((item) => typeof item === 'string'),
    allowedToolNames: new Set(allowedToolNames.filter((item) => typeof item === 'string')),
    allowedToolPrefixes: allowedToolPrefixes.filter((item) => typeof item === 'string'),
    compatibilityToolAliases,
    skillPreferences: {
      wechat: {
        favoriteContacts: normalizeTargets(wechatPreferences.favoriteContacts),
        favoriteGroups: normalizeTargets(wechatPreferences.favoriteGroups),
      },
      smartHome: {
        homeAssistantUrl:
          process.env.WINKGO_HOME_ASSISTANT_URL ||
          (typeof smartHomePreferences.homeAssistantUrl === 'string'
            ? smartHomePreferences.homeAssistantUrl.slice(0, 520)
            : 'http://homeassistant.local:8123'),
        accessToken: process.env.WINKGO_HOME_ASSISTANT_TOKEN || '',
        credentialTarget:
          typeof smartHomePreferences.credentialTarget === 'string'
            ? smartHomePreferences.credentialTarget.slice(0, 240)
            : 'WINKGO.SKILL.smart-home.home-assistant-token',
        appliances: Array.isArray(smartHomePreferences.appliances)
          ? smartHomePreferences.appliances.filter((item) => item && typeof item === 'object').slice(0, 200)
          : [],
        scenes: Array.isArray(smartHomePreferences.scenes)
          ? smartHomePreferences.scenes.filter((item) => item && typeof item === 'object').slice(0, 100)
          : [],
      },
    },
  };
};

const credentialPowerShell = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WinkGoRuntimeSkillCredential {
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
}
'@
$value=[WinkGoRuntimeSkillCredential]::Read($env:WINKGO_CREDENTIAL_TARGET)
if ($null -ne $value) { [Console]::Out.Write([Convert]::ToBase64String($value)) }
`;

const credentialCache = new Map();
const readWindowsCredential = (target) => {
  if (process.platform !== 'win32') return '';
  const cached = credentialCache.get(target);
  if (cached && Date.now() - cached.readAt < 30_000) return cached.value;
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const encoded = Buffer.from(credentialPowerShell, 'utf16le').toString('base64');
  const result = spawnSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    env: { ...process.env, WINKGO_CREDENTIAL_TARGET: target },
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: 16 * 1024,
  });
  if (result.status !== 0) throw new Error('Unable to read the local Runtime credential.');
  const base64 = String(result.stdout || '').trim();
  const value = base64
    ? Buffer.from(base64, 'base64')
        .toString('utf8')
        .replace(/^Bearer\s+/i, '')
    : '';
  credentialCache.set(target, { value, readAt: Date.now() });
  return value;
};
const readRuntimeToken = () => readWindowsCredential('WINKGO.CHANNEL.runtime.token');

const toRuntimeEndpoint = (runtimeApi, token) => {
  const endpoint = new URL(runtimeApi);
  if (!['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname.toLowerCase())) {
    throw new Error('Runtime Skills can connect only to this computer.');
  }
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  endpoint.pathname = '/mcp';
  endpoint.search = '';
  endpoint.hash = '';
  if (token) endpoint.searchParams.set('token', token);
  return endpoint.toString();
};

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const validateRuntimeLaunch = (launch) => {
  if (!launch || process.platform !== 'win32') return null;
  const executablePath = path.resolve(launch.executablePath || '');
  const configFile = path.resolve(launch.configPath || '');
  const workingDirectory = path.resolve(launch.workingDirectory || path.dirname(executablePath));
  if (path.basename(executablePath).toLowerCase() !== 'sparkbot-mcp-hub-v1.1.0.exe') return null;
  if (!fs.existsSync(executablePath) || !fs.existsSync(configFile)) return null;
  if (path.dirname(executablePath).toLowerCase() !== workingDirectory.toLowerCase()) return null;
  return {
    executablePath,
    configPath: configFile,
    workingDirectory,
    ownerPid: Number.isInteger(launch.ownerPid) && launch.ownerPid > 0 ? launch.ownerPid : process.ppid,
  };
};

const waitForRuntimeHealth = async (runtimeApi, token) => {
  const endpoint = new URL('/health', runtimeApi);
  for (let attempt = 0; attempt < 75; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(700),
      });
      if (response.ok) return true;
    } catch {
      // Runtime is still starting.
    }
    await delay(300);
  }
  return false;
};

const startManagedRuntime = async (config, token) => {
  const launch = validateRuntimeLaunch(config.runtimeLaunch);
  if (!launch) return false;
  const endpoint = new URL(config.runtimeApi);
  const port = Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80));
  const child = spawn(launch.executablePath, ['--all', '--port', String(port), '--config', launch.configPath], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    cwd: launch.workingDirectory,
    env: {
      ...process.env,
      SPARKBOT_MCP_WS_TOKEN: '',
      WINKGO_OWNER_PID: String(launch.ownerPid),
      WINKGO_EXIT_WHEN_OWNER_GONE: '1',
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      ...(token ? { WINKGO_RUNTIME_ACCESS_TOKEN: token } : {}),
    },
  });
  child.unref();
  return waitForRuntimeHealth(config.runtimeApi, token);
};

class RuntimeConnection {
  constructor() {
    this.socket = null;
    this.connectPromise = null;
    this.nextId = 1;
    this.pending = new Map();
    this.launchAttempted = false;
  }

  connectSocket(config, token) {
    const endpoint = toRuntimeEndpoint(config.runtimeApi, token);
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(endpoint);
      this.socket = socket;
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('Runtime MCP connection timed out.'));
      }, 5_000);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error('Runtime MCP is unavailable.'));
        },
        { once: true }
      );
      socket.addEventListener('message', (event) => this.handleMessage(event.data));
      socket.addEventListener('close', () => {
        this.socket = null;
        this.connectPromise = null;
        this.rejectPending(new Error('Runtime MCP connection closed.'));
      });
    }).then(async () => {
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'WINK GO Runtime Skills', version: '1.0.0' },
      });
      this.notify('notifications/initialized', {});
    });
  }

  async connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    const config = readConfig();
    const token = readRuntimeToken();
    this.connectPromise = this.connectSocket(config, token)
      .catch(async (error) => {
        if (this.launchAttempted) throw error;
        this.launchAttempted = true;
        const started = await startManagedRuntime(config, token);
        if (!started) throw error;
        return this.connectSocket(config, token);
      })
      .finally(() => {
        this.connectPromise = null;
      });
    return this.connectPromise;
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
    } catch {
      return;
    }
    if (message.id === undefined || message.id === null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || 'Runtime MCP request failed.'));
    else pending.resolve(message.result);
  }

  request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Runtime MCP is not connected.'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Runtime MCP request timed out.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  notify(method, params) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

const runtime = new RuntimeConnection();
const output = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const isAllowed = (name, config) =>
  config.allowedToolNames.has(name) || config.allowedToolPrefixes.some((prefix) => name.startsWith(prefix));
const transformCompatibilityCall = (name, rawArguments, config) => {
  const alias = config.compatibilityToolAliases[name];
  if (!alias) return { name, arguments: rawArguments && typeof rawArguments === 'object' ? rawArguments : {} };
  const sourceArguments = rawArguments && typeof rawArguments === 'object' ? rawArguments : {};
  const transformedArguments = { ...alias.defaultArguments, ...sourceArguments };

  for (const [source, target] of Object.entries(alias.argumentRenames)) {
    if (Object.hasOwn(transformedArguments, source)) {
      transformedArguments[target] = transformedArguments[source];
      delete transformedArguments[source];
    }
  }
  for (const [source, transform] of Object.entries(alias.argumentTransforms)) {
    if (!Object.hasOwn(transformedArguments, source)) continue;
    if (transform.operation === 'not') transformedArguments[transform.target] = !Boolean(transformedArguments[source]);
    delete transformedArguments[source];
  }
  for (const argumentName of alias.dropArguments) delete transformedArguments[argumentName];
  return { name: alias.canonicalToolName, arguments: transformedArguments };
};
const appendCompatibilityTools = (tools, config) => {
  const runtimeTools = new Map(tools.map((tool) => [tool && tool.name, tool]).filter(([name]) => Boolean(name)));
  const selectedTools = tools.filter((tool) => tool && isAllowed(tool.name, config));
  const selectedNames = new Set(selectedTools.map((tool) => tool.name));
  for (const [aliasName, alias] of Object.entries(config.compatibilityToolAliases)) {
    if (!isAllowed(aliasName, config) || selectedNames.has(aliasName)) continue;
    const canonicalTool = runtimeTools.get(alias.canonicalToolName);
    if (!canonicalTool) continue;
    selectedTools.push({
      ...canonicalTool,
      name: aliasName,
      description: `${canonicalTool.description || alias.canonicalToolName}（WINK GO 兼容名称）`,
    });
    selectedNames.add(aliasName);
  }
  return selectedTools;
};
const appendNativeTools = (tools, config) => {
  const selectedTools = [...tools];
  const selectedNames = new Set(selectedTools.map((tool) => tool && tool.name).filter(Boolean));
  for (const tool of nativeSmartHome.tools) {
    if (!tool || !isAllowed(tool.name, config) || selectedNames.has(tool.name)) continue;
    selectedTools.push(tool);
    selectedNames.add(tool.name);
  }
  return selectedTools;
};
const hasRuntimeBackedTools = (config) => {
  const nativeNames = new Set(nativeSmartHome.tools.map((tool) => tool.name));
  for (const name of config.allowedToolNames) {
    if (name !== WECHAT_FAVORITES_TOOL && !nativeNames.has(name) && !config.compatibilityToolAliases[name]) {
      return true;
    }
    const alias = config.compatibilityToolAliases[name];
    if (alias && !nativeNames.has(alias.canonicalToolName)) return true;
  }
  return config.allowedToolPrefixes.some(
    (prefix) => !'homeassistant.'.startsWith(prefix) && !'appliance.'.startsWith(prefix)
  );
};
const wechatFavoritesTool = {
  name: WECHAT_FAVORITES_TOOL,
  description: '列出这台电脑上由用户配置的微信常用联系人和常用群聊。只读；发送消息或文件仍必须再次确认。',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

const handleRequest = async (message) => {
  const { id, method, params } = message;
  if (method === 'initialize') {
    return {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'WINK GO Runtime Skills', version: '1.0.0' },
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') {
    const config = readConfig();
    if (config.enabledSkillIds.length === 0) return { tools: [] };
    let result = { tools: [] };
    if (hasRuntimeBackedTools(config)) {
      try {
        await runtime.connect();
        result = await runtime.request('tools/list', {});
      } catch (error) {
        process.stderr.write(
          `[WINK GO Skills] Runtime tool discovery is temporarily unavailable; continuing with local tools: ${
            error instanceof Error ? error.message : String(error)
          }\n`
        );
      }
    }
    const tools = Array.isArray(result && result.tools) ? result.tools : [];
    const selectedTools = appendNativeTools(appendCompatibilityTools(tools, config), config);
    if (
      config.enabledSkillIds.includes('wechat') &&
      config.allowedToolNames.has(WECHAT_FAVORITES_TOOL) &&
      !selectedTools.some((tool) => tool.name === WECHAT_FAVORITES_TOOL)
    ) {
      selectedTools.push(wechatFavoritesTool);
    }
    return { ...result, tools: selectedTools };
  }
  if (method === 'tools/call') {
    const config = readConfig();
    const name = params && typeof params.name === 'string' ? params.name : '';
    if (!name || !isAllowed(name, config)) throw new Error(`Tool "${name || 'unknown'}" is not enabled.`);
    if (name === WECHAT_FAVORITES_TOOL) {
      const favorites = config.skillPreferences.wechat;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                favorite_contacts: favorites.favoriteContacts,
                favorite_groups: favorites.favoriteGroups,
                contact_count: favorites.favoriteContacts.length,
                group_count: favorites.favoriteGroups.length,
                safety: '这是本机只读常用目标。任何消息或文件发送操作都必须由用户再次确认。',
              },
              null,
              2
            ),
          },
        ],
        structuredContent: {
          favoriteContacts: favorites.favoriteContacts,
          favoriteGroups: favorites.favoriteGroups,
        },
      };
    }
    const transformedCall = transformCompatibilityCall(name, params && params.arguments, config);
    if (nativeSmartHome.tools.some((tool) => tool.name === transformedCall.name)) {
      const smartHomePreferences = {
        ...config.skillPreferences.smartHome,
        accessToken:
          config.skillPreferences.smartHome.accessToken ||
          readWindowsCredential(config.skillPreferences.smartHome.credentialTarget),
      };
      const value = await nativeSmartHome.call(transformedCall.name, transformedCall.arguments, smartHomePreferences);
      return nativeSmartHome.toMcpResult(value);
    }
    await runtime.connect();
    return runtime.request('tools/call', { ...params, ...transformedCall });
  }
  if (method === 'shutdown') return null;
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return undefined;
  if (method === 'exit') {
    process.nextTick(() => process.exit(0));
    return undefined;
  }
  throw new Error(`Unsupported MCP method: ${method}`);
};

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
input.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    return;
  }
  Promise.resolve(handleRequest(message))
    .then((result) => {
      if (message.id !== undefined && result !== undefined) output({ jsonrpc: '2.0', id: message.id, result });
    })
    .catch((error) => {
      if (message.id !== undefined) {
        output({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
        });
      }
    });
});
input.on('close', () => process.exit(0));
