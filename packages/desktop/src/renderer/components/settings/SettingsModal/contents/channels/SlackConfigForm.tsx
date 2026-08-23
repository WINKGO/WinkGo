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

interface SlackConfigFormProps {
  pluginStatus: IChannelPluginStatus | null;
  modelSelection: GoogleModelSelection;
  onStatusChange: (status: IChannelPluginStatus | null) => void;
}

const SlackConfigForm: React.FC<SlackConfigFormProps> = ({
  pluginStatus,
  modelSelection,
  onStatusChange,
}) => {
  const { t } = useTranslation();
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [testing, setTesting] = useState(false);

  const refreshStatus = async () => {
    const statuses = await channel.getPluginStatus.invoke();
    onStatusChange(statuses?.find((item) => item.type === 'slack') || null);
  };

  const handleConnect = async () => {
    const nextBotToken = botToken.trim();
    const nextAppToken = appToken.trim();
    if (!nextBotToken.startsWith('xoxb-')) {
      Message.warning(t('settings.assistant.slackBotTokenPrefix'));
      return;
    }
    if (!nextAppToken.startsWith('xapp-')) {
      Message.warning(t('settings.assistant.slackAppTokenPrefix'));
      return;
    }

    setTesting(true);
    try {
      const result = await channel.testPlugin.invoke({ plugin_id: 'slack', token: nextBotToken });
      if (!result.success) {
        Message.error(result.error || t('settings.assistant.connectionFailed'));
        return;
      }
      await channel.enablePlugin.invoke({
        plugin_id: 'slack',
        config: { credentials: { token: nextBotToken, app_token: nextAppToken } },
      });
      Message.success(t('settings.assistant.slackPluginEnabled'));
      await refreshStatus();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className='flex flex-col gap-16px py-4px'>
      <div className='rd-10px bg-fill-1 p-12px text-13px leading-relaxed text-t-secondary'>
        <div className='font-500 text-t-primary'>Slack Socket Mode</div>
        <div className='mt-4px'>{t('settings.assistant.slackBotTokenDesc')}</div>
        <a
          className='mt-8px inline-flex items-center gap-4px text-[rgb(var(--primary-6))]'
          href='https://api.slack.com/apps'
          target='_blank'
          rel='noreferrer'
        >
          <Link size={14} /> Slack API
        </a>
      </div>

      <label className='flex flex-col gap-6px'>
        <span className='text-13px font-500 text-t-primary'>{t('settings.assistant.slackBotToken')}</span>
        <Input.Password
          value={botToken}
          onChange={setBotToken}
          placeholder='xoxb-…'
          autoComplete='off'
        />
        <span className='text-12px text-t-tertiary'>{t('settings.assistant.slackBotTokenDesc')}</span>
      </label>

      <label className='flex flex-col gap-6px'>
        <span className='text-13px font-500 text-t-primary'>{t('settings.assistant.slackAppToken')}</span>
        <Input.Password
          value={appToken}
          onChange={setAppToken}
          placeholder='xapp-…'
          autoComplete='off'
        />
        <span className='text-12px text-t-tertiary'>{t('settings.assistant.slackAppTokenDesc')}</span>
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

export default SlackConfigForm;
