// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationMcpStatus, IConversationMcpStatusKind } from '@/common/config/storage';
import { Button, Message, Trigger } from '@arco-design/web-react';
import {
  Browser,
  Calendar,
  Computer,
  FolderOpen,
  Lightning,
  Paperclip,
  Plus,
  Puzzle,
  Right,
  Shield,
} from '@icon-park/react';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { iconColors } from '@/renderer/styles/colors';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { FileService } from '@/renderer/services/FileService';
import type { FileMetadata } from '@/renderer/services/FileService';
import { emitter } from '@/renderer/utils/emitter';
import { openDynamicIslandPanel } from '@/renderer/utils/winkgo/openDynamicIslandPanel';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

interface FileAttachButtonProps {
  openFileSelector: () => void;
  onLocalFilesAdded?: (files: FileMetadata[]) => void;
  loadedSkills?: string[];
  loadedMcpStatuses?: IConversationMcpStatus[];
}

const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: React.ReactNode;
  description?: React.ReactNode;
  suffix?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  title?: string;
}> = ({ icon, label, description, suffix, onClick, className = '', title }) => (
  <div
    className={`flex items-center gap-10px px-12px py-9px rounded-8px cursor-pointer hover:bg-fill-2 transition-colors text-14px text-t-primary select-none ${className}`}
    onClick={onClick}
    title={title}
  >
    <span className='flex-shrink-0 inline-flex items-center justify-center color-#86909c w-18px leading-none'>
      {icon}
    </span>
    <span className='min-w-0 flex-1'>
      <span className='block leading-none'>{label}</span>
      {description ? <span className='mt-4px block text-12px leading-16px text-t-secondary'>{description}</span> : null}
    </span>
    {suffix}
  </div>
);

const MCP_STATUS_CLASS_NAME: Record<IConversationMcpStatusKind, string> = {
  loaded: 'text-[var(--color-success-6)]',
  failed: 'text-[var(--color-danger-6)]',
  unsupported: 'text-[var(--color-warning-6)]',
};

const buildLoadedMcpStatuses = (
  statuses?: IConversationMcpStatus[],
  legacyNames?: string[]
): IConversationMcpStatus[] => {
  if (Array.isArray(statuses) && statuses.length > 0) {
    return statuses;
  }

  return (legacyNames ?? []).map((name) => ({
    id: name,
    name,
    status: 'loaded',
  }));
};

const FileAttachButton: React.FC<FileAttachButtonProps> = ({
  openFileSelector,
  onLocalFilesAdded,
  loadedSkills,
  loadedMcpStatuses,
}) => {
  const conversationContext = useConversationContextSafe();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);

  const skillNames = loadedSkills ?? conversationContext?.loadedSkills ?? [];
  const mcpStatuses = buildLoadedMcpStatuses(
    loadedMcpStatuses ?? conversationContext?.loadedMcpStatuses,
    conversationContext?.loadedMcpServers
  );
  const handleSkillClick = useCallback((name: string) => {
    setOpen(false);
    emitter.emit('sendbox.fill', `/${name} `);
  }, []);

  const handleOpenMcpSettings = useCallback(() => {
    setOpen(false);
    setSkillsOpen(false);
    setMcpOpen(false);
    void navigate('/settings/tools');
  }, [navigate]);

  const handleOpenSkills = useCallback(() => {
    setOpen(false);
    setSkillsOpen(false);
    setMcpOpen(false);
    void navigate('/settings/skills');
  }, [navigate]);

  const handleOpenBrowserComputerUse = useCallback(() => {
    setOpen(false);
    setSkillsOpen(false);
    setMcpOpen(false);
    void openDynamicIslandPanel('browserComputerUse');
  }, []);

  const handleOpenDesktopComputerUse = useCallback(() => {
    setOpen(false);
    setSkillsOpen(false);
    setMcpOpen(false);
    void openDynamicIslandPanel('desktopComputerUse');
  }, []);

  const handleOpenScheduledTasks = useCallback(() => {
    setOpen(false);
    setSkillsOpen(false);
    setMcpOpen(false);
    void navigate('/scheduled');
  }, [navigate]);

  const handleLocalFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = e.target.files;
      if (!fileList || fileList.length === 0 || !onLocalFilesAdded) return;
      setUploading(true);
      try {
        const processed = await FileService.processDroppedFiles(fileList, conversationContext?.conversation_id);
        if (processed.length > 0) onLocalFilesAdded(processed);
      } catch {
        Message.error(t('common.fileAttach.failed'));
      } finally {
        setUploading(false);
      }
      e.target.value = '';
    },
    [conversationContext?.conversation_id, onLocalFilesAdded, t]
  );

  const isDesktop = isElectronDesktop();
  const hasSkills = skillNames.length > 0;
  const hasMcpServers = mcpStatuses.length > 0;
  const plusIcon = <Plus theme='outline' size='14' strokeWidth={2} fill={iconColors.primary} />;

  const cardStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-bg-2, #fff)',
    borderRadius: 12,
    boxShadow: '0 14px 38px rgba(23, 32, 51, 0.14)',
    border: '1px solid var(--color-border-1, #e5e6eb)',
    padding: '6px 0',
    minWidth: 252,
    backdropFilter: 'blur(18px)',
    zIndex: 1050,
  };

  const skillsPanel = (
    <div style={{ ...cardStyle, minWidth: 180 }} onClick={(e) => e.stopPropagation()}>
      {skillNames.map((name) => (
        <MenuItem
          key={name}
          icon={<Lightning theme='outline' size={15} strokeWidth={2.5} />}
          label={name}
          onClick={() => handleSkillClick(name)}
          className='mx-6px'
        />
      ))}
    </div>
  );

  const mcpPanel = (
    <div
      style={{
        ...cardStyle,
        minWidth: 220,
        width: 'min(320px, calc(100vw - 96px))',
        maxWidth: 320,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {mcpStatuses.map((item) => (
        <MenuItem
          key={`${item.id}-${item.status}`}
          icon={<Shield theme='outline' size={15} strokeWidth={2.5} />}
          label={item.name}
          suffix={
            item.status === 'loaded' ? undefined : (
              <span className={`text-12px leading-none ${MCP_STATUS_CLASS_NAME[item.status]}`}>
                {t(`conversation.mcp.status.${item.status}` as const)}
              </span>
            )
          }
          className='mx-6px cursor-default hover:bg-transparent'
          title={item.reason}
        />
      ))}
      <div style={{ margin: '4px 12px', height: 1, backgroundColor: 'var(--color-border-1, #e5e6eb)' }} />
      <div className='px-12px py-8px'>
        <div className='text-12px leading-16px text-t-secondary whitespace-normal break-words'>
          {t('conversation.mcp.managementHint', {
            defaultValue:
              'If an MCP looks abnormal, it is usually caused by the MCP JSON configuration. Go to Tools settings and test it there.',
          })}
        </div>
        <Button
          type='text'
          size='mini'
          className='mt-6px h-auto! px-0! text-12px! inline-flex! items-center! gap-4px!'
          onClick={handleOpenMcpSettings}
        >
          <span className='leading-none'>
            {t('conversation.mcp.openSettings', {
              defaultValue: 'Open Tools settings',
            })}
          </span>
          <span className='inline-flex h-12px w-12px flex-shrink-0 items-center justify-center'>
            <Right theme='outline' size={12} strokeWidth={3} className='block' />
          </span>
        </Button>
      </div>
    </div>
  );

  const menu = (
    <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
      {/* Loaded items stay above file actions so the session snapshot is visible */}
      {(hasMcpServers || hasSkills) && (
        <>
          {hasMcpServers && (
            <div className='px-6px'>
              <Trigger
                popup={() => mcpPanel}
                trigger='hover'
                position='right'
                popupVisible={mcpOpen}
                onVisibleChange={setMcpOpen}
                mouseEnterDelay={100}
                mouseLeaveDelay={150}
              >
                <div>
                  <MenuItem
                    icon={<Shield theme='outline' size={15} strokeWidth={2.5} />}
                    label={`${t('conversation.mcp.selected', { defaultValue: 'Selected MCP' })} · ${mcpStatuses.length}`}
                    suffix={<Right theme='outline' size={12} strokeWidth={3} style={{ color: '#c9cdd4' }} />}
                  />
                </div>
              </Trigger>
            </div>
          )}
          {hasSkills && (
            <div className='px-6px'>
              <Trigger
                popup={() => skillsPanel}
                trigger='hover'
                position='right'
                popupVisible={skillsOpen}
                onVisibleChange={setSkillsOpen}
                mouseEnterDelay={100}
                mouseLeaveDelay={150}
              >
                <div>
                  <MenuItem
                    icon={<Lightning theme='outline' size={15} strokeWidth={2.5} />}
                    label={`${t('common.selectedSkills', { defaultValue: 'Selected skills' })} · ${skillNames.length}`}
                    suffix={<Right theme='outline' size={12} strokeWidth={3} style={{ color: '#c9cdd4' }} />}
                  />
                </div>
              </Trigger>
            </div>
          )}
          <div style={{ margin: '4px 12px', height: 1, backgroundColor: 'var(--color-border-1, #e5e6eb)' }} />
        </>
      )}

      {/* 文件操作最常用，在最下（离 + 最近） */}
      <div className='px-6px'>
        {!isDesktop && (
          <MenuItem
            icon={<FolderOpen theme='outline' size={15} strokeWidth={2.5} />}
            label={t('common.fileAttach.myDevice', { defaultValue: 'Upload from device' })}
            onClick={() => {
              fileInputRef.current?.click();
              setOpen(false);
            }}
          />
        )}
        <MenuItem
          icon={<Paperclip theme='outline' size={15} strokeWidth={2.5} />}
          label={t('common.fileAttach.addFiles', { defaultValue: 'Add files' })}
          onClick={() => {
            openFileSelector();
            setOpen(false);
          }}
        />
      </div>
      <div style={{ margin: '4px 12px', height: 1, backgroundColor: 'var(--color-border-1, #e5e6eb)' }} />
      <div className='px-6px'>
        {isDesktop ? (
          <>
            <MenuItem
              icon={<Computer theme='outline' size={15} strokeWidth={2.5} />}
              label={t('common.desktopComputerUse.title', { defaultValue: '桌面 Computer Use' })}
              description={t('common.desktopComputerUse.hint', { defaultValue: '使用视觉模型操作 Windows 软件' })}
              onClick={handleOpenDesktopComputerUse}
            />
            <MenuItem
              icon={<Browser theme='outline' size={15} strokeWidth={2.5} />}
              label={t('common.browserComputerUse.title', { defaultValue: 'WINK GO 浏览器 Computer Use' })}
              description={t('common.browserComputerUse.hint', { defaultValue: '使用模型操作软件内置浏览器' })}
              onClick={handleOpenBrowserComputerUse}
            />
            <MenuItem
              icon={<Calendar theme='outline' size={15} strokeWidth={2.5} />}
              label={t('cron.scheduledTasks')}
              onClick={handleOpenScheduledTasks}
            />
          </>
        ) : null}
        <MenuItem
          icon={<Puzzle theme='outline' size={15} strokeWidth={2.5} />}
          label={t('common.fileAttach.manageSkills', { defaultValue: 'Add or manage skills' })}
          onClick={handleOpenSkills}
        />
        <MenuItem
          icon={<Shield theme='outline' size={15} strokeWidth={2.5} />}
          label={t('conversation.mcp.openSettings', { defaultValue: 'Open Tools settings' })}
          onClick={handleOpenMcpSettings}
        />
      </div>
    </div>
  );

  return (
    <>
      <Trigger
        popup={() => menu}
        trigger='click'
        position='tl'
        popupVisible={open}
        onVisibleChange={setOpen}
        clickToClose
        popupAlign={{ bottom: 8 }}
      >
        <Button
          type='secondary'
          shape='circle'
          icon={plusIcon}
          loading={uploading}
          disabled={uploading}
          data-testid='winkgo_agent-attach-folder-btn'
          className='sendbox-add-capability-btn'
          aria-label={t('common.addFunction', { defaultValue: 'Add functions' })}
        />
      </Trigger>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        style={{ display: 'none' }}
        onChange={handleLocalFileChange}
        data-testid='winkgo_agent-file-upload-input'
      />
    </>
  );
};

export default FileAttachButton;
