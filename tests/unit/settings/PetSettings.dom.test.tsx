// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

const { getPetEnabled, getPetSize, getPetDnd, getPetConfirmEnabled } = vi.hoisted(() => ({
  getPetEnabled: vi.fn(),
  getPetSize: vi.fn(() => Promise.resolve(280)),
  getPetDnd: vi.fn(() => Promise.resolve(false)),
  getPetConfirmEnabled: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  systemSettings: {
    getPetEnabled: { invoke: getPetEnabled },
    getPetSize: { invoke: getPetSize },
    getPetDnd: { invoke: getPetDnd },
    getPetConfirmEnabled: { invoke: getPetConfirmEnabled },
    setPetEnabled: { invoke: vi.fn(() => Promise.resolve()) },
    setPetSize: { invoke: vi.fn(() => Promise.resolve()) },
    setPetDnd: { invoke: vi.fn(() => Promise.resolve()) },
    setPetConfirmEnabled: { invoke: vi.fn(() => Promise.resolve()) },
  },
}));

vi.mock('@/common/config/configService', () => ({
  configService: { get: vi.fn(() => undefined), setLocal: vi.fn() },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/renderer/utils/platform', () => ({ isElectronDesktop: () => true }));
vi.mock('@/renderer/hooks/assistant/useTalkToButler', () => ({ useTalkToButler: () => vi.fn() }));
vi.mock('@/renderer/components/base/WinkGoScrollArea', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/renderer/components/settings/SettingsModal/contents/SystemModalContent/PreferenceRow', () => ({
  default: ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div data-testid={`row-${label}`}>{children}</div>
  ),
}));
vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'page',
}));

import PetSettings from '@/renderer/pages/settings/PetSettings';

const enableSwitch = () => within(screen.getByTestId('row-pet.enable')).getByRole('switch');

describe('desktop pet authoritative state', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('does not show enabled before the desktop value resolves', async () => {
    let resolve!: (value: boolean) => void;
    getPetEnabled.mockReturnValue(new Promise<boolean>((done) => (resolve = done)));

    render(<PetSettings />);
    expect(enableSwitch()).toBeDisabled();
    expect(enableSwitch()).toHaveAttribute('aria-checked', 'false');

    resolve(true);
    await waitFor(() => expect(enableSwitch()).not.toBeDisabled());
    expect(enableSwitch()).toHaveAttribute('aria-checked', 'true');
  });

  it('uses the authoritative disabled state', async () => {
    getPetEnabled.mockResolvedValue(false);
    render(<PetSettings />);
    await waitFor(() => expect(enableSwitch()).not.toBeDisabled());
    expect(enableSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('falls back to disabled when desktop state lookup fails', async () => {
    getPetEnabled.mockRejectedValue(new Error('ipc unavailable'));
    render(<PetSettings />);
    await waitFor(() => expect(enableSwitch()).not.toBeDisabled());
    expect(enableSwitch()).toHaveAttribute('aria-checked', 'false');
  });
});
