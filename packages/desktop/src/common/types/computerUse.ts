/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export type ComputerUseModelRef = {
  providerId: string;
  model: string;
};

export type ComputerUsePhase =
  | 'idle'
  | 'starting'
  | 'observing'
  | 'planning'
  | 'acting'
  | 'awaiting_confirmation'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled';

export type DesktopComputerUseTarget = {
  hwnd: number;
  pid: number;
  title: string;
  processName: string;
  rect: { x: number; y: number; width: number; height: number };
};

export type DesktopComputerUseAction = {
  kind: 'launch' | 'open_file' | 'click' | 'type' | 'press' | 'hotkey' | 'scroll';
  appName?: string;
  path?: string;
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  keys?: string[];
  delta?: number;
  label?: string;
  sensitive?: boolean;
};

export type DesktopComputerUseStatus = {
  sessionId?: string;
  phase: ComputerUsePhase;
  goal?: string;
  model?: ComputerUseModelRef;
  target?: DesktopComputerUseTarget;
  action?: DesktopComputerUseAction;
  stepCount: number;
  message?: string;
  updatedAt: number;
};

export type DesktopComputerUseRunRequest = {
  goal: string;
  model: ComputerUseModelRef;
  maxSteps?: number;
};

export type DesktopComputerUseRunResult = {
  ok: boolean;
  status: DesktopComputerUseStatus;
};

export type BrowserComputerUseStatus = {
  taskId?: string;
  phase: ComputerUsePhase;
  goal?: string;
  model?: ComputerUseModelRef;
  stepCount: number;
  url?: string;
  title?: string;
  message?: string;
  updatedAt: number;
};

export type BrowserComputerUseRunRequest = {
  goal: string;
  model: ComputerUseModelRef;
  startUrl?: string;
  conversationId?: string;
  maxSteps?: number;
};

export type BrowserComputerUseRunResult = {
  ok: boolean;
  status: BrowserComputerUseStatus;
};
