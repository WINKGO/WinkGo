import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let temporaryDirectory = '';
let proxy: ChildProcessWithoutNullStreams | null = null;
let responses: Array<(message: Record<string, unknown>) => void> = [];

const request = (id: number, method: string, params: Record<string, unknown> = {}) =>
  new Promise<Record<string, unknown>>((resolve) => {
    responses.push(resolve);
    proxy!.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'winkgo-skills-proxy-'));
  const configPath = path.join(temporaryDirectory, 'enabled-skills.json');
  await writeFile(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      runtimeApi: 'http://127.0.0.1:65534',
      enabledSkillIds: ['smart_home', 'wechat'],
      allowedToolNames: ['homeassistant.check_connection', 'winkgo.wechat.list_favorites'],
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

  it('lists native smart-home tools without requiring the legacy Runtime process', async () => {
    const response = await request(3, 'tools/list');
    const tools = (response.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [];

    expect(response.error).toBeUndefined();
    expect(tools.some((tool) => tool.name === 'homeassistant.check_connection')).toBe(true);
    expect(tools.some((tool) => tool.name === 'winkgo.wechat.list_favorites')).toBe(true);
  });
});
