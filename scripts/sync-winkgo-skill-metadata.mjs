#!/usr/bin/env node
/**
 * Copies the audited, dependency-free skill metadata into the desktop bundle.
 * Python adapters and service code deliberately stay in the separately
 * packaged WINK GO Runtime; the Electron app ships only manifests, actions,
 * and agent instructions.
 */
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.resolve(
  process.env.WINKGO_SKILLS_SOURCE_DIR || 'D:\\winkgo\\winkgo-app\\source-runtime\\skills'
);
const targetRoot = path.join(repositoryRoot, 'resources', 'winkgo', 'skills');
const excluded = new Set(['__pycache__', '_shared', 'desktop_agents', 'feishu']);
const requiredFiles = ['manifest.json', 'actions.json', 'SKILL.md'];
const wechatFavoritesAction = {
  id: 'favorites',
  phrases: ['常用联系人', '常用群聊', '我的微信常用目标'],
  tool_names: ['winkgo.wechat.list_favorites'],
  default_arguments: {},
};

const entries = await readdir(sourceRoot, { withFileTypes: true });
let copied = 0;

for (const entry of entries) {
  if (!entry.isDirectory() || excluded.has(entry.name) || entry.name.startsWith('.')) continue;
  const sourceDirectory = path.join(sourceRoot, entry.name);
  const manifest = JSON.parse(await readFile(path.join(sourceDirectory, 'manifest.json'), 'utf8'));
  const skillId = typeof manifest.id === 'string' && manifest.id.trim() ? manifest.id.trim() : entry.name;
  if (excluded.has(skillId)) continue;

  const targetDirectory = path.join(targetRoot, skillId);
  await mkdir(targetDirectory, { recursive: true });
  for (const filename of requiredFiles) {
    await copyFile(path.join(sourceDirectory, filename), path.join(targetDirectory, filename));
  }
  if (skillId === 'wechat') {
    const actionsPath = path.join(targetDirectory, 'actions.json');
    const actions = JSON.parse(await readFile(actionsPath, 'utf8'));
    const actionItems = Array.isArray(actions.actions) ? actions.actions : [];
    actions.actions = [
      ...actionItems.filter((action) => action?.id !== wechatFavoritesAction.id),
      wechatFavoritesAction,
    ];
    await writeFile(actionsPath, `${JSON.stringify(actions, null, 2)}\n`, 'utf8');
  }
  copied += 1;
}

process.stdout.write(`Synced ${copied} WINK GO skill metadata packages to ${targetRoot}\n`);
