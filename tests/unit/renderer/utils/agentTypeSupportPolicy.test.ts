// Modified from AionUI by WINK GO contributors in 2026.
import { describe, expect, it } from 'vitest';

import {
  containsRetiredWinkGoAgentIdentity,
  isDeprecatedRuntimeAgentType,
  isRetiredWinkGoAgentIdentity,
  resolveSupportedConversationType,
} from '@/renderer/utils/model/agentTypeSupportPolicy';

describe('Guid agent support policy', () => {
  it('marks retired top-level runtime agent types as deprecated', () => {
    expect(isDeprecatedRuntimeAgentType('acp')).toBe(false);
    expect(isDeprecatedRuntimeAgentType('winkgo_agent')).toBe(false);
    expect(isDeprecatedRuntimeAgentType('openclaw-gateway')).toBe(true);
    expect(isDeprecatedRuntimeAgentType('nanobot')).toBe(true);
    expect(isDeprecatedRuntimeAgentType('remote')).toBe(true);
    expect(isDeprecatedRuntimeAgentType('gemini')).toBe(true);
  });

  it('removes every retired WINK GO Agent identity while preserving supported Agents', () => {
    for (const identity of [
      'Codex CLI',
      'Claude Code',
      'OpenClaw',
      'Trae CN',
      'Visual Studio Code',
      'Google Antigravity',
      'Qoder',
      'Kiro',
      'WorkBuddy',
      'QClaw',
      'Hermes',
    ]) {
      expect(isRetiredWinkGoAgentIdentity(identity)).toBe(true);
    }
    expect(isRetiredWinkGoAgentIdentity('winkgo_agent', 'WINK GO CLI')).toBe(false);
    expect(isRetiredWinkGoAgentIdentity('kimi', 'Kimi')).toBe(false);
    expect(containsRetiredWinkGoAgentIdentity('visual_studio_code.open_file')).toBe(true);
    expect(containsRetiredWinkGoAgentIdentity('codebuddy.open_project')).toBe(false);
  });

  it('resolves supported top-level conversation type from backend labels', () => {
    expect(resolveSupportedConversationType('winkgo_agent')).toBe('winkgo_agent');
    expect(resolveSupportedConversationType('claude')).toBe('acp');
    expect(resolveSupportedConversationType('gemini')).toBe('acp');
    expect(resolveSupportedConversationType('openclaw-gateway')).toBe('acp');
    expect(resolveSupportedConversationType('openclaw')).toBe('acp');
  });
});
