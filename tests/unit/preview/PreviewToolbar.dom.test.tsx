/**
 * @vitest-environment jsdom
 *
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import PreviewToolbar from '@/renderer/pages/conversation/Preview/components/PreviewPanel/PreviewToolbar';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const baseProps = {
  content_type: 'code',
  isMarkdown: false,
  isHTML: false,
  viewMode: 'source' as const,
  isSplitScreenEnabled: false,
  showOpenInSystemButton: false,
  historyTarget: null,
  snapshotSaving: false,
  onViewModeChange: vi.fn(),
  onSplitScreenToggle: vi.fn(),
  onSaveSnapshot: vi.fn(),
  onRefreshHistory: vi.fn(),
  renderHistoryDropdown: vi.fn(),
  onOpenInSystem: vi.fn(),
  onDownload: vi.fn(),
  onClose: vi.fn(),
};

describe('PreviewToolbar save button', () => {
  it('saves an editable dirty file from the visible toolbar', () => {
    const onSave = vi.fn();
    render(<PreviewToolbar {...baseProps} showSave saveActionable onSave={onSave} />);

    fireEvent.click(screen.getByTestId('preview-save'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('keeps the save action visible but disabled for a clean file', () => {
    render(<PreviewToolbar {...baseProps} showSave saveActionable={false} onSave={vi.fn()} />);
    expect(screen.getByTestId('preview-save').className).toContain('cursor-not-allowed');
  });
});
