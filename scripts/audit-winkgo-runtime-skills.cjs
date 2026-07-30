#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const projectRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(projectRoot, 'resources', 'winkgo', 'skills');
const proxyPath = path.join(projectRoot, 'resources', 'winkgo', 'winkgo-skill-runtime-proxy.cjs');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-runtime-audit-'));
const configPath = path.join(temporaryRoot, 'enabled-skills.json');
const executableName = 'SparkBot-MCP-Hub-v1.1.0.exe';
const localRuntimeRoot = path.join(process.env.LOCALAPPDATA || '', 'Wink Go', 'winkgo-runtime');

const skillIds = fs
  .readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .sort();
const declaredToolNames = new Set();
const declaredPrefixes = new Set();
const internalToolNames = new Set();
const compatibilityToolAliases = {};

for (const skillId of skillIds) {
  const manifest = JSON.parse(fs.readFileSync(path.join(skillsRoot, skillId, 'manifest.json'), 'utf8'));
  const actions = JSON.parse(fs.readFileSync(path.join(skillsRoot, skillId, 'actions.json'), 'utf8'));
  const selectors =
    manifest.tool_selectors && typeof manifest.tool_selectors === 'object' ? manifest.tool_selectors : {};
  for (const name of [...(selectors.names || []), ...(selectors.shared_names || [])]) declaredToolNames.add(name);
  for (const prefix of selectors.prefixes || []) declaredPrefixes.add(prefix);
  for (const name of manifest.internal_tool_names || []) internalToolNames.add(name);
  for (const action of actions.actions || []) {
    for (const name of action.tool_names || []) declaredToolNames.add(name);
  }
  for (const [aliasName, alias] of Object.entries(manifest.compatibility_tool_aliases || {})) {
    if (!alias || typeof alias !== 'object' || typeof alias.canonical_tool_name !== 'string') continue;
    declaredToolNames.add(aliasName);
    compatibilityToolAliases[aliasName] = {
      canonicalToolName: alias.canonical_tool_name,
      defaultArguments: alias.default_arguments || {},
      argumentRenames: alias.argument_renames || {},
      dropArguments: alias.drop_arguments || [],
      argumentTransforms: alias.argument_transforms || {},
    };
  }
}

const runtimeExecutable = path.join(localRuntimeRoot, executableName);
const runtimeConfigCandidates = ['config.local.yaml', 'config.bundle-local.yaml', 'config.yaml'].map((name) =>
  path.join(localRuntimeRoot, name)
);
const runtimeConfig = runtimeConfigCandidates.find((candidate) => fs.existsSync(candidate));
const runtimeLaunch =
  fs.existsSync(runtimeExecutable) && runtimeConfig
    ? {
        executablePath: runtimeExecutable,
        configPath: runtimeConfig,
        workingDirectory: localRuntimeRoot,
        ownerPid: process.pid,
      }
    : undefined;

fs.writeFileSync(
  configPath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      runtimeApi: 'http://127.0.0.1:8121',
      runtimeLaunch,
      enabledSkillIds: skillIds,
      allowedToolNames: [...declaredToolNames].sort(),
      allowedToolPrefixes: [...declaredPrefixes].sort(),
      compatibilityToolAliases,
      skillPreferences: { wechat: { favoriteContacts: [], favoriteGroups: [] } },
    },
    null,
    2
  )}\n`,
  'utf8'
);

const child = spawn(process.execPath, [proxyPath, configPath, 'audit'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
});
const pending = new Map();
let nextId = 1;
let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8');
});
readline.createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (!waiter) return;
  clearTimeout(waiter.timer);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message || 'MCP request failed.'));
  else waiter.resolve(message.result);
});

const request = (method, params = {}) => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}. ${stderr.trim()}`));
    }, 45_000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
};

const run = async () => {
  try {
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'WINK GO Runtime Audit', version: '1.0.0' },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const result = await request('tools/list');
    const runtimeTools = new Set((result.tools || []).map((tool) => tool.name));
    const missing = [...declaredToolNames]
      .filter((name) => !internalToolNames.has(name) && !runtimeTools.has(name))
      .sort();
    const report = {
      skills: skillIds.length,
      declaredExactTools: declaredToolNames.size,
      declaredPrefixes: declaredPrefixes.size,
      exposedTools: runtimeTools.size,
      missingExactTools: missing,
      ...(process.argv.includes('--verbose') ? { availableTools: [...runtimeTools].sort() } : {}),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (missing.length > 0) process.exitCode = 1;
  } finally {
    child.kill();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
  child.kill();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
