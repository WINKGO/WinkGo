// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listSkillFiles: vi.fn(),
  readSkillFile: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listSkillFiles: { invoke: mocks.listSkillFiles },
      readSkillFile: { invoke: mocks.readSkillFile },
    },
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  type Node = { name: string; relative_path: string; type: 'directory' | 'file'; children?: Node[] };
  const renderNodes = (
    nodes: Node[],
    onSelect?: (keys: string[], extra: { node: { props: { dataRef: Node } } }) => void
  ): React.ReactNode =>
    nodes.map((node) => (
      <React.Fragment key={node.relative_path}>
        <button type='button' onClick={() => onSelect?.([node.relative_path], { node: { props: { dataRef: node } } })}>
          {node.name}
        </button>
        {node.children ? renderNodes(node.children, onSelect) : null}
      </React.Fragment>
    ));

  return {
    ...actual,
    Tree: ({ treeData = [], onSelect }: { treeData?: Node[]; onSelect?: Parameters<typeof renderNodes>[1] }) => (
      <div data-testid='skill-file-tree'>{renderNodes(treeData, onSelect)}</div>
    ),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/pages/conversation/Preview/components/viewers/MarkdownViewer', () => ({
  default: ({ content, viewMode }: { content: string; viewMode?: string }) => (
    <div data-testid='markdown-viewer' data-view-mode={viewMode}>
      {content}
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Preview/components/editors/CodeEditor', () => ({
  default: ({ value, readOnly }: { value: string; readOnly?: boolean }) => (
    <div data-testid='code-editor' data-read-only={String(Boolean(readOnly))}>
      {value}
    </div>
  ),
}));

import SkillFileBrowser from '@/renderer/pages/settings/SkillsSettings/SkillFileBrowser';

describe('SkillFileBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects SKILL.md first and renders markdown read-only', async () => {
    mocks.listSkillFiles.mockResolvedValue([
      { name: 'SKILL.md', relative_path: 'SKILL.md', type: 'file' },
      { name: 'config.json', relative_path: 'config.json', type: 'file' },
    ]);
    mocks.readSkillFile.mockResolvedValue('# Demo');

    render(<SkillFileBrowser skill={{ name: 'demo', location: 'C:\\skills\\demo\\SKILL.md' }} />);

    await waitFor(() => expect(screen.getByTestId('markdown-viewer')).toHaveTextContent('# Demo'));
    expect(mocks.readSkillFile).toHaveBeenCalledWith({ skill_name: 'demo', relative_path: 'SKILL.md' });
    expect(screen.getByTestId('markdown-viewer')).toHaveAttribute('data-view-mode', 'preview');
  });

  it('renders non-markdown content in a read-only code editor', async () => {
    mocks.listSkillFiles.mockResolvedValue([{ name: 'config.json', relative_path: 'config.json', type: 'file' }]);
    mocks.readSkillFile.mockResolvedValue('{"enabled":true}');

    render(<SkillFileBrowser skill={{ name: 'demo', location: '/skills/demo/SKILL.md' }} />);

    await waitFor(() => expect(screen.getByTestId('code-editor')).toHaveAttribute('data-read-only', 'true'));
  });

  it('shows the translated failure state when listing fails', async () => {
    mocks.listSkillFiles.mockRejectedValue(new Error('unavailable'));

    render(<SkillFileBrowser skill={{ name: 'demo', location: '/skills/demo' }} />);

    await waitFor(() => expect(screen.getByText('settings.skillsHub.detailFilesError')).toBeInTheDocument());
  });
});
