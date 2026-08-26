/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DesktopAutomationRuntimePort,
  DesktopSkillExecutionRequest,
  DesktopSkillExecutionResult,
  DesktopSkillRecoveryPort,
} from '@/common/types/desktopAutomation';

export type WinkGoDesktopSkillRunnerOptions = {
  runtimePort: DesktopAutomationRuntimePort;
  recoveryPort?: DesktopSkillRecoveryPort;
};

type ActiveExecution = {
  executionId: string;
  abortController: AbortController;
};

/** Serial deterministic runner for one visible WINK GO Desktop Session. */
export class WinkGoDesktopSkillRunner {
  private activeExecution: ActiveExecution | null = null;

  constructor(private readonly options: WinkGoDesktopSkillRunnerOptions) {}

  async run(request: DesktopSkillExecutionRequest): Promise<DesktopSkillExecutionResult> {
    if (this.activeExecution) {
      return {
        executionId: request.executionId,
        status: 'failed',
        reason: 'desktop-execution-already-active',
      };
    }

    const abortController = new AbortController();
    this.activeExecution = { executionId: request.executionId, abortController };
    let recoveryUsed = false;
    try {
      for (const step of request.skill.workflow.steps) {
        if (abortController.signal.aborted) return this.cancelled(request.executionId);
        // Workflow steps intentionally run in order against one visible Desktop Session.
        // eslint-disable-next-line no-await-in-loop
        let result = await this.options.runtimePort.executeStep({
          executionId: request.executionId,
          targetApp: request.skill.workflow.targetApp,
          step,
          parameters: request.parameters,
          source: request.source,
          signal: abortController.signal,
        });
        if (result.status === 'failed' && !recoveryUsed && result.candidates?.length && this.options.recoveryPort) {
          recoveryUsed = true;
          // Recovery must observe the failure before the deterministic retry starts.
          // eslint-disable-next-line no-await-in-loop
          const selected = await this.options.recoveryPort.selectCandidate({
            executionId: request.executionId,
            failedStep: step,
            reason: result.reason,
            candidates: result.candidates.map((candidate) => ({
              ...candidate,
              locator: { ...candidate.locator },
            })),
          });
          if (abortController.signal.aborted) return this.cancelled(request.executionId);
          if (selected && result.candidates.some(({ id }) => id === selected.candidateId)) {
            // The repaired step must finish before later workflow steps can run.
            // eslint-disable-next-line no-await-in-loop
            result = await this.options.runtimePort.executeStep({
              executionId: request.executionId,
              targetApp: request.skill.workflow.targetApp,
              step,
              parameters: request.parameters,
              source: request.source,
              repairCandidateId: selected.candidateId,
              signal: abortController.signal,
            });
          }
        }
        if (abortController.signal.aborted || result.status === 'cancelled') {
          return this.cancelled(request.executionId);
        }
        if (result.status === 'failed') {
          return { executionId: request.executionId, status: 'failed', reason: result.reason };
        }
      }

      const outcome = await this.options.runtimePort.verifyOutcomes({
        executionId: request.executionId,
        targetApp: request.skill.workflow.targetApp,
        checks: request.skill.workflow.outcomeChecks,
        parameters: request.parameters,
        signal: abortController.signal,
      });
      if (abortController.signal.aborted) return this.cancelled(request.executionId);
      if (!outcome.ok) {
        return { executionId: request.executionId, status: 'failed', reason: outcome.reason || 'outcome-not-verified' };
      }
      return { executionId: request.executionId, status: 'completed' };
    } finally {
      if (this.activeExecution?.executionId === request.executionId) this.activeExecution = null;
    }
  }

  async cancel(executionId: string): Promise<boolean> {
    const active = this.activeExecution;
    if (!active || active.executionId !== executionId) return false;
    active.abortController.abort();
    await this.options.runtimePort.cancel(executionId);
    return true;
  }

  private cancelled(executionId: string): DesktopSkillExecutionResult {
    return { executionId, status: 'cancelled' };
  }
}
