/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export type DesktopAutomationPhase =
  | 'idle'
  | 'arming'
  | 'recording'
  | 'replaying'
  | 'ai_takeover'
  | 'paused'
  | 'awaiting_confirmation'
  | 'completed'
  | 'error';

export const DESKTOP_AUTOMATION_OVERLAY_STATUS_CHANNEL = 'winkgo-computer-automation:overlay-status' as const;

export interface DesktopAutomationStatus {
  phase: DesktopAutomationPhase;
  sessionId?: string;
  targetDisplayIds: number[];
  /** Desktop Computer Use keeps a full-display Codex-style frame; deterministic skills may frame only their target. */
  visualScope?: 'display' | 'target';
  /** Global screen coordinates for the Windows target currently being controlled. */
  targetRect?: { x: number; y: number; width: number; height: number };
  /** Safe, display-only action metadata. Input text is deliberately never included. */
  action?: {
    kind: 'observe' | 'click' | 'type' | 'press' | 'hotkey' | 'scroll' | 'wait';
    label?: string;
  };
  /** Global coordinates in the main process; overlay-local after manager translation. */
  /** pulseId is present only for a click; ordinary movement keeps the halo visible without replaying the ripple. */
  pointer?: { x: number; y: number; pulseId?: string };
  message?: string;
  startedAt?: number;
  updatedAt: number;
}

export type DesktopRecorderTarget = {
  hwnd: number;
  pid: number;
  title: string;
  processName: string;
  rect: { x: number; y: number; width: number; height: number };
};

export type DesktopRecorderStatus = DesktopAutomationStatus & {
  target?: DesktopRecorderTarget;
  stepCount: number;
  filteredEventCount: number;
  message?: string;
};

export const WINKGO_DESKTOP_SKILL_RUNNER = 'winkgo.desktop-skill.v1' as const;

export type DesktopSkillSource = 'desktop' | 'island' | 'agent' | 'xiaozhi' | 'esp32';

export type DesktopSkillParameterDefinition = {
  key: string;
  label?: string;
  required: boolean;
  secret: boolean;
};

export type DesktopSkillLocator = {
  automationId?: string;
  controlType?: string;
  name?: string;
  className?: string;
  ocrText?: string;
  relativePoint?: { x: number; y: number };
};

type DesktopSkillStepBase = {
  id: string;
  timeoutMs?: number;
};

export type DesktopSkillStep =
  | (DesktopSkillStepBase & { kind: 'launch_or_focus' })
  | (DesktopSkillStepBase & { kind: 'click'; locator: DesktopSkillLocator })
  | (DesktopSkillStepBase & {
      kind: 'input';
      locator: DesktopSkillLocator;
      parameterKey?: string;
      value?: string;
      sensitive?: boolean;
    })
  | (DesktopSkillStepBase & { kind: 'press'; key: string })
  | (DesktopSkillStepBase & { kind: 'hotkey'; keys: string[] })
  | (DesktopSkillStepBase & { kind: 'wait_for_text'; text: string; locator?: DesktopSkillLocator })
  | (DesktopSkillStepBase & { kind: 'scroll'; deltaX?: number; deltaY?: number });

export type DesktopSkillOutcomeCheck = {
  id: string;
  kind: 'window_exists' | 'text_present' | 'control_exists';
  expected?: string;
  parameterKey?: string;
  locator?: DesktopSkillLocator;
  timeoutMs?: number;
};

export type DesktopSkillManifest = {
  schemaVersion: 'winkgo.desktop.skill.v1';
  id: string;
  name: string;
  description: string;
  runner: typeof WINKGO_DESKTOP_SKILL_RUNNER;
  capability: string;
  triggerPhrases: string[];
  parameters: DesktopSkillParameterDefinition[];
};

export type DesktopWorkflow = {
  schemaVersion: 'winkgo.desktop.workflow.v1';
  targetApp: {
    processName: string;
    windowClass?: string;
    titlePattern?: string;
  };
  steps: DesktopSkillStep[];
  outcomeChecks: DesktopSkillOutcomeCheck[];
};

export type DesktopSkillPackage = {
  manifest: DesktopSkillManifest;
  workflow: DesktopWorkflow;
};

export type DesktopSkillExecutionRequest = {
  executionId: string;
  skill: DesktopSkillPackage;
  parameters: Record<string, string>;
  source: DesktopSkillSource;
};

export type DesktopRepairCandidate = {
  id: string;
  locator: DesktopSkillLocator;
};

export type DesktopRuntimeStepResult =
  | { status: 'succeeded' }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string; candidates?: DesktopRepairCandidate[] };

export type DesktopRuntimeExecuteStepRequest = {
  executionId: string;
  targetApp: DesktopWorkflow['targetApp'];
  step: DesktopSkillStep;
  parameters: Record<string, string>;
  source: DesktopSkillSource;
  repairCandidateId?: string;
  signal: AbortSignal;
};

export type DesktopRuntimeVerifyOutcomesRequest = {
  executionId: string;
  targetApp: DesktopWorkflow['targetApp'];
  checks: DesktopSkillOutcomeCheck[];
  parameters: Record<string, string>;
  signal: AbortSignal;
};

export type DesktopAutomationRuntimePort = {
  executeStep(request: DesktopRuntimeExecuteStepRequest): Promise<DesktopRuntimeStepResult>;
  verifyOutcomes(request: DesktopRuntimeVerifyOutcomesRequest): Promise<{ ok: boolean; reason?: string }>;
  cancel(executionId: string): Promise<void> | void;
};

export type DesktopSkillRecoveryPort = {
  selectCandidate(request: {
    executionId: string;
    failedStep: DesktopSkillStep;
    reason: string;
    candidates: DesktopRepairCandidate[];
  }): Promise<{ candidateId: string } | null>;
};

export type DesktopSkillExecutionResult =
  | { executionId: string; status: 'completed' }
  | { executionId: string; status: 'cancelled' }
  | { executionId: string; status: 'failed'; reason: string };

export type DesktopSkillSummary = {
  id: string;
  name: string;
  updatedAt: string;
  parameters: DesktopSkillParameterDefinition[];
};

export type DesktopSkillSaveRequest = {
  name: string;
  description?: string;
  triggerPhrases?: string[];
};

export type DesktopSkillRunRequest = {
  skillId: string;
  parameters?: Record<string, string>;
  source?: DesktopSkillSource;
};

export type DesktopSkillOperationResult = {
  ok: boolean;
  status: DesktopRecorderStatus;
  skill?: DesktopSkillPackage;
  execution?: DesktopSkillExecutionResult;
  error?: string;
};
