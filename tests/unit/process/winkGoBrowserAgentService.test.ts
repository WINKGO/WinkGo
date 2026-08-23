/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const inspect = vi.fn();
const act = vi.fn();
const plan = vi.fn();
const listSkills = vi.fn(() => []);
const getLoginPermission = vi.fn(async () => ({ enabled: false }));

vi.mock('@process/services/winkGoBrowserControlService', () => ({
  inspectWinkGoBrowserPage: inspect,
  executeWinkGoBrowserAction: act,
}));
vi.mock('@process/services/winkGoBrowserSkillAiService', () => ({
  planWinkGoBrowserAgentStep: plan,
}));
vi.mock('@process/services/winkGoBrowserSkillsService', () => ({
  listWinkGoBrowserSkills: listSkills,
}));
vi.mock('@process/services/winkGoBrowserLoginPermissionService', () => ({
  getWinkGoBrowserLoginPermission: getLoginPermission,
}));

const snapshot = (elementName = 'Search') => ({
  ok: true,
  attached: true,
  snapshotId: 'snapshot-1',
  url: 'https://example.com',
  title: 'Example',
  text: elementName,
  elements: [
    {
      ref: 'snapshot-1-e1',
      tag: 'button',
      role: 'button',
      name: elementName,
      text: elementName,
      disabled: false,
    },
  ],
});

describe('WINK GO autonomous browser agent', () => {
  let service: typeof import('@process/services/winkGoBrowserAgentService');

  beforeEach(async () => {
    vi.clearAllMocks();
    getLoginPermission.mockResolvedValue({ enabled: false });
    inspect.mockResolvedValue(snapshot());
    act.mockResolvedValue({ ok: true, action: 'click', url: 'https://example.com', title: 'Example' });
    service = await import('@process/services/winkGoBrowserAgentService');
  });

  it('observes again after an action and completes only after verification', async () => {
    plan
      .mockResolvedValueOnce({
        status: 'act',
        message: 'Click search',
        action: { action: 'click', ref: 'snapshot-1-e1' },
      })
      .mockResolvedValueOnce({ status: 'done', message: 'The result is visible.' });

    const result = await service.runWinkGoBrowserAgentTask({ goal: 'Open the result', maxSteps: 4 });

    expect(result.status).toBe('completed');
    expect(result.ok).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(act).toHaveBeenCalledWith({ action: 'click', ref: 'snapshot-1-e1' });
  });

  it('keeps the user-selected model attached to every browser planning turn', async () => {
    plan.mockResolvedValue({ status: 'done', message: 'The result is visible.' });
    const model = { providerId: 'provider-fixture', model: 'vision-model-fixture' };

    const result = await service.runWinkGoBrowserAgentTask({ goal: 'Inspect this page', model });

    expect(result.ok).toBe(true);
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ model }));
  });

  it('pauses before a sensitive action instead of clicking it', async () => {
    inspect.mockResolvedValue(snapshot('删除账号'));
    plan.mockResolvedValue({
      status: 'act',
      message: 'Delete account',
      action: { action: 'click', ref: 'snapshot-1-e1' },
    });

    const result = await service.runWinkGoBrowserAgentTask({ goal: 'Delete my account' });

    expect(result.status).toBe('blocked');
    expect(result.message).toContain('需要用户明确确认');
    expect(act).not.toHaveBeenCalled();
  });

  it('blocks login and QR controls while the user permission is disabled', async () => {
    inspect.mockResolvedValue(snapshot('扫码登录'));
    plan.mockResolvedValue({
      status: 'act',
      message: 'Open QR login',
      action: { action: 'click', ref: 'snapshot-1-e1' },
    });

    const result = await service.runWinkGoBrowserAgentTask({ goal: '扫码登录' });

    expect(result.status).toBe('blocked');
    expect(result.message).toContain('设置中开启');
    expect(act).not.toHaveBeenCalled();
  });

  it('allows login and QR controls after the user accepted the permission disclaimer', async () => {
    getLoginPermission.mockResolvedValue({ enabled: true });
    inspect.mockResolvedValue(snapshot('扫码登录'));
    plan
      .mockResolvedValueOnce({
        status: 'act',
        message: 'Open QR login',
        action: { action: 'click', ref: 'snapshot-1-e1' },
      })
      .mockResolvedValueOnce({ status: 'done', message: 'QR code is visible.' });

    const result = await service.runWinkGoBrowserAgentTask({ goal: '打开扫码登录', maxSteps: 3 });

    expect(result.status).toBe('completed');
    expect(act).toHaveBeenCalledWith({ action: 'click', ref: 'snapshot-1-e1' });
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ loginAutomationEnabled: true }));
  });

  it('still requires the user to enter password and OTP values manually', async () => {
    getLoginPermission.mockResolvedValue({ enabled: true });
    inspect.mockResolvedValue(snapshot('登录密码'));
    plan.mockResolvedValue({
      status: 'act',
      message: 'Fill password',
      action: { action: 'fill', ref: 'snapshot-1-e1', value: 'should-not-be-used' },
    });

    const result = await service.runWinkGoBrowserAgentTask({ goal: '登录账号' });

    expect(result.status).toBe('blocked');
    expect(result.message).toContain('用户本人');
    expect(act).not.toHaveBeenCalled();
  });

  it('stops a repeated action loop', async () => {
    plan.mockResolvedValue({
      status: 'act',
      message: 'Keep scrolling',
      action: { action: 'scroll', deltaY: 600 },
    });
    act.mockResolvedValue({ ok: true, action: 'scroll', url: 'https://example.com', title: 'Example' });

    const result = await service.runWinkGoBrowserAgentTask({ goal: 'Find the report', maxSteps: 6 });

    expect(result.status).toBe('stalled');
    expect(act).toHaveBeenCalledTimes(2);
  });

  it('releases the active task immediately when its caller aborts during a stalled planner request', async () => {
    const controller = new AbortController();
    plan.mockReturnValueOnce(new Promise(() => undefined));
    const running = service.runWinkGoBrowserAgentTask({ goal: 'Fill a form' }, { signal: controller.signal });

    await vi.waitFor(() => expect(plan).toHaveBeenCalledOnce());
    controller.abort();
    const cancelled = await Promise.race([
      running,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 250)),
    ]);

    expect(cancelled).toEqual(expect.objectContaining({ status: 'blocked' }));

    plan.mockResolvedValueOnce({ status: 'done', message: 'A fresh task can start.' });
    await expect(service.runWinkGoBrowserAgentTask({ goal: 'Inspect the next page' })).resolves.toEqual(
      expect.objectContaining({ ok: true, status: 'completed' })
    );
  });
});
