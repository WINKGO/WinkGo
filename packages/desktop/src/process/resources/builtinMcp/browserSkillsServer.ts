#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { resolveBridgeToken, resolveBrowserUrl } from './browserServerPort';
import { createBrowserBridgeClient } from './browserBridgeClient';

const bridgeUrl = resolveBrowserUrl({ env: process.env });
const bridgeToken = resolveBridgeToken({ env: process.env });
const conversationId = process.env.WINKGO_CONVERSATION_ID?.trim() || '';

if (!bridgeUrl || !bridgeToken) {
  process.stderr.write('[winkgo-browser-skills] Browser bridge is unavailable.\n');
  process.exit(1);
}

const { request } = createBrowserBridgeClient({ bridgeUrl, bridgeToken, conversationId });

const main = async (): Promise<void> => {
  const server = new McpServer({ name: 'winkgo-browser-skills', version: '2.0.0' });

  server.registerTool(
    'inspect_browser_page',
    {
      title: 'Inspect WINK GO Browser Page',
      description:
        'Open the WINK GO in-app browser when needed, then read its visible page as structured text and interactive elements. Use the returned ref values with browser_action. This never exposes the WINK GO application window.',
      inputSchema: {
        maximum_elements: z.number().int().min(20).max(220).optional(),
        include_screenshot: z
          .boolean()
          .optional()
          .describe(
            'Include a current JPEG data URL and screenshot/viewport dimensions for canvas or pixel-only pages.'
          ),
      },
    },
    async ({ maximum_elements, include_screenshot }) => {
      const query = new URLSearchParams();
      if (maximum_elements) query.set('maximum_elements', String(maximum_elements));
      if (include_screenshot) query.set('include_screenshot', 'true');
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      const value = await request<{
        ok: boolean;
        message?: string;
        elements?: unknown[];
        [key: string]: unknown;
      }>(`/winkgo/browser-control/snapshot${suffix}`);
      return {
        isError: !value.ok,
        content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        structuredContent: value,
      };
    }
  );

  server.registerTool(
    'browser_action',
    {
      title: 'Control WINK GO Browser',
      description:
        'Open and control the visible WINK GO in-app browser. Use navigate to open a URL; the browser panel is created automatically when absent. Inspect first before element actions, prefer a returned ref, and inspect again after navigation or major page changes. Website sign-in and QR-login controls are available only when the user enabled that permission in Settings and accepted its disclaimer. Never read or fill passwords, OTPs, CAPTCHAs, QR payloads, tokens or payment data. Never submit purchases, publish content, delete data, upload files, or change account/security settings without the user confirming that exact action.',
      inputSchema: {
        action: z.enum([
          'navigate',
          'click',
          'submit',
          'fill',
          'select',
          'press',
          'wait',
          'scroll',
          'back',
          'forward',
          'reload',
        ]),
        ref: z.string().optional().describe('Element ref returned by inspect_browser_page.'),
        selector: z.string().optional().describe('CSS selector fallback when no ref is available.'),
        role: z.string().optional().describe('Accessible role fallback, used together with name.'),
        name: z.string().optional().describe('Exact accessible name fallback.'),
        value: z.string().optional().describe('Value for fill or select.'),
        url: z.string().url().optional().describe('HTTP(S) address for navigate.'),
        key: z.string().optional().describe('Key or chord for press, such as Enter or Control+A.'),
        text: z.string().optional().describe('Visible text to wait for.'),
        timeout_ms: z.number().int().min(0).max(60_000).optional(),
        delta_x: z.number().int().min(-20_000).max(20_000).optional(),
        delta_y: z.number().int().min(-20_000).max(20_000).optional(),
        x: z.number().int().min(0).optional().describe('Viewport x coordinate for a visual click.'),
        y: z.number().int().min(0).optional().describe('Viewport y coordinate for a visual click.'),
      },
    },
    async ({ timeout_ms, delta_x, delta_y, ...action }) => {
      const value = await request<{ ok: boolean; message?: string; [key: string]: unknown }>(
        '/winkgo/browser-control/action',
        {
          method: 'POST',
          body: JSON.stringify({
            ...action,
            ...(timeout_ms !== undefined ? { timeoutMs: timeout_ms } : {}),
            ...(delta_x !== undefined ? { deltaX: delta_x } : {}),
            ...(delta_y !== undefined ? { deltaY: delta_y } : {}),
          }),
        }
      );
      return {
        isError: !value.ok,
        content: [
          {
            type: 'text',
            text: value.message || JSON.stringify(value, null, 2),
          },
        ],
        structuredContent: value,
      };
    }
  );

  server.registerTool(
    'run_browser_task',
    {
      title: 'Run Autonomous WINK GO Browser Task',
      description:
        'Preferred tool for any multi-step browser request. Give WINK GO one natural-language goal; it visibly operates the in-app browser in an observe-decide-act-verify loop, reuses relevant recorded browser skills, detects stalls, and enforces the user-configured sign-in and QR-login permission. Protected secrets remain manual and irreversible actions still stop for confirmation. Use browser_action only for a single explicit low-level action or debugging.',
      inputSchema: {
        goal: z.string().min(1).max(2_000).describe('The complete user-requested browser outcome.'),
        start_url: z.string().url().optional().describe('Optional HTTP(S) page to open before starting.'),
        max_steps: z.number().int().min(1).max(20).optional().describe('Safety bound; defaults to 8.'),
      },
    },
    async ({ goal, start_url, max_steps }) => {
      const value = await request<{
        ok: boolean;
        status: string;
        message: string;
        [key: string]: unknown;
      }>('/winkgo/browser-agent/run', {
        method: 'POST',
        body: JSON.stringify({
          goal,
          ...(start_url ? { startUrl: start_url } : {}),
          ...(max_steps !== undefined ? { maxSteps: max_steps } : {}),
        }),
      });
      return {
        isError: !value.ok,
        content: [{ type: 'text', text: value.message || JSON.stringify(value, null, 2) }],
        structuredContent: value,
      };
    }
  );

  server.registerTool(
    'list_browser_skills',
    {
      title: 'List WINK GO Browser Skills',
      description:
        'List deterministic browser workflows recorded by the user. These skills run only in the visible WINK GO built-in browser.',
      inputSchema: {},
    },
    async () => {
      const value = await request<{ ok: boolean; skills: unknown[] }>('/winkgo/browser-skills');
      return {
        content: [{ type: 'text', text: JSON.stringify(value.skills, null, 2) }],
        structuredContent: { skills: value.skills },
      };
    }
  );

  server.registerTool(
    'run_browser_skill',
    {
      title: 'Run WINK GO Browser Skill',
      description:
        'Run one saved deterministic workflow in the currently visible WINK GO built-in browser. Call list_browser_skills first and provide all required runtime parameters.',
      inputSchema: {
        skill_id: z.string().min(1).describe('The saved Browser Skill id.'),
        parameters: z.record(z.string()).optional().describe('Runtime-only parameter values keyed by parameter id.'),
      },
    },
    async ({ skill_id, parameters }) => {
      const value = await request<{ ok: boolean; message?: string; skill?: unknown }>('/winkgo/browser-skills/run', {
        method: 'POST',
        body: JSON.stringify({ skillId: skill_id, parameters: parameters ?? {} }),
      });
      return {
        isError: !value.ok,
        content: [
          {
            type: 'text',
            text: value.message || (value.ok ? 'Browser Skill completed.' : 'Browser Skill failed.'),
          },
        ],
        structuredContent: value,
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  process.stderr.write(
    `[winkgo-browser-skills] Fatal error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
