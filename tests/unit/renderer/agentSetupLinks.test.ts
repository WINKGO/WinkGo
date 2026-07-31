/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_AGENT_SETUP_BACKENDS,
  BUILTIN_AGENT_SETUP_LINKS,
  getBuiltinAgentSetupUrl,
} from '@renderer/pages/settings/AgentSettings/agentSetupLinks';

const EXPECTED_BUILTIN_BACKENDS = [
  'winkgo_agent',
  'claude',
  'codex',
  'gemini',
  'qwen',
  'codebuddy',
  'droid',
  'goose',
  'auggie',
  'kimi',
  'opencode',
  'copilot',
  'qoder',
  'vibe',
  'cursor',
  'kiro',
  'hermes',
  'snow',
  'openclaw',
  'pi',
  'autohand',
  'deepagents',
  'dimcode',
  'dirac',
  'glm-acp-agent',
  'grok',
  'kilo',
  'nova',
  'sigit',
  'amp-acp',
  'cortex-code',
  'corust-agent',
  'devin',
  'harn',
  'junie',
  'poolside',
  'stakpak',
  'vtcode',
] as const;

describe('builtin Agent setup links', () => {
  it('gives every current builtin Agent its own HTTPS setup destination', () => {
    expect(BUILTIN_AGENT_SETUP_BACKENDS.toSorted()).toEqual(EXPECTED_BUILTIN_BACKENDS.toSorted());

    const urls = Object.values(BUILTIN_AGENT_SETUP_LINKS);
    expect(urls).toHaveLength(38);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.every((url) => url.startsWith('https://'))).toBe(true);
  });

  it('resolves both ACP backends and the internal WINK GO agent', () => {
    expect(getBuiltinAgentSetupUrl({ agent_type: 'acp', backend: 'kimi' })).toBe(BUILTIN_AGENT_SETUP_LINKS.kimi);
    expect(getBuiltinAgentSetupUrl({ agent_type: 'winkgo_agent', backend: undefined })).toBe(
      BUILTIN_AGENT_SETUP_LINKS.winkgo_agent
    );
  });
});
