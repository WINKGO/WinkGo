/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IProvider } from '@/common/config/storage';

const mocks = vi.hoisted(() => ({
  httpRequest: vi.fn(),
  createChatCompletion: vi.fn(),
  createRotatingClient: vi.fn(),
}));

vi.mock('@/common/adapter/httpBridge', () => ({ httpRequest: mocks.httpRequest }));
vi.mock('@/common/api', () => ({
  ClientFactory: { createRotatingClient: mocks.createRotatingClient },
}));

const provider = (imageInput: 'supported' | 'unsupported'): IProvider => ({
  id: 'vision-provider',
  platform: 'new-api',
  name: 'Vision Provider',
  base_url: 'https://example.test/v1',
  api_key: 'secret',
  enabled: true,
  models: ['vision-model'],
  model_settings: { 'vision-model': { image_input: imageInput } },
});

const snapshot = {
  ok: true,
  attached: true,
  snapshotId: 'snapshot-canvas',
  url: 'https://example.test/game',
  title: 'Canvas game',
  text: 'Canvas game 验证码 123456',
  viewport: { width: 400, height: 300 },
  screenshot: {
    dataUrl: 'data:image/jpeg;base64,ZmFrZS1pbWFnZQ==',
    width: 800,
    height: 600,
    viewportWidth: 400,
    viewportHeight: 300,
  },
  elements: [
    {
      ref: 'snapshot-canvas-e1',
      tag: 'canvas',
      role: 'application',
      name: 'Game canvas',
      text: '',
      disabled: false,
      bounds: { x: 0, y: 0, width: 400, height: 300 },
    },
  ],
};

describe('WINK GO browser visual planner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createRotatingClient.mockResolvedValue({ createChatCompletion: mocks.createChatCompletion });
  });

  it('sends the current browser screenshot and maps screenshot coordinates to the live viewport', async () => {
    mocks.httpRequest.mockResolvedValue([provider('supported')]);
    mocks.createChatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              status: 'act',
              message: 'Click the visible game control',
              action: { action: 'click', x: 400, y: 300 },
            }),
          },
        },
      ],
    });
    const { planWinkGoBrowserAgentStep } = await import('@process/services/winkGoBrowserSkillAiService');

    const result = await planWinkGoBrowserAgentStep({
      goal: '帮我点击游戏里的开始按钮，密码 abcdef，验证码 123456',
      snapshot,
      history: [],
      model: { providerId: 'vision-provider', model: 'vision-model' },
    });

    expect(result).toMatchObject({ status: 'act', action: { action: 'click', x: 200, y: 150 } });
    const request = mocks.createChatCompletion.mock.calls[0]?.[0];
    const userContent = request.messages[1].content;
    expect(userContent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'image_url', image_url: { url: snapshot.screenshot.dataUrl } }),
      ])
    );
    const textPart = userContent.find((part: { type?: string }) => part.type === 'text')?.text || '';
    expect(textPart).not.toContain('abcdef');
    expect(textPart).not.toContain('123456');
    expect(textPart).toContain('<secret>');
  });

  it('refuses a model explicitly marked as not accepting image input', async () => {
    mocks.httpRequest.mockResolvedValue([provider('unsupported')]);
    const { planWinkGoBrowserAgentStep } = await import('@process/services/winkGoBrowserSkillAiService');

    const result = await planWinkGoBrowserAgentStep({
      goal: 'Play the canvas game',
      snapshot,
      history: [],
      model: { providerId: 'vision-provider', model: 'vision-model' },
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('没有可用于自主浏览器的模型');
    expect(mocks.createRotatingClient).not.toHaveBeenCalled();
  });
});
