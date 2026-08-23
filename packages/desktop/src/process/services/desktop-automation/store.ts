/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DesktopSkillPackage } from '@/common/types/desktopAutomation';

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type WinkGoDesktopSkillsStoreOptions = {
  rootDir: string;
  now?: () => Date;
};

export type SaveDesktopSkillRequest = {
  profileId: string;
  skill: DesktopSkillPackage;
};

export type DesktopSkillRegistryItem = {
  id: string;
  name: string;
  runner: 'winkgo.desktop-skill.v1';
  updatedAt: string;
};

type DesktopSkillRegistry = {
  schemaVersion: 'winkgo.desktop.registry.v1';
  skills: DesktopSkillRegistryItem[];
};

const assertSafeId = (kind: 'profile' | 'skill', value: string): void => {
  if (!SAFE_ID_PATTERN.test(value)) {
    throw new Error(kind === 'profile' ? 'Invalid desktop skill profile id' : 'Invalid desktop skill id');
  }
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const writeJson = async (targetPath: string, value: unknown): Promise<void> => {
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const sanitizeSkillForPersistence = (skill: DesktopSkillPackage): DesktopSkillPackage => {
  const sanitized = JSON.parse(JSON.stringify(skill)) as DesktopSkillPackage;
  const secretKeys = new Set(sanitized.manifest.parameters.filter(({ secret }) => secret).map(({ key }) => key));
  for (const step of sanitized.workflow.steps) {
    if (step.kind === 'input' && (step.sensitive || (step.parameterKey && secretKeys.has(step.parameterKey)))) {
      delete step.value;
    }
  }
  return sanitized;
};

const replaceAtomically = async (stagedPath: string, targetPath: string): Promise<void> => {
  if (!(await pathExists(targetPath))) {
    await fs.rename(stagedPath, targetPath);
    return;
  }

  const backupPath = `${targetPath}.backup-${randomUUID()}`;
  await fs.rename(targetPath, backupPath);
  try {
    await fs.rename(stagedPath, targetPath);
  } catch (error) {
    await fs.rename(backupPath, targetPath);
    throw error;
  }
  await fs.rm(backupPath, { recursive: true, force: true });
};

/** Local, profile-scoped persistence boundary for WINK GO Desktop Skills. */
export class WinkGoDesktopSkillsStore {
  constructor(private readonly options: WinkGoDesktopSkillsStoreOptions) {}

  async save(request: SaveDesktopSkillRequest): Promise<DesktopSkillPackage> {
    const { profileId } = request;
    const skill = sanitizeSkillForPersistence(request.skill);
    assertSafeId('profile', profileId);
    assertSafeId('skill', skill.manifest.id);

    const profileRoot = path.join(this.options.rootDir, 'profiles', profileId);
    const skillsRoot = path.join(profileRoot, 'skills');
    const skillRoot = path.join(skillsRoot, skill.manifest.id);
    const stagedRoot = path.join(skillsRoot, `.${skill.manifest.id}.${randomUUID()}.tmp`);
    await fs.mkdir(stagedRoot, { recursive: true });

    try {
      await Promise.all([
        writeJson(path.join(stagedRoot, 'manifest.json'), skill.manifest),
        writeJson(path.join(stagedRoot, 'workflow.json'), skill.workflow),
        writeJson(path.join(stagedRoot, 'trace.json'), {
          schemaVersion: 'winkgo.desktop.trace.v1',
          steps: skill.workflow.steps.map(({ id, kind }) => ({ id, kind })),
        }),
        writeJson(path.join(stagedRoot, 'meta.json'), {
          schemaVersion: 'winkgo.desktop.meta.v1',
          updatedAt: (this.options.now?.() ?? new Date()).toISOString(),
        }),
        fs.writeFile(
          path.join(stagedRoot, 'SKILL.md'),
          `# ${skill.manifest.name}\n\n${skill.manifest.description}\n`,
          'utf8'
        ),
      ]);
      await replaceAtomically(stagedRoot, skillRoot);
    } catch (error) {
      await fs.rm(stagedRoot, { recursive: true, force: true });
      throw error;
    }

    await this.updateRegistry(profileRoot, skill);
    return skill;
  }

  async load(profileId: string, skillId: string): Promise<DesktopSkillPackage | null> {
    assertSafeId('profile', profileId);
    assertSafeId('skill', skillId);
    const skillRoot = path.join(this.options.rootDir, 'profiles', profileId, 'skills', skillId);
    try {
      const [manifest, workflow] = await Promise.all([
        fs.readFile(path.join(skillRoot, 'manifest.json'), 'utf8'),
        fs.readFile(path.join(skillRoot, 'workflow.json'), 'utf8'),
      ]);
      return {
        manifest: JSON.parse(manifest) as DesktopSkillPackage['manifest'],
        workflow: JSON.parse(workflow) as DesktopSkillPackage['workflow'],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async list(profileId: string): Promise<DesktopSkillRegistryItem[]> {
    assertSafeId('profile', profileId);
    const registryPath = path.join(this.options.rootDir, 'profiles', profileId, 'registry.json');
    try {
      const registry = JSON.parse(await fs.readFile(registryPath, 'utf8')) as DesktopSkillRegistry;
      return registry.skills
        .filter(({ id }) => SAFE_ID_PATTERN.test(id))
        .map((item) => ({ ...item }))
        .toSorted((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  async remove(profileId: string, skillId: string): Promise<boolean> {
    assertSafeId('profile', profileId);
    assertSafeId('skill', skillId);
    const profileRoot = path.join(this.options.rootDir, 'profiles', profileId);
    const skillRoot = path.join(profileRoot, 'skills', skillId);
    if (!(await pathExists(skillRoot))) return false;
    await fs.rm(skillRoot, { recursive: true, force: true });

    const registryPath = path.join(profileRoot, 'registry.json');
    let registry: DesktopSkillRegistry = { schemaVersion: 'winkgo.desktop.registry.v1', skills: [] };
    try {
      registry = JSON.parse(await fs.readFile(registryPath, 'utf8')) as DesktopSkillRegistry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    registry.skills = registry.skills.filter(({ id }) => id !== skillId);
    const stagedRegistryPath = path.join(profileRoot, `.registry.${randomUUID()}.tmp`);
    await writeJson(stagedRegistryPath, registry);
    await replaceAtomically(stagedRegistryPath, registryPath);
    return true;
  }

  private async updateRegistry(profileRoot: string, skill: DesktopSkillPackage): Promise<void> {
    const registryPath = path.join(profileRoot, 'registry.json');
    let registry: DesktopSkillRegistry = { schemaVersion: 'winkgo.desktop.registry.v1', skills: [] };
    try {
      registry = JSON.parse(await fs.readFile(registryPath, 'utf8')) as DesktopSkillRegistry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const updatedAt = (this.options.now?.() ?? new Date()).toISOString();
    const updatedRegistry: DesktopSkillRegistry = {
      schemaVersion: 'winkgo.desktop.registry.v1',
      skills: [
        ...registry.skills.filter(({ id }) => id !== skill.manifest.id),
        {
          id: skill.manifest.id,
          name: skill.manifest.name,
          runner: skill.manifest.runner,
          updatedAt,
        },
      ],
    };
    await fs.mkdir(profileRoot, { recursive: true });
    const stagedRegistryPath = path.join(profileRoot, `.registry.${randomUUID()}.tmp`);
    await writeJson(stagedRegistryPath, updatedRegistry);
    await replaceAtomically(stagedRegistryPath, registryPath);
  }
}
