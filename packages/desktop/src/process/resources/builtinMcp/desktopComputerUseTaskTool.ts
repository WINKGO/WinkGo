/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

type DesktopTaskBridgeRequest = <T>(pathname: string, init?: RequestInit) => Promise<T>;

type RunDesktopTaskInput = {
  goal: string;
  max_steps?: number;
};

type DesktopTaskResult = {
  ok: boolean;
  message?: string;
  status?: {
    phase?: string;
    message?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const resultMessage = (value: DesktopTaskResult): string =>
  value.status?.message?.trim() || value.message?.trim() || JSON.stringify(value, null, 2);

/**
 * Keeps the MCP tool's public behavior independently testable from stdio and
 * delegates the complete visual loop to WINK GO's dedicated controller.
 */
export const createRunDesktopTaskHandler =
  (request: DesktopTaskBridgeRequest) =>
  async ({ goal, max_steps }: RunDesktopTaskInput) => {
    const value = await request<DesktopTaskResult>('/winkgo/desktop-computer-use/run', {
      method: 'POST',
      body: JSON.stringify({
        goal: goal.trim(),
        ...(max_steps !== undefined ? { maxSteps: max_steps } : {}),
      }),
    });
    return {
      isError: !value.ok,
      content: [{ type: 'text' as const, text: resultMessage(value) }],
      structuredContent: value,
    };
  };
