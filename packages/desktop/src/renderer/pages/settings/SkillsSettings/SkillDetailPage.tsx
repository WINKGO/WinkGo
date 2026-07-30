/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SkillDetailPage — detail view for a single skill, styled after the
 * assistant editor page (sticky top bar + centered section cards).
 *
 * A single "used by" list is the source of truth for the skill↔assistant
 * relation (GitHub-collaborators pattern): rows link to the assistant and
 * expose an inline remove; an "Add assistant" dropdown lists only the
 * assistants not yet attached. Builtin assistants are read-only because
 * their update path only accepts agent/defaults fields.
 */

import { ipcBridge } from '@/common';
import type { Assistant, UpdateAssistantRequest } from '@/common/types/agent/assistantTypes';
import { resolveLocaleKey } from '@/common/utils';
import AssistantAvatar from '@/renderer/pages/settings/AssistantSettings/AssistantAvatar';
import { brandAssistantsForDisplay, brandLegacyTextForDisplay } from '@/renderer/utils/model/winkGoBranding';
import { Button, Dropdown, Input, Menu, Message, Spin, Typography } from '@arco-design/web-react';
import { ArrowLeft, Close, Plus, Right } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import useSWR, { mutate as swrMutate } from 'swr';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import { getAssistantsUsingSkill } from './SkillUsedByStack';

interface SkillInfo {
  name: string;
  description: string;
  location: string;
  is_auto_inject: boolean;
  is_custom: boolean;
  source?: 'builtin' | 'custom' | 'cron' | 'extension';
}

const getAvatarColorClass = (name: string) => {
  if (!name) return 'bg-[#165DFF] text-white';
  const colors = [
    'bg-[#165DFF] text-white', // Blue
    'bg-[#00B42A] text-white', // Green
    'bg-[#722ED1] text-white', // Purple
    'bg-[#F5319D] text-white', // Pink
    'bg-[#F77234] text-white', // Orange
    'bg-[#14C9C9] text-white', // Cyan
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const WECHAT_TARGET_LIMIT = 10;
const createEmptyTargetSlots = (): string[] => Array.from({ length: WECHAT_TARGET_LIMIT }, () => '');
const normalizeTargetValues = (values: readonly string[]): string[] =>
  Array.from(
    new Set(
      values
        .flatMap((value) => value.split(/\r?\n|[,，]/))
        .map((value) => value.trim().slice(0, 48))
        .filter(Boolean)
    )
  ).slice(0, WECHAT_TARGET_LIMIT);
const toTargetSlots = (values: readonly string[]): string[] => {
  const normalized = normalizeTargetValues(values);
  return [...normalized, ...createEmptyTargetSlots()].slice(0, WECHAT_TARGET_LIMIT);
};
const withTimeout = async <T,>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('WINK GO WeChat preferences request timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const SectionCard: React.FC<{
  title: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  'data-testid'?: string;
}> = ({ title, extra, children, 'data-testid': dataTestId }) => (
  <section data-testid={dataTestId} className='rounded-16px border border-border-2 bg-base px-20px py-18px'>
    <div className='mb-14px flex items-center justify-between gap-12px'>
      <h2 className='m-0 text-14px font-600 text-t-primary'>{title}</h2>
      {extra}
    </div>
    {children}
  </section>
);

const SkillDetailPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const localeKey = resolveLocaleKey(i18n.language);
  const navigate = useNavigate();
  const { skillName = '' } = useParams<{ skillName: string }>();
  const decodedName = decodeURIComponent(skillName);
  const [saving, setSaving] = useState(false);
  const [wechatPreferencesSaving, setWechatPreferencesSaving] = useState(false);
  const [favoriteContacts, setFavoriteContacts] = useState<string[]>(createEmptyTargetSlots);
  const [favoriteGroups, setFavoriteGroups] = useState<string[]>(createEmptyTargetSlots);
  const wechatPreferencesTouched = useRef(false);
  const [smartHomePreferencesSaving, setSmartHomePreferencesSaving] = useState(false);
  const [homeAssistantUrl, setHomeAssistantUrl] = useState('http://homeassistant.local:8123');
  const [homeAssistantToken, setHomeAssistantToken] = useState('');
  const [homeAssistantTokenConfigured, setHomeAssistantTokenConfigured] = useState(false);
  const [clearHomeAssistantToken, setClearHomeAssistantToken] = useState(false);
  const [smartHomeAppliancesJson, setSmartHomeAppliancesJson] = useState('[]');
  const [smartHomeScenesJson, setSmartHomeScenesJson] = useState('[]');

  const { data: skills, isLoading: skillsLoading } = useSWR<SkillInfo[]>('skills.list', () =>
    ipcBridge.fs.listAvailableSkills.invoke()
  );
  const {
    data: assistants,
    isLoading: assistantsLoading,
    mutate: mutateAssistants,
  } = useSWR<Assistant[]>('assistants.list', () => ipcBridge.assistants.list.invoke());

  const skill = useMemo(() => (skills ?? []).find((s) => s.name === decodedName), [skills, decodedName]);
  const isWinkGoWechatSkill = skill?.name === 'wechat' && skill.source === 'custom';
  const isWinkGoSmartHomeSkill = skill?.name === 'smart_home' && skill.source === 'custom';
  const displaySkillName = brandLegacyTextForDisplay(skill?.name || decodedName);
  const displaySkillDescription = brandLegacyTextForDisplay(skill?.description || '');
  const displayAssistants = useMemo(() => brandAssistantsForDisplay(assistants ?? []), [assistants]);
  const usingAssistants = useMemo(
    () => getAssistantsUsingSkill(decodedName, displayAssistants),
    [decodedName, displayAssistants]
  );
  // Attachment editing covers user + generated assistants; builtin assistants'
  // update endpoint only accepts agent_id/defaults (see useAssistantEditor).
  const editableAssistants = useMemo(
    () => displayAssistants.filter((a) => a.source !== 'builtin'),
    [displayAssistants]
  );
  const readonlyUsers = useMemo(() => usingAssistants.filter((a) => a.source === 'builtin'), [usingAssistants]);

  const assistantLabel = useCallback(
    (assistant: Assistant): string => assistant.name_i18n?.[localeKey] || assistant.name,
    [localeKey]
  );

  const goBack = useCallback(() => {
    void navigate('/settings/skills');
  }, [navigate]);

  const openAssistant = useCallback(
    (assistantId: string) => {
      void navigate('/assistants', { state: { openAssistantEditor: true, openAssistantId: assistantId } });
    },
    [navigate]
  );

  const sourceLabel = (s: SkillInfo): string => {
    if (s.source === 'custom') return t('settings.skillsHub.tabCustom', { defaultValue: 'Custom' });
    if (s.source === 'extension') return t('settings.extensionSkills', { defaultValue: 'Extension Skills' });
    if (s.is_auto_inject) return t('settings.autoInjectedSkills', { defaultValue: 'Auto-injected Skills' });
    return t('settings.skillsHub.tabOfficial', { defaultValue: 'Official' });
  };

  /** Attach or detach this skill on a single assistant. */
  const setAttachment = useCallback(
    async (assistant: Assistant, attach: boolean) => {
      setSaving(true);
      try {
        const update: UpdateAssistantRequest = {
          id: assistant.id,
          enabled_skills: attach
            ? Array.from(new Set([...(assistant.enabled_skills ?? []), decodedName]))
            : (assistant.enabled_skills ?? []).filter((n) => n !== decodedName),
        };
        await ipcBridge.assistants.update.invoke(update);
        Message.success(t('settings.skillsHub.detailAttachSuccess', { defaultValue: 'Assistants updated' }));
        await Promise.all([mutateAssistants(), swrMutate('assistants'), swrMutate('agents.boundAssistants.list')]);
      } catch (error) {
        console.error('Failed to update assistant skills:', error);
        Message.error(t('settings.skillsHub.detailAttachError', { defaultValue: 'Failed to update assistants' }));
      } finally {
        setSaving(false);
      }
    },
    [decodedName, mutateAssistants, t]
  );

  // Assistants that can still be added: editable and not yet using the skill.
  const addableAssistants = useMemo(() => {
    const usingIds = new Set(usingAssistants.map((a) => a.id));
    return editableAssistants.filter((a) => !usingIds.has(a.id));
  }, [editableAssistants, usingAssistants]);

  const loading = skillsLoading || assistantsLoading;

  useEffect(() => {
    if (!isWinkGoWechatSkill) return;
    let cancelled = false;
    wechatPreferencesTouched.current = false;
    setFavoriteContacts(createEmptyTargetSlots());
    setFavoriteGroups(createEmptyTargetSlots());
    void ipcBridge.winkGoSkills.getWechatPreferences
      .invoke()
      .then((preferences) => {
        if (cancelled || wechatPreferencesTouched.current) return;
        setFavoriteContacts(toTargetSlots(preferences.favoriteContacts));
        setFavoriteGroups(toTargetSlots(preferences.favoriteGroups));
      })
      .catch((error) => {
        console.error('Failed to load WINK GO WeChat preferences:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [isWinkGoWechatSkill]);

  useEffect(() => {
    if (!isWinkGoSmartHomeSkill) return;
    let cancelled = false;
    void ipcBridge.winkGoSkills.getSmartHomePreferences
      .invoke()
      .then((preferences) => {
        if (cancelled) return;
        setHomeAssistantUrl(preferences.homeAssistantUrl);
        setHomeAssistantToken('');
        setHomeAssistantTokenConfigured(preferences.accessTokenConfigured);
        setClearHomeAssistantToken(false);
        setSmartHomeAppliancesJson(preferences.appliancesJson);
        setSmartHomeScenesJson(preferences.scenesJson);
      })
      .catch((error) => {
        console.error('Failed to load WINK GO smart-home preferences:', error);
      });
    return () => {
      cancelled = true;
    };
  }, [isWinkGoSmartHomeSkill]);

  const updateFavoriteTarget = useCallback((kind: 'contact' | 'group', index: number, value: string) => {
    wechatPreferencesTouched.current = true;
    const update = (current: string[]): string[] =>
      current.map((item, itemIndex) => (itemIndex === index ? value.slice(0, 48) : item));
    if (kind === 'contact') setFavoriteContacts(update);
    else setFavoriteGroups(update);
  }, []);

  const saveWechatPreferences = useCallback(async () => {
    setWechatPreferencesSaving(true);
    try {
      const saved = await withTimeout(
        ipcBridge.winkGoSkills.saveWechatPreferences.invoke({
          favoriteContacts: normalizeTargetValues(favoriteContacts),
          favoriteGroups: normalizeTargetValues(favoriteGroups),
        }),
        3000
      );
      setFavoriteContacts(toTargetSlots(saved.favoriteContacts));
      setFavoriteGroups(toTargetSlots(saved.favoriteGroups));
      Message.success(
        t('common.winkGoSkills.wechat.saveSuccess', {
          defaultValue: 'WeChat favorites saved locally.',
        })
      );
    } catch (error) {
      console.error('Failed to save WINK GO WeChat preferences:', error);
      Message.error(
        t('common.winkGoSkills.wechat.saveFailed', {
          defaultValue: 'Failed to save WeChat favorites.',
        })
      );
    } finally {
      setWechatPreferencesSaving(false);
    }
  }, [favoriteContacts, favoriteGroups, t]);

  const favoriteContactsCount = normalizeTargetValues(favoriteContacts).length;
  const favoriteGroupsCount = normalizeTargetValues(favoriteGroups).length;

  const saveSmartHomePreferences = useCallback(async () => {
    setSmartHomePreferencesSaving(true);
    try {
      const saved = await withTimeout(
        ipcBridge.winkGoSkills.saveSmartHomePreferences.invoke({
          homeAssistantUrl,
          accessToken: homeAssistantToken || undefined,
          clearAccessToken: clearHomeAssistantToken,
          appliancesJson: smartHomeAppliancesJson,
          scenesJson: smartHomeScenesJson,
        }),
        12_000
      );
      setHomeAssistantUrl(saved.homeAssistantUrl);
      setHomeAssistantToken('');
      setHomeAssistantTokenConfigured(saved.accessTokenConfigured);
      setClearHomeAssistantToken(false);
      setSmartHomeAppliancesJson(saved.appliancesJson);
      setSmartHomeScenesJson(saved.scenesJson);
      Message.success(
        t('common.winkGoSkills.smartHome.saveSuccess', {
          defaultValue: 'Smart-home settings saved locally.',
        })
      );
    } catch (error) {
      console.error('Failed to save WINK GO smart-home preferences:', error);
      Message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSmartHomePreferencesSaving(false);
    }
  }, [clearHomeAssistantToken, homeAssistantToken, homeAssistantUrl, smartHomeAppliancesJson, smartHomeScenesJson, t]);

  return (
    <SettingsPageWrapper>
      <div data-testid='skill-detail-page' className='flex flex-col gap-16px'>
        <div className='flex items-center gap-10px'>
          <Button
            type='text'
            icon={<ArrowLeft size={16} />}
            onClick={goBack}
            data-testid='btn-back-skill-detail'
            className='!flex !items-center !gap-4px !rounded-8px !px-6px !text-t-primary'
          >
            {t('settings.skillsHub.detailBackToList', { defaultValue: 'All skills' })}
          </Button>
          <div className='truncate text-14px font-600 text-t-primary'>
            {displaySkillName || t('settings.skillsHub.detailTitle', { defaultValue: 'Skill Details' })}
          </div>
        </div>

        {loading ? (
          <div className='flex items-center justify-center py-64px'>
            <Spin />
          </div>
        ) : !skill ? (
          <div
            data-testid='skill-detail-not-found'
            className='rounded-12px border border-dashed border-border-1 bg-fill-1 px-16px py-40px text-center text-13px text-t-tertiary'
          >
            {t('settings.skillsHub.detailNotFound', { defaultValue: 'Skill not found. It may have been deleted.' })}
          </div>
        ) : (
          <div className='mx-auto flex w-full max-w-760px flex-col gap-16px'>
            {/* Basic info */}
            <SectionCard
              title={t('settings.skillsHub.detailInfoTitle', { defaultValue: 'Skill info' })}
              data-testid='skill-detail-info'
            >
              <div className='flex gap-16px'>
                <div
                  className={`h-48px w-48px shrink-0 rounded-12px flex items-center justify-center text-18px font-bold shadow-sm text-transform-uppercase ${getAvatarColorClass(skill.name)}`}
                >
                  {displaySkillName.charAt(0).toUpperCase()}
                </div>
                <div className='min-w-0 flex flex-col gap-6px'>
                  <div className='flex items-center gap-8px'>
                    <span className='text-16px font-600 text-t-primary'>{displaySkillName}</span>
                    <span className='rounded-4px border border-border-2 bg-fill-1 px-6px py-1px text-11px text-t-secondary'>
                      {sourceLabel(skill)}
                    </span>
                  </div>
                  <p className='m-0 text-13px leading-relaxed text-t-secondary'>
                    {displaySkillDescription ||
                      t('settings.skillsHub.detailNoDescription', { defaultValue: 'No description.' })}
                  </p>
                </div>
              </div>
            </SectionCard>

            {isWinkGoWechatSkill ? (
              <SectionCard
                title={t('common.winkGoSkills.wechat.title', {
                  defaultValue: 'Frequent contacts and groups',
                })}
                data-testid='winkgo-wechat-preferences'
                extra={
                  <span className='text-11px text-t-tertiary'>{favoriteContactsCount + favoriteGroupsCount}/20</span>
                }
              >
                <div className='grid grid-cols-2 gap-14px max-md:grid-cols-1'>
                  <div className='min-w-0 rounded-12px border border-border-2 bg-fill-1 p-12px'>
                    <div className='mb-10px flex items-center justify-between gap-8px'>
                      <span className='text-12px font-600 text-t-primary'>
                        {t('common.winkGoSkills.wechat.contacts', {
                          defaultValue: 'Frequent contacts',
                        })}
                      </span>
                      <span className='text-11px text-t-tertiary'>{favoriteContactsCount}/10</span>
                    </div>
                    <div className='grid grid-cols-2 gap-8px'>
                      {favoriteContacts.map((value, index) => (
                        <Input
                          key={`contact-${index}`}
                          value={value}
                          onChange={(nextValue) => updateFavoriteTarget('contact', index, nextValue)}
                          maxLength={48}
                          allowClear
                          placeholder={`${t('common.winkGoSkills.wechat.contacts', {
                            defaultValue: 'Frequent contact',
                          })} ${index + 1}`}
                          className='!rounded-8px !bg-base'
                          data-testid={`wechat-contact-slot-${index}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className='min-w-0 rounded-12px border border-border-2 bg-fill-1 p-12px'>
                    <div className='mb-10px flex items-center justify-between gap-8px'>
                      <span className='text-12px font-600 text-t-primary'>
                        {t('common.winkGoSkills.wechat.groups', {
                          defaultValue: 'Frequent groups',
                        })}
                      </span>
                      <span className='text-11px text-t-tertiary'>{favoriteGroupsCount}/10</span>
                    </div>
                    <div className='grid grid-cols-2 gap-8px'>
                      {favoriteGroups.map((value, index) => (
                        <Input
                          key={`group-${index}`}
                          value={value}
                          onChange={(nextValue) => updateFavoriteTarget('group', index, nextValue)}
                          maxLength={48}
                          allowClear
                          placeholder={`${t('common.winkGoSkills.wechat.groups', {
                            defaultValue: 'Frequent group',
                          })} ${index + 1}`}
                          className='!rounded-8px !bg-base'
                          data-testid={`wechat-group-slot-${index}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className='mt-12px flex items-center justify-between gap-12px'>
                  <p className='m-0 text-11px leading-relaxed text-t-tertiary'>
                    {t('common.winkGoSkills.wechat.privacy', {
                      defaultValue: 'Saved only on this computer. Message and file sending still require confirmation.',
                    })}
                  </p>
                  <Button
                    type='primary'
                    loading={wechatPreferencesSaving}
                    onClick={() => void saveWechatPreferences()}
                    data-testid='btn-save-winkgo-wechat-preferences'
                  >
                    {t('common.save', { defaultValue: 'Save' })}
                  </Button>
                </div>
              </SectionCard>
            ) : null}

            {isWinkGoSmartHomeSkill ? (
              <SectionCard
                title={t('common.winkGoSkills.smartHome.title', {
                  defaultValue: 'Smart-home connection',
                })}
                data-testid='winkgo-smart-home-preferences'
                extra={
                  <span
                    className={`rounded-full px-8px py-2px text-11px ${
                      homeAssistantTokenConfigured ? 'bg-success-1 text-success-6' : 'bg-fill-2 text-t-tertiary'
                    }`}
                  >
                    {homeAssistantTokenConfigured
                      ? t('common.winkGoSkills.smartHome.tokenSaved', { defaultValue: 'Token saved' })
                      : t('common.winkGoSkills.smartHome.tokenMissing', { defaultValue: 'Token not set' })}
                  </span>
                }
              >
                <div className='flex flex-col gap-12px'>
                  <label className='flex flex-col gap-6px'>
                    <span className='text-12px font-600 text-t-primary'>Home Assistant URL</span>
                    <Input
                      value={homeAssistantUrl}
                      onChange={setHomeAssistantUrl}
                      placeholder='http://homeassistant.local:8123'
                      data-testid='smart-home-url'
                    />
                  </label>
                  <label className='flex flex-col gap-6px'>
                    <span className='text-12px font-600 text-t-primary'>
                      {t('common.winkGoSkills.smartHome.token', {
                        defaultValue: 'Long-lived access token',
                      })}
                    </span>
                    <div className='flex gap-8px'>
                      <Input
                        type='password'
                        value={homeAssistantToken}
                        onChange={(value) => {
                          setHomeAssistantToken(value);
                          if (value) setClearHomeAssistantToken(false);
                        }}
                        placeholder={
                          homeAssistantTokenConfigured
                            ? t('common.winkGoSkills.smartHome.tokenKeep', {
                                defaultValue: 'Saved in Windows Credential Manager; leave blank to keep it',
                              })
                            : t('common.winkGoSkills.smartHome.tokenPlaceholder', {
                                defaultValue: 'Paste a Home Assistant long-lived token',
                              })
                        }
                        data-testid='smart-home-token'
                      />
                      {homeAssistantTokenConfigured ? (
                        <Button
                          status='danger'
                          onClick={() => {
                            setHomeAssistantToken('');
                            setHomeAssistantTokenConfigured(false);
                            setClearHomeAssistantToken(true);
                          }}
                          data-testid='btn-clear-smart-home-token'
                        >
                          {t('common.delete', { defaultValue: 'Delete' })}
                        </Button>
                      ) : null}
                    </div>
                  </label>
                  <div className='grid grid-cols-2 gap-12px max-md:grid-cols-1'>
                    <label className='flex min-w-0 flex-col gap-6px'>
                      <span className='text-12px font-600 text-t-primary'>
                        {t('common.winkGoSkills.smartHome.devices', {
                          defaultValue: 'Local device registry (JSON array)',
                        })}
                      </span>
                      <Input.TextArea
                        value={smartHomeAppliancesJson}
                        onChange={setSmartHomeAppliancesJson}
                        autoSize={{ minRows: 5, maxRows: 12 }}
                        placeholder='[{"id":"desk-lamp","name":"Desk lamp","type":"light"}]'
                        data-testid='smart-home-appliances'
                      />
                    </label>
                    <label className='flex min-w-0 flex-col gap-6px'>
                      <span className='text-12px font-600 text-t-primary'>
                        {t('common.winkGoSkills.smartHome.scenes', {
                          defaultValue: 'Local scenes (JSON array)',
                        })}
                      </span>
                      <Input.TextArea
                        value={smartHomeScenesJson}
                        onChange={setSmartHomeScenesJson}
                        autoSize={{ minRows: 5, maxRows: 12 }}
                        placeholder='[{"id":"home","name":"Home mode","actions":[]}]'
                        data-testid='smart-home-scenes'
                      />
                    </label>
                  </div>
                  <div className='flex items-center justify-between gap-12px'>
                    <p className='m-0 text-11px leading-relaxed text-t-tertiary'>
                      {t('common.winkGoSkills.smartHome.privacy', {
                        defaultValue:
                          'Configuration stays on this computer. The access token is stored by Windows Credential Manager.',
                      })}
                    </p>
                    <Button
                      type='primary'
                      loading={smartHomePreferencesSaving}
                      onClick={() => void saveSmartHomePreferences()}
                      data-testid='btn-save-winkgo-smart-home-preferences'
                    >
                      {t('common.save', { defaultValue: 'Save' })}
                    </Button>
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {/* Single source of truth: assistants using this skill, with inline add/remove */}
            <SectionCard
              title={
                t('settings.skillsHub.detailUsedByTitle', { defaultValue: 'Used by' }) + ` (${usingAssistants.length})`
              }
              data-testid='skill-detail-used-by'
              extra={
                <Dropdown
                  trigger='click'
                  position='br'
                  disabled={saving || addableAssistants.length === 0}
                  droplist={
                    <Menu style={{ maxHeight: 320, overflow: 'auto' }}>
                      {addableAssistants.map((assistant) => (
                        <Menu.Item
                          key={assistant.id}
                          data-testid={`menu-add-assistant-${assistant.id}`}
                          onClick={() => void setAttachment(assistant, true)}
                        >
                          <span className='flex items-center gap-8px'>
                            <AssistantAvatar assistant={assistant} size={20} />
                            <span className='truncate'>{assistantLabel(assistant)}</span>
                          </span>
                        </Menu.Item>
                      ))}
                    </Menu>
                  }
                >
                  <Button
                    size='mini'
                    type='text'
                    loading={saving}
                    icon={<Plus size={14} />}
                    data-testid='btn-add-assistant'
                    className='!h-24px !px-8px !text-12px !text-t-secondary hover:!text-t-primary'
                  >
                    {t('settings.skillsHub.detailAddAssistant', { defaultValue: 'Attach to assistant' })}
                  </Button>
                </Dropdown>
              }
            >
              {usingAssistants.length === 0 ? (
                <div
                  data-testid='skill-detail-used-by-empty'
                  className='rounded-8px bg-fill-1 px-12px py-16px text-center text-12px text-t-tertiary'
                >
                  {t('settings.skillsHub.detailUsedByEmpty', {
                    defaultValue: 'No assistants are using this skill yet.',
                  })}
                </div>
              ) : (
                <div className='flex flex-col gap-4px'>
                  {usingAssistants.map((assistant) => {
                    const isReadonly = readonlyUsers.some((a) => a.id === assistant.id);
                    return (
                      <div
                        key={assistant.id}
                        className='group flex cursor-pointer items-center gap-10px rounded-8px px-12px py-10px transition-colors hover:bg-fill-1'
                        data-testid={`skill-used-by-row-${assistant.id}`}
                        onClick={() => openAssistant(assistant.id)}
                      >
                        <AssistantAvatar assistant={assistant} size={26} />
                        <Typography.Text className='flex-1 truncate text-13px font-500 text-t-primary'>
                          {assistantLabel(assistant)}
                        </Typography.Text>
                        {isReadonly ? (
                          <span className='rounded-4px border border-border-2 bg-fill-1 px-6px py-1px text-11px text-t-tertiary'>
                            {t('settings.skillsHub.detailBuiltinAssistant', { defaultValue: 'Built-in' })}
                          </span>
                        ) : (
                          <Button
                            size='mini'
                            type='text'
                            icon={<Close size={13} />}
                            data-testid={`btn-detach-${assistant.id}`}
                            className='!h-22px !px-6px !text-12px !text-t-tertiary hover:!text-danger-6 opacity-0 group-hover:opacity-100 transition-opacity'
                            onClick={(e) => {
                              e.stopPropagation();
                              void setAttachment(assistant, false);
                            }}
                          >
                            {t('settings.skillsHub.detailDetach', { defaultValue: 'Remove' })}
                          </Button>
                        )}
                        <span className='flex items-center gap-2px text-12px text-t-tertiary group-hover:text-t-secondary'>
                          {t('settings.agentManagement.viewAssistant', { defaultValue: 'View' })}
                          <Right size={13} fill='currentColor' />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>
        )}
      </div>
    </SettingsPageWrapper>
  );
};

export default SkillDetailPage;
