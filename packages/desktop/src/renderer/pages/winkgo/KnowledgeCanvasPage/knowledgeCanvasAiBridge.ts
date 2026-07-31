/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import type { Assistant } from '@/common/types/agent/assistantTypes';

export const KNOWLEDGE_CANVAS_BRIDGE_CHANNEL = 'winkgo-knowledge-canvas';
export const KNOWLEDGE_CANVAS_BRIDGE_VERSION = 1;

export type KnowledgeCanvasAnalysisRequest = {
  channel: typeof KNOWLEDGE_CANVAS_BRIDGE_CHANNEL;
  version: typeof KNOWLEDGE_CANVAS_BRIDGE_VERSION;
  type: 'analyze';
  requestId: string;
  input: string;
  options: {
    inputType?: string;
    density?: string;
    mode?: string;
    includeComments?: boolean;
    fileName?: string;
    fileFormat?: string;
    fileContent?: string;
  };
};

export type KnowledgeCanvasCancelRequest = {
  channel: typeof KNOWLEDGE_CANVAS_BRIDGE_CHANNEL;
  version: typeof KNOWLEDGE_CANVAS_BRIDGE_VERSION;
  type: 'cancel';
  requestId: string;
};

export type KnowledgeCanvasAnalysis = {
  schemaVersion: 1;
  analysisType: 'biography' | 'company' | 'event' | 'concept' | 'research' | 'general';
  title: string;
  summary: string;
  source: {
    title: string;
    url?: string;
    platform: string;
    durationMs?: number;
    thumbnail?: string;
  };
  evidence: Array<{
    id: string;
    text: string;
    startMs?: number;
    endMs?: number;
    speaker?: string;
    type: 'fact' | 'author_opinion' | 'audience_comment' | 'ai_inference' | 'external';
    confidence: number;
  }>;
  nodes: Array<{
    id: string;
    parentId?: string;
    title: string;
    summary: string;
    role:
      | 'phase'
      | 'milestone'
      | 'decision'
      | 'turning_point'
      | 'setback'
      | 'principle'
      | 'impact'
      | 'claim'
      | 'cause'
      | 'effect'
      | 'evidence'
      | 'question'
      | 'action';
    confidence: number;
    salience: number;
    evidenceIds: string[];
  }>;
  edges: Array<{
    sourceId: string;
    targetId: string;
    relation: 'contains' | 'supports' | 'contradicts' | 'causes' | 'example' | 'context';
    label: string;
    confidence: number;
    evidenceIds: string[];
  }>;
};

export type KnowledgeCanvasHostMessage =
  | {
      channel: typeof KNOWLEDGE_CANVAS_BRIDGE_CHANNEL;
      version: typeof KNOWLEDGE_CANVAS_BRIDGE_VERSION;
      type: 'progress';
      requestId: string;
      stage: 'resolving' | 'downloading' | 'transcribing' | 'extracting' | 'generating';
      progress: number;
      detail: string;
    }
  | {
      channel: typeof KNOWLEDGE_CANVAS_BRIDGE_CHANNEL;
      version: typeof KNOWLEDGE_CANVAS_BRIDGE_VERSION;
      type: 'result';
      requestId: string;
      analysis: KnowledgeCanvasAnalysis;
    }
  | {
      channel: typeof KNOWLEDGE_CANVAS_BRIDGE_CHANNEL;
      version: typeof KNOWLEDGE_CANVAS_BRIDGE_VERSION;
      type: 'error';
      requestId: string;
      message: string;
      code: string;
    };

const ANALYSIS_BEGIN = '---WINKGO_CANVAS_JSON---';
const ANALYSIS_END = '---WINKGO_CANVAS_JSON_END---';
const ANALYSIS_TIMEOUT_MS = 8 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function isKnowledgeCanvasAnalysisRequest(value: unknown): value is KnowledgeCanvasAnalysisRequest {
  if (!isRecord(value)) return false;
  return (
    value.channel === KNOWLEDGE_CANVAS_BRIDGE_CHANNEL &&
    value.version === KNOWLEDGE_CANVAS_BRIDGE_VERSION &&
    value.type === 'analyze' &&
    typeof value.requestId === 'string' &&
    typeof value.input === 'string' &&
    isRecord(value.options)
  );
}

export function isKnowledgeCanvasCancelRequest(value: unknown): value is KnowledgeCanvasCancelRequest {
  if (!isRecord(value)) return false;
  return (
    value.channel === KNOWLEDGE_CANVAS_BRIDGE_CHANNEL &&
    value.version === KNOWLEDGE_CANVAS_BRIDGE_VERSION &&
    value.type === 'cancel' &&
    typeof value.requestId === 'string'
  );
}

export function selectKnowledgeCanvasAssistant(assistants: Assistant[]): Assistant | undefined {
  const candidates = assistants.filter(
    (assistant) => assistant.enabled && assistant.agent_status !== 'missing' && assistant.agent_status !== 'offline'
  );
  return (
    candidates.find((assistant) => /codex\s*cli/i.test(assistant.name)) ??
    candidates.find((assistant) => /wink\s*go\s*cli/i.test(assistant.name)) ??
    candidates.find((assistant) => assistant.agent?.type === 'winkgo_agent') ??
    candidates[0]
  );
}

function densityInstruction(density?: string) {
  if (density === 'concise') return '控制在 8–14 个高价值节点，只保留决定理解全局的内容。';
  if (density === 'detailed') return '生成 18–30 个节点，保留关键细节、反例和证据。';
  return '生成 12–22 个节点，在信息密度与可读性之间保持平衡。';
}

function modeInstruction(mode?: string) {
  if (mode === 'debate') return '重点比较争议、证据冲突、反例与判断边界。';
  if (mode === 'research') return '重点呈现可验证结论、证据缺口、风险与后续研究问题。';
  if (mode === 'study') return '按便于学习和回忆的认知顺序组织，但不要牺牲原始时间线与因果关系。';
  return '先识别内容真正的叙事骨架，再组织画布。';
}

export function buildKnowledgeCanvasAnalysisPrompt(request: KnowledgeCanvasAnalysisRequest): string {
  const sourceKind =
    request.options.inputType === 'topic'
      ? '研究主题'
      : request.options.inputType === 'file'
        ? `本地文件（${request.options.fileName ?? '未命名'}）`
        : '公开链接或正文';
  const localText = request.options.fileContent?.trim();
  const localTextSection = localText ? `\n本地文件正文（最多取前 60000 字符）：\n${localText.slice(0, 60_000)}\n` : '';

  return `
你是 WINK GO 知识画布的深度研究引擎。请真正读取和分析给定来源，而不是套用固定思维导图模板。

来源类型：${sourceKind}
输入：
${request.input}
${localTextSection}

工作要求：
1. 先判断材料属于人物传记、公司/产品案例、事件复盘、概念解释、研究议题或其他类型。
2. 如果是公开视频链接，优先获取标题、简介、公开字幕/自动字幕和时间戳。Bilibili/YouTube 可使用公开页面或 yt-dlp 的元数据与字幕能力；禁止登录、绕过权限或抓取私密内容。Bilibili 遇到 yt-dlp 412 时，改用公开 API x/web-interface/view 获取标题与 cid，再用 x/player/v2 检查字幕；如果确实没有字幕，可通过 x/player/playurl 的 DASH 低码率音频配合本机已有语音识别能力转写。不要为了转写下载高码率完整视频。
3. 当来源没有公开字幕且本机也没有语音识别能力时，不得伪造转写。应使用视频简介、作者公开文字和可搜索到的可靠外部来源交叉验证；相应证据标记为 external，并在节点摘要中说明证据边界。
4. 如果是人物故事（例如创业者经历），结构必须围绕：成长背景、时间阶段、关键经历、重大决定、转折点、挫折/风险、因果链、形成的原则与后续影响。不能只把转写文字机械分段。
5. 如果是公司/事件/概念，动态选择真正适合该内容的结构。不要强行生成和人物传记相同的节点。
6. 每个重要结论必须引用 evidenceIds。视频证据尽量提供 startMs/endMs；无法确认的内容必须标为 ai_inference，并降低 confidence。
7. 节点之间除了层级关系，还要表达 causes、supports、contradicts、context 等真实关系。
8. ${densityInstruction(request.options.density)}
9. ${modeInstruction(request.options.mode)}
10. 不要写文件，不要解释过程，只返回严格 JSON。所有 id 使用简短英文/数字/连字符且在本次结果内唯一。

JSON 结构（字段不可省略，nodes 不要包含总根节点，WINK GO 会自动创建总根节点）：
{
  "schemaVersion": 1,
  "analysisType": "biography|company|event|concept|research|general",
  "title": "画布标题",
  "summary": "一段真正概括内容主线的摘要",
  "source": {
    "title": "来源标题",
    "url": "原始链接（无则省略）",
    "platform": "bilibili|youtube|generic-web|upload|manual",
    "durationMs": 0,
    "thumbnail": "公开缩略图链接（无则省略）"
  },
  "evidence": [
    {
      "id": "ev-1",
      "text": "可核查的原文、字幕或事实摘要",
      "startMs": 0,
      "endMs": 0,
      "speaker": "说话人（未知可省略）",
      "type": "fact|author_opinion|audience_comment|ai_inference|external",
      "confidence": 0.95
    }
  ],
  "nodes": [
    {
      "id": "phase-early",
      "parentId": "另一个节点 id（顶层省略）",
      "title": "节点标题",
      "summary": "说明这一步发生了什么、为什么重要",
      "role": "phase|milestone|decision|turning_point|setback|principle|impact|claim|cause|effect|evidence|question|action",
      "confidence": 0.9,
      "salience": 0.8,
      "evidenceIds": ["ev-1"]
    }
  ],
  "edges": [
    {
      "sourceId": "节点 id",
      "targetId": "节点 id",
      "relation": "contains|supports|contradicts|causes|example|context",
      "label": "关系说明",
      "confidence": 0.9,
      "evidenceIds": ["ev-1"]
    }
  ]
}

请把 JSON 放在以下边界之间：
${ANALYSIS_BEGIN}
{...}
${ANALYSIS_END}
  `.trim();
}

function clampScore(value: unknown, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
}

function cleanId(value: unknown, fallback: string) {
  const id = typeof value === 'string' ? value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-') : '';
  return id || fallback;
}

function cleanText(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

const analysisTypes = new Set(['biography', 'company', 'event', 'concept', 'research', 'general']);
const evidenceTypes = new Set(['fact', 'author_opinion', 'audience_comment', 'ai_inference', 'external']);
const nodeRoles = new Set([
  'phase',
  'milestone',
  'decision',
  'turning_point',
  'setback',
  'principle',
  'impact',
  'claim',
  'cause',
  'effect',
  'evidence',
  'question',
  'action',
]);
const relationTypes = new Set(['contains', 'supports', 'contradicts', 'causes', 'example', 'context']);

export function normalizeKnowledgeCanvasAnalysis(value: unknown): KnowledgeCanvasAnalysis {
  if (!isRecord(value)) throw new Error('AI 返回的画布数据不是 JSON 对象');

  const sourceValue = isRecord(value.source) ? value.source : {};
  const rawEvidence = Array.isArray(value.evidence) ? value.evidence : [];
  const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
  const rawEdges = Array.isArray(value.edges) ? value.edges : [];

  const evidence = rawEvidence
    .filter(isRecord)
    .map((item, index) => ({
      id: cleanId(item.id, `ev-${index + 1}`),
      text: cleanText(item.text),
      ...(Number.isFinite(Number(item.startMs)) ? { startMs: Math.max(0, Number(item.startMs)) } : {}),
      ...(Number.isFinite(Number(item.endMs)) ? { endMs: Math.max(0, Number(item.endMs)) } : {}),
      ...(cleanText(item.speaker) ? { speaker: cleanText(item.speaker) } : {}),
      type: (evidenceTypes.has(String(item.type))
        ? item.type
        : 'ai_inference') as KnowledgeCanvasAnalysis['evidence'][number]['type'],
      confidence: clampScore(item.confidence, 0.65),
    }))
    .filter((item) => item.text.length > 0);

  const evidenceIdSet = new Set(evidence.map((item) => item.id));
  const nodeIds = new Set<string>();
  const nodes = rawNodes
    .filter(isRecord)
    .map((item, index) => {
      let id = cleanId(item.id, `node-${index + 1}`);
      while (nodeIds.has(id)) id = `${id}-${index + 1}`;
      nodeIds.add(id);
      return {
        id,
        ...(cleanText(item.parentId) ? { parentId: cleanId(item.parentId, '') } : {}),
        title: cleanText(item.title, `节点 ${index + 1}`),
        summary: cleanText(item.summary),
        role: (nodeRoles.has(String(item.role))
          ? item.role
          : 'claim') as KnowledgeCanvasAnalysis['nodes'][number]['role'],
        confidence: clampScore(item.confidence, 0.7),
        salience: clampScore(item.salience, 0.65),
        evidenceIds: (Array.isArray(item.evidenceIds) ? item.evidenceIds : [])
          .map(String)
          .filter((id) => evidenceIdSet.has(id)),
      };
    })
    .filter((item) => item.title.length > 0);

  if (nodes.length < 3) throw new Error('AI 返回的有效知识节点不足，无法生成有意义的画布');

  const edges = rawEdges
    .filter(isRecord)
    .map((item) => ({
      sourceId: cleanId(item.sourceId, ''),
      targetId: cleanId(item.targetId, ''),
      relation: (relationTypes.has(String(item.relation))
        ? item.relation
        : 'context') as KnowledgeCanvasAnalysis['edges'][number]['relation'],
      label: cleanText(item.label),
      confidence: clampScore(item.confidence, 0.7),
      evidenceIds: (Array.isArray(item.evidenceIds) ? item.evidenceIds : [])
        .map(String)
        .filter((id) => evidenceIdSet.has(id)),
    }))
    .filter((item) => nodeIds.has(item.sourceId) && nodeIds.has(item.targetId) && item.sourceId !== item.targetId);

  return {
    schemaVersion: 1,
    analysisType: (analysisTypes.has(String(value.analysisType))
      ? value.analysisType
      : 'general') as KnowledgeCanvasAnalysis['analysisType'],
    title: cleanText(value.title, cleanText(sourceValue.title, 'WINK GO 知识画布')),
    summary: cleanText(value.summary),
    source: {
      title: cleanText(sourceValue.title, cleanText(value.title, '未命名来源')),
      ...(cleanText(sourceValue.url) ? { url: cleanText(sourceValue.url) } : {}),
      platform: cleanText(sourceValue.platform, 'generic-web'),
      ...(Number.isFinite(Number(sourceValue.durationMs))
        ? { durationMs: Math.max(0, Number(sourceValue.durationMs)) }
        : {}),
      ...(cleanText(sourceValue.thumbnail) ? { thumbnail: cleanText(sourceValue.thumbnail) } : {}),
    },
    evidence,
    nodes,
    edges,
  };
}

export function parseKnowledgeCanvasAnalysis(text: string): KnowledgeCanvasAnalysis {
  const bounded = text.match(
    new RegExp(
      `${ANALYSIS_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${ANALYSIS_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
    )
  );
  const trimmed = text.trim();
  const candidate =
    bounded?.[1]?.trim() ||
    text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ||
    (trimmed.startsWith('{') && trimmed.endsWith('}') ? trimmed : undefined);
  if (!candidate) throw new Error('AI 没有返回 WINK GO 知识画布 JSON');
  return normalizeKnowledgeCanvasAnalysis(JSON.parse(candidate));
}

export function extractResponseText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(extractResponseText).filter(Boolean).join('');
  if (!isRecord(value)) return '';
  for (const key of ['text', 'content', 'output_text', 'data', 'message']) {
    if (key in value) {
      const text = extractResponseText(value[key]);
      if (text) return text;
    }
  }
  return '';
}

type RunAnalysisOptions = {
  signal?: AbortSignal;
  onProgress?: (
    message: Omit<
      Extract<KnowledgeCanvasHostMessage, { type: 'progress' }>,
      'channel' | 'version' | 'requestId' | 'type'
    >
  ) => void;
};

export async function runKnowledgeCanvasAnalysis(
  request: KnowledgeCanvasAnalysisRequest,
  options: RunAnalysisOptions = {}
): Promise<KnowledgeCanvasAnalysis> {
  if (options.signal?.aborted) throw new DOMException('知识画布分析已取消', 'AbortError');

  options.onProgress?.({ stage: 'resolving', progress: 8, detail: '正在选择 WINK GO AI 分析引擎' });

  const assistants = await ipcBridge.assistants.list.invoke();
  const assistant = selectKnowledgeCanvasAssistant(assistants);
  if (!assistant) {
    throw new Error('没有可用的 WINK GO CLI 或 Codex CLI。请先在“助手”页面安装并启用一个 Agent。');
  }

  options.onProgress?.({
    stage: 'downloading',
    progress: 18,
    detail: `正在启动 ${assistant.name}，读取公开内容与字幕`,
  });

  const conversation = await ipcBridge.conversation.create.invoke({
    name: `知识画布分析：${request.input.slice(0, 60)}`,
    assistant: {
      id: assistant.id,
      locale: 'zh-CN',
    },
    extra: {
      workspace: '',
      custom_workspace: false,
      default_files: [],
      selected_mcp_server_ids: [],
      selected_session_mcp_servers: [],
      context: 'WINK GO 知识画布后台分析任务。只读取公开来源，不修改用户文件。',
    },
  });

  if (!conversation?.id) throw new Error(`无法启动 ${assistant.name} 分析会话`);

  let turnId = '';
  let completedEventText = '';
  const contentByMessage = new Map<string, string>();
  let resolveCompletion: (() => void) | undefined;
  let rejectCompletion: ((error: Error) => void) | undefined;
  let pendingCompletedTurn = '';

  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  const removeStreamListener = ipcBridge.conversation.responseStream.on((message) => {
    if (message.conversation_id !== conversation.id) return;
    if (turnId && message.turn_id && message.turn_id !== turnId) return;
    if (message.type !== 'content') return;
    const chunk = extractResponseText(message.data);
    if (!chunk) return;
    const previous = contentByMessage.get(message.msg_id) ?? '';
    contentByMessage.set(message.msg_id, message.replace ? chunk : `${previous}${chunk}`);
  });

  const removeTurnListener = ipcBridge.conversation.turnCompleted.on((event) => {
    if (event.session_id !== conversation.id) return;
    if (turnId && event.turn_id !== turnId) return;
    pendingCompletedTurn = event.turn_id;
    completedEventText = extractResponseText(event.last_message.content);
    if (turnId && event.turn_id === turnId) resolveCompletion?.();
  });

  const abortHandler = () => {
    rejectCompletion?.(new DOMException('知识画布分析已取消', 'AbortError'));
    if (turnId) {
      void ipcBridge.conversation.stop
        .invoke({ conversation_id: conversation.id, turn_id: turnId })
        .catch((_error: unknown): void => {
          // The runtime may already be gone after a host reload.
        });
    }
  };
  options.signal?.addEventListener('abort', abortHandler, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    options.onProgress?.({ stage: 'transcribing', progress: 32, detail: '正在提取正文、字幕、时间戳与可核查证据' });
    const sendResult = await ipcBridge.conversation.sendMessage.invoke({
      conversation_id: conversation.id,
      input: buildKnowledgeCanvasAnalysisPrompt(request),
    });
    turnId = sendResult.turn_id;
    if (pendingCompletedTurn === turnId) resolveCompletion?.();

    options.onProgress?.({ stage: 'extracting', progress: 58, detail: 'AI 正在识别题材、经历阶段、转折点与因果关系' });
    timeoutId = setTimeout(() => {
      rejectCompletion?.(new Error('AI 分析超时。请检查网络、Agent 登录状态或更换可用模型后重试。'));
    }, ANALYSIS_TIMEOUT_MS);
    await completion;

    options.onProgress?.({ stage: 'generating', progress: 88, detail: '正在生成具有证据引用的动态知识结构' });
    const streamedText = [...contentByMessage.values()].join('\n');
    return parseKnowledgeCanvasAnalysis(`${streamedText}\n${completedEventText}`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortHandler);
    removeStreamListener();
    removeTurnListener();
    void ipcBridge.conversation.remove.invoke({ id: conversation.id }).catch((_error: unknown): void => {
      // Cleanup is best-effort and must not replace the analysis result.
    });
  }
}
