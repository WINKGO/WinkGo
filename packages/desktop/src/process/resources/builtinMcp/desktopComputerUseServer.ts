#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createBrowserBridgeClient } from './browserBridgeClient';
import { createRunDesktopTaskHandler } from './desktopComputerUseTaskTool';
import { resolveBridgeToken, resolveBrowserUrl } from './browserServerPort';

const bridgeUrl = resolveBrowserUrl({ env: process.env });
const bridgeToken = resolveBridgeToken({ env: process.env });
const conversationId = process.env.WINKGO_CONVERSATION_ID?.trim() || '';
let activeSessionId = conversationId || `winkgo-desktop-${Date.now()}`;

if (!bridgeUrl || !bridgeToken) {
  process.stderr.write('[winkgo-desktop-computer-use] Desktop bridge is unavailable.\n');
  process.exit(1);
}

const { request } = createBrowserBridgeClient({ bridgeUrl, bridgeToken, conversationId });

type DesktopObservation = {
  ok: boolean;
  message?: string;
  observation?: DesktopObservation;
  target?: { hwnd: number; pid: number; title?: string; processName?: string };
  screenshotPath?: string;
  text?: string[];
  controls?: unknown[];
  ocr?: unknown[];
  [key: string]: unknown;
};

const observationContent = async (value: DesktopObservation, sessionId: string) => {
  const observation = value.observation && typeof value.observation === 'object' ? value.observation : value;
  const screenshotPath = typeof observation.screenshotPath === 'string' ? observation.screenshotPath : '';
  const safeObservation = { ...observation };
  delete safeObservation.screenshotPath;
  const safeValue =
    observation === value ? { ...safeObservation, sessionId } : { ...value, observation: safeObservation, sessionId };
  const textContent = {
    type: 'text' as const,
    text: [
      `Desktop session: ${sessionId}`,
      'Use the screenshot and structured controls as current evidence. Perform exactly one desktop_action or a bounded desktop_wait, then inspect the returned fresh evidence. Do not claim success until the requested result is visibly verified.',
      JSON.stringify(safeValue, null, 2),
    ].join('\n\n'),
  };
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
    textContent,
  ];
  if (screenshotPath) {
    try {
      content.push({ type: 'image', data: (await readFile(screenshotPath)).toString('base64'), mimeType: 'image/png' });
    } catch (error) {
      textContent.text += `\n\nScreenshot unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return { isError: !value.ok, content, structuredContent: safeValue };
};

const useSession = (requested?: string): string => {
  activeSessionId = requested?.trim() || activeSessionId;
  return activeSessionId;
};

const main = async (): Promise<void> => {
  const server = new McpServer({ name: 'winkgo-desktop-computer-use', version: '1.1.0' });

  server.registerTool(
    'run_desktop_task',
    {
      title: 'Run Autonomous WINK GO Desktop Task',
      description:
        'Preferred tool for any multi-step native Windows task. Give WINK GO one complete natural-language goal; its dedicated visual controller visibly operates the desktop in an observe-decide-act-verify loop, shows the full-screen control border and real cursor feedback, and reports success only after fresh visual verification. This is separate from run_browser_task, which controls only the WINK GO in-app browser.',
      inputSchema: {
        goal: z.string().min(1).max(2_000).describe('The complete user-requested native Windows outcome.'),
        max_steps: z.number().int().min(1).max(20).optional().describe('Safety bound; defaults to 12.'),
      },
    },
    createRunDesktopTaskHandler(request)
  );

  server.registerTool(
    'observe_desktop',
    {
      title: 'Observe WINK GO Desktop',
      description:
        'Observe the active external Windows application. Returns a screenshot, target identity, OCR text and UI controls. Use this first when an external app is already open. If no safe external window exists and the task asks to open an app, call launch_desktop_app instead. This tool is separate from the WINK GO in-app browser.',
      inputSchema: {
        session_id: z.string().min(1).max(128).optional().describe('Reuse one session id for the complete task.'),
      },
    },
    async ({ session_id }) => {
      const sessionId = useSession(session_id);
      const value = await request<DesktopObservation>('/winkgo/desktop-computer-use/observe', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      return observationContent(value, sessionId);
    }
  );

  server.registerTool(
    'launch_desktop_app',
    {
      title: 'Launch a Windows Application for Desktop Control',
      description:
        'Safely launch one Windows application by its plain display name when no external window is available, then return a fresh screenshot and verified target. Examples: 记事本, 计算器, Microsoft Edge. Do not pass a path, URL, command line, script, or shell syntax.',
      inputSchema: {
        session_id: z.string().min(1).max(128).optional(),
        app_name: z.string().min(1).max(80).describe('Plain Windows application name, without paths or commands.'),
      },
    },
    async ({ session_id, app_name }) => {
      const sessionId = useSession(session_id);
      const value = await request<DesktopObservation>('/winkgo/desktop-computer-use/launch', {
        method: 'POST',
        body: JSON.stringify({ sessionId, appName: app_name }),
      });
      return observationContent(value, sessionId);
    }
  );

  server.registerTool(
    'desktop_action',
    {
      title: 'Act on WINK GO Desktop',
      description:
        'Perform exactly one visible action on the external Windows target returned by observe_desktop. Inspect the returned fresh screenshot before choosing another action. Sensitive send, publish, purchase, delete, upload, or account/security actions require exact user confirmation.',
      inputSchema: {
        session_id: z.string().min(1).max(128).optional(),
        target: z.object({ hwnd: z.number().int().positive(), pid: z.number().int().positive() }),
        action: z.object({
          type: z.enum(['click', 'type', 'press', 'hotkey', 'scroll']),
          x: z.number().int().optional(),
          y: z.number().int().optional(),
          text: z.string().max(8_000).optional(),
          key: z.string().max(80).optional(),
          keys: z.array(z.string().min(1).max(40)).max(8).optional(),
          delta: z.number().int().min(-20_000).max(20_000).optional(),
          label: z.string().max(240).optional(),
        }),
        confirmed: z.boolean().optional(),
      },
    },
    async ({ session_id, target, action, confirmed }) => {
      const sessionId = useSession(session_id);
      const value = await request<DesktopObservation>('/winkgo/desktop-computer-use/act', {
        method: 'POST',
        body: JSON.stringify({ sessionId, target, action, confirmed: confirmed === true }),
      });
      return observationContent(value, sessionId);
    }
  );

  server.registerTool(
    'desktop_wait',
    {
      title: 'Wait and Re-observe WINK GO Desktop',
      description:
        'Wait briefly for a Windows application transition, then return a fresh screenshot and controls. Use bounded waits instead of repeatedly clicking while a page or dialog is changing.',
      inputSchema: {
        session_id: z.string().min(1).max(128).optional(),
        milliseconds: z.number().int().min(100).max(5_000).default(500),
      },
    },
    async ({ session_id, milliseconds }) => {
      const sessionId = useSession(session_id);
      const value = await request<DesktopObservation>('/winkgo/desktop-computer-use/wait', {
        method: 'POST',
        body: JSON.stringify({ sessionId, milliseconds }),
      });
      return observationContent(value, sessionId);
    }
  );

  server.registerTool(
    'desktop_cancel',
    {
      title: 'Cancel WINK GO Desktop Task',
      description: 'Immediately cancel the active WINK GO Desktop Computer Use session.',
      inputSchema: { session_id: z.string().min(1).max(128).optional() },
    },
    async ({ session_id }) => {
      const sessionId = useSession(session_id);
      const value = await request<{ ok: boolean; message?: string }>('/winkgo/desktop-computer-use/cancel', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      return {
        isError: !value.ok,
        content: [{ type: 'text', text: value.message || JSON.stringify(value, null, 2) }],
        structuredContent: value,
      };
    }
  );

  await server.connect(new StdioServerTransport());
};

main().catch((error) => {
  process.stderr.write(
    `[winkgo-desktop-computer-use] Fatal error: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
