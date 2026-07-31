// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronAgentConfigWrite } from '@/common/adapter/ipcBridge';
import { isWinkGoAgentAssistant, type Assistant } from '@/common/types/agent/assistantTypes';
import { resolveAssistantName } from '@renderer/utils/model/assistantDisplay';

type SelectedWinkGoAgentProvider = {
  id?: string;
  name?: string;
};

type ResolveCronAgentConfigInput = {
  agentValue: string;
  presetAssistants: Assistant[];
  selectedWinkGoAgentProvider?: SelectedWinkGoAgentProvider;
  model_id?: string;
  config_options?: Record<string, string>;
  workspace?: string;
  localeKey?: string;
  getMode: (assistant: Assistant) => string | undefined;
  winkgo_agentModelRequiredMessage: string;
};

type ResolveCronAgentConfigResult = {
  agent_config: ICronAgentConfigWrite | undefined;
};

export function resolveCronAgentConfig(input: ResolveCronAgentConfigInput): ResolveCronAgentConfigResult {
  const {
    agentValue,
    presetAssistants,
    selectedWinkGoAgentProvider,
    model_id,
    config_options,
    workspace,
    localeKey = 'en-US',
    getMode,
    winkgo_agentModelRequiredMessage,
  } = input;

  const colonIdx = agentValue.indexOf(':');
  const prefixedId = colonIdx >= 0 ? agentValue.substring(colonIdx + 1) : agentValue;
  const assistantSelection = presetAssistants.find((item) => item.id === prefixedId || item.id === agentValue);
  if (!assistantSelection) {
    throw new Error('assistant_id is required');
  }

  let agent_config: ICronAgentConfigWrite | undefined;

  const assistant = assistantSelection;
  const assistantName = resolveAssistantName(assistant, localeKey, assistant.name);
  const mode = getMode(assistant);

  if (isWinkGoAgentAssistant(assistant)) {
    if (!selectedWinkGoAgentProvider?.id || !model_id) {
      throw new Error(winkgo_agentModelRequiredMessage);
    }
    agent_config = {
      name: assistantName,
      assistant_id: assistant.id,
      mode,
      model_id,
      model: {
        provider_id: selectedWinkGoAgentProvider.id,
        model: model_id,
        use_model: model_id,
      },
      workspace,
    };
  } else {
    agent_config = {
      name: assistantName,
      assistant_id: assistant.id,
      mode,
      model_id,
      config_options,
      workspace,
    };
  }

  return { agent_config };
}
