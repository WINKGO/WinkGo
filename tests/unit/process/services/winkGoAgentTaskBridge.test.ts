import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWinkGoAgentBridgeRuntimeEnv,
  WinkGoAgentTaskBridgeService,
} from '@/process/services/winkgoRemote/AgentTaskBridge';
import { changeLanguage, i18nReady } from '@/process/services/i18n';

const geminiAssistant = {
  id: 'builtin-gemini',
  name: 'Gemini CLI',
  enabled: true,
  agent_status: 'online',
  agent: { type: 'acp', acp_backend: 'gemini' },
};

const winkGoCliAssistant = {
  id: 'builtin-winkgo-cli',
  name: 'WINK GO CLI',
  enabled: true,
  agent_status: 'online',
  agent: { type: 'winkgo_agent' },
};

describe('WINK GO XiaoZhi Agent task bridge', () => {
  let service: WinkGoAgentTaskBridgeService | undefined;

  beforeEach(async () => {
    await i18nReady;
    await changeLanguage('zh-CN');
  });

  afterEach(async () => {
    await service?.stop();
    service = undefined;
  });

  it('uses WINK GO CLI as the default voice Agent when no Agent is named', async () => {
    const created: Array<Record<string, unknown>> = [];
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant, winkGoCliAssistant],
      getAssistantDetail: async () => ({
        defaults: { model: { mode: 'auto' } },
        preferences: { last_model_id: 'gpt-5.6-terra' },
      }),
      listProviders: async () => [
        {
          id: 'provider-winkgo',
          name: 'WINK GO 中转站',
          platform: 'openai-compatible',
          base_url: 'https://winkgo.xyz/v1',
          api_key: 'stored-by-backend',
          models: ['gpt-5.6-terra'],
          enabled: true,
        },
      ],
      createConversation: async (request) => {
        created.push(request);
        return { id: `conversation-${request.assistant.id}` };
      },
      sendMessage: async () => ({ turn_id: 'turn-winkgo-cli' }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();

    const response = await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers: { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: '管家帮我检查登录问题', source: 'xiaozhi_hardware' }),
    });
    const payload = await response.json();

    expect(payload).toMatchObject({
      success: true,
      assistant_id: 'builtin-winkgo-cli',
      assistant_name: 'WINK GO CLI',
      conversation_id: 'conversation-builtin-winkgo-cli',
      provider_id: 'provider-winkgo',
      model_id: 'gpt-5.6-terra',
    });
    expect(created[0]).toMatchObject({
      model: { id: 'provider-winkgo', use_model: 'gpt-5.6-terra' },
    });
  });

  it('submits an unmatched voice task into the selected WINK GO Agent conversation', async () => {
    const created: Array<Record<string, unknown>> = [];
    const sent: Array<Record<string, unknown>> = [];
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async (request) => {
        created.push(request);
        return { id: 'conversation-1' };
      },
      sendMessage: async (request) => {
        sent.push(request);
        return { turn_id: 'turn-1' };
      },
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();

    const response = await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bridge-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: '让 Gemini CLI 检查 WINK GO 登录错误',
        source: 'xiaozhi_hardware:account-1:device-1',
      }),
    });
    const payload = await response.json();

    expect(response.status).toBe(202);
    expect(payload).toMatchObject({
      success: true,
      accepted: true,
      assistant_name: 'Gemini CLI',
      conversation_id: 'conversation-1',
      turn_id: 'turn-1',
    });
    expect(created[0]).toMatchObject({ assistant: { id: 'builtin-gemini' } });
    expect(sent).toEqual([
      {
        conversation_id: 'conversation-1',
        input: '让 Gemini CLI 检查 WINK GO 登录错误',
      },
    ]);
  });

  it('isolates browser voice tasks and requires the WINK GO in-app browser tools', async () => {
    const created: Array<{ extra: { context: string } }> = [];
    const sent: Array<Record<string, unknown>> = [];
    let nextConversation = 0;
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async (request) => {
        created.push(request);
        nextConversation += 1;
        return { id: `conversation-${nextConversation}` };
      },
      sendMessage: async (request) => {
        sent.push(request);
        return { turn_id: `turn-${sent.length}` };
      },
      getConversation: async ({ id }) => ({
        id,
        status: 'running',
        runtime: { state: 'running', is_processing: true, pending_confirmations: 0 },
      }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    const submit = (command: string) =>
      fetch(`${endpoint.url}/v1/agent-tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ command, source: 'xiaozhi_hardware:browser-policy' }),
      });

    await submit('管家检查本地项目');
    const browserResponse = await submit('用 Agent 和内置浏览器打开携程');
    const browserPayload = await browserResponse.json();

    expect(browserPayload).toMatchObject({ execution_surface: 'browser' });
    expect(created).toHaveLength(2);
    expect(created[1].extra.context).toContain('run_browser_task');
    expect(created[1].extra.context).toContain('browser_action');
    expect(created[1].extra.context).toContain('inspect_browser_page');
    expect(created[1].extra.context).toContain('严禁调用 windows_open_url');
    expect(sent).toEqual([
      { conversation_id: 'conversation-1', input: '管家检查本地项目' },
      { conversation_id: 'conversation-2', input: '用 Agent 和内置浏览器打开携程' },
    ]);
  });

  it('starts a clean conversation when the previous task on the same surface has finished', async () => {
    let nextConversation = 0;
    const created: string[] = [];
    const sent: Array<Record<string, unknown>> = [];
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => {
        nextConversation += 1;
        const id = `conversation-${nextConversation}`;
        created.push(id);
        return { id };
      },
      sendMessage: async (request) => {
        sent.push(request);
        return { turn_id: `turn-${sent.length}` };
      },
      getConversation: async ({ id }) => ({
        id,
        status: 'finished',
        runtime: { state: 'idle', is_processing: false, pending_confirmations: 0 },
      }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    const submit = (command: string) =>
      fetch(`${endpoint.url}/v1/agent-tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ command, source: 'xiaozhi_hardware:clean-context' }),
      });

    await submit('使用 WINK GO 内置浏览器打开官网');
    const secondResponse = await submit('使用 WINK GO 内置浏览器打开文档页');
    const secondPayload = await secondResponse.json();

    expect(created).toEqual(['conversation-1', 'conversation-2']);
    expect(secondPayload.conversation_id).toBe('conversation-2');
    expect(sent.at(-1)).toMatchObject({ conversation_id: 'conversation-2' });
  });

  it('recreates a conversation when the cached Agent task path no longer exists', async () => {
    let nextConversation = 0;
    const sent: Array<Record<string, unknown>> = [];
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => {
        nextConversation += 1;
        return { id: `conversation-${nextConversation}` };
      },
      sendMessage: async (request) => {
        sent.push(request);
        return { turn_id: `turn-${sent.length}` };
      },
      getConversation: async () => {
        throw new Error('Conversation not found');
      },
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    const submit = (command: string) =>
      fetch(`${endpoint.url}/v1/agent-tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ command, source: 'xiaozhi_hardware:stale-path' }),
      });

    await submit('管家检查项目');
    const response = await submit('继续检查登录页');
    const payload = await response.json();

    expect(payload.conversation_id).toBe('conversation-2');
    expect(sent.map((item) => item.conversation_id)).toEqual(['conversation-1', 'conversation-2']);
  });

  it('returns a safe not-found status when the Agent conversation was removed', async () => {
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: 'conversation-removed' }),
      sendMessage: async () => ({ turn_id: 'turn-removed' }),
      getConversation: async () => {
        throw new Error('Conversation not found');
      },
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '管家检查项目', source: 'xiaozhi_hardware:removed' }),
    });

    const response = await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:removed' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, found: false, execution_status: 'not_found' });
    expect(payload.message).toContain('当前没有管家任务');
  });

  it('serves dynamic conversation, team and capability catalogs to XiaoZhi', async () => {
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      listConversations: async () => ({
        items: [{ id: 'conversation-1', name: '登录排查', status: 'finished', type: 'winkgo_agent' }],
      }),
      listTeams: async () => [{ id: 'team-1', name: '开发团队', agents: [{}, {}] }],
      listSkills: async () => [{ name: 'officecli', description: 'Office 文档处理' }],
      listMcpServers: async () => [{ id: 'mcp-1', name: 'winkgo-browser', builtin: true }],
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    const readCatalog = async (kind: string) => {
      const response = await fetch(`${endpoint.url}/v1/catalog`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind, source: 'xiaozhi_hardware' }),
      });
      return response.json();
    };

    const conversations = await readCatalog('conversations');
    const teams = await readCatalog('teams');
    const capabilities = await readCatalog('capabilities');

    expect(conversations.items[0].name).toBe('登录排查');
    expect(teams.items[0]).toMatchObject({ name: '开发团队', member_count: 2 });
    expect(capabilities.counts).toMatchObject({ assistants: 1, teams: 1, skills: 1, mcp_servers: 1 });
  });

  it('opens only a whitelisted WINK GO feature route', async () => {
    const routes: string[] = [];
    service = new WinkGoAgentTaskBridgeService({
      navigateMainWindow: async (route) => {
        routes.push(route);
        return true;
      },
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };

    const opened = await fetch(`${endpoint.url}/v1/app-features/open`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ feature: 'models', source: 'xiaozhi_hardware' }),
    });
    const rejected = await fetch(`${endpoint.url}/v1/app-features/open`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ feature: '../../login', source: 'xiaozhi_hardware' }),
    });

    expect(await opened.json()).toMatchObject({ success: true, opened: true, route: '/settings/model' });
    expect(rejected.status).toBe(404);
    expect(routes).toEqual(['/settings/model']);
  });

  it('rejects callers without the per-launch bridge token', async () => {
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: 'unused' }),
      sendMessage: async () => ({ turn_id: 'unused' }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();

    const response = await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: '运行任务', source: 'xiaozhi_hardware' }),
    });

    expect(response.status).toBe(401);
  });

  it('reports the latest voice Agent task status for the same XiaoZhi source', async () => {
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: 'conversation-status' }),
      sendMessage: async () => ({ turn_id: 'turn-status' }),
      getConversation: async () => ({
        id: 'conversation-status',
        status: 'running',
        runtime: { state: 'running', is_processing: true, pending_confirmations: 0 },
      }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = {
      Authorization: 'Bearer bridge-token',
      'Content-Type': 'application/json',
    };
    await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '管家帮我检查项目', source: 'xiaozhi_hardware:device-1' }),
    });

    const response = await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:device-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      found: true,
      task_id: 'turn-status',
      conversation_id: 'conversation-status',
      turn_id: 'turn-status',
      execution_status: 'running',
    });
  });

  it('tells XiaoZhi that a follow-up is safely queued behind the running task', async () => {
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [winkGoCliAssistant],
      getAssistantDetail: async () => ({
        defaults: { model: { mode: 'auto' } },
        preferences: { last_model_id: 'gpt-5.6-terra' },
      }),
      listProviders: async () => [
        {
          id: 'provider-winkgo',
          name: 'WINK GO 中转站',
          platform: 'openai-compatible',
          base_url: 'https://winkgo.xyz/v1',
          api_key: 'stored-by-backend',
          models: ['gpt-5.6-terra'],
          enabled: true,
        },
      ],
      createConversation: async () => ({ id: 'conversation-queued' }),
      sendMessage: async () => ({
        msg_id: 'queued-msg',
        turn_id: 'turn-active',
        queued_at_boundary: true,
      }),
      getConversation: async () => ({
        id: 'conversation-queued',
        status: 'running',
        runtime: { state: 'running', is_processing: true, pending_confirmations: 0 },
      }),
      getConversationMessages: async () => ({
        items: [{ id: 'queued-msg', msg_id: 'queued-msg', type: 'text', position: 'right', status: 'pending' }],
      }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    const submit = await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '再检查一下下载链接', source: 'xiaozhi_hardware:queued' }),
    });
    const submitted = await submit.json();
    expect(submitted).toMatchObject({ execution_status: 'queued' });
    expect(submitted.message).toContain('已排队');

    const status = await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:queued' }),
    });
    const payload = await status.json();
    expect(payload).toMatchObject({ execution_status: 'queued' });
    expect(payload.message).toContain('自动执行');
  });

  it('queries the exact queued message so an error is not hidden outside the latest page', async () => {
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [winkGoCliAssistant],
      getAssistantDetail: async () => ({
        defaults: { model: { mode: 'auto' } },
        preferences: { last_model_id: 'gpt-5.6-terra' },
      }),
      listProviders: async () => [
        {
          id: 'provider-winkgo',
          name: 'WINK GO 中转站',
          platform: 'openai-compatible',
          base_url: 'https://winkgo.xyz/v1',
          api_key: 'stored-by-backend',
          models: ['gpt-5.6-terra'],
          enabled: true,
        },
      ],
      createConversation: async () => ({ id: 'conversation-queued-error' }),
      sendMessage: async () => ({
        msg_id: 'queued-error-msg',
        turn_id: 'turn-old',
        queued_at_boundary: true,
      }),
      getConversation: async () => ({
        id: 'conversation-queued-error',
        status: 'finished',
        runtime: { state: 'idle', is_processing: false, pending_confirmations: 0 },
      }),
      getConversationMessage: async () => ({
        id: 'queued-error-msg',
        msg_id: 'queued-error-msg',
        type: 'text',
        position: 'right',
        status: 'error',
        content: { content: '投递结果不确定' },
      }),
      getConversationMessages: async () => ({ items: [] }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '继续任务', source: 'xiaozhi_hardware:queued-error' }),
    });

    const response = await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:queued-error' }),
    });
    const payload = await response.json();

    expect(payload.execution_status).toBe('failed');
    expect(payload.message).toContain('投递结果不确定');
  });

  it('reports a finished provider error as failed instead of claiming task completion', async () => {
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: 'conversation-failed' }),
      sendMessage: async () => ({ turn_id: 'turn-failed' }),
      getConversation: async () => ({
        id: 'conversation-failed',
        status: 'finished',
        runtime: { state: 'idle', is_processing: false, pending_confirmations: 0 },
      }),
      getConversationMessages: async () => ({
        items: [
          {
            type: 'tips',
            status: 'finish',
            content: { type: 'error', content: '模型服务暂时返回 503，请稍后重试。' },
          },
        ],
      }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '管家检查项目', source: 'xiaozhi_hardware:failed' }),
    });

    const response = await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:failed' }),
    });
    const payload = await response.json();

    expect(payload).toMatchObject({
      execution_status: 'failed',
      failure_summary: '模型服务暂时返回 503，请稍后重试。',
    });
    expect(payload.message).toContain('执行失败');
  });

  it('returns the latest assistant reply when a voice Agent task has finished', async () => {
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: 'conversation-result' }),
      sendMessage: async () => ({ turn_id: 'turn-result' }),
      getConversation: async () => ({
        id: 'conversation-result',
        status: 'finished',
        runtime: { state: 'idle', is_processing: false, pending_confirmations: 0 },
      }),
      getConversationMessages: async () => ({
        items: [
          { type: 'text', status: 'finish', position: 'right', content: { content: '打开官网并读取标题' } },
          {
            type: 'text',
            status: 'finish',
            position: 'left',
            content: { content: '网页标题是 WINKGO - Experience AI that can actually do。' },
          },
        ],
      }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '管家打开官网', source: 'xiaozhi_hardware:result' }),
    });

    const response = await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:result' }),
    });
    const payload = await response.json();

    expect(payload.execution_status).toBe('finished');
    expect(payload.final_result).toBe('网页标题是 WINKGO - Experience AI that can actually do。');
    expect(payload.message).toContain(payload.final_result);
  });

  it('restores the latest Agent result after the bridge restarts', async () => {
    let persisted: unknown[] = [];
    const persistence = {
      loadTaskHistory: async () => structuredClone(persisted) as never,
      saveTaskHistory: async (tasks: unknown[]) => {
        persisted = structuredClone(tasks);
      },
    };
    const dependencies = {
      ...persistence,
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: 'conversation-persisted' }),
      sendMessage: async () => ({ turn_id: 'turn-persisted' }),
      getConversation: async () => ({
        id: 'conversation-persisted',
        status: 'finished',
        runtime: { state: 'idle', is_processing: false, pending_confirmations: 0 },
      }),
      getConversationMessages: async () => ({
        items: [
          {
            type: 'text',
            status: 'finish',
            position: 'left',
            content: { content: '订票页面已经打开。' },
          },
        ],
      }),
      tokenFactory: () => 'bridge-token',
    };
    service = new WinkGoAgentTaskBridgeService(dependencies);
    let endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '打开携程订票页面', source: 'xiaozhi_hardware:persisted' }),
    });
    await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:persisted' }),
    });
    await service.stop();

    service = new WinkGoAgentTaskBridgeService(dependencies);
    endpoint = await service.start();
    const response = await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:persisted' }),
    });
    const payload = await response.json();

    expect(payload.execution_status).toBe('finished');
    expect(payload.final_result).toBe('订票页面已经打开。');
    expect(persisted).toHaveLength(1);
  });

  it('starts safely when persisted Agent history cannot be read', async () => {
    service = new WinkGoAgentTaskBridgeService({
      loadTaskHistory: async () => {
        throw new Error('history is unreadable');
      },
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const response = await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers: { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'xiaozhi_hardware:history-error' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.diagnostic_code).toBe('AGENT_TASK_HISTORY_EMPTY');
  });

  it('selects a recent Agent task by the spoken task keyword', async () => {
    let conversationNumber = 0;
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: `conversation-${++conversationNumber}` }),
      sendMessage: async () => ({ turn_id: `turn-${conversationNumber}` }),
      getConversation: async ({ id }) => ({
        id,
        status: 'finished',
        runtime: { state: 'idle', is_processing: false, pending_confirmations: 0 },
      }),
      getConversationMessages: async ({ conversation_id }) => ({
        items: [
          {
            type: 'text',
            status: 'finish',
            position: 'left',
            content: {
              content: conversation_id === 'conversation-1' ? '订票任务完成。' : '简历任务完成。',
            },
          },
        ],
      }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    for (const command of ['检查订票订单', '制作个人简历']) {
      await fetch(`${endpoint.url}/v1/agent-tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ command, source: 'xiaozhi_hardware:multi-task' }),
      });
    }

    const response = await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        source: 'xiaozhi_hardware:multi-task',
        query: '订票任务完成了吗',
      }),
    });
    const payload = await response.json();

    expect(payload.task_id).toBe('turn-1');
    expect(payload.final_result).toBe('订票任务完成。');
  });

  it('lists up to ten recent Agent tasks for one XiaoZhi source', async () => {
    let conversationNumber = 0;
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: `conversation-${++conversationNumber}` }),
      sendMessage: async () => ({ turn_id: `turn-${conversationNumber}` }),
      getConversation: async ({ id }) => ({
        id,
        status: 'finished',
        runtime: { state: 'idle', is_processing: false, pending_confirmations: 0 },
      }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    for (let index = 1; index <= 11; index += 1) {
      await fetch(`${endpoint.url}/v1/agent-tasks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ command: `测试任务 ${index}`, source: 'xiaozhi_hardware:history' }),
      });
    }

    const response = await fetch(`${endpoint.url}/v1/agent-tasks/status`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:history', query: '列出最近 Agent 任务' }),
    });
    const payload = await response.json();

    expect(payload.execution_status).toBe('task_history');
    expect(payload.items).toHaveLength(10);
    expect(payload.items[0].command).toBe('测试任务 11');
  });

  it('cancels the latest voice Agent task for the same XiaoZhi source', async () => {
    const stopped: Array<Record<string, unknown>> = [];
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: 'conversation-cancel' }),
      sendMessage: async () => ({ turn_id: 'turn-cancel' }),
      getConversation: async () => ({
        id: 'conversation-cancel',
        status: stopped.length ? 'finished' : 'running',
        runtime: stopped.length
          ? { state: 'idle', is_processing: false, pending_confirmations: 0 }
          : { state: 'running', is_processing: true, pending_confirmations: 0, turn_id: 'turn-cancel' },
      }),
      stopConversation: async (request) => {
        stopped.push(request);
      },
      wait: async () => undefined,
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = {
      Authorization: 'Bearer bridge-token',
      'Content-Type': 'application/json',
    };
    await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '管家帮我检查项目', source: 'xiaozhi_hardware:device-1' }),
    });

    const response = await fetch(`${endpoint.url}/v1/agent-tasks/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:device-1' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, cancelled: true, task_id: 'turn-cancel' });
    expect(stopped).toEqual([{ conversation_id: 'conversation-cancel', turn_id: 'turn-cancel' }]);
  });

  it('cancels the current boundary turn instead of the stale turn returned at enqueue time', async () => {
    const stopped: Array<Record<string, unknown>> = [];
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: 'conversation-boundary-cancel' }),
      sendMessage: async () => ({
        msg_id: 'boundary-cancel-msg',
        turn_id: 'turn-old',
        queued_at_boundary: true,
      }),
      getConversation: async () => ({
        id: 'conversation-boundary-cancel',
        status: stopped.length ? 'finished' : 'running',
        runtime: stopped.length
          ? { state: 'idle', is_processing: false, pending_confirmations: 0 }
          : { state: 'running', is_processing: true, pending_confirmations: 0, turn_id: 'turn-current' },
      }),
      getConversationMessage: async () => ({
        id: 'boundary-cancel-msg',
        msg_id: 'boundary-cancel-msg',
        type: 'text',
        position: 'right',
        status: 'work',
      }),
      stopConversation: async (request) => {
        stopped.push(request);
      },
      wait: async () => undefined,
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '继续任务', source: 'xiaozhi_hardware:boundary-cancel' }),
    });

    await fetch(`${endpoint.url}/v1/agent-tasks/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:boundary-cancel' }),
    });

    expect(stopped[0]).toEqual({
      conversation_id: 'conversation-boundary-cancel',
      turn_id: 'turn-current',
    });
  });

  it('retries cancellation while the Agent turn is still starting or waiting for confirmation', async () => {
    let probeCount = 0;
    const stopped: Array<Record<string, unknown>> = [];
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: 'conversation-race' }),
      sendMessage: async () => ({ turn_id: 'turn-race' }),
      getConversation: async () => {
        probeCount += 1;
        return probeCount < 3
          ? {
              id: 'conversation-race',
              status: 'running',
              runtime: { state: 'waiting_confirmation', is_processing: true, pending_confirmations: 1 },
            }
          : {
              id: 'conversation-race',
              status: 'finished',
              runtime: { state: 'idle', is_processing: false, pending_confirmations: 0 },
            };
      },
      stopConversation: async (request) => {
        stopped.push(request);
      },
      wait: async () => undefined,
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '管家帮我检查项目', source: 'xiaozhi_hardware:race' }),
    });

    const response = await fetch(`${endpoint.url}/v1/agent-tasks/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:race' }),
    });
    const payload = await response.json();

    expect(payload).toMatchObject({ success: true, cancelled: true, execution_status: 'cancelled' });
    expect(stopped).toHaveLength(1);
    expect(probeCount).toBe(3);
  });

  it('rejects pending Agent confirmations before cancelling the turn', async () => {
    const rejected: Array<Record<string, unknown>> = [];
    let confirmationProbeCount = 0;
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant],
      createConversation: async () => ({ id: 'conversation-confirmation' }),
      sendMessage: async () => ({ turn_id: 'turn-confirmation' }),
      listConfirmations: async () => {
        confirmationProbeCount += 1;
        return confirmationProbeCount < 6
          ? []
          : [
              {
                id: 'message-confirmation',
                call_id: 'call-confirmation',
                options: [
                  { value: 'proceed_once', label: 'Allow' },
                  { value: 'reject', label: 'Reject' },
                ],
              },
            ];
      },
      respondConfirmation: async (request) => {
        rejected.push(request);
      },
      getConversation: async () =>
        rejected.length > 0
          ? {
              id: 'conversation-confirmation',
              status: 'finished',
              runtime: { state: 'idle', is_processing: false, pending_confirmations: 0 },
            }
          : {
              id: 'conversation-confirmation',
              status: 'running',
              runtime: { state: 'waiting_confirmation', is_processing: true, pending_confirmations: 1 },
            },
      stopConversation: async () => undefined,
      wait: async () => undefined,
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const headers = { Authorization: 'Bearer bridge-token', 'Content-Type': 'application/json' };
    await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ command: '管家帮我检查项目', source: 'xiaozhi_hardware:confirmation' }),
    });

    await fetch(`${endpoint.url}/v1/agent-tasks/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'xiaozhi_hardware:confirmation' }),
    });

    expect(rejected).toEqual([
      {
        conversation_id: 'conversation-confirmation',
        msg_id: 'message-confirmation',
        call_id: 'call-confirmation',
        data: { value: 'reject' },
      },
    ]);
    expect(confirmationProbeCount).toBe(6);
  });

  it('injects only the loopback endpoint and per-launch token into Runtime', () => {
    expect(
      createWinkGoAgentBridgeRuntimeEnv({
        url: 'http://127.0.0.1:43123',
        token: 'bridge-token',
      })
    ).toEqual({
      WINKGO_AGENT_BRIDGE_URL: 'http://127.0.0.1:43123',
      WINKGO_AGENT_BRIDGE_TOKEN: 'bridge-token',
    });
  });

  it('keeps short follow-up commands in the explicitly selected Agent conversation', async () => {
    const kimiAssistant = {
      id: 'builtin-kimi',
      name: 'Kimi',
      enabled: true,
      agent_status: 'online',
      agent: { type: 'acp', acp_backend: 'kimi' },
    };
    let createCount = 0;
    const sent: Array<Record<string, unknown>> = [];
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [geminiAssistant, kimiAssistant],
      createConversation: async (request) => {
        createCount += 1;
        return { id: request.assistant.id === 'builtin-kimi' ? 'kimi-conversation' : 'gemini-conversation' };
      },
      sendMessage: async (request) => {
        sent.push(request);
        return { turn_id: `turn-${sent.length}` };
      },
      getConversation: async ({ id }) => ({
        id,
        status: 'running',
        runtime: { state: 'running', is_processing: true, pending_confirmations: 0 },
      }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();
    const submit = (command: string) =>
      fetch(`${endpoint.url}/v1/agent-tasks`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer bridge-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ command, source: 'xiaozhi_hardware:account-1:device-1' }),
      });

    await submit('让 Kimi 审核登录模块');
    const followUp = await submit('继续检查注册流程');
    const payload = await followUp.json();

    expect(payload.assistant_name).toBe('Kimi');
    expect(createCount).toBe(1);
    expect(sent.map((item) => item.conversation_id)).toEqual(['kimi-conversation', 'kimi-conversation']);
  });

  it('does not submit a task to a retired desktop Agent', async () => {
    service = new WinkGoAgentTaskBridgeService({
      listAssistants: async () => [
        {
          id: 'builtin-codex',
          name: 'Codex CLI',
          enabled: true,
          agent_status: 'online',
          agent: { type: 'acp', acp_backend: 'codex' },
        },
        geminiAssistant,
      ],
      createConversation: async () => ({ id: 'must-not-create' }),
      sendMessage: async () => ({ turn_id: 'must-not-send' }),
      tokenFactory: () => 'bridge-token',
    });
    const endpoint = await service.start();

    const response = await fetch(`${endpoint.url}/v1/agent-tasks`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer bridge-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ command: '让 Codex CLI 检查项目', source: 'xiaozhi_hardware' }),
    });

    expect(response.status).toBe(503);
  });
});
