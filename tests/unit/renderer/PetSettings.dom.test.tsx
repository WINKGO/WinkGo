/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
});
