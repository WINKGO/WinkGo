/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ClientFactory } from '@/common/api';
import { httpRequest } from '@/common/adapter/httpBridge';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { WinkGoBrowserWorkflowStep } from '@/common/adapter/ipcBridge';
import type {
  WinkGoBrowserActionRequest,
  WinkGoBrowserElement,
  WinkGoBrowserPageSnapshot,
} from './winkGoBrowserControlService';
import type { DesktopRepairCandidate, DesktopSkillStep } from '@/common/types/desktopAutomation';
import {
  getComputerUseModelCandidates,
  selectDefaultWinkGoComputerUseModel,
} from '@/common/utils/computerUseModel';

const AI_TIMEOUT_MS = 45_000;
const AGENT_TIMEOUT_MS = 75_000;
const AGENT_POLL_INTERVAL_MS = 600;
const MAX_PROMPT_STEPS = 180;
const MAX_TRIGGER_PHRASES = 12;
const MAX_GUIDE_STEPS = 24;
const BROWSER_AGENT_TIMEOUT_MS = 22_000;

export type WinkGoBrowserOutcomeCheck = {
  type: 'url_contains' | 'title_contains' | 'text_present';
  value: string;
};

export type WinkGoBrowserSkillDistillation = {
  aiEnhanced: boolean;
  capability: string;
  intent: string;
  description: string;
  triggerPhrases: string[];
  guideSteps: string[];
  keptStepIds: string[];
  parameterLabels: Record<string, string>;
  outcomeChecks: WinkGoBrowserOutcomeCheck[];
  providerName?: string;
  model?: string;
  warning?: string;
};

export type DistillInput = {
  requestedName: string;
  requestedDescription: string;
  domain: string;
  entryUrl: string;
  steps: WinkGoBrowserWorkflowStep[];
  startPage?: WinkGoBrowserPageSnapshot;
  endPage?: WinkGoBrowserPageSnapshot;
};

type AiDistillationPayload = {
  capability?: unknown;
  intent?: unknown;
  description?: unknown;
  trigger_phrases?: unknown;
  guide_steps?: unknown;
  keep_step_numbers?: unknown;
  parameter_labels?: unknown;
  outcome_checks?: unknown;
};

type AgentManagementEntry = {
  id: string;
  name?: string;
  backend?: string;
  agent_type?: string;
  enabled?: boolean;
  installed?: boolean;
  status?: string;
};

type AssistantEntry = {
  id: string;
  name?: string;
  agent_id?: string;
  enabled?: boolean;
};

type BackgroundConversation = { id: string };
type BackgroundMessage = {
  type?: string;
  position?: string;
  status?: string;
  content?: { content?: unknown } | string;
};

export type WinkGoBrowserAgentDecision = {
  status: 'act' | 'done' | 'blocked' | 'failed';
  message: string;
  action?: WinkGoBrowserActionRequest;
};

export type WinkGoBrowserAgentPlanInput = {
  goal: string;
  snapshot: WinkGoBrowserPageSnapshot;
  history: Array<{
    action?: WinkGoBrowserActionRequest;
    ok?: boolean;
    message?: string;
    url?: string;
    title?: string;
  }>;
  skillHints?: Array<{
    name: string;
    description?: string;
    domain?: string;
    capability?: string;
    entryUrl?: string;
  }>;
  model?: {
    providerId: string;
    model: string;
  };
  loginAutomationEnabled?: boolean;
};

let cachedProvider: { expiresAt: number; provider: TProviderWithModel; providerName: string } | null = null;

const cleanText = (value: unknown, maximum = 500): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';

/**
 * Browser traces can contain account names, email addresses and generated ids.
 * The distiller never receives field values; this additional pass also removes
 * common identifiers from labels and page text before a configured model sees it.
 */
export const redactBrowserTraceText = (value: unknown, maximum = 500): string =>
  cleanText(value, maximum)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '<phone>')
    .replace(/\b(?:sk|pk|sess|token)[-_][A-Za-z0-9_-]{8,}\b/gi, '<secret>')
    .replace(/((?:密码|口令|验证码|动态码|安全码|password|passwd|passcode|otp|captcha)\s*[:：=]?\s*)[^\s,，;；]{4,}/gi, '$1<secret>')
    .replace(/\b\d{6}\b/g, '<verification-code>')
    .replace(/\b\d{8,}\b/g, '<number>');

const modelCandidates = (provider: IProvider): string[] => {
  const enabled = provider.models.filter((model) => provider.model_enabled?.[model] !== false);
  const healthy = enabled.filter((model) => provider.model_health?.[model]?.status !== 'unhealthy');
  return healthy.length > 0 ? healthy : enabled;
};

const providerScore = (provider: IProvider): number => {
  if (provider.enabled === false || !provider.api_key?.trim()) return -1;
  const models = modelCandidates(provider);
  if (models.length === 0) return -1;
  const healthy = models.some((model) => provider.model_health?.[model]?.status === 'healthy');
  return (healthy ? 100 : 0) + models.length;
};

const resolveConfiguredProvider = async (preferred?: {
  providerId: string;
  model: string;
}): Promise<{
  provider: TProviderWithModel;
  providerName: string;
} | null> => {
  const providers = (await httpRequest<IProvider[]>('GET', '/api/providers')) || [];
  if (preferred?.providerId && preferred.model) {
    const exact = providers.find((provider) => provider.id === preferred.providerId);
    const selected = exact
      ? selectDefaultWinkGoComputerUseModel([{ ...exact, models: [preferred.model] }])
      : null;
    if (!exact || providerScore(exact) < 0 || selected?.model !== preferred.model) return null;
    const { models: _models, ...providerFields } = exact;
    return {
      provider: { ...providerFields, use_model: preferred.model },
      providerName: exact.name || exact.platform,
    };
  }
  if (cachedProvider && cachedProvider.expiresAt > Date.now()) return cachedProvider;
  const selectedRef = selectDefaultWinkGoComputerUseModel(providers);
  const selected = selectedRef ? providers.find((provider) => provider.id === selectedRef.providerId) : undefined;
  if (!selected || !selectedRef || !getComputerUseModelCandidates(selected).includes(selectedRef.model)) return null;
  const { models: _models, ...providerFields } = selected;
  const resolved = {
    provider: { ...providerFields, use_model: selectedRef.model },
    providerName: selected.name || selected.platform,
  };
  cachedProvider = { ...resolved, expiresAt: Date.now() + 30_000 };
  return resolved;
};

const extractJsonObject = (value: string): Record<string, unknown> | null => {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const responseText = (response: unknown): string => {
  const content = (response as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message
    ?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part ? cleanText((part as { text: unknown }).text, 30_000) : ''
      )
      .join('\n');
  }
  return '';
};

const safePageSummary = (snapshot?: WinkGoBrowserPageSnapshot): Record<string, unknown> | null => {
  if (!snapshot?.ok) return null;
  return {
    url: snapshot.url,
    title: redactBrowserTraceText(snapshot.title, 240),
    interactive_elements: (snapshot.elements || []).slice(0, 80).map((element) => ({
      role: cleanText(element.role, 40),
      name: redactBrowserTraceText(element.name || element.text || element.placeholder, 160),
    })),
  };
};

const safeStepForPrompt = (step: WinkGoBrowserWorkflowStep, index: number): Record<string, unknown> => ({
  number: index + 1,
  type: step.type,
  url: step.type === 'navigate' ? step.url : undefined,
  role: step.role,
  name: redactBrowserTraceText(step.accessibleName || step.fallbackText, 180),
  selector_hint: step.testId ? 'test-id' : step.selector ? 'css' : 'semantic',
  has_runtime_parameter: Boolean(step.parameterKey),
  parameter_key: step.parameterKey,
  secret_parameter: step.parameterKey?.startsWith('secret_') || false,
});

export const createLocalWinkGoBrowserSkillDistillation = (
  input: DistillInput,
  warning?: string
): WinkGoBrowserSkillDistillation => ({
  aiEnhanced: false,
  capability: cleanText(input.requestedName, 80) || 'browser-workflow',
  intent: cleanText(input.requestedDescription, 240) || cleanText(input.requestedName, 80),
  description:
    cleanText(input.requestedDescription, 240) || `在 ${input.domain || '网页'} 中执行 ${input.requestedName} 流程。`,
  triggerPhrases: [input.requestedName].filter(Boolean),
  guideSteps: input.steps.slice(0, MAX_GUIDE_STEPS).map((step) => {
    if (step.type === 'navigate') return `打开 ${step.url}`;
    return `${step.type}: ${step.accessibleName || step.fallbackText || step.role || '网页元素'}`;
  }),
  keptStepIds: input.steps.map((step) => step.id),
  parameterLabels: {},
  outcomeChecks: [],
  ...(warning ? { warning } : {}),
});

const stringList = (value: unknown, maximum: number, itemLength: number): string[] =>
  Array.isArray(value)
    ? value
        .map((item) => cleanText(item, itemLength))
        .filter(Boolean)
        .slice(0, maximum)
    : [];

const parseOutcomeChecks = (value: unknown): WinkGoBrowserOutcomeCheck[] => {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const type = cleanText((item as { type?: unknown }).type, 40);
      const checkValue = redactBrowserTraceText((item as { value?: unknown }).value, 240);
      if (!['url_contains', 'title_contains', 'text_present'].includes(type) || !checkValue) return [];
      return [{ type: type as WinkGoBrowserOutcomeCheck['type'], value: checkValue }];
    })
    .slice(0, 6);
};

const normalizeAiDistillation = (
  content: string,
  input: DistillInput,
  source: { providerName: string; model: string }
): WinkGoBrowserSkillDistillation => {
  const json = extractJsonObject(content);
  if (!json) throw new Error('AI 没有返回可解析的技能结构。');
  const payload = json as AiDistillationPayload;
  const keepNumbers = Array.isArray(payload.keep_step_numbers)
    ? payload.keep_step_numbers
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= input.steps.length)
    : [];
  const firstNavigationIndex = input.steps.findIndex((step) => step.type === 'navigate');
  if (firstNavigationIndex >= 0 && !keepNumbers.includes(firstNavigationIndex + 1)) {
    keepNumbers.unshift(firstNavigationIndex + 1);
  }
  const keptStepIds = [...new Set(keepNumbers)].map((number) => input.steps[number - 1]?.id).filter(Boolean);
  const rawLabels =
    payload.parameter_labels && typeof payload.parameter_labels === 'object' && !Array.isArray(payload.parameter_labels)
      ? (payload.parameter_labels as Record<string, unknown>)
      : {};
  const allowedParameterKeys = new Set(input.steps.map((step) => step.parameterKey).filter(Boolean));
  const parameterLabels = Object.fromEntries(
    Object.entries(rawLabels).flatMap(([key, value]) => {
      const label = redactBrowserTraceText(value, 80);
      return allowedParameterKeys.has(key) && label ? [[key, label]] : [];
    })
  );
  const triggerPhrases = stringList(payload.trigger_phrases, MAX_TRIGGER_PHRASES, 100);
  return {
    aiEnhanced: true,
    capability: cleanText(payload.capability, 80) || cleanText(input.requestedName, 80) || 'browser-workflow',
    intent: cleanText(payload.intent, 240) || cleanText(input.requestedName, 80),
    description:
      cleanText(payload.description, 500) || cleanText(input.requestedDescription, 240) || input.requestedName,
    triggerPhrases: triggerPhrases.length > 0 ? triggerPhrases : [input.requestedName],
    guideSteps: stringList(payload.guide_steps, MAX_GUIDE_STEPS, 240),
    keptStepIds: keptStepIds.length > 0 ? keptStepIds : input.steps.map((step) => step.id),
    parameterLabels,
    outcomeChecks: parseOutcomeChecks(payload.outcome_checks),
    providerName: source.providerName,
    model: source.model,
  };
};

const agentScore = (agent: AgentManagementEntry): number => {
  if (agent.enabled === false || agent.installed === false || agent.status !== 'online') return -1;
  // A model-less internal Butler cannot distil a trace. ACP-backed local
  // agents can use their own existing login without adding an API Provider.
  if (agent.agent_type === 'winkgo_agent') return -1;
  const preferred = ['codex', 'claude', 'gemini', 'kimi', 'qwen', 'hermes', 'cursor'];
  const index = preferred.indexOf(cleanText(agent.backend, 40).toLowerCase());
  return index >= 0 ? 1_000 - index : 100;
};

const backgroundMessageText = (message: BackgroundMessage): string => {
  if (typeof message.content === 'string') return message.content;
  return cleanText(message.content?.content, 30_000);
};

const runDistillationWithWinkGoAgent = async (
  prompt: string
): Promise<{ content: string; providerName: string; model: string }> => {
  const [agents, assistants] = await Promise.all([
    httpRequest<AgentManagementEntry[]>('GET', '/api/agents/management'),
    httpRequest<AssistantEntry[]>('GET', '/api/assistants'),
  ]);
  const agent = (agents || [])
    .filter((candidate) => agentScore(candidate) >= 0)
    .toSorted((left, right) => agentScore(right) - agentScore(left))[0];
  if (!agent) throw new Error('没有已登录且在线的 WINK GO Agent。');
  const assistant = (assistants || []).find(
    (candidate) => candidate.enabled !== false && candidate.agent_id === agent.id
  );
  if (!assistant) throw new Error(`找不到 ${agent.name || agent.backend || 'Agent'} 对应的助手。`);

  let conversationId = '';
  try {
    const conversation = await httpRequest<BackgroundConversation>('POST', '/api/conversations', {
      name: `网页技能生成：${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
      assistant: { id: assistant.id, locale: 'zh-CN' },
      extra: {
        workspace: '',
        custom_workspace: false,
        default_files: [],
        selected_mcp_server_ids: [],
        selected_session_mcp_servers: [],
        preset_enabled_skills: [],
        context:
          'WINK GO 网页技能后台整理任务。不要调用工具、不要联网、不要读写文件，只把用户已经录制并脱敏的轨迹转换成 JSON。',
      },
    });
    conversationId = cleanText(conversation?.id, 160);
    if (!conversationId) throw new Error('无法创建 WINK GO Agent 后台技能会话。');
    await httpRequest<{ turn_id?: string }>(
      'POST',
      `/api/conversations/${encodeURIComponent(conversationId)}/messages`,
      { content: prompt, files: [] }
    );

    const deadline = Date.now() + AGENT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // oxlint-disable-next-line no-await-in-loop -- this is a bounded status poll and each request depends on elapsed time
      await new Promise((resolve) => setTimeout(resolve, AGENT_POLL_INTERVAL_MS));
      // oxlint-disable-next-line no-await-in-loop -- polling sequentially prevents duplicate backend reads
      const page = await httpRequest<{ items?: BackgroundMessage[] }>(
        'GET',
        `/api/conversations/${encodeURIComponent(conversationId)}/messages?page=1&page_size=50&content_mode=full`
      );
      const completed = (page?.items || []).findLast(
        (message) =>
          message.position === 'left' &&
          message.type === 'text' &&
          message.status === 'finish' &&
          backgroundMessageText(message)
      );
      if (completed) {
        return {
          content: backgroundMessageText(completed),
          providerName: `WINK GO Agent · ${agent.name || agent.backend || agent.id}`,
          model: agent.backend || agent.name || agent.id,
        };
      }
    }
    throw new Error(`${agent.name || 'WINK GO Agent'} 生成技能超时。`);
  } finally {
    if (conversationId) {
      await httpRequest('DELETE', `/api/conversations/${encodeURIComponent(conversationId)}`).catch(
        (): undefined => undefined
      );
    }
  }
};

export const distillWinkGoBrowserTrace = async (input: DistillInput): Promise<WinkGoBrowserSkillDistillation> => {
  if (process.env.NODE_ENV === 'test') {
    return createLocalWinkGoBrowserSkillDistillation(input, 'AI distillation disabled in tests.');
  }
  let selected: Awaited<ReturnType<typeof resolveConfiguredProvider>>;
  try {
    selected = await resolveConfiguredProvider();
  } catch (error) {
    return createLocalWinkGoBrowserSkillDistillation(
      input,
      error instanceof Error ? error.message : '无法读取 WINK GO 模型配置。'
    );
  }
  const promptPayload = {
    requested_name: redactBrowserTraceText(input.requestedName, 80),
    requested_description: redactBrowserTraceText(input.requestedDescription, 240),
    domain: input.domain,
    entry_url: input.entryUrl,
    start_page: safePageSummary(input.startPage),
    end_page: safePageSummary(input.endPage),
    steps: input.steps.slice(0, MAX_PROMPT_STEPS).map(safeStepForPrompt),
  };
  const system = [
    'You are the local WINK GO browser skill distiller.',
    'Convert one sanitized human browser trajectory into a reusable, deterministic capability.',
    'Never invent steps or selectors. Remove accidental/redundant actions but preserve required navigation, input and submission.',
    'Describe intent and verification, not private page content. Output JSON only.',
  ].join(' ');
  const user = [
    'Return exactly one JSON object with:',
    'capability (short kebab-case), intent, description, trigger_phrases (array), guide_steps (array),',
    'keep_step_numbers (1-based integer array), parameter_labels (object keyed by existing parameter_key),',
    'outcome_checks (array of {type: url_contains|title_contains|text_present, value}).',
    'The first navigation step must be retained. Do not include secrets or literal input values.',
    JSON.stringify(promptPayload),
  ].join('\n');

  let providerFailure = '';
  if (selected) {
    try {
      const client = await ClientFactory.createRotatingClient(selected.provider, {
        timeout: AI_TIMEOUT_MS,
        rotatingOptions: { maxRetries: 1, retryDelay: 500 },
      });
      const response = await client.createChatCompletion({
        model: selected.provider.use_model,
        temperature: 0.1,
        max_tokens: 2_000,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      return normalizeAiDistillation(responseText(response), input, {
        providerName: selected.providerName,
        model: selected.provider.use_model,
      });
    } catch (error) {
      providerFailure = error instanceof Error ? error.message : 'WINK GO Provider 技能生成失败。';
    }
  }

  try {
    const agent = await runDistillationWithWinkGoAgent(`${system}\n\n${user}`);
    return normalizeAiDistillation(agent.content, input, agent);
  } catch (error) {
    const agentFailure = error instanceof Error ? error.message : 'WINK GO Agent 技能生成失败。';
    return createLocalWinkGoBrowserSkillDistillation(
      input,
      [providerFailure, agentFailure].filter(Boolean).join('；') || 'WINK GO AI 技能生成失败。'
    );
  }
};

const elementPromptRow = (element: WinkGoBrowserElement): Record<string, string> => ({
  ref: element.ref,
  role: cleanText(element.role, 40),
  name: redactBrowserTraceText(element.name, 160),
  text: redactBrowserTraceText(element.text, 160),
  placeholder: redactBrowserTraceText(element.placeholder, 120),
  ...(element.bounds ? { bounds: JSON.stringify(element.bounds) } : {}),
});

export const repairWinkGoBrowserStepWithAi = async (
  step: WinkGoBrowserWorkflowStep,
  snapshot: WinkGoBrowserPageSnapshot
): Promise<string | undefined> => {
  if (process.env.NODE_ENV === 'test' || !snapshot.ok || !snapshot.elements?.length) return undefined;
  let selected: Awaited<ReturnType<typeof resolveConfiguredProvider>>;
  try {
    selected = await resolveConfiguredProvider();
  } catch {
    return undefined;
  }
  if (!selected) return undefined;
  const prompt = JSON.stringify({
    task: 'Select the single current element that best matches the recorded browser action. Return JSON {"ref":"..."} or {"ref":null}.',
    recorded_action: {
      type: step.type,
      role: step.role,
      name: redactBrowserTraceText(step.accessibleName || step.fallbackText, 180),
    },
    current_elements: snapshot.elements.slice(0, 160).map(elementPromptRow),
  });
  try {
    const client = await ClientFactory.createRotatingClient(selected.provider, {
      timeout: 20_000,
      rotatingOptions: { maxRetries: 0, retryDelay: 0 },
    });
    const response = await client.createChatCompletion({
      model: selected.provider.use_model,
      temperature: 0,
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });
    const json = extractJsonObject(responseText(response));
    const ref = cleanText(json?.ref, 120);
    return snapshot.elements.some((element) => element.ref === ref) ? ref : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Desktop repair is deliberately narrower than general Computer Use: the
 * model may select one id from the Runtime's current UIA candidates and
 * cannot return selectors, coordinates or a new action.
 */
export const selectWinkGoDesktopRepairCandidateWithAi = async (input: {
  failedStep: DesktopSkillStep;
  reason: string;
  candidates: DesktopRepairCandidate[];
}): Promise<string | undefined> => {
  if (!input.candidates.length) return undefined;
  if (process.env.NODE_ENV === 'test') return input.candidates[0]?.id;
  let selected: Awaited<ReturnType<typeof resolveConfiguredProvider>>;
  try {
    selected = await resolveConfiguredProvider();
  } catch {
    return undefined;
  }
  if (!selected) return undefined;
  const allowedIds = new Set(input.candidates.map(({ id }) => id));
  const prompt = JSON.stringify({
    task: 'Select exactly one current Windows UIA candidate for the failed recorded step. Return JSON {"candidate_id":"..."} or {"candidate_id":null}. Never invent an id.',
    failure: cleanText(input.reason, 200),
    recorded_step: input.failedStep,
    current_candidates: input.candidates.slice(0, 12).map(({ id, locator }) => ({ id, locator })),
  });
  try {
    const client = await ClientFactory.createRotatingClient(selected.provider, {
      timeout: 20_000,
      rotatingOptions: { maxRetries: 0, retryDelay: 0 },
    });
    const response = await client.createChatCompletion({
      model: selected.provider.use_model,
      temperature: 0,
      max_tokens: 100,
      messages: [
        {
          role: 'system',
          content: 'You are WINK GO desktop skill repair. Choose only one supplied candidate id. Output JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    });
    const json = extractJsonObject(responseText(response));
    const candidateId = cleanText(json?.candidate_id, 120);
    return allowedIds.has(candidateId) ? candidateId : undefined;
  } catch {
    return undefined;
  }
};

const BROWSER_AGENT_ACTIONS = new Set<WinkGoBrowserActionRequest['action']>([
  'navigate',
  'click',
  'submit',
  'fill',
  'select',
  'press',
  'wait',
  'scroll',
  'back',
  'forward',
  'reload',
]);

const normalizeBrowserAgentAction = (
  value: unknown,
  snapshot?: WinkGoBrowserPageSnapshot
): WinkGoBrowserActionRequest | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const action = cleanText(raw.action, 40) as WinkGoBrowserActionRequest['action'];
  if (!BROWSER_AGENT_ACTIONS.has(action)) return undefined;
  const textField = (key: string, maximum = 2_048): string | undefined => {
    const next = cleanText(raw[key], maximum);
    return next || undefined;
  };
  const numberField = (key: string, minimum: number, maximum: number): number | undefined => {
    const next = Number(raw[key]);
    return Number.isFinite(next) ? Math.max(minimum, Math.min(maximum, Math.trunc(next))) : undefined;
  };
  const screenshotX = snapshot?.screenshot
    ? numberField('x', 0, Math.max(0, snapshot.screenshot.width - 1))
    : undefined;
  const screenshotY = snapshot?.screenshot
    ? numberField('y', 0, Math.max(0, snapshot.screenshot.height - 1))
    : undefined;
  const viewportX =
    screenshotX !== undefined && snapshot?.screenshot
      ? Math.round((screenshotX * snapshot.screenshot.viewportWidth) / snapshot.screenshot.width)
      : undefined;
  const viewportY =
    screenshotY !== undefined && snapshot?.screenshot
      ? Math.round((screenshotY * snapshot.screenshot.viewportHeight) / snapshot.screenshot.height)
      : undefined;
  return {
    action,
    ...(textField('ref', 160) ? { ref: textField('ref', 160) } : {}),
    ...(textField('selector', 500) ? { selector: textField('selector', 500) } : {}),
    ...(textField('role', 80) ? { role: textField('role', 80) } : {}),
    ...(textField('name', 240) ? { name: textField('name', 240) } : {}),
    ...(textField('value', 2_000) ? { value: textField('value', 2_000) } : {}),
    ...(textField('url', 2_048) ? { url: textField('url', 2_048) } : {}),
    ...(textField('key', 80) ? { key: textField('key', 80) } : {}),
    ...(textField('text', 500) ? { text: textField('text', 500) } : {}),
    ...(numberField('timeoutMs', 0, 30_000) !== undefined ? { timeoutMs: numberField('timeoutMs', 0, 30_000) } : {}),
    ...(numberField('deltaX', -20_000, 20_000) !== undefined ? { deltaX: numberField('deltaX', -20_000, 20_000) } : {}),
    ...(numberField('deltaY', -20_000, 20_000) !== undefined ? { deltaY: numberField('deltaY', -20_000, 20_000) } : {}),
    ...(action === 'click' && viewportX !== undefined && viewportY !== undefined
      ? { x: viewportX, y: viewportY }
      : {}),
  };
};

/**
 * Plan exactly one observable browser action. The caller owns the execution
 * loop and re-observes after every action, mirroring Computer Use rather than
 * asking the chat model to remember fragile selectors across turns.
 */
export const planWinkGoBrowserAgentStep = async (
  input: WinkGoBrowserAgentPlanInput
): Promise<WinkGoBrowserAgentDecision> => {
  const selected = await resolveConfiguredProvider(input.model);
  if (!selected) {
    return {
      status: 'failed',
      message: '没有可用于自主浏览器的模型。请先在“模型”中配置一个可用模型。',
    };
  }
  const elements = (input.snapshot.elements || []).slice(0, 180).map((element) => ({
    ref: element.ref,
    role: cleanText(element.role, 50),
    name: redactBrowserTraceText(element.name, 180),
    text: redactBrowserTraceText(element.text, 180),
    placeholder: redactBrowserTraceText(element.placeholder, 120),
    disabled: element.disabled,
    href: element.href,
  }));
  const payload = {
    goal: redactBrowserTraceText(input.goal, 2_000),
    page: {
      url: input.snapshot.url,
      title: redactBrowserTraceText(input.snapshot.title, 240),
      text: redactBrowserTraceText(input.snapshot.text, 7_000),
      elements,
      viewport: input.snapshot.viewport,
      screenshot: input.snapshot.screenshot
        ? {
            width: input.snapshot.screenshot.width,
            height: input.snapshot.screenshot.height,
            coordinate_origin: 'top-left',
          }
        : null,
    },
    recent_history: input.history.slice(-8),
    reusable_browser_skills: (input.skillHints || []).slice(0, 4),
    login_automation_enabled: input.loginAutomationEnabled === true,
  };
  const loginPolicy = input.loginAutomationEnabled
    ? 'The user enabled browser login automation after accepting a disclaimer. You may open sign-in pages, click login or QR-login controls, request a verification code, wait for the user to scan a QR code, and submit a login form after the user manually populated protected fields.'
    : 'Browser login automation is disabled. Return blocked before opening or operating login, QR-login, authorization-login, OTP, or CAPTCHA controls.';
  const system = [
    'You are the WINK GO autonomous in-app browser controller.',
    'Work in a strict observe-decide-act-verify loop. Choose exactly one next action from the current snapshot.',
    'Use a current element ref whenever possible. Never reuse refs from history and never invent refs or selectors.',
    'A current browser screenshot is attached when a vision model is available. DOM refs remain preferred for normal controls.',
    'For canvas, WebGL, games, maps, charts, remote desktops, or other pixel-only content, use action click with screenshot-space integer x and y coordinates measured from the top-left of the attached image.',
    'Never return x/y without an attached screenshot. The runtime maps screenshot coordinates back to the live browser viewport and rejects out-of-bounds clicks.',
    'Return done only when the current page visibly proves the goal is complete.',
    loginPolicy,
    'Always return blocked before purchases, payments, publishing, sending messages, deleting data, account/security changes, file upload, permission grants, or any action requiring explicit user confirmation.',
    'Never request, read, infer, or fill passwords, OTP values, CAPTCHA answers, QR payloads, tokens, or payment data. Ask the user to complete those protected inputs manually, then continue after the page changes.',
    'Prefer press Enter for an ordinary search instead of submit. Do not merely narrate what could be clicked.',
    'Output JSON only: {"status":"act|done|blocked|failed","message":"short reason","action":{...}}.',
    'Allowed actions: navigate, click, fill, select, press, wait, scroll, back, forward, reload.',
    'Allowed action fields: action, ref, role, name, value, url, key, text, timeoutMs, deltaX, deltaY, x, y.',
  ].join(' ');
  try {
    const client = await ClientFactory.createRotatingClient(selected.provider, {
      timeout: BROWSER_AGENT_TIMEOUT_MS,
      rotatingOptions: { maxRetries: 0, retryDelay: 0 },
    });
    const response = await client.createChatCompletion({
      model: selected.provider.use_model,
      temperature: 0,
      max_tokens: 600,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: input.snapshot.screenshot
            ? [
                { type: 'text', text: JSON.stringify(payload) },
                { type: 'image_url', image_url: { url: input.snapshot.screenshot.dataUrl } },
              ]
            : JSON.stringify(payload),
        },
      ],
    });
    const json = extractJsonObject(responseText(response));
    const status = cleanText(json?.status, 20) as WinkGoBrowserAgentDecision['status'];
    const message = cleanText(json?.message, 500) || 'WINK GO 浏览器规划器没有返回说明。';
    if (!['act', 'done', 'blocked', 'failed'].includes(status)) {
      return { status: 'failed', message: '自主浏览器返回了无效决策。' };
    }
    if (status !== 'act') return { status, message };
    const action = normalizeBrowserAgentAction(json?.action, input.snapshot);
    return action ? { status, message, action } : { status: 'failed', message: '自主浏览器没有返回有效动作。' };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? `自主浏览器规划失败：${error.message}` : '自主浏览器规划失败。',
    };
  }
};
