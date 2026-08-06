// Modified from AionUI by WINK GO contributors in 2026.
import React from 'react';
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * Modifications Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for SkillDetailPage: info card, used-by list, and the
 * attach-to-assistants multi-select (user assistants only).
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAvailableSkills: vi.fn(),
  assistantsList: vi.fn(),
  assistantsUpdate: vi.fn(),
  getWechatPreferences: vi.fn(),
  saveWechatPreferences: vi.fn(),
  getSmartHomePreferences: vi.fn(),
  saveSmartHomePreferences: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  navigate: vi.fn(),
  params: { skillName: 'demo-skill' } as { skillName: string },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    fs: {
      listAvailableSkills: { invoke: mocks.listAvailableSkills },
    },
    assistants: {
      list: { invoke: mocks.assistantsList },
      update: { invoke: mocks.assistantsUpdate },
    },
    winkGoSkills: {
      getWechatPreferences: { invoke: mocks.getWechatPreferences },
      saveWechatPreferences: { invoke: mocks.saveWechatPreferences },
      getSmartHomePreferences: { invoke: mocks.getSmartHomePreferences },
      saveSmartHomePreferences: { invoke: mocks.saveSmartHomePreferences },
    },
  },
}));

vi.mock('@arco-design/web-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@arco-design/web-react')>();
  return {
    ...actual,
    Message: {
      ...actual.Message,
      error: mocks.messageError,
      success: mocks.messageSuccess,
    },
  };
});

vi.mock('react-router', () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => mocks.params,
  useLocation: () => ({ pathname: `/settings/skills/detail/${mocks.params.skillName}` }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, options?: Record<string, unknown>) => {
      const template = typeof options?.defaultValue === 'string' ? options.defaultValue : k;
      return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(options?.[key] ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

// SettingsPageWrapper pulls in layout context + extension tabs; stub it out.
vi.mock('@/renderer/pages/settings/components/SettingsPageWrapper', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/renderer/pages/settings/SkillsSettings/SkillFileBrowser', () => ({
  default: ({ skill }: { skill: { name: string } }) => <div data-testid='skill-file-browser'>{skill.name}</div>,
}));

import SkillDetailPage from '@/renderer/pages/settings/SkillsSettings/SkillDetailPage';
import { getAssistantsUsingSkill } from '@/renderer/pages/settings/SkillsSettings/SkillUsedByStack';

const makeAssistant = (overrides: Record<string, unknown>) => ({
  id: 'a1',
  source: 'user',
  name: 'Assistant One',
  name_i18n: {},
  description_i18n: {},
  enabled: true,
  sort_order: 0,
  agent_id: 'agent-1',
  enabled_skills: [],
  custom_skill_names: [],
  disabled_builtin_skills: [],
  context_i18n: {},
  prompts: [],
  prompts_i18n: {},
  models: [],
  agent_status: 'ready',
  team_selectable: true,
  deletable: true,
  ...overrides,
});

describe('getAssistantsUsingSkill', () => {
  it('matches enabled_skills and custom_skill_names, ignores others', () => {
    const assistants = [
      makeAssistant({ id: 'a1', enabled_skills: ['demo-skill'] }),
      makeAssistant({ id: 'a2', custom_skill_names: ['demo-skill'] }),
      makeAssistant({ id: 'a3', enabled_skills: ['other'] }),
    ] as never[];
    expect(getAssistantsUsingSkill('demo-skill', assistants).map((a) => a.id)).toEqual(['a1', 'a2']);
  });
});

describe('SkillDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.params.skillName = 'demo-skill';
    mocks.listAvailableSkills.mockResolvedValue([
      {
        name: 'demo-skill',
        description: 'A demo skill.',
        location: '/tmp/skills/demo-skill',
        is_auto_inject: false,
        is_custom: true,
        source: 'custom',
      },
      {
        name: 'wechat',
        description: 'WeChat integration.',
        location: '/tmp/skills/wechat',
        is_auto_inject: false,
        is_custom: true,
        source: 'custom',
      },
      {
        name: 'smart_home',
        description: 'Home Assistant and local appliances.',
        location: '/tmp/skills/smart_home',
        is_auto_inject: false,
        is_custom: true,
        source: 'custom',
      },
    ]);
    mocks.assistantsList.mockResolvedValue([
      makeAssistant({ id: 'a1', name: 'Writer', enabled_skills: ['demo-skill'] }),
      makeAssistant({ id: 'a2', name: 'Coder', enabled_skills: [] }),
      makeAssistant({ id: 'b1', name: 'Butler', source: 'builtin', enabled_skills: ['demo-skill'] }),
    ]);
    mocks.assistantsUpdate.mockResolvedValue({});
    mocks.getWechatPreferences.mockResolvedValue({ favoriteContacts: [], favoriteGroups: [] });
    mocks.saveWechatPreferences.mockImplementation(async (preferences) => preferences);
    mocks.getSmartHomePreferences.mockResolvedValue({
      homeAssistantUrl: 'http://homeassistant.local:8123',
      accessTokenConfigured: false,
      appliancesJson: '[]',
      scenesJson: '[]',
    });
    mocks.saveSmartHomePreferences.mockImplementation(async (preferences) => ({
      homeAssistantUrl: preferences.homeAssistantUrl,
      accessTokenConfigured: Boolean(preferences.accessToken),
      appliancesJson: preferences.appliancesJson,
      scenesJson: preferences.scenesJson,
    }));
  });

  it('renders skill info and used-by rows (builtin marked read-only)', async () => {
    render(<SkillDetailPage />);

    await waitFor(() => expect(screen.getByTestId('skill-detail-info')).toBeInTheDocument());
    expect(screen.getByText('A demo skill.')).toBeInTheDocument();

    // Used by: Writer (user) + Butler (builtin)
    expect(screen.getByTestId('skill-used-by-row-a1')).toBeInTheDocument();
    expect(screen.getByTestId('skill-used-by-row-b1')).toBeInTheDocument();
    expect(screen.queryByTestId('skill-used-by-row-a2')).not.toBeInTheDocument();
    expect(screen.getByText('Built-in')).toBeInTheDocument();
  });

  it('shows not-found state for a missing skill', async () => {
    mocks.params.skillName = 'ghost-skill';
    render(<SkillDetailPage />);

    await waitFor(() => expect(screen.getByTestId('skill-detail-not-found')).toBeInTheDocument());
  });

  it('offers only unattached editable assistants in the add menu', async () => {
    render(<SkillDetailPage />);

    await waitFor(() => expect(screen.getByTestId('btn-add-assistant')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('btn-add-assistant'));

    // Coder (user, not using) is addable; Writer already uses the skill and
    // builtin Butler is never editable, so neither shows in the menu.
    await waitFor(() => expect(screen.getByTestId('menu-add-assistant-a2')).toBeInTheDocument());
    expect(screen.queryByTestId('menu-add-assistant-a1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('menu-add-assistant-b1')).not.toBeInTheDocument();
  });

  it('attaches the skill when an assistant is picked from the add menu', async () => {
    render(<SkillDetailPage />);

    await waitFor(() => expect(screen.getByTestId('btn-add-assistant')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('btn-add-assistant'));
    const item = await screen.findByTestId('menu-add-assistant-a2');
    fireEvent.click(item);

    await waitFor(() =>
      expect(mocks.assistantsUpdate).toHaveBeenCalledWith({ id: 'a2', enabled_skills: ['demo-skill'] })
    );
  });

  it('detaches via the inline remove button without navigating', async () => {
    render(<SkillDetailPage />);

    await waitFor(() => expect(screen.getByTestId('btn-detach-a1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('btn-detach-a1'));

    await waitFor(() => expect(mocks.assistantsUpdate).toHaveBeenCalledWith({ id: 'a1', enabled_skills: [] }));
    // Row click navigation must not fire from the remove button.
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('builtin users show a read-only tag instead of a remove button', async () => {
    render(<SkillDetailPage />);

    await waitFor(() => expect(screen.getByTestId('skill-used-by-row-b1')).toBeInTheDocument());
    expect(screen.getByText('Built-in')).toBeInTheDocument();
    expect(screen.queryByTestId('btn-detach-b1')).not.toBeInTheDocument();
  });

  it('navigates to the assistant editor when a used-by row is clicked', async () => {
    render(<SkillDetailPage />);

    await waitFor(() => expect(screen.getByTestId('skill-used-by-row-a1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('skill-used-by-row-a1'));
    expect(mocks.navigate).toHaveBeenCalledWith('/assistants', {
      state: { openAssistantEditor: true, openAssistantId: 'a1' },
    });
  });

  it('back button returns to the skills list', async () => {
    render(<SkillDetailPage />);

    await waitFor(() => expect(screen.getByTestId('btn-back-skill-detail')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('btn-back-skill-detail'));
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/skills');
  });

  it('renders ten contact and ten group slots immediately even while preferences are still loading', async () => {
    mocks.params.skillName = 'wechat';
    mocks.getWechatPreferences.mockReturnValue(new Promise(() => undefined));

    render(<SkillDetailPage />);

    await waitFor(() => expect(screen.getByTestId('winkgo-wechat-preferences')).toBeInTheDocument());
    expect(screen.getAllByTestId(/^wechat-contact-slot-/)).toHaveLength(10);
    expect(screen.getAllByTestId(/^wechat-group-slot-/)).toHaveLength(10);
    expect(screen.getByTestId('btn-save-winkgo-wechat-preferences')).toBeEnabled();
  });

  it('loads and saves the fixed WeChat preference slots', async () => {
    mocks.params.skillName = 'wechat';
    mocks.getWechatPreferences.mockResolvedValue({
      favoriteContacts: ['Alice', 'Bob'],
      favoriteGroups: ['Project Team'],
    });

    render(<SkillDetailPage />);

    const contactSlot = await screen.findByTestId('wechat-contact-slot-0');
    await waitFor(() => expect(contactSlot).toHaveValue('Alice'));
    fireEvent.change(screen.getByTestId('wechat-contact-slot-2'), { target: { value: 'Charlie' } });
    fireEvent.change(screen.getByTestId('wechat-group-slot-1'), { target: { value: 'Family' } });
    fireEvent.click(screen.getByTestId('btn-save-winkgo-wechat-preferences'));

    await waitFor(() =>
      expect(mocks.saveWechatPreferences).toHaveBeenCalledWith({
        favoriteContacts: ['Alice', 'Bob', 'Charlie'],
        favoriteGroups: ['Project Team', 'Family'],
      })
    );
  });

  it('loads and saves the customer smart-home connection without exposing a stored token', async () => {
    mocks.params.skillName = 'smart_home';
    mocks.getSmartHomePreferences.mockResolvedValue({
      homeAssistantUrl: 'http://192.168.1.20:8123',
      accessTokenConfigured: true,
      appliancesJson: '[]',
      scenesJson: '[]',
    });

    render(<SkillDetailPage />);

    const url = await screen.findByTestId('smart-home-url');
    await waitFor(() => expect(url).toHaveValue('http://192.168.1.20:8123'));
    expect(screen.getByTestId('smart-home-token')).toHaveValue('');
    fireEvent.change(screen.getByTestId('smart-home-appliances'), {
      target: { value: '[{"id":"desk-lamp","name":"Desk lamp"}]' },
    });
    fireEvent.click(screen.getByTestId('btn-save-winkgo-smart-home-preferences'));

    await waitFor(() =>
      expect(mocks.saveSmartHomePreferences).toHaveBeenCalledWith({
        homeAssistantUrl: 'http://192.168.1.20:8123',
        accessToken: undefined,
        clearAccessToken: false,
        appliancesJson: '[{"id":"desk-lamp","name":"Desk lamp"}]',
        scenesJson: '[]',
      })
    );
  });
});
