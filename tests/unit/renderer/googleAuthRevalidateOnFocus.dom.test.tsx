// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { swrCalls } = vi.hoisted(() => ({
  swrCalls: [] as Array<{ key: unknown; options: Record<string, unknown> }>,
}));

vi.mock('swr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('swr')>();
  const wrapped = (key: unknown, fetcher: unknown, options?: Record<string, unknown>) => {
    swrCalls.push({ key, options: options ?? {} });
    return (actual.default as unknown as (...args: unknown[]) => unknown)(key, fetcher, options);
  };
  return { ...actual, default: wrapped };
});

vi.mock('@/common', () => ({
  ipcBridge: {
    googleAuth: { status: { invoke: vi.fn(async () => ({ success: true })) } },
    google: { subscriptionStatus: { invoke: vi.fn(async () => ({ isSubscriber: false, lastChecked: 0 })) } },
  },
}));

vi.mock('@/renderer/services/clientBusinessSettings', () => ({
  getClientBusinessSetting: vi.fn(async () => ({ proxy: '' })),
}));

import { useGoogleAuthModels } from '@/renderer/hooks/agent/useGoogleAuthModels';

const Probe: React.FC = () => {
  useGoogleAuthModels();
  return null;
};

const optionFor = (keyMatch: string): Record<string, unknown> | undefined =>
  swrCalls.find((call) => typeof call.key === 'string' && call.key.startsWith(keyMatch))?.options;

beforeEach(() => {
  swrCalls.length = 0;
});

afterEach(() => cleanup());

describe('useGoogleAuthModels focus revalidation', () => {
  it('keeps external Google auth and subscription state fresh', async () => {
    render(<Probe />);

    await waitFor(() => expect(optionFor('google.auth.status')).toBeDefined());
    await waitFor(() => expect(optionFor('google.subscription.status')).toBeDefined());

    expect(optionFor('google.auth.status')?.revalidateOnFocus).toBe(true);
    expect(optionFor('google.subscription.status')?.revalidateOnFocus).toBe(true);
    expect(optionFor('settings.client.google.config')?.revalidateOnFocus).toBeUndefined();
  });
});
