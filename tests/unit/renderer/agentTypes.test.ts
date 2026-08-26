// Modified from AionUI by WINK GO contributors in 2026.
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import type { ManagedAgent } from '@/renderer/utils/model/agentTypes';
import { formatManagedAgentDiagnosticMessage, managedAgentSearchText } from '@/renderer/utils/model/agentTypes';

const t = ((key: string, options?: Record<string, unknown>) => {
  switch (key) {
    case 'settings.agentManagement.errorCodes.command_not_found':
      return `Install ${String(options?.command)} and retry the connection test.`;
    case 'settings.agentManagement.errorCodes.bridge_missing':
      return `Install ${String(options?.command)} and retry the connection test.`;
    case 'settings.agentManagement.errorCodes.qoderCliRequired':
      return `Qoder IDE is separate from ${String(options?.command)}.`;
    default:
      return String(options?.defaultValue ?? key);
  }
}) as unknown as TFunction;

function managedAgent(overrides: Partial<ManagedAgent>): ManagedAgent {
  return {
    id: 'agent-1',
    name: 'Codex',
    agent_type: 'acp',
    agent_source: 'builtin',
    enabled: true,
    installed: true,
    status: 'unavailable',
    sort_order: 1,
    args: [],
    env: [],
    behavior_policy: {},
    team_capable: true,
    ...overrides,
  } as ManagedAgent;
}

describe('formatManagedAgentDiagnosticMessage', () => {
  it('formats localized diagnostics from error code and details', () => {
    const message = formatManagedAgentDiagnosticMessage(
      t,
      managedAgent({
        last_check_error_code: 'command_not_found',
        last_check_error_details: { command: 'codex' },
        last_check_error_message: 'spawn failed',
      })
    );

    expect(message).toBe('Install codex and retry the connection test.');
  });

  it('falls back to backend message when the code is unknown', () => {
    const message = formatManagedAgentDiagnosticMessage(
      t,
      managedAgent({
        last_check_error_code: 'unknown_error_code',
        last_check_error_message: 'raw backend message',
      })
    );

    expect(message).toBe('raw backend message');
  });

  it('explains that Qoder IDE cannot replace the ACP command-line agent', () => {
    const message = formatManagedAgentDiagnosticMessage(
      t,
      managedAgent({
        name: 'Qoder',
        backend: 'qoder',
        command: 'qodercli',
        last_check_error_code: 'command_not_found',
      })
    );

    expect(message).toBe('Qoder IDE is separate from qodercli.');
  });
});

describe('managedAgentSearchText', () => {
  it('includes backend, command, binary name and localized metadata', () => {
    const text = managedAgentSearchText(
      managedAgent({
        name: 'Antigravity',
        name_i18n: { 'zh-CN': '反重力' },
        backend: 'antigravity',
        command: 'agy',
        agent_source_info: { binary_name: 'agy.exe' },
      }),
      'zh-CN'
    );

    expect(text).toContain('antigravity');
    expect(text).toContain('反重力');
    expect(text).toContain('agy.exe');
  });
});
