/**
 * @license
 * Copyright 2025 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

const translations: Record<string, string> = {
  'common.winkGoWorkspace.inspirationCenter': 'Inspiration Center',
};

vi.mock('@/common', () => ({
  ipcBridge: {
    winkGoInspiration: {
      getSnapshot: { invoke: vi.fn(() => new Promise(() => undefined)) },
      saveProvider: { invoke: vi.fn() },
      testProvider: { invoke: vi.fn() },
      startMeituanLink: { invoke: vi.fn() },
      completeMeituanLink: { invoke: vi.fn() },
    },
  },
}));

vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({
    can: () => false,
  }),
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
  }),
}));

vi.mock('@renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@renderer/pages/settings/components/SettingsPageHeader', () => ({
  default: ({
    title,
    description,
    actions,
  }: {
    title: React.ReactNode;
    description: React.ReactNode;
    actions: React.ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
    </header>
  ),
}));

import InspirationCenterPage from '@renderer/pages/winkgo/InspirationCenterPage';

describe('InspirationCenterPage', () => {
  beforeEach(() => {
    mocks.navigate.mockClear();
  });

  it('opens the full life-service experience even when a legacy capability snapshot is empty', () => {
    render(<InspirationCenterPage />);

    expect(screen.getByTestId('inspiration-provider-didi-ride')).toBeInTheDocument();
    expect(screen.queryByText(/解锁 Pro|免费版|WINK GO Pro/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('inspiration-example-didi-ride')[0]);

    expect(mocks.navigate).toHaveBeenCalledWith('/guid', {
      state: {
        prefillPrompt: '查一下珠海站上车点',
        preservePrefillDraft: true,
        focusPrefill: true,
      },
    });
  });

  it('keeps providers that were only queued in the old project visibly locked', () => {
    render(<InspirationCenterPage />);

    fireEvent.click(screen.getByTestId('inspiration-provider-mcdonalds-china'));

    expect(screen.getByText('按顺序等待开放')).toBeTruthy();
    expect(screen.getByText(/旧工程中该服务本来就是接入计划项/)).toBeTruthy();
  });
});
