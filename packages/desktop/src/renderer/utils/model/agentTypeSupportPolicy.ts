// Modified from AionUI by WINK GO contributors in 2026.
const DEPRECATED_RUNTIME_AGENT_TYPES = new Set(['openclaw-gateway', 'nanobot', 'remote', 'gemini']);
const RETIRED_WINKGO_AGENT_IDENTITIES = new Set([
  'codex',
  'codexcli',
  'claude',
  'claudecode',
  'openclaw',
  'openclawgateway',
  'trae',
  'traecn',
  'visualstudio',
  'visualstudiocode',
  'vscode',
  'antigravity',
  'googleantigravity',
  'qoder',
  'kiro',
  'workbuddy',
  'qclaw',
  'hermes',
]);

const normalizeAgentIdentity = (value?: string | null): string =>
  (value || '').toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '');

/** Product-level denylist for Agent integrations removed from every WINK GO selection surface. */
export function isRetiredWinkGoAgentIdentity(...identities: Array<string | null | undefined>): boolean {
  return identities.some((identity) => RETIRED_WINKGO_AGENT_IDENTITIES.has(normalizeAgentIdentity(identity)));
}

/** Detect retired integration names embedded in historical task/tool identifiers. */
export function containsRetiredWinkGoAgentIdentity(...identities: Array<string | null | undefined>): boolean {
  return identities.some((identity) => {
    const normalized = normalizeAgentIdentity(identity);
    return [...RETIRED_WINKGO_AGENT_IDENTITIES].some((retired) => normalized.includes(retired));
  });
}

export function isDeprecatedRuntimeAgentType(agentType?: string | null): boolean {
  return Boolean(agentType && DEPRECATED_RUNTIME_AGENT_TYPES.has(agentType));
}

export function resolveSupportedConversationType(backend?: string | null): 'acp' | 'winkgo_agent' {
  return backend === 'winkgo_agent' ? 'winkgo_agent' : 'acp';
}
