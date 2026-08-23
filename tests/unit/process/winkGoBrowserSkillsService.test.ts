/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-browser-skills-test-'));

class FakeBrowserContents extends EventEmitter {
  readonly id = 73;
  readonly executedScripts: string[] = [];
  private actionResults: Array<{ ok: boolean; reason?: string }> = [];
  private stallSnapshot = false;
  private url = 'https://example.com/login';

  getType = (): string => 'webview';
  getURL = (): string => this.url;
  getTitle = (): string => 'Example';
  isDestroyed = (): boolean => false;
  executeJavaScript = (script: string): Promise<unknown> => {
    this.executedScripts.push(script);
    if (script.includes('interactiveSelector')) {
      if (this.stallSnapshot) {
        this.stallSnapshot = false;
        return new Promise(() => {});
      }
      return Promise.resolve({
        text: 'Secure login Sign in',
        elements: [{ ref: 'recovered-sign-in', tag: 'button', role: 'button', name: 'Sign in', text: 'Sign in' }],
      });
    }
    return Promise.resolve(script.includes('const request =') ? this.actionResults.shift() || { ok: true } : true);
  };
  loadURL = (url: string): Promise<void> => {
    this.url = url;
    return Promise.resolve();
  };
  queueActionResults = (...results: Array<{ ok: boolean; reason?: string }>): void => {
    this.actionResults.push(...results);
  };
  stallNextSnapshot = (): void => {
    this.stallSnapshot = true;
  };
}

const fakeBrowser = new FakeBrowserContents();
const fakeBridge = {
  attachedWebContentsId: (): number => fakeBrowser.id,
  onAttached: (): (() => void) => () => {},
};

vi.mock('electron', () => ({
  app: { getPath: (): string => temporaryRoot },
  webContents: { fromId: (id: number): FakeBrowserContents | null => (id === fakeBrowser.id ? fakeBrowser : null) },
}));
vi.mock('@process/utils/cdpBridgeRegistry', () => ({ getCdpBridgeHandle: () => fakeBridge }));
vi.mock('@process/services/WinkGoCloudAuthService', () => ({
  winkGoCloudAuthService: { getSession: () => ({ user: { id: 'test-user' } }) },
}));

describe('WINK GO browser skill recorder', () => {
  let service: typeof import('@process/services/winkGoBrowserSkillsService');
  let savedSkillId = '';

  beforeAll(async () => {
    service = await import('@process/services/winkGoBrowserSkillsService');
  }, 60_000);

  afterAll(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

  it('normalizes skill names without allowing path traversal', () => {
    expect(service.toSafeBrowserSkillId('../../Daily Report')).toBe('daily-report');
    expect(service.toSafeBrowserSkillId('  每日报表  ')).toBe('每日报表');
  });

  it('removes credentials and secret query parameters from recorded URLs', () => {
    expect(
      service.sanitizeRecordedBrowserUrl('https://user:pass@example.com/report?date=today&access_token=secret#section')
    ).toBe('https://example.com/report?date=today#section');
    expect(service.sanitizeRecordedBrowserUrl('data:text/html,<b>secret</b>')).toBe('');
  });

  it('does not lock recorder controls while a complex page snapshot is pending', async () => {
    fakeBrowser.stallNextSnapshot();
    const started = await Promise.race([
      service.startWinkGoBrowserRecording(),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('start recording timed out')), 250)),
    ]);
    expect(started.ok).toBe(true);
    expect(service.getWinkGoBrowserRecorderStatus().phase).toBe('recording');
    expect((await service.cancelWinkGoBrowserRecording()).ok).toBe(true);
  });

  it('writes a complete package without persisting secret input values', async () => {
    expect((await service.startWinkGoBrowserRecording()).ok).toBe(true);
    fakeBrowser.emit(
      'console-message',
      {},
      0,
      '__WINKGO_BROWSER_SKILL_STEP__:' +
        JSON.stringify({
          type: 'input',
          selector: 'input[name="password"]',
          role: 'textbox',
          accessibleName: 'Password',
          fallbackText: 'Password',
          label: 'Password',
          sensitive: true,
          value: 'must-never-be-written',
        })
    );
    fakeBrowser.emit(
      'console-message',
      {},
      0,
      '__WINKGO_BROWSER_SKILL_STEP__:' +
        JSON.stringify({
          type: 'click',
          selector: 'button[type="submit"]',
          testId: 'sign-in',
          role: 'button',
          accessibleName: 'Sign in',
          fallbackText: 'Sign in',
        })
    );

    const saved = await service.stopAndSaveWinkGoBrowserRecording({
      name: 'Secure login flow',
      description: 'A deterministic login workflow',
    });
    expect(saved.ok).toBe(true);
    savedSkillId = saved.skill?.id || '';
    expect(saved.skill?.parameters).toEqual([
      expect.objectContaining({ key: 'secret_1', secret: true, required: true }),
    ]);

    const skillRoot = path.join(service.resolveBrowserSkillsRoot(), saved.skill?.id || 'missing');
    const fileNames = ['workflow.json', 'manifest.json', 'SKILL.md', 'TRACE_GUIDE.md', 'trace.json', 'meta.json'];
    fileNames.forEach((fileName) => expect(fs.existsSync(path.join(skillRoot, fileName))).toBe(true));
    const packageContents = fileNames
      .map((fileName) => fs.readFileSync(path.join(skillRoot, fileName), 'utf8'))
      .join('\n');
    expect(packageContents).not.toContain('must-never-be-written');
    const registryContents = fs.readFileSync(
      path.join(path.dirname(service.resolveBrowserSkillsRoot()), 'registry.json'),
      'utf8'
    );
    expect(registryContents).toContain('browser.skill.run');
    expect(registryContents).toContain(saved.skill?.id);
    expect(registryContents).not.toContain('must-never-be-written');
    expect(registryContents).not.toContain('button[type');
    const trace = JSON.parse(fs.readFileSync(path.join(skillRoot, 'trace.json'), 'utf8')) as {
      schema_version: string;
      events: Array<{ has_recorded_value?: boolean }>;
    };
    expect(trace.schema_version).toBe('winkgo_browser_trace_v1');
    expect(trace.events.length).toBeGreaterThanOrEqual(2);
    const bucketRoot = path.join(path.dirname(service.resolveBrowserSkillsRoot()), 'buckets');
    expect(fs.existsSync(bucketRoot)).toBe(true);
    const workflow = JSON.parse(fs.readFileSync(path.join(skillRoot, 'workflow.json'), 'utf8')) as {
      steps: Array<{
        parameterKey?: string;
        value?: string;
        testId?: string;
        role?: string;
        accessibleName?: string;
      }>;
    };
    expect(workflow.steps.some((step) => step.parameterKey === 'secret_1' && step.value === undefined)).toBe(true);
    expect(
      workflow.steps.some(
        (step) => step.testId === 'sign-in' && step.role === 'button' && step.accessibleName === 'Sign in'
      )
    ).toBe(true);

    const replayed = await service.runWinkGoBrowserSkill({
      skillId: saved.skill?.id || '',
      parameters: { secret_1: 'runtime-only-value' },
    });
    expect(replayed.ok).toBe(true);
    expect(fakeBrowser.executedScripts.some((script) => script.includes('runtime-only-value'))).toBe(true);
  });

  it('only persists a validated subset and order of existing workflow steps', async () => {
    const detail = service.getWinkGoBrowserSkill(savedSkillId);
    expect(detail?.steps.length).toBe(3);
    const retainedStepIds = detail?.steps.slice(1).map((step) => step.id) || [];
    const updated = await service.updateWinkGoBrowserSkillSteps({ skillId: savedSkillId, stepIds: retainedStepIds });
    expect(updated.ok).toBe(true);
    expect(service.getWinkGoBrowserSkill(savedSkillId)?.steps.map((step) => step.id)).toEqual(retainedStepIds);

    const invalid = await service.updateWinkGoBrowserSkillSteps({
      skillId: savedSkillId,
      stepIds: ['unknown-step'],
    });
    expect(invalid.ok).toBe(false);
  });

  it('retries a failed selector through a unique semantic page match', async () => {
    fakeBrowser.queueActionResults({ ok: true }, { ok: false, reason: 'target-not-found' }, { ok: true });
    const replayed = await service.runWinkGoBrowserSkill({
      skillId: savedSkillId,
      parameters: { secret_1: 'runtime-only-value' },
    });
    expect(replayed.ok).toBe(true);
    expect(fakeBrowser.executedScripts.at(-1)).toContain('recovered-sign-in');
  });
});
