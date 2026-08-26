/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { app } from 'electron';
import type { IWinkGoSmartHomePreferences, IWinkGoSmartHomePreferencesSaveRequest } from '@/common/adapter/ipcBridge';
import { deleteWinkGoCredential, getWinkGoCredentialStatus, writeWinkGoCredential } from './WinkGoCredentialService';

export type WinkGoSkillCatalogItem = {
  id: string;
  displayName: string;
  description: string;
  capabilityLabels: string[];
  actionCount: number;
};

export type WinkGoSkillsCatalog = {
  available: boolean;
  skills: WinkGoSkillCatalogItem[];
};

export type WinkGoPreparedSkillImport = {
  skillPath?: string;
};

export type WinkGoSkillBridgePlan = {
  serverName: string;
  enabled: boolean;
  enabledSkillIds: string[];
  selectorCount: number;
  transport: {
    type: 'stdio';
    command: string;
    args: string[];
    env: Record<string, string>;
  };
  originalJson: string;
};

export type WinkGoWechatPreferences = {
  favoriteContacts: string[];
  favoriteGroups: string[];
};

type WinkGoSmartHomeBridgePreferences = {
  homeAssistantUrl: string;
  credentialTarget: string;
  appliances: Array<Record<string, unknown>>;
  scenes: Array<Record<string, unknown>>;
};

type SourceManifest = {
  id?: unknown;
  display_name?: unknown;
  description?: unknown;
  capability_labels?: unknown;
  order?: unknown;
  tool_selectors?: unknown;
  compatibility_tool_aliases?: unknown;
};

type SourceActions = {
  actions?: unknown;
};

type ToolSelectors = {
  prefixes: string[];
  names: string[];
};

type CompatibilityToolAlias = {
  canonicalToolName: string;
  defaultArguments: Record<string, unknown>;
  argumentRenames: Record<string, string>;
  dropArguments: string[];
  argumentTransforms: Record<string, { target: string; operation: 'not' }>;
};

type RuntimeSkillBridgeConfig = {
  schemaVersion: 1;
  runtimeApi: string;
  localBrowserSkillsEnabled: boolean;
  localDesktopSkillsEnabled: boolean;
  runtimeLaunch?: {
    executablePath: string;
    configPath: string;
    workingDirectory: string;
    ownerPid: number;
    desktopSkillsRoot: string;
  };
  enabledSkillIds: string[];
  allowedToolNames: string[];
  allowedToolPrefixes: string[];
  compatibilityToolAliases: Record<string, CompatibilityToolAlias>;
  skillPreferences: {
    wechat: WinkGoWechatPreferences;
    smartHome: WinkGoSmartHomeBridgePreferences;
  };
};

const excludedSkillIds = new Set(['desktop_agents', 'feishu']);
const RUNTIME_SKILLS_SERVER_NAME = 'WINK GO Runtime Skills';
const DEFAULT_RUNTIME_API = 'http://127.0.0.1:8121';
const LOCAL_BROWSER_SKILL_TOOL_NAMES = ['winkgo.browser_skill.list', 'winkgo.browser_skill.run'] as const;
const LOCAL_DESKTOP_SKILL_TOOL_NAMES = ['winkgo.desktop_skill.list', 'winkgo.desktop_skill.run'] as const;
const EMPTY_WECHAT_PREFERENCES: WinkGoWechatPreferences = {
  favoriteContacts: [],
  favoriteGroups: [],
};
const SMART_HOME_ACCESS_TOKEN_TARGET = 'WINKGO.SKILL.smart-home.home-assistant-token';
const EMPTY_SMART_HOME_PREFERENCES: WinkGoSmartHomeBridgePreferences = {
  homeAssistantUrl: 'http://homeassistant.local:8123',
  credentialTarget: SMART_HOME_ACCESS_TOKEN_TARGET,
  appliances: [],
  scenes: [],
};

const isDirectory = (candidate: string): boolean => {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
};

const readJsonFile = <T>(filePath: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

const asString = (value: unknown): string | null => {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

const asStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const label = asString(item);
    return label ? [label] : [];
  });
};

const resolveSkillsDirectory = (): string | null => {
  const candidates = [
    process.env.WINKGO_SKILLS_SOURCE_DIR,
    path.join(process.resourcesPath ?? '', 'winkgo', 'skills'),
    path.join(process.cwd(), 'resources', 'winkgo', 'skills'),
    path.join(process.resourcesPath ?? '', 'winkgo-runtime', 'skills'),
    path.join(process.cwd(), 'resources', 'winkgo-runtime', 'skills'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(isDirectory) ?? null;
};

const resolveManagedRuntimeLaunch = (): RuntimeSkillBridgeConfig['runtimeLaunch'] => {
  if (process.platform !== 'win32') return undefined;
  const executableName = 'SparkBot-MCP-Hub-v1.1.0.exe';
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(localAppData, 'Wink Go', 'winkgo-runtime', executableName),
    path.join(process.resourcesPath ?? '', 'winkgo-runtime', executableName),
  ];
  const releasesRoot = path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi');
  if (isDirectory(releasesRoot)) {
    for (const directory of fs.readdirSync(releasesRoot).toSorted((left, right) => right.localeCompare(left))) {
      candidates.push(path.join(releasesRoot, directory, executableName));
    }
  }

  const executablePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) return undefined;
  const workingDirectory = path.dirname(executablePath);
  const configCandidates = [
    path.join(app.getPath('appData'), 'com.winkgo.desktop', 'inspiration-runtime.yaml'),
    path.join(workingDirectory, 'config.local.yaml'),
    path.join(workingDirectory, 'config.bundle-local.yaml'),
    path.join(workingDirectory, 'config.yaml'),
  ];
  const configPath = configCandidates.find((candidate) => fs.existsSync(candidate));
  if (!configPath) return undefined;

  return {
    executablePath,
    configPath,
    workingDirectory,
    ownerPid: process.pid,
    desktopSkillsRoot: path.join(app.getPath('userData'), 'winkgo-desktop-skills'),
  };
};

const resolveRuntimeProxyPath = (): string => {
  const candidates = [
    path.join(process.resourcesPath ?? '', 'winkgo', 'winkgo-skill-runtime-proxy.cjs'),
    path.join(process.cwd(), 'resources', 'winkgo', 'winkgo-skill-runtime-proxy.cjs'),
  ];
  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) throw new Error('WINK GO Runtime 技能桥接器未随应用安装。');
  return resolved;
};

const findSourceSkillPath = (skillId: string): string | null => {
  const skillsDirectory = resolveSkillsDirectory();
  if (!skillsDirectory || excludedSkillIds.has(skillId)) return null;

  const sourcePath = path.join(skillsDirectory, skillId);
  if (!isDirectory(sourcePath) || !fs.existsSync(path.join(sourcePath, 'manifest.json'))) return null;
  return sourcePath;
};

const readToolSelectors = (manifest: SourceManifest, actions: SourceActions | null): ToolSelectors => {
  const selectors =
    manifest.tool_selectors && typeof manifest.tool_selectors === 'object'
      ? (manifest.tool_selectors as Record<string, unknown>)
      : {};
  const names = new Set([...asStringList(selectors.names), ...asStringList(selectors.shared_names)]);
  const prefixes = new Set(asStringList(selectors.prefixes));

  if (Array.isArray(actions?.actions)) {
    for (const action of actions.actions) {
      if (!action || typeof action !== 'object') continue;
      for (const toolName of asStringList((action as Record<string, unknown>).tool_names)) names.add(toolName);
    }
  }

  return {
    names: [...names].toSorted(),
    prefixes: [...prefixes].toSorted(),
  };
};

const readAgentVisibleToolSelectors = (
  skillId: string,
  manifest: SourceManifest,
  actions: SourceActions | null
): ToolSelectors => {
  if (skillId === 'web_automation') {
    return { names: [...LOCAL_BROWSER_SKILL_TOOL_NAMES], prefixes: [] };
  }
  if (skillId === 'desktop_automation') {
    return {
      names: [...LOCAL_DESKTOP_SKILL_TOOL_NAMES, 'desktop_automation.cancel'],
      prefixes: [],
    };
  }
  return readToolSelectors(manifest, actions);
};

const buildPortableActions = (skillId: string, actions: SourceActions | null): SourceActions | null => {
  if (skillId === 'web_automation') {
    return {
      schema_version: 1,
      skill_id: skillId,
      actions: [
        {
          id: 'list_saved',
          phrases: ['列出网页自动化技能', '查看浏览器技能'],
          tool_names: [LOCAL_BROWSER_SKILL_TOOL_NAMES[0]],
          default_arguments: {},
        },
        {
          id: 'run_saved',
          phrases: ['执行网页自动化技能', '运行浏览器技能'],
          tool_names: [LOCAL_BROWSER_SKILL_TOOL_NAMES[1]],
          default_arguments: {},
        },
      ],
    } as SourceActions;
  }
  if (skillId === 'desktop_automation') {
    return {
      schema_version: 1,
      skill_id: skillId,
      actions: [
        {
          id: 'list_saved',
          phrases: ['列出电脑自动化技能', '查看桌面技能'],
          tool_names: [LOCAL_DESKTOP_SKILL_TOOL_NAMES[0]],
          default_arguments: {},
        },
        {
          id: 'run_saved',
          phrases: ['执行电脑自动化技能', '运行桌面技能'],
          tool_names: [LOCAL_DESKTOP_SKILL_TOOL_NAMES[1]],
          default_arguments: {},
        },
        {
          id: 'cancel',
          phrases: ['停止桌面控制', '取消电脑控制'],
          tool_names: ['desktop_automation.cancel'],
          default_arguments: {},
        },
      ],
    } as SourceActions;
  }
  return actions;
};

const readCompatibilityToolAliases = (manifest: SourceManifest): Record<string, CompatibilityToolAlias> => {
  if (!manifest.compatibility_tool_aliases || typeof manifest.compatibility_tool_aliases !== 'object') return {};
  const aliases: Record<string, CompatibilityToolAlias> = {};

  for (const [aliasName, rawValue] of Object.entries(manifest.compatibility_tool_aliases as Record<string, unknown>)) {
    if (!aliasName.trim() || !rawValue || typeof rawValue !== 'object') continue;
    const value = rawValue as Record<string, unknown>;
    const canonicalToolName = asString(value.canonical_tool_name);
    if (!canonicalToolName) continue;
    const rawDefaultArguments =
      value.default_arguments && typeof value.default_arguments === 'object'
        ? (value.default_arguments as Record<string, unknown>)
        : {};
    const rawArgumentRenames =
      value.argument_renames && typeof value.argument_renames === 'object'
        ? (value.argument_renames as Record<string, unknown>)
        : {};
    const rawArgumentTransforms =
      value.argument_transforms && typeof value.argument_transforms === 'object'
        ? (value.argument_transforms as Record<string, unknown>)
        : {};
    const argumentRenames: Record<string, string> = {};
    const argumentTransforms: CompatibilityToolAlias['argumentTransforms'] = {};

    for (const [source, targetValue] of Object.entries(rawArgumentRenames)) {
      const target = asString(targetValue);
      if (source.trim() && target) argumentRenames[source] = target;
    }
    for (const [source, transformValue] of Object.entries(rawArgumentTransforms)) {
      if (!transformValue || typeof transformValue !== 'object') continue;
      const transform = transformValue as Record<string, unknown>;
      const target = asString(transform.target);
      if (source.trim() && target && transform.operation === 'not') {
        argumentTransforms[source] = { target, operation: 'not' };
      }
    }

    aliases[aliasName] = {
      canonicalToolName,
      defaultArguments: rawDefaultArguments,
      argumentRenames,
      dropArguments: asStringList(value.drop_arguments),
      argumentTransforms,
    };
  }
  return aliases;
};

const readConfiguredRuntimeApi = (): string => {
  try {
    const configFile = path.join(app.getPath('appData'), 'com.winkgo.desktop', 'mcp-channels.json');
    const value = readJsonFile<{ runtimeApi?: unknown }>(configFile);
    const runtimeApi = asString(value?.runtimeApi);
    if (!runtimeApi) return DEFAULT_RUNTIME_API;
    const endpoint = new URL(runtimeApi);
    return ['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname.toLowerCase())
      ? endpoint.toString().replace(/\/$/, '')
      : DEFAULT_RUNTIME_API;
  } catch {
    return DEFAULT_RUNTIME_API;
  }
};

const writeRuntimeBridgeConfig = (config: RuntimeSkillBridgeConfig): string => {
  const directory = path.join(app.getPath('userData'), 'winkgo-runtime-skills');
  const target = path.join(directory, 'enabled-skills.json');
  const temporary = `${target}.${process.pid}.tmp`;
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
  return target;
};

const skillPreferencesPath = (): string =>
  path.join(app.getPath('userData'), 'winkgo-runtime-skills', 'skill-preferences.json');

const normalizeFavoriteTargets = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  const normalized: string[] = [];
  for (const value of values) {
    const target = typeof value === 'string' ? value.trim().slice(0, 48) : '';
    if (!target || normalized.some((item) => item.localeCompare(target, undefined, { sensitivity: 'accent' }) === 0)) {
      continue;
    }
    normalized.push(target);
    if (normalized.length >= 10) break;
  }
  return normalized;
};

const getWinkGoSmartHomeBridgePreferences = (): WinkGoSmartHomeBridgePreferences => {
  const saved = readJsonFile<Record<string, unknown>>(skillPreferencesPath());
  const raw =
    saved?.smartHome && typeof saved.smartHome === 'object' ? (saved.smartHome as Record<string, unknown>) : {};
  const homeAssistantUrl = asString(raw.homeAssistantUrl) ?? EMPTY_SMART_HOME_PREFERENCES.homeAssistantUrl;
  const appliances = Array.isArray(raw.appliances)
    ? raw.appliances
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .slice(0, 200)
    : [];
  const scenes = Array.isArray(raw.scenes)
    ? raw.scenes
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .slice(0, 100)
    : [];
  return {
    homeAssistantUrl: homeAssistantUrl.slice(0, 520),
    credentialTarget: SMART_HOME_ACCESS_TOKEN_TARGET,
    appliances,
    scenes,
  };
};

const parseSmartHomeRegistry = (value: string, label: string, limit: number): Array<Record<string, unknown>> => {
  const trimmed = value.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${label}不是有效的 JSON。`);
  }
  if (!Array.isArray(parsed)) throw new Error(`${label}必须是 JSON 数组。`);
  if (parsed.length > limit) throw new Error(`${label}最多允许 ${limit} 项。`);
  if (parsed.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error(`${label}中的每一项都必须是对象。`);
  }
  return parsed as Array<Record<string, unknown>>;
};

const writeSkillPreferences = (patch: Record<string, unknown>): void => {
  const target = skillPreferencesPath();
  const temporary = `${target}.${process.pid}.tmp`;
  const existing = readJsonFile<Record<string, unknown>>(target) ?? {};
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify({ ...existing, ...patch }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
};

const refreshBridgePreferences = (patch: Partial<RuntimeSkillBridgeConfig['skillPreferences']>): void => {
  const target = skillPreferencesPath();
  const bridgeConfigPath = path.join(path.dirname(target), 'enabled-skills.json');
  const bridgeConfig = readJsonFile<RuntimeSkillBridgeConfig>(bridgeConfigPath);
  if (!bridgeConfig) return;
  writeRuntimeBridgeConfig({
    ...bridgeConfig,
    skillPreferences: { ...bridgeConfig.skillPreferences, ...patch },
  });
};

export const getWinkGoSmartHomePreferences = async (): Promise<IWinkGoSmartHomePreferences> => {
  const preferences = getWinkGoSmartHomeBridgePreferences();
  const credentialStatus = await getWinkGoCredentialStatus([SMART_HOME_ACCESS_TOKEN_TARGET]);
  return {
    homeAssistantUrl: preferences.homeAssistantUrl,
    accessTokenConfigured: credentialStatus[SMART_HOME_ACCESS_TOKEN_TARGET] === true,
    appliancesJson: JSON.stringify(preferences.appliances, null, 2),
    scenesJson: JSON.stringify(preferences.scenes, null, 2),
  };
};

export const saveWinkGoSmartHomePreferences = async (
  request: IWinkGoSmartHomePreferencesSaveRequest
): Promise<IWinkGoSmartHomePreferences> => {
  let homeAssistantUrl: string;
  try {
    const endpoint = new URL(request.homeAssistantUrl.trim());
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error();
    homeAssistantUrl = endpoint.toString().replace(/\/$/, '').slice(0, 520);
  } catch {
    throw new Error('Home Assistant 地址必须是有效的 HTTP 或 HTTPS 地址。');
  }
  const smartHome: WinkGoSmartHomeBridgePreferences = {
    homeAssistantUrl,
    credentialTarget: SMART_HOME_ACCESS_TOKEN_TARGET,
    appliances: parseSmartHomeRegistry(request.appliancesJson, '本地设备', 200),
    scenes: parseSmartHomeRegistry(request.scenesJson, '本地场景', 100),
  };
  if (request.clearAccessToken) await deleteWinkGoCredential(SMART_HOME_ACCESS_TOKEN_TARGET);
  if (request.accessToken?.trim()) {
    await writeWinkGoCredential(SMART_HOME_ACCESS_TOKEN_TARGET, request.accessToken.trim());
  }
  writeSkillPreferences({ smartHome });
  refreshBridgePreferences({ smartHome });
  return getWinkGoSmartHomePreferences();
};

export const getWinkGoWechatPreferences = (): WinkGoWechatPreferences => {
  const saved = readJsonFile<Partial<WinkGoWechatPreferences>>(skillPreferencesPath());
  if (!saved) return { ...EMPTY_WECHAT_PREFERENCES };
  return {
    favoriteContacts: normalizeFavoriteTargets(saved.favoriteContacts),
    favoriteGroups: normalizeFavoriteTargets(saved.favoriteGroups),
  };
};

export const saveWinkGoWechatPreferences = (preferences: WinkGoWechatPreferences): WinkGoWechatPreferences => {
  const normalized: WinkGoWechatPreferences = {
    favoriteContacts: normalizeFavoriteTargets(preferences.favoriteContacts),
    favoriteGroups: normalizeFavoriteTargets(preferences.favoriteGroups),
  };
  writeSkillPreferences(normalized);
  // Keep an already-running proxy useful without restarting the desktop app.
  refreshBridgePreferences({ wechat: normalized });
  return normalized;
};

/**
 * Reads only small manifest/action metadata. It deliberately does not load,
 * execute, or start any source-runtime service.
 */
export const listWinkGoSkillsCatalog = (): WinkGoSkillsCatalog => {
  const skillsDirectory = resolveSkillsDirectory();
  if (!skillsDirectory) return { available: false, skills: [] };

  try {
    const skills = fs
      .readdirSync(skillsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .flatMap((entry) => {
        const sourcePath = path.join(skillsDirectory, entry.name);
        const manifest = readJsonFile<SourceManifest>(path.join(sourcePath, 'manifest.json'));
        if (!manifest) return [];

        const id = asString(manifest.id) ?? entry.name;
        if (excludedSkillIds.has(id)) return [];

        const displayName = asString(manifest.display_name) ?? id;
        const description = asString(manifest.description) ?? '';
        const actions = readJsonFile<SourceActions>(path.join(sourcePath, 'actions.json'));
        const actionCount = Array.isArray(actions?.actions) ? actions.actions.length : 0;
        const order = typeof manifest.order === 'number' ? manifest.order : Number.MAX_SAFE_INTEGER;

        return [
          {
            id,
            displayName,
            description,
            capabilityLabels: asStringList(manifest.capability_labels),
            actionCount,
            order,
          },
        ];
      })
      .toSorted((left, right) => left.order - right.order || left.displayName.localeCompare(right.displayName))
      .map(({ order: _order, ...skill }) => skill);

    return { available: true, skills };
  } catch {
    return { available: false, skills: [] };
  }
};

/**
 * The original packages use their own compact metadata format. The existing
 * Skills Hub imports standard SKILL.md packages, so on an explicit user click
 * we create a tiny compatibility package in the OS temp directory. Nothing is
 * written while the catalog is merely displayed.
 */
export const prepareWinkGoSkillImport = (skillId: string): WinkGoPreparedSkillImport => {
  const sourcePath = findSourceSkillPath(skillId);
  if (!sourcePath) return {};

  try {
    const manifest = readJsonFile<SourceManifest>(path.join(sourcePath, 'manifest.json'));
    if (!manifest) return {};

    const id = asString(manifest.id) ?? skillId;
    const displayName = asString(manifest.display_name) ?? id;
    const description = asString(manifest.description) ?? displayName;
    const sourceSkillPath = path.join(sourcePath, 'SKILL.md');
    const sourceSkillBody = fs.existsSync(sourceSkillPath) ? fs.readFileSync(sourceSkillPath, 'utf8').trim() : '';
    const sourceActions = readJsonFile<SourceActions>(path.join(sourcePath, 'actions.json'));
    const actions = buildPortableActions(id, sourceActions);
    const toolNames = readAgentVisibleToolSelectors(id, manifest, actions).names;
    const portableManifest =
      id === 'web_automation' || id === 'desktop_automation'
        ? {
            ...manifest,
            tool_selectors: {
              prefixes: [],
              exclude_prefixes: [],
              exclude_names: [],
              names: toolNames,
              shared_names: [],
            },
          }
        : manifest;
    const targetPath = path.join(os.tmpdir(), 'winkgo-skill-imports', id);
    const skillDocument = [
      '---',
      `name: ${JSON.stringify(id)}`,
      `description: ${JSON.stringify(description)}`,
      '---',
      '',
      sourceSkillBody || `# ${displayName}`,
      '',
      '## WINK GO Runtime',
      '',
      'This skill is executed by the local **WINK GO Runtime Skills** MCP server.',
      'The server is enabled only while this skill remains imported. Never invent successful results;',
      'report Runtime errors to the user and ask before any action that sends messages, files, places orders,',
      'changes accounts, or has another external side effect.',
      '',
      ...(toolNames.length > 0
        ? ['Available audited tools include:', '', ...toolNames.map((name) => `- \`${name}\``), '']
        : []),
    ].join('\n');

    fs.mkdirSync(targetPath, { recursive: true });
    fs.writeFileSync(path.join(targetPath, 'SKILL.md'), skillDocument, 'utf8');
    if (actions)
      fs.writeFileSync(path.join(targetPath, 'actions.json'), `${JSON.stringify(actions, null, 2)}\n`, 'utf8');
    fs.writeFileSync(path.join(targetPath, 'manifest.json'), `${JSON.stringify(portableManifest, null, 2)}\n`, 'utf8');
    return { skillPath: targetPath };
  } catch {
    return {};
  }
};

/**
 * Builds one filtered MCP bridge for all explicitly imported WINK GO skills.
 * The bridge reads the Runtime token directly from Windows Credential Manager,
 * so neither skill packages nor renderer state ever contain the secret.
 */
export const syncWinkGoSkillBridge = (requestedSkillIds: string[]): WinkGoSkillBridgePlan => {
  const catalog = listWinkGoSkillsCatalog();
  const knownIds = new Set(catalog.skills.map((skill) => skill.id));
  const enabledSkillIds = [...new Set(requestedSkillIds)]
    .filter((skillId) => knownIds.has(skillId) && !excludedSkillIds.has(skillId))
    .toSorted();
  const allowedToolNames = new Set<string>();
  const allowedToolPrefixes = new Set<string>();
  const compatibilityToolAliases: Record<string, CompatibilityToolAlias> = {};
  const conflictedCompatibilityToolAliases = new Set<string>();
  const directActionToolOwners = new Map<string, Set<string>>();
  const compatibilityAliasOwners = new Map<string, Set<string>>();

  // Browser Skills are a local WINK GO capability rather than an imported
  // Runtime package. Always expose their two narrow tools through this bridge
  // so the desktop Agent, Dynamic Island, and ESP32 route to the same visible
  // in-app browser runner.
  LOCAL_BROWSER_SKILL_TOOL_NAMES.forEach((name) => allowedToolNames.add(name));
  LOCAL_DESKTOP_SKILL_TOOL_NAMES.forEach((name) => allowedToolNames.add(name));

  for (const skillId of enabledSkillIds) {
    const sourcePath = findSourceSkillPath(skillId);
    if (!sourcePath) continue;
    const manifest = readJsonFile<SourceManifest>(path.join(sourcePath, 'manifest.json'));
    if (!manifest) continue;
    const actions = readJsonFile<SourceActions>(path.join(sourcePath, 'actions.json'));
    const selectors = readAgentVisibleToolSelectors(skillId, manifest, actions);
    selectors.names.forEach((name) => allowedToolNames.add(name));
    selectors.prefixes.forEach((prefix) => allowedToolPrefixes.add(prefix));
    if (Array.isArray(actions?.actions)) {
      for (const action of actions.actions) {
        if (!action || typeof action !== 'object') continue;
        for (const toolName of asStringList((action as Record<string, unknown>).tool_names)) {
          const owners = directActionToolOwners.get(toolName) ?? new Set<string>();
          owners.add(skillId);
          directActionToolOwners.set(toolName, owners);
        }
      }
    }
    for (const [aliasName, alias] of Object.entries(readCompatibilityToolAliases(manifest))) {
      allowedToolNames.add(aliasName);
      const owners = compatibilityAliasOwners.get(aliasName) ?? new Set<string>();
      owners.add(skillId);
      compatibilityAliasOwners.set(aliasName, owners);
      if (conflictedCompatibilityToolAliases.has(aliasName)) continue;

      const existingAlias = compatibilityToolAliases[aliasName];
      if (!existingAlias) {
        compatibilityToolAliases[aliasName] = alias;
        continue;
      }

      // A few old generic music names were historically reused by multiple
      // players. Keeping the last definition makes an explicit NetEase or QQ
      // request silently open Soda Music (or vice versa), depending only on
      // skill sort order. Ambiguous legacy names are therefore not exported
      // when more than one enabled skill assigns them different semantics.
      if (!isDeepStrictEqual(existingAlias, alias)) {
        delete compatibilityToolAliases[aliasName];
        conflictedCompatibilityToolAliases.add(aliasName);
      }
    }
  }

  // Do not let one skill's fallback alias replace a modern canonical tool
  // that another enabled skill calls directly. Current Runtime builds expose
  // these canonical tools natively; older builds must fail clearly instead of
  // silently routing (for example) a NetEase search into Soda Music.
  for (const [aliasName, actionOwners] of directActionToolOwners) {
    const aliasOwners = compatibilityAliasOwners.get(aliasName);
    if (aliasOwners && [...actionOwners].some((owner) => !aliasOwners.has(owner))) {
      delete compatibilityToolAliases[aliasName];
      conflictedCompatibilityToolAliases.add(aliasName);
    }
  }

  for (const aliasName of conflictedCompatibilityToolAliases) {
    if (!directActionToolOwners.has(aliasName)) allowedToolNames.delete(aliasName);
  }

  const config: RuntimeSkillBridgeConfig = {
    schemaVersion: 1,
    runtimeApi: readConfiguredRuntimeApi(),
    localBrowserSkillsEnabled: true,
    localDesktopSkillsEnabled: true,
    runtimeLaunch: resolveManagedRuntimeLaunch(),
    enabledSkillIds,
    allowedToolNames: [...allowedToolNames].toSorted(),
    allowedToolPrefixes: [...allowedToolPrefixes].toSorted(),
    compatibilityToolAliases,
    skillPreferences: {
      wechat: getWinkGoWechatPreferences(),
      smartHome: getWinkGoSmartHomeBridgePreferences(),
    },
  };
  const configPath = writeRuntimeBridgeConfig(config);
  const proxyPath = resolveRuntimeProxyPath();
  const revision = createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12);
  const transport = {
    type: 'stdio' as const,
    command: process.execPath,
    args: [proxyPath, configPath, revision],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
  const originalJson = JSON.stringify({
    winkGoRuntimeSkills: {
      schemaVersion: 1,
      revision,
      enabledSkillIds,
    },
    mcpServers: {
      [RUNTIME_SKILLS_SERVER_NAME]: {
        command: transport.command,
        args: transport.args,
        env: transport.env,
      },
    },
  });

  return {
    serverName: RUNTIME_SKILLS_SERVER_NAME,
    enabled: enabledSkillIds.length > 0 || config.localBrowserSkillsEnabled || config.localDesktopSkillsEnabled,
    enabledSkillIds,
    selectorCount: allowedToolNames.size + allowedToolPrefixes.size,
    transport,
    originalJson,
  };
};
