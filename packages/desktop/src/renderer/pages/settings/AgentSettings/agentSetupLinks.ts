/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';

export const BUILTIN_AGENT_SETUP_LINKS = {
  winkgo_agent: 'https://github.com/WINKGO/wink-go#readme',
  claude: 'https://code.claude.com/docs/en/setup',
  codex: 'https://learn.chatgpt.com/docs/codex/cli',
  gemini: 'https://github.com/google-gemini/gemini-cli',
  qwen: 'https://github.com/QwenLM/qwen-code',
  codebuddy: 'https://github.com/agentclientprotocol/registry/blob/main/codebuddy-code/agent.json',
  droid: 'https://docs.factory.ai/droid-cli/quickstart',
  goose: 'https://github.com/agentclientprotocol/registry/blob/main/goose/agent.json',
  auggie: 'https://docs.augmentcode.com/cli/setup-auggie/install-auggie-cli',
  kimi: 'https://www.kimi.com/code/docs/en/',
  opencode: 'https://opencode.ai/docs/',
  copilot: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli',
  qoder: 'https://qoder.com/download',
  vibe: 'https://github.com/mistralai/mistral-vibe',
  cursor: 'https://cursor.com/download',
  kiro: 'https://kiro.dev/downloads/',
  hermes: 'https://github.com/NousResearch/hermes-agent',
  snow: 'https://github.com/WINKGO/wink-go/blob/main/docs/agents/snow.md',
  openclaw: 'https://docs.openclaw.ai/install',
  pi: 'https://github.com/agentclientprotocol/registry/blob/main/pi-acp/agent.json',
  autohand: 'https://github.com/agentclientprotocol/registry/blob/main/autohand/agent.json',
  deepagents: 'https://github.com/agentclientprotocol/registry/blob/main/deepagents/agent.json',
  dimcode: 'https://github.com/agentclientprotocol/registry/blob/main/dimcode/agent.json',
  dirac: 'https://github.com/agentclientprotocol/registry/blob/main/dirac/agent.json',
  'glm-acp-agent': 'https://github.com/agentclientprotocol/registry/blob/main/glm-acp-agent/agent.json',
  grok: 'https://github.com/agentclientprotocol/registry/blob/main/grok-build/agent.json',
  kilo: 'https://kilo.ai/docs/code-with-ai/platforms/cli',
  nova: 'https://github.com/agentclientprotocol/registry/blob/main/nova/agent.json',
  sigit: 'https://github.com/agentclientprotocol/registry/blob/main/sigit/agent.json',
  'amp-acp': 'https://ampcode.com/manual',
  'cortex-code': 'https://github.com/agentclientprotocol/registry/blob/main/cortex-code/agent.json',
  'corust-agent': 'https://github.com/agentclientprotocol/registry/blob/main/corust-agent/agent.json',
  devin: 'https://docs.devin.ai/work-with-devin/devin-cli',
  harn: 'https://github.com/agentclientprotocol/registry/blob/main/harn/agent.json',
  junie: 'https://junie.jetbrains.com/docs/',
  poolside: 'https://github.com/agentclientprotocol/registry/blob/main/poolside/agent.json',
  stakpak: 'https://stakpak.dev/docs/cli',
  vtcode: 'https://github.com/vinhnx/vtcode',
} as const;

export type BuiltinAgentSetupBackend = keyof typeof BUILTIN_AGENT_SETUP_LINKS;

export const BUILTIN_AGENT_SETUP_BACKENDS = Object.freeze(
  Object.keys(BUILTIN_AGENT_SETUP_LINKS) as BuiltinAgentSetupBackend[]
);

export const getBuiltinAgentSetupUrl = (agent: Pick<ManagedAgent, 'agent_type' | 'backend'>): string | undefined => {
  const backend = agent.backend || agent.agent_type;
  return BUILTIN_AGENT_SETUP_LINKS[backend as BuiltinAgentSetupBackend];
};
