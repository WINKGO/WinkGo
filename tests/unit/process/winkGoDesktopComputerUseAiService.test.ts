/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import {
  parseWinkGoDesktopComputerUseAction,
  planWinkGoDesktopComputerUseStep,
  resolveWinkGoComputerUseModelForConversation,
  selectDefaultWinkGoComputerUseModel,
} from '@process/services/winkGoDesktopComputerUseAiService';

const mocks = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  readFile: vi.fn(),
  createRotatingClient: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: mocks.httpRequest }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('@/common/api', () => ({
  ClientFactory: { createRotatingClient: mocks.createRotatingClient },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const provider = (overrides: Partial<IProvider>): IProvider => ({
  id: 'provider-1',
  platform: 'new-api',
  name: 'Provider',
  base_url: 'https://example.test/v1',
  api_key: 'secret',
  models: ['text-model'],
  ...overrides,
});

describe('desktop Computer Use default visual model', () => {
  it('uses the model selected by the current WINK GO Agent conversation', async () => {
    mocks.httpRequest.mockImplementation(async (_method: string, pathname: string) => {
      if (pathname === '/api/providers') {
        return [provider({ id: 'provider-selected', models: ['gpt-5.4-mini'], enabled: true })];
      }
      if (pathname === '/api/conversations/conversation-selected') {
        return { model: { provider_id: 'provider-selected', model: 'gpt-5.4-mini' } };
      }
      throw new Error(`Unexpected request: ${pathname}`);
    });

    await expect(resolveWinkGoComputerUseModelForConversation('conversation-selected')).resolves.toEqual({
      providerId: 'provider-selected',
      model: 'gpt-5.4-mini',
    });
  });

  it('prefers an explicitly image-capable model over the provider list order', () => {
    const result = selectDefaultWinkGoComputerUseModel([
      provider({
        models: ['text-only', 'custom-vision'],
        model_settings: {
          'text-only': { image_input: 'unsupported' },
          'custom-vision': { image_input: 'supported' },
        },
      }),
    ]);

    expect(result).toEqual({ providerId: 'provider-1', model: 'custom-vision' });
  });

  it('never selects a model explicitly marked as not accepting screenshots', () => {
    const result = selectDefaultWinkGoComputerUseModel([
      provider({
        models: ['gpt-4o', 'text-only'],
        model_settings: {
          'gpt-4o': { image_input: 'unsupported' },
          'text-only': { image_input: 'unsupported' },
        },
      }),
    ]);

    expect(result).toBeNull();
  });

  it('falls back to a recognized vision model when capability is automatic', () => {
    const result = selectDefaultWinkGoComputerUseModel([provider({ models: ['plain-text', 'gpt-4o-mini'] })]);

    expect(result).toEqual({ providerId: 'provider-1', model: 'gpt-4o-mini' });
  });

  it('prefers the configured WINK GO GPT-5.6 visual model over review and image-generation utilities', () => {
    const result = selectDefaultWinkGoComputerUseModel([
      provider({ models: ['codex-auto-review', 'gpt-5.6-terra', 'gpt-image-2-count'] }),
    ]);

    expect(result).toEqual({ providerId: 'provider-1', model: 'gpt-5.6-terra' });
  });
});

describe('desktop Computer Use visual actions', () => {
  it('preserves line breaks in visible text input instead of flattening the document', () => {
    const action = parseWinkGoDesktopComputerUseAction(
      {
        kind: 'type',
        ref: 'editor',
        text: '任务状态：已完成\n成功项目：3\n失败项目：0',
        label: '写入多行验收数据',
      },
      {
        goal: '修改记事本文档并保留换行',
        model: { providerId: 'provider-1', model: 'vision-model' },
        observation: {
          target: {
            hwnd: 1,
            pid: 2,
            title: 'fixture.txt - Notepad',
            processName: 'notepad.exe',
            rect: { x: 0, y: 0, width: 800, height: 600 },
          },
          screenshotPath: 'screen.png',
          text: '',
          controls: [{ ref: 'editor', rect: { left: 10, top: 80, right: 790, bottom: 590 } }],
          ocr: [],
        },
        history: [],
      }
    );

    expect(action).toMatchObject({
      kind: 'type',
      text: '任务状态：已完成\n成功项目：3\n失败项目：0',
    });
  });

  it('types into the currently focused control when the action is already bound to the observed target window', () => {
    const action = parseWinkGoDesktopComputerUseAction(
      {
        kind: 'type',
        text: '服务器区域：待选择',
        label: '在当前查找框输入',
      },
      {
        goal: '修改记事本文档',
        model: { providerId: 'provider-1', model: 'vision-model' },
        observation: {
          target: {
            hwnd: 1,
            pid: 2,
            title: 'fixture.txt - Notepad',
            processName: 'notepad.exe',
            rect: { x: 0, y: 0, width: 800, height: 600 },
          },
          screenshotPath: 'screen.png',
          text: '查找和替换',
          controls: [],
          ocr: [],
        },
        history: [],
      }
    );

    expect(action).toEqual({
      kind: 'type',
      text: '服务器区域：待选择',
      label: '在当前查找框输入',
    });
  });

  it('preserves a successful select-all when the following type action also names the editor ref', () => {
    const action = parseWinkGoDesktopComputerUseAction(
      {
        kind: 'type',
        ref: 'editor',
        text: '任务结果：已通过',
        label: '替换全部文本',
      },
      {
        goal: '全选后替换记事本内容',
        model: { providerId: 'provider-1', model: 'vision-model' },
        observation: {
          target: {
            hwnd: 1,
            pid: 2,
            title: 'fixture.txt - Notepad',
            processName: 'notepad.exe',
            rect: { x: 0, y: 0, width: 800, height: 600 },
          },
          screenshotPath: 'screen.png',
          text: '原文已全选',
          controls: [{ ref: 'editor', rect: { left: 10, top: 80, right: 790, bottom: 590 } }],
          ocr: [],
        },
        history: [
          {
            action: { kind: 'hotkey', keys: ['CTRL', 'A'], label: '全选' },
            ok: true,
            message: '已全选',
          },
        ],
      }
    );

    expect(action).toEqual({
      kind: 'type',
      text: '任务结果：已通过',
      label: '替换全部文本',
    });
  });

  it.each(['complete', 'completed', 'success'])(
    'accepts the terminal status alias %s from compatible providers',
    async (status) => {
      mocks.httpRequest.mockResolvedValue([provider({ id: 'provider-1', models: ['gpt-5.6-sol'], enabled: true })]);
      mocks.readFile.mockResolvedValue(Buffer.from('png'));
      mocks.createRotatingClient.mockResolvedValue({
        createChatCompletion: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify({ status, message: '截图已经证明任务完成。' }) } }],
        }),
      });

      const decision = await planWinkGoDesktopComputerUseStep({
        goal: '完成桌面任务',
        model: { providerId: 'provider-1', model: 'gpt-5.6-sol' },
        observation: {
          target: {
            hwnd: 1,
            pid: 2,
            title: 'fixture.txt - Notepad',
            processName: 'notepad.exe',
            rect: { x: 0, y: 0, width: 800, height: 600 },
          },
          screenshotPath: 'screen.png',
          text: '任务状态：已完成',
          controls: [],
          ocr: [],
        },
        history: [],
      });

      expect(decision).toEqual({ status: 'done', message: '截图已经证明任务完成。' });
    }
  );

  it('accepts segmented text returned by an OpenAI-compatible visual model', async () => {
    mocks.httpRequest.mockResolvedValue([provider({ id: 'provider-1', models: ['gpt-5.6-sol'], enabled: true })]);
    mocks.readFile.mockResolvedValue(Buffer.from('png'));
    mocks.createRotatingClient.mockResolvedValue({
      createChatCompletion: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    status: 'act',
                    message: '打开明确的测试文档',
                    action: {
                      kind: 'open_file',
                      path: 'C:\\Users\\Administrator\\Desktop\\WINK-GO-Computer-Use-E2E.txt',
                      label: '打开验收文档',
                    },
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const decision = await planWinkGoDesktopComputerUseStep({
      goal: '打开桌面文档',
      model: { providerId: 'provider-1', model: 'gpt-5.6-sol' },
      observation: {
        target: {
          hwnd: 1,
          pid: 2,
          title: 'Desktop',
          processName: 'explorer.exe',
          rect: { x: 0, y: 0, width: 1920, height: 1080 },
        },
        screenshotPath: 'screen.png',
        text: '',
        controls: [],
        ocr: [],
      },
      history: [],
    });

    expect(decision).toEqual({
      status: 'act',
      message: '打开明确的测试文档',
      action: {
        kind: 'open_file',
        path: 'C:\\Users\\Administrator\\Desktop\\WINK-GO-Computer-Use-E2E.txt',
        label: '打开验收文档',
      },
    });
  });

  it('continues a valid visual action when a compatible provider returns the continue status alias', async () => {
    mocks.httpRequest.mockResolvedValue([provider({ id: 'provider-1', models: ['gpt-5.6-sol'], enabled: true })]);
    mocks.readFile.mockResolvedValue(Buffer.from('png'));
    mocks.createRotatingClient.mockResolvedValue({
      createChatCompletion: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                status: 'continue',
                message: '继续修改当前文档',
                action: { kind: 'hotkey', keys: ['CTRL', 'A'], label: '选中文档内容' },
              }),
            },
          },
        ],
      }),
    });

    const decision = await planWinkGoDesktopComputerUseStep({
      goal: '修改记事本并保存',
      model: { providerId: 'provider-1', model: 'gpt-5.6-sol' },
      observation: {
        target: {
          hwnd: 1,
          pid: 2,
          title: 'fixture.txt - Notepad',
          processName: 'notepad.exe',
          rect: { x: 0, y: 0, width: 800, height: 600 },
        },
        screenshotPath: 'screen.png',
        text: '项目状态：待处理',
        controls: [],
        ocr: [],
      },
      history: [],
    });

    expect(decision).toEqual({
      status: 'act',
      message: '继续修改当前文档',
      action: { kind: 'hotkey', keys: ['CTRL', 'A'], label: '选中文档内容' },
    });
  });

  it('uses a valid current-screen action when a compatible provider omits its status field', async () => {
    mocks.httpRequest.mockResolvedValue([provider({ id: 'provider-1', models: ['gpt-5.6-sol'], enabled: true })]);
    mocks.readFile.mockResolvedValue(Buffer.from('png'));
    mocks.createRotatingClient.mockResolvedValue({
      createChatCompletion: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                message: '保存当前文档',
                action: { kind: 'hotkey', keys: ['CTRL', 'S'], label: '保存文档' },
              }),
            },
          },
        ],
      }),
    });

    const decision = await planWinkGoDesktopComputerUseStep({
      goal: '修改记事本并保存',
      model: { providerId: 'provider-1', model: 'gpt-5.6-sol' },
      observation: {
        target: {
          hwnd: 1,
          pid: 2,
          title: 'fixture.txt - Notepad',
          processName: 'notepad.exe',
          rect: { x: 0, y: 0, width: 800, height: 600 },
        },
        screenshotPath: 'screen.png',
        text: '项目状态：已通过',
        controls: [],
        ocr: [],
      },
      history: [],
    });

    expect(decision).toEqual({
      status: 'act',
      message: '保存当前文档',
      action: { kind: 'hotkey', keys: ['CTRL', 'S'], label: '保存文档' },
    });
  });

  it('uses the first valid action when a compatible provider concatenates multiple JSON decisions', async () => {
    mocks.httpRequest.mockResolvedValue([provider({ id: 'provider-1', models: ['gpt-5.6-sol'], enabled: true })]);
    mocks.readFile.mockResolvedValue(Buffer.from('png'));
    const first = JSON.stringify({
      status: 'act',
      message: '在当前查找框输入第二处文字',
      action: { kind: 'type', text: '服务器区域：待选择' },
    });
    const second = JSON.stringify({
      status: 'act',
      message: '输入后再切换焦点',
      action: { kind: 'press', key: 'TAB' },
    });
    mocks.createRotatingClient.mockResolvedValue({
      createChatCompletion: vi.fn().mockResolvedValue({ choices: [{ message: { content: first + second } }] }),
    });

    const decision = await planWinkGoDesktopComputerUseStep({
      goal: '修改记事本文档',
      model: { providerId: 'provider-1', model: 'gpt-5.6-sol' },
      observation: {
        target: {
          hwnd: 1,
          pid: 2,
          title: 'fixture.txt - Notepad',
          processName: 'notepad.exe',
          rect: { x: 0, y: 0, width: 800, height: 600 },
        },
        screenshotPath: 'screen.png',
        text: '查找和替换',
        controls: [],
        ocr: [],
      },
      history: [],
    });

    expect(decision).toEqual({
      status: 'act',
      message: '在当前查找框输入第二处文字',
      action: { kind: 'type', text: '服务器区域：待选择', label: '' },
    });
  });

  it('accepts a safe application launch as part of the visual control loop', () => {
    const action = parseWinkGoDesktopComputerUseAction(
      { kind: 'launch', appName: '记事本', label: '打开记事本' },
      {
        goal: '打开记事本',
        model: { providerId: 'provider-1', model: 'vision-model' },
        observation: {
          target: {
            hwnd: 1,
            pid: 2,
            title: 'Desktop',
            processName: 'explorer.exe',
            rect: { x: 0, y: 0, width: 1920, height: 1080 },
          },
          screenshotPath: 'screen.png',
          text: '',
          controls: [],
          ocr: [],
        },
        history: [],
      }
    );

    expect(action).toEqual({ kind: 'launch', appName: '记事本', label: '打开记事本' });
  });

  it('rejects command lines and URLs as application names', () => {
    const input = {
      goal: '打开应用',
      model: { providerId: 'provider-1', model: 'vision-model' },
      observation: {
        target: {
          hwnd: 1,
          pid: 2,
          title: 'Desktop',
          processName: 'explorer.exe',
          rect: { x: 0, y: 0, width: 1920, height: 1080 },
        },
        screenshotPath: 'screen.png',
        text: '',
        controls: [],
        ocr: [],
      },
      history: [],
    };

    expect(parseWinkGoDesktopComputerUseAction({ kind: 'launch', appName: 'cmd /c calc' }, input)).toBeUndefined();
    expect(
      parseWinkGoDesktopComputerUseAction({ kind: 'launch', appName: 'https://example.com' }, input)
    ).toBeUndefined();
  });

  it('accepts only an explicit absolute local file for a visible open-file action', () => {
    const input = {
      goal: '打开桌面文档并在记事本里修改',
      model: { providerId: 'provider-1', model: 'vision-model' },
      observation: {
        target: {
          hwnd: 1,
          pid: 2,
          title: 'Desktop',
          processName: 'explorer.exe',
          rect: { x: 0, y: 0, width: 1920, height: 1080 },
        },
        screenshotPath: 'screen.png',
        text: '',
        controls: [],
        ocr: [],
      },
      history: [],
    };

    expect(
      parseWinkGoDesktopComputerUseAction(
        {
          kind: 'open_file',
          path: 'C:\\Users\\Administrator\\Desktop\\WINK-GO-Computer-Use-E2E.txt',
          label: '打开验收文档',
        },
        input
      )
    ).toEqual({
      kind: 'open_file',
      path: 'C:\\Users\\Administrator\\Desktop\\WINK-GO-Computer-Use-E2E.txt',
      label: '打开验收文档',
    });
    expect(parseWinkGoDesktopComputerUseAction({ kind: 'open_file', path: '..\\fixture.txt' }, input)).toBeUndefined();
    expect(
      parseWinkGoDesktopComputerUseAction({ kind: 'open_file', path: 'https://example.com/a.txt' }, input)
    ).toBeUndefined();
    expect(
      parseWinkGoDesktopComputerUseAction({ kind: 'open_file', path: 'C:\\a.txt\ncalc.exe' }, input)
    ).toBeUndefined();
  });
});
