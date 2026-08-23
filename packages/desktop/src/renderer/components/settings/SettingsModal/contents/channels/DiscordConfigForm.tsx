// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { channel } from '@/common/adapter/ipcBridge';
import type { IChannelPluginStatus } from '@/common/types/channel/channel';
import GoogleModelSelector from '@/renderer/pages/conversation/platforms/gemini/GoogleModelSelector';
import type { GoogleModelSelection } from '@/renderer/pages/conversation/platforms/gemini/useGoogleModelSelection';
import { Button, Input, Message } from '@arco-design/web-react';
import { CheckOne, Link } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface DiscordConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  modelSelection: GoogleModelSelection;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
}

const DiscordConfigForm: React.FC<DiscordConfigFormProps> = ({ pluginStatus, modelSelection, onStatusChange }) => {
  const { t } = useTranslation();
  const [botToken, setBotToken] = useState('');
  const [testing, setTesting] = useState(false);

  const handleConnect = async () => {
    const token = botToken.trim();
    if (!token) {
      Message.warning(t('settings.assistant.tokenRequired'));
      return;
    }
    setTesting(true);
    try {
      const result = await channel.testPlugin.invoke({ plugin_id: 'discord', token });
      if (!result.success) {
        Message.error(result.error || t('settings.assistant.connectionFailed'));
        return;
      }
      await channel.enablePlugin.invoke({ plugin_id: 'discord', config: { credentials: { token } } });
      Message.success(t('settings.assistant.discordPluginEnabled'));
      const statuses = await channel.getPluginStatus.invoke();
      onStatusChange(statuses?.find((item) => item.type === 'discord') || null);
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className='flex flex-col gap-16px py-4px'>
      <div className='rd-10px bg-fill-1 p-12px text-13px leading-relaxed text-t-secondary'>
        <div className='font-500 text-t-primary'>Discord Gateway</div>
        <div className='mt-4px'>{t('settings.assistant.discordBotTokenDesc')}</div>
        <a
          className='mt-8px inline-flex items-center gap-4px text-[rgb(var(--primary-6))]'
          href='https://discord.com/developers/applications'
          target='_blank'
          rel='noreferrer'
        >
          <Link size={14} /> Discord Developer Portal
        </a>
      </div>

      <label className='flex flex-col gap-6px'>
        <span className='text-13px font-500 text-t-primary'>{t('settings.assistant.discordBotToken')}</span>
        <Input.Password value={botToken} onChange={setBotToken} placeholder='Bot Token' autoComplete='off' />
        <span className='text-12px text-t-tertiary'>{t('settings.assistant.discordBotTokenDesc')}</span>
      </label>

      <div className='flex items-center justify-between gap-12px'>
        <div className='flex items-center gap-6px text-12px text-t-secondary'>
          {pluginStatus?.connected ? <CheckOne className='text-green-600' size={14} /> : null}
          {pluginStatus?.connected ? t('settings.assistant.connected') : t('settings.assistant.disconnected')}
        </div>
        <Button type='primary' loading={testing} onClick={handleConnect}>
          {t('settings.assistant.testConnection')}
        </Button>
      </div>

      <div className='border-t border-fill-3 pt-14px'>
        <div className='mb-8px text-13px font-500 text-t-primary'>{t('settings.assistant.defaultModel')}</div>
        <GoogleModelSelector selection={modelSelection} variant='settings' />
      </div>
    </div>
  );
};

export default DiscordConfigForm;
