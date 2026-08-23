/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import {
  executeWinkGoBrowserAction,
  inspectWinkGoBrowserPage,
  type WinkGoBrowserActionRequest,
  type WinkGoBrowserPageSnapshot,
} from './winkGoBrowserControlService';
import { planWinkGoBrowserAgentStep } from './winkGoBrowserSkillAiService';
import { listWinkGoBrowserSkills } from './winkGoBrowserSkillsService';
import { getWinkGoBrowserLoginPermission } from './winkGoBrowserLoginPermissionService';

const DEFAULT_MAX_STEPS = 8;
const MAX_STEPS = 20;
const TASK_DEADLINE_MS = 105_000;
const ALWAYS_RISKY_TARGET =
  /支付|购买|下单|提交订单|付款|发布|发帖|删除|注销|退出账号|修改密码|修改安全|发送消息|发送邮件|提交评论|允许访问|授予权限|上传|pay|purchase|buy|checkout|send message|send email|publish|post|delete|remove|change password|security setting|upload|permission grant/i;
const LOGIN_TARGET =
  /登录|登入|扫码|二维码|获取验证码|发送验证码|授权登录|继续登录|login|log in|sign[ -]?in|qr(?: code)?|request (?:a )?(?:code|otp)|send (?:a )?(?:code|otp)|authorize sign[ -]?in/i;
const SECRET_TARGET =
  /密码|口令|验证码|动态码|安全码|password|passwd|passcode|\botp\b|captcha|verification code|security code/i;

export type WinkGoBrowserAgentTaskRequest = {
  goal: string;
  startUrl?: string;
  maxSteps?: number;
  conversationId?: string;
  model?: {
    providerId: string;
    model: string;
  };
};

export type WinkGoBrowserAgentTaskStep = {
  number: number;
  action?: WinkGoBrowserActionRequest;
  ok?: boolean;
  message?: string;
  url?: string;
  title?: string;
};

export type WinkGoBrowserAgentTaskResult = {
  ok: boolean;
  taskId: string;
  status: 'completed' | 'blocked' | 'failed' | 'stalled' | 'max_steps';
  message: string;
  steps: WinkGoBrowserAgentTaskStep[];
  finalPage?: Pick<WinkGoBrowserPageSnapshot, 'url' | 'title'>;
};

export type WinkGoBrowserAgentTaskOptions = {
  signal?: AbortSignal;
  onProgress?: (event: {
    phase: 'observing' | 'planning' | 'acting';
    stepCount: number;
    url?: string;
    title?: string;
    message?: string;
  }) => void;
};

let activeTaskId: string | null = null;

class WinkGoBrowserTaskAbort extends Error {}

const waitForBrowserTask = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) return Promise.reject(new WinkGoBrowserTaskAbort());
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new WinkGoBrowserTaskAbort());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
};

const cleanText = (value: unknown, maximum = 500): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';

const domainOf = (value?: string): string => {
  try {
    return new URL(value || '').hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

const skillHintsFor = (goal: string, snapshot: WinkGoBrowserPageSnapshot) => {
  const goalText = goal.toLowerCase();
  const pageDomain = domainOf(snapshot.url);
  return listWinkGoBrowserSkills()
    .map((skill) => {
      const haystack = `${skill.name} ${skill.description} ${skill.capability || ''} ${skill.domain}`.toLowerCase();
      const goalTokens = goalText.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 2);
      const tokenScore = goalTokens.filter((token) => haystack.includes(token)).length;
      const domainScore =
        pageDomain && (skill.domain === pageDomain || domainOf(skill.entryUrl) === pageDomain) ? 10 : 0;
      return { skill, score: domainScore + tokenScore };
    })
    .filter(({ score }) => score > 0)
    .toSorted((left, right) => right.score - left.score)
    .slice(0, 4)
    .map(({ skill }) => ({
      name: skill.name,
      description: skill.description,
      domain: skill.domain,
      capability: skill.capability,
      entryUrl: skill.entryUrl,
    }));
};

const riskReason = (
  action: WinkGoBrowserActionRequest,
  snapshot: WinkGoBrowserPageSnapshot,
  loginAutomationEnabled: boolean
): string => {
  const target = action.ref
    ? snapshot.elements?.find((element) => element.ref === action.ref)
    : snapshot.elements?.find(
        (element) => (!action.role || element.role === action.role) && (!action.name || element.name === action.name)
      );
  const targetText = [action.name, target?.name, target?.text, target?.placeholder].filter(Boolean).join(' ');
  const pageContext = [snapshot.url, snapshot.title, snapshot.text?.slice(0, 1_500), targetText]
    .filter(Boolean)
    .join(' ');
  const loginContext = LOGIN_TARGET.test(pageContext);
  if (action.action === 'fill' && SECRET_TARGET.test(targetText)) {
    return '登录密码、OTP 或验证码必须由用户本人在网页中输入';
  }
  if (ALWAYS_RISKY_TARGET.test(targetText)) return `即将操作敏感控件：${cleanText(targetText, 120)}`;
  if (loginContext && !loginAutomationEnabled) return '浏览器登录与扫码权限尚未在设置中开启';
  if (action.action === 'submit' && !(loginAutomationEnabled && loginContext)) return '即将提交网页表单';
  return '';
};

const finalPage = (snapshot?: WinkGoBrowserPageSnapshot) =>
  snapshot ? { url: snapshot.url, title: snapshot.title } : undefined;

export const runWinkGoBrowserAgentTask = async (
  request: WinkGoBrowserAgentTaskRequest,
  options: WinkGoBrowserAgentTaskOptions = {}
): Promise<WinkGoBrowserAgentTaskResult> => {
  const taskId = randomUUID();
  const goal = cleanText(request.goal, 2_000);
  if (!goal) return { ok: false, taskId, status: 'failed', message: '浏览器任务目标不能为空。', steps: [] };
  if (activeTaskId) {
    return { ok: false, taskId, status: 'blocked', message: '已有自主浏览器任务正在运行。', steps: [] };
  }
  if (options.signal?.aborted) {
    return { ok: false, taskId, status: 'blocked', message: '浏览器任务已停止。', steps: [] };
  }

  activeTaskId = taskId;
  const loginPermission = await getWinkGoBrowserLoginPermission().catch(() => ({ enabled: false }));
  const startedAt = Date.now();
  const maxSteps = Math.max(1, Math.min(MAX_STEPS, Math.trunc(request.maxSteps || DEFAULT_MAX_STEPS)));
  const steps: WinkGoBrowserAgentTaskStep[] = [];
  let snapshot: WinkGoBrowserPageSnapshot | undefined;
  const repeatedActions = new Map<string, number>();
  const taskAbortController = new AbortController();
  let deadlineExpired = false;
  const abortFromCaller = (): void => taskAbortController.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  const deadline = setTimeout(() => {
    deadlineExpired = true;
    taskAbortController.abort();
  }, TASK_DEADLINE_MS);
  deadline.unref?.();
  const inspectPage = (maximumElements: number) =>
    request.conversationId
      ? inspectWinkGoBrowserPage(maximumElements, request.conversationId, { includeScreenshot: true })
      : inspectWinkGoBrowserPage(maximumElements, undefined, { includeScreenshot: true });
  const executeAction = (action: WinkGoBrowserActionRequest) =>
    request.conversationId
      ? executeWinkGoBrowserAction(action, request.conversationId)
      : executeWinkGoBrowserAction(action);
  try {
    if (request.startUrl) {
      const navigation = await waitForBrowserTask(
        executeAction({ action: 'navigate', url: request.startUrl }),
        taskAbortController.signal
      );
      steps.push({
        number: steps.length + 1,
        action: { action: 'navigate', url: request.startUrl },
        ok: navigation.ok,
        message: navigation.message,
        url: navigation.url,
        title: navigation.title,
      });
      if (!navigation.ok) {
        return { ok: false, taskId, status: 'failed', message: navigation.message || '无法打开起始网页。', steps };
      }
    }

    for (let turn = 0; turn < maxSteps && Date.now() - startedAt < TASK_DEADLINE_MS; turn += 1) {
      if (options.signal?.aborted) {
        return {
          ok: false,
          taskId,
          status: 'blocked',
          message: '浏览器任务已停止。',
          steps,
          finalPage: finalPage(snapshot),
        };
      }
      options.onProgress?.({ phase: 'observing', stepCount: steps.length, url: snapshot?.url, title: snapshot?.title });
      // oxlint-disable-next-line no-await-in-loop -- each decision must use the page produced by the previous action
      snapshot = await waitForBrowserTask(inspectPage(180), taskAbortController.signal);
      if (!snapshot.ok) {
        return {
          ok: false,
          taskId,
          status: 'failed',
          message: snapshot.message || '无法读取内置浏览器。',
          steps,
          finalPage: finalPage(snapshot),
        };
      }
      options.onProgress?.({
        phase: 'planning',
        stepCount: steps.length,
        url: snapshot.url,
        title: snapshot.title,
      });
      // oxlint-disable-next-line no-await-in-loop -- autonomous browser decisions are deliberately sequential
      const decision = await waitForBrowserTask(
        planWinkGoBrowserAgentStep({
          goal,
          snapshot,
          history: steps,
          skillHints: skillHintsFor(goal, snapshot),
          model: request.model,
          loginAutomationEnabled: loginPermission.enabled,
        }),
        taskAbortController.signal
      );
      if (decision.status === 'done') {
        return {
          ok: true,
          taskId,
          status: 'completed',
          message: decision.message,
          steps,
          finalPage: finalPage(snapshot),
        };
      }
      if (options.signal?.aborted) {
        return {
          ok: false,
          taskId,
          status: 'blocked',
          message: '浏览器任务已停止。',
          steps,
          finalPage: finalPage(snapshot),
        };
      }
      if (decision.status === 'blocked') {
        return {
          ok: false,
          taskId,
          status: 'blocked',
          message: decision.message,
          steps,
          finalPage: finalPage(snapshot),
        };
      }
      options.onProgress?.({
        phase: 'acting',
        stepCount: steps.length,
        url: snapshot.url,
        title: snapshot.title,
        message: decision.message,
      });
      if (decision.status === 'failed' || !decision.action) {
        return {
          ok: false,
          taskId,
          status: 'failed',
          message: decision.message,
          steps,
          finalPage: finalPage(snapshot),
        };
      }
      if (decision.action.ref && !snapshot.elements?.some((element) => element.ref === decision.action?.ref)) {
        steps.push({
          number: steps.length + 1,
          action: decision.action,
          ok: false,
          message: '规划器引用了过期页面元素，已重新观察页面。',
          url: snapshot.url,
          title: snapshot.title,
        });
        continue;
      }
      const risky = riskReason(decision.action, snapshot, loginPermission.enabled);
      if (risky) {
        return {
          ok: false,
          taskId,
          status: 'blocked',
          message: `${risky}，需要用户明确确认后再继续。`,
          steps,
          finalPage: finalPage(snapshot),
        };
      }
      const signature = JSON.stringify({ url: snapshot.url, action: decision.action });
      const repeated = (repeatedActions.get(signature) || 0) + 1;
      repeatedActions.set(signature, repeated);
      if (repeated >= 3) {
        return {
          ok: false,
          taskId,
          status: 'stalled',
          message: '自主浏览器连续重复同一动作，已停止以避免死循环。',
          steps,
          finalPage: finalPage(snapshot),
        };
      }
      // oxlint-disable-next-line no-await-in-loop -- actions form one visible, ordered browser trajectory
      const execution = await waitForBrowserTask(executeAction(decision.action), taskAbortController.signal);
      steps.push({
        number: steps.length + 1,
        action: decision.action,
        ok: execution.ok,
        message: execution.message || decision.message,
        url: execution.url,
        title: execution.title,
      });
      // Let navigation and reactive frontends settle before the next observation.
      // oxlint-disable-next-line no-await-in-loop -- bounded pacing prevents stale snapshots
      await new Promise((resolve) => setTimeout(resolve, execution.ok ? 450 : 180));
    }
    snapshot = await waitForBrowserTask(inspectPage(80), taskAbortController.signal).catch((): undefined => undefined);
    return {
      ok: false,
      taskId,
      status: 'max_steps',
      message: `已执行 ${steps.length} 个动作，但在限制内尚未验证完成。`,
      steps,
      finalPage: finalPage(snapshot),
    };
  } catch (error) {
    if (error instanceof WinkGoBrowserTaskAbort) {
      return {
        ok: false,
        taskId,
        status: deadlineExpired ? 'failed' : 'blocked',
        message: deadlineExpired ? '自主浏览器任务执行超时，已停止并释放控制权。' : '浏览器任务已停止。',
        steps,
        finalPage: finalPage(snapshot),
      };
    }
    throw error;
  } finally {
    clearTimeout(deadline);
    options.signal?.removeEventListener('abort', abortFromCaller);
    activeTaskId = null;
  }
};
