// Modified from AionUI by WINK GO contributors in 2026.
const DEPRECATED_RUNTIME_AGENT_TYPES = new Set(['openclaw-gateway', 'nanobot', 'remote', 'gemini']);

export function isDeprecatedRuntimeAgentType(agentType?: string | null): boolean {
  return Boolean(agentType && DEPRECATED_RUNTIME_AGENT_TYPES.has(agentType));
}

export function resolveSupportedConversationType(backend?: string | null): 'acp' | 'winkgo_agent' {
  return backend === 'winkgo_agent' ? 'winkgo_agent' : 'acp';
}
