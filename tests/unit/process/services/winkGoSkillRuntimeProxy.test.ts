import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let temporaryDirectory = '';
let proxy: ChildProcessWithoutNullStreams | null = null;
let browserSkillBridge: Server | null = null;
let responses: Array<(message: Record<string, unknown>) => void> = [];

const request = (id: number, method: string, params: Record<string, unknown> = {}) =>
  new Promise<Record<string, unknown>>((resolve) => {
    responses.push(resolve);
    proxy!.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'winkgo-skills-proxy-'));
  browserSkillBridge = createServer((incomingRequest, response) => {
    if (incomingRequest.headers.authorization !== 'Bearer test-browser-token') {
      response.writeHead(401, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false, message: 'Unauthorized' }));
      return;
    }
    if (incomingRequest.method === 'GET' && incomingRequest.url === '/winkgo/browser-skills') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, skills: [{ id: 'checkout', name: '结算流程' }] }));
      return;
    }
    if (incomingRequest.method === 'POST' && incomingRequest.url === '/winkgo/browser-skills/run') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, message: 'Browser Skill completed.' }));
      return;
    }
    if (incomingRequest.method === 'GET' && incomingRequest.url === '/winkgo/desktop-skills') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, skills: [{ id: 'daily-report', name: '日报整理' }] }));
      return;
    }
    if (incomingRequest.method === 'POST' && incomingRequest.url === '/winkgo/desktop-skills/run') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, message: 'Desktop Skill completed.' }));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: false, message: 'Not found' }));
  });
  await new Promise<void>((resolve) => browserSkillBridge!.listen(0, '127.0.0.1', resolve));
  const browserSkillAddress = browserSkillBridge.address();
  if (!browserSkillAddress || typeof browserSkillAddress === 'string')
    throw new Error('Browser Skill test bridge failed.');
  const configPath = path.join(temporaryDirectory, 'enabled-skills.json');
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      runtimeApi: 'http://127.0.0.1:65534',
      localBrowserSkillsEnabled: true,
      localDesktopSkillsEnabled: true,
      enabledSkillIds: ['smart_home', 'wechat'],
      allowedToolNames: [
        'homeassistant.check_connection',
        'winkgo.wechat.list_favorites',
        'winkgo.browser_skill.list',
        'winkgo.browser_skill.run',
        'winkgo.desktop_skill.list',
        'winkgo.desktop_skill.run',
        'windows.open_url',
        'windows.browser_search',
      ],
      allowedToolPrefixes: ['homeassistant.', 'wechat.'],
      skillPreferences: {
        wechat: {
          favoriteContacts: ['文件传输助手', '张三'],
          favoriteGroups: ['产品群'],
        },
        smartHome: {
          homeAssistantUrl: 'http://127.0.0.1:65533',
          credentialTarget: 'WINKGO.TEST.smart-home-token',
          appliances: [],
          scenes: [],
        },
      },
    }),
    'utf8'
  );
  const proxyPath = path.join(process.cwd(), 'resources', 'winkgo', 'winkgo-skill-runtime-proxy.cjs');
  proxy = spawn(process.execPath, [proxyPath, configPath, 'test'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      WINKGO_CDP_ACTIVE_PORT: String(browserSkillAddress.port),
      WINKGO_CDP_BRIDGE_TOKEN: 'test-browser-token',
    },
  });
  responses = [];
  const lines = readline.createInterface({ input: proxy.stdout, crlfDelay: Infinity });
  lines.on('line', (line) => {
    const resolve = responses.shift();
    if (resolve) resolve(JSON.parse(line));
  });
});

afterEach(async () => {
  proxy?.kill();
  proxy = null;
  await new Promise<void>((resolve) => browserSkillBridge?.close(() => resolve()) ?? resolve());
  browserSkillBridge = null;
  responses = [];
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('WINK GO Runtime Skills proxy', () => {
  it('returns local WeChat favorites without contacting Runtime', async () => {
    const response = await request(1, 'tools/call', {
      name: 'winkgo.wechat.list_favorites',
      arguments: {},
    });

    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({
      structuredContent: {
        favoriteContacts: ['文件传输助手', '张三'],
        favoriteGroups: ['产品群'],
      },
    });
  });

  it('blocks tools that the customer did not import', async () => {
    const response = await request(2, 'tools/call', {
      name: 'windows.shutdown',
      arguments: {},
    });

    expect(response.error).toMatchObject({
      code: -32000,
      message: 'Tool "windows.shutdown" is not enabled.',
    });
  });

  it('never exposes legacy external-browser tools to an Agent', async () => {
    const listResponse = await request(21, 'tools/list');
    const tools = (listResponse.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [];

    expect(tools.some((tool) => tool.name === 'windows.open_url')).toBe(false);
    expect(tools.some((tool) => tool.name?.startsWith('windows.browser_'))).toBe(false);

    const callResponse = await request(22, 'tools/call', {
      name: 'windows.open_url',
      arguments: { url: 'https://www.ctrip.com/' },
    });
    expect(callResponse.error).toMatchObject({
      code: -32000,
      message: 'Tool "windows.open_url" is not enabled.',
    });
  });

  it('lists native smart-home tools without requiring the legacy Runtime process', async () => {
    const response = await request(3, 'tools/list');
    const tools = (response.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [];

    expect(response.error).toBeUndefined();
    expect(tools.some((tool) => tool.name === 'homeassistant.check_connection')).toBe(true);
    expect(tools.some((tool) => tool.name === 'winkgo.wechat.list_favorites')).toBe(true);
    expect(tools.some((tool) => tool.name === 'winkgo.browser_skill.list')).toBe(true);
    expect(tools.some((tool) => tool.name === 'winkgo.browser_skill.run')).toBe(true);
    expect(tools.some((tool) => tool.name === 'winkgo.desktop_skill.list')).toBe(true);
    expect(tools.some((tool) => tool.name === 'winkgo.desktop_skill.run')).toBe(true);
  });

  it('lists and runs Browser Skills through the authenticated local bridge', async () => {
    const listResponse = await request(4, 'tools/call', {
      name: 'winkgo.browser_skill.list',
      arguments: {},
    });
    expect(listResponse.error).toBeUndefined();
    expect(listResponse.result).toMatchObject({
      structuredContent: { skills: [{ id: 'checkout', name: '结算流程' }] },
    });

    const runResponse = await request(5, 'tools/call', {
      name: 'winkgo.browser_skill.run',
      arguments: { skill_id: 'checkout', parameters: { account: 'demo' } },
    });
    expect(runResponse.error).toBeUndefined();
    expect(runResponse.result).toMatchObject({
      isError: false,
      structuredContent: { ok: true, message: 'Browser Skill completed.' },
    });
  });

  it('lists and runs Desktop Skills through the authenticated local bridge', async () => {
    const listResponse = await request(6, 'tools/call', {
      name: 'winkgo.desktop_skill.list',
      arguments: {},
    });
    expect(listResponse.error).toBeUndefined();
    expect(listResponse.result).toMatchObject({
      structuredContent: { skills: [{ id: 'daily-report', name: '日报整理' }] },
    });

    const runResponse = await request(7, 'tools/call', {
      name: 'winkgo.desktop_skill.run',
      arguments: { skill_id: 'daily-report', parameters: { date: 'today' } },
    });
    expect(runResponse.error).toBeUndefined();
    expect(runResponse.result).toMatchObject({
      isError: false,
      structuredContent: { ok: true, message: 'Desktop Skill completed.' },
    });
  });
});
