// Modified from AionUI by WINK GO contributors in 2026.
import { ipcBridge } from '@/common';
import { useOptionalPreviewContext } from '@/renderer/pages/conversation/Preview/context/PreviewContext';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { Browser, Command, Down, Folder, Terminal } from '@icon-park/react';
import { Button, Dropdown, Tooltip } from '@arco-design/web-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

type ToolType = 'vscode' | 'terminal' | 'explorer' | 'browser';
type ExternalToolType = Exclude<ToolType, 'browser'>;

interface ToolOption {
  key: ToolType;
  label: string;
  icon: React.ReactNode;
  available: boolean;
}

interface WorkspaceOpenButtonProps {
  workspacePath: string;
  /**
   * Authoritative flag from `conversation.extra.is_temporary_workspace`.
   * The button hides itself for temp workspaces because there is no
   * meaningful project to open.
   */
  isTemporary: boolean;
}

const STORAGE_KEY = 'workspace-open-preference';
const isExternalTool = (tool: ToolType): tool is ExternalToolType => tool !== 'browser';

/**
 * Workspace Open Button - Opens workspace folder with various tools
 * Supports VS Code, Terminal, and File Explorer
 * Remembers user's preferred tool
 */
const WorkspaceOpenButton: React.FC<WorkspaceOpenButtonProps> = ({ workspacePath, isTemporary }) => {
  const { t } = useTranslation();
  const previewContext = useOptionalPreviewContext();
  const openBrowserTab = previewContext?.openBrowserTab;
  const [vscodeInstalled, setVscodeInstalled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [preferredTool, setPreferredTool] = useState<ToolType | null>(null);

  // Check if VS Code is installed and load preferred tool
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ToolType | null;
    if (saved) setPreferredTool(saved);

    if (isTemporary) return;
    const checkTools = async () => {
      try {
        const installed = await ipcBridge.shell.checkToolInstalled.invoke({ tool: 'vscode' });
        setVscodeInstalled(installed);
      } catch (error) {
        console.warn('[WorkspaceOpenButton] Failed to check VS Code:', error);
        setVscodeInstalled(false);
      }
    };

    void checkTools();
  }, [isTemporary]);

  const handleOpenWith = useCallback(
    async (tool: ToolType) => {
      try {
        if (isExternalTool(tool)) {
          await ipcBridge.shell.openFolderWith.invoke({ folder_path: workspacePath, tool });
        } else {
          openBrowserTab?.();
        }
        localStorage.setItem(STORAGE_KEY, tool);
        setPreferredTool(tool);
      } catch (error) {
        console.error(`[WorkspaceOpenButton] Failed to open with ${tool}:`, error);
      }
      setDropdownOpen(false);
    },
    [workspacePath, openBrowserTab]
  );

  // Build dropdown options
  const toolOptions: ToolOption[] = useMemo(
    () => [
      {
        key: 'vscode',
        label: t('conversation.workspace.openWith.vscode', { defaultValue: 'VS Code' }),
        icon: <Command size={16} />,
        available: !isTemporary && vscodeInstalled,
      },
      {
        key: 'terminal',
        label: t('conversation.workspace.openWith.terminal', { defaultValue: 'Terminal' }),
        icon: <Terminal size={16} />,
        available: !isTemporary,
      },
      {
        key: 'explorer',
        label: t('conversation.workspace.openWith.explorer', { defaultValue: 'File Explorer' }),
        icon: <Folder size={16} />,
        available: !isTemporary,
      },
      {
        key: 'browser',
        label: t('conversation.workspace.openWith.browser', { defaultValue: 'Browser' }),
        icon: <Browser size={16} />,
        available: Boolean(openBrowserTab),
      },
    ],
    [t, isTemporary, vscodeInstalled, openBrowserTab]
  );

  // Filter only available tools
  const availableOptions = useMemo(() => toolOptions.filter((opt) => opt.available), [toolOptions]);

  // Determine current tool: preferred > first available > explorer
  const currentTool: ToolType = useMemo(() => {
    if (preferredTool && availableOptions.some((opt) => opt.key === preferredTool)) {
      return preferredTool;
    }
    return availableOptions[0]?.key ?? 'browser';
  }, [preferredTool, availableOptions]);

  // Get current icon based on selected tool
  const currentIcon = useMemo(() => {
    switch (currentTool) {
      case 'vscode':
        return <Command size={16} />;
      case 'explorer':
        return <Folder size={16} />;
      case 'browser':
        return <Browser size={16} />;
      case 'terminal':
      default:
        return <Terminal size={16} />;
    }
  }, [currentTool]);

  const tooltipContent =
    currentTool === 'browser'
      ? t('conversation.workspace.openWith.browser', { defaultValue: 'Browser' })
      : t('conversation.workspace.openWorkspace', { defaultValue: 'Open workspace folder' });

  // The embedded browser requires Electron's webview support.
  if (!isElectronDesktop() || availableOptions.length === 0) return null;

  const dropdownList = (
    <div className='workspace-open-dropdown p-4px'>
      {availableOptions.map((option, index) => (
        <React.Fragment key={option.key}>
          {option.key === 'browser' && index > 0 && <div className='my-4px mx-8px h-1px bg-[var(--color-border-2)]' />}
          <div
            className={`workspace-open-dropdown-item flex items-center gap-8px px-12px py-8px cursor-pointer hover:bg-[var(--color-fill-2)] rounded-4px transition-colors ${
              currentTool === option.key ? 'bg-[var(--color-fill-2)]' : ''
            }`}
            onClick={() => handleOpenWith(option.key)}
          >
            <span className='flex items-center justify-center w-20px h-20px'>{option.icon}</span>
            <span className='text-14px'>{option.label}</span>
            {currentTool === option.key && <span className='ml-auto text-12px text-[var(--color-text-3)]'>✓</span>}
          </div>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div className='workspace-open-button flex items-center overflow-hidden rd-6px'>
      <Tooltip content={tooltipContent} mini>
        <Button
          type='text'
          size='small'
          className='workspace-open-button__btn !w-28px !min-w-28px !px-0'
          onClick={() => handleOpenWith(currentTool)}
          aria-label={tooltipContent}
        >
          {currentIcon}
        </Button>
      </Tooltip>

      <Dropdown
        trigger='click'
        position='br'
        popupVisible={dropdownOpen}
        onVisibleChange={setDropdownOpen}
        droplist={dropdownList}
      >
        <Button
          type='text'
          size='small'
          className='workspace-open-button__dropdown-btn !w-20px !min-w-20px !px-0'
          aria-label={t('common.more')}
        >
          <Down size={12} className={`transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
        </Button>
      </Dropdown>
    </div>
  );
};

export default WorkspaceOpenButton;
