/**
 * @license
 * Copyright 2026 WINK GO
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

import KnowledgeCanvasPage, {
  isKnowledgeCanvasBundleEnabled,
  resolveKnowledgeCanvasUrl,
} from '@renderer/pages/winkgo/KnowledgeCanvasPage';
import {
  buildKnowledgeCanvasAnalysisPrompt,
  KNOWLEDGE_CANVAS_BRIDGE_CHANNEL,
  normalizeKnowledgeCanvasAnalysis,
} from '@renderer/pages/winkgo/KnowledgeCanvasPage/knowledgeCanvasAiBridge';

const canvasBundlePath = resolve(process.cwd(), 'public/knowledge-canvas/index.html');
const describeBundledCanvas = existsSync(canvasBundlePath) ? describe : describe.skip;

describe('KnowledgeCanvasPage', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
  });

  it('resolves the bundled single-file canvas beside the renderer entry', () => {
    expect(
      resolveKnowledgeCanvasUrl('file:///C:/Program%20Files/WINK%20GO/resources/app.asar/out/renderer/index.html#/guid')
    ).toBe(
      'file:///C:/Program%20Files/WINK%20GO/resources/app.asar/out/renderer/knowledge-canvas/index.html?v=20260726-ai-bridge-1'
    );
    expect(resolveKnowledgeCanvasUrl('http://localhost:5173/#/guid')).toBe(
      'http://localhost:5173/knowledge-canvas/index.html?v=20260726-ai-bridge-1'
    );
  });

  it('fails closed when the reviewed canvas runtime is not part of the public build', () => {
    render(<KnowledgeCanvasPage />);

    expect(isKnowledgeCanvasBundleEnabled()).toBe(false);
    expect(screen.getByText('guid.knowledgeCanvas.unavailableTitle')).toBeTruthy();
    expect(screen.queryByTitle('guid.knowledgeCanvas.frameTitle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'guid.knowledgeCanvas.backToChat' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/guid');
  });

  describeBundledCanvas('bundled Knowledge Canvas asset', () => {
    it('ships the local-first canvas without its own logo or login system', () => {
      const bundle = readFileSync(canvasBundlePath, 'utf8');

      expect(bundle).toContain('wink-go-canvas-local');
      expect(bundle).toContain('WINK GO Canvans');
      expect(bundle).not.toContain('未检测到同源认证服务');
      expect(bundle).not.toContain('auth-login-button');
      expect(bundle).not.toContain('登录云端账户');
      expect(bundle).not.toContain('登录后复制');
      expect(bundle).not.toContain('brand__mark');
      expect(bundle).toContain(KNOWLEDGE_CANVAS_BRIDGE_CHANNEL);
      expect(bundle).not.toContain('离线演示（未读取外部内容）');
    });

    it('keeps saved explorations in a usable desktop drawer after the canvas remounts', () => {
      const bundle = readFileSync(canvasBundlePath, 'utf8');
      const desktopFixStart = bundle.indexOf('id="winkgo-project-library-desktop-fix"');
      const desktopFix = bundle.slice(desktopFixStart);

      expect(bundle).toContain('lumen.projects.v1.');
      expect(desktopFixStart).toBeGreaterThan(0);
      expect(desktopFix).toMatch(/\.project-library-backdrop\s*\{[\s\S]*?position:\s*fixed/);
      expect(desktopFix).toMatch(/\.project-library\s*\{[\s\S]*?display:\s*flex/);
      expect(desktopFix).toMatch(/\.project-list\s*\{[\s\S]*?overflow:\s*auto/);
    });
  });

  it('asks the host Agent for adaptive biography analysis instead of a fixed pipeline', () => {
    const prompt = buildKnowledgeCanvasAnalysisPrompt({
      channel: KNOWLEDGE_CANVAS_BRIDGE_CHANNEL,
      version: 1,
      type: 'analyze',
      requestId: 'request-1',
      input: 'https://www.bilibili.com/video/BV1woEg6SE87/',
      options: { inputType: 'url', density: 'detailed', mode: 'research' },
    });

    expect(prompt).toContain('公开字幕/自动字幕和时间戳');
    expect(prompt).toContain('成长背景、时间阶段、关键经历、重大决定、转折点');
    expect(prompt).toContain('不要强行生成和人物传记相同的节点');
    expect(prompt).toContain('18–30 个节点');
    expect(prompt).toContain('---WINKGO_CANVAS_JSON---');
  });

  it('normalizes Agent analysis and rejects a meaningless result', () => {
    expect(() =>
      normalizeKnowledgeCanvasAnalysis({
        schemaVersion: 1,
        title: '空画布',
        source: { title: '来源', platform: 'bilibili' },
        evidence: [],
        nodes: [{ id: 'only-one', title: '只有一个', summary: '', role: 'claim' }],
        edges: [],
      })
    ).toThrow('有效知识节点不足');
  });
});
