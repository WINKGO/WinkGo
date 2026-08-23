/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import { ClientFactory } from '@/common/api';
import { httpRequest } from '@/common/adapter/httpBridge';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type { ComputerUseModelRef } from '@/common/types/computerUse';
import { getComputerUseModelCandidates, selectDefaultWinkGoComputerUseModel } from '@/common/utils/computerUseModel';
import type {
  DesktopComputerUseAction,
  DesktopComputerUseDecision,
  DesktopComputerUsePlanInput,
} from './winkGoDesktopComputerUseService';

const MODEL_TIMEOUT_MS = 30_000;
const RISKY_ACTION =
  /支付|购买|下单|发送|发布|删除|注销|密码|验证码|授权|上传|登录|pay|purchase|send|publish|delete|password|otp|captcha|upload|login/i;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const cleanText = (value: unknown, maximum = 500): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';
const cleanInputText = (value: unknown, maximum = 2_000): string => {
  if (typeof value !== 'string' || value.includes('\0')) return '';
  return value.replace(/\r\n?/g, '\n').trim().slice(0, maximum);
};

const normalizeDecisionStatus = (value: unknown): DesktopComputerUseDecision['status'] | '' => {
  const status = cleanText(value, 20).toLowerCase();
  if (['done', 'complete', 'completed', 'success', 'finished'].includes(status)) return 'done';
  if (status === 'continue') return 'act';
  return ['act', 'blocked', 'failed'].includes(status) ? (status as DesktopComputerUseDecision['status']) : '';
};

export { selectDefaultWinkGoComputerUseModel } from '@/common/utils/computerUseModel';

const resolveSelectedProvider = async (providerId: string, model: string): Promise<TProviderWithModel | null> => {
  const providers = (await httpRequest<IProvider[]>('GET', '/api/providers')) || [];
  const provider = providers.find((item) => item.id === providerId && item.enabled !== false);
  if (!provider || !provider.api_key?.trim() || !getComputerUseModelCandidates(provider).includes(model)) return null;
  const { models: _models, ...fields } = provider;
  return { ...fields, use_model: model };
};

/** Selects a configured local provider for Agent-initiated desktop tasks without exposing credentials to the Agent. */
export const resolveDefaultWinkGoComputerUseModel = async (): Promise<ComputerUseModelRef | null> => {
  const providers = (await httpRequest<IProvider[]>('GET', '/api/providers')) || [];
  return selectDefaultWinkGoComputerUseModel(providers);
};

type ConversationModelSnapshot = {
  model?: {
    provider_id?: string;
    model?: string;
    use_model?: string;
  };
};

/** Uses the active Agent conversation model before falling back to a global visual default. */
export const resolveWinkGoComputerUseModelForConversation = async (
  conversationId: string
): Promise<ComputerUseModelRef | null> => {
  const normalizedConversationId = conversationId.trim();
  const [providers, conversation] = await Promise.all([
    httpRequest<IProvider[]>('GET', '/api/providers').catch((): IProvider[] => []),
    normalizedConversationId
      ? httpRequest<ConversationModelSnapshot>(
          'GET',
          `/api/conversations/${encodeURIComponent(normalizedConversationId)}`
        ).catch((): ConversationModelSnapshot | null => null)
      : Promise.resolve(null),
  ]);
  const providerId = conversation?.model?.provider_id?.trim() || '';
  const model = (conversation?.model?.model || conversation?.model?.use_model || '').trim();
  const selectedProvider = providers.find(
    (provider) =>
      provider.id === providerId &&
      provider.enabled !== false &&
      Boolean(provider.api_key?.trim()) &&
      getComputerUseModelCandidates(provider).includes(model)
  );
  if (selectedProvider && model) return { providerId: selectedProvider.id, model };
  return selectDefaultWinkGoComputerUseModel(providers);
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
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

const extractFirstJsonObject = (value: string): Record<string, unknown> | null => {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character !== '}' || depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    try {
      const parsed = asRecord(JSON.parse(value.slice(start, index + 1)));
      if (parsed) return parsed;
    } catch {
      // Continue scanning: compatible providers occasionally prepend a
      // balanced non-JSON explanation before the actionable object.
    }
    start = -1;
  }
  return null;
};

const extractJson = (value: string): Record<string, unknown> | null => {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  return (fenced ? extractFirstJsonObject(fenced) : null) || extractFirstJsonObject(trimmed);
};

const rectFrom = (value: unknown): { left: number; top: number; right: number; bottom: number } | null => {
  const raw = asRecord(value);
  if (!raw) return null;
  const left = Number(raw.left ?? raw.x);
  const top = Number(raw.top ?? raw.y);
  const right = Number(raw.right ?? left + Number(raw.width));
  const bottom = Number(raw.bottom ?? top + Number(raw.height));
  return [left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top
    ? { left, top, right, bottom }
    : null;
};

export const parseWinkGoDesktopComputerUseAction = (
  rawValue: unknown,
  input: DesktopComputerUsePlanInput
): DesktopComputerUseAction | undefined => {
  const raw = asRecord(rawValue);
  const kind = cleanText(raw?.kind, 30) as DesktopComputerUseAction['kind'];
  if (!['launch', 'open_file', 'click', 'type', 'press', 'hotkey', 'scroll'].includes(kind)) return undefined;
  const label = cleanText(raw?.label, 160);
  if (RISKY_ACTION.test(label)) return { kind, label, sensitive: true };
  if (kind === 'launch') {
    const appName = cleanText(raw?.appName ?? raw?.app_name, 80);
    return appName && !/[\\/:"'`;&|<>\r\n]/u.test(appName) ? { kind, appName, label } : undefined;
  }
  if (kind === 'open_file') {
    const rawPath = typeof raw?.path === 'string' ? raw.path.trim() : '';
    return !rawPath.includes('\0') && /^[A-Za-z]:\\.{1,1000}$/u.test(rawPath)
      ? { kind, path: rawPath, label }
      : undefined;
  }
  if (kind === 'click' || kind === 'type') {
    const ref = cleanText(raw?.ref, 160);
    const lastAction = input.history.at(-1);
    const followsSelectAll =
      lastAction?.ok === true &&
      lastAction.action?.kind === 'hotkey' &&
      (lastAction.action.keys || []).some((key) => /^(?:ctrl|control|meta|cmd|command)$/i.test(key)) &&
      (lastAction.action.keys || []).some((key) => /^a$/i.test(key));
    if (kind === 'type' && (!ref || followsSelectAll)) {
      const text = cleanInputText(raw?.text, 2_000);
      return text ? { kind, text, label } : undefined;
    }
    const item = [...input.observation.controls, ...input.observation.ocr].find(
      (candidate) => cleanText(candidate.ref, 160) === ref
    );
    const rect = rectFrom(item?.rect || item);
    if (!rect) return undefined;
    const center = { x: Math.round((rect.left + rect.right) / 2), y: Math.round((rect.top + rect.bottom) / 2) };
    if (kind === 'type') {
      const text = cleanInputText(raw?.text, 2_000);
      return text ? { kind, ...center, text, label } : undefined;
    }
    return { kind, ...center, label };
  }
  if (kind === 'press') {
    const key = cleanText(raw?.key, 40);
    return key ? { kind, key, label } : undefined;
  }
  if (kind === 'hotkey') {
    const keys = Array.isArray(raw?.keys)
      ? raw.keys
          .map((key) => cleanText(key, 30))
          .filter(Boolean)
          .slice(0, 4)
      : [];
    return keys.length ? { kind, keys, label } : undefined;
  }
  const delta = Math.max(-12, Math.min(12, Math.trunc(Number(raw?.delta) || 0)));
  return delta ? { kind: 'scroll', delta, label } : undefined;
};

/** Plans one bounded desktop action from a fresh screenshot plus UIA/OCR refs. */
export const planWinkGoDesktopComputerUseStep = async (
  input: DesktopComputerUsePlanInput
): Promise<DesktopComputerUseDecision> => {
  const provider = await resolveSelectedProvider(input.model.providerId, input.model.model);
  if (!provider) return { status: 'failed', message: '所选模型不可用，请先检查模型配置与视觉能力。' };
  const image = await readFile(input.observation.screenshotPath).catch((): Buffer | null => null);
  if (!image) return { status: 'failed', message: '无法读取本轮桌面截图。' };
  const elements = [...input.observation.controls, ...input.observation.ocr].slice(0, 220).map((item) => ({
    ref: cleanText(item.ref, 160),
    name: cleanText(item.name ?? item.text, 180),
    type: cleanText(item.control_type ?? item.controlType, 80),
    rect: item.rect || {
      left: item.left,
      top: item.top,
      right: item.right,
      bottom: item.bottom,
    },
  }));
  const system = [
    'You are WINK GO Desktop Computer Use. Work only inside the bound Windows target.',
    'Choose exactly one action from the current screenshot and current element refs.',
    'Never invent refs. Return done only when the screenshot visibly proves completion.',
    'Return blocked before sending, publishing, purchasing, deleting, login/password/OTP, upload or permission changes.',
    'When the requested application is not the current target, use launch with only its short display name; never put a path, URL or command line in appName.',
    'When the goal explicitly contains an absolute local file path that must be edited visibly, use open_file with that exact path. Never invent a path and never use open_file for a URL or command.',
    'For type actions, preserve the exact intended line breaks with JSON \\n escapes. Never flatten a multi-line document into one line.',
    'Output JSON only: {"status":"act|done|blocked|failed","message":"reason","action":{"kind":"launch|open_file|click|type|press|hotkey|scroll","appName":"short app display name","path":"exact absolute local file path","ref":"current-ref","text":"...","key":"...","keys":[],"delta":-3,"label":"..."}}.',
  ].join(' ');
  try {
    const client = await ClientFactory.createRotatingClient(provider, {
      timeout: MODEL_TIMEOUT_MS,
      rotatingOptions: { maxRetries: 0, retryDelay: 0 },
    });
    const response = await client.createChatCompletion({
      model: provider.use_model,
      temperature: 0,
      max_tokens: 650,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                goal: cleanText(input.goal, 2_000),
                target: input.observation.target,
                visible_text: cleanText(input.observation.text, 8_000),
                elements,
                recent_history: input.history.slice(-8),
              }),
            },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } },
          ],
        },
      ],
    });
    const rawResponseText = responseText(response);
    const json = extractJson(rawResponseText);
    const status = normalizeDecisionStatus(json?.status);
    const message = cleanText(json?.message, 500) || '桌面控制模型没有返回说明。';
    const action = parseWinkGoDesktopComputerUseAction(json?.action, input);
    if (!status) {
      if (action) {
        if (action.sensitive) return { status: 'blocked', message: `${message} 该操作需要用户明确确认。` };
        return { status: 'act', message, action };
      }
      console.warn('[DesktopComputerUse] Invalid model decision response', {
        providerId: input.model.providerId,
        model: input.model.model,
        responseKeys:
          response && typeof response === 'object' ? Object.keys(response as unknown as Record<string, unknown>) : [],
        responsePreview: rawResponseText.slice(0, 1_200),
      });
      return { status: 'failed', message: '桌面控制模型返回了无效状态。' };
    }
    if (status !== 'act') return { status, message };
    if (!action) return { status: 'failed', message: '桌面控制模型没有返回可验证的当前元素动作。' };
    if (action.sensitive) return { status: 'blocked', message: `${message} 该操作需要用户明确确认。` };
    return { status: 'act', message, action };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? `桌面控制规划失败：${error.message}` : '桌面控制规划失败。',
    };
  }
};
