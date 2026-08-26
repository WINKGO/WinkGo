// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/pages/settings/components/JsonImportModal', () => ({
  default: ({ visible }: { visible: boolean }) => (visible ? <div data-testid='json-import-modal' /> : null),
}));

import AddMcpServerModal from '@/renderer/pages/settings/components/AddMcpServerModal';

describe('MCP import flows', () => {
  it('opens only the JSON import modal from the public MCP add flow', async () => {
    render(<AddMcpServerModal visible onCancel={vi.fn()} onSubmit={vi.fn()} onBatchImport={vi.fn()} />);

    expect(await screen.findByTestId('json-import-modal')).toBeInTheDocument();
    expect(screen.queryByText('settings.mcpImportDescription')).toBeNull();
  });
});
