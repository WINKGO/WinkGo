#!/usr/bin/env node
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { isDeepStrictEqual } = require('node:util');
const { prepareWinkGoRuntimePackage } = require('./prepare-winkgo-runtime-package.cjs');

const projectRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(projectRoot, 'resources', 'winkgo', 'skills');
const proxyPath = path.join(projectRoot, 'resources', 'winkgo', 'winkgo-skill-runtime-proxy.cjs');
const executableName = 'SparkBot-MCP-Hub-v1.1.0.exe';
const browserSkillToolNames = ['winkgo.browser_skill.list', 'winkgo.browser_skill.run'];
const desktopSkillToolNames = ['winkgo.desktop_skill.list', 'winkgo.desktop_skill.run'];

const resolveRuntimeSelection = () => {
  const localAppData = process.env.LOCALAPPDATA || '';
  const explicitRoot = process.env.WINKGO_BUNDLED_RUNTIME_DIR;
  const releasesRoot = path.join(localAppData, 'Wink Go', 'data', 'runtime', 'xiaozhi');
  const installed = fs.existsSync(releasesRoot)
    ? fs
        .readdirSync(releasesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.includes('.old-'))
        .map((entry) => path.join(releasesRoot, entry.name, executableName))
        .filter(fs.existsSync)
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
    : [];
  const candidates = [
    ...(explicitRoot
      ? [
          [path.join(explicitRoot, 'SparkBot-MCP-Hub-v1.1.0-release', executableName), 'explicit_bundle'],
          [path.join(explicitRoot, executableName), 'explicit_bundle'],
        ]
      : []),
    ...installed.map((executablePath) => [executablePath, 'installed_release']),
    [path.join(localAppData, 'Wink Go', 'winkgo-runtime', executableName), 'legacy'],
  ];
  const selected = candidates.find(([executablePath]) => fs.existsSync(executablePath));
  const executablePath = selected?.[0] || '';
  return {
    executablePath,
    runtimeRoot: executablePath ? path.dirname(executablePath) : '',
    source: selected?.[1] || 'missing',
  };
};

const runtimeSelection = resolveRuntimeSelection();
if (process.argv.includes('--print-runtime')) {
  process.stdout.write(`${JSON.stringify(runtimeSelection, null, 2)}\n`);
  process.exit(0);
}

const recoverRuntimeLock = () => {
  const lockPath = runtimeSelection.runtimeRoot ? path.join(runtimeSelection.runtimeRoot, 'runtime.lock') : '';
  if (!lockPath || !fs.existsSync(lockPath)) return { removed: false, pid: null, reason: 'missing' };
  const rawPid = fs.readFileSync(lockPath, 'utf8').trim();
  if (!/^\d+$/.test(rawPid)) return { removed: false, pid: null, reason: 'invalid' };
  const pid = Number(rawPid);
  let processPath = '';
  try {
    processPath = require('node:child_process')
      .execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$process=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (-not $process) { exit 1 }; $process.Path`,
        ],
        { encoding: 'utf8', windowsHide: true, timeout: 2_000 }
      )
      .trim();
  } catch {
    fs.rmSync(lockPath, { force: true });
    return { removed: true, pid, reason: 'process_exited' };
  }
  if (path.resolve(processPath).toLowerCase() === path.resolve(runtimeSelection.executablePath).toLowerCase()) {
    return { removed: false, pid, reason: 'runtime_alive' };
  }
  fs.rmSync(lockPath, { force: true });
  return { removed: true, pid, reason: 'pid_reused' };
};

if (process.argv.includes('--recover-runtime-lock')) {
  process.stdout.write(`${JSON.stringify(recoverRuntimeLock(), null, 2)}\n`);
  process.exit(0);
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'winkgo-runtime-audit-'));
const configPath = path.join(temporaryRoot, 'enabled-skills.json');
if (!runtimeSelection.runtimeRoot) throw new Error('No WINK GO Runtime was found for the audit.');
const localRuntimeRoot = path.join(temporaryRoot, 'runtime');
prepareWinkGoRuntimePackage({ sourceRoot: runtimeSelection.runtimeRoot, destinationRoot: localRuntimeRoot });
const runtimeExecutable = path.join(localRuntimeRoot, executableName);
const listSelectedRuntimePids = () => {
  if (process.platform !== 'win32' || !runtimeExecutable) return [];
  const escapedPath = runtimeExecutable.replaceAll("'", "''");
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$target='${escapedPath}'; Get-CimInstance Win32_Process -Filter \"Name='${executableName}'\" | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { $_.ProcessId }`,
    ],
    { encoding: 'utf8', windowsHide: true }
  );
  if (result.status !== 0) return [];
  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
};
const cleanupAuditRuntimeProcesses = async () => {
  if (process.platform !== 'win32') return;
  await new Promise((resolve) => setTimeout(resolve, 350));
  const escapedPath = runtimeExecutable.replaceAll("'", "''");
  for (const pid of listSelectedRuntimePids()) {
    spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$target='${escapedPath}'; $process=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($process -and $process.Path -eq $target) { Stop-Process -Id ${pid} -Force }`,
      ],
      { encoding: 'utf8', windowsHide: true }
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 350));
  const leaked = listSelectedRuntimePids();
  if (leaked.length > 0) throw new Error(`Runtime audit left child process(es): ${leaked.join(', ')}`);
};
const safeSmokeCalls = {
  bilibili: ['desktop_agents.video_client_read_window', { client: 'bilibili' }],
  desktop_automation: ['winkgo.desktop_skill.list', {}],
  doubao: ['doubao.check_runtime', {}],
  iqiyi: ['desktop_agents.video_client_read_window', { client: 'iqiyi' }],
  netease_music: ['music.station_now_snapshot', { player: 'cloud', force_refresh: true }],
  qq_music: ['music.station_now_snapshot', { player: 'qq', force_refresh: true }],
  // Local registry smoke test stays read-only and does not require a user's
  // optional Home Assistant credential.
  smart_home: ['appliance.list_devices', {}],
  soda_music: ['music.station_now_snapshot', { player: 'fizz', force_refresh: true }],
  tencent_video: ['desktop_agents.video_client_read_window', { client: 'tencentvideo' }],
  web_automation: ['winkgo.browser_skill.list', {}],
  wechat: ['wechat.get_client_status', {}],
  windows: ['windows.get_system_info', {}],
  youku: ['desktop_agents.video_client_read_window', { client: 'youku' }],
};

const skillIds = fs
  .readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => entry.name)
  .sort();
const declaredToolNames = new Set();
const declaredPrefixes = new Set();
const internalToolNames = new Set();
const compatibilityToolAliases = {};
const compatibilityAliasOwners = new Map();
const conflictedCompatibilityAliases = new Set();
const directActionToolOwners = new Map();
const skillActions = new Map();

for (const skillId of skillIds) {
  const manifest = JSON.parse(fs.readFileSync(path.join(skillsRoot, skillId, 'manifest.json'), 'utf8'));
  const actions = JSON.parse(fs.readFileSync(path.join(skillsRoot, skillId, 'actions.json'), 'utf8'));
  const selectors =
    manifest.tool_selectors && typeof manifest.tool_selectors === 'object' ? manifest.tool_selectors : {};
  const bridgeToolNames =
    skillId === 'web_automation'
      ? browserSkillToolNames
      : skillId === 'desktop_automation'
        ? [...desktopSkillToolNames, 'desktop_automation.cancel']
        : null;
  if (bridgeToolNames) {
    for (const name of bridgeToolNames) declaredToolNames.add(name);
  } else {
    for (const name of [...(selectors.names || []), ...(selectors.shared_names || [])]) declaredToolNames.add(name);
    for (const prefix of selectors.prefixes || []) declaredPrefixes.add(prefix);
  }
  for (const name of manifest.internal_tool_names || []) internalToolNames.add(name);
  const effectiveActions =
    skillId === 'web_automation'
      ? [
          { id: 'list_saved', tool_names: [browserSkillToolNames[0]] },
          { id: 'run_saved', tool_names: [browserSkillToolNames[1]] },
        ]
      : skillId === 'desktop_automation'
        ? [
            { id: 'list_saved', tool_names: [desktopSkillToolNames[0]] },
            { id: 'run_saved', tool_names: [desktopSkillToolNames[1]] },
            { id: 'cancel', tool_names: ['desktop_automation.cancel'] },
          ]
        : actions.actions || [];
  skillActions.set(skillId, effectiveActions);
  for (const action of effectiveActions) {
    for (const name of action.tool_names || []) {
      declaredToolNames.add(name);
      const owners = directActionToolOwners.get(name) || new Set();
      owners.add(skillId);
      directActionToolOwners.set(name, owners);
    }
  }
  for (const [aliasName, alias] of Object.entries(manifest.compatibility_tool_aliases || {})) {
    if (!alias || typeof alias !== 'object' || typeof alias.canonical_tool_name !== 'string') continue;
    declaredToolNames.add(aliasName);
    const normalizedAlias = {
      canonicalToolName: alias.canonical_tool_name,
      defaultArguments: alias.default_arguments || {},
      argumentRenames: alias.argument_renames || {},
      dropArguments: alias.drop_arguments || [],
      argumentTransforms: alias.argument_transforms || {},
    };
    const owners = compatibilityAliasOwners.get(aliasName) || new Set();
    owners.add(skillId);
    compatibilityAliasOwners.set(aliasName, owners);
    if (conflictedCompatibilityAliases.has(aliasName)) continue;
    const existingAlias = compatibilityToolAliases[aliasName];
    if (!existingAlias) compatibilityToolAliases[aliasName] = normalizedAlias;
    else if (!isDeepStrictEqual(existingAlias, normalizedAlias)) {
      delete compatibilityToolAliases[aliasName];
      conflictedCompatibilityAliases.add(aliasName);
    }
  }
}

for (const [aliasName, actionOwners] of directActionToolOwners) {
  const aliasOwners = compatibilityAliasOwners.get(aliasName);
  if (aliasOwners && [...actionOwners].some((owner) => !aliasOwners.has(owner))) {
    delete compatibilityToolAliases[aliasName];
    conflictedCompatibilityAliases.add(aliasName);
  }
}
for (const aliasName of conflictedCompatibilityAliases) {
  if (!directActionToolOwners.has(aliasName)) declaredToolNames.delete(aliasName);
}

const runtimeConfigCandidates = [
  ...['config.local.yaml', 'config.bundle-local.yaml', 'config.yaml'].map((name) =>
    localRuntimeRoot ? path.join(localRuntimeRoot, name) : ''
  ),
  path.join(process.env.APPDATA || '', 'com.winkgo.desktop', 'inspiration-runtime.yaml'),
].filter(Boolean);
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
      localBrowserSkillsEnabled: true,
      localDesktopSkillsEnabled: true,
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
    const brokenActions = [];
    for (const [skillId, actions] of skillActions) {
      for (const action of actions) {
        const toolNames = Array.isArray(action.tool_names) ? action.tool_names : [];
        const available = toolNames.filter((name) => runtimeTools.has(name));
        if (available.length === 0) brokenActions.push(`${skillId}:${action.id}`);
      }
    }
    const smokeFailures = [];
    const smokeResults = [];
    if (process.argv.includes('--smoke')) {
      for (const skillId of skillIds) {
        const smokeCall = safeSmokeCalls[skillId];
        if (!smokeCall) {
          smokeFailures.push(`${skillId}:missing-safe-smoke-call`);
          continue;
        }
        const [name, argumentsValue] = smokeCall;
        if (!runtimeTools.has(name)) {
          smokeFailures.push(`${skillId}:${name}:not-exposed`);
          continue;
        }
        if (
          name.startsWith('winkgo.') &&
          (!process.env.WINKGO_CDP_ACTIVE_PORT || !process.env.WINKGO_CDP_BRIDGE_TOKEN)
        ) {
          smokeResults.push(`${skillId}:${name}:exposed-only`);
          continue;
        }
        try {
          const callResult = await request('tools/call', { name, arguments: argumentsValue });
          if (callResult && callResult.isError === true) smokeFailures.push(`${skillId}:${name}:mcp-error-result`);
          else smokeResults.push(`${skillId}:${name}`);
        } catch (error) {
          smokeFailures.push(`${skillId}:${name}:${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    const report = {
      skills: skillIds.length,
      declaredExactTools: declaredToolNames.size,
      declaredPrefixes: declaredPrefixes.size,
      exposedTools: runtimeTools.size,
      conflictedCompatibilityAliases: [...conflictedCompatibilityAliases].sort(),
      missingExactTools: missing,
      brokenActions,
      ...(process.argv.includes('--smoke') ? { smokePassed: smokeResults.length, smokeFailures } : {}),
      ...(process.argv.includes('--verbose') ? { availableTools: [...runtimeTools].sort() } : {}),
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (missing.length > 0 || brokenActions.length > 0 || smokeFailures.length > 0) process.exitCode = 1;
  } finally {
    child.kill();
    await cleanupAuditRuntimeProcesses();
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
};

run().catch(async (error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
  child.kill();
  await cleanupAuditRuntimeProcesses().catch(() => {});
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
