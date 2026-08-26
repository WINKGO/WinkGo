/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  WinkGoDesktopSkillsStore,
  type DesktopSkillRegistryItem,
  type SaveDesktopSkillRequest,
  type WinkGoDesktopSkillsStoreOptions,
} from './store';
export { WinkGoDesktopSkillRunner, type WinkGoDesktopSkillRunnerOptions } from './runner';
export { RuntimeDesktopAutomationPort, unwrapRuntimeToolPayload, type RuntimeToolCaller } from './runtimePort';
