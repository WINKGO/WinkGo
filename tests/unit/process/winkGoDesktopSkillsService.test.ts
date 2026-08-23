/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DesktopSkillPackage } from '@/common/types/desktopAutomation';
import {
  RuntimeDesktopAutomationPort,
  WinkGoDesktopSkillRunner,
  WinkGoDesktopSkillsStore,
} from '@process/services/desktop-automation';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-desktop-skills-test-'));
  temporaryRoots.push(root);
  return root;
};

const createSkillPackage = (): DesktopSkillPackage => ({
  manifest: {
    schemaVersion: 'winkgo.desktop.skill.v1' as const,
    id: 'notepad-daily-note',
    name: 'Notepad daily note',
    description: 'Writes one deterministic note in Notepad.',
    runner: 'winkgo.desktop-skill.v1' as const,
    capability: 'desktop.automation.run',
    triggerPhrases: ['write my daily note'],
    parameters: [{ key: 'note', required: true, secret: false }],
  },
  workflow: {
    schemaVersion: 'winkgo.desktop.workflow.v1' as const,
    targetApp: { processName: 'notepad.exe', titlePattern: 'Notepad' },
    steps: [
      {
        id: 'write-note',
        kind: 'input' as const,
        locator: { controlType: 'Document' },
        parameterKey: 'note',
      },
    ],
    outcomeChecks: [
      {
        id: 'note-visible',
        kind: 'text_present' as const,
        parameterKey: 'note',
      },
    ],
  },
});

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('WINK GO desktop skill store', () => {
  it('rejects profile and skill ids that can escape the local skills root', async () => {
    const store = new WinkGoDesktopSkillsStore({ rootDir: createTemporaryRoot() });

    await expect(store.load('../other-profile', 'safe-skill')).rejects.toThrow('Invalid desktop skill profile id');
    await expect(store.load('default', '../../outside')).rejects.toThrow('Invalid desktop skill id');
  });

  it('saves and loads a complete profile-scoped local skill package', async () => {
    const rootDir = createTemporaryRoot();
    const store = new WinkGoDesktopSkillsStore({ rootDir, now: () => new Date('2026-08-09T10:00:00.000Z') });
    const skill = createSkillPackage();

    await store.save({ profileId: 'default', skill });

    await expect(store.load('default', skill.manifest.id)).resolves.toEqual(skill);
    expect(fs.readdirSync(path.join(rootDir, 'profiles', 'default', 'skills', skill.manifest.id)).toSorted()).toEqual([
      'SKILL.md',
      'manifest.json',
      'meta.json',
      'trace.json',
      'workflow.json',
    ]);
    expect(fs.existsSync(path.join(rootDir, 'profiles', 'default', 'registry.json'))).toBe(true);
  });

  it('never persists secret input values in the package or profile registry', async () => {
    const rootDir = createTemporaryRoot();
    const store = new WinkGoDesktopSkillsStore({ rootDir });
    const skill = createSkillPackage();
    skill.manifest.parameters[0] = { key: 'password', required: true, secret: true };
    const inputStep = skill.workflow.steps[0];
    if (inputStep.kind !== 'input') throw new Error('Expected an input step fixture');
    inputStep.parameterKey = 'password';
    inputStep.sensitive = true;
    inputStep.value = 'must-never-be-written';

    await store.save({ profileId: 'default', skill });

    const profileRoot = path.join(rootDir, 'profiles', 'default');
    const persistedContents = fs
      .readdirSync(path.join(profileRoot, 'skills', skill.manifest.id))
      .map((fileName) => fs.readFileSync(path.join(profileRoot, 'skills', skill.manifest.id, fileName), 'utf8'))
      .concat(fs.readFileSync(path.join(profileRoot, 'registry.json'), 'utf8'))
      .join('\n');
    expect(persistedContents).not.toContain('must-never-be-written');
    expect(await store.load('default', skill.manifest.id)).toEqual({
      ...skill,
      workflow: {
        ...skill.workflow,
        steps: [{ ...inputStep, value: undefined }],
      },
    });
  });

  it('lists and removes saved skills without escaping the profile root', async () => {
    const store = new WinkGoDesktopSkillsStore({ rootDir: createTemporaryRoot() });
    const skill = createSkillPackage();
    await store.save({ profileId: 'default', skill });

    await expect(store.list('default')).resolves.toEqual([
      expect.objectContaining({ id: skill.manifest.id, name: skill.manifest.name }),
    ]);
    await expect(store.remove('default', skill.manifest.id)).resolves.toBe(true);
    await expect(store.load('default', skill.manifest.id)).resolves.toBeNull();
    await expect(store.list('default')).resolves.toEqual([]);
  });
});

describe('WINK GO desktop Runtime port', () => {
  it('maps the exact Runtime target-not-found response and its bounded candidates', async () => {
    const callTool = vi.fn().mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            status: 'failed',
            reason: 'target-not-found',
            candidates: [{ id: 'current-uia-node', locator: { automationId: 'editor' } }],
          }),
        },
      ],
    });
    const port = new RuntimeDesktopAutomationPort({ callTool });

    await expect(
      port.executeStep({
        executionId: 'execution-runtime',
        targetApp: { processName: 'notepad.exe' },
        step: { id: 'click-editor', kind: 'click', locator: { automationId: 'old-editor' } },
        parameters: {},
        source: 'agent',
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({
      status: 'failed',
      reason: 'target-not-found',
      candidates: [{ id: 'current-uia-node', locator: { automationId: 'editor' } }],
    });
    expect(callTool).toHaveBeenCalledWith(
      'desktop_automation.execute_step',
      expect.objectContaining({ confirmed: true, execution_id: 'execution-runtime' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('fails closed when Runtime returns an unknown or malformed result', async () => {
    const port = new RuntimeDesktopAutomationPort({ callTool: vi.fn().mockResolvedValue({ content: [] }) });

    await expect(
      port.verifyOutcomes({
        executionId: 'execution-malformed',
        targetApp: { processName: 'notepad.exe' },
        checks: [],
        parameters: {},
        signal: new AbortController().signal,
      })
    ).resolves.toEqual({ ok: false, reason: 'runtime-result-invalid' });
  });
});

describe('WINK GO desktop skill runner', () => {
  it('runs saved workflow steps through the injected deterministic Runtime port', async () => {
    const executeStep = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const verifyOutcomes = vi.fn().mockResolvedValue({ ok: true });
    const runner = new WinkGoDesktopSkillRunner({
      runtimePort: { executeStep, verifyOutcomes, cancel: vi.fn() },
    });
    const skill = createSkillPackage();

    const result = await runner.run({
      executionId: 'execution-1',
      skill,
      parameters: { note: 'A real deterministic note' },
      source: 'desktop',
    });

    expect(result).toEqual({ executionId: 'execution-1', status: 'completed' });
    expect(executeStep).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: 'execution-1',
        step: skill.workflow.steps[0],
        parameters: { note: 'A real deterministic note' },
      })
    );
    expect(verifyOutcomes).toHaveBeenCalledWith(
      expect.objectContaining({ checks: skill.workflow.outcomeChecks, executionId: 'execution-1' })
    );
  });

  it('allows at most one AI recovery from the Runtime-provided candidate set', async () => {
    const executeStep = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'failed',
        reason: 'target-not-found',
        candidates: [{ id: 'candidate-1', locator: { automationId: 'editor' } }],
      })
      .mockResolvedValueOnce({
        status: 'failed',
        reason: 'verification-still-failed',
        candidates: [{ id: 'candidate-2', locator: { name: 'Other editor' } }],
      });
    const selectCandidate = vi.fn().mockResolvedValue({ candidateId: 'candidate-1' });
    const runner = new WinkGoDesktopSkillRunner({
      runtimePort: { executeStep, verifyOutcomes: vi.fn(), cancel: vi.fn() },
      recoveryPort: { selectCandidate },
    });

    const result = await runner.run({
      executionId: 'execution-repair',
      skill: createSkillPackage(),
      parameters: { note: 'Recover this target' },
      source: 'agent',
    });

    expect(result).toEqual({
      executionId: 'execution-repair',
      status: 'failed',
      reason: 'verification-still-failed',
    });
    expect(selectCandidate).toHaveBeenCalledTimes(1);
    expect(executeStep).toHaveBeenNthCalledWith(2, expect.objectContaining({ repairCandidateId: 'candidate-1' }));
  });

  it('does not report success when final outcome validation fails', async () => {
    const runner = new WinkGoDesktopSkillRunner({
      runtimePort: {
        executeStep: vi.fn().mockResolvedValue({ status: 'succeeded' }),
        verifyOutcomes: vi.fn().mockResolvedValue({ ok: false, reason: 'note-not-visible' }),
        cancel: vi.fn(),
      },
    });

    await expect(
      runner.run({
        executionId: 'execution-unverified',
        skill: createSkillPackage(),
        parameters: { note: 'Missing outcome' },
        source: 'island',
      })
    ).resolves.toEqual({ executionId: 'execution-unverified', status: 'failed', reason: 'note-not-visible' });
  });

  it('rejects a recovery candidate invented outside the Runtime candidate set', async () => {
    const executeStep = vi.fn().mockResolvedValue({
      status: 'failed',
      reason: 'target-not-found',
      candidates: [{ id: 'known-target', locator: { automationId: 'editor' } }],
    });
    const runner = new WinkGoDesktopSkillRunner({
      runtimePort: { executeStep, verifyOutcomes: vi.fn(), cancel: vi.fn() },
      recoveryPort: { selectCandidate: vi.fn().mockResolvedValue({ candidateId: 'invented-target' }) },
    });

    await expect(
      runner.run({
        executionId: 'execution-bounded-repair',
        skill: createSkillPackage(),
        parameters: { note: 'Do not click an invented target' },
        source: 'xiaozhi',
      })
    ).resolves.toEqual({ executionId: 'execution-bounded-repair', status: 'failed', reason: 'target-not-found' });
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it('returns cancelled instead of completed when an active execution is cancelled', async () => {
    let finishStep: ((result: { status: 'succeeded' }) => void) | undefined;
    const executeStep = vi.fn().mockImplementation(
      () =>
        new Promise<{ status: 'succeeded' }>((resolve) => {
          finishStep = resolve;
        })
    );
    const cancelRuntime = vi.fn();
    const verifyOutcomes = vi.fn().mockResolvedValue({ ok: true });
    const runner = new WinkGoDesktopSkillRunner({
      runtimePort: { executeStep, verifyOutcomes, cancel: cancelRuntime },
    });
    const running = runner.run({
      executionId: 'execution-cancel',
      skill: createSkillPackage(),
      parameters: { note: 'Do not finish this' },
      source: 'esp32',
    });
    await vi.waitFor(() => expect(executeStep).toHaveBeenCalledTimes(1));

    await expect(runner.cancel('execution-cancel')).resolves.toBe(true);
    finishStep?.({ status: 'succeeded' });

    await expect(running).resolves.toEqual({ executionId: 'execution-cancel', status: 'cancelled' });
    expect(cancelRuntime).toHaveBeenCalledWith('execution-cancel');
    expect(verifyOutcomes).not.toHaveBeenCalled();
  });
});
