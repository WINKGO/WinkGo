/**
 * @license
 * Copyright 2026 WINK GO
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  selectFiles: vi.fn(),
  startConversion: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    winkGoFormat: {
      progress: { on: vi.fn(() => vi.fn()) },
      detectEngines: {
        invoke: vi.fn(async () => ({
          ffmpegAvailable: true,
          ffmpegPath: 'C:\\tools\\ffmpeg.exe',
          officeAvailable: true,
          officePath: 'C:\\tools\\wps.exe',
          officeEngine: 'WPS Office',
          ncmAvailable: true,
        })),
      },
      getDefaultOutputFolder: {
        invoke: vi.fn(async () => 'C:\\Users\\Tester\\Documents\\WINK GO 格式转换'),
      },
      selectFiles: { invoke: mocks.selectFiles },
      chooseOutputFolder: { invoke: vi.fn() },
      openOutput: { invoke: vi.fn() },
      startConversion: { invoke: mocks.startConversion },
    },
  },
}));

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('@renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import FormatStudioPage from '@renderer/pages/winkgo/FormatStudioPage';

describe('FormatStudioPage conversion action', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.navigate.mockClear();
    mocks.selectFiles.mockReset();
    mocks.startConversion.mockReset();
    mocks.startConversion.mockResolvedValue({ items: [], error: null });
  });

  it('keeps the start button visible and disabled before files are selected', async () => {
    render(<FormatStudioPage />);

    const startButton = await screen.findByTestId('format-start');
    expect(startButton.textContent).toContain('开始转换');
    expect(startButton).toBeDisabled();
  });

  it('enables the start button after a matching document is added and starts conversion', async () => {
    mocks.selectFiles.mockResolvedValue(['C:\\Users\\Tester\\Documents\\产品说明书.docx']);
    render(<FormatStudioPage />);

    fireEvent.click(await screen.findByTestId('format-tool-document_to_pdf'));
    fireEvent.click(screen.getByTestId('format-drop-zone'));

    const startButton = screen.getByTestId('format-start');
    await waitFor(() => expect(startButton).toBeEnabled());
    expect(screen.getByText('准备处理 1 个文件')).toBeTruthy();

    fireEvent.click(startButton);

    await waitFor(() =>
      expect(mocks.startConversion).toHaveBeenCalledWith(
        expect.objectContaining({
          preset: 'document_to_pdf',
          paths: ['C:\\Users\\Tester\\Documents\\产品说明书.docx'],
          outputFolder: 'C:\\Users\\Tester\\Documents\\WINK GO 格式转换',
        })
      )
    );
  });
});
