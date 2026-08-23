// Modified from AionUI by WINK GO contributors in 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAcpModelInfo } from '@/renderer/hooks/agent/useAcpModelInfo';
import { classifyConfigSetError, type AcpConfigOptionsLoader } from '@/renderer/hooks/agent/useAcpConfigOptions';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import { getModelDisplayLabel } from '@/renderer/utils/model/agentLogo';
import { addTitlebarQuickActionVisibilityListener } from '@/renderer/utils/quickActions/titlebarQuickActions';
import { iconColors } from '@/renderer/styles/colors';
import { Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { Brain, Down } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RuntimeSelectorPill, { RuntimeSelectorLoadingIndicator } from './RuntimeSelectorPill';
import {
  composeRuntimeSelectorLabel,
  getCurrentRuntimeOptionLabel,
  getCurrentThoughtLevelLabel,
  isConfigSetting,
  RUNTIME_SUBMENU_TRIGGER_PROPS,
  RuntimeSelectorCheckedItem,
  RuntimeSelectorModelList,
  RuntimeSelectorSubMenuTitle,
  RuntimeSelectorUnavailableRow,
} from './runtimeSelectorOptions';

/** Runtime state of one team member. Kept local to avoid importing team-domain types here. */
export type AcpWarmupStatus = 'dormant' | 'pending' | 'ready' | 'failed';

const configErrorMessageKey = (error: unknown) => {
  const errorKind = classifyConfigSetError(error);
  if (errorKind === 'command_ack') return 'agent.config.commandAck';
  if (errorKind === 'confirmation_timeout') return 'agent.config.timeout';
  if (errorKind === 'config_update_in_progress') return 'agent.config.busy';
  return 'agent.config.failed';
};

/**
 * Model selector for ACP-based agents. Renders three states:
 * - null model info: disabled "Use CLI model" button (backward compatible)
 * - no available_models: read-only display of current model name
 * - has available_models: clickable dropdown selector
 *
 * Data fetching/syncing lives in `useAcpModelInfo` so the mobile action
 * sheet can read from the same source.
 */
const AcpModelSelector: React.FC<{
  conversation_id: string;
  /** ACP backend name for loading cached models (e.g., 'claude', 'qwen') */
  backend?: string;
  /** Pre-selected model ID from Guid page */
  initialModelId?: string;
  prepareRuntime?: () => Promise<void>;
  prepareSetRuntime?: () => Promise<void>;
  loadConfigOptions?: AcpConfigOptionsLoader;
  /** Deprecated: runtime config loading now ensures the conversation runtime. */
  waitForWarmup?: boolean;
  /** Optional manual wake control. Omitted for ordinary one-to-one conversations. */
  warmup?: {
    status: AcpWarmupStatus;
    trigger?: () => Promise<void>;
  };
}> = ({ conversation_id, backend, initialModelId, prepareRuntime, prepareSetRuntime, loadConfigOptions, warmup }) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobileHeaderCompact = Boolean(layout?.isMobile);
  const [modelMenuVisible, setModelMenuVisible] = useState(false);
  useEffect(() => addTitlebarQuickActionVisibilityListener('model', setModelMenuVisible), []);
  const { model_info, canSwitch, isLoading, isSetting, selectModel, thoughtLevel, speed, setStatus, setConfigOption } =
    useAcpModelInfo({
      conversation_id,
      backend,
      initialModelId,
      prepareRuntime,
      prepareSetRuntime,
      loadConfigOptions,
      onSelectModelSuccess: () => Message.success(t('agent.model.switchSuccess')),
      onSelectModelFailed: (_modelId, error) => Message.error(t(configErrorMessageKey(error))),
    });

  const defaultModelLabel = t('common.defaultModel');
  const rawDisplayLabel =
    (model_info?.current_model_id &&
      model_info.available_models.find((m) => m.id === model_info.current_model_id)?.label) ||
    model_info?.current_model_label ||
    model_info?.current_model_id ||
    '';
  const display_label = getModelDisplayLabel({
    selected_value: model_info?.current_model_id,
    selectedLabel: rawDisplayLabel,
    defaultModelLabel,
    fallbackLabel: t('conversation.welcome.useCliModel'),
  });
  const combinedLabel = composeRuntimeSelectorLabel({ modelLabel: display_label, thoughtLevel });
  const isRuntimeSetting = isConfigSetting(setStatus);
  const handleThoughtLevelSelect = useCallback(
    async (value: string) => {
      if (!thoughtLevel || value === thoughtLevel.currentValue || isRuntimeSetting) return;
      try {
        await setConfigOption(thoughtLevel.id, value);
        Message.success(t('agent.thoughtLevel.switchSuccess'));
      } catch (error) {
        Message.error(t(configErrorMessageKey(error)));
      }
    },
    [isRuntimeSetting, setConfigOption, thoughtLevel, t]
  );
  const handleSpeedSelect = useCallback(
    async (value: string) => {
      if (!speed || value === speed.currentValue || isRuntimeSetting) return;
      try {
        await setConfigOption(speed.id, value);
        Message.success(t('agent.speed.switchSuccess', { defaultValue: 'Response speed updated' }));
      } catch (error) {
        Message.error(t(configErrorMessageKey(error)));
      }
    },
    [isRuntimeSetting, setConfigOption, speed, t]
  );
  const tooltipContent = combinedLabel;
  const runtimeManagedLabel = t('agent.runtime.managedByAgent', { defaultValue: 'Managed by Agent' });

  const renderLogo = () => <Brain theme='outline' size='14' fill={iconColors.secondary} className='shrink-0' />;

  const [triggeringWarmup, setTriggeringWarmup] = useState(false);
  useEffect(() => {
    if (warmup && warmup.status !== 'dormant') setTriggeringWarmup(false);
  }, [warmup]);

  const canManualWarmup = Boolean(
    warmup && (warmup.status === 'dormant' || warmup.status === 'failed') && warmup.trigger
  );
  const showWarmupSpinner = triggeringWarmup || warmup?.status === 'pending';
  const handleWarmupClick = useCallback(async () => {
    if (!warmup?.trigger || triggeringWarmup) return;
    setTriggeringWarmup(true);
    try {
      await warmup.trigger();
    } catch {
      // The team runtime status stream owns the user-visible failure state.
    } finally {
      setTriggeringWarmup(false);
    }
  }, [triggeringWarmup, warmup]);

  const renderReadonlyPill = (label: string, readonlyTooltip: React.ReactNode) => {
    const clickable = !showWarmupSpinner && canManualWarmup;
    return (
      <Tooltip content={clickable ? t('agent.warmup.clickToWake') : readonlyTooltip} position='top'>
        <RuntimeSelectorPill
          testId='acp-model-selector-warmup'
          className='sendbox-model-btn header-model-btn agent-mode-compact-pill'
          label={label}
          leading={renderLogo()}
          loading={showWarmupSpinner}
          onClick={clickable ? () => void handleWarmupClick() : undefined}
          style={{ cursor: clickable ? 'pointer' : 'default' }}
        />
      </Tooltip>
    );
  };

  if (!model_info && isLoading) {
    return (
      <div
        data-testid='acp-model-selector-loading'
        className='header-model-loading-slot flex h-28px w-28px shrink-0 items-center justify-center leading-none text-t-secondary'
      >
        <RuntimeSelectorLoadingIndicator />
      </div>
    );
  }

  if (!model_info) {
    return renderReadonlyPill(t('conversation.welcome.useCliModel'), t('conversation.welcome.modelSwitchNotSupported'));
  }

  if (!canSwitch) {
    return renderReadonlyPill(combinedLabel, tooltipContent);
  }

  return (
    <Dropdown
      trigger='click'
      popupVisible={modelMenuVisible}
      onVisibleChange={setModelMenuVisible}
      // Mobile: portal the popup to <body> so it escapes the titlebar slot.
      // Desktop: leave default container so click events reach Menu.Item normally.
      {...(isMobileHeaderCompact ? { getPopupContainer: () => document.body } : {})}
      droplist={
        <Menu className='winkgo-runtime-menu' data-testid='acp-runtime-settings-menu'>
          <>
            {/* The first level is deliberately stable. A cold runtime may initially
                advertise only models and publish reasoning/speed moments later; the
                menu must not collapse into an unrelated flat list during that window. */}
            <Menu.SubMenu
              key='model'
              triggerProps={RUNTIME_SUBMENU_TRIGGER_PROPS}
              title={
                <RuntimeSelectorSubMenuTitle
                  label={t('common.model', { defaultValue: 'Model' })}
                  value={display_label}
                />
              }
            >
              <RuntimeSelectorModelList
                models={model_info.available_models}
                currentModelId={model_info.current_model_id}
                disabled={isRuntimeSetting}
                onSelect={selectModel}
              />
            </Menu.SubMenu>
            {thoughtLevel ? (
              <Menu.SubMenu
                key='thought-level'
                triggerProps={RUNTIME_SUBMENU_TRIGGER_PROPS}
                title={
                  <RuntimeSelectorSubMenuTitle
                    label={t('agent.thoughtLevel.label')}
                    value={getCurrentThoughtLevelLabel(thoughtLevel)}
                  />
                }
              >
                {thoughtLevel.options.map((item) => (
                  <Menu.Item
                    key={item.value}
                    className={item.value === thoughtLevel.currentValue ? 'bg-2!' : ''}
                    onClick={() => {
                      if (!isRuntimeSetting) void handleThoughtLevelSelect(item.value);
                    }}
                  >
                    <RuntimeSelectorCheckedItem
                      selected={item.value === thoughtLevel.currentValue}
                      description={item.description}
                    >
                      {item.label}
                    </RuntimeSelectorCheckedItem>
                  </Menu.Item>
                ))}
              </Menu.SubMenu>
            ) : (
              <RuntimeSelectorUnavailableRow label={t('agent.thoughtLevel.label')} value={runtimeManagedLabel} />
            )}
            {speed ? (
              <Menu.SubMenu
                key='speed'
                triggerProps={RUNTIME_SUBMENU_TRIGGER_PROPS}
                title={
                  <RuntimeSelectorSubMenuTitle
                    label={t('agent.speed.label', { defaultValue: 'Speed' })}
                    value={getCurrentRuntimeOptionLabel(speed)}
                  />
                }
              >
                {speed.options.map((item) => (
                  <Menu.Item
                    key={item.value}
                    className={item.value === speed.currentValue ? 'bg-2!' : ''}
                    onClick={() => {
                      if (!isRuntimeSetting) void handleSpeedSelect(item.value);
                    }}
                  >
                    <RuntimeSelectorCheckedItem
                      selected={item.value === speed.currentValue}
                      description={item.description}
                    >
                      {item.label}
                    </RuntimeSelectorCheckedItem>
                  </Menu.Item>
                ))}
              </Menu.SubMenu>
            ) : (
              <RuntimeSelectorUnavailableRow
                label={t('agent.speed.label', { defaultValue: 'Speed' })}
                value={runtimeManagedLabel}
              />
            )}
          </>
        </Menu>
      }
    >
      <RuntimeSelectorPill
        testId='acp-model-selector'
        data-winkgo-quick-action='model'
        className='sendbox-model-btn header-model-btn agent-mode-compact-pill'
        label={combinedLabel}
        leading={renderLogo()}
        trailing={<Down theme='outline' size={12} fill={iconColors.secondary} className='shrink-0' />}
        loading={isSetting || isRuntimeSetting}
        disabled={isRuntimeSetting}
      />
    </Dropdown>
  );
};

export default AcpModelSelector;
