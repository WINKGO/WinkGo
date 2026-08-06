import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

let temporaryDirectory = '';
let proxy: ChildProcessWithoutNullStreams | null = null;
let runtimeServer: WebSocketServer | null = null;

afterEach(async () => {
  proxy?.kill();
  runtimeServer?.close();
  proxy = null;
  runtimeServer = null;
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('WINK GO Runtime Skills native alias routing', () => {
  it('does not rewrite a native shared music tool to the last imported provider', async () => {
    runtimeServer = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(runtimeServer, 'listening');
    const port = (runtimeServer.address() as AddressInfo).port;
    let receivedCall: Record<string, unknown> | null = null;
    runtimeServer.on('connection', (socket) => {
      socket.on('message', (buffer) => {
        const message = JSON.parse(buffer.toString()) as {
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
        };
        if (message.id === undefined) return;
        const result =
          message.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'music.open_music_app',
                    description: 'Open the selected music application',
                    inputSchema: { type: 'object', properties: { player: { type: 'string' } } },
                  },
                ],
              }
            : message.method === 'tools/call'
              ? ((receivedCall = message.params ?? null), { content: [{ type: 'text', text: '{"success":true}' }] })
              : { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'test', version: '1' } };
        socket.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
      });
    });

    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'winkgo-native-alias-'));
    const configPath = path.join(temporaryDirectory, 'enabled-skills.json');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: 1,
        runtimeApi: `http://127.0.0.1:${port}`,
        enabledSkillIds: ['netease_music', 'qq_music', 'soda_music'],
        allowedToolNames: ['music.open_music_app'],
        allowedToolPrefixes: [],
        compatibilityToolAliases: {
          'music.open_music_app': {
            canonicalToolName: 'music.station_open',
            defaultArguments: { player: 'fizz' },
            argumentRenames: {},
            dropArguments: [],
            argumentTransforms: {},
          },
        },
        skillPreferences: { wechat: { favoriteContacts: [], favoriteGroups: [] }, smartHome: {} },
      }),
      'utf8'
    );

    proxy = spawn(
      process.execPath,
      [path.join(process.cwd(), 'resources', 'winkgo', 'winkgo-skill-runtime-proxy.cjs'), configPath, 'test'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    const pending = new Map<number, (message: Record<string, unknown>) => void>();
    readline.createInterface({ input: proxy.stdout, crlfDelay: Infinity }).on('line', (line) => {
      const message = JSON.parse(line) as { id?: number };
      if (message.id !== undefined) pending.get(message.id)?.(message as Record<string, unknown>);
    });
    const request = (id: number, method: string, params: Record<string, unknown> = {}) =>
      new Promise<Record<string, unknown>>((resolve) => {
        pending.set(id, resolve);
        proxy!.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });

    await request(1, 'tools/list');
    const response = await request(2, 'tools/call', {
      name: 'music.open_music_app',
      arguments: { player: 'cloud', visible: true },
    });

    expect(response.error).toBeUndefined();
    expect(receivedCall).toEqual({
      name: 'music.open_music_app',
      arguments: { player: 'cloud', visible: true },
    });
  });
});
