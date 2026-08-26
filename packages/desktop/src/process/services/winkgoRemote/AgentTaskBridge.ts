/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log';
import { buildWinkGoTaskRouteContext, routeWinkGoTask } from '@process/services/winkGoTaskRouter';
import i18n from '@process/services/i18n';

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_COMMAND_CHARS = 6_000;
const MAX_SOURCE_CHARS = 512;
const MAX_TASK_HISTORY_PER_SOURCE = 10;
const AGENT_TASK_HISTORY_FILE = 'winkgo-agent-task-history.json';
const XIAOZHI_AGENT_CONTEXT = [
  '来自已绑定 ESP32 小智的语音任务。执行时沿用该助手在 WINK GO 中的技能、MCP 与权限策略。',
  '浏览器硬规则：凡是网站、网页、URL、网页搜索或在线控制任务，只能使用 WINK GO 内置浏览器 Computer Use。',
  '普通网页任务先用 inspect_browser_page 读取当前 DOM，再用 browser_action 按当前 ref 逐步操作和复核。',
  '只有 Canvas、WebGL、游戏、地图、图表等像素页面才调用 run_browser_task 使用截图视觉坐标。',
  '严禁调用 windows_open_url、任何 windows_browser_* 工具、shell/start、系统默认浏览器、Chrome、Edge 或外部 Google 浏览器。',
  '桌面原生软件任务才使用 Desktop Computer Use；登录、付款、提交订单等敏感动作必须停下等待用户确认。',
].join('\n');

type AgentTaskAssistant = Pick<Assistant, 'id' | 'name' | 'enabled' | 'agent_status' | 'agent'>;

type AgentTaskConversationRequest = {
  name: string;
  model?: TProviderWithModel;
  assistant: { id: string; locale: string };
  extra: {
    workspace: string;
    custom_workspace: boolean;
    default_files: string[];
    context: string;
  };
};

type AgentTaskBridgeDependencies = {
  listAssistants: () => Promise<AgentTaskAssistant[]>;
  getAssistantDetail: (request: { id: string; locale?: string }) => Promise<{
    defaults: { model: { mode: string; value?: string } };
    preferences: { last_model_id?: string };
  }>;
  listProviders: () => Promise<IProvider[]>;
  createConversation: (request: AgentTaskConversationRequest) => Promise<{ id: string }>;
  sendMessage: (request: { conversation_id: string; input: string }) => Promise<{
    msg_id?: string;
    turn_id: string;
    delivered_midturn?: boolean;
    queued_at_boundary?: boolean;
  }>;
  getConversation: (request: { id: string }) => Promise<{
    id: string;
    status?: string;
    runtime?: { state?: string; is_processing?: boolean; pending_confirmations?: number; turn_id?: string };
  }>;
  getConversationMessage: (request: { conversation_id: string; message_id: string }) => Promise<{
    id?: string;
    msg_id?: string;
    type?: string;
    status?: string;
    position?: string;
    content?: unknown;
  }>;
  getConversationMessages: (request: { conversation_id: string }) => Promise<{
    items: Array<{
      id?: string;
      msg_id?: string;
      type?: string;
      status?: string;
      position?: string;
      content?: unknown;
    }>;
  }>;
  stopConversation: (request: { conversation_id: string; turn_id: string }) => Promise<void>;
  listConfirmations: (request: {
    conversation_id: string;
  }) => Promise<Array<{ id: string; call_id: string; options?: Array<{ value: unknown; label?: string }> }>>;
  respondConfirmation: (request: {
    conversation_id: string;
    msg_id: string;
    call_id: string;
    data: unknown;
  }) => Promise<void>;
  listConversations: () => Promise<unknown>;
  listTeams: () => Promise<unknown>;
  listSkills: () => Promise<unknown>;
  listMcpServers: () => Promise<unknown>;
  navigateMainWindow: (route: string) => Promise<boolean>;
  loadTaskHistory: () => Promise<VoiceAgentTask[]>;
  saveTaskHistory: (tasks: VoiceAgentTask[]) => Promise<void>;
  wait: (milliseconds: number) => Promise<void>;
  tokenFactory: () => string;
};

type VoiceAgentTask = {
  source: string;
  command: string;
  assistantId: string;
  assistantName: string;
  conversationId: string;
  turnId: string;
  msgId?: string;
  queuedAtBoundary?: boolean;
  cachedExecutionStatus?: string;
  cachedFinalResult?: string;
  cachedFailureSummary?: string;
  cachedMessage?: string;
  createdAt: number;
  updatedAt: number;
};

export type WinkGoAgentTaskBridgeEndpoint = {
  url: string;
  token: string;
};

/** Build the loopback endpoint variables injected into the bundled runtime. */
export const createWinkGoAgentBridgeRuntimeEnv = (
  endpoint: WinkGoAgentTaskBridgeEndpoint
): Record<'WINKGO_AGENT_BRIDGE_URL' | 'WINKGO_AGENT_BRIDGE_TOKEN', string> => ({
  WINKGO_AGENT_BRIDGE_URL: endpoint.url,
  WINKGO_AGENT_BRIDGE_TOKEN: endpoint.token,
});

const boundedText = (value: unknown, maximum: number): string =>
  (typeof value === 'string' ? value : '')
    .trim()
    .replace(/\p{Cc}/gu, '')
    .slice(0, maximum);

const normalizedMatchText = (value: string): string =>
  value.toLocaleLowerCase().replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, '');

const assistantRuntimeKey = (assistant: AgentTaskAssistant): string =>
  assistant.agent?.acp_backend || assistant.agent?.type || '';

const RETIRED_VOICE_AGENT_KEYS = new Set([
  'codex',
  'claude',
  'claude-code',
  'openclaw',
  'trae',
  'traecn',
  'visualstudio',
  'vscode',
  'antigravity',
  'qoder',
  'kiro',
  'workbuddy',
  'qclaw',
  'hermes',
]);

const APP_FEATURE_ROUTES = {
  home: '/guid',
  assistants: '/assistants',
  agents: '/settings/agent',
  models: '/settings/model',
  skills: '/settings/skills',
  tools: '/settings/tools',
  mcp: '/mcp',
  inspiration: '/inspiration',
  canvas: '/knowledge-canvas',
  format: '/format-studio',
  appearance: '/settings/appearance',
  webui: '/settings/webui',
  pet: '/settings/pet',
  island: '/settings/island-files',
  system: '/settings/system',
  about: '/settings/about',
  scheduled: '/scheduled',
} as const;

type AppFeatureKey = keyof typeof APP_FEATURE_ROUTES;
type CatalogKind = 'conversations' | 'teams' | 'capabilities';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const asRecordList = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) return value.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item));
  const record = asRecord(value);
  const items = record?.items;
  return Array.isArray(items)
    ? items.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
};

const safeCatalogText = (value: unknown, maximum = 100): string => boundedText(value, maximum);

const aliasesForAssistant = (assistant: AgentTaskAssistant): string[] => {
  const runtime = assistantRuntimeKey(assistant);
  const aliases = [assistant.id, assistant.name, runtime];
  if (runtime === 'codex') aliases.push('codex cli', '扣袋');
  if (runtime === 'claude' || runtime === 'claude-code') aliases.push('claude code', '克劳德');
  if (runtime === 'gemini') aliases.push('gemini cli', '谷歌智能体');
  return aliases.map(normalizedMatchText).filter((item) => item.length >= 2);
};

const isUsableAssistant = (assistant: AgentTaskAssistant): boolean =>
  assistant.enabled &&
  !RETIRED_VOICE_AGENT_KEYS.has(assistantRuntimeKey(assistant).toLocaleLowerCase()) &&
  (assistant.agent_status === 'online' || assistant.agent_status === 'unchecked');

/** Resolve a spoken XiaoZhi command to an enabled WINK GO assistant. */
export const selectWinkGoVoiceAssistant = (
  command: string,
  assistants: AgentTaskAssistant[],
  preferredAssistantId = ''
): AgentTaskAssistant | undefined => {
  const commandKey = normalizedMatchText(command);
  const namesRetiredAssistant = assistants.some(
    (assistant) =>
      RETIRED_VOICE_AGENT_KEYS.has(assistantRuntimeKey(assistant).toLocaleLowerCase()) &&
      aliasesForAssistant(assistant).some((alias) => commandKey.includes(alias))
  );
  if (namesRetiredAssistant) return undefined;
  const usable = assistants.filter(isUsableAssistant);
  const explicit = usable
    .map((assistant) => ({
      assistant,
      score: Math.max(
        0,
        ...aliasesForAssistant(assistant).map((alias) => (commandKey.includes(alias) ? alias.length : 0))
      ),
    }))
    .filter((item) => item.score > 0)
    .toSorted((left, right) => right.score - left.score)[0]?.assistant;
  if (explicit) return explicit;
  return (
    usable.find((assistant) => assistant.id === preferredAssistantId) ||
    usable.find((assistant) => assistantRuntimeKey(assistant) === 'winkgo_agent') ||
    usable.find((assistant) => assistant.agent_status === 'online') ||
    usable[0]
  );
};

const taskHistoryFilePath = (): string => path.join(app.getPath('userData'), AGENT_TASK_HISTORY_FILE);

const validPersistedTask = (value: unknown): VoiceAgentTask | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const source = boundedText(record.source, MAX_SOURCE_CHARS);
  const command = boundedText(record.command, MAX_COMMAND_CHARS);
  const assistantId = boundedText(record.assistantId, 180);
  const assistantName = boundedText(record.assistantName, 180);
  const conversationId = boundedText(record.conversationId, 180);
  const turnId = boundedText(record.turnId, 180);
  if (!source || !command || !assistantId || !conversationId) return undefined;
  const createdAt = Number(record.createdAt || 0);
  const updatedAt = Number(record.updatedAt || createdAt || 0);
  return {
    source,
    command,
    assistantId,
    assistantName: assistantName || assistantId,
    conversationId,
    turnId,
    msgId: boundedText(record.msgId, 180) || undefined,
    queuedAtBoundary: record.queuedAtBoundary === true,
    cachedExecutionStatus: boundedText(record.cachedExecutionStatus, 80) || undefined,
    cachedFinalResult: boundedText(record.cachedFinalResult, 600) || undefined,
    cachedFailureSummary: boundedText(record.cachedFailureSummary, 320) || undefined,
    cachedMessage: boundedText(record.cachedMessage, 900) || undefined,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : Date.now(),
  };
};

const loadPersistedTaskHistory = async (): Promise<VoiceAgentTask[]> => {
  const filePath = taskHistoryFilePath();
  if (!existsSync(filePath)) return [];
  try {
    const payload: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
    const record = asRecord(payload);
    const tasks = Array.isArray(record?.tasks) ? record.tasks : [];
    return tasks
      .map(validPersistedTask)
      .filter((task): task is VoiceAgentTask => Boolean(task))
      .toSorted((left, right) => right.updatedAt - left.updatedAt);
  } catch (error) {
    log.warn('[agent-task-bridge] ignored unreadable persisted task history', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
};

const savePersistedTaskHistory = async (tasks: VoiceAgentTask[]): Promise<void> => {
  const filePath = taskHistoryFilePath();
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, tasks }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    rmSync(filePath, { force: true });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

const defaultDependencies = (): AgentTaskBridgeDependencies => ({
  listAssistants: () => ipcBridge.assistants.list.invoke(),
  getAssistantDetail: (request) => ipcBridge.assistants.get.invoke(request),
  listProviders: () => ipcBridge.mode.listProviders.invoke(),
  createConversation: async (request) => {
    const conversation = await ipcBridge.conversation.create.invoke(request);
    return { id: conversation.id };
  },
  sendMessage: async (request) => {
    const result = await ipcBridge.conversation.sendMessage.invoke(request);
    return {
      msg_id: result.msg_id,
      turn_id: result.turn_id,
      delivered_midturn: result.delivered_midturn,
      queued_at_boundary: result.queued_at_boundary,
    };
  },
  getConversation: (request) => ipcBridge.conversation.get.invoke(request),
  getConversationMessage: (request) => ipcBridge.database.getConversationMessage.invoke(request),
  getConversationMessages: (request) =>
    ipcBridge.database.getConversationMessages.invoke({
      conversation_id: request.conversation_id,
      limit: 20,
      content_mode: 'full',
    }),
  stopConversation: async (request) => {
    await ipcBridge.conversation.stop.invoke(request);
  },
  listConfirmations: (request) => ipcBridge.conversation.confirmation.list.invoke(request),
  respondConfirmation: (request) => ipcBridge.conversation.confirmation.confirm.invoke(request),
  listConversations: () => ipcBridge.database.getUserConversations.invoke({ limit: 30 }),
  listTeams: () => ipcBridge.team.list.invoke({ user_id: 'system_default_user' }),
  listSkills: () => ipcBridge.fs.listAvailableSkills.invoke(),
  listMcpServers: () => ipcBridge.mcpService.listServers.invoke(),
  navigateMainWindow: async (route) => {
    const { navigateWinkGoMainWindow } = await import('@process/winkgo/desktopIslandWindow');
    return navigateWinkGoMainWindow(route);
  },
  loadTaskHistory: loadPersistedTaskHistory,
  saveTaskHistory: savePersistedTaskHistory,
  wait: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  tokenFactory: () => randomBytes(32).toString('base64url'),
});

export class WinkGoAgentTaskBridgeService {
  private readonly dependencies: AgentTaskBridgeDependencies;
  private readonly conversations = new Map<string, string>();
  private readonly conversationModels = new Map<string, TProviderWithModel>();
  private readonly assistantBySource = new Map<string, string>();
  private readonly latestTaskBySource = new Map<string, VoiceAgentTask>();
  private taskHistory: VoiceAgentTask[] = [];
  private taskHistoryLoaded = false;
  private server: Server | null = null;
  private endpoint: WinkGoAgentTaskBridgeEndpoint | null = null;

  constructor(dependencies: Partial<AgentTaskBridgeDependencies> = {}) {
    const defaults = defaultDependencies();
    const usesInjectedDependencies = Object.keys(dependencies).length > 0;
    this.dependencies = {
      ...defaults,
      ...(usesInjectedDependencies && !dependencies.loadTaskHistory
        ? { loadTaskHistory: async (): Promise<VoiceAgentTask[]> => [] }
        : {}),
      ...(usesInjectedDependencies && !dependencies.saveTaskHistory
        ? { saveTaskHistory: async (): Promise<void> => undefined }
        : {}),
      ...dependencies,
    };
  }

  async start(): Promise<WinkGoAgentTaskBridgeEndpoint> {
    if (this.endpoint) return this.endpoint;
    await this.restoreTaskHistory();
    const token = boundedText(this.dependencies.tokenFactory(), 256);
    if (!token) throw new Error('WINK GO Agent bridge token is empty');
    const server = createServer((request, response) => {
      void this.handleRequest(request, response, token);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('WINK GO Agent bridge did not bind a loopback port');
    }
    server.unref();
    this.server = server;
    this.endpoint = { url: `http://127.0.0.1:${address.port}`, token };
    return this.endpoint;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.endpoint = null;
    this.conversations.clear();
    this.conversationModels.clear();
    this.assistantBySource.clear();
    this.latestTaskBySource.clear();
    this.taskHistory = [];
    this.taskHistoryLoaded = false;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private trimTaskHistory(tasks: VoiceAgentTask[]): VoiceAgentTask[] {
    const sourceCounts = new Map<string, number>();
    return tasks
      .toSorted((left, right) => right.createdAt - left.createdAt)
      .filter((task) => {
        const count = sourceCounts.get(task.source) || 0;
        if (count >= MAX_TASK_HISTORY_PER_SOURCE) return false;
        sourceCounts.set(task.source, count + 1);
        return true;
      });
  }

  private async restoreTaskHistory(): Promise<void> {
    if (this.taskHistoryLoaded) return;
    this.taskHistoryLoaded = true;
    try {
      this.taskHistory = this.trimTaskHistory(await this.dependencies.loadTaskHistory());
      for (const task of this.taskHistory.toReversed()) {
        this.latestTaskBySource.set(task.source, task);
        this.assistantBySource.set(task.source, task.assistantId);
      }
      log.info('[agent-task-bridge] restored persisted task history', {
        taskCount: this.taskHistory.length,
        sourceCount: new Set(this.taskHistory.map((task) => task.source)).size,
      });
    } catch (error) {
      this.taskHistory = [];
      log.warn('[agent-task-bridge] failed to restore task history', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async persistTaskHistory(): Promise<void> {
    try {
      await this.dependencies.saveTaskHistory(this.taskHistory);
    } catch (error) {
      log.warn('[agent-task-bridge] failed to persist task history', {
        taskCount: this.taskHistory.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async rememberTask(task: VoiceAgentTask): Promise<void> {
    this.taskHistory = this.trimTaskHistory([
      task,
      ...this.taskHistory.filter(
        (item) =>
          !(
            item === task ||
            (item.source === task.source &&
              item.conversationId === task.conversationId &&
              item.createdAt === task.createdAt)
          )
      ),
    ]);
    this.latestTaskBySource.set(task.source, task);
    await this.persistTaskHistory();
  }

  private tasksForSource(source: string): VoiceAgentTask[] {
    return this.taskHistory
      .filter((task) => task.source === source)
      .toSorted((left, right) => right.createdAt - left.createdAt);
  }

  private taskQueryHint(queryInput: unknown): string {
    let hint = normalizedMatchText(boundedText(queryInput, 300));
    for (const token of [
      '小智',
      'agent',
      '管家',
      '智能体',
      '助手',
      '刚才',
      '最近',
      '任务',
      '执行',
      '查询',
      '查看',
      '读取',
      '最终',
      '回复',
      '结果',
      '状态',
      '完成',
      '了吗',
      '没有',
      '有没有',
      '是什么',
    ]) {
      hint = hint.replaceAll(normalizedMatchText(token), '');
    }
    return hint;
  }

  private selectTask(source: string, queryInput: unknown): VoiceAgentTask | undefined {
    const tasks = this.tasksForSource(source);
    if (!tasks.length) return undefined;
    const hint = this.taskQueryHint(queryInput);
    if (!hint) return tasks[0];
    return tasks.find((task) => normalizedMatchText(task.command).includes(hint)) || tasks[0];
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse, token: string): Promise<void> {
    const route = request.method === 'POST' ? request.url : '';
    if (
      route !== '/v1/agent-tasks' &&
      route !== '/v1/agent-tasks/status' &&
      route !== '/v1/agent-tasks/cancel' &&
      route !== '/v1/catalog' &&
      route !== '/v1/app-features/open'
    ) {
      this.sendJson(response, 404, { success: false, accepted: false, message: 'Not found' });
      return;
    }
    if (!this.isAuthorized(request, token)) {
      this.sendJson(response, 401, { success: false, accepted: false, message: 'Unauthorized' });
      return;
    }
    try {
      const payload = await this.readJson(request);
      if (route === '/v1/agent-tasks/status') {
        const result = await this.status(payload.source, payload.query);
        this.sendJson(response, 200, result);
        return;
      }
      if (route === '/v1/agent-tasks/cancel') {
        const result = await this.cancel(payload.source);
        this.sendJson(response, 200, result);
        return;
      }
      if (route === '/v1/catalog') {
        const result = await this.catalog(payload.kind);
        this.sendJson(response, 200, result);
        return;
      }
      if (route === '/v1/app-features/open') {
        const result = await this.openFeature(payload.feature);
        this.sendJson(response, result.success ? 200 : 404, result);
        return;
      }
      const result = await this.submit(payload.command, payload.source);
      this.sendJson(response, 202, result);
    } catch (error) {
      this.sendJson(response, 503, {
        success: false,
        accepted: false,
        message: error instanceof Error ? error.message : 'WINK GO Agent task failed',
      });
    }
  }

  private async catalog(kindInput: unknown): Promise<Record<string, unknown>> {
    const kind = boundedText(kindInput, 40) as CatalogKind;
    if (!['conversations', 'teams', 'capabilities'].includes(kind)) {
      throw new Error('Unsupported WINK GO catalog kind');
    }
    if (kind === 'conversations') {
      const conversations = asRecordList(await this.dependencies.listConversations())
        .slice(0, 20)
        .map((item) => ({
          id: safeCatalogText(item.id, 180),
          name: safeCatalogText(item.name || item.title, 120) || '未命名对话',
          status: safeCatalogText(item.status, 40),
          type: safeCatalogText(item.type, 40),
        }));
      return { success: true, kind, items: conversations, count: conversations.length };
    }
    if (kind === 'teams') {
      const teams = asRecordList(await this.dependencies.listTeams())
        .slice(0, 20)
        .map((item) => ({
          id: safeCatalogText(item.id, 180),
          name: safeCatalogText(item.name, 120) || '未命名团队',
          member_count: Array.isArray(item.agents) ? item.agents.length : 0,
        }));
      return { success: true, kind, items: teams, count: teams.length };
    }

    const [assistantsValue, teamsValue, skillsValue, mcpServersValue] = await Promise.all([
      this.dependencies.listAssistants(),
      this.dependencies.listTeams(),
      this.dependencies.listSkills(),
      this.dependencies.listMcpServers(),
    ]);
    const assistants = asRecordList(assistantsValue)
      .filter((item) => item.enabled !== false)
      .map((item) => ({ id: safeCatalogText(item.id, 180), name: safeCatalogText(item.name, 100) }))
      .filter((item) => item.name);
    const teams = asRecordList(teamsValue).map((item) => ({
      id: safeCatalogText(item.id, 180),
      name: safeCatalogText(item.name, 100),
    }));
    const skills = asRecordList(skillsValue)
      .map((item) => ({ name: safeCatalogText(item.name, 100), description: safeCatalogText(item.description, 180) }))
      .filter((item) => item.name);
    const mcpServers = asRecordList(mcpServersValue)
      .map((item) => ({
        id: safeCatalogText(item.id, 180),
        name: safeCatalogText(item.name, 100),
        builtin: item.builtin === true,
      }))
      .filter((item) => item.name);
    return {
      success: true,
      kind,
      assistants,
      teams,
      skills,
      mcp_servers: mcpServers,
      counts: {
        assistants: assistants.length,
        teams: teams.length,
        skills: skills.length,
        mcp_servers: mcpServers.length,
      },
    };
  }

  private async openFeature(featureInput: unknown): Promise<Record<string, unknown>> {
    const feature = boundedText(featureInput, 40) as AppFeatureKey;
    const route = APP_FEATURE_ROUTES[feature];
    if (!route) {
      return { success: false, opened: false, feature };
    }
    const opened = await this.dependencies.navigateMainWindow(route);
    log.info('[agent-task-bridge] app feature navigation', { feature, route, opened });
    return { success: opened, opened, feature, route };
  }

  private async submit(commandInput: unknown, sourceInput: unknown): Promise<Record<string, unknown>> {
    const command = boundedText(commandInput, MAX_COMMAND_CHARS);
    const source = boundedText(sourceInput, MAX_SOURCE_CHARS) || 'xiaozhi_hardware';
    if (!command) throw new Error(i18n.t('agent.voiceTask.emptyCommand'));
    const assistants = await this.dependencies.listAssistants();
    const assistant = selectWinkGoVoiceAssistant(command, assistants, this.assistantBySource.get(source));
    if (!assistant) throw new Error(i18n.t('agent.voiceTask.noAgent'));
    this.assistantBySource.set(source, assistant.id);
    // Each execution surface gets its own conversation so an older turn cannot
    // retain a stale tool preference (for example, system Chrome for a browser
    // task or desktop clicking for a structured Office edit).
    const taskRoute = routeWinkGoTask(command);
    const executionSurface = taskRoute.key;
    const key = `${source}\u0000${assistant.id}\u0000${executionSurface}`;
    let conversationId = this.conversations.get(key) || '';
    let selectedModel = this.conversationModels.get(key);
    if (conversationId) {
      const existing = await this.dependencies.getConversation({ id: conversationId }).catch((): null => null);
      const status = boundedText(existing?.status, 40).toLowerCase();
      const runtimeState = boundedText(existing?.runtime?.state, 40).toLowerCase();
      const terminal = existing
        ? ['finished', 'failed', 'error', 'cancelled', 'deleted'].includes(status) ||
          ['finished', 'failed', 'error', 'cancelled'].includes(runtimeState)
        : true;
      if (terminal) {
        if (!existing) {
          log.warn('[agent-task-bridge] discarded stale conversation before task submission', {
            assistantId: assistant.id,
            conversationId,
            executionSurface,
          });
        }
        this.conversations.delete(key);
        this.conversationModels.delete(key);
        conversationId = '';
        selectedModel = undefined;
      }
    }
    if (!conversationId) {
      const model =
        assistantRuntimeKey(assistant) === 'winkgo_agent' ? await this.resolveWinkGoCliModel(assistant.id) : undefined;
      if (assistantRuntimeKey(assistant) === 'winkgo_agent' && !model) {
        throw new Error(i18n.t('agent.voiceTask.noModel'));
      }
      const conversation = await this.dependencies.createConversation({
        name: i18n.t('agent.voiceTask.conversationName', { command: command.slice(0, 60) }),
        model,
        assistant: { id: assistant.id, locale: 'zh-CN' },
        extra: {
          workspace: '',
          custom_workspace: false,
          default_files: [],
          context: `${XIAOZHI_AGENT_CONTEXT}\n\n${buildWinkGoTaskRouteContext(taskRoute)}`,
        },
      });
      conversationId = boundedText(conversation.id, 180);
      if (!conversationId) throw new Error(i18n.t('agent.voiceTask.createFailed'));
      this.conversations.set(key, conversationId);
      if (model) {
        selectedModel = model;
        this.conversationModels.set(key, model);
      }
    }
    const sent = await this.dependencies.sendMessage({ conversation_id: conversationId, input: command });
    const turnId = boundedText(sent.turn_id, 180);
    const acceptedAt = Date.now();
    await this.rememberTask({
      source,
      command,
      assistantId: assistant.id,
      assistantName: assistant.name,
      conversationId,
      turnId,
      msgId: boundedText(sent.msg_id, 180) || undefined,
      queuedAtBoundary: Boolean(sent.queued_at_boundary),
      createdAt: acceptedAt,
      updatedAt: acceptedAt,
    });
    log.info('[agent-task-bridge] task accepted', {
      assistantId: assistant.id,
      conversationId,
      turnId,
      executionSurface,
      queued: Boolean(sent.queued_at_boundary),
    });
    return {
      success: true,
      accepted: true,
      assistant_id: assistant.id,
      assistant_name: assistant.name,
      conversation_id: conversationId,
      turn_id: turnId,
      provider_id: selectedModel?.id || '',
      model_id: selectedModel?.use_model || '',
      execution_surface: executionSurface,
      execution_stages: taskRoute.stages,
      verification: taskRoute.verification,
      sensitive: taskRoute.sensitive,
      execution_status: sent.queued_at_boundary ? 'queued' : sent.delivered_midturn ? 'running' : 'accepted',
      message: sent.queued_at_boundary
        ? i18n.t('agent.voiceTask.queued', { assistant: assistant.name })
        : i18n.t('agent.voiceTask.accepted', { assistant: assistant.name }),
    };
  }

  private async resolveWinkGoCliModel(assistantId: string): Promise<TProviderWithModel | undefined> {
    const [detail, providers] = await Promise.all([
      this.dependencies.getAssistantDetail({ id: assistantId, locale: 'zh-CN' }).catch((): null => null),
      this.dependencies.listProviders().catch((): IProvider[] => []),
    ]);
    const availableProviders = providers.filter(
      (provider) => provider.enabled !== false && Array.isArray(provider.models) && provider.models.length > 0
    );
    const preferredModel =
      detail?.defaults.model.mode === 'fixed'
        ? detail.defaults.model.value
        : detail?.defaults.model.mode === 'auto'
          ? detail.preferences.last_model_id
          : undefined;
    if (preferredModel) {
      const provider = availableProviders.find(
        (candidate) => candidate.models.includes(preferredModel) && candidate.model_enabled?.[preferredModel] !== false
      );
      if (provider) return { ...provider, use_model: preferredModel } as TProviderWithModel;
    }
    for (const provider of availableProviders) {
      const model = provider.models.find((modelName: string) => provider.model_enabled?.[modelName] !== false);
      if (model) return { ...provider, use_model: model } as TProviderWithModel;
    }
    return undefined;
  }

  private async status(sourceInput: unknown, queryInput: unknown = ''): Promise<Record<string, unknown>> {
    const source = boundedText(sourceInput, MAX_SOURCE_CHARS) || 'xiaozhi_hardware';
    const query = boundedText(queryInput, 300);
    const sourceTasks = this.tasksForSource(source);
    const compactQuery = normalizedMatchText(query);
    const requestsTaskHistory =
      compactQuery.includes('任务') &&
      ['列表', '列出', '最近', '有哪些', '正在执行'].some((token) => compactQuery.includes(token));
    if (sourceTasks.length > 0 && requestsTaskHistory) {
      const items = sourceTasks.map((task) => ({
        task_id: task.turnId || task.conversationId,
        command: task.command.slice(0, 80),
        assistant_name: task.assistantName,
        execution_status: task.cachedExecutionStatus || 'unknown',
        updated_at: task.updatedAt,
      }));
      return {
        success: true,
        found: true,
        execution_status: 'task_history',
        items,
        message: i18n.t('agent.voiceTask.history', {
          count: items.length,
          tasks: items
            .slice(0, 5)
            .map((item, index) => `${index + 1}. ${item.command}`)
            .join('; '),
        }),
      };
    }
    const task = this.selectTask(source, query);
    if (!task) {
      return {
        success: true,
        found: false,
        execution_status: 'not_found',
        diagnostic_code: 'AGENT_TASK_HISTORY_EMPTY',
        message: i18n.t('agent.voiceTask.none'),
      };
    }
    const conversation = await this.dependencies.getConversation({ id: task.conversationId }).catch((): null => null);
    if (!conversation) {
      log.warn('[agent-task-bridge] task conversation is no longer available', {
        assistantId: task.assistantId,
        conversationId: task.conversationId,
        turnId: task.turnId,
      });
      if (task.cachedMessage) {
        return {
          success: true,
          found: true,
          cached: true,
          task_id: task.turnId || task.conversationId,
          assistant_id: task.assistantId,
          assistant_name: task.assistantName,
          conversation_id: task.conversationId,
          turn_id: task.turnId,
          execution_status: task.cachedExecutionStatus || 'finished',
          diagnostic_code: 'AGENT_TASK_CONVERSATION_MISSING_USING_CACHE',
          ...(task.cachedFailureSummary ? { failure_summary: task.cachedFailureSummary } : {}),
          ...(task.cachedFinalResult ? { final_result: task.cachedFinalResult } : {}),
          message: task.cachedMessage,
        };
      }
      this.latestTaskBySource.delete(source);
      this.taskHistory = this.taskHistory.filter((item) => item !== task);
      const nextTask = this.tasksForSource(source)[0];
      if (nextTask) this.latestTaskBySource.set(source, nextTask);
      await this.persistTaskHistory();
      for (const [key, conversationId] of this.conversations) {
        if (conversationId === task.conversationId) {
          this.conversations.delete(key);
          this.conversationModels.delete(key);
        }
      }
      return {
        success: true,
        found: false,
        execution_status: 'not_found',
        diagnostic_code: 'AGENT_TASK_CONVERSATION_NOT_FOUND',
        message: i18n.t('agent.voiceTask.none'),
      };
    }
    if (conversation.runtime?.turn_id) task.turnId = conversation.runtime.turn_id;
    const runtimeState = boundedText(conversation.runtime?.state, 80);
    let queuedMessagePending = false;
    let queuedMessageWorking = false;
    let queuedMessageFailure = '';
    if (task.queuedAtBoundary && task.msgId) {
      let queued = await this.dependencies
        .getConversationMessage({ conversation_id: task.conversationId, message_id: task.msgId })
        .catch((): undefined => undefined);
      if (!queued) {
        const page = await this.dependencies
          .getConversationMessages({ conversation_id: task.conversationId })
          .catch((): { items: [] } => ({ items: [] }));
        queued = (page.items || []).find((item) => item.msg_id === task.msgId || item.id === task.msgId);
      }
      queuedMessagePending = queued?.status === 'pending';
      queuedMessageWorking = queued?.status === 'work';
      if (queued?.status === 'error') {
        const content =
          queued.content && typeof queued.content === 'object' && !Array.isArray(queued.content)
            ? (queued.content as Record<string, unknown>)
            : {};
        queuedMessageFailure = boundedText(content.content || content.message || content.error, 320);
      }
    }
    let executionStatus = queuedMessageFailure
      ? 'failed'
      : queuedMessagePending
        ? 'queued'
        : queuedMessageWorking
          ? 'running'
          : runtimeState === 'waiting_confirmation'
            ? 'waiting_confirmation'
            : conversation.runtime?.is_processing || conversation.status === 'running'
              ? 'running'
              : conversation.status === 'finished'
                ? 'finished'
                : runtimeState || conversation.status || 'accepted';
    let failureSummary = queuedMessageFailure;
    let finalResult = '';
    if (executionStatus === 'finished') {
      const page = await this.dependencies
        .getConversationMessages({ conversation_id: task.conversationId })
        .catch((): { items: [] } => ({ items: [] }));
      for (const item of (page.items || []).toReversed()) {
        const content =
          item.content && typeof item.content === 'object' && !Array.isArray(item.content)
            ? (item.content as Record<string, unknown>)
            : {};
        const isFailure =
          item.status === 'error' || content.type === 'error' || content.status === 'error' || content.isError === true;
        if (isFailure && !failureSummary) {
          failureSummary = boundedText(content.content || content.message || content.error || content.output, 320);
        }
        if (!finalResult && item.type === 'text' && item.position === 'left' && item.status !== 'error') {
          finalResult = boundedText(content.content || content.message || content.output, 600);
        }
        if (failureSummary && finalResult) break;
      }
      if (failureSummary) executionStatus = 'failed';
    }
    const message =
      executionStatus === 'waiting_confirmation'
        ? i18n.t('agent.voiceTask.waitingConfirmation', { assistant: task.assistantName })
        : executionStatus === 'queued'
          ? i18n.t('agent.voiceTask.queuedStatus', { assistant: task.assistantName })
          : executionStatus === 'running'
            ? i18n.t('agent.voiceTask.running', { assistant: task.assistantName })
            : executionStatus === 'finished'
              ? finalResult
                ? i18n.t('agent.voiceTask.finishedWithResult', { assistant: task.assistantName, result: finalResult })
                : i18n.t('agent.voiceTask.finishedNoResult', { assistant: task.assistantName })
              : executionStatus === 'failed'
                ? i18n.t('agent.voiceTask.failed', { assistant: task.assistantName, error: failureSummary })
                : i18n.t('agent.voiceTask.acceptedStatus', { assistant: task.assistantName });
    task.cachedExecutionStatus = executionStatus;
    task.cachedFailureSummary = failureSummary;
    task.cachedFinalResult = finalResult;
    task.cachedMessage = message;
    task.updatedAt = Date.now();
    await this.rememberTask(task);
    return {
      success: true,
      found: true,
      task_id: task.turnId || task.conversationId,
      assistant_id: task.assistantId,
      assistant_name: task.assistantName,
      conversation_id: task.conversationId,
      turn_id: task.turnId,
      execution_status: executionStatus,
      pending_confirmations: Number(conversation.runtime?.pending_confirmations || 0),
      ...(failureSummary ? { failure_summary: failureSummary } : {}),
      ...(finalResult && executionStatus === 'finished' ? { final_result: finalResult } : {}),
      message,
    };
  }

  private async cancel(sourceInput: unknown): Promise<Record<string, unknown>> {
    const source = boundedText(sourceInput, MAX_SOURCE_CHARS) || 'xiaozhi_hardware';
    const task = this.latestTaskBySource.get(source);
    if (!task) {
      return { success: true, cancelled: false, found: false, message: i18n.t('agent.voiceTask.noCancelable') };
    }
    const retryDelays = [180, 360, 720, 1_200, 2_400, 180];
    const stopUntilSettled = async (attempt: number): Promise<boolean> => {
      if (attempt >= retryDelays.length) return false;
      await this.rejectPendingConfirmations(task.conversationId);
      const beforeCancel = await this.dependencies
        .getConversation({ id: task.conversationId })
        .catch((): undefined => undefined);
      const activeBeforeCancel = Boolean(
        beforeCancel?.runtime?.is_processing ||
        beforeCancel?.runtime?.state === 'running' ||
        beforeCancel?.runtime?.state === 'starting' ||
        beforeCancel?.runtime?.state === 'waiting_confirmation' ||
        beforeCancel?.status === 'running'
      );
      if (beforeCancel && !activeBeforeCancel) return true;
      const currentTurnId = beforeCancel?.runtime?.turn_id || task.turnId;
      task.turnId = currentTurnId;
      await this.dependencies.stopConversation({ conversation_id: task.conversationId, turn_id: currentTurnId });
      await this.dependencies.wait(retryDelays[attempt]);
      let stillActive = false;
      try {
        const conversation = await this.dependencies.getConversation({ id: task.conversationId });
        stillActive = Boolean(
          conversation.runtime?.is_processing ||
          conversation.runtime?.state === 'running' ||
          conversation.runtime?.state === 'starting' ||
          conversation.runtime?.state === 'waiting_confirmation' ||
          conversation.status === 'running'
        );
      } catch {
        stillActive = false;
      }
      return stillActive ? stopUntilSettled(attempt + 1) : true;
    };
    if (!(await stopUntilSettled(0))) {
      return {
        success: false,
        cancelled: false,
        found: true,
        task_id: task.turnId || task.conversationId,
        conversation_id: task.conversationId,
        turn_id: task.turnId,
        execution_status: 'cancel_pending',
        message: i18n.t('agent.voiceTask.cancelling', { assistant: task.assistantName }),
      };
    }
    task.cachedExecutionStatus = 'cancelled';
    task.cachedMessage = i18n.t('agent.voiceTask.cancelled', { assistant: task.assistantName });
    task.updatedAt = Date.now();
    await this.rememberTask(task);
    return {
      success: true,
      cancelled: true,
      found: true,
      task_id: task.turnId || task.conversationId,
      conversation_id: task.conversationId,
      turn_id: task.turnId,
      execution_status: 'cancelled',
      message: task.cachedMessage,
    };
  }

  private async rejectPendingConfirmations(conversationId: string): Promise<void> {
    let confirmations: Awaited<ReturnType<AgentTaskBridgeDependencies['listConfirmations']>> = [];
    try {
      confirmations = await this.dependencies.listConfirmations({ conversation_id: conversationId });
    } catch {
      return;
    }
    const rejections = confirmations.flatMap((confirmation) => {
      const rejection = (confirmation.options ?? []).find((option) => {
        const identity = normalizedMatchText(`${String(option.value ?? '')} ${option.label ?? ''}`);
        return ['reject', 'deny', 'cancel', '拒绝', '取消'].some((token) => identity.includes(token));
      });
      if (!rejection || !confirmation.id || !confirmation.call_id) return [];
      return [
        this.dependencies.respondConfirmation({
          conversation_id: conversationId,
          msg_id: confirmation.id,
          call_id: confirmation.call_id,
          data: { value: rejection.value },
        }),
      ];
    });
    await Promise.allSettled(rejections);
  }

  private isAuthorized(request: IncomingMessage, token: string): boolean {
    const header = boundedText(request.headers.authorization, 320);
    const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
    const left = Buffer.from(supplied);
    const right = Buffer.from(token);
    return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
  }

  private async readJson(request: IncomingMessage): Promise<{
    command?: unknown;
    source?: unknown;
    kind?: unknown;
    feature?: unknown;
    query?: unknown;
  }> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_REQUEST_BYTES) throw new Error('WINK GO Agent task request is too large');
      chunks.push(buffer);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('WINK GO Agent task request is invalid');
    }
    return parsed as { command?: unknown; source?: unknown; kind?: unknown; feature?: unknown; query?: unknown };
  }

  private sendJson(response: ServerResponse, status: number, payload: Record<string, unknown>): void {
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    response.end(body);
  }
}

export const winkGoAgentTaskBridgeService = new WinkGoAgentTaskBridgeService();
