/**
 * Real Electron coverage for WINK GO's local browser skill recorder.
 *
 * The test uses a disposable WINK GO profile and a localhost-only form. It
 * records through the built-in browser toolbar, inspects the generated package, then
 * replays the saved workflow against the actual application webview.
 */

import type { Server } from 'node:http';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { BUILTIN_BROWSER_MCP_NAME } from '@/common/config/constants';
import type { IMcpServer } from '@/common/config/storage';
import type { Assistant } from '@/common/types/agent/assistantTypes';
import { expect, test } from '../../fixtures';
import { goToGuid, httpDelete, httpGet, httpPost } from '../../helpers';

process.env.WINKGO_CDP_PORT = '1';

type CreatedConversation = { id: string };

const SKILL_NAME = 'E2E 本地网页流程';
const FORM_PAGE = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>WINK GO Recorder Fixture</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        padding: 24px;
        color: #182233;
        font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
        background: linear-gradient(145deg, #edf3ff 0%, #f8fafc 50%, #eef8f4 100%);
      }
      main {
        display: grid;
        gap: 16px;
        max-width: 440px;
        margin: 0 auto;
        padding: 22px;
        border: 1px solid rgba(88, 112, 147, .16);
        border-radius: 18px;
        background: rgba(255, 255, 255, .94);
        box-shadow: 0 18px 50px rgba(57, 78, 112, .12);
      }
      h1 { margin: 0; font-size: 20px; }
      p { margin: -10px 0 2px; color: #6b778c; }
      label { display: grid; gap: 7px; font-weight: 650; }
      input, select, button {
        width: 100%;
        height: 42px;
        border: 1px solid #ccd5e3;
        border-radius: 11px;
        padding: 0 12px;
        font: inherit;
        background: #fff;
      }
      input:focus, select:focus { outline: 2px solid #6d8fff; border-color: transparent; }
      button {
        border: 0;
        color: #fff;
        font-weight: 700;
        cursor: pointer;
        background: linear-gradient(135deg, #536dfe, #7357e8);
      }
      output {
        min-height: 46px;
        padding: 12px 14px;
        border-radius: 11px;
        color: #23533f;
        font-weight: 750;
        overflow-wrap: anywhere;
        background: #eaf8f1;
      }
      output:empty::before { content: "等待录制或回放"; color: #7a8799; font-weight: 500; }
    </style>
  </head>
  <body>
    <main>
      <h1>网页流程演示</h1>
      <p>由 WINK GO 内置浏览器录制并确定性回放</p>
      <label>客户名称 <input id="customer" name="customer" aria-label="客户名称"></label>
      <label>优先级
        <select id="priority" name="priority" aria-label="优先级">
          <option value="normal">普通</option>
          <option value="high">紧急</option>
        </select>
      </label>
      <button id="preview" type="button">生成预览</button>
      <output id="result"></output>
    </main>
    <script>
      document.querySelector('#preview').addEventListener('click', () => {
        document.querySelector('#result').textContent =
          document.querySelector('#customer').value + ':' + document.querySelector('#priority').value;
      });
    </script>
  </body>
</html>`;

test.describe('Built-in browser skill recorder', () => {
  let server: Server;
  let fixtureUrl = '';
  let workspace = '';
  let conversationId = '';

  test.beforeAll(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-browser-recorder-e2e-'));
    server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(FORM_PAGE);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Failed to allocate the local recorder fixture port.');
    fixtureUrl = `http://127.0.0.1:${address.port}/workflow`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  test('AI control auto-opens and operates the visible in-app browser', async ({ page, electronApp }) => {
    test.setTimeout(90_000);
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setSize(1600, 1000);
      window?.center();
    });
    await goToGuid(page);

    let assistants: Assistant[] = [];
    await expect
      .poll(
        async () => {
          assistants = await httpGet<Assistant[]>(page, '/api/assistants').catch(() => []);
          return assistants.length;
        },
        { timeout: 30_000, message: 'Waiting for the isolated WINK GO assistant catalog' }
      )
      .toBeGreaterThan(0);
    const assistant = assistants.find((item) => item.enabled !== false);
    test.skip(!assistant, 'No enabled assistant is available to host the disposable conversation.');
    if (!assistant) return;

    const conversation = await httpPost<CreatedConversation>(page, '/api/conversations', {
      name: `Browser AI control E2E ${Date.now()}`,
      assistant: { id: assistant.id },
      extra: {
        workspace,
        custom_workspace: true,
        is_temporary_workspace: false,
        session_mode: 'default',
      },
    });
    conversationId = conversation.id;

    try {
      await page.evaluate((id) => {
        window.location.assign(`#/conversation/${id}`);
      }, conversationId);
      await page.waitForFunction((id) => window.location.hash === `#/conversation/${id}`, conversationId);
      await page.waitForFunction(() =>
        Object.keys(localStorage).some((key) => key.startsWith('winkgo_preview:project_'))
      );
      await page.waitForTimeout(500);
      await expect(page.locator('webview')).toHaveCount(0);

      const bridge = await electronApp.evaluate(() => ({
        port: process.env.WINKGO_CDP_ACTIVE_PORT || '',
        token: process.env.WINKGO_CDP_BRIDGE_TOKEN || '',
      }));
      expect(bridge.port).not.toBe('');
      expect(bridge.token).not.toBe('');

      const mcpServers = await httpGet<IMcpServer[]>(page, '/api/mcp/servers');
      const browserServer = mcpServers.find((mcpServer) => mcpServer.name === BUILTIN_BROWSER_MCP_NAME);
      expect(browserServer, 'The built-in WINK GO browser MCP must be registered').toBeTruthy();
      expect(browserServer?.enabled).toBe(true);
      expect(browserServer?.transport.type).toBe('stdio');
      if (!browserServer || browserServer.transport.type !== 'stdio') return;

      const inheritedEnvironment = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      );
      const transport = new StdioClientTransport({
        command: browserServer.transport.command,
        args: browserServer.transport.args,
        cwd: process.cwd(),
        env: {
          ...inheritedEnvironment,
          ...browserServer.transport.env,
          WINKGO_CDP_ACTIVE_PORT: bridge.port,
          WINKGO_CDP_BRIDGE_TOKEN: bridge.token,
        },
        stderr: 'pipe',
      });
      let mcpStderr = '';
      transport.stderr?.on('data', (chunk) => {
        mcpStderr += String(chunk);
      });
      const mcpClient = new Client({ name: 'winkgo-browser-e2e', version: '1.0.0' });
      try {
        await mcpClient.connect(transport);
      } catch (error) {
        throw new Error(
          [
            'The registered WINK GO browser MCP process did not complete its handshake.',
            `Transport: ${JSON.stringify(browserServer.transport)}`,
            `Entry exists: ${String(browserServer.transport.args?.[0] ? fs.existsSync(browserServer.transport.args[0]) : false)}`,
            `stderr: ${mcpStderr.trim() || '(empty)'}`,
          ].join('\n'),
          { cause: error }
        );
      }

      const tools = await mcpClient.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('browser_action');

      const runAction = async (action: Record<string, string>): Promise<void> => {
        const result = await mcpClient.callTool({ name: 'browser_action', arguments: action });
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
      };

      await runAction({ action: 'navigate', url: fixtureUrl });

      const addressInput = page.locator('.winkgo-url-viewer-toolbar .toolbar-input');
      await expect(addressInput).toBeVisible({ timeout: 15_000 });
      await expect(addressInput).toHaveValue(fixtureUrl);
      await expect
        .poll(
          () =>
            electronApp.evaluate(
              ({ webContents }, expectedUrl) =>
                webContents
                  .getAllWebContents()
                  .some((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl),
              fixtureUrl
            ),
          { timeout: 20_000, message: 'Waiting for AI navigation to attach the visible in-app browser' }
        )
        .toBe(true);

      await runAction({ action: 'fill', role: 'textbox', name: '客户名称', value: 'AI Browser' });
      await runAction({ action: 'select', role: 'combobox', name: '优先级', value: 'high' });
      await runAction({ action: 'click', role: 'button', name: '生成预览' });

      await expect
        .poll(
          () =>
            electronApp.evaluate(async ({ webContents }, expectedUrl) => {
              const target = webContents
                .getAllWebContents()
                .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
              return target ? target.executeJavaScript("document.querySelector('#result')?.textContent || ''") : '';
            }, fixtureUrl),
          { timeout: 10_000, message: 'Waiting for AI browser actions to update the visible page' }
        )
        .toBe('AI Browser:high');

      const fit = await page.locator('[data-project-preview-region]').evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          visible: rect.width > 0 && rect.height > 0,
          insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
        };
      });
      expect(fit).toEqual({ visible: true, insideViewport: true });

      await mcpClient.close();

      const artifactDirectory = path.join(process.cwd(), 'output', 'playwright');
      fs.mkdirSync(artifactDirectory, { recursive: true });
      const guestCapture = await electronApp.evaluate(async ({ webContents }, expectedUrl) => {
        const target = webContents
          .getAllWebContents()
          .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
        if (!target) throw new Error('AI-controlled browser webview was not available for visual capture.');
        return Array.from((await target.capturePage()).toPNG());
      }, fixtureUrl);
      fs.writeFileSync(path.join(artifactDirectory, 'winkgo-ai-browser-page.png'), Buffer.from(guestCapture));
      await page.screenshot({ path: path.join(artifactDirectory, 'winkgo-ai-browser-auto-open.png') });
    } finally {
      await httpDelete(page, `/api/conversations/${encodeURIComponent(conversationId)}`).catch(() => {});
      conversationId = '';
    }
  });

  test('records, packages, and replays a real browser workflow', async ({ page, electronApp }) => {
    test.setTimeout(120_000);
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setSize(1600, 1000);
      window?.center();
    });
    await goToGuid(page);

    let assistants: Assistant[] = [];
    await expect
      .poll(
        async () => {
          assistants = await httpGet<Assistant[]>(page, '/api/assistants').catch(() => []);
          return assistants.length;
        },
        { timeout: 30_000, message: 'Waiting for the isolated WINK GO backend and assistant catalog' }
      )
      .toBeGreaterThan(0);
    const assistant = assistants.find((item) => item.enabled !== false);
    test.skip(!assistant, 'No enabled assistant is available to host the disposable conversation.');
    if (!assistant) return;

    const conversation = await httpPost<CreatedConversation>(page, '/api/conversations', {
      name: `Browser recorder E2E ${Date.now()}`,
      assistant: { id: assistant.id },
      extra: {
        workspace,
        custom_workspace: true,
        is_temporary_workspace: false,
        session_mode: 'default',
      },
    });
    conversationId = conversation.id;

    try {
      await page.evaluate((id) => {
        localStorage.setItem('workspace-open-preference', 'browser');
        window.location.assign(`#/conversation/${id}`);
      }, conversationId);
      await page.waitForFunction((id) => window.location.hash === `#/conversation/${id}`, conversationId);
      const workspaceTools = page.locator('.workspace-open-button');
      await expect(workspaceTools).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator('.arco-message').filter({ hasText: /Provider\s+["']?\s*["']?\s+not found/i })
      ).toHaveCount(0);

      // Project conversations hydrate the hoisted preview scope after route
      // activation. The first Agent/ESP32 navigation must create the visible
      // browser automatically; a user should not need to find and click the
      // Explorer toolbar button before an AI browser task can start.
      await page.waitForFunction(() =>
        Object.keys(localStorage).some((key) => key.startsWith('winkgo_preview:project_'))
      );
      await page.waitForTimeout(1_000);
      const browserLauncher = page.getByTestId('conversation-browser-launcher');
      await expect(browserLauncher).toBeVisible({ timeout: 15_000 });
      const browserBridge = await electronApp.evaluate(() => ({
        port: process.env.WINKGO_CDP_ACTIVE_PORT || '',
        token: process.env.WINKGO_CDP_BRIDGE_TOKEN || '',
      }));
      expect(browserBridge.port).toMatch(/^\d+$/);
      expect(browserBridge.token.length).toBeGreaterThan(20);
      const browserBridgeBase = `http://127.0.0.1:${browserBridge.port}`;
      const browserBridgeHeaders = {
        Authorization: `Bearer ${browserBridge.token}`,
        'Content-Type': 'application/json',
      };
      const automaticOpen = (await (
        await fetch(`${browserBridgeBase}/winkgo/browser-control/action`, {
          method: 'POST',
          headers: browserBridgeHeaders,
          body: JSON.stringify({ action: 'navigate', url: fixtureUrl }),
        })
      ).json()) as { ok: boolean; message?: string };
      expect(automaticOpen.ok, automaticOpen.message).toBe(true);

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const raw = Object.entries(localStorage).find(([key]) => key.startsWith('winkgo_preview:project_'))?.[1];
              const state = raw
                ? (JSON.parse(raw) as { isOpen?: boolean; tabs?: Array<{ content_type?: string }> })
                : {};
              return {
                previewRegions: document.querySelectorAll('[data-project-preview-region]').length,
                isOpen: state.isOpen ?? null,
                tabTypes: state.tabs?.map((tab) => tab.content_type) ?? [],
              };
            }),
          { timeout: 10_000, message: 'Waiting for the visible Browser launcher to open the project preview' }
        )
        .toMatchObject({ previewRegions: 1, isOpen: true, tabTypes: ['browser'] });

      const addressInput = page.locator('.winkgo-url-viewer-toolbar .toolbar-input');
      await expect(addressInput).toBeVisible({ timeout: 15_000 });
      await expect(addressInput).toHaveValue(fixtureUrl);

      await expect
        .poll(
          () =>
            electronApp.evaluate(
              ({ webContents }, expectedUrl) =>
                webContents
                  .getAllWebContents()
                  .some((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl),
              fixtureUrl
            ),
          { timeout: 20_000, message: 'Waiting for the localhost fixture in the WINK GO browser webview' }
        )
        .toBe(true);

      // Prove the same visible webview is controllable through the
      // Agent/ESP32-facing browser control plane before recording anything.
      const snapshot = (await (
        await fetch(`${browserBridgeBase}/winkgo/browser-control/snapshot`, { headers: browserBridgeHeaders })
      ).json()) as {
        ok: boolean;
        title?: string;
        elements?: Array<{ role?: string; name?: string; ref?: string }>;
      };
      expect(snapshot.ok).toBe(true);
      expect(snapshot.title).toBe('WINK GO Recorder Fixture');
      expect(snapshot.elements?.some((element) => element.role === 'textbox' && element.name === '客户名称')).toBe(
        true
      );
      const runBrowserAction = async (action: Record<string, string>): Promise<void> => {
        const result = (await (
          await fetch(`${browserBridgeBase}/winkgo/browser-control/action`, {
            method: 'POST',
            headers: browserBridgeHeaders,
            body: JSON.stringify(action),
          })
        ).json()) as { ok: boolean; message?: string };
        expect(result.ok, result.message).toBe(true);
      };
      await runBrowserAction({ action: 'fill', role: 'textbox', name: '客户名称', value: 'Browser Control' });
      await runBrowserAction({ action: 'select', role: 'combobox', name: '优先级', value: 'high' });
      await runBrowserAction({ action: 'click', role: 'button', name: '生成预览' });
      await expect
        .poll(
          () =>
            electronApp.evaluate(async ({ webContents }, expectedUrl) => {
              const target = webContents
                .getAllWebContents()
                .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
              return target ? target.executeJavaScript("document.querySelector('#result')?.textContent || ''") : '';
            }, fixtureUrl),
          { timeout: 10_000, message: 'Waiting for the browser control plane to operate the visible webview' }
        )
        .toBe('Browser Control:high');
      await electronApp.evaluate(async ({ webContents }, expectedUrl) => {
        const target = webContents
          .getAllWebContents()
          .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
        if (!target) throw new Error('Recorder fixture webview was not found after direct browser control.');
        await target.reload();
      }, fixtureUrl);

      const recorderButton = page.getByTestId('browser-skill-toolbar-button');
      await expect(recorderButton).toBeVisible({ timeout: 15_000 });
      await recorderButton.click();
      const recorderPanel = page.getByTestId('browser-skill-toolbar-panel');
      await expect(recorderPanel).toBeVisible();
      await expect(recorderPanel.getByText(/Browser connected|浏览器已连接/i)).toBeVisible();
      await recorderPanel.getByRole('button', { name: /Start recording|开始录制/i }).click();
      await expect(recorderPanel.getByText(/Recording|正在录制/i)).toBeVisible();

      // Close the toolbar popover, then drive the actual guest page with
      // Playwright mouse and keyboard input. executeJavaScript is used only to
      // read element geometry; it never stages values or dispatches events.
      await recorderButton.click();
      await expect(recorderPanel).toBeHidden();
      const guestRects = await electronApp.evaluate(async ({ webContents }, expectedUrl) => {
        const target = webContents
          .getAllWebContents()
          .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
        if (!target) throw new Error('Recorder fixture webview was not found.');
        return target.executeJavaScript(`(() => {
          const rect = (selector) => {
            const value = document.querySelector(selector)?.getBoundingClientRect();
            if (!value) throw new Error('Missing fixture control: ' + selector);
            return { x: value.x, y: value.y, width: value.width, height: value.height };
          };
          return { customer: rect('#customer'), priority: rect('#priority'), preview: rect('#preview') };
        })()`);
      }, fixtureUrl);
      const guestView = page.locator('webview').last();
      const guestBox = await guestView.boundingBox();
      if (!guestBox) throw new Error('Built-in browser webview is not visible.');
      const clickGuest = async (rect: { x: number; y: number; width: number; height: number }): Promise<void> => {
        await page.mouse.click(guestBox.x + rect.x + rect.width / 2, guestBox.y + rect.y + rect.height / 2);
      };
      await clickGuest(guestRects.customer);
      await page.keyboard.type('WINK GO');
      await clickGuest(guestRects.priority);
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await clickGuest(guestRects.preview);

      await expect
        .poll(
          () =>
            electronApp.evaluate(async ({ webContents }, expectedUrl) => {
              const target = webContents
                .getAllWebContents()
                .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
              return target ? target.executeJavaScript("document.querySelector('#result')?.textContent || ''") : '';
            }, fixtureUrl),
          { timeout: 10_000, message: 'Waiting for real guest input to update the fixture result' }
        )
        .toBe('WINK GO:high');

      await recorderButton.click();
      await expect(recorderPanel).toBeVisible();
      await expect
        .poll(async () => recorderPanel.locator('.winkgo-browser-recorder__status strong').textContent())
        .toMatch(/(?:Recording|正在录制).*\b[3-9]\b/i);
      const captureInputs = recorderPanel.locator('.winkgo-browser-recorder__capture input');
      await captureInputs.nth(0).fill(SKILL_NAME);
      await captureInputs.nth(1).fill('真实应用内浏览器录制与确定性回放验收');
      await recorderPanel.getByRole('button', { name: /Stop and save|停止并保存/i }).click();
      const savedSkill = recorderPanel.locator('.winkgo-browser-recorder__skill').filter({ hasText: SKILL_NAME });
      await expect(savedSkill).toBeVisible({ timeout: 15_000 });

      await savedSkill.locator('.winkgo-browser-recorder__skill-summary').click();
      const stepEditor = savedSkill.getByTestId('browser-skill-step-editor');
      await expect(stepEditor).toBeVisible();
      const priorityStep = stepEditor.locator('[data-step-id]').filter({ hasText: /(?:选择|Select).*优先级/i });
      await expect(priorityStep).toBeVisible();
      await priorityStep.getByRole('button', { name: /Move step up|上移步骤/i }).click();
      await savedSkill.getByRole('button', { name: /^(Save|保存)$/i }).click();
      await expect(savedSkill.locator('.arco-btn-loading')).toHaveCount(0, { timeout: 10_000 });

      const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'));
      const profileRoot = path.join(userDataPath, 'winkgo-browser-skills', 'profiles', 'local');
      const registry = JSON.parse(fs.readFileSync(path.join(profileRoot, 'registry.json'), 'utf8')) as {
        command: string;
        skills: Array<{ skill_id: string; name: string }>;
      };
      const registryEntry = registry.skills.find((item) => item.name === SKILL_NAME);
      expect(registry.command).toBe('browser.skill.run');
      expect(registryEntry?.skill_id).toBeTruthy();

      const skillRoot = path.join(profileRoot, 'skills', registryEntry?.skill_id || 'missing');
      expect(fs.existsSync(path.join(skillRoot, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(skillRoot, 'TRACE_GUIDE.md'))).toBe(true);
      expect(fs.existsSync(path.join(skillRoot, 'trace.json'))).toBe(true);
      expect(fs.existsSync(path.join(skillRoot, 'meta.json'))).toBe(true);
      expect(fs.existsSync(path.join(skillRoot, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(skillRoot, 'workflow.json'))).toBe(true);
      const trace = JSON.parse(fs.readFileSync(path.join(skillRoot, 'trace.json'), 'utf8')) as {
        schema_version?: string;
        events?: unknown[];
      };
      expect(trace.schema_version).toBe('winkgo_browser_trace_v1');
      expect(trace.events?.length).toBeGreaterThanOrEqual(4);
      const workflow = JSON.parse(fs.readFileSync(path.join(skillRoot, 'workflow.json'), 'utf8')) as {
        steps: Array<{ type: string }>;
      };
      expect(workflow.steps.map((step) => step.type)).toEqual(
        expect.arrayContaining(['navigate', 'input', 'select', 'click'])
      );

      await electronApp.evaluate(async ({ webContents }, expectedUrl) => {
        const target = webContents
          .getAllWebContents()
          .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
        if (!target) throw new Error('Recorder fixture webview was not found before replay.');
        await target.executeJavaScript(`(() => {
          document.querySelector('#customer').value = '';
          document.querySelector('#priority').value = 'normal';
          document.querySelector('#result').textContent = '';
        })()`);
      }, fixtureUrl);

      await savedSkill.getByLabel(/Run skill|运行技能/i).click();
      await expect
        .poll(
          () =>
            electronApp.evaluate(async ({ webContents }, expectedUrl) => {
              const target = webContents
                .getAllWebContents()
                .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
              if (!target) return '';
              return target.executeJavaScript("document.querySelector('#result')?.textContent || ''");
            }, fixtureUrl),
          { timeout: 20_000, message: 'Waiting for the recorded workflow to recreate the form preview' }
        )
        .toBe('WINK GO:high');

      // The page result changes during the final click, slightly before the
      // main-process replay promise has finished its post-action checks. Wait
      // for the panel to leave its busy state so the test also proves the UI
      // is ready for the next recording instead of remaining stuck loading.
      await expect(recorderPanel.locator('.arco-btn-loading')).toHaveCount(0, { timeout: 10_000 });
      await expect(
        page.locator('.arco-message').filter({ hasText: /Provider\s+["']?\s*["']?\s+not found/i })
      ).toHaveCount(0);

      // The Agent/ESP32-facing dispatcher must invoke the exact same runner,
      // not a second replay implementation. Authenticate with the ephemeral
      // main-process token, list the saved skill, then run it through HTTP.
      await electronApp.evaluate(async ({ webContents }, expectedUrl) => {
        const target = webContents
          .getAllWebContents()
          .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
        if (!target) throw new Error('Recorder fixture webview was not found before dispatcher replay.');
        await target.executeJavaScript("document.querySelector('#result').textContent = ''");
      }, fixtureUrl);
      const dispatcher = await electronApp.evaluate(() => ({
        port: process.env.WINKGO_CDP_ACTIVE_PORT || '',
        token: process.env.WINKGO_CDP_BRIDGE_TOKEN || '',
      }));
      expect(dispatcher.port).toMatch(/^\d+$/);
      expect(dispatcher.token.length).toBeGreaterThan(20);
      const dispatcherBase = `http://127.0.0.1:${dispatcher.port}`;
      const unauthorized = await fetch(`${dispatcherBase}/winkgo/browser-skills`);
      expect(unauthorized.status).toBe(401);
      const dispatcherHeaders = { Authorization: `Bearer ${dispatcher.token}`, 'Content-Type': 'application/json' };
      const listed = (await (
        await fetch(`${dispatcherBase}/winkgo/browser-skills`, { headers: dispatcherHeaders })
      ).json()) as { ok: boolean; skills: Array<{ id: string }> };
      expect(listed.ok).toBe(true);
      expect(listed.skills.some((skill) => skill.id === registryEntry?.skill_id)).toBe(true);
      const dispatched = (await (
        await fetch(`${dispatcherBase}/winkgo/browser-skills/run`, {
          method: 'POST',
          headers: dispatcherHeaders,
          body: JSON.stringify({ skillId: registryEntry?.skill_id, parameters: {} }),
        })
      ).json()) as { ok: boolean; message?: string };
      expect(dispatched.ok, dispatched.message).toBe(true);
      await expect
        .poll(
          () =>
            electronApp.evaluate(async ({ webContents }, expectedUrl) => {
              const target = webContents
                .getAllWebContents()
                .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
              return target ? target.executeJavaScript("document.querySelector('#result')?.textContent || ''") : '';
            }, fixtureUrl),
          { timeout: 20_000, message: 'Waiting for the authenticated dispatcher to invoke the shared runner' }
        )
        .toBe('WINK GO:high');

      const artifactDirectory = path.join(process.cwd(), 'output', 'playwright');
      fs.mkdirSync(artifactDirectory, { recursive: true });
      await page.waitForTimeout(500);
      const browserCapture = await electronApp.evaluate(async ({ webContents }, expectedUrl) => {
        const target = webContents
          .getAllWebContents()
          .find((contents) => contents.getType() === 'webview' && contents.getURL() === expectedUrl);
        if (!target) throw new Error('Recorder fixture webview was not found for visual capture.');
        return Array.from((await target.capturePage()).toPNG());
      }, fixtureUrl);
      fs.writeFileSync(path.join(artifactDirectory, 'winkgo-builtin-browser-page.png'), Buffer.from(browserCapture));
      await page.screenshot({ path: path.join(artifactDirectory, 'winkgo-builtin-browser-replay.png') });
      await page.screenshot({ path: path.join(artifactDirectory, 'winkgo-browser-skill-toolbar.png') });
      await page.screenshot({ path: 'tests/e2e/results/browser-skill-recorder.e2e.png' });
    } finally {
      if (conversationId)
        await httpDelete(page, `/api/conversations/${encodeURIComponent(conversationId)}`).catch(() => {});
    }
  });

  test('records, saves, and replays a real Bing search', async ({ page, electronApp }) => {
    test.setTimeout(120_000);
    const realSiteSkillName = `Bing 搜索 WINK GO ${Date.now()}`;
    const searchText = 'WINK GO AI 助手';
    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.setSize(1600, 1000);
      window?.center();
    });
    await goToGuid(page);

    let assistants: Assistant[] = [];
    await expect
      .poll(
        async () => {
          assistants = await httpGet<Assistant[]>(page, '/api/assistants').catch(() => []);
          return assistants.length;
        },
        { timeout: 30_000, message: 'Waiting for the isolated WINK GO assistant catalog' }
      )
      .toBeGreaterThan(0);
    const assistant = assistants.find((item) => item.enabled !== false);
    test.skip(!assistant, 'No enabled assistant is available to host the disposable conversation.');
    if (!assistant) return;

    const conversation = await httpPost<CreatedConversation>(page, '/api/conversations', {
      name: `Real website recorder E2E ${Date.now()}`,
      assistant: { id: assistant.id },
      extra: {
        workspace,
        custom_workspace: true,
        is_temporary_workspace: false,
        session_mode: 'default',
      },
    });
    conversationId = conversation.id;

    try {
      await page.evaluate((id) => {
        localStorage.setItem('workspace-open-preference', 'browser');
        window.location.assign(`#/conversation/${id}`);
      }, conversationId);
      await page.waitForFunction((id) => window.location.hash === `#/conversation/${id}`, conversationId);
      await page.waitForFunction(() =>
        Object.keys(localStorage).some((key) => key.startsWith('winkgo_preview:project_'))
      );

      const bridge = await electronApp.evaluate(() => ({
        port: process.env.WINKGO_CDP_ACTIVE_PORT || '',
        token: process.env.WINKGO_CDP_BRIDGE_TOKEN || '',
      }));
      const base = `http://127.0.0.1:${bridge.port}`;
      const headers = { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' };
      const runAction = async (action: Record<string, unknown>): Promise<void> => {
        const response = await fetch(`${base}/winkgo/browser-control/action`, {
          method: 'POST',
          headers,
          body: JSON.stringify(action),
        });
        const payload = (await response.json()) as { ok: boolean; message?: string };
        expect(payload.ok, payload.message).toBe(true);
      };

      await runAction({ action: 'navigate', url: 'https://www.bing.com/' });
      await expect(page.locator('.winkgo-url-viewer-toolbar .toolbar-input')).toHaveValue(/bing\.com/i, {
        timeout: 20_000,
      });

      const recorderButton = page.getByTestId('browser-skill-toolbar-button');
      await expect(recorderButton).toBeVisible({ timeout: 15_000 });
      await recorderButton.click();
      const recorderPanel = page.getByTestId('browser-skill-toolbar-panel');
      await expect(recorderPanel.getByText(/Browser connected|浏览器已连接/i)).toBeVisible();
      await recorderPanel.getByRole('button', { name: /Start recording|开始录制/i }).click();
      await expect(recorderPanel.getByText(/Recording|正在录制/i)).toBeVisible();
      await expect(recorderPanel.locator('.arco-btn-loading')).toHaveCount(0, { timeout: 3_000 });

      await recorderButton.click();
      await runAction({ action: 'fill', selector: '#sb_form_q', value: searchText });
      await runAction({ action: 'press', selector: '#sb_form_q', key: 'Enter' });
      await expect
        .poll(
          () =>
            electronApp.evaluate(({ webContents }) => {
              const target = webContents
                .getAllWebContents()
                .find((contents) => contents.getType() === 'webview' && /bing\.com/.test(contents.getURL()));
              return target?.getURL() || '';
            }),
          { timeout: 20_000, message: 'Waiting for the real Bing search results page' }
        )
        .toContain('q=');

      await recorderButton.click();
      await expect(recorderPanel.getByText(/Recording|正在录制/i)).toBeVisible();
      const captureInputs = recorderPanel.locator('.winkgo-browser-recorder__capture input');
      await captureInputs.nth(0).fill(realSiteSkillName);
      await captureInputs.nth(1).fill('真实 Bing 搜索流程：打开、输入关键词并提交搜索');
      await recorderPanel.getByRole('button', { name: /Stop and save|停止并保存/i }).click();
      const savedSkill = recorderPanel.locator('.winkgo-browser-recorder__skill').filter({
        hasText: realSiteSkillName,
      });
      await expect(savedSkill).toBeVisible({ timeout: 20_000 });
      await expect(recorderPanel.getByText(/Recording|正在录制/i)).toHaveCount(0);
      await expect(recorderPanel.locator('.arco-btn-loading')).toHaveCount(0);

      await runAction({ action: 'navigate', url: 'https://www.bing.com/' });
      await savedSkill.getByLabel(/Run skill|运行技能/i).click();
      await expect
        .poll(
          () =>
            electronApp.evaluate(({ webContents }) => {
              const target = webContents
                .getAllWebContents()
                .find((contents) => contents.getType() === 'webview' && /bing\.com/.test(contents.getURL()));
              return target?.getURL() || '';
            }),
          { timeout: 30_000, message: 'Waiting for the saved skill to replay the real Bing search' }
        )
        .toContain('q=');
      await expect(recorderPanel.locator('.arco-btn-loading')).toHaveCount(0, { timeout: 10_000 });

      const artifactDirectory = path.join(process.cwd(), 'output', 'playwright');
      fs.mkdirSync(artifactDirectory, { recursive: true });
      await page.screenshot({ path: path.join(artifactDirectory, 'winkgo-real-bing-skill-replay.png') });
    } finally {
      if (conversationId) {
        await httpDelete(page, `/api/conversations/${encodeURIComponent(conversationId)}`).catch(() => {});
        conversationId = '';
      }
    }
  });
});
