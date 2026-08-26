// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import GuidActionRow from '@/renderer/pages/guid/components/GuidActionRow';
import type { IMcpServer } from '@/common/config/storage';
import type { MobileActionSheetEntry } from '@/renderer/components/chat/MobileActionSheet/types';

const { layoutState, platformState, capturedMobileSheetProps } = vi.hoisted(() => ({
  layoutState: { isMobile: false },
  platformState: { isElectronDesktop: true },
  capturedMobileSheetProps: [] as Array<{ open: boolean; entries: MobileActionSheetEntry[] }>,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    dialog: {
      showOpen: { invoke: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: layoutState.isMobile }),
}));

vi.mock('@/renderer/components/agent/AgentModeSelector', () => ({
  default: () => <div data-testid='agent-mode-selector' />,
}));

vi.mock('@/renderer/components/chat/MobileActionSheet', () => ({
  default: (props: { open: boolean; entries: MobileActionSheetEntry[] }) => {
    capturedMobileSheetProps.push(props);
    return null;
  },
}));

vi.mock('@/renderer/services/FileService', () => ({
  getCleanFileNames: (files: string[]) => files,
  FileService: { processDroppedFiles: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => platformState.isElectronDesktop,
}));

const { navigateMock, emitMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  emitMock: vi.fn(),
}));
vi.mock('react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/renderer/utils/emitter', () => ({
  emitter: { emit: emitMock },
}));

vi.mock('@icon-park/react', () => {
  const Icon = () => <span aria-hidden='true' />;
  return {
    ArrowUp: Icon,
    Brain: Icon,
    Browser: Icon,
    Calendar: Icon,
    Computer: Icon,
    FolderUpload: Icon,
    Lightning: Icon,
    Plus: Icon,
    Puzzle: Icon,
    Search: Icon,
    Shield: Icon,
    UploadOne: Icon,
  };
});

vi.mock('@arco-design/web-react', () => {
  const Menu = Object.assign(
    ({
      children,
      className,
      onClickMenuItem,
    }: {
      children?: React.ReactNode;
      className?: string;
      onClickMenuItem?: (key: string) => void;
    }) => (
      <div
        data-testid='dropdown-menu'
        className={className}
        onClick={(event) => {
          const key = (event.target as HTMLElement).closest<HTMLElement>('[data-menu-key]')?.dataset.menuKey;
          if (key) onClickMenuItem?.(key);
        }}
      >
        {children}
      </div>
    ),
    {
      Item: ({
        children,
        className,
        onClick,
      }: {
        children?: React.ReactNode;
        className?: string;
        onClick?: (e: React.MouseEvent) => void;
        key?: React.Key;
      }) => (
        <div role='menuitem' className={className} onClick={onClick}>
          {children}
        </div>
      ),
      // SubMenu renders both the title row and its children so tests can inspect both levels.
      SubMenu: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
        <div role='group'>
          <div data-testid='submenu-title'>{title}</div>
          <div data-testid='submenu-body'>{children}</div>
        </div>
      ),
    }
  );
  return {
    Button: ({
      children,
      disabled,
      onClick,
      ...props
    }: {
      children?: React.ReactNode;
      disabled?: boolean;
      onClick?: () => void;
      [key: string]: unknown;
    }) => (
      <button type='button' disabled={disabled} onClick={onClick} {...props}>
        {children}
      </button>
    ),
    Checkbox: ({
      children,
      checked,
      onChange,
    }: {
      children?: React.ReactNode;
      checked?: boolean;
      onChange?: () => void;
    }) => (
      <label>
        <input type='checkbox' checked={checked ?? false} onChange={() => onChange?.()} />
        {children}
      </label>
    ),
    Dropdown: ({ children, droplist }: { children?: React.ReactNode; droplist?: React.ReactNode }) => (
      <div>
        {children}
        {droplist}
      </div>
    ),
    Menu,
    Message: { success: vi.fn(), error: vi.fn() },
    Tooltip: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  };
});

const makeSkills = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ name: `skill-${i}`, description: '', isAuto: false }));

const makeMcpServers = (count: number): IMcpServer[] =>
  Array.from({ length: count }, (_, i) => ({ id: `mcp-${i}`, name: `server-${i}` }) as IMcpServer);

const renderActionRow = (overrides: Partial<React.ComponentProps<typeof GuidActionRow>> = {}) =>
  render(
    <GuidActionRow
      files={[]}
      onFilesUploaded={vi.fn()}
      modelSelectorNode={null}
      isGeminiMode={false}
      modelList={[]}
      current_model={undefined}
      setCurrentModel={vi.fn()}
      currentAcpCachedModelInfo={null}
      selectedAcpModel={null}
      setSelectedAcpModel={vi.fn()}
      selectedMode=''
      onModeSelect={vi.fn()}
      allSkills={makeSkills(8)}
      disabledBuiltinSkills={[]}
      enabledSkills={[]}
      onToggleSkill={vi.fn()}
      mcpServers={makeMcpServers(8)}
      selectedMcpServerIds={[]}
      onToggleMcpServer={vi.fn()}
      loading={false}
      isButtonDisabled={false}
      onSend={vi.fn()}
      {...overrides}
    />
  );

describe('GuidActionRow skill/MCP submenu search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layoutState.isMobile = false;
    platformState.isElectronDesktop = true;
    capturedMobileSheetProps.length = 0;
  });

  it('shows the full WINK GO capability menu in the welcome composer', () => {
    renderActionRow();

    expect(screen.getByText('桌面 Computer Use')).toBeInTheDocument();
    expect(screen.getByText('WINK GO 浏览器 Computer Use')).toBeInTheDocument();
    expect(screen.getByText('cron.scheduledTasks')).toBeInTheDocument();
    expect(screen.getByText('Add or manage skills')).toBeInTheDocument();
    expect(screen.getByText('Open Tools settings')).toBeInTheDocument();
  });

  it('shows both search boxes when skills and MCP servers exceed the threshold', () => {
    renderActionRow();

    expect(screen.getByTestId('guid-skill-search')).toBeInTheDocument();
    expect(screen.getByTestId('guid-mcp-search')).toBeInTheDocument();
  });

  it('hides the search boxes when the lists are at or below the threshold', () => {
    renderActionRow({ allSkills: makeSkills(5), mcpServers: makeMcpServers(5) });

    expect(screen.queryByTestId('guid-skill-search')).not.toBeInTheDocument();
    expect(screen.queryByTestId('guid-mcp-search')).not.toBeInTheDocument();
    // Lists still render in full.
    expect(screen.getByText('skill-4')).toBeInTheDocument();
    expect(screen.getByText('server-4')).toBeInTheDocument();
  });

  it('filters skills case-insensitively and keeps other items hidden', () => {
    renderActionRow();

    fireEvent.change(screen.getByTestId('guid-skill-search'), { target: { value: 'SKILL-3' } });

    expect(screen.getByText('skill-3')).toBeInTheDocument();
    expect(screen.queryByText('skill-4')).not.toBeInTheDocument();
    // MCP list is untouched by the skill query.
    expect(screen.getByText('server-4')).toBeInTheDocument();
  });

  it('filters MCP servers independently from skills', () => {
    renderActionRow();

    fireEvent.change(screen.getByTestId('guid-mcp-search'), { target: { value: 'server-2' } });

    expect(screen.getByText('server-2')).toBeInTheDocument();
    expect(screen.queryByText('server-3')).not.toBeInTheDocument();
    expect(screen.getByText('skill-3')).toBeInTheDocument();
  });

  it('shows an empty state when no skill matches', () => {
    renderActionRow();

    fireEvent.change(screen.getByTestId('guid-skill-search'), { target: { value: 'zzz' } });

    expect(screen.getByText('No matching skills.')).toBeInTheDocument();
  });

  it('shows an empty state when no MCP server matches', () => {
    renderActionRow();

    fireEvent.change(screen.getByTestId('guid-mcp-search'), { target: { value: 'zzz' } });

    expect(screen.getByText('No servers found matching your criteria')).toBeInTheDocument();
  });

  it('still toggles a skill from a filtered list', () => {
    const onToggleSkill = vi.fn();
    renderActionRow({ onToggleSkill });

    fireEvent.change(screen.getByTestId('guid-skill-search'), { target: { value: 'skill-3' } });
    fireEvent.click(screen.getByText('skill-3').closest('[role="menuitem"]')!);

    expect(onToggleSkill).toHaveBeenCalledWith('skill-3', false);
  });

  it('shows both Computer Use capabilities as direct selectable actions on mobile WebUI', () => {
    layoutState.isMobile = true;
    platformState.isElectronDesktop = false;
    const onToggleMcpServer = vi.fn();
    renderActionRow({
      mcpServers: [
        { id: 'desktop-cu', name: 'winkgo-desktop-computer-use', builtin: true } as IMcpServer,
        { id: 'browser-cu', name: 'winkgo-browser', builtin: true } as IMcpServer,
      ],
      selectedMcpServerIds: ['desktop-cu'],
      onToggleMcpServer,
    });

    fireEvent.click(screen.getByTestId('file-upload-btn'));
    const entries = capturedMobileSheetProps.at(-1)?.entries ?? [];
    const desktopEntry = entries.find((entry) => entry.key === 'desktop-computer-use');
    const browserEntry = entries.find((entry) => entry.key === 'browser-computer-use');

    expect(desktopEntry).toBeDefined();
    expect(desktopEntry?.meta).toBe('✓');
    expect(browserEntry).toBeDefined();
    expect(browserEntry?.meta).toBeUndefined();

    browserEntry?.onClick?.();
    expect(onToggleMcpServer).toHaveBeenCalledWith('browser-cu');
  });
});
