/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export const loadOptionalWinkGoRuntimeGateways = async (
  configure: () => Promise<string[]>,
  warn: (message: string) => void = console.warn
): Promise<string[]> => {
  try {
    return await configure();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warn(`[WINK GO Runtime] 可选设备通道暂未加载，本地自动化继续可用：${detail}`);
    return [];
  }
};
