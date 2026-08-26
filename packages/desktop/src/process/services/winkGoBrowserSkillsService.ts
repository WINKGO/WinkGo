/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  WinkGoBrowserRecorderStatus,
  WinkGoBrowserSkillDetail,
  WinkGoBrowserSkillItem,
  WinkGoBrowserSkillOperationResult,
  WinkGoBrowserSkillRunRequest,
  WinkGoBrowserSkillSaveRequest,
  WinkGoBrowserSkillUpdateStepsRequest,
  WinkGoBrowserWorkflowParameter,
  WinkGoBrowserWorkflowStep,
} from '@/common/adapter/ipcBridge';
import { app, webContents, type Event as ElectronEvent, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getCdpBridgeHandle } from '@process/utils/cdpBridgeRegistry';
import { winkGoCloudAuthService } from './WinkGoCloudAuthService';
import {
  executeWinkGoBrowserAction,
  inspectWinkGoBrowserPage,
  type WinkGoBrowserPageSnapshot,
} from './winkGoBrowserControlService';
import {
  createLocalWinkGoBrowserSkillDistillation,
  distillWinkGoBrowserTrace,
  repairWinkGoBrowserStepWithAi,
  type WinkGoBrowserOutcomeCheck,
  type WinkGoBrowserSkillDistillation,
} from './winkGoBrowserSkillAiService';

const RECORD_MESSAGE_PREFIX = '__WINKGO_BROWSER_SKILL_STEP__:';
const WORKFLOW_SCHEMA_VERSION = 2;
const SUPPORTED_WORKFLOW_SCHEMA_VERSIONS = new Set([1, WORKFLOW_SCHEMA_VERSION]);
const MAX_RECORDED_STEPS = 400;
const MAX_TEXT_LENGTH = 500;
const STEP_DELAY_MS = 180;
const REPLAY_TARGET_TIMEOUT_MS = 3_000;
const REPLAY_RECOVERY_TIMEOUT_MS = 2_500;
const RECORDER_SNAPSHOT_TIMEOUT_MS = 1_500;
const RECORDER_DISTILLATION_TIMEOUT_MS = 10_000;

type StoredBrowserWorkflow = {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  domain: string;
  entryUrl: string;
  createdAt: string;
  updatedAt: string;
  parameters: WinkGoBrowserWorkflowParameter[];
  steps: WinkGoBrowserWorkflowStep[];
  traceId?: string;
  capability?: string;
  intent?: string;
  triggerPhrases?: string[];
  guideSteps?: string[];
  outcomeChecks?: WinkGoBrowserOutcomeCheck[];
  distillation?: Pick<WinkGoBrowserSkillDistillation, 'aiEnhanced' | 'providerName' | 'model' | 'warning'>;
};

type RecordedPageEvent = {
  type?: unknown;
  selector?: unknown;
  testId?: unknown;
  role?: unknown;
  accessibleName?: unknown;
  fallbackText?: unknown;
  value?: unknown;
  sensitive?: unknown;
  label?: unknown;
  url?: unknown;
};

type ActiveRecording = {
  startedAt: number;
  steps: WinkGoBrowserWorkflowStep[];
  parameters: WinkGoBrowserWorkflowParameter[];
  startPage?: WinkGoBrowserPageSnapshot;
  target?: WebContents;
  detachTarget?: () => void;
  detachAttachmentListener?: () => void;
};

let activeRecording: ActiveRecording | null = null;
let replayingSkillId: string | null = null;
let distilling = false;
let statusMessage = '';

const sleep = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs));

const resolveWithin = <T>(promise: Promise<T>, timeoutMs: number, fallback: () => T): Promise<T> =>
  new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback());
    }, timeoutMs);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback());
      }
    );
  });

const captureRecorderPage = (): Promise<WinkGoBrowserPageSnapshot | undefined> =>
  resolveWithin(
    inspectWinkGoBrowserPage(100).then((snapshot) => (snapshot.ok ? snapshot : undefined)),
    RECORDER_SNAPSHOT_TIMEOUT_MS,
    (): undefined => undefined
  );

const cleanText = (value: unknown, maximum = MAX_TEXT_LENGTH): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';

const SENSITIVE_URL_KEY = /password|passwd|passcode|token|secret|authorization|auth.?code|otp|session|jwt|api.?key/i;

export const sanitizeRecordedBrowserUrl = (value: string): string => {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return parsed.href === 'about:blank' ? parsed.href : '';
    parsed.username = '';
    parsed.password = '';
    const safeSearchParams = new URLSearchParams();
    for (const [key, parameterValue] of parsed.searchParams) {
      if (!SENSITIVE_URL_KEY.test(key)) safeSearchParams.append(key, parameterValue);
    }
    parsed.search = safeSearchParams.toString();
    if (SENSITIVE_URL_KEY.test(parsed.hash) || parsed.hash.length > 256) parsed.hash = '';
    return parsed.toString().slice(0, 2_048);
  } catch {
    return '';
  }
};

export const toSafeBrowserSkillId = (value: string): string => {
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalized || 'browser-skill';
};

const currentProfileId = (): string => {
  try {
    const accountId = winkGoCloudAuthService.getSession().user?.id;
    return toSafeBrowserSkillId(accountId || 'local');
  } catch {
    return 'local';
  }
};

export const resolveBrowserSkillsRoot = (): string =>
  path.join(app.getPath('userData'), 'winkgo-browser-skills', 'profiles', currentProfileId(), 'skills');

const isPathInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const readJsonFile = <T>(filePath: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

const getAttachedBrowser = (): WebContents | null => {
  const id = getCdpBridgeHandle()?.attachedWebContentsId() ?? null;
  if (id === null) return null;
  const contents = webContents.fromId(id);
  return contents && !contents.isDestroyed() && contents.getType() === 'webview' ? contents : null;
};

const getCurrentUrl = (): string => getAttachedBrowser()?.getURL() || '';

export const getWinkGoBrowserRecorderStatus = (): WinkGoBrowserRecorderStatus => ({
  phase: activeRecording ? 'recording' : distilling ? 'distilling' : replayingSkillId ? 'replaying' : 'idle',
  browserAttached: Boolean(getAttachedBrowser()),
  currentUrl: getCurrentUrl(),
  recordedStepCount: activeRecording?.steps.length ?? 0,
  ...(activeRecording ? { startedAt: activeRecording.startedAt } : {}),
  ...(replayingSkillId ? { activeSkillId: replayingSkillId } : {}),
  ...(statusMessage ? { message: statusMessage } : {}),
});

const result = (ok: boolean, message?: string, skill?: WinkGoBrowserSkillItem): WinkGoBrowserSkillOperationResult => {
  statusMessage = message || '';
  return {
    ok,
    status: getWinkGoBrowserRecorderStatus(),
    ...(message ? { message } : {}),
    ...(skill ? { skill } : {}),
  };
};

const makeStep = (
  step: Omit<WinkGoBrowserWorkflowStep, 'id' | 'recordedAt'> & { recordedAt?: number }
): WinkGoBrowserWorkflowStep => ({
  ...step,
  id: randomUUID(),
  recordedAt: step.recordedAt ?? Date.now(),
});

const appendStep = (recording: ActiveRecording, step: WinkGoBrowserWorkflowStep): void => {
  if (recording.steps.length >= MAX_RECORDED_STEPS) return;
  let previous = recording.steps.at(-1);
  // Clicking a submit button is immediately followed by the form's submit
  // event. Replaying both sends the form twice, so retain only the semantic
  // submit operation when both belong to the same user gesture.
  if (step.type === 'submit' && previous?.type === 'click' && step.recordedAt - previous.recordedAt < 1_500) {
    recording.steps.pop();
    previous = recording.steps.at(-1);
  }
  if (step.type === 'navigate' && previous?.type === 'navigate' && previous.url === step.url) return;
  if (
    (step.type === 'input' || step.type === 'select') &&
    previous?.type === step.type &&
    previous.selector === step.selector
  ) {
    recording.steps[recording.steps.length - 1] = step;
    return;
  }
  if (
    step.type === 'click' &&
    previous?.type === 'click' &&
    previous.selector === step.selector &&
    step.recordedAt - previous.recordedAt < 350
  ) {
    return;
  }
  recording.steps.push(step);
};

const allocateParameter = (recording: ActiveRecording, label: string, secret: boolean): string => {
  const prefix = secret ? 'secret' : 'input';
  const key = `${prefix}_${recording.parameters.filter((item) => item.secret === secret).length + 1}`;
  recording.parameters.push({
    key,
    label: cleanText(label, 80) || (secret ? 'Secret value' : 'Input value'),
    secret,
    required: secret,
  });
  return key;
};

const parseRecordedEvent = (recording: ActiveRecording, message: string): void => {
  if (!message.startsWith(RECORD_MESSAGE_PREFIX)) return;
  let payload: RecordedPageEvent;
  try {
    payload = JSON.parse(message.slice(RECORD_MESSAGE_PREFIX.length)) as RecordedPageEvent;
  } catch {
    return;
  }

  const type = cleanText(payload.type, 16);
  const selector = cleanText(payload.selector, 1_000);
  const testId = cleanText(payload.testId, 120);
  const role = cleanText(payload.role, 60);
  const accessibleName = cleanText(payload.accessibleName, 240);
  const fallbackText = cleanText(payload.fallbackText, 160);
  const value = cleanText(payload.value);
  if (!['click', 'input', 'select', 'submit'].includes(type) || !selector) return;

  if (type === 'input' || type === 'select') {
    const secret = payload.sensitive === true;
    const previous = recording.steps.at(-1);
    const parameterKey =
      previous?.type === type && previous.selector === selector && previous.parameterKey
        ? previous.parameterKey
        : allocateParameter(recording, cleanText(payload.label, 80) || fallbackText, secret);
    appendStep(
      recording,
      makeStep({
        type,
        selector,
        ...(testId ? { testId } : {}),
        ...(role ? { role } : {}),
        ...(accessibleName ? { accessibleName } : {}),
        ...(fallbackText ? { fallbackText } : {}),
        ...(!secret && value ? { value } : {}),
        parameterKey,
      })
    );
    return;
  }

  const interactionType: 'click' | 'submit' = type === 'submit' ? 'submit' : 'click';
  appendStep(
    recording,
    makeStep({
      type: interactionType,
      selector,
      ...(testId ? { testId } : {}),
      ...(role ? { role } : {}),
      ...(accessibleName ? { accessibleName } : {}),
      ...(fallbackText ? { fallbackText } : {}),
    })
  );
};

const buildRecorderInjection = (): string => `
(() => {
  const PREFIX = ${JSON.stringify(RECORD_MESSAGE_PREFIX)};
  const existing = window.__winkgoBrowserSkillRecorder;
  if (existing && typeof existing.dispose === 'function') existing.dispose();
  const listeners = [];
  const emit = (payload) => console.debug(PREFIX + JSON.stringify(payload));
  const listen = (name, handler) => {
    document.addEventListener(name, handler, true);
    listeners.push(() => document.removeEventListener(name, handler, true));
  };
  const text = (value, limit = 160) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
  const targetElement = (target) => target instanceof Element
    ? target.closest('button,a,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]') || target
    : null;
  const attr = (element, name) => text(element.getAttribute(name), 120);
  const escape = (value) => CSS.escape(String(value));
  const selector = (element) => {
    const testId = attr(element, 'data-testid') || attr(element, 'data-test') || attr(element, 'data-cy');
    if (testId) return '[data-testid="' + escape(testId) + '"],[data-test="' + escape(testId) + '"],[data-cy="' + escape(testId) + '"]';
    const name = attr(element, 'name');
    if (name) return element.tagName.toLowerCase() + '[name="' + escape(name) + '"]';
    const aria = attr(element, 'aria-label');
    if (aria) return element.tagName.toLowerCase() + '[aria-label="' + escape(aria) + '"]';
    const id = text(element.id, 100);
    if (id && !/\\d{5,}|[a-f0-9]{12,}/i.test(id)) return '#' + CSS.escape(id);
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      const siblings = current.parentElement
        ? Array.from(current.parentElement.children).filter((item) => item.tagName === current.tagName)
        : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      parts.unshift(part);
      current = current.parentElement;
      if (current === document.body) {
        parts.unshift('body');
        break;
      }
    }
    return parts.join(' > ');
  };
  const labelFor = (element) => {
    const explicit = element.id ? document.querySelector('label[for="' + CSS.escape(element.id) + '"]') : null;
    return text(attr(element, 'aria-label') || attr(element, 'placeholder') || explicit?.textContent || element.textContent, 80);
  };
  const roleFor = (element) => {
    const explicit = attr(element, 'role');
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    if (tag === 'a' && element.hasAttribute('href')) return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'input') {
      const type = attr(element, 'type').toLowerCase() || 'text';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      return 'textbox';
    }
    return element.hasAttribute('contenteditable') ? 'textbox' : '';
  };
  const locatorIdentity = (element) => ({
    testId: attr(element, 'data-testid') || attr(element, 'data-test') || attr(element, 'data-cy'),
    role: roleFor(element),
    accessibleName: labelFor(element)
  });
  const isSensitive = (element) => {
    const signature = [
      element.getAttribute('type'), element.getAttribute('name'), element.getAttribute('id'),
      element.getAttribute('autocomplete'), element.getAttribute('aria-label'), element.getAttribute('placeholder')
    ].join(' ').toLowerCase();
    return element.getAttribute('type') === 'password' ||
      /password|passwd|passcode|token|secret|authorization|auth.?code|otp|one.?time|验证码|密码|令牌|cvv|cvc|card.?number/.test(signature);
  };
  listen('click', (event) => {
    const element = targetElement(event.target);
    if (!element) return;
    const tag = element.tagName.toLowerCase();
    const inputType = tag === 'input' ? attr(element, 'type').toLowerCase() || 'text' : '';
    const changeOwnsThisInteraction = tag === 'select' || tag === 'textarea' || element.hasAttribute('contenteditable') ||
      (tag === 'input' && !['button', 'submit', 'reset', 'checkbox', 'radio'].includes(inputType));
    if (changeOwnsThisInteraction) return;
    emit({
      type: 'click',
      selector: selector(element),
      ...locatorIdentity(element),
      fallbackText: text(element.textContent || element.getAttribute('aria-label'))
    });
  });
  listen('change', (event) => {
    const element = targetElement(event.target);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return;
    emit({
      type: element instanceof HTMLSelectElement ? 'select' : 'input',
      selector: selector(element),
      ...locatorIdentity(element),
      fallbackText: labelFor(element),
      label: labelFor(element),
      sensitive: isSensitive(element),
      value: isSensitive(element) ? '' : text(element.value, ${MAX_TEXT_LENGTH})
    });
  });
  listen('submit', (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (form) emit({
      type: 'submit',
      selector: selector(form),
      ...locatorIdentity(form),
      fallbackText: text(form.getAttribute('aria-label'))
    });
  });
  window.__winkgoBrowserSkillRecorder = {
    dispose: () => {
      listeners.splice(0).forEach((remove) => remove());
      delete window.__winkgoBrowserSkillRecorder;
    }
  };
  return true;
})()`;

const injectRecorder = async (recording: ActiveRecording): Promise<void> => {
  const target = recording.target;
  if (!target || target.isDestroyed()) return;
  try {
    await target.executeJavaScript(buildRecorderInjection(), true);
  } catch {
    statusMessage = '当前网页暂时不允许录制，请刷新页面后重试。';
  }
};

const detachRecordingTarget = (recording: ActiveRecording): void => {
  recording.detachTarget?.();
  recording.detachTarget = undefined;
  recording.target = undefined;
};

const attachRecordingTarget = async (recording: ActiveRecording, target: WebContents): Promise<void> => {
  if (recording.target?.id === target.id) {
    await injectRecorder(recording);
    return;
  }
  detachRecordingTarget(recording);
  recording.target = target;

  const onConsoleMessage = (_event: ElectronEvent, _level: number, message: string): void => {
    parseRecordedEvent(recording, message);
  };
  const onNavigate = (_event: ElectronEvent, url: string): void => {
    const normalizedUrl = sanitizeRecordedBrowserUrl(url);
    if (normalizedUrl) appendStep(recording, makeStep({ type: 'navigate', url: normalizedUrl }));
  };
  const onDomReady = (): void => {
    void injectRecorder(recording);
  };
  const onDestroyed = (): void => {
    detachRecordingTarget(recording);
  };

  target.on('console-message', onConsoleMessage);
  target.on('did-navigate', onNavigate);
  target.on('did-navigate-in-page', onNavigate);
  target.on('dom-ready', onDomReady);
  target.once('destroyed', onDestroyed);
  recording.detachTarget = () => {
    if (target.isDestroyed()) return;
    target.removeListener('console-message', onConsoleMessage);
    target.removeListener('did-navigate', onNavigate);
    target.removeListener('did-navigate-in-page', onNavigate);
    target.removeListener('dom-ready', onDomReady);
    target.removeListener('destroyed', onDestroyed);
    void target
      .executeJavaScript('window.__winkgoBrowserSkillRecorder?.dispose?.(); true;', true)
      .catch((): void => {});
  };

  const currentUrl = sanitizeRecordedBrowserUrl(target.getURL());
  if (currentUrl) appendStep(recording, makeStep({ type: 'navigate', url: currentUrl }));
  await injectRecorder(recording);
};

export const startWinkGoBrowserRecording = async (): Promise<WinkGoBrowserSkillOperationResult> => {
  if (activeRecording) return result(false, '已有网页技能正在录制。');
  if (distilling) return result(false, 'WINK GO AI 正在生成网页技能，请稍候。');
  if (replayingSkillId) return result(false, '请等待当前网页技能执行完成。');
  const target = getAttachedBrowser();
  if (!target) return result(false, '请先在 WINK GO 中打开一个浏览器标签页。');

  const recording: ActiveRecording = {
    startedAt: Date.now(),
    steps: [],
    parameters: [],
  };
  activeRecording = recording;
  await attachRecordingTarget(recording, target);
  // A complex page can keep executeJavaScript pending for a long time. The
  // recorder must become usable immediately, so page context is best-effort
  // metadata rather than part of the start-recording handshake.
  void captureRecorderPage().then((snapshot) => {
    if (activeRecording === recording) recording.startPage = snapshot;
  });

  const bridge = getCdpBridgeHandle();
  recording.detachAttachmentListener = bridge?.onAttached((webContentsId) => {
    if (activeRecording !== recording || webContentsId === null) return;
    const nextTarget = webContents.fromId(webContentsId);
    if (nextTarget && !nextTarget.isDestroyed() && nextTarget.getType() === 'webview') {
      void attachRecordingTarget(recording, nextTarget);
    }
  });
  return result(true, '录制已开始；请在浏览器中完成一次完整流程。');
};

const stopActiveRecording = (): ActiveRecording | null => {
  const recording = activeRecording;
  if (!recording) return null;
  activeRecording = null;
  recording.detachAttachmentListener?.();
  detachRecordingTarget(recording);
  return recording;
};

const domainFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return 'browser';
  }
};

const compactRecordedSteps = (steps: WinkGoBrowserWorkflowStep[]): WinkGoBrowserWorkflowStep[] => {
  const compacted: WinkGoBrowserWorkflowStep[] = [];
  for (const step of steps) {
    const previous = compacted.at(-1);
    if (
      step.type === 'navigate' &&
      previous?.type === 'navigate' &&
      sanitizeRecordedBrowserUrl(previous.url || '') === sanitizeRecordedBrowserUrl(step.url || '')
    ) {
      continue;
    }
    if (
      (step.type === 'input' || step.type === 'select') &&
      previous?.type === step.type &&
      previous.selector === step.selector
    ) {
      compacted[compacted.length - 1] = step;
      continue;
    }
    compacted.push(step);
  }
  return compacted;
};

const applyDistillation = (
  steps: WinkGoBrowserWorkflowStep[],
  parameters: WinkGoBrowserWorkflowParameter[],
  distillation: WinkGoBrowserSkillDistillation
): { steps: WinkGoBrowserWorkflowStep[]; parameters: WinkGoBrowserWorkflowParameter[] } => {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const distilledSteps = distillation.keptStepIds.flatMap((id) => {
    const step = byId.get(id);
    return step ? [step] : [];
  });
  const firstNavigation = steps.find((step) => step.type === 'navigate');
  if (firstNavigation && !distilledSteps.some((step) => step.id === firstNavigation.id)) {
    distilledSteps.unshift(firstNavigation);
  }
  const retainedParameterKeys = new Set(distilledSteps.map((step) => step.parameterKey).filter(Boolean));
  return {
    steps: distilledSteps.length > 0 ? distilledSteps : steps,
    parameters: parameters
      .filter((parameter) => retainedParameterKeys.has(parameter.key))
      .map((parameter) => ({
        ...parameter,
        label: distillation.parameterLabels[parameter.key] || parameter.label,
      })),
  };
};

const toSkillItem = (workflow: StoredBrowserWorkflow): WinkGoBrowserSkillItem => ({
  id: workflow.id,
  name: workflow.name,
  description: workflow.description,
  domain: workflow.domain,
  entryUrl: workflow.entryUrl,
  ...(workflow.capability ? { capability: workflow.capability } : {}),
  ...(workflow.distillation ? { aiEnhanced: workflow.distillation.aiEnhanced } : {}),
  ...(workflow.distillation?.model ? { aiModel: workflow.distillation.model } : {}),
  stepCount: workflow.steps.length,
  parameters: workflow.parameters,
  createdAt: workflow.createdAt,
  updatedAt: workflow.updatedAt,
});

const buildSkillDocument = (workflow: StoredBrowserWorkflow): string =>
  [
    '---',
    `name: ${JSON.stringify(workflow.id)}`,
    `description: ${JSON.stringify(workflow.description || workflow.name)}`,
    '---',
    '',
    `# ${workflow.name}`,
    '',
    workflow.description || `Replay the recorded browser workflow for ${workflow.domain}.`,
    '',
    '## When to use',
    '',
    ...(workflow.triggerPhrases?.length
      ? workflow.triggerPhrases.map((phrase) => `- ${phrase}`)
      : [`- 当用户要求执行“${workflow.name}”或同义网页流程时。`]),
    '',
    '## Execution',
    '',
    `Run this local workflow through the WINK GO browser-skill runner with skill id \`${workflow.id}\`.`,
    'The desktop browser runner executes the deterministic path first and may use the configured WINK GO AI only to repair a changed page target.',
    'Ask the user for required parameters before execution. Secret parameters must never be written to disk or logs.',
    '',
    '## Parameters',
    '',
    ...(workflow.parameters.length > 0
      ? workflow.parameters.map(
          (parameter) =>
            `- \`${parameter.key}\`: ${parameter.label}${parameter.secret ? ' (secret, runtime only)' : ''}`
        )
      : ['- None']),
    '',
    '## Verification',
    '',
    ...(workflow.outcomeChecks?.length
      ? workflow.outcomeChecks.map((check) => `- ${check.type}: ${check.value}`)
      : ['- Confirm that the final page is loaded and the requested action completed.']),
    '',
  ].join('\n');

const buildTraceGuideDocument = (workflow: StoredBrowserWorkflow): string =>
  [
    `# ${workflow.name} — Trace Guide`,
    '',
    `- Domain: ${workflow.domain}`,
    `- Capability: ${workflow.capability || workflow.id}`,
    `- Entry: ${workflow.entryUrl}`,
    `- Trace: ${workflow.traceId || 'legacy'}`,
    `- AI distilled: ${workflow.distillation?.aiEnhanced ? 'yes' : 'no'}`,
    ...(workflow.distillation?.model ? [`- Model: ${workflow.distillation.model}`] : []),
    '',
    '## Reusable procedure',
    '',
    ...(workflow.guideSteps?.length
      ? workflow.guideSteps.map((step, index) => `${index + 1}. ${step}`)
      : workflow.steps.map((step, index) => {
          const target = step.url || step.accessibleName || step.fallbackText || step.role || 'page target';
          return `${index + 1}. ${step.type}: ${target}`;
        })),
    '',
    '## Recovery',
    '',
    '- Prefer test id, accessible role and name over generated CSS structure.',
    '- If the deterministic locator fails, inspect the current page and select one unique semantic match.',
    '- WINK GO AI may choose among current, sanitized element references; it must not invent a selector.',
    '- Stop and report the failed step when no unique safe match exists.',
    '',
  ].join('\n');

const traceDocument = (workflow: StoredBrowserWorkflow): Record<string, unknown> => ({
  schema_version: 'winkgo_browser_trace_v1',
  trace_id: workflow.traceId,
  started_at: workflow.createdAt,
  ended_at: workflow.updatedAt,
  label: workflow.name,
  description: workflow.description,
  domain: workflow.domain,
  capability: workflow.capability,
  summary: {
    event_count: workflow.steps.length,
    parameter_count: workflow.parameters.length,
    ai_distilled: workflow.distillation?.aiEnhanced || false,
  },
  events: workflow.steps.map((step, index) => ({
    event_id: step.id,
    timestamp: step.recordedAt,
    sequence: index + 1,
    kind: step.type === 'navigate' ? 'navigation' : 'action',
    action_type: step.type,
    url: step.url,
    target:
      step.type === 'navigate'
        ? undefined
        : {
            selector_kind: step.testId ? 'test-id' : step.role || step.accessibleName ? 'semantic' : 'css',
            test_id: step.testId,
            role: step.role,
            name: step.accessibleName || step.fallbackText,
          },
    parameter_key: step.parameterKey,
    has_recorded_value: step.value !== undefined,
  })),
});

const writeBucketEvidence = (workflow: StoredBrowserWorkflow): void => {
  const profileRoot = path.dirname(resolveBrowserSkillsRoot());
  const bucketRoot = path.join(
    profileRoot,
    'buckets',
    toSafeBrowserSkillId(workflow.domain || 'browser'),
    toSafeBrowserSkillId(workflow.capability || workflow.id)
  );
  fs.mkdirSync(bucketRoot, { recursive: true, mode: 0o700 });
  fs.appendFileSync(
    path.join(bucketRoot, 'evidence.jsonl'),
    `${JSON.stringify({
      trace_id: workflow.traceId,
      skill_id: workflow.id,
      recorded_at: workflow.updatedAt,
      step_count: workflow.steps.length,
      ai_distilled: workflow.distillation?.aiEnhanced || false,
    })}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  fs.writeFileSync(
    path.join(bucketRoot, 'meta.json'),
    `${JSON.stringify(
      {
        schema_version: 1,
        domain: workflow.domain,
        capability: workflow.capability || workflow.id,
        latest_skill_id: workflow.id,
        updated_at: workflow.updatedAt,
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
};

const writeWorkflow = (workflow: StoredBrowserWorkflow, options: { appendEvidence?: boolean } = {}): void => {
  const root = resolveBrowserSkillsRoot();
  const target = path.join(root, workflow.id);
  if (!isPathInside(root, target)) throw new Error('Invalid browser skill path.');
  const temporary = `${target}.${process.pid}.tmp`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(temporary, 'workflow.json'), `${JSON.stringify(workflow, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.writeFileSync(
    path.join(temporary, 'manifest.json'),
    `${JSON.stringify(
      {
        schema_version: WORKFLOW_SCHEMA_VERSION,
        id: workflow.id,
        display_name: workflow.name,
        description: workflow.description,
        domain: workflow.domain,
        entry_url: workflow.entryUrl,
        capability: workflow.capability,
        intent: workflow.intent,
        step_count: workflow.steps.length,
        parameter_keys: workflow.parameters.map((parameter) => parameter.key),
        runner: 'winkgo.browser-skill.v1',
        compact_invocation: {
          command: 'browser.skill.run',
          arguments: ['skill_id', 'parameters'],
        },
        execution_policy: {
          local_only: true,
          deterministic: true,
          ai_repair_on_locator_failure: true,
          send_full_workflow_to_device: false,
        },
        distillation: workflow.distillation,
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  fs.writeFileSync(path.join(temporary, 'SKILL.md'), buildSkillDocument(workflow), { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(path.join(temporary, 'TRACE_GUIDE.md'), buildTraceGuideDocument(workflow), {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.writeFileSync(path.join(temporary, 'trace.json'), `${JSON.stringify(traceDocument(workflow), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.writeFileSync(
    path.join(temporary, 'meta.json'),
    `${JSON.stringify(
      {
        schema_version: WORKFLOW_SCHEMA_VERSION,
        trace_id: workflow.traceId,
        domain: workflow.domain,
        capability: workflow.capability,
        trigger_phrases: workflow.triggerPhrases || [],
        outcome_checks: workflow.outcomeChecks || [],
        distillation: workflow.distillation,
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  fs.mkdirSync(root, { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(temporary, target);
  if (options.appendEvidence !== false) writeBucketEvidence(workflow);
};

export const stopAndSaveWinkGoBrowserRecording = async (
  request: WinkGoBrowserSkillSaveRequest
): Promise<WinkGoBrowserSkillOperationResult> => {
  const name = cleanText(request.name, 80);
  if (!name) return result(false, '请填写技能名称。');
  if (!activeRecording) return result(false, '当前没有正在录制的网页技能。');
  const recording = stopActiveRecording();
  if (!recording) return result(false, '当前没有正在录制的网页技能。');
  if (recording.steps.length === 0) return result(false, '没有录制到可保存的网页操作。');

  const compactedSteps = compactRecordedSteps(recording.steps);
  const entryUrl = compactedSteps.find((step) => step.type === 'navigate')?.url || '';
  const domain = domainFromUrl(entryUrl);
  distilling = true;
  statusMessage = 'WINK GO AI 正在理解轨迹并生成可复用技能…';
  const endPage = await captureRecorderPage();
  const distillInput = {
    requestedName: name,
    requestedDescription: cleanText(request.description, 240),
    domain,
    entryUrl,
    steps: compactedSteps,
    startPage: recording.startPage,
    endPage,
  };
  let distillation: WinkGoBrowserSkillDistillation;
  try {
    distillation = await resolveWithin(distillWinkGoBrowserTrace(distillInput), RECORDER_DISTILLATION_TIMEOUT_MS, () =>
      createLocalWinkGoBrowserSkillDistillation(distillInput, 'AI 整理超过 10 秒，已先按原始有效步骤保存。')
    );
  } catch (error) {
    return result(false, error instanceof Error ? error.message : 'WINK GO AI 技能生成失败。');
  } finally {
    distilling = false;
  }
  const distilled = applyDistillation(compactedSteps, recording.parameters, distillation);
  const now = new Date().toISOString();
  const id = `${toSafeBrowserSkillId(name)}-${Date.now().toString(36)}`;
  const workflow: StoredBrowserWorkflow = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id,
    name,
    description: cleanText(distillation.description, 500),
    domain,
    entryUrl,
    createdAt: now,
    updatedAt: now,
    parameters: distilled.parameters,
    steps: distilled.steps,
    traceId: `trace-${randomUUID()}`,
    capability: toSafeBrowserSkillId(distillation.capability),
    intent: distillation.intent,
    triggerPhrases: distillation.triggerPhrases,
    guideSteps: distillation.guideSteps,
    outcomeChecks: distillation.outcomeChecks,
    distillation: {
      aiEnhanced: distillation.aiEnhanced,
      ...(distillation.providerName ? { providerName: distillation.providerName } : {}),
      ...(distillation.model ? { model: distillation.model } : {}),
      ...(distillation.warning ? { warning: distillation.warning } : {}),
    },
  };
  try {
    writeWorkflow(workflow);
    writeCompactBrowserSkillRegistry();
    return result(
      true,
      distillation.aiEnhanced
        ? `WINK GO AI 已完成轨迹蒸馏，并保存为可复用技能（${workflow.steps.length} 个有效步骤）。`
        : `技能已保存，但本次未完成 AI 蒸馏：${distillation.warning || '未找到可用模型。'}`,
      toSkillItem(workflow)
    );
  } catch (error) {
    return result(false, error instanceof Error ? error.message : '保存网页技能失败。');
  }
};

export const cancelWinkGoBrowserRecording = async (): Promise<WinkGoBrowserSkillOperationResult> => {
  const recording = stopActiveRecording();
  return recording ? result(true, '已取消本次录制。') : result(false, '当前没有正在录制的网页技能。');
};

export const listWinkGoBrowserSkills = (): WinkGoBrowserSkillItem[] => {
  const root = resolveBrowserSkillsRoot();
  if (!fs.existsSync(root)) return [];
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .flatMap((entry) => {
        const workflow = readJsonFile<StoredBrowserWorkflow>(path.join(root, entry.name, 'workflow.json'));
        if (
          !workflow ||
          !SUPPORTED_WORKFLOW_SCHEMA_VERSIONS.has(workflow.schemaVersion) ||
          workflow.id !== entry.name
        ) {
          return [];
        }
        return [toSkillItem(workflow)];
      })
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  } catch {
    return [];
  }
};

/**
 * Writes a tiny dispatcher index without browser steps. ESP32 and mobile relays
 * only need this file's skill id and parameter keys; the desktop keeps the full
 * workflow private and performs the actual replay.
 */
export function writeCompactBrowserSkillRegistry(): void {
  const skillsRoot = resolveBrowserSkillsRoot();
  const registryRoot = path.dirname(skillsRoot);
  const target = path.join(registryRoot, 'registry.json');
  const temporary = `${target}.${process.pid}.tmp`;
  const skills = listWinkGoBrowserSkills().map((skill) => ({
    skill_id: skill.id,
    name: skill.name,
    domain: skill.domain,
    capability: skill.capability,
    ai_enhanced: skill.aiEnhanced || false,
    parameter_keys: skill.parameters.map((parameter) => parameter.key),
  }));
  fs.mkdirSync(registryRoot, { recursive: true });
  fs.writeFileSync(
    temporary,
    `${JSON.stringify(
      {
        schema_version: 1,
        command: 'browser.skill.run',
        send_full_workflow_to_device: false,
        skills,
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  fs.rmSync(target, { force: true });
  fs.renameSync(temporary, target);
}

const loadWorkflow = (skillId: string): StoredBrowserWorkflow | null => {
  const root = resolveBrowserSkillsRoot();
  const safeId = toSafeBrowserSkillId(skillId);
  if (safeId !== skillId) return null;
  const target = path.join(root, safeId);
  if (!isPathInside(root, target)) return null;
  const workflow = readJsonFile<StoredBrowserWorkflow>(path.join(target, 'workflow.json'));
  return workflow?.id === safeId && SUPPORTED_WORKFLOW_SCHEMA_VERSIONS.has(workflow.schemaVersion) ? workflow : null;
};

export const getWinkGoBrowserSkill = (skillId: string): WinkGoBrowserSkillDetail | null => {
  const workflow = loadWorkflow(skillId);
  return workflow ? { ...toSkillItem(workflow), steps: workflow.steps } : null;
};

export const updateWinkGoBrowserSkillSteps = async (
  request: WinkGoBrowserSkillUpdateStepsRequest
): Promise<WinkGoBrowserSkillOperationResult> => {
  if (activeRecording) return result(false, '请先停止当前录制。');
  if (replayingSkillId === request.skillId) return result(false, '技能执行期间不能修改。');
  const workflow = loadWorkflow(request.skillId);
  if (!workflow) return result(false, '找不到这个网页技能。');
  const stepIds = request.stepIds.filter((stepId): stepId is string => typeof stepId === 'string' && Boolean(stepId));
  if (stepIds.length === 0) return result(false, '网页技能至少需要保留一个步骤。');
  if (stepIds.length > workflow.steps.length || new Set(stepIds).size !== stepIds.length) {
    return result(false, '网页技能步骤顺序无效。');
  }
  const existingSteps = new Map(workflow.steps.map((step) => [step.id, step]));
  const steps = stepIds.flatMap((stepId) => {
    const step = existingSteps.get(stepId);
    return step ? [step] : [];
  });
  if (steps.length !== stepIds.length) return result(false, '网页技能包含未知步骤。');
  const updatedWorkflow: StoredBrowserWorkflow = {
    ...workflow,
    steps,
    entryUrl: steps.find((step) => step.type === 'navigate')?.url || workflow.entryUrl,
    updatedAt: new Date().toISOString(),
  };
  try {
    // Editing the curated replay order updates the generated package, but it
    // must not pretend that the user recorded a second piece of evidence.
    writeWorkflow(updatedWorkflow, { appendEvidence: false });
    writeCompactBrowserSkillRegistry();
    return result(true, '网页技能步骤已更新。', toSkillItem(updatedWorkflow));
  } catch (error) {
    return result(false, error instanceof Error ? error.message : '保存网页技能步骤失败。');
  }
};

const normalizeTargetText = (value: string | undefined): string =>
  value?.replace(/\s+/g, ' ').trim().toLowerCase() || '';

const recoverStepReference = async (step: WinkGoBrowserWorkflowStep): Promise<string | undefined> => {
  const expectedName = normalizeTargetText(step.accessibleName || step.fallbackText);
  if (!expectedName) return undefined;
  const snapshot = await inspectWinkGoBrowserPage(180);
  if (!snapshot.ok || !snapshot.elements) return undefined;
  const roleMatches = snapshot.elements.filter((element) => !step.role || element.role === step.role);
  const exactMatches = roleMatches.filter(
    (element) => normalizeTargetText(element.name || element.text) === expectedName
  );
  if (exactMatches.length === 1) return exactMatches[0].ref;
  if (expectedName.length < 4) return undefined;
  const partialMatches = roleMatches.filter((element) => {
    const candidate = normalizeTargetText(element.name || element.text);
    return candidate.includes(expectedName) || expectedName.includes(candidate);
  });
  return partialMatches.length === 1 ? partialMatches[0].ref : undefined;
};

const replayStep = async (
  target: WebContents,
  step: WinkGoBrowserWorkflowStep,
  parameters: Record<string, string>
): Promise<void> => {
  if (step.type === 'navigate') {
    const safeUrl = sanitizeRecordedBrowserUrl(step.url || '');
    if (!safeUrl) throw new Error('录制步骤缺少安全的网址。');
    const navigation = await executeWinkGoBrowserAction({ action: 'navigate', url: safeUrl, timeoutMs: 15_000 });
    if (!navigation.ok) throw new Error(navigation.message || `无法打开 ${safeUrl}`);
    return;
  }
  const value =
    step.parameterKey && parameters[step.parameterKey] !== undefined ? parameters[step.parameterKey] : step.value || '';
  if (step.parameterKey && step.value === undefined && parameters[step.parameterKey] === undefined) {
    throw new Error(`缺少运行参数：${step.parameterKey}`);
  }
  const testIdSelector = step.testId
    ? `[data-testid="${step.testId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
    : undefined;
  const action = step.type === 'input' ? 'fill' : step.type;
  const execution = await executeWinkGoBrowserAction({
    action,
    selector: testIdSelector || step.selector,
    role: step.role,
    name: step.accessibleName || step.fallbackText,
    value,
    timeoutMs: REPLAY_TARGET_TIMEOUT_MS,
  });
  if (!execution.ok) {
    const recoveredRef = await recoverStepReference(step);
    if (recoveredRef) {
      const recovered = await executeWinkGoBrowserAction({
        action,
        ref: recoveredRef,
        value,
        timeoutMs: REPLAY_RECOVERY_TIMEOUT_MS,
      });
      if (recovered.ok) {
        await sleep(STEP_DELAY_MS);
        return;
      }
    }
    // Browser-BC-style semantic repair: the AI is allowed to choose only one
    // of the current sanitized element refs. It cannot invent JavaScript or a
    // new selector, so execution remains bounded to the visible page.
    const snapshot = await inspectWinkGoBrowserPage(180);
    const aiRecoveredRef = await repairWinkGoBrowserStepWithAi(step, snapshot);
    if (aiRecoveredRef) {
      const repaired = await executeWinkGoBrowserAction({
        action,
        ref: aiRecoveredRef,
        value,
        timeoutMs: REPLAY_RECOVERY_TIMEOUT_MS,
      });
      if (repaired.ok) {
        await sleep(STEP_DELAY_MS);
        return;
      }
    }
    throw new Error(
      `步骤执行失败：${step.accessibleName || step.fallbackText || step.selector || execution.message || step.type}`
    );
  }
  await sleep(STEP_DELAY_MS);
};

const verifyWorkflowOutcomes = async (workflow: StoredBrowserWorkflow): Promise<void> => {
  if (!workflow.outcomeChecks?.length) return;
  const snapshot = await inspectWinkGoBrowserPage(120);
  if (!snapshot.ok) throw new Error(snapshot.message || '无法验证网页技能结果。');
  const failed = workflow.outcomeChecks.find((check) => {
    const expected = normalizeTargetText(check.value);
    if (check.type === 'url_contains') return !normalizeTargetText(snapshot.url).includes(expected);
    if (check.type === 'title_contains') return !normalizeTargetText(snapshot.title).includes(expected);
    return !normalizeTargetText(snapshot.text).includes(expected);
  });
  if (failed) throw new Error(`流程已执行，但结果验证未通过：${failed.type} ${failed.value}`);
};

export const runWinkGoBrowserSkill = async (
  request: WinkGoBrowserSkillRunRequest
): Promise<WinkGoBrowserSkillOperationResult> => {
  if (activeRecording) return result(false, '请先停止当前录制。');
  if (distilling) return result(false, 'WINK GO AI 正在生成网页技能，请稍候。');
  if (replayingSkillId) return result(false, '已有网页技能正在执行。');
  const workflow = loadWorkflow(request.skillId);
  if (!workflow) return result(false, '找不到这个网页技能。');
  const target = getAttachedBrowser();
  if (!target) return result(false, '请先在 WINK GO 中打开一个浏览器标签页。');

  replayingSkillId = workflow.id;
  statusMessage = `正在执行：${workflow.name}`;
  try {
    const parameters = request.parameters ?? {};
    await workflow.steps.reduce(
      (previous, step) => previous.then(() => replayStep(target, step, parameters)),
      Promise.resolve()
    );
    await verifyWorkflowOutcomes(workflow);
    replayingSkillId = null;
    return result(true, `已完成：${workflow.name}`, toSkillItem(workflow));
  } catch (error) {
    replayingSkillId = null;
    return result(false, error instanceof Error ? error.message : '网页技能执行失败。', toSkillItem(workflow));
  }
};

export const removeWinkGoBrowserSkill = async (skillId: string): Promise<WinkGoBrowserSkillOperationResult> => {
  if (replayingSkillId === skillId) return result(false, '技能执行期间不能删除。');
  const root = resolveBrowserSkillsRoot();
  const safeId = toSafeBrowserSkillId(skillId);
  if (safeId !== skillId) return result(false, '无效的技能编号。');
  const target = path.join(root, safeId);
  if (!isPathInside(root, target) || !fs.existsSync(target)) return result(false, '找不到这个网页技能。');
  fs.rmSync(target, { recursive: true, force: true });
  writeCompactBrowserSkillRegistry();
  return result(true, '网页技能已删除。');
};
