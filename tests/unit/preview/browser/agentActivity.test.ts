/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  BUILTIN_BROWSER_MCP_NAME,
  isBrowserMcpActivity,
  isBrowserMcpSettled,
} from '@/renderer/pages/conversation/Preview/browser/agentActivity';

const browserCall = (status: string, serverName = BUILTIN_BROWSER_MCP_NAME) => ({
  name: 'navigate_page',
  status,
  confirmationDetails: { type: 'mcp', server_name: serverName, tool_name: 'navigate_page' },
});

describe('browser agent activity', () => {
  it.each(['Executing', 'Pending', 'Confirming'])('recognises %s as active', (status) => {
    expect(isBrowserMcpActivity('tool_group', [browserCall(status)])).toBe(true);
  });

  it('ignores other servers and unrelated message types', () => {
    expect(isBrowserMcpActivity('tool_group', [browserCall('Executing', 'chrome-devtools')])).toBe(false);
    expect(isBrowserMcpActivity('text', [browserCall('Executing')])).toBe(false);
  });

  it('supports the MCP-prefixed fallback name', () => {
    expect(
      isBrowserMcpActivity('tool_group', [{ name: `${BUILTIN_BROWSER_MCP_NAME}__navigate_page`, status: 'Executing' }])
    ).toBe(true);
  });

  it('settles only after every browser call has finished', () => {
    expect(isBrowserMcpSettled('tool_group', [browserCall('Success')])).toBe(true);
    expect(isBrowserMcpSettled('tool_group', [browserCall('Success'), browserCall('Executing')])).toBe(false);
    expect(isBrowserMcpSettled('tool_group', [{ name: 'read_file', status: 'Success' }])).toBe(false);
  });
});
