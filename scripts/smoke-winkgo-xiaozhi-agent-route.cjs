#!/usr/bin/env node

const WebSocket = require('ws');

const token = String(process.env.WINKGO_TEST_RUNTIME_TOKEN || '').trim();
if (!token) throw new Error('WINKGO_TEST_RUNTIME_TOKEN is required');

const source = String(process.env.WINKGO_QA_SOURCE || '').trim() || `xiaozhi_hardware:qa-agent-route-${Date.now()}`;
const mode = String(process.env.WINKGO_QA_MODE || 'full').trim().toLowerCase();
const adHocCommand = String(process.env.WINKGO_QA_COMMAND || '').trim();
const runtimeSocketUrl = String(process.env.WINKGO_QA_RUNTIME_WS || 'ws://127.0.0.1:8121/mcp').trim();
const socket = new WebSocket(runtimeSocketUrl, {
  headers: { Authorization: `Bearer ${token}` },
});
const pending = new Map();
let nextId = 1;

const request = (method, params, timeoutMs = 45_000) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });

socket.on('message', (data) => {
  const message = JSON.parse(String(data));
  const requestState = pending.get(message.id);
  if (!requestState) return;
  pending.delete(message.id);
  if (message.error) requestState.reject(new Error(JSON.stringify(message.error)));
  else requestState.resolve(message.result);
});

const parseToolPayload = (result) => {
  const text = result?.content?.find?.((item) => item?.type === 'text')?.text || '';
  const payload = JSON.parse(text);
  if (!payload || typeof payload !== 'object') throw new Error('Runtime returned an invalid tool payload');
  return payload;
};

const callCommand = async (command) =>
  parseToolPayload(
    await request('tools/call', {
      name: 'tools.run_skill_command',
      arguments: { command, source },
    })
  );

const run = async () => {
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'WINK GO XiaoZhi Agent QA', version: '1.0.0' },
  });
  socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }));

  if (adHocCommand) {
    const payload = await callCommand(adHocCommand);
    console.log(JSON.stringify({ success: true, source, command: adHocCommand, payload }, null, 2));
    return;
  }

  if (mode === 'status' || mode === 'cancel') {
    const payload = await callCommand(mode === 'status' ? '管家任务进度' : '取消管家任务');
    console.log(JSON.stringify({ success: true, source, mode, payload }, null, 2));
    return;
  }

  const submitted = await callCommand(
    '小智，管家帮我查询明天珠海到长沙的机票；这是路由测试，只生成计划，不提交订单'
  );
  if (submitted.routing_mode !== 'agent' || submitted.execution_status !== 'agent_task_accepted') {
    throw new Error(`Agent submission was misrouted: ${JSON.stringify(submitted)}`);
  }
  if (/fliggy|飞猪/i.test(JSON.stringify(submitted))) {
    throw new Error(`Agent submission leaked into Fliggy: ${JSON.stringify(submitted)}`);
  }
  if (/winkgo\s*cli/i.test(String(submitted.assistant_name || '')) && !submitted.model_id) {
    throw new Error(`WINK GO CLI task was created without a model: ${JSON.stringify(submitted)}`);
  }

  const status = await callCommand('管家任务进度');
  if (status.execution_status !== 'agent_task_status' || status.task_id !== submitted.task_id) {
    throw new Error(`Agent status did not resolve the submitted task: ${JSON.stringify(status)}`);
  }

  const cancelled = await callCommand('取消管家任务');
  if (cancelled.execution_status !== 'agent_task_cancelled' || cancelled.task_id !== submitted.task_id) {
    throw new Error(`Agent cancellation did not stop the submitted task: ${JSON.stringify(cancelled)}`);
  }

  console.log(
    JSON.stringify(
      {
        success: true,
        source,
        submitted: {
          routing_mode: submitted.routing_mode,
          execution_status: submitted.execution_status,
          task_id: submitted.task_id,
          assistant_name: submitted.assistant_name,
          provider_id: submitted.provider_id,
          model_id: submitted.model_id,
        },
        status: {
          execution_status: status.execution_status,
          agent_execution_status: status.agent_execution_status,
          task_id: status.task_id,
        },
        cancelled: {
          execution_status: cancelled.execution_status,
          task_id: cancelled.task_id,
        },
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => socket.close());
