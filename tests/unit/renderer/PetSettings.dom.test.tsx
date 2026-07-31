/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const talkToButler = vi.fn().mockResolvedValue(undefined);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/hooks/assistant/useTalkToButler', () => ({
  useTalkToButler: () => talkToButler,
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
}));

vi.mock('@/common/config/configService', () => ({
  configService: {
    get: vi.fn(() => undefined),
    setLocal: vi.fn(),
  },
}));

vi.mock('@/common/adapter/ipcBridge', () => ({
  systemSettings: {
    getPetEnabled: { invoke: vi.fn().mockResolvedValue(true) },
    getPetSize: { invoke: vi.fn().mockResolvedValue(280) },
    getPetDnd: { invoke: vi.fn().mockResolvedValue(false) },
    getPetConfirmEnabled: { invoke: vi.fn().mockResolvedValue(true) },
    setPetEnabled: { invoke: vi.fn().mockResolvedValue(undefined) },
    setPetSize: { invoke: vi.fn().mockResolvedValue(undefined) },
    setPetDnd: { invoke: vi.fn().mockResolvedValue(undefined) },
    setPetConfirmEnabled: { invoke: vi.fn().mockResolvedValue(undefined) },
  },
}));

import PetSettings from '@renderer/pages/settings/PetSettings';

describe('PetSettings', () => {
  it('opens the WINK GO butler with a desktop-pet prompt', () => {
    render(
      <MemoryRouter>
        <PetSettings />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'pet.butlerSetup' }));

    expect(talkToButler).toHaveBeenCalledWith({ prompt: 'pet.butlerSetupPrompt' });
  });

  it('re-shows an enabled desktop pet when the settings page opens', async () => {
    render(
      <MemoryRouter>
        <PetSettings />
      </MemoryRouter>
    );

    const { systemSettings } = await import('@/common/adapter/ipcBridge');
    await waitFor(() => expect(systemSettings.setPetEnabled.invoke).toHaveBeenCalledWith({ enabled: true }));
  });
});
