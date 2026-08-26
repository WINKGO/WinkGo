/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DesktopAutomationRuntimePort,
  DesktopRepairCandidate,
  DesktopRuntimeExecuteStepRequest,
  DesktopRuntimeStepResult,
  DesktopRuntimeVerifyOutcomesRequest,
} from '@/common/types/desktopAutomation';

export type RuntimeToolCaller = (
  name: string,
  arguments_: Record<string, unknown>,
  options?: { signal?: AbortSignal; timeoutMs?: number }
) => Promise<unknown>;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

export const unwrapRuntimeToolPayload = (value: unknown): Record<string, unknown> | null => {
  const outer = asRecord(value);
  if (!outer) return null;
  const structured = asRecord(outer.structuredContent) || asRecord(outer.structured_content);
  if (structured) return structured;
  if ('status' in outer || 'success' in outer || 'ok' in outer) return outer;
  const content = Array.isArray(outer.content) ? outer.content : [];
  for (const item of content) {
    const block = asRecord(item);
    if (block?.type !== 'text' || typeof block.text !== 'string') continue;
    try {
      const parsed = asRecord(JSON.parse(block.text));
      if (parsed) return parsed;
    } catch {
      // Non-JSON diagnostic text is not an executable result.
    }
  }
  return null;
};

const candidatesFrom = (value: unknown): DesktopRepairCandidate[] =>
  (Array.isArray(value) ? value : []).flatMap((item) => {
    const candidate = asRecord(item);
    const locator = asRecord(candidate?.locator);
    const id = typeof candidate?.id === 'string' ? candidate.id.trim() : '';
    return id && locator ? [{ id, locator: { ...locator } as DesktopRepairCandidate['locator'] }] : [];
  });

export class RuntimeDesktopAutomationPort implements DesktopAutomationRuntimePort {
  constructor(private readonly options: { callTool: RuntimeToolCaller }) {}

  async executeStep(request: DesktopRuntimeExecuteStepRequest): Promise<DesktopRuntimeStepResult> {
    const raw = await this.options.callTool(
      'desktop_automation.execute_step',
      {
        execution_id: request.executionId,
        target_app: request.targetApp,
        step: request.step,
        parameters: request.parameters,
        source: request.source,
        repair_candidate_id: request.repairCandidateId || '',
        confirmed: true,
      },
      { signal: request.signal, timeoutMs: request.step.timeoutMs ?? 30_000 }
    );
    const result = unwrapRuntimeToolPayload(raw);
    if (!result) return { status: 'failed', reason: 'runtime-result-invalid' };
    if (result.status === 'succeeded' || result.success === true) return { status: 'succeeded' };
    if (result.status === 'cancelled' || result.cancelled === true) return { status: 'cancelled' };
    const reason = typeof result.reason === 'string' ? result.reason : 'desktop-step-failed';
    const candidates = candidatesFrom(result.candidates);
    return { status: 'failed', reason, ...(candidates.length ? { candidates } : {}) };
  }

  async verifyOutcomes(request: DesktopRuntimeVerifyOutcomesRequest): Promise<{ ok: boolean; reason?: string }> {
    const raw = await this.options.callTool(
      'desktop_automation.verify_outcomes',
      {
        execution_id: request.executionId,
        target_app: request.targetApp,
        checks: request.checks,
        parameters: request.parameters,
      },
      { signal: request.signal, timeoutMs: 30_000 }
    );
    const result = unwrapRuntimeToolPayload(raw);
    if (!result || typeof result.ok !== 'boolean') return { ok: false, reason: 'runtime-result-invalid' };
    const reason = typeof result.reason === 'string' ? result.reason : undefined;
    return { ok: result.ok, ...(reason ? { reason } : {}) };
  }

  async cancel(_executionId: string): Promise<void> {
    await this.options.callTool('desktop_automation.cancel', {}, { timeoutMs: 5_000 });
  }
}
